/**
 * Add / delete commands, and junction auto-creation.
 *
 * Add and delete are exact inverses of each other, so undo/redo is lossless.
 * Items are identified by their stable `refId` (uuid-based for created items).
 * Junction auto-creation follows KiCad: a junction belongs where wires form a
 * tee or a 3+-way meeting, not where two wires merely cross or simply continue.
 */

import type {
  Schematic,
  SchSymbol,
  SchLine,
  SchJunction,
  SchNoConnect,
  SchLabel,
  SchSheet,
  SchBusEntry,
  SchImage,
  SchTextBox,
  SchTable,
  LibGraphic,
  LibSymbol,
  Vec2,
} from '../types.js';
import type { Orientation } from '@ziroeda/common/src/transform.js';
import { refId } from './hittest.js';
import { makeSymbol } from './build.js';
import type { EditCommand } from './command.js';

/** A batch of items to add or restore, grouped by kind. */
export interface ItemsBatch {
  symbols?: SchSymbol[];
  lines?: SchLine[];
  junctions?: SchJunction[];
  noConnects?: SchNoConnect[];
  labels?: SchLabel[];
  sheets?: SchSheet[];
  busEntries?: SchBusEntry[];
  images?: SchImage[];
  /** Sheet-level graphic shapes (rectangle/circle/arc/polyline on the notes layer). */
  graphics?: LibGraphic[];
  textBoxes?: SchTextBox[];
  tables?: SchTable[];
}

function batchIds(b: ItemsBatch): Set<string> {
  const ids = new Set<string>();
  b.symbols?.forEach((s, i) => ids.add(refId('symbol', s.uuid, i)));
  b.lines?.forEach((l, i) => ids.add(refId('line', l.uuid, i)));
  b.junctions?.forEach((j, i) => ids.add(refId('junction', j.uuid, i)));
  b.noConnects?.forEach((nc, i) => ids.add(refId('noconnect', nc.uuid, i)));
  b.labels?.forEach((l, i) => ids.add(refId('label', l.uuid, i)));
  b.sheets?.forEach((s, i) => ids.add(refId('sheet', s.uuid, i)));
  b.busEntries?.forEach((be, i) => ids.add(refId('busentry', be.uuid, i)));
  b.images?.forEach((im, i) => ids.add(refId('image', im.uuid, i)));
  b.graphics?.forEach((_, i) => ids.add(refId('graphic', undefined, i)));
  b.textBoxes?.forEach((tb, i) => ids.add(refId('textbox', tb.uuid, i)));
  b.tables?.forEach((t, i) => ids.add(refId('table', t.uuid, i)));
  return ids;
}

function collectByIds(doc: Schematic, ids: ReadonlySet<string>): ItemsBatch {
  return {
    symbols: doc.symbols.filter((s, i) => ids.has(refId('symbol', s.uuid, i))),
    lines: doc.lines.filter((l, i) => ids.has(refId('line', l.uuid, i))),
    junctions: doc.junctions.filter((j, i) => ids.has(refId('junction', j.uuid, i))),
    noConnects: doc.noConnects.filter((nc, i) => ids.has(refId('noconnect', nc.uuid, i))),
    labels: doc.labels.filter((l, i) => ids.has(refId('label', l.uuid, i))),
    sheets: doc.sheets.filter((s, i) => ids.has(refId('sheet', s.uuid, i))),
    busEntries: doc.busEntries.filter((be, i) => ids.has(refId('busentry', be.uuid, i))),
    images: doc.images.filter((im, i) => ids.has(refId('image', im.uuid, i))),
    graphics: doc.graphics.filter((_, i) => ids.has(refId('graphic', undefined, i))),
    textBoxes: doc.textBoxes.filter((tb, i) => ids.has(refId('textbox', tb.uuid, i))),
    tables: doc.tables.filter((t, i) => ids.has(refId('table', t.uuid, i))),
  };
}

/** Add a batch of items. Inverse: delete exactly those items. */
export function addItems(batch: ItemsBatch): EditCommand {
  return {
    label: 'Add',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: batch.symbols?.length ? [...doc.symbols, ...batch.symbols] : doc.symbols,
        lines: batch.lines?.length ? [...doc.lines, ...batch.lines] : doc.lines,
        junctions: batch.junctions?.length ? [...doc.junctions, ...batch.junctions] : doc.junctions,
        noConnects: batch.noConnects?.length
          ? [...doc.noConnects, ...batch.noConnects]
          : doc.noConnects,
        labels: batch.labels?.length ? [...doc.labels, ...batch.labels] : doc.labels,
        sheets: batch.sheets?.length ? [...doc.sheets, ...batch.sheets] : doc.sheets,
        busEntries: batch.busEntries?.length
          ? [...doc.busEntries, ...batch.busEntries]
          : doc.busEntries,
        images: batch.images?.length ? [...doc.images, ...batch.images] : doc.images,
        graphics: batch.graphics?.length ? [...doc.graphics, ...batch.graphics] : doc.graphics,
        textBoxes: batch.textBoxes?.length ? [...doc.textBoxes, ...batch.textBoxes] : doc.textBoxes,
        tables: batch.tables?.length ? [...doc.tables, ...batch.tables] : doc.tables,
      };
    },
    invert(): EditCommand {
      return deleteByIds(batchIds(batch));
    },
  };
}

/** Delete every item whose id is in `ids`. Inverse: re-add those items. */
export function deleteByIds(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Delete',
    apply(doc: Schematic): Schematic {
      if (ids.size === 0) return doc;
      return {
        ...doc,
        symbols: doc.symbols.filter((s, i) => !ids.has(refId('symbol', s.uuid, i))),
        lines: doc.lines.filter((l, i) => !ids.has(refId('line', l.uuid, i))),
        junctions: doc.junctions.filter((j, i) => !ids.has(refId('junction', j.uuid, i))),
        noConnects: doc.noConnects.filter((nc, i) => !ids.has(refId('noconnect', nc.uuid, i))),
        labels: doc.labels.filter((l, i) => !ids.has(refId('label', l.uuid, i))),
        sheets: doc.sheets.filter((s, i) => !ids.has(refId('sheet', s.uuid, i))),
        busEntries: doc.busEntries.filter((be, i) => !ids.has(refId('busentry', be.uuid, i))),
        images: doc.images.filter((im, i) => !ids.has(refId('image', im.uuid, i))),
        graphics: doc.graphics.filter((_, i) => !ids.has(refId('graphic', undefined, i))),
        textBoxes: doc.textBoxes.filter((tb, i) => !ids.has(refId('textbox', tb.uuid, i))),
        tables: doc.tables.filter((t, i) => !ids.has(refId('table', t.uuid, i))),
      };
    },
    invert(before: Schematic): EditCommand {
      return addItems(collectByIds(before, ids));
    },
  };
}

/**
 * Place a symbol from a library definition at `at`. Adds the placed instance and,
 * if not already present, embeds the library definition in the schematic's
 * `lib_symbols` cache (as KiCad does). Undo removes the instance and the def if it
 * was newly added.
 */
export function placeSymbol(lib: LibSymbol, at: Vec2, orient?: Orientation): EditCommand {
  return placeCmd(lib, makeSymbol(lib, at, orient));
}

function placeCmd(lib: LibSymbol, sym: SchSymbol): EditCommand {
  return {
    label: 'Place symbol',
    apply(doc: Schematic): Schematic {
      const hasLib = doc.libSymbols.some((l) => l.libId === lib.libId);
      return {
        ...doc,
        libSymbols: hasLib ? doc.libSymbols : [...doc.libSymbols, lib],
        symbols: [...doc.symbols, sym],
      };
    },
    invert(before: Schematic): EditCommand {
      const hadLib = before.libSymbols.some((l) => l.libId === lib.libId);
      return removeSymbolCmd(lib, sym, hadLib);
    },
  };
}

function removeSymbolCmd(lib: LibSymbol, sym: SchSymbol, keepLib: boolean): EditCommand {
  return {
    label: 'Delete symbol',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.filter((s) => s.uuid !== sym.uuid),
        libSymbols: keepLib ? doc.libSymbols : doc.libSymbols.filter((l) => l.libId !== lib.libId),
      };
    },
    invert(): EditCommand {
      return placeCmd(lib, sym);
    },
  };
}

/** Replace the sheet at `index` with `next` (e.g. after adding a sheet pin). */
export function replaceSheet(index: number, next: SchSheet): EditCommand {
  return {
    label: 'Edit Sheet',
    apply(doc: Schematic): Schematic {
      return { ...doc, sheets: doc.sheets.map((s, i) => (i === index ? next : s)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceSheet(index, before.sheets[index]!);
    },
  };
}

/** Replace the text box at `index` with `next` (e.g. after editing its text). */
export function replaceTextBox(index: number, next: SchTextBox): EditCommand {
  return {
    label: 'Edit Text Box',
    apply(doc: Schematic): Schematic {
      return { ...doc, textBoxes: doc.textBoxes.map((t, i) => (i === index ? next : t)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceTextBox(index, before.textBoxes[index]!);
    },
  };
}

/** Replace the table at `index` with `next` (e.g. after editing a cell). */
export function replaceTable(index: number, next: SchTable): EditCommand {
  return {
    label: 'Edit Table',
    apply(doc: Schematic): Schematic {
      return { ...doc, tables: doc.tables.map((t, i) => (i === index ? next : t)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceTable(index, before.tables[index]!);
    },
  };
}

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** Is `p` strictly between the endpoints of segment a–b (on the segment, not at an end)? */
function onSegmentInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (eq(p, a) || eq(p, b)) return false;
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false; // not collinear
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 0 && dot < len2;
}

/**
 * Whether a junction dot belongs at `p`, given the wires present. True when three
 * or more wire ends meet there, or a wire end lands on another wire's interior
 * (a tee). Returns false if a junction already exists at `p`.
 */
export function needsJunction(sch: Schematic, p: Vec2): boolean {
  if (sch.junctions.some((j) => eq(j.at, p))) return false;
  let ends = 0;
  let interiors = 0;
  for (const l of sch.lines) {
    if (l.kind !== 'wire') continue;
    if (eq(l.start, p)) ends++;
    if (eq(l.end, p)) ends++;
    if (onSegmentInterior(p, l.start, l.end)) interiors++;
  }
  return ends >= 3 || (interiors >= 1 && ends >= 1);
}
