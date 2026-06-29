/**
 * Reader: S-expression AST -> typed Schematic model.
 *
 * This is the faithful counterpart to KiCad's `SCH_IO_KICAD_SEXPR_PARSER`. It reads
 * the same fields KiCad reads, converts millimetres to integer internal units, and
 * keeps each item's source `SList` for lossless round-tripping. It tolerates unknown
 * children (they stay in `source`) so newer/foreign fields never cause data loss.
 */

import { head, isList, type SList } from '../sexpr/types.js';
import { mmToIU } from '../units.js';
import {
  arg,
  args,
  boolField,
  childNamed,
  childrenNamed,
  numArg,
  stringField,
} from '../sexpr/query.js';
import type {
  Fill,
  LabelKind,
  LibGraphic,
  LibPin,
  LibSymbol,
  LibSymbolUnit,
  LineKind,
  Schematic,
  SchField,
  SchJunction,
  SchLabel,
  SchLine,
  SchSymbol,
  Stroke,
  TextEffects,
  TitleBlock,
  Vec2,
} from './types.js';

/** Read two positional numeric args (millimetres) starting at `from` as an IU point. */
function readPoint(node: SList, from: number): Vec2 {
  const x = numArg(node, from) ?? 0;
  const y = numArg(node, from + 1) ?? 0;
  return { x: mmToIU(x), y: mmToIU(y) };
}

/** Read an `(at x y [angle])` child: position in IU plus angle in degrees. */
function readAt(node: SList): { at: Vec2; angle: number } {
  const at = childNamed(node, 'at');
  if (!at) return { at: { x: 0, y: 0 }, angle: 0 };
  return { at: readPoint(at, 0), angle: numArg(at, 2) ?? 0 };
}

function readStroke(node: SList): Stroke | undefined {
  const s = childNamed(node, 'stroke');
  if (!s) return undefined;
  const width = childNamed(s, 'width');
  return {
    width: width ? mmToIU(numArg(width, 0) ?? 0) : 0,
    type: stringField(s, 'type') ?? 'default',
  };
}

function readFill(node: SList): Fill | undefined {
  const f = childNamed(node, 'fill');
  if (!f) return undefined;
  return { type: stringField(f, 'type') ?? 'none' };
}

function readEffects(node: SList): TextEffects | undefined {
  const e = childNamed(node, 'effects');
  if (!e) return undefined;
  const font = childNamed(e, 'font');
  const size = font ? childNamed(font, 'size') : undefined;
  const justify = childNamed(e, 'justify');
  const effects: { -readonly [K in keyof TextEffects]: TextEffects[K] } = {
    hidden: boolField(e, 'hide', false),
  };
  if (size) effects.fontSize = [mmToIU(numArg(size, 0) ?? 0), mmToIU(numArg(size, 1) ?? 0)];
  if (justify) effects.justify = args(justify);
  return effects;
}

function readField(node: SList): SchField {
  const { at, angle } = readAt(node);
  const field: { -readonly [K in keyof SchField]: SchField[K] } = {
    key: arg(node, 0) ?? '',
    value: arg(node, 1) ?? '',
    angle,
    source: node,
  };
  if (childNamed(node, 'at')) field.at = at;
  const effects = readEffects(node);
  if (effects) field.effects = effects;
  return field;
}

// ----- library symbols ------------------------------------------------------

/** Split a unit name like `Conn_01x02_1_1` into its trailing unit and body-style numbers. */
function parseUnitName(name: string): { unit: number; bodyStyle: number } {
  const m = /_(\d+)_(\d+)$/.exec(name);
  if (!m) return { unit: 0, bodyStyle: 0 };
  return { unit: Number(m[1]), bodyStyle: Number(m[2]) };
}

function readLibPin(node: SList): LibPin {
  const { at, angle } = readAt(node);
  // hide can be a bare `hide` token (legacy) or `(hide yes)`.
  const hideChild = childNamed(node, 'hide');
  const bareHide = node.items.some((it) => it.kind === 'atom' && it.value === 'hide');
  return {
    electricalType: arg(node, 0) ?? 'unspecified',
    shape: arg(node, 1) ?? 'line',
    at,
    angle,
    length: mmToIU(numArg(childNamed(node, 'length') ?? node, 0) ?? 0),
    name: stringField(node, 'name') ?? '',
    number: stringField(node, 'number') ?? '',
    hidden: bareHide || (hideChild ? boolField(node, 'hide', false) : false),
    source: node,
  };
}

function readGraphic(node: SList): LibGraphic | undefined {
  const kind = head(node);
  const stroke = readStroke(node);
  const fill = readFill(node);
  const withSF = <T extends object>(g: T): T & { stroke?: Stroke; fill?: Fill } => {
    const out = { ...g } as T & { stroke?: Stroke; fill?: Fill };
    if (stroke) out.stroke = stroke;
    if (fill) out.fill = fill;
    return out;
  };

  switch (kind) {
    case 'rectangle': {
      const start = childNamed(node, 'start');
      const end = childNamed(node, 'end');
      if (!start || !end) return undefined;
      return withSF({ kind: 'rectangle' as const, start: readPoint(start, 0), end: readPoint(end, 0), source: node });
    }
    case 'circle': {
      const center = childNamed(node, 'center');
      const radius = childNamed(node, 'radius');
      if (!center) return undefined;
      return withSF({ kind: 'circle' as const, center: readPoint(center, 0), radius: mmToIU(radius ? (numArg(radius, 0) ?? 0) : 0), source: node });
    }
    case 'arc': {
      const start = childNamed(node, 'start');
      const mid = childNamed(node, 'mid');
      const end = childNamed(node, 'end');
      if (!start || !mid || !end) return undefined;
      return withSF({ kind: 'arc' as const, start: readPoint(start, 0), mid: readPoint(mid, 0), end: readPoint(end, 0), source: node });
    }
    case 'polyline': {
      const pts = childNamed(node, 'pts');
      const points = pts ? childrenNamed(pts, 'xy').map((xy) => readPoint(xy, 0)) : [];
      return withSF({ kind: 'polyline' as const, points, source: node });
    }
    case 'text': {
      const { at, angle } = readAt(node);
      const effects = readEffects(node);
      const g: LibGraphic = { kind: 'text', text: arg(node, 0) ?? '', at, angle, source: node };
      return effects ? { ...g, effects } : g;
    }
    default:
      return undefined; // unknown body element; preserved via the parent's source
  }
}

function readLibSymbolUnit(node: SList): LibSymbolUnit {
  const name = arg(node, 0) ?? '';
  const { unit, bodyStyle } = parseUnitName(name);
  const graphics: LibGraphic[] = [];
  const pins: LibPin[] = [];
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'pin') pins.push(readLibPin(item));
    else {
      const g = readGraphic(item);
      if (g) graphics.push(g);
    }
  }
  return { name, unit, bodyStyle, graphics, pins, source: node };
}

function readLibSymbol(node: SList): LibSymbol {
  const units: LibSymbolUnit[] = [];
  const properties: SchField[] = [];
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'symbol') units.push(readLibSymbolUnit(item));
    else if (head(item) === 'property') properties.push(readField(item));
  }
  return {
    libId: arg(node, 0) ?? '',
    isPower: childNamed(node, 'power') !== undefined,
    properties,
    units,
    source: node,
  };
}

// ----- instance items -------------------------------------------------------

function readSymbol(node: SList): SchSymbol {
  const { at, angle } = readAt(node);
  const fields = childrenNamed(node, 'property').map(readField);
  const mirrorChild = childNamed(node, 'mirror');
  const mirror = mirrorChild ? arg(mirrorChild, 0) : undefined;
  const sym: { -readonly [K in keyof SchSymbol]: SchSymbol[K] } = {
    libId: stringField(node, 'lib_id') ?? '',
    at,
    angle,
    unit: numArg(childNamed(node, 'unit') ?? node, 0) ?? 1,
    bodyStyle: numArg(childNamed(node, 'body_style') ?? node, 0) ?? 1,
    inBom: boolField(node, 'in_bom', true),
    onBoard: boolField(node, 'on_board', true),
    dnp: boolField(node, 'dnp', false),
    fields,
    source: node,
  };
  if (mirror === 'x' || mirror === 'y') sym.mirror = mirror;
  const uuid = stringField(node, 'uuid');
  if (uuid) sym.uuid = uuid;
  return sym;
}

function readLine(node: SList, kind: LineKind): SchLine {
  const pts = childNamed(node, 'pts');
  const xy = pts ? childrenNamed(pts, 'xy') : [];
  const start = xy[0] ? readPoint(xy[0], 0) : { x: 0, y: 0 };
  const end = xy[1] ? readPoint(xy[1], 0) : start;
  const line: { -readonly [K in keyof SchLine]: SchLine[K] } = { kind, start, end, source: node };
  const stroke = readStroke(node);
  if (stroke) line.stroke = stroke;
  const uuid = stringField(node, 'uuid');
  if (uuid) line.uuid = uuid;
  return line;
}

function readJunction(node: SList): SchJunction {
  const { at } = readAt(node);
  const j: { -readonly [K in keyof SchJunction]: SchJunction[K] } = {
    at,
    diameter: mmToIU(numArg(childNamed(node, 'diameter') ?? node, 0) ?? 0),
    source: node,
  };
  const uuid = stringField(node, 'uuid');
  if (uuid) j.uuid = uuid;
  return j;
}

function readLabel(node: SList, kind: LabelKind): SchLabel {
  const { at, angle } = readAt(node);
  const label: { -readonly [K in keyof SchLabel]: SchLabel[K] } = {
    kind,
    text: arg(node, 0) ?? '',
    at,
    angle,
    source: node,
  };
  const effects = readEffects(node);
  if (effects) label.effects = effects;
  const uuid = stringField(node, 'uuid');
  if (uuid) label.uuid = uuid;
  return label;
}

function readTitleBlock(node: SList): TitleBlock {
  const tb: { -readonly [K in keyof TitleBlock]: TitleBlock[K] } = { source: node };
  const title = stringField(node, 'title');
  const date = stringField(node, 'date');
  const rev = stringField(node, 'rev');
  const company = stringField(node, 'company');
  if (title !== undefined) tb.title = title;
  if (date !== undefined) tb.date = date;
  if (rev !== undefined) tb.rev = rev;
  if (company !== undefined) tb.company = company;
  return tb;
}

const LABEL_KINDS: Record<string, LabelKind> = {
  label: 'label',
  global_label: 'global_label',
  hierarchical_label: 'hierarchical_label',
  text: 'text',
};

const LINE_KINDS: Record<string, LineKind> = {
  wire: 'wire',
  bus: 'bus',
  polyline: 'polyline',
};

/** Build a typed Schematic from a parsed `(kicad_sch ...)` root list. */
export function readSchematic(root: SList): Schematic {
  if (head(root) !== 'kicad_sch') {
    throw new Error(`Expected a (kicad_sch ...) root, got (${head(root) ?? '?'} ...)`);
  }

  const libSymbols: LibSymbol[] = [];
  const symbols: SchSymbol[] = [];
  const lines: SchLine[] = [];
  const junctions: SchJunction[] = [];
  const labels: SchLabel[] = [];

  const libSymbolsNode = childNamed(root, 'lib_symbols');
  if (libSymbolsNode) {
    for (const sym of childrenNamed(libSymbolsNode, 'symbol')) libSymbols.push(readLibSymbol(sym));
  }

  for (const item of root.items) {
    if (!isList(item)) continue;
    const name = head(item);
    if (name === undefined) continue;

    if (name === 'symbol') symbols.push(readSymbol(item));
    else if (LINE_KINDS[name]) lines.push(readLine(item, LINE_KINDS[name]!));
    else if (name === 'junction') junctions.push(readJunction(item));
    else if (LABEL_KINDS[name]) labels.push(readLabel(item, LABEL_KINDS[name]!));
  }

  const sch: { -readonly [K in keyof Schematic]: Schematic[K] } = {
    version: numArg(childNamed(root, 'version') ?? root, 0) ?? 0,
    libSymbols,
    symbols,
    lines,
    junctions,
    labels,
    source: root,
  };
  const generator = stringField(root, 'generator');
  const generatorVersion = stringField(root, 'generator_version');
  const uuid = stringField(root, 'uuid');
  const paper = stringField(root, 'paper');
  const titleBlockNode = childNamed(root, 'title_block');
  if (generator !== undefined) sch.generator = generator;
  if (generatorVersion !== undefined) sch.generatorVersion = generatorVersion;
  if (uuid !== undefined) sch.uuid = uuid;
  if (paper !== undefined) sch.paper = paper;
  if (titleBlockNode) sch.titleBlock = readTitleBlock(titleBlockNode);

  return sch;
}
