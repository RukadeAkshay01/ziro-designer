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

import { head, isList, list, atom, str, type SList, type SNode } from '../sexpr/index.js';
import { childNamed } from '../sexpr/query.js';
import { iuToMM } from '../units.js';
import type { Schematic, SchSymbol, SchLine, SchJunction, SchLabel, SchField, Vec2 } from './types.js';

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

function patchProperty(propNode: SList, field: SchField): SList {
  let n = setItem(propNode, 2, str(field.value)); // the value
  if (field.at && childNamed(n, 'at')) n = patchAt(n, field.at);
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

function writeSymbol(sym: SchSymbol): SList {
  let node = patchAt(sym.source, sym.at);
  node = patchAtAngle(node, sym.angle);
  node = patchMirror(node, sym.mirror);
  const byKey = new Map(sym.fields.map((f) => [f.key, f]));
  node = {
    kind: 'list',
    items: node.items.map((it) => {
      if (isList(it) && head(it) === 'property') {
        const key = it.items[1];
        const f = key && key.kind === 'string' ? byKey.get(key.value) : undefined;
        return f ? patchProperty(it, f) : it;
      }
      return it;
    }),
  };
  return node;
}

function writeLine(l: SchLine): SList {
  // A multi-point polyline patches each vertex from `points`; a wire/bus has just
  // its two endpoints. Extra source xy's beyond what we model are left untouched.
  const verts = l.points ?? [l.start, l.end];
  return mapChild(l.source, 'pts', (pts) => {
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
}

const writeJunction = (j: SchJunction): SList => patchAt(j.source, j.at);

function writeLabel(l: SchLabel): SList {
  return patchAt(setItem(l.source, 1, str(l.text)), l.at);
}

const HEADER_ORDER = ['version', 'generator', 'generator_version', 'uuid', 'paper', 'title_block'];
const STRUCTURAL = new Set([...HEADER_ORDER, 'lib_symbols']);
const ITEM_HEADS = new Set([
  'symbol', 'wire', 'bus', 'polyline', 'junction', 'no_connect',
  'label', 'global_label', 'hierarchical_label', 'text', 'bus_entry',
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
    ...sch.labels.map(writeLabel),
  );

  // Preserve any remaining structural nodes (sheet_instances, embedded_fonts, …).
  for (const it of sch.source.items) {
    if (!isList(it)) continue;
    const h = head(it);
    if (h === undefined || STRUCTURAL.has(h) || ITEM_HEADS.has(h)) continue;
    out.push(it);
  }

  return { kind: 'list', items: out };
}
