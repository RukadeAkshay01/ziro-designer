/**
 * Writer: typed LibSymbol model -> S-expression AST -> `.kicad_sym` text.
 *
 * The faithful counterpart to KiCad's `SCH_IO_KICAD_SEXPR_LIB_CACHE::Save` /
 * `SaveSymbol` (eeschema/sch_io/sexpr/sch_io_kicad_sexpr_lib_cache.cpp).
 * Like the schematic writer it is lossless by patching: every item keeps the
 * `source` node it was read from, so untouched symbols round-trip byte-for-byte
 * while edited items are rebuilt in KiCad's canonical format.
 *
 * Geometry note: symbol-library files store +Y-up while the typed model is
 * +Y-down (readPoint's invertY) — every coordinate written here is negated back.
 */

import { head, isList, list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readGraphic, readLibPin } from './read-schematic.js';
import { patchProperty } from './write-schematic.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import type {
  LibGraphic,
  LibPin,
  LibSymbol,
  LibSymbolUnit,
  SchField,
  Stroke,
  Fill,
  TextEffects,
  Vec2,
} from '../../types.js';

/** SEXPR_SYMBOL_LIB_FILE_VERSION (sch_file_versions.h, KiCad 9.0). */
export const SYMBOL_LIB_FILE_VERSION = 20241209;

function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

/** Model (+Y down) -> file (+Y up). */
const fx = (p: Vec2): string => mm(p.x);
const fy = (p: Vec2): string => mm(-p.y);

const DEFAULT_TEXT_SIZE = mmToIU(1.27);
/** DEFAULT_PIN_NAME_OFFSET = 20 mils (default_values.h). */
const DEFAULT_PIN_NAME_OFFSET_IU = mmToIU(0.508);

// ----- shared sub-nodes -------------------------------------------------------

/** `(stroke (width ..) (type ..) [(color ..)])` — STROKE_PARAMS::Format. */
function strokeNode(stroke: Stroke | undefined): SList {
  const items: SNode[] = [
    atom('stroke'),
    list(atom('width'), atom(mm(stroke?.width ?? 0))),
    list(atom('type'), atom(stroke?.type ?? 'default')),
  ];
  if (stroke?.color) {
    const [r, g, b, a] = stroke.color;
    items.push(
      list(atom('color'), atom(String(r)), atom(String(g)), atom(String(b)), atom(String(a))),
    );
  }
  return { kind: 'list', items };
}

/** `(fill (type ..) [(color ..)])`. */
function fillNode(fill: Fill | undefined): SList {
  const items: SNode[] = [atom('fill'), list(atom('type'), atom(fill?.type ?? 'none'))];
  if (fill?.type === 'color' && fill.color) {
    const [r, g, b, a] = fill.color;
    items.push(
      list(atom('color'), atom(String(r)), atom(String(g)), atom(String(b)), atom(String(a))),
    );
  }
  return { kind: 'list', items };
}

/** `(effects (font (size h w) [bold] [italic]) [(justify ..)] [(hide yes)])` — EDA_TEXT::Format.
 * Library fields/text always carry the font size (KiCad writes it unconditionally). */
function effectsNode(effects: TextEffects | undefined): SList {
  const size = effects?.fontSize ?? [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE];
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(size[0])), atom(mm(size[1])))];
  if (effects?.bold) font.push(list(atom('bold'), atom('yes')));
  if (effects?.italic) font.push(list(atom('italic'), atom('yes')));
  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  const justify = (effects?.justify ?? []).filter((t) => t !== 'center');
  if (justify.length > 0)
    items.push({ kind: 'list', items: [atom('justify'), ...justify.map((t) => atom(t))] });
  if (effects?.hidden) items.push(list(atom('hide'), atom('yes')));
  return { kind: 'list', items };
}

// ----- item builders (canonical KiCad output) ---------------------------------

/**
 * Build a `(pin ...)` node — mirrors `SCH_IO_KICAD_SEXPR_LIB_CACHE::savePin`:
 * `(pin <type> <shape> (at x y angle) (length ..) [(hide yes)] (name .. (effects ..))
 *  (number .. (effects ..)) (alternate ..)*)`.
 * Any `(alternate ...)` children of the previous source are carried over.
 */
export function buildLibPinNode(pin: Omit<LibPin, 'source'>, prevSource?: SList): SList {
  const items: SNode[] = [
    atom('pin'),
    atom(pin.electricalType),
    atom(pin.shape),
    list(atom('at'), atom(fx(pin.at)), atom(fy(pin.at)), atom(String(pin.angle))),
    list(atom('length'), atom(mm(pin.length))),
  ];
  if (pin.hidden) items.push(list(atom('hide'), atom('yes')));
  const nameSize = pin.nameSize ?? DEFAULT_TEXT_SIZE;
  const numSize = pin.numberSize ?? DEFAULT_TEXT_SIZE;
  items.push(
    list(
      atom('name'),
      str(pin.name),
      list(
        atom('effects'),
        list(atom('font'), list(atom('size'), atom(mm(nameSize)), atom(mm(nameSize)))),
      ),
    ),
  );
  items.push(
    list(
      atom('number'),
      str(pin.number),
      list(
        atom('effects'),
        list(atom('font'), list(atom('size'), atom(mm(numSize)), atom(mm(numSize)))),
      ),
    ),
  );
  if (prevSource) {
    for (const it of prevSource.items) {
      if (isList(it) && head(it) === 'alternate') items.push(it);
    }
  }
  return { kind: 'list', items };
}

/** Build a graphic body item node — mirrors `saveSymbolDrawItem` for SCH_SHAPE/SCH_TEXT. */
export function buildLibGraphicNode(g: LibGraphic): SList {
  switch (g.kind) {
    case 'rectangle':
      return list(
        atom('rectangle'),
        list(atom('start'), atom(fx(g.start)), atom(fy(g.start))),
        list(atom('end'), atom(fx(g.end)), atom(fy(g.end))),
        strokeNode(g.stroke),
        fillNode(g.fill),
      );
    case 'circle':
      return list(
        atom('circle'),
        list(atom('center'), atom(fx(g.center)), atom(fy(g.center))),
        list(atom('radius'), atom(mm(g.radius))),
        strokeNode(g.stroke),
        fillNode(g.fill),
      );
    case 'arc':
      return list(
        atom('arc'),
        list(atom('start'), atom(fx(g.start)), atom(fy(g.start))),
        list(atom('mid'), atom(fx(g.mid)), atom(fy(g.mid))),
        list(atom('end'), atom(fx(g.end)), atom(fy(g.end))),
        strokeNode(g.stroke),
        fillNode(g.fill),
      );
    case 'polyline':
      return list(
        atom('polyline'),
        {
          kind: 'list',
          items: [atom('pts'), ...g.points.map((p) => list(atom('xy'), atom(fx(p)), atom(fy(p))))],
        },
        strokeNode(g.stroke),
        fillNode(g.fill),
      );
    case 'text':
      return list(
        atom('text'),
        str(g.text),
        list(atom('at'), atom(fx(g.at)), atom(fy(g.at)), atom(String(g.angle))),
        effectsNode(g.effects),
      );
  }
}

/** Build a `(property ...)` node for a library field (Y-up, effects always emitted). */
export function buildLibPropertyNode(field: Omit<SchField, 'source'>): SList {
  const at = field.at ?? { x: 0, y: 0 };
  const items: SNode[] = [
    atom('property'),
    str(field.key),
    str(field.value),
    list(atom('at'), atom(mm(at.x)), atom(mm(-at.y)), atom(String(field.angle))),
    effectsNode(field.effects),
  ];
  return { kind: 'list', items };
}

// ----- unit / symbol patching --------------------------------------------------

const vecEq = (a: Vec2 | undefined, b: Vec2 | undefined): boolean => a?.x === b?.x && a?.y === b?.y;

const strokeEq = (a: Stroke | undefined, b: Stroke | undefined): boolean =>
  (a?.width ?? 0) === (b?.width ?? 0) &&
  (a?.type ?? 'default') === (b?.type ?? 'default') &&
  JSON.stringify(a?.color) === JSON.stringify(b?.color);

const fillEq = (a: Fill | undefined, b: Fill | undefined): boolean =>
  (a?.type ?? 'none') === (b?.type ?? 'none') &&
  JSON.stringify(a?.color) === JSON.stringify(b?.color);

/**
 * A pin node: pass the untouched source through byte-for-byte; rebuild the node
 * in canonical form (carrying its `(alternate ...)` children) when any typed
 * field diverges from what the source parses back to.
 */
function pinNode(pin: LibPin): SList {
  if (pin.source.items.length === 0) return buildLibPinNode(pin);
  const orig = readLibPin(pin.source, true);
  const same =
    orig.electricalType === pin.electricalType &&
    orig.shape === pin.shape &&
    vecEq(orig.at, pin.at) &&
    orig.angle === pin.angle &&
    orig.length === pin.length &&
    orig.name === pin.name &&
    orig.number === pin.number &&
    orig.hidden === pin.hidden &&
    orig.nameSize === pin.nameSize &&
    orig.numberSize === pin.numberSize;
  return same ? pin.source : buildLibPinNode(pin, pin.source);
}

/** A graphic node: source passthrough when untouched, canonical rebuild when edited. */
function graphicNode(g: LibGraphic): SList {
  if (g.source.items.length === 0) return buildLibGraphicNode(g);
  const orig = readGraphic(g.source, true);
  if (orig !== undefined && orig.kind === g.kind) {
    let same = false;
    if (orig.kind === 'rectangle' && g.kind === 'rectangle')
      same =
        vecEq(orig.start, g.start) &&
        vecEq(orig.end, g.end) &&
        strokeEq(orig.stroke, g.stroke) &&
        fillEq(orig.fill, g.fill);
    else if (orig.kind === 'circle' && g.kind === 'circle')
      same =
        vecEq(orig.center, g.center) &&
        orig.radius === g.radius &&
        strokeEq(orig.stroke, g.stroke) &&
        fillEq(orig.fill, g.fill);
    else if (orig.kind === 'arc' && g.kind === 'arc')
      same =
        vecEq(orig.start, g.start) &&
        vecEq(orig.mid, g.mid) &&
        vecEq(orig.end, g.end) &&
        strokeEq(orig.stroke, g.stroke) &&
        fillEq(orig.fill, g.fill);
    else if (orig.kind === 'polyline' && g.kind === 'polyline')
      same =
        orig.points.length === g.points.length &&
        orig.points.every((p, i) => vecEq(p, g.points[i])) &&
        strokeEq(orig.stroke, g.stroke) &&
        fillEq(orig.fill, g.fill);
    else if (orig.kind === 'text' && g.kind === 'text')
      same =
        orig.text === g.text &&
        vecEq(orig.at, g.at) &&
        orig.angle === g.angle &&
        JSON.stringify(orig.effects) === JSON.stringify(g.effects);
    if (same) return g.source;
  }
  return buildLibGraphicNode(g);
}

/** Rebuild one `(symbol "Name_U_B" ...)` unit node from the typed unit. */
export function buildLibUnitNode(unit: LibSymbolUnit): SList {
  const items: SNode[] = [atom('symbol'), str(unit.name)];
  // Preserve non-item children from the source (e.g. unit_name).
  for (const it of unit.source.items) {
    if (isList(it) && head(it) === 'unit_name') items.push(it);
  }
  // KiCad saves body items ordered by type (SCH_ITEM::operator< via saveSymbolDrawItem
  // over a multiset): shapes/text first as they appear, pins after. The parser accepts
  // any order; we keep model order for graphics then pins, matching KiCad's files.
  for (const g of unit.graphics) items.push(graphicNode(g));
  for (const p of unit.pins) items.push(pinNode(p));
  return { kind: 'list', items };
}

/** True if the list has a bare `name` atom or a `(name yes)` child. */
function hasToken(node: SList, name: string): boolean {
  for (const it of node.items) {
    if (it.kind === 'atom' && it.value === name) return true;
    if (isList(it) && head(it) === name) {
      const v = it.items[1];
      return !v || (v.kind === 'atom' && v.value !== 'no');
    }
  }
  return false;
}

/**
 * Re-derive a symbol's `(symbol ...)` root node from the typed model, patching
 * the source (SCH_IO_KICAD_SEXPR_LIB_CACHE::SaveSymbol's structure):
 * header flags, then properties, then the per-unit child symbols. Children the
 * model does not represent (exclude_from_sim, in_bom, on_board, embedded_fonts,
 * extends, …) pass through from the source untouched.
 */
export function writeLibSymbolNode(sym: LibSymbol): SList {
  const src = sym.source;
  let propertiesWritten = false;
  let unitsWritten = false;

  const propNodes = (): SNode[] =>
    sym.properties.map((f) =>
      f.source.items.length > 0 ? patchProperty(f.source, f, true) : buildLibPropertyNode(f),
    );
  // Derived symbols (extends) own no geometry: their units were inherited by the
  // reader and must not be written back (KiCad saves only fields for aliases).
  const unitNodes = (): SNode[] =>
    sym.extends !== undefined ? [] : sym.units.map(buildLibUnitNode);

  // Head: `symbol "Name"` (the name follows a rename of the typed model).
  const out: SNode[] = [atom('symbol'), str(sym.libId)];

  // Header flags the source didn't have but the model now sets, in KiCad's
  // canonical position (right after the name, before everything else).
  if (sym.isPower && !childNamed(src, 'power')) out.push(list(atom('power')));
  if (sym.pinNumbersHidden && !childNamed(src, 'pin_numbers'))
    out.push(list(atom('pin_numbers'), list(atom('hide'), atom('yes'))));
  if (!childNamed(src, 'pin_names')) {
    const node = pinNamesNode(sym);
    if (node) out.push(node);
  }

  // Everything after `symbol "Name"` in source order, with modelled blocks
  // replaced from the typed model and unknown children passed through.
  for (const it of src.items.slice(2)) {
    if (!isList(it)) {
      out.push(it);
      continue;
    }
    switch (head(it)) {
      case 'property':
        if (!propertiesWritten) {
          out.push(...propNodes());
          propertiesWritten = true;
        }
        break;
      case 'symbol':
        if (!unitsWritten) {
          out.push(...unitNodes());
          unitsWritten = true;
        }
        break;
      case 'power':
        if (sym.isPower) out.push(it);
        break;
      case 'pin_numbers':
        if (sym.pinNumbersHidden)
          out.push(
            hasToken(it, 'hide') ? it : list(atom('pin_numbers'), list(atom('hide'), atom('yes'))),
          );
        break;
      case 'pin_names': {
        const node = pinNamesNode(sym);
        if (node) out.push(node);
        break;
      }
      default:
        out.push(it);
    }
  }

  if (!propertiesWritten) out.push(...propNodes());
  if (!unitsWritten) out.push(...unitNodes());
  return { kind: 'list', items: out };
}

/** `(pin_names [(offset ..)] [(hide yes)])`, or null when all-default. */
function pinNamesNode(sym: LibSymbol): SList | null {
  const nonDefaultOffset = sym.pinNameOffset !== DEFAULT_PIN_NAME_OFFSET_IU;
  if (!nonDefaultOffset && !sym.pinNamesHidden) return null;
  const items: SNode[] = [atom('pin_names')];
  if (nonDefaultOffset) items.push(list(atom('offset'), atom(mm(sym.pinNameOffset))));
  if (sym.pinNamesHidden) items.push(list(atom('hide'), atom('yes')));
  return { kind: 'list', items };
}

// ----- library file ------------------------------------------------------------

/** Inheritance depth of a symbol (LIB_SYMBOL::GetInheritanceDepth): 0 for roots. */
function inheritanceDepth(sym: LibSymbol, byName: Map<string, LibSymbol>): number {
  let depth = 0;
  let cur: LibSymbol | undefined = sym;
  const seen = new Set<string>();
  while (cur?.extends !== undefined && !seen.has(cur.libId)) {
    seen.add(cur.libId);
    cur = byName.get(cur.extends);
    depth++;
  }
  return depth;
}

/**
 * Build the `(kicad_symbol_lib ...)` root node — the exact structure
 * `SCH_IO_KICAD_SEXPR_LIB_CACHE::Save` writes: header, then the symbols ordered
 * by inheritance depth and name.
 */
export function writeSymbolLib(symbols: readonly LibSymbol[]): SList {
  const byName = new Map(symbols.map((s) => [s.libId, s]));
  const ordered = symbols.slice().sort((a, b) => {
    const da = inheritanceDepth(a, byName);
    const db = inheritanceDepth(b, byName);
    if (da !== db) return da - db;
    return a.libId < b.libId ? -1 : a.libId > b.libId ? 1 : 0;
  });
  return {
    kind: 'list',
    items: [
      atom('kicad_symbol_lib'),
      list(atom('version'), atom(String(SYMBOL_LIB_FILE_VERSION))),
      list(atom('generator'), str('kicad_symbol_editor')),
      list(atom('generator_version'), str('9.0')),
      ...ordered.map(writeLibSymbolNode),
    ],
  };
}

/** Serialize a whole library to `.kicad_sym` text. */
export function serializeSymbolLib(symbols: readonly LibSymbol[]): string {
  return serialize(writeSymbolLib(symbols));
}

/** Re-parse helper used by editors: the canonical empty source list. */
export const EMPTY_SOURCE: SList = { kind: 'list', items: [] };
