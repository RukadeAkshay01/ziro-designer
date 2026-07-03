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
  numberField,
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
  SchNoConnect,
  SchSymbol,
  Stroke,
  TextEffects,
  TitleBlock,
  Vec2,
} from './types.js';

/**
 * Read two positional numeric args (millimetres) starting at `from` as an IU point.
 *
 * `invertY` negates Y, matching KiCad's parser: symbol *library* geometry is stored
 * with +Y up (`parseXY(true)`), while the schematic sheet uses +Y down. Inverting on
 * load puts symbol bodies/pins into the same +Y-down space as the rest of the model,
 * so pins meet their body and asymmetric symbols are oriented like KiCad.
 */
function readPoint(node: SList, from: number, invertY = false): Vec2 {
  const x = numArg(node, from) ?? 0;
  const y = numArg(node, from + 1) ?? 0;
  return { x: mmToIU(x), y: mmToIU(invertY ? -y : y) };
}

/** Read an `(at x y [angle])` child: position in IU plus angle in degrees. */
function readAt(node: SList, invertY = false): { at: Vec2; angle: number } {
  const at = childNamed(node, 'at');
  if (!at) return { at: { x: 0, y: 0 }, angle: 0 };
  return { at: readPoint(at, 0, invertY), angle: numArg(at, 2) ?? 0 };
}

function readStroke(node: SList): Stroke | undefined {
  const s = childNamed(node, 'stroke');
  if (!s) return undefined;
  const width = childNamed(s, 'width');
  const stroke: { -readonly [K in keyof Stroke]: Stroke[K] } = {
    width: width ? mmToIU(numArg(width, 0) ?? 0) : 0,
    type: stringField(s, 'type') ?? 'default',
  };
  const col = childNamed(s, 'color');
  if (col) {
    const r = numArg(col, 0) ?? 0, g = numArg(col, 1) ?? 0, b = numArg(col, 2) ?? 0, a = numArg(col, 3) ?? 1;
    if (r || g || b || a < 1) stroke.color = [r, g, b, a]; // ignore KiCad's (0 0 0 0) "unspecified"
  }
  return stroke;
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
  // hide is a bare `hide` token in older files or `(hide yes)` in newer ones.
  const bareHidden = e.items.some((it) => it.kind === 'atom' && it.value === 'hide');
  const effects: { -readonly [K in keyof TextEffects]: TextEffects[K] } = {
    hidden: bareHidden || boolField(e, 'hide', false),
  };
  if (size) effects.fontSize = [mmToIU(numArg(size, 0) ?? 0), mmToIU(numArg(size, 1) ?? 0)];
  if (justify) effects.justify = args(justify);
  if (font) {
    // bold/italic are bare tokens (legacy) or `(bold yes)` / `(italic yes)`.
    const bareBold = font.items.some((it) => it.kind === 'atom' && it.value === 'bold');
    if (bareBold || boolField(font, 'bold', false)) effects.bold = true;
    const bareItalic = font.items.some((it) => it.kind === 'atom' && it.value === 'italic');
    if (bareItalic || boolField(font, 'italic', false)) effects.italic = true;
    const col = childNamed(font, 'color');
    if (col) {
      const r = numArg(col, 0) ?? 0, g = numArg(col, 1) ?? 0, b = numArg(col, 2) ?? 0, a = numArg(col, 3) ?? 1;
      if (r || g || b || a < 1) effects.color = [r, g, b, a];
    }
  }
  return effects;
}

/** Parse a `(property ...)` node. Exported so the writer can diff edits against the source. */
export function readField(node: SList, invertY = false): SchField {
  const { at, angle } = readAt(node, invertY);
  const field: { -readonly [K in keyof SchField]: SchField[K] } = {
    key: arg(node, 0) ?? '',
    value: arg(node, 1) ?? '',
    angle,
    source: node,
  };
  if (childNamed(node, 'at')) field.at = at;
  const effects = readEffects(node);
  if (effects) field.effects = effects;
  if (boolField(node, 'show_name', false)) field.nameShown = true;
  return field;
}

// ----- library symbols ------------------------------------------------------

/** Split a unit name like `Conn_01x02_1_1` into its trailing unit and body-style numbers. */
function parseUnitName(name: string): { unit: number; bodyStyle: number } {
  const m = /_(\d+)_(\d+)$/.exec(name);
  if (!m) return { unit: 0, bodyStyle: 0 };
  return { unit: Number(m[1]), bodyStyle: Number(m[2]) };
}

function readLibPin(node: SList, invertY = false): LibPin {
  const { at, angle } = readAt(node, invertY);
  // hide can be a bare `hide` token (legacy) or `(hide yes)`.
  const hideChild = childNamed(node, 'hide');
  const bareHide = node.items.some((it) => it.kind === 'atom' && it.value === 'hide');
  const pin: { -readonly [K in keyof LibPin]: LibPin[K] } = {
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
  // Per-pin name/number text sizes. A size of 0 means the text is not drawn
  // (KiCad lays it out zero-height; Altium imports hide names this way).
  const nameFx = childNamed(node, 'name') && readEffects(childNamed(node, 'name')!);
  const numFx = childNamed(node, 'number') && readEffects(childNamed(node, 'number')!);
  if (nameFx?.fontSize) pin.nameSize = nameFx.fontSize[0];
  if (numFx?.fontSize) pin.numberSize = numFx.fontSize[0];
  return pin;
}

function readGraphic(node: SList, invertY = false): LibGraphic | undefined {
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
      return withSF({ kind: 'rectangle' as const, start: readPoint(start, 0, invertY), end: readPoint(end, 0, invertY), source: node });
    }
    case 'circle': {
      const center = childNamed(node, 'center');
      const radius = childNamed(node, 'radius');
      if (!center) return undefined;
      return withSF({ kind: 'circle' as const, center: readPoint(center, 0, invertY), radius: mmToIU(radius ? (numArg(radius, 0) ?? 0) : 0), source: node });
    }
    case 'arc': {
      const start = childNamed(node, 'start');
      const mid = childNamed(node, 'mid');
      const end = childNamed(node, 'end');
      if (!start || !mid || !end) return undefined;
      return withSF({ kind: 'arc' as const, start: readPoint(start, 0, invertY), mid: readPoint(mid, 0, invertY), end: readPoint(end, 0, invertY), source: node });
    }
    case 'polyline': {
      const pts = childNamed(node, 'pts');
      const points = pts ? childrenNamed(pts, 'xy').map((xy) => readPoint(xy, 0, invertY)) : [];
      return withSF({ kind: 'polyline' as const, points, source: node });
    }
    case 'text': {
      const { at, angle } = readAt(node, invertY);
      const effects = readEffects(node);
      const g: LibGraphic = { kind: 'text', text: arg(node, 0) ?? '', at, angle, source: node };
      return effects ? { ...g, effects } : g;
    }
    default:
      return undefined; // unknown body element; preserved via the parent's source
  }
}

function readLibSymbolUnit(node: SList, invertY: boolean): LibSymbolUnit {
  const name = arg(node, 0) ?? '';
  const { unit, bodyStyle } = parseUnitName(name);
  const graphics: LibGraphic[] = [];
  const pins: LibPin[] = [];
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'pin') pins.push(readLibPin(item, invertY));
    else {
      const g = readGraphic(item, invertY);
      if (g) graphics.push(g);
    }
  }
  return { name, unit, bodyStyle, graphics, pins, source: node };
}

function readLibSymbol(node: SList): LibSymbol {
  const units: LibSymbolUnit[] = [];
  const properties: SchField[] = [];
  // Symbol-library geometry is stored +Y-up; invert it to the model's +Y-down space.
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'symbol') units.push(readLibSymbolUnit(item, true));
    else if (head(item) === 'property') properties.push(readField(item, true));
  }
  const extendsName = stringField(node, 'extends');
  const pinNamesNode = childNamed(node, 'pin_names');
  const pinNumbersNode = childNamed(node, 'pin_numbers');
  const bareHide = (n: SList | undefined): boolean =>
    n !== undefined && (boolField(n, 'hide', false) || n.items.some((it) => it.kind === 'atom' && it.value === 'hide'));
  const sym: { -readonly [K in keyof LibSymbol]: LibSymbol[K] } = {
    libId: arg(node, 0) ?? '',
    isPower: childNamed(node, 'power') !== undefined,
    pinNumbersHidden: bareHide(pinNumbersNode),
    pinNamesHidden: bareHide(pinNamesNode),
    pinNameOffset: pinNamesNode ? mmToIU(numberField(pinNamesNode, 'offset') ?? 0.508) : mmToIU(0.508),
    properties,
    units,
    source: node,
  };
  if (extendsName !== undefined) sym.extends = extendsName;
  return sym;
}

/** The geometry + display settings a derived symbol inherits from its parent chain. */
interface InheritedBase {
  units: readonly LibSymbolUnit[];
  isPower: boolean;
  pinNumbersHidden: boolean;
  pinNamesHidden: boolean;
  pinNameOffset: number;
}

/**
 * Resolve derived symbols, faithful to KiCad's `LIB_SYMBOL::Flatten()`: the
 * flattened symbol is a copy of its *parent*, so a symbol with `(extends "Parent")`
 * takes the parent's body (units/pins), power flag, and pin name/number visibility
 * and name offset from the parent chain — keeping only its own text properties
 * (Reference/Value/Footprint/…). Parent and child live in the same library, and a
 * parent may itself be derived, so resolution walks the chain to the root.
 */
function resolveExtends(symbols: LibSymbol[]): LibSymbol[] {
  const byName = new Map<string, LibSymbol>();
  for (const s of symbols) byName.set(s.libId, s);

  const ownBase = (s: LibSymbol): InheritedBase => ({
    units: s.units,
    isPower: s.isPower,
    pinNumbersHidden: s.pinNumbersHidden,
    pinNamesHidden: s.pinNamesHidden,
    pinNameOffset: s.pinNameOffset,
  });

  const resolveBase = (s: LibSymbol, seen: Set<string>): InheritedBase => {
    if (!s.extends || seen.has(s.libId)) return ownBase(s);
    const parent = byName.get(s.extends);
    if (!parent) return ownBase(s);
    seen.add(s.libId);
    const r = resolveBase(parent, seen);
    // Geometry + pin display come from the parent; only power can be additive.
    return { ...r, isPower: s.isPower || r.isPower };
  };

  return symbols.map((s) => {
    if (!s.extends) return s;
    const r = resolveBase(s, new Set());
    return {
      ...s,
      units: r.units,
      isPower: r.isPower,
      pinNumbersHidden: r.pinNumbersHidden,
      pinNamesHidden: r.pinNamesHidden,
      pinNameOffset: r.pinNameOffset,
    };
  });
}

// ----- instance items -------------------------------------------------------

function readSymbol(node: SList): SchSymbol {
  const { at, angle } = readAt(node);
  const fields = childrenNamed(node, 'property').map((p) => readField(p));
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
  // Keep "token absent" distinct from "no": older files have no exclude_from_sim.
  if (childNamed(node, 'exclude_from_sim')) sym.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  const uuid = stringField(node, 'uuid');
  if (uuid) sym.uuid = uuid;
  return sym;
}

function readLine(node: SList, kind: LineKind): SchLine {
  const pts = childNamed(node, 'pts');
  const xy = pts ? childrenNamed(pts, 'xy') : [];
  const all = xy.map((p) => readPoint(p, 0));
  const start = all[0] ?? { x: 0, y: 0 };
  const end = all[all.length - 1] ?? start;
  const line: { -readonly [K in keyof SchLine]: SchLine[K] } = { kind, start, end, source: node };
  // Graphic polylines can have more than two vertices; keep them all for drawing.
  if (all.length > 2) line.points = all;
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

function readNoConnect(node: SList): SchNoConnect {
  const { at } = readAt(node);
  const nc: { -readonly [K in keyof SchNoConnect]: SchNoConnect[K] } = { at, source: node };
  const uuid = stringField(node, 'uuid');
  if (uuid) nc.uuid = uuid;
  return nc;
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
  const shape = stringField(node, 'shape');
  if (shape === 'input' || shape === 'output' || shape === 'bidirectional' || shape === 'tri_state' || shape === 'passive') {
    label.shape = shape;
  }
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
/**
 * Read a symbol library: the `(symbol ...)` definitions inside a standalone
 * `(kicad_symbol_lib ...)` file (or a schematic's `(lib_symbols ...)` block).
 * These use the same definition format as embedded library symbols.
 */
export function readSymbolLib(root: SList): LibSymbol[] {
  return resolveExtends(childrenNamed(root, 'symbol').map(readLibSymbol));
}

export function readSchematic(root: SList): Schematic {
  if (head(root) !== 'kicad_sch') {
    throw new Error(`Expected a (kicad_sch ...) root, got (${head(root) ?? '?'} ...)`);
  }

  const libSymbols: LibSymbol[] = [];
  const symbols: SchSymbol[] = [];
  const lines: SchLine[] = [];
  const junctions: SchJunction[] = [];
  const noConnects: SchNoConnect[] = [];
  const labels: SchLabel[] = [];

  const libSymbolsNode = childNamed(root, 'lib_symbols');
  if (libSymbolsNode) {
    for (const sym of resolveExtends(childrenNamed(libSymbolsNode, 'symbol').map(readLibSymbol)))
      libSymbols.push(sym);
  }

  for (const item of root.items) {
    if (!isList(item)) continue;
    const name = head(item);
    if (name === undefined) continue;

    if (name === 'symbol') symbols.push(readSymbol(item));
    else if (LINE_KINDS[name]) lines.push(readLine(item, LINE_KINDS[name]!));
    else if (name === 'junction') junctions.push(readJunction(item));
    else if (name === 'no_connect') noConnects.push(readNoConnect(item));
    else if (LABEL_KINDS[name]) labels.push(readLabel(item, LABEL_KINDS[name]!));
  }

  const sch: { -readonly [K in keyof Schematic]: Schematic[K] } = {
    version: numArg(childNamed(root, 'version') ?? root, 0) ?? 0,
    libSymbols,
    symbols,
    lines,
    junctions,
    noConnects,
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
