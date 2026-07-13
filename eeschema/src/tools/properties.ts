/**
 * Edit Symbol Properties command, ported from KiCad's
 * DIALOG_SYMBOL_PROPERTIES::TransferDataFromWindow (dialog_symbol_properties.cpp).
 *
 * The dialog edits a copy of the symbol's fields (positions symbol-relative) plus
 * unit / orientation / mirror / attribute flags; OK applies everything as one
 * undoable commit. KiCad's post-processing rules are reproduced exactly:
 *   - a field with an empty name AND empty value is dropped,
 *   - a field with an empty name but a value is renamed "untitled",
 *   - field positions convert from symbol-relative back to absolute,
 *   - mandatory fields (Reference, Value, Footprint, Datasheet, Description)
 *     are never dropped.
 */

import type { Schematic, SchSymbol, SchField } from '../types.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';

/** KiCad SCH_FIELD::IsMandatory, by canonical name (we have no FIELD_T ids). */
export const MANDATORY_FIELDS = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'];

export const isMandatoryField = (key: string): boolean => MANDATORY_FIELDS.includes(key);

/** A field as edited in the dialog: `at` is symbol-relative, `source` optional (new fields). */
export type EditedField = Omit<SchField, 'source'> & { readonly source?: SchField['source'] };

/** The symbol-level results of the properties dialog. */
export interface SymbolEdit {
  readonly fields: readonly EditedField[];
  readonly angle: number;
  readonly mirror?: 'x' | 'y';
  readonly unit: number;
  readonly inBom: boolean;
  readonly onBoard: boolean;
  readonly dnp: boolean;
  readonly excludedFromSim?: boolean;
}

/** TransferDataFromWindow's field post-processing + rel→abs position conversion. */
function applyFields(sym: SchSymbol, edited: readonly EditedField[]): readonly SchField[] {
  const out: SchField[] = [];
  for (const f of edited) {
    if (f.key === '' && f.value === '') continue; // dropped, as in KiCad
    const key = f.key === '' ? 'untitled' : f.key;
    const at = f.at ? { x: f.at.x + sym.at.x, y: f.at.y + sym.at.y } : undefined;
    const base = { ...f, key, at };
    out.push(f.source ? (base as SchField) : { ...base, source: buildPropertyNode(base) });
  }
  return out;
}

/** Apply the Symbol Properties dialog's result to the symbol with `id`, undoably. */
export function editSymbolProperties(id: string, edit: SymbolEdit): EditCommand {
  return {
    label: 'Edit Symbol Properties',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => {
          if (refId('symbol', s.uuid, i) !== id) return s;
          const next: SchSymbol = {
            ...s,
            angle: edit.angle,
            unit: edit.unit,
            inBom: edit.inBom,
            onBoard: edit.onBoard,
            dnp: edit.dnp,
            fields: applyFields(s, edit.fields),
          };
          const m = { ...next } as { -readonly [K in keyof SchSymbol]: SchSymbol[K] };
          if (edit.mirror) m.mirror = edit.mirror;
          else delete m.mirror;
          if (edit.excludedFromSim !== undefined) m.excludedFromSim = edit.excludedFromSim;
          return m;
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      return restoreSymbols(new Map(prev.filter(([rid]) => rid === id)));
    },
  };
}

/** Restore captured symbols verbatim (the inverse of a properties edit). */
function restoreSymbols(saved: ReadonlyMap<string, SchSymbol>): EditCommand {
  return {
    label: 'Edit Symbol Properties',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => saved.get(refId('symbol', s.uuid, i)) ?? s),
      };
    },
    invert(before: Schematic): EditCommand {
      const ids = new Set(saved.keys());
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      return restoreSymbols(new Map(prev.filter(([rid]) => ids.has(rid))));
    },
  };
}
