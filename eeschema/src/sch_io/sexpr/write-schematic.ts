/**
 * Writer: typed Schematic model -> S-expression AST -> text.
 *
 * This is the counterpart to readSchematic and the payoff of the lossless design.
 * Each item keeps the `source` node it was read from (or a freshly built one for
 * created items); the writer reuses that node and only *patches* the coordinate
 * sub-nodes from the typed model. So:
 *   - unmodified items round-trip byte-for-byte (including fields we don't model),
 *   - moved/edited items get updated coordinates while keeping everything else,
 *   - new items serialize from their synthesized nodes,
 *   - deleted items simply aren't emitted.
 *
 * Items are written in KiCad's canonical top-level order; any other structural
 * nodes (sheet_instances, embedded_fonts, …) are preserved at the end.
 */

import { head, isList, list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { arg, childNamed, numArg } from '@ziroeda/sexpr/src/query.js';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readField } from './read-schematic.js';
import type {
  Schematic,
  SchSymbol,
  SchLine,
  SchJunction,
  SchLabel,
  SchField,
  SchNoConnect,
  SchSheet,
  SchBusEntry,
  SchTextBox,
  SchTable,
  SchTableCell,
  TextEffects,
  Stroke,
  SheetInstance,
  Vec2,
} from '../../types.js';

function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

/** Replace items[index] of a list, returning a new list. */
function setItem(node: SList, index: number, value: SNode): SList {
  const items = node.items.slice();
  items[index] = value;
  return { kind: 'list', items };
}

/** Map the first child list named `name`, returning a new parent list. */
function mapChild(node: SList, name: string, fn: (child: SList) => SList): SList {
  let done = false;
  const items = node.items.map((it) => {
    if (!done && isList(it) && head(it) === name) {
      done = true;
      return fn(it);
    }
    return it;
  });
  return { kind: 'list', items };
}

/** Patch the x/y of an `(at x y [angle])` child, keeping the angle and any extras. */
function patchAt(node: SList, p: Vec2): SList {
  return mapChild(node, 'at', (at) => {
    const items = at.items.slice();
    items[1] = atom(mm(p.x));
    items[2] = atom(mm(p.y));
    return { kind: 'list', items };
  });
}

// ----- property (field) writing ----------------------------------------------
//
// Mirrors KiCad's SCH_IO_KICAD_SEXPR::saveField + EDA_TEXT::Format for the parts
// we model, but as *patches*: every sub-edit compares against the parsed source
// and only rewrites the nodes whose semantic value actually changed, so unedited
// fields (including legacy spellings like a bare `hide` atom) round-trip
// byte-for-byte.

const DEFAULT_TEXT_SIZE = mmToIU(1.27); // DEFAULT_SIZE_TEXT (50 mil)

/** Remove bare `name` atoms and `(name ...)` children from a list. */
function stripToken(node: SList, name: string): SList {
  return {
    kind: 'list',
    items: node.items.filter(
      (it) => !(it.kind === 'atom' && it.value === name) && !(isList(it) && head(it) === name),
    ),
  };
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

/** Set/clear a boolean token, preserving the existing spelling when already right. */
function setToken(node: SList, name: string, value: boolean): SList {
  if (hasToken(node, name) === value) return node;
  const stripped = stripToken(node, name);
  if (!value) return stripped;
  return { kind: 'list', items: [...stripped.items, list(atom(name), atom('yes'))] };
}

const sizeNode = (h: number, w: number): SList => list(atom('size'), atom(mm(h)), atom(mm(w)));

/** `(justify left bottom)` from a token array, or null when all-centred. */
function justifyNode(justify: readonly string[] | undefined): SList | null {
  const tokens = (justify ?? []).filter((t) => t !== 'center');
  if (tokens.length === 0) return null;
  return { kind: 'list', items: [atom('justify'), ...tokens.map((t) => atom(t))] };
}

/** Build a canonical `(effects ...)` node (EDA_TEXT::Format), or null if all-default. */
function buildEffects(fx: TextEffects | undefined): SList | null {
  const size = fx?.fontSize ?? [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE];
  const nonDefaultSize = size[0] !== DEFAULT_TEXT_SIZE || size[1] !== DEFAULT_TEXT_SIZE;
  const just = justifyNode(fx?.justify);
  if (!fx || (!nonDefaultSize && !fx.bold && !fx.italic && !fx.hidden && !just)) return null;
  const font: SNode[] = [atom('font'), sizeNode(size[0], size[1])];
  if (fx.bold) font.push(list(atom('bold'), atom('yes')));
  if (fx.italic) font.push(list(atom('italic'), atom('yes')));
  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (just) items.push(just);
  if (fx.hidden) items.push(list(atom('hide'), atom('yes')));
  return { kind: 'list', items };
}

/** Patch an existing `(effects ...)` node to match `fx`, changing only what differs. */
function patchEffects(effectsNode: SList, fx: TextEffects, orig: TextEffects | undefined): SList {
  let e = effectsNode;

  // Font size / bold / italic.
  const size = fx.fontSize;
  const boldChanged = !!fx.bold !== !!orig?.bold;
  const italicChanged = !!fx.italic !== !!orig?.italic;
  const sizeChanged =
    !!size && (size[0] !== orig?.fontSize?.[0] || size[1] !== orig?.fontSize?.[1]);
  if (sizeChanged || boldChanged || italicChanged) {
    if (!childNamed(e, 'font'))
      e = { kind: 'list', items: [e.items[0]!, list(atom('font')), ...e.items.slice(1)] };
    e = mapChild(e, 'font', (font) => {
      let f = font;
      if (sizeChanged && size) {
        f = childNamed(f, 'size')
          ? mapChild(f, 'size', () => sizeNode(size[0], size[1]))
          : { kind: 'list', items: [f.items[0]!, sizeNode(size[0], size[1]), ...f.items.slice(1)] };
      }
      if (boldChanged) f = setToken(f, 'bold', !!fx.bold);
      if (italicChanged) f = setToken(f, 'italic', !!fx.italic);
      return f;
    });
  }

  // Justification: replace the whole (justify ...) child when it changed.
  const wantJust = justifyNode(fx.justify);
  const haveJust = justifyNode(orig?.justify);
  if (JSON.stringify(wantJust) !== JSON.stringify(haveJust)) {
    e = stripToken(e, 'justify');
    if (wantJust) {
      // Canonical position: after (font ...), before (hide ...).
      const items = e.items.slice();
      const fontIdx = items.findIndex((it) => isList(it) && head(it) === 'font');
      items.splice(fontIdx >= 0 ? fontIdx + 1 : items.length, 0, wantJust);
      e = { kind: 'list', items };
    }
  }

  // Visibility (`hide` is a bare atom in legacy files, `(hide yes)` in newer ones).
  e = setToken(e, 'hide', fx.hidden);
  return e;
}

/** Build a full `(property ...)` node for a field created in the editor.
 * `invertY` writes Y negated for symbol-library fields (stored +Y-up). */
export function buildPropertyNode(field: Omit<SchField, 'source'>, invertY = false): SList {
  const at = field.at ?? { x: 0, y: 0 };
  const y = invertY ? -at.y : at.y;
  const items: SNode[] = [
    atom('property'),
    str(field.key),
    str(field.value),
    list(atom('at'), atom(mm(at.x)), atom(mm(y)), atom(String(field.angle))),
  ];
  if (field.nameShown) items.push(list(atom('show_name'), atom('yes')));
  const fx = buildEffects(field.effects);
  if (fx) items.push(fx);
  return { kind: 'list', items };
}

/**
 * Patch a `(property ...)` node to match the typed field, changing only what
 * differs. `invertY` writes Y negated — symbol-*library* fields are stored +Y-up
 * in the file while the model is +Y-down (the mirror of readField's invertY).
 * Exported for the symbol-library writer.
 */
export function patchProperty(propNode: SList, field: SchField, invertY = false): SList {
  const orig = readField(propNode, invertY);
  const fileAt = (p: Vec2): Vec2 => (invertY ? { x: p.x, y: -p.y } : p);
  let n = propNode;
  if (field.key !== orig.key) n = setItem(n, 1, str(field.key));
  if (field.value !== orig.value) n = setItem(n, 2, str(field.value)); // the value
  if (field.at && childNamed(n, 'at')) {
    if (field.at.x !== orig.at?.x || field.at.y !== orig.at?.y) n = patchAt(n, fileAt(field.at));
    if (field.angle !== orig.angle) n = patchAtAngle(n, field.angle);
  } else if (field.at) {
    // Field had no (at ...): insert one right after the value.
    const items = n.items.slice();
    const p = fileAt(field.at);
    items.splice(3, 0, list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(field.angle))));
    n = { kind: 'list', items };
  }
  // show_name sits between (at ...) and (effects ...) in KiCad's canonical order.
  if (hasToken(n, 'show_name') !== !!field.nameShown) {
    n = stripToken(n, 'show_name');
    if (field.nameShown) {
      const items = n.items.slice();
      const atIdx = items.findIndex((it) => isList(it) && head(it) === 'at');
      items.splice(atIdx >= 0 ? atIdx + 1 : items.length, 0, list(atom('show_name'), atom('yes')));
      n = { kind: 'list', items };
    }
  }
  // Effects: patch in place when present; otherwise synthesize only if non-default.
  if (childNamed(n, 'effects')) {
    n = mapChild(n, 'effects', (e) =>
      patchEffects(e, field.effects ?? { hidden: false }, orig.effects),
    );
  } else {
    const fx = buildEffects(field.effects);
    if (fx) n = { kind: 'list', items: [...n.items, fx] };
  }
  return n;
}

/** Set the rotation angle (3rd element) of an `(at x y angle)` child. */
function patchAtAngle(node: SList, angle: number): SList {
  return mapChild(node, 'at', (at) => {
    const items = at.items.slice();
    items[3] = atom(String(angle));
    return { kind: 'list', items };
  });
}

/**
 * Reflect the typed mirror axis into the node: insert/update `(mirror x|y)` right
 * after `(at ...)`, or drop any existing mirror node when the symbol is unmirrored.
 * Matches KiCad, which writes `(mirror x)` / `(mirror y)` only when mirrored.
 */
function patchMirror(node: SList, mirror: 'x' | 'y' | undefined): SList {
  const items = node.items.filter((it) => !(isList(it) && head(it) === 'mirror'));
  if (mirror) {
    const atIdx = items.findIndex((it) => isList(it) && head(it) === 'at');
    const mirrorNode = list(atom('mirror'), atom(mirror));
    items.splice(atIdx >= 0 ? atIdx + 1 : items.length, 0, mirrorNode);
  }
  return { kind: 'list', items };
}

// Canonical order of a schematic (symbol ...)'s children (SCH_IO_KICAD_SEXPR::saveSymbol).
const SYMBOL_CHILD_ORDER = [
  'lib_name',
  'lib_id',
  'at',
  'mirror',
  'unit',
  'body_style',
  'exclude_from_sim',
  'in_bom',
  'on_board',
  'dnp',
  'fields_autoplaced',
  'uuid',
  'property',
  'pin',
  'instances',
];

/** Insert `child` after the last existing child that canonically precedes it. */
function insertCanonical(node: SList, child: SList): SList {
  const rank = SYMBOL_CHILD_ORDER.indexOf(head(child) ?? '');
  let insertAt = node.items.length;
  for (let i = node.items.length - 1; i >= 1; i--) {
    const it = node.items[i]!;
    const r = isList(it) ? SYMBOL_CHILD_ORDER.indexOf(head(it) ?? '') : -1;
    if (r !== -1 && r <= rank) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  const items = node.items.slice();
  items.splice(insertAt, 0, child);
  return { kind: 'list', items };
}

/** Patch `(name yes|no)`; insert canonically when absent and non-default. */
function patchSymbolBool(node: SList, name: string, value: boolean, dflt: boolean): SList {
  const child = childNamed(node, name);
  if (child) {
    const cur = child.items[1]?.kind === 'atom' ? child.items[1].value !== 'no' : true;
    if (cur === value) return node;
    return mapChild(node, name, () => list(atom(name), atom(value ? 'yes' : 'no')));
  }
  if (value === dflt) return node;
  return insertCanonical(node, list(atom(name), atom(value ? 'yes' : 'no')));
}

/** Patch `(unit N)`; insert canonically when absent and not unit 1. */
function patchUnit(node: SList, unit: number): SList {
  const child = childNamed(node, 'unit');
  if (child) {
    if (numArg(child, 0) === unit) return node;
    return mapChild(node, 'unit', () => list(atom('unit'), atom(String(unit))));
  }
  if (unit === 1) return node;
  return insertCanonical(node, list(atom('unit'), atom(String(unit))));
}

function writeSymbol(sym: SchSymbol): SList {
  let node = patchAt(sym.source, sym.at);
  node = patchAtAngle(node, sym.angle);
  node = patchMirror(node, sym.mirror);
  node = patchUnit(node, sym.unit);
  if (sym.excludedFromSim !== undefined)
    node = patchSymbolBool(node, 'exclude_from_sim', sym.excludedFromSim, false);
  node = patchSymbolBool(node, 'in_bom', sym.inBom, true);
  node = patchSymbolBool(node, 'on_board', sym.onBoard, true);
  node = patchSymbolBool(node, 'dnp', sym.dnp, false);

  // Rewrite the property block from the model's field list (order preserved), so
  // renamed/added/removed fields land exactly where KiCad writes them.
  const propNodes = sym.fields.map((f) => patchProperty(f.source, f));
  const items: SNode[] = [];
  let inserted = false;
  for (const it of node.items) {
    if (isList(it) && head(it) === 'property') {
      if (!inserted) {
        items.push(...propNodes);
        inserted = true;
      }
      continue; // old property nodes are replaced by the model's list
    }
    items.push(it);
  }
  if (!inserted) {
    // No properties in the source (unusual): put them before the first pin/instances.
    const idx = items.findIndex(
      (it) => isList(it) && (head(it) === 'pin' || head(it) === 'instances'),
    );
    items.splice(idx === -1 ? items.length : idx, 0, ...propNodes);
  }
  return { kind: 'list', items };
}

/** Patch (or append) a `(stroke (width ..) (type ..))` node to match `stroke`,
 *  changing only width/type and leaving any other tokens (e.g. color) in place. */
function patchStroke(node: SList, stroke: Stroke | undefined): SList {
  if (!stroke) return node;
  if (childNamed(node, 'stroke')) {
    return mapChild(node, 'stroke', (s) => {
      let out = s;
      if (childNamed(out, 'width'))
        out = mapChild(out, 'width', () => list(atom('width'), atom(mm(stroke.width))));
      if (childNamed(out, 'type'))
        out = mapChild(out, 'type', () => list(atom('type'), atom(stroke.type)));
      return out;
    });
  }
  return {
    kind: 'list',
    items: [
      ...node.items,
      list(
        atom('stroke'),
        list(atom('width'), atom(mm(stroke.width))),
        list(atom('type'), atom(stroke.type)),
      ),
    ],
  };
}

function writeLine(l: SchLine): SList {
  // A multi-point polyline patches each vertex from `points`; a wire/bus has just
  // its two endpoints. Extra source xy's beyond what we model are left untouched.
  const verts = l.points ?? [l.start, l.end];
  const node = mapChild(l.source, 'pts', (pts) => {
    let i = 0;
    const items = pts.items.map((it) => {
      if (isList(it) && head(it) === 'xy') {
        const p = verts[i] ?? verts[verts.length - 1]!;
        i++;
        return list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));
      }
      return it;
    });
    return { kind: 'list', items };
  });
  return patchStroke(node, l.stroke);
}

/** Patch a junction: position and `(diameter ..)`. */
function writeJunction(j: SchJunction): SList {
  let node = patchAt(j.source, j.at);
  if (childNamed(node, 'diameter'))
    node = mapChild(node, 'diameter', () => list(atom('diameter'), atom(mm(j.diameter))));
  return node;
}

const writeNoConnect = (nc: SchNoConnect): SList => patchAt(nc.source, nc.at);

const writeBusEntry = (be: SchBusEntry): SList => patchAt(be.source, be.at);

/** Patch the `(page …)` inside each `(path …)` of an `(instances …)` or
 *  `(sheet_instances …)` node from the typed instances, keyed by project+path. */
function patchInstancePages(
  node: SList,
  pageByKey: ReadonlyMap<string, string | undefined>,
  hasProject: boolean,
): SList {
  const patchPath = (pathNode: SList, project: string): SList => {
    const page = pageByKey.get(`${project} ${arg(pathNode, 0) ?? ''}`);
    if (page === undefined || !childNamed(pathNode, 'page')) return pathNode;
    return mapChild(pathNode, 'page', () => list(atom('page'), str(page)));
  };
  const items = node.items.map((it) => {
    if (!isList(it)) return it;
    if (hasProject && head(it) === 'project') {
      const proj = arg(it, 0) ?? '';
      return {
        kind: 'list' as const,
        items: it.items.map((p) => (isList(p) && head(p) === 'path' ? patchPath(p, proj) : p)),
      };
    }
    if (!hasProject && head(it) === 'path') return patchPath(it, '');
    return it;
  });
  return { kind: 'list', items };
}

const instanceKey = (i: SheetInstance): string => `${i.project ?? ''} ${i.path}`;

/** Patch a sheet: its position, each field, each pin, and instance page numbers. */
function writeSheet(sh: SchSheet): SList {
  let node = patchAt(sh.source, sh.at);
  if (childNamed(node, 'instances') && sh.instances.length) {
    const pages = new Map(sh.instances.map((i) => [instanceKey(i), i.page]));
    node = mapChild(node, 'instances', (inst) => patchInstancePages(inst, pages, true));
  }
  const byKey = new Map(sh.fields.map((f) => [f.key, f]));
  let pinIdx = 0;
  node = {
    kind: 'list',
    items: node.items.map((it) => {
      if (isList(it) && head(it) === 'property') {
        const key = it.items[1];
        const f = key && key.kind === 'string' ? byKey.get(key.value) : undefined;
        return f ? patchProperty(it, f) : it;
      }
      if (isList(it) && head(it) === 'pin') {
        const pin = sh.pins[pinIdx++];
        return pin ? patchAt(it, pin.at) : it;
      }
      return it;
    }),
  };
  return node;
}

function writeLabel(l: SchLabel): SList {
  let node = patchAt(setItem(l.source, 1, str(l.text)), l.at);
  // Global/hierarchical labels carry a `(shape …)`; patch it in place when
  // present so a shape edit round-trips (local labels/text have no shape).
  if (l.shape !== undefined && childNamed(node, 'shape')) {
    node = mapChild(node, 'shape', () => list(atom('shape'), atom(l.shape!)));
  }
  return node;
}

/** Patch a text box: content (item 1), position (`at` = start) and `(size ..)`. */
function writeTextBox(tb: SchTextBox): SList {
  let node = setItem(tb.source, 1, str(tb.text));
  node = patchAt(node, tb.start);
  const size = { x: tb.end.x - tb.start.x, y: tb.end.y - tb.start.y };
  if (childNamed(node, 'size')) {
    node = mapChild(node, 'size', () => list(atom('size'), atom(mm(size.x)), atom(mm(size.y))));
  }
  return node;
}

/** Patch a table cell: content (item 1), position and size (like a text box). */
function writeTableCell(cell: SchTableCell): SList {
  let node = setItem(cell.source, 1, str(cell.text));
  node = patchAt(node, cell.start);
  const size = { x: cell.end.x - cell.start.x, y: cell.end.y - cell.start.y };
  if (childNamed(node, 'size')) {
    node = mapChild(node, 'size', () => list(atom('size'), atom(mm(size.x)), atom(mm(size.y))));
  }
  return node;
}

/** Patch a table: rebuild its `(cells ...)` block from the model's cells (lossless otherwise). */
function writeTable(tb: SchTable): SList {
  return mapChild(tb.source, 'cells', (cells) => {
    let i = 0;
    const items = cells.items.map((it) => {
      if (isList(it) && head(it) === 'table_cell') {
        const cell = tb.cells[i++];
        return cell ? writeTableCell(cell) : it;
      }
      return it;
    });
    return { kind: 'list', items };
  });
}

const HEADER_ORDER = ['version', 'generator', 'generator_version', 'uuid', 'paper', 'title_block'];
const STRUCTURAL = new Set([...HEADER_ORDER, 'lib_symbols']);
const ITEM_HEADS = new Set([
  'symbol',
  'wire',
  'bus',
  'polyline',
  'junction',
  'no_connect',
  'label',
  'global_label',
  'hierarchical_label',
  'text',
  'bus_entry',
  'sheet',
  'image',
  'rectangle',
  'circle',
  'arc',
  'text_box',
  'table',
]);

/** Rebuild the `(kicad_sch ...)` root list from the current model. */
export function writeSchematic(sch: Schematic): SList {
  const out: SNode[] = [atom('kicad_sch')];

  for (const name of HEADER_ORDER) {
    const c = childNamed(sch.source, name);
    if (c) out.push(c);
  }

  out.push(list(atom('lib_symbols'), ...sch.libSymbols.map((l) => l.source)));

  out.push(
    ...sch.symbols.map(writeSymbol),
    ...sch.lines.map(writeLine),
    ...sch.junctions.map(writeJunction),
    ...sch.noConnects.map(writeNoConnect),
    ...sch.busEntries.map(writeBusEntry),
    ...sch.labels.map(writeLabel),
    ...sch.sheets.map(writeSheet),
    ...sch.textBoxes.map(writeTextBox),
    ...sch.tables.map(writeTable),
    // Images and sheet-level graphic shapes are render-only for now: their source
    // nodes pass through untouched.
    ...sch.images.map((im) => im.source),
    ...sch.graphics.map((g) => g.source),
  );

  // Preserve any remaining structural nodes (sheet_instances, embedded_fonts, …).
  for (const it of sch.source.items) {
    if (!isList(it)) continue;
    const h = head(it);
    if (h === undefined || STRUCTURAL.has(h) || ITEM_HEADS.has(h)) continue;
    // The root sheet's page lives in (sheet_instances (path "/" (page …))); patch
    // it from the typed model so Edit Sheet Page Number on the root round-trips.
    if (h === 'sheet_instances' && sch.sheetInstances.length) {
      const pages = new Map(sch.sheetInstances.map((i) => [instanceKey(i), i.page]));
      out.push(patchInstancePages(it, pages, false));
      continue;
    }
    out.push(it);
  }

  return { kind: 'list', items: out };
}
