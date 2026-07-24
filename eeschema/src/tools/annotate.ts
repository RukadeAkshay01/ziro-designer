/**
 * Symbol annotation. Counterpart: `eeschema/annotate.cpp`
 * (SCH_EDIT_FRAME::AnnotateSymbols) + the numbering core in
 * `eeschema/sch_reference_list.cpp` (SCH_REFERENCE_LIST::Annotate /
 * AnnotateByOptions / FindFirstUnusedReference).
 *
 * Faithful to upstream for the cases that matter in a single loaded document:
 * sort references by prefix then X- or Y-position (or leave unsorted), assign
 * each un-annotated symbol the first free number for its prefix at or above the
 * minimum (start number, or sheet-number × 100/1000), keep multi-unit symbols
 * that already share a reference on the same number, and never touch power
 * symbols (`#`-prefixed references). Out-of-scope symbols reserve their numbers
 * so a current-sheet / selection pass produces no duplicates.
 */

import type { SchField, SchSymbol, Schematic, LibSymbol } from '../types.js';
import type { RefDesTracker } from './refdes_tracker.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { str } from '@ziroeda/sexpr';
import type { SList } from '@ziroeda/sexpr';

/** ANNOTATE_ORDER_T. */
export type AnnotateOrder = 'x' | 'y' | 'unsorted';
/** ANNOTATE_ALGO_T. */
export type AnnotateAlgo = 'incremental' | 'sheet_100' | 'sheet_1000';
/** ANNOTATE_SCOPE_T. */
export type AnnotateScope = 'all' | 'current_sheet' | 'selection';

export interface AnnotateOptions {
  scope: AnnotateScope;
  order: AnnotateOrder;
  algo: AnnotateAlgo;
  /** aResetAnnotation: clear existing numbers and reassign from scratch. */
  resetExisting: boolean;
  /** aStartNumber (incremental algo only); the first assigned number is +1. */
  startNumber: number;
  /** The current sheet's number for the sheet-× algos; defaults to 1. */
  sheetNumber?: number;
  /** REFDES_TRACKER (schematic.used_designators): with reuseRefDes false,
   *  previously-used-but-freed numbers are skipped; every accepted number is
   *  recorded (GetNextRefDesForUnits' m_allRefDes gate + insert). */
  tracker?: RefDesTracker;
}

export const defaultAnnotateOptions = (): AnnotateOptions => ({
  scope: 'all',
  order: 'x',
  algo: 'incremental',
  resetExisting: false,
  startNumber: 0,
  sheetNumber: 1,
});

/** `R12` → { prefix: 'R', num: 12 }; `R?` / `R` → { prefix: 'R' }
 *  (SCH_REFERENCE::Split). */
export function splitReference(ref: string): { prefix: string; num?: number } {
  const m = /^(.*?)(\d+)$/.exec(ref);
  if (m) return { prefix: m[1]!, num: Number(m[2]) };
  return { prefix: ref.replace(/\?+$/, '') };
}

const referenceOf = (s: SchSymbol): SchField | undefined =>
  s.fields.find((f) => f.key === 'Reference');

/** Distinct unit count of a symbol's library part (SCH_SYMBOL::GetUnitCount). */
function unitCount(libId: string, libById: ReadonlyMap<string, LibSymbol>): number {
  const lib = libById.get(libId);
  if (!lib) return 1;
  const units = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0));
  return Math.max(1, units.size);
}

const setFieldValue = (f: SchField, value: string): SchField => {
  const items = f.source.items.slice();
  items[2] = str(value);
  return { ...f, value, source: { kind: 'list', items } as SList };
};

interface Candidate {
  index: number;
  sym: SchSymbol;
  prefix: string;
  num?: number;
  isNew: boolean;
  multiUnit: boolean;
  /** Original full reference (prefix+num) for multi-unit grouping, if numbered. */
  origFull?: string;
}

/** One unit's claim on a shared reference number (REFDES_TRACKER's view of a
 *  multi-unit occupant: library id + value + unit). */
interface UnitRec {
  lib: string;
  value: string;
  unit: number;
}

/**
 * Compute the new symbols array with references (re)assigned per `opts`.
 * `selectedIds` is required for scope 'selection'. Returns the same array
 * reference when nothing changes.
 */
export function annotateSymbols(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: AnnotateOptions,
  selectedIds?: ReadonlySet<string>,
): readonly SchSymbol[] {
  const sheetNum = opts.sheetNumber ?? 1;
  const inScope = (i: number, s: SchSymbol): boolean => {
    if (opts.scope === 'selection') return !!selectedIds?.has(refId('symbol', s.uuid, i));
    return true; // 'all' and 'current_sheet' coincide for a single loaded sheet
  };

  const candidates: Candidate[] = [];
  const symbolValue = (s: SchSymbol): string =>
    s.fields.find((f) => f.key === 'Value')?.value ?? '';
  // prefix → number → occupants. 'full' = a single-unit symbol owns the number
  // outright; a UnitRec list = multi-unit occupants that may share it.
  const reserved = new Map<string, Map<number, 'full' | UnitRec[]>>();
  const reserve = (prefix: string, n: number, rec?: UnitRec): void => {
    let nums = reserved.get(prefix);
    if (!nums) {
      nums = new Map();
      reserved.set(prefix, nums);
    }
    const cur = nums.get(n);
    if (!rec || cur === 'full') nums.set(n, 'full');
    else if (!cur) nums.set(n, [rec]);
    else cur.push(rec);
  };
  const unitRecOf = (sym: SchSymbol): UnitRec => ({
    lib: sym.libId,
    value: symbolValue(sym),
    unit: sym.unit,
  });

  doc.symbols.forEach((sym, index) => {
    const ref = referenceOf(sym);
    if (!ref) return;
    const { prefix, num } = splitReference(ref.value);
    if (prefix.startsWith('#')) return; // power / flag symbols keep their refs
    const multiUnit = unitCount(sym.libId, libById) > 1;
    if (!inScope(index, sym)) {
      // Out-of-scope symbols reserve their numbers (additionalRefs).
      if (num !== undefined) reserve(prefix, num, multiUnit ? unitRecOf(sym) : undefined);
      return;
    }
    const isNew = opts.resetExisting || num === undefined;
    candidates.push({
      index,
      sym,
      prefix,
      num,
      isNew,
      multiUnit,
      origFull: num !== undefined ? `${prefix}${num}` : undefined,
    });
    // A kept (not-new) reference reserves its number.
    if (!isNew && num !== undefined) reserve(prefix, num, multiUnit ? unitRecOf(sym) : undefined);
  });

  if (candidates.length === 0) return doc.symbols;

  // Sort by prefix, then position (x-then-y or y-then-x), then uuid — the
  // SCH_REFERENCE_LIST::sortByXPosition / sortByYPosition comparators. Unsorted
  // keeps document collection order.
  const ordered = candidates.slice();
  if (opts.order !== 'unsorted') {
    const primary = opts.order === 'x' ? 'x' : 'y';
    const secondary = opts.order === 'x' ? 'y' : 'x';
    ordered.sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1;
      if (a.sym.at[primary] !== b.sym.at[primary]) return a.sym.at[primary] - b.sym.at[primary];
      if (a.sym.at[secondary] !== b.sym.at[secondary])
        return a.sym.at[secondary] - b.sym.at[secondary];
      return (a.sym.uuid ?? '') < (b.sym.uuid ?? '') ? -1 : 1;
    });
  }

  const minRefId = (): number => {
    switch (opts.algo) {
      case 'sheet_100':
        return sheetNum * 100 + 1;
      case 'sheet_1000':
        return sheetNum * 1000 + 1;
      default:
        return opts.startNumber + 1;
    }
  };
  // REFDES_TRACKER::GetNextRefDesForUnits + areUnitsAvailable: the first
  // number ≥ min that is either unused, or (for a multi-unit symbol) occupied
  // only by units of the same library symbol and value with every required
  // unit slot still free — so two fresh ECC83 halves become U1A and U1B.
  const tracker = opts.tracker;
  const accept = (prefix: string, n: number): boolean => {
    // GetNextRefDesForUnits: a number not currently in use is taken only when
    // reuse is allowed or it was never used before; acceptance records it.
    if (tracker && !tracker.reuseRefDes && tracker.contains(`${prefix}${n}`)) return false;
    tracker?.insert(`${prefix}${n}`);
    return true;
  };
  const firstFree = (
    prefix: string,
    min: number,
    forUnits?: { lib: string; value: string; units: readonly number[] },
  ): number => {
    const nums = reserved.get(prefix);
    for (let n = min; ; n++) {
      const cur = nums?.get(n);
      if (!cur) {
        if (accept(prefix, n)) return n;
        continue;
      }
      if (cur === 'full' || !forUnits) continue;
      const free = forUnits.units.every((u) =>
        cur.every((r) => r.lib === forUnits.lib && r.value === forUnits.value && r.unit !== u),
      );
      // A number already in use by compatible units is shared, not newly
      // issued — the tracker records it without gating (it is "currently in
      // use", the branch upstream takes through areUnitsAvailable).
      if (free) {
        tracker?.insert(`${prefix}${n}`);
        return n;
      }
    }
  };

  // Multi-unit symbols that already shared a full reference keep sharing a
  // number (the aLockedUnitMap path): the group is renumbered together, onto
  // a number with room for all of its units.
  const groupUnits = new Map<string, number[]>(); // origFull → member units
  for (const c of ordered) {
    if (c.isNew && c.multiUnit && c.origFull) {
      const arr = groupUnits.get(c.origFull) ?? [];
      arr.push(c.sym.unit);
      groupUnits.set(c.origFull, arr);
    }
  }
  const groupNumber = new Map<string, number>(); // origFull → assigned number

  const newRefFor = new Map<number, string>(); // symbol index → new reference
  for (const c of ordered) {
    if (!c.isNew) continue;
    let n: number;
    if (c.multiUnit && c.origFull && groupNumber.has(c.origFull)) {
      n = groupNumber.get(c.origFull)!;
    } else if (c.multiUnit) {
      const units = c.origFull ? groupUnits.get(c.origFull)! : [c.sym.unit];
      n = firstFree(c.prefix, minRefId(), {
        lib: c.sym.libId,
        value: symbolValue(c.sym),
        units,
      });
      if (c.origFull) groupNumber.set(c.origFull, n);
    } else {
      n = firstFree(c.prefix, minRefId());
    }
    reserve(c.prefix, n, c.multiUnit ? unitRecOf(c.sym) : undefined);
    newRefFor.set(c.index, `${c.prefix}${n}`);
  }

  if (newRefFor.size === 0) return doc.symbols;

  let changed = false;
  const next = doc.symbols.map((sym, i) => {
    const newRef = newRefFor.get(i);
    if (newRef === undefined) return sym;
    const ref = referenceOf(sym);
    if (!ref || ref.value === newRef) return sym;
    changed = true;
    return {
      ...sym,
      fields: sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, newRef) : f)),
    };
  });
  return changed ? next : doc.symbols;
}

/** Annotate as an undoable command (SCH_EDIT_FRAME::AnnotateSymbols + commit). */
export function annotateCommand(
  libById: ReadonlyMap<string, LibSymbol>,
  opts: AnnotateOptions,
  selectedIds?: ReadonlySet<string>,
): EditCommand {
  return {
    label: 'Annotate Schematic',
    apply(doc: Schematic): Schematic {
      const symbols = annotateSymbols(doc, libById, opts, selectedIds);
      return symbols === doc.symbols ? doc : { ...doc, symbols };
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}

/**
 * Clear Annotation (SCH_EDIT_FRAME::DeleteAnnotation): reset each in-scope
 * non-power symbol's reference to its bare prefix + '?'. Undoable.
 */
export function clearAnnotationCommand(
  scope: AnnotateScope,
  selectedIds?: ReadonlySet<string>,
): EditCommand {
  return {
    label: 'Clear Annotation',
    apply(doc: Schematic): Schematic {
      let changed = false;
      const symbols = doc.symbols.map((sym, i) => {
        if (scope === 'selection' && !selectedIds?.has(refId('symbol', sym.uuid, i))) return sym;
        const ref = referenceOf(sym);
        if (!ref) return sym;
        const { prefix } = splitReference(ref.value);
        if (prefix.startsWith('#')) return sym;
        const cleared = `${prefix}?`;
        if (ref.value === cleared) return sym;
        changed = true;
        return {
          ...sym,
          fields: sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, cleared) : f)),
        };
      });
      return changed ? { ...doc, symbols } : doc;
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}

function restoreSymbols(symbols: readonly SchSymbol[]): EditCommand {
  return {
    label: 'Annotate Schematic',
    apply(doc: Schematic): Schematic {
      return { ...doc, symbols };
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}
