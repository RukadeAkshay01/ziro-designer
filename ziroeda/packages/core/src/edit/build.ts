/**
 * Factories for newly-created items.
 *
 * Every model item carries a `source` S-expression node (the lossless backing
 * store). Items created in the editor therefore get a freshly-built node here, so
 * they serialize correctly later and stay consistent with parsed items. Numbers
 * are written in millimetres, matching the file format.
 */

import { list, atom, str, type SList } from '../sexpr/types.js';
import { iuToMM } from '../units.js';
import type { SchLine, SchJunction, SchSymbol, SchField, LibSymbol, Vec2 } from '../model/types.js';

/** A UUID for a new item. Falls back to a random hex string off-platform. */
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Format an internal-unit coordinate as KiCad-style millimetres text. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (p: Vec2): SList => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));

/** Build the `(wire ...)` node for a new wire segment. */
export function buildWireNode(start: Vec2, end: Vec2, uuid: string): SList {
  return list(
    atom('wire'),
    list(atom('pts'), xy(start), xy(end)),
    list(atom('stroke'), list(atom('width'), atom('0')), list(atom('type'), atom('default'))),
    list(atom('uuid'), str(uuid)),
  );
}

/** Build the `(junction ...)` node for a new junction. */
export function buildJunctionNode(at: Vec2, uuid: string): SList {
  return list(
    atom('junction'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('diameter'), atom('0')),
    list(atom('color'), atom('0'), atom('0'), atom('0'), atom('0')),
    list(atom('uuid'), str(uuid)),
  );
}

/** Create a new wire model item (with its backing AST node). */
export function makeWire(start: Vec2, end: Vec2): SchLine {
  const uuid = newUuid();
  return {
    kind: 'wire',
    start,
    end,
    stroke: { width: 0, type: 'default' },
    uuid,
    source: buildWireNode(start, end, uuid),
  };
}

/** Create a new junction model item (with its backing AST node). */
export function makeJunction(at: Vec2): SchJunction {
  const uuid = newUuid();
  return { at, diameter: 0, uuid, source: buildJunctionNode(at, uuid) };
}

const DEFAULT_FONT = (): SList => list(atom('effects'), list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27'))));

function buildPropertyNode(key: string, value: string, at: Vec2, angle: number): SList {
  return list(
    atom('property'), str(key), str(value),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(angle))),
    DEFAULT_FONT(),
  );
}

function buildSymbolNode(libId: string, at: Vec2, uuid: string, fields: SchField[]): SList {
  return list(
    atom('symbol'),
    list(atom('lib_id'), str(libId)),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom('0')),
    list(atom('unit'), atom('1')),
    list(atom('exclude_from_sim'), atom('no')),
    list(atom('in_bom'), atom('yes')),
    list(atom('on_board'), atom('yes')),
    list(atom('dnp'), atom('no')),
    list(atom('uuid'), str(uuid)),
    ...fields.map((f) => f.source),
  );
}

/**
 * Create a newly-placed symbol from a library definition at `at`. Reference is
 * the library's reference prefix with a `?` (pre-annotation), as in KiCad; the
 * visible Reference/Value fields are offset using the library's field templates.
 */
export function makeSymbol(lib: LibSymbol, at: Vec2): SchSymbol {
  const uuid = newUuid();
  const refProp = lib.properties.find((p) => p.key === 'Reference');
  const valProp = lib.properties.find((p) => p.key === 'Value');
  const prefix = refProp?.value ?? 'U';
  const reference = /\?$/.test(prefix) ? prefix : `${prefix}?`;
  const value = valProp?.value ?? lib.libId.split(':').pop() ?? '';

  const mkField = (key: string, val: string, tmpl: SchField | undefined): SchField => {
    const fat: Vec2 = tmpl?.at ? { x: at.x + tmpl.at.x, y: at.y + tmpl.at.y } : at;
    const angle = tmpl?.angle ?? 0;
    return { key, value: val, at: fat, angle, effects: { hidden: false, fontSize: [12700, 12700] }, source: buildPropertyNode(key, val, fat, angle) };
  };

  const fields: SchField[] = [mkField('Reference', reference, refProp), mkField('Value', value, valProp)];
  return {
    libId: lib.libId, at, angle: 0, unit: 1, bodyStyle: 1,
    inBom: true, onBoard: true, dnp: false, uuid, fields,
    source: buildSymbolNode(lib.libId, at, uuid, fields),
  };
}
