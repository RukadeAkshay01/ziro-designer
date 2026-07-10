/**
 * Factories for schematic graphic items, bus entries, hierarchical sheets and
 * images — the right-toolbar drawing tools (SCH_ACTIONS draw/place actions).
 *
 * Like build.ts, every item gets a freshly-built `source` S-expression node so
 * it serializes losslessly. Sheet-level graphics live in +Y-down sheet space
 * (no coordinate inversion, unlike symbol-library graphics).
 */

import { list, atom, str, type SList, type SNode } from '../sexpr/types.js';
import { iuToMM, mmToIU } from '../units.js';
import { newUuid } from './build.js';
import type { LibGraphic, SchBusEntry, SchImage, SchSheet, SheetPin, SchField, Stroke, Fill, LabelShape, Vec2 } from '../model/types.js';

function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (p: Vec2): SList => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));

/** A default `(stroke (width 0) (type default))` node. */
function strokeNode(stroke?: Stroke): SList {
  return list(atom('stroke'),
    list(atom('width'), atom(mm(stroke?.width ?? 0))),
    list(atom('type'), atom(stroke?.type ?? 'default')));
}

/** A `(fill (type ..))` node. */
function fillNode(fill?: Fill): SList {
  return list(atom('fill'), list(atom('type'), atom(fill?.type ?? 'none')));
}

// ----- graphic shapes (SCH_SHAPE on LAYER_NOTES) --------------------------------

export function makeRectangle(start: Vec2, end: Vec2, stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newUuid();
  const source = list(atom('rectangle'),
    list(atom('start'), atom(mm(start.x)), atom(mm(start.y))),
    list(atom('end'), atom(mm(end.x)), atom(mm(end.y))),
    strokeNode(stroke), fillNode(fill), list(atom('uuid'), str(uuid)));
  const g: LibGraphic = { kind: 'rectangle', start, end, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makeCircle(center: Vec2, radius: number, stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newUuid();
  const source = list(atom('circle'),
    list(atom('center'), atom(mm(center.x)), atom(mm(center.y))),
    list(atom('radius'), atom(mm(radius))),
    strokeNode(stroke), fillNode(fill), list(atom('uuid'), str(uuid)));
  const g: LibGraphic = { kind: 'circle', center, radius, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makeArc(start: Vec2, mid: Vec2, end: Vec2, stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newUuid();
  const source = list(atom('arc'),
    list(atom('start'), atom(mm(start.x)), atom(mm(start.y))),
    list(atom('mid'), atom(mm(mid.x)), atom(mm(mid.y))),
    list(atom('end'), atom(mm(end.x)), atom(mm(end.y))),
    strokeNode(stroke), fillNode(fill), list(atom('uuid'), str(uuid)));
  const g: LibGraphic = { kind: 'arc', start, mid, end, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makePolyline(points: readonly Vec2[], stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newUuid();
  const source = list(atom('polyline'),
    { kind: 'list', items: [atom('pts'), ...points.map(xy)] },
    strokeNode(stroke), fillNode(fill), list(atom('uuid'), str(uuid)));
  const g: LibGraphic = { kind: 'polyline', points: [...points], source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

// ----- bus entry (SCH_BUS_WIRE_ENTRY) -------------------------------------------

/** DEFAULT_SCH_ENTRY_SIZE = 100 mils (default_values.h). */
export const DEFAULT_ENTRY_SIZE = mmToIU(2.54);

/** Create a wire-to-bus entry — the 45° stub from `at` to `at + size`. */
export function makeBusEntry(at: Vec2, size: Vec2 = { x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE }): SchBusEntry {
  const uuid = newUuid();
  const source = list(atom('bus_entry'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('size'), atom(mm(size.x)), atom(mm(size.y))),
    strokeNode(), list(atom('uuid'), str(uuid)));
  return { at, size, stroke: { width: 0, type: 'default' }, uuid, source };
}

// ----- hierarchical sheet (SCH_SHEET) -------------------------------------------

function sheetProperty(key: string, value: string, at: Vec2, hide: boolean): SList {
  const effects: SNode[] = [atom('effects'), list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27')))];
  if (hide) effects.push(list(atom('hide'), atom('yes')));
  return list(atom('property'), str(key), str(value),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom('0')),
    { kind: 'list', items: effects });
}

/** Create a hierarchical sub-sheet with Sheetname/Sheetfile fields (SCH_SHEET). */
export function makeSheet(at: Vec2, size: { w: number; h: number }, name: string, file: string): SchSheet {
  const uuid = newUuid();
  const nameField: SchField = {
    key: 'Sheetname', value: name, at: { x: at.x, y: at.y - mmToIU(0.7) }, angle: 0,
    effects: { hidden: false, fontSize: [12700, 12700] }, source: sheetProperty('Sheetname', name, { x: at.x, y: at.y - mmToIU(0.7) }, false),
  };
  const fileField: SchField = {
    key: 'Sheetfile', value: file, at: { x: at.x, y: at.y + size.h + mmToIU(0.7) }, angle: 0,
    effects: { hidden: false, fontSize: [12700, 12700] }, source: sheetProperty('Sheetfile', file, { x: at.x, y: at.y + size.h + mmToIU(0.7) }, false),
  };
  const source = list(atom('sheet'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('size'), atom(mm(size.w)), atom(mm(size.h))),
    list(atom('fields_autoplaced'), atom('yes')),
    list(atom('stroke'), list(atom('width'), atom('0.1524')), list(atom('type'), atom('solid'))),
    list(atom('fill'), list(atom('color'), atom('0'), atom('0'), atom('0'), atom('0.0'))),
    list(atom('uuid'), str(uuid)),
    nameField.source, fileField.source);
  return {
    at, size, stroke: { width: mmToIU(0.1524), type: 'solid' },
    fields: [nameField, fileField], pins: [], uuid, source,
  };
}

/** Side encoding for a sheet pin: 0 right, 90 top, 180 left, 270 bottom. */
export type SheetSide = 0 | 90 | 180 | 270;

/**
 * Add a hierarchical sheet pin on a sheet's border, returning a new sheet with
 * the pin in both the model and the source (so writeSheet keeps them aligned).
 */
export function addSheetPin(sheet: SchSheet, name: string, at: Vec2, side: SheetSide, shape: LabelShape = 'passive'): SchSheet {
  const uuid = newUuid();
  const pinSource = list(atom('pin'), str(name), atom(shape),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(side))),
    list(atom('effects'), list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27')))),
    list(atom('uuid'), str(uuid)));
  const pin: SheetPin = {
    name, shape, at, angle: side,
    effects: { hidden: false, fontSize: [12700, 12700] }, uuid, source: pinSource,
  };
  // Insert the pin source before the trailing structural nodes (after the last
  // existing pin/property); appending at the end keeps writeSheet's pin order.
  const items = [...sheet.source.items, pinSource];
  return { ...sheet, pins: [...sheet.pins, pin], source: { kind: 'list', items } };
}

// ----- image (SCH_BITMAP) --------------------------------------------------------

/** Create an embedded bitmap at `at` from raw base64 PNG data (SCH_BITMAP). */
export function makeImage(at: Vec2, base64: string, scale = 1): SchImage {
  const uuid = newUuid();
  // KiCad wraps the base64 payload; split into ~76-char chunks as separate strings.
  const chunks: SNode[] = [atom('data')];
  for (let i = 0; i < base64.length; i += 76) chunks.push(str(base64.slice(i, i + 76)));
  const source = list(atom('image'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('scale'), atom(String(scale))),
    list(atom('uuid'), str(uuid)),
    { kind: 'list', items: chunks });
  return { at, scale, data: base64, uuid, source };
}
