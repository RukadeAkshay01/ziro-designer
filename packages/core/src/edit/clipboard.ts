/**
 * Copy / paste / duplicate, ported from KiCad's SCH_EDITOR_CONTROL
 * (eeschema/tools/sch_editor_control.cpp):
 *
 *  - doCopy(): the clipboard payload is KiCad's own format — a bare sequence of
 *    S-expressions, `(lib_symbols <defs used by the selection>)` followed by the
 *    selected items, exactly what SCH_IO_KICAD_SEXPR::Format(SCH_SELECTION*)
 *    writes. Text copied here pastes into desktop KiCad and vice versa.
 *  - Paste(): parses the clipboard content (ParseSchematic with
 *    aIsCopyableOnly = true accepts the bare sequence), gives every pasted item
 *    a fresh UUID (pins included), merges the needed lib_symbols into the sheet,
 *    prunes clipboard-foreign instance data, and re-annotates any reference that
 *    collides with one already in the schematic (PASTE_MODE::UNIQUE_ANNOTATIONS,
 *    the default when automatic annotation is on). Content that isn't valid
 *    schematic data becomes a text item, as KiCad does.
 *  - Duplicate(): doCopy(true) into a local buffer + Paste from it.
 */

import { parse, serialize } from '../sexpr/index.js';
import { head, isList, list, atom, str, type SList } from '../sexpr/types.js';
import { readSchematic } from '../model/read-schematic.js';
import type { Schematic, SchSymbol, SchLine, SchJunction, SchLabel, SchField, LibSymbol, Vec2 } from '../model/types.js';
import { writeSchematic } from '../model/write-schematic.js';
import { childNamed } from '../sexpr/query.js';
import { refId } from './hittest.js';
import { newUuid, makeLabel } from './build.js';
import type { EditCommand } from './command.js';
import type { ItemsBatch } from './mutate.js';

// ----- copy -------------------------------------------------------------------

/**
 * Serialize the selected items to KiCad's clipboard text: `(lib_symbols ...)`
 * with the definitions the selected symbols use, then each item, top-level.
 * Uses the same write path as saving, so edited geometry is current.
 */
export function copySelectionText(sch: Schematic, ids: ReadonlySet<string>): string {
  const symbols = sch.symbols.filter((s, i) => ids.has(refId('symbol', s.uuid, i)));
  const lines = sch.lines.filter((l, i) => ids.has(refId('line', l.uuid, i)));
  const junctions = sch.junctions.filter((j, i) => ids.has(refId('junction', j.uuid, i)));
  const noConnects = sch.noConnects.filter((nc, i) => ids.has(refId('noconnect', nc.uuid, i)));
  const labels = sch.labels.filter((l, i) => ids.has(refId('label', l.uuid, i)));

  const usedLibIds = new Set(symbols.map((s) => s.libId));
  const libs = sch.libSymbols.filter((l) => usedLibIds.has(l.libId));

  // Round the subset through the writer so item nodes carry current geometry.
  // Sheets are excluded from the clipboard for now: KiCad ships each sheet's
  // screen along on the clipboard (m_supplementaryClipboard), which needs
  // multi-document paste support.
  const subset: Schematic = { ...sch, symbols, lines, junctions, noConnects, labels, sheets: [], busEntries: [], images: [], graphics: [], libSymbols: libs };
  const root = writeSchematic(subset);

  const parts: string[] = [];
  for (const it of root.items) {
    if (!isList(it)) continue;
    const h = head(it);
    if (h === 'lib_symbols') {
      if (it.items.length > 1) parts.push(serialize(it));
    } else if (h === 'symbol' || h === 'wire' || h === 'bus' || h === 'polyline'
        || h === 'junction' || h === 'no_connect' || h === 'label' || h === 'global_label'
        || h === 'hierarchical_label' || h === 'text') {
      parts.push(serialize(it));
    }
  }
  return parts.join('\n');
}

// ----- paste ------------------------------------------------------------------

/** What a paste drops on the sheet: items (still at their copied positions) + libs. */
export interface PastePayload {
  batch: Required<ItemsBatch>;
  libs: LibSymbol[];
  /** KiCad's paste anchor: the leftmost item position (SCH_SELECTION::GetTopLeftItem). */
  refPoint: Vec2;
}

/** Set (or insert) the `(uuid ...)` child of an item node. */
function withUuid(node: SList, uuid: string): SList {
  const items = node.items.filter((it) => !(isList(it) && head(it) === 'uuid'));
  // KiCad writes uuid before properties/pts-dependent children; keep it simple and
  // insert after the last of at/mirror/unit/attribute nodes, before property/pin.
  let insertAt = items.length;
  for (let i = 1; i < items.length; i++) {
    const it = items[i]!;
    if (isList(it) && (head(it) === 'property' || head(it) === 'pin' || head(it) === 'instances')) {
      insertAt = i;
      break;
    }
  }
  items.splice(insertAt, 0, list(atom('uuid'), str(uuid)));
  return { kind: 'list', items };
}

/** New UUIDs for a pasted symbol node: the symbol itself, and each `(pin ...)` child. */
function symbolWithFreshUuids(node: SList): SList {
  let n = withUuid(node, newUuid());
  n = {
    kind: 'list',
    items: n.items
      // The clipboard's (instances ...) paths belong to the source project; KiCad
      // prunes them on paste (PruneOrphanedSymbolInstances).
      .filter((it) => !(isList(it) && head(it) === 'instances'))
      .map((it) => (isList(it) && head(it) === 'pin' ? withUuid(it, newUuid()) : it)),
  };
  return n;
}

/** `R12` -> { prefix: 'R', n: 12 }; `R?` / `R` -> { prefix: 'R' }. */
function splitRef(ref: string): { prefix: string; n?: number } {
  const m = /^(.*?)(\d+)$/.exec(ref);
  if (m) return { prefix: m[1]!, n: Number(m[2]) };
  return { prefix: ref.replace(/\?+$/, '') };
}

/**
 * PASTE_MODE::UNIQUE_ANNOTATIONS (ReannotateDuplicates): keep a pasted reference
 * if it is free; a duplicate or un-annotated one gets the first free number for
 * its prefix. Returns a new source node + fields when the reference changed.
 */
function reannotate(sym: SchSymbol, taken: Set<string>): SchSymbol {
  const refField = sym.fields.find((f) => f.key === 'Reference');
  if (!refField) return sym;
  const ref = refField.value;
  const unannotated = ref.endsWith('?');
  if (!unannotated && !taken.has(ref)) {
    taken.add(ref);
    return sym;
  }
  const { prefix } = splitRef(ref);
  if (prefix === '' || prefix === '#') { taken.add(ref); return sym; }
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  const newRef = `${prefix}${n}`;
  taken.add(newRef);

  const fields = sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, newRef) : f));
  return { ...sym, fields };
}

function setFieldValue(f: SchField, value: string): SchField {
  const items = f.source.items.slice();
  items[2] = str(value);
  const source: SList = { kind: 'list', items };
  return { ...f, value, source };
}

/**
 * Parse clipboard text into a paste payload. Accepts KiCad's bare item sequence
 * (the clipboard format), a whole `(kicad_sch ...)` document, or — failing both —
 * returns the content as a text item exactly as KiCad's Paste() fallback does.
 */
export function parsePastedText(text: string, existing: Schematic): PastePayload | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Not schematic data: paste as a text object (KiCad's IO_ERROR fallback).
  const asTextItem = (): PastePayload => ({
    batch: { symbols: [], lines: [], junctions: [], noConnects: [], labels: [makeLabel('text', text, { x: 0, y: 0 })], sheets: [], busEntries: [], images: [], graphics: [] },
    libs: [],
    refPoint: { x: 0, y: 0 },
  });

  // KiCad's parser rejects anything that isn't an S-expression outright.
  if (!trimmed.startsWith('(')) return asTextItem();

  let doc: Schematic;
  try {
    const wrapped = trimmed.startsWith('(kicad_sch')
      ? trimmed
      : `(kicad_sch (version 20250114) (generator "ziroeda")\n${trimmed}\n)`;
    doc = readSchematic(parse(wrapped));
  } catch {
    return asTextItem();
  }

  // Fresh UUIDs for everything (clipboard KIIDs may already live in this sheet).
  const taken = new Set<string>();
  for (const s of existing.symbols) {
    const r = s.fields.find((f) => f.key === 'Reference');
    if (r) taken.add(r.value);
  }

  const symbols = doc.symbols.map((s) => {
    const source = symbolWithFreshUuids(s.source);
    const uuid = (childNamed(source, 'uuid')?.items[1] as { value: string }).value;
    // Re-read fields from the fresh source so field.source identity stays aligned.
    const withIds: SchSymbol = { ...s, uuid, source };
    return reannotate(withIds, taken);
  });
  const reuuid = <T extends { source: SList; uuid?: string }>(item: T): T => {
    const uuid = newUuid();
    return { ...item, uuid, source: withUuid(item.source, uuid) };
  };
  const lines = doc.lines.map(reuuid);
  const junctions = doc.junctions.map(reuuid);
  const noConnects = doc.noConnects.map(reuuid);
  const labels = doc.labels.map(reuuid);

  if (symbols.length + lines.length + junctions.length + noConnects.length + labels.length === 0) return null;

  // Only bring along lib definitions the target sheet doesn't already have.
  const have = new Set(existing.libSymbols.map((l) => l.libId));
  const libs = doc.libSymbols.filter((l) => !have.has(l.libId));

  // KiCad sets the move reference to the top-left item: smallest x, then y
  // (SCH_SELECTION::GetTopLeftItem), preferring connectable items.
  let refPoint: Vec2 | null = null;
  const consider = (p: Vec2): void => {
    if (!refPoint || p.x < refPoint.x || (p.x === refPoint.x && p.y < refPoint.y)) refPoint = p;
  };
  for (const s of symbols) consider(s.at);
  for (const l of lines) consider(l.start);
  for (const j of junctions) consider(j.at);
  for (const nc of noConnects) consider(nc.at);
  for (const l of labels) consider(l.at);

  return {
    batch: { symbols, lines, junctions, noConnects, labels, sheets: [], busEntries: [], images: [], graphics: [] },
    libs,
    refPoint: refPoint ?? { x: 0, y: 0 },
  };
}

/** Translate every pasted item by `delta` (fields move with their symbol). */
export function translatePayload(p: PastePayload, delta: Vec2): PastePayload {
  const mv = (pt: Vec2): Vec2 => ({ x: pt.x + delta.x, y: pt.y + delta.y });
  return {
    libs: p.libs,
    refPoint: mv(p.refPoint),
    batch: {
      symbols: p.batch.symbols.map((s) => ({
        ...s,
        at: mv(s.at),
        fields: s.fields.map((f) => (f.at ? { ...f, at: mv(f.at) } : f)),
      })),
      lines: p.batch.lines.map((l) => ({
        ...l,
        start: mv(l.start),
        end: mv(l.end),
        points: l.points?.map(mv),
      })),
      junctions: p.batch.junctions.map((j) => ({ ...j, at: mv(j.at) })),
      noConnects: p.batch.noConnects.map((nc) => ({ ...nc, at: mv(nc.at) })),
      labels: p.batch.labels.map((l) => ({ ...l, at: mv(l.at) })),
      sheets: [],
      busEntries: [],
      images: [],
      graphics: [],
    },
  };
}

/** The paste commit: add the items and any lib definitions they need, undoably. */
export function pasteItems(payload: PastePayload): EditCommand {
  const { batch, libs } = payload;
  return {
    label: 'Paste',
    apply(doc: Schematic): Schematic {
      const have = new Set(doc.libSymbols.map((l) => l.libId));
      const newLibs = libs.filter((l) => !have.has(l.libId));
      return {
        ...doc,
        libSymbols: newLibs.length ? [...doc.libSymbols, ...newLibs] : doc.libSymbols,
        symbols: [...doc.symbols, ...batch.symbols],
        lines: [...doc.lines, ...batch.lines],
        junctions: [...doc.junctions, ...batch.junctions],
        noConnects: [...doc.noConnects, ...batch.noConnects],
        labels: [...doc.labels, ...batch.labels],
      };
    },
    invert(before: Schematic): EditCommand {
      const had = new Set(before.libSymbols.map((l) => l.libId));
      const addedLibs = libs.filter((l) => !had.has(l.libId)).map((l) => l.libId);
      const ids = new Set<string>();
      batch.symbols.forEach((s) => ids.add(s.uuid!));
      batch.lines.forEach((l) => ids.add(l.uuid!));
      batch.junctions.forEach((j) => ids.add(j.uuid!));
      batch.noConnects.forEach((nc) => ids.add(nc.uuid!));
      batch.labels.forEach((l) => ids.add(l.uuid!));
      return unpasteItems(payload, ids, addedLibs);
    },
  };
}

function unpasteItems(payload: PastePayload, ids: ReadonlySet<string>, libIds: readonly string[]): EditCommand {
  return {
    label: 'Paste',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        libSymbols: doc.libSymbols.filter((l) => !libIds.includes(l.libId)),
        symbols: doc.symbols.filter((s) => !ids.has(s.uuid ?? '')),
        lines: doc.lines.filter((l) => !ids.has(l.uuid ?? '')),
        junctions: doc.junctions.filter((j) => !ids.has(j.uuid ?? '')),
        noConnects: doc.noConnects.filter((nc) => !ids.has(nc.uuid ?? '')),
        labels: doc.labels.filter((l) => !ids.has(l.uuid ?? '')),
      };
    },
    invert(): EditCommand {
      return pasteItems(payload);
    },
  };
}
