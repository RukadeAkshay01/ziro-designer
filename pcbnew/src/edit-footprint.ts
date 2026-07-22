/**
 * Footprint editing operations — pure transforms on the typed PcbFootprint,
 * the geometry behind KiCad's FOOTPRINT_EDIT_FRAME edit tools (move / rotate /
 * mirror / delete / add). The web mirror of PCB_MOVE_TOOL / EDIT_TOOL applied to
 * a footprint's children.
 *
 * Losslessness: an edited item keeps its `source` node, and the specific child
 * that changed (`(at …)`, `(start …)`, `(pts …)`, …) is PATCHED in place. That
 * way serializeFootprint's source-passthrough stays byte-faithful for every
 * unmodelled field (pinfunction, custom pad primitives, stroke type, solder
 * margins …) while the edited coordinate is rewritten. Brand-new items carry an
 * empty source, so the writer builds them canonically.
 *
 * Coordinates are internal units (+Y down), matching the reader/writer.
 */

import { atom, str, list, isList, head, type SList } from '@ziroeda/sexpr/src/index.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { rotatePcb } from './read-board.js';
import type { PadShape, PadType, PcbFootprint, PcbPad, PcbShape, PcbTextItem } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- item ids ---------------------------------------------------------------

export type FpItemKind = 'pad' | 'shape' | 'text';
export interface FpItemRef {
  kind: FpItemKind;
  index: number;
}

export const fpItemId = (kind: FpItemKind, index: number): string => `${kind}:${index}`;

export function parseFpItemId(id: string): FpItemRef | null {
  const [kind, idx] = id.split(':');
  const index = Number(idx);
  if ((kind === 'pad' || kind === 'shape' || kind === 'text') && Number.isInteger(index)) {
    return { kind, index };
  }
  return null;
}

// ----- source patching --------------------------------------------------------

const mm = (iu: number): string => {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

/** Replace (or append) the first `name` child of a source node. */
function patchChild(src: SList, name: string, node: SList): SList {
  let replaced = false;
  const items = src.items.map((it) => {
    if (!replaced && isList(it) && head(it) === name) {
      replaced = true;
      return node;
    }
    return it;
  });
  if (!replaced) items.push(node);
  return { kind: 'list', items };
}

const atNode = (p: Vec2, angle: number): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

const xyNode = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));

const ptsNode = (pts: Vec2[]): SList => ({
  kind: 'list',
  items: [atom('pts'), ...pts.map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y))))],
});

// ----- geometry helpers -------------------------------------------------------

/** Normalise degrees to [0, 360). */
const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Rotate a point about a centre by `deg` (KiCad RotatePoint convention). */
const rotAbout = (p: Vec2, c: Vec2, deg: number): Vec2 => {
  const r = rotatePcb({ x: p.x - c.x, y: p.y - c.y }, deg);
  return { x: r.x + c.x, y: r.y + c.y };
};

/** Mirror a point's X about a vertical axis at `cx`. */
const mirrorX = (p: Vec2, cx: number): Vec2 => ({ x: 2 * cx - p.x, y: p.y });

// ----- bounding box -----------------------------------------------------------

export interface FpBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const padPoints = (pad: PcbPad): Vec2[] => {
  const hw = pad.size.x / 2;
  const hh = pad.size.y / 2;
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((c) => {
    const r = pad.angle ? rotatePcb(c, -pad.angle) : c;
    return { x: r.x + pad.at.x, y: r.y + pad.at.y };
  });
};

const shapePoints = (s: PcbShape): Vec2[] => {
  const pts: Vec2[] = [];
  if (s.start) pts.push(s.start);
  if (s.end) pts.push(s.end);
  if (s.mid) pts.push(s.mid);
  if (s.center) pts.push(s.center);
  if (s.pts) pts.push(...s.pts);
  if (s.kind === 'circle' && s.center && s.end) {
    const rr = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    pts.push(
      { x: s.center.x - rr, y: s.center.y - rr },
      { x: s.center.x + rr, y: s.center.y + rr },
    );
  }
  return pts;
};

const bboxOf = (pts: Vec2[]): FpBBox | null => {
  if (pts.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

/** Bounding box of one item (for drawing a selection highlight), or null. */
export function fpItemBBox(fp: PcbFootprint, id: string): FpBBox | null {
  const ref = parseFpItemId(id);
  if (!ref) return null;
  if (ref.kind === 'pad') {
    const p = fp.pads[ref.index];
    return p ? bboxOf(padPoints(p)) : null;
  }
  if (ref.kind === 'shape') {
    const s = fp.shapes[ref.index];
    return s ? bboxOf(shapePoints(s)) : null;
  }
  const t = fp.texts[ref.index];
  if (!t) return null;
  const hw = Math.max(t.text.length, 1) * t.size.x * 0.6,
    hh = t.size.y / 2;
  return { minX: t.at.x - hw, minY: t.at.y - hh, maxX: t.at.x + hw, maxY: t.at.y + hh };
}

/** Bounding box of a footprint's drawable geometry (pads + graphics + text anchors). */
export function footprintBBox(fp: PcbFootprint): FpBBox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const pad of fp.pads) padPoints(pad).forEach(grow);
  for (const s of fp.shapes) shapePoints(s).forEach(grow);
  for (const t of fp.texts) if (!t.hide) grow(t.at);
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

// ----- hit testing ------------------------------------------------------------

const distToSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

export const padHit = (pad: PcbPad, pos: Vec2, tol: number): boolean => {
  // Transform into pad-local frame (undo translate + rotation).
  const d = { x: pos.x - pad.at.x, y: pos.y - pad.at.y };
  const l = pad.angle ? rotatePcb(d, pad.angle) : d;
  return Math.abs(l.x) <= pad.size.x / 2 + tol && Math.abs(l.y) <= pad.size.y / 2 + tol;
};

/** Board-absolute bounding box of a single pad (for board-level selection). */
export const padBBox = (pad: PcbPad): FpBBox | null => bboxOf(padPoints(pad));

const shapeHit = (s: PcbShape, pos: Vec2, tol: number): boolean => {
  const t = tol + s.width / 2;
  if (s.kind === 'line' && s.start && s.end) return distToSeg(pos, s.start, s.end) <= t;
  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    const d = Math.hypot(pos.x - s.center.x, pos.y - s.center.y);
    return s.fill ? d <= r + t : Math.abs(d - r) <= t;
  }
  if (s.kind === 'rect' && s.start && s.end) {
    const x0 = Math.min(s.start.x, s.end.x),
      x1 = Math.max(s.start.x, s.end.x);
    const y0 = Math.min(s.start.y, s.end.y),
      y1 = Math.max(s.start.y, s.end.y);
    if (s.fill) return pos.x >= x0 - t && pos.x <= x1 + t && pos.y >= y0 - t && pos.y <= y1 + t;
    const near = Math.min(
      Math.abs(pos.x - x0),
      Math.abs(pos.x - x1),
      Math.abs(pos.y - y0),
      Math.abs(pos.y - y1),
    );
    return near <= t && pos.x >= x0 - t && pos.x <= x1 + t && pos.y >= y0 - t && pos.y <= y1 + t;
  }
  const pts = shapePoints(s);
  for (let i = 1; i < pts.length; i++) if (distToSeg(pos, pts[i - 1]!, pts[i]!) <= t) return true;
  return false;
};

const textHit = (tx: PcbTextItem, pos: Vec2, tol: number): boolean => {
  const hw = Math.max(tx.text.length, 1) * tx.size.x * 0.6 + tol;
  const hh = tx.size.y / 2 + tol;
  return Math.abs(pos.x - tx.at.x) <= hw && Math.abs(pos.y - tx.at.y) <= hh;
};

/** Topmost item id at `pos` (texts, then pads, then graphics), or null. */
export function hitTestFootprint(fp: PcbFootprint, pos: Vec2, tol: number): string | null {
  for (let i = fp.texts.length - 1; i >= 0; i--)
    if (!fp.texts[i]!.hide && textHit(fp.texts[i]!, pos, tol)) return fpItemId('text', i);
  for (let i = fp.pads.length - 1; i >= 0; i--)
    if (padHit(fp.pads[i]!, pos, tol)) return fpItemId('pad', i);
  for (let i = fp.shapes.length - 1; i >= 0; i--)
    if (shapeHit(fp.shapes[i]!, pos, tol)) return fpItemId('shape', i);
  return null;
}

/** Every item id whose geometry falls inside the given rectangle (box select). */
export function itemsInBox(
  fp: PcbFootprint,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const inside = (p: Vec2): boolean => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  const out: string[] = [];
  fp.pads.forEach((pad, i) => {
    if (padPoints(pad).some(inside)) out.push(fpItemId('pad', i));
  });
  fp.shapes.forEach((s, i) => {
    if (shapePoints(s).some(inside)) out.push(fpItemId('shape', i));
  });
  fp.texts.forEach((t, i) => {
    if (!t.hide && inside(t.at)) out.push(fpItemId('text', i));
  });
  return out;
}

// ----- transforms -------------------------------------------------------------

type PadT = (p: PcbPad) => PcbPad;
type ShapeT = (s: PcbShape) => PcbShape;
type TextT = (t: PcbTextItem) => PcbTextItem;

/** Apply per-kind transforms to just the selected items. */
function mapSelected(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  tp: PadT,
  ts: ShapeT,
  tt: TextT,
): PcbFootprint {
  const sel = new Set<string>();
  for (const id of ids) if (parseFpItemId(id)) sel.add(id);
  return {
    ...fp,
    pads: fp.pads.map((p, i) => (sel.has(fpItemId('pad', i)) ? tp(p) : p)),
    shapes: fp.shapes.map((s, i) => (sel.has(fpItemId('shape', i)) ? ts(s) : s)),
    texts: fp.texts.map((t, i) => (sel.has(fpItemId('text', i)) ? tt(t) : t)),
  };
}

const movePad =
  (delta: Vec2): PadT =>
  (p) => {
    const at = { x: p.at.x + delta.x, y: p.at.y + delta.y };
    return { ...p, at, source: patchChild(p.source, 'at', atNode(at, p.angle)) };
  };
const moveText =
  (delta: Vec2): TextT =>
  (t) => {
    const at = { x: t.at.x + delta.x, y: t.at.y + delta.y };
    return { ...t, at, source: patchChild(t.source, 'at', atNode(at, t.angle)) };
  };
const moveShape =
  (delta: Vec2): ShapeT =>
  (s) =>
    shiftShape(s, (p) => ({ x: p.x + delta.x, y: p.y + delta.y }));

/** Apply a point transform to every coordinate of a shape and patch its source. */
function shiftShape(s: PcbShape, fn: (p: Vec2) => Vec2): PcbShape {
  let src = s.source;
  const next: PcbShape = { ...s };
  if (s.center) {
    next.center = fn(s.center);
    src = patchChild(src, 'center', xyNode('center', next.center));
  }
  if (s.start) {
    next.start = fn(s.start);
    src = patchChild(src, 'start', xyNode('start', next.start));
  }
  if (s.end) {
    next.end = fn(s.end);
    src = patchChild(src, 'end', xyNode('end', next.end));
  }
  if (s.mid) {
    next.mid = fn(s.mid);
    src = patchChild(src, 'mid', xyNode('mid', next.mid));
  }
  if (s.pts) {
    next.pts = s.pts.map(fn);
    src = patchChild(src, 'pts', ptsNode(next.pts));
  }
  next.source = src;
  return next;
}

export function moveFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  delta: Vec2,
): PcbFootprint {
  if ((delta.x === 0 && delta.y === 0) || ids.size === 0) return fp;
  return mapSelected(fp, ids, movePad(delta), moveShape(delta), moveText(delta));
}

export function rotateFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  ccw: boolean,
  center: Vec2,
): PcbFootprint {
  if (ids.size === 0) return fp;
  const deg = ccw ? 90 : -90;
  const tp: PadT = (p) => {
    const at = rotAbout(p.at, center, deg);
    const angle = norm360(p.angle + deg);
    return { ...p, at, angle, source: patchChild(p.source, 'at', atNode(at, angle)) };
  };
  const tt: TextT = (t) => {
    const at = rotAbout(t.at, center, deg);
    const angle = norm360(t.angle + deg);
    return { ...t, at, angle, source: patchChild(t.source, 'at', atNode(at, angle)) };
  };
  const ts: ShapeT = (s) => shiftShape(s, (p) => rotAbout(p, center, deg));
  return mapSelected(fp, ids, tp, ts, tt);
}

export function mirrorFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  center: Vec2,
): PcbFootprint {
  if (ids.size === 0) return fp;
  const cx = center.x;
  const tp: PadT = (p) => {
    const at = mirrorX(p.at, cx);
    const angle = norm360(180 - p.angle);
    return { ...p, at, angle, source: patchChild(p.source, 'at', atNode(at, angle)) };
  };
  const tt: TextT = (t) => {
    const at = mirrorX(t.at, cx);
    return { ...t, at, mirror: !t.mirror, source: patchChild(t.source, 'at', atNode(at, t.angle)) };
  };
  const ts: ShapeT = (s) => shiftShape(s, (p) => mirrorX(p, cx));
  return mapSelected(fp, ids, tp, ts, tt);
}

// ----- add / delete -----------------------------------------------------------

/** Remove the selected items (delete tool / Del key). */
export function deleteFootprintItems(fp: PcbFootprint, ids: ReadonlySet<string>): PcbFootprint {
  const del = { pad: new Set<number>(), shape: new Set<number>(), text: new Set<number>() };
  for (const id of ids) {
    const r = parseFpItemId(id);
    if (r) del[r.kind].add(r.index);
  }
  return {
    ...fp,
    pads: fp.pads.filter((_, i) => !del.pad.has(i)),
    shapes: fp.shapes.filter((_, i) => !del.shape.has(i)),
    texts: fp.texts.filter((_, i) => !del.text.has(i)),
  };
}

export const addPad = (fp: PcbFootprint, pad: PcbPad): PcbFootprint => ({
  ...fp,
  pads: [...fp.pads, pad],
});
export const addShape = (fp: PcbFootprint, shape: PcbShape): PcbFootprint => ({
  ...fp,
  shapes: [...fp.shapes, shape],
});
export const addText = (fp: PcbFootprint, text: PcbTextItem): PcbFootprint => ({
  ...fp,
  texts: [...fp.texts, text],
});

// ----- footprint properties (Reference / Value / Description / Keywords) ------

/** Replace the index-th positional item of a source node with a string. */
function patchArg(src: SList, index: number, value: string): SList {
  if (src.items.length <= index) return src;
  const items = src.items.slice();
  items[index] = str(value);
  return { kind: 'list', items };
}

/** Patch a Reference/Value text's stored string: `(property "Reference" VAL …)`
 *  or `(fp_text reference VAL …)` — the value is the 3rd positional in both. */
function patchTextValue(src: SList, value: string): SList {
  if (src.items.length === 0) return src; // new item: buildTextNode uses .text
  return patchArg(src, 2, value);
}

const setRefOrVal = (
  fp: PcbFootprint,
  kind: 'reference' | 'value',
  value: string,
): PcbFootprint => ({
  ...fp,
  ...(kind === 'reference' ? { reference: value } : { value }),
  texts: fp.texts.map((t) =>
    t.kind === kind ? { ...t, text: value, source: patchTextValue(t.source, value) } : t,
  ),
});

export const setFootprintReference = (fp: PcbFootprint, value: string): PcbFootprint =>
  setRefOrVal(fp, 'reference', value);
export const setFootprintValue = (fp: PcbFootprint, value: string): PcbFootprint =>
  setRefOrVal(fp, 'value', value);

/** Set a top-level single-string child of the footprint node (descr / tags). */
function setFootprintStringChild(fp: PcbFootprint, name: string, value: string): PcbFootprint {
  const src = fp.source;
  if (src.items.length === 0) return fp; // built-from-scratch footprints carry no source yet
  return { ...fp, source: patchChild(src, name, list(atom(name), str(value))) };
}

export const setFootprintDescription = (fp: PcbFootprint, value: string): PcbFootprint =>
  setFootprintStringChild(fp, 'descr', value);
export const setFootprintKeywords = (fp: PcbFootprint, value: string): PcbFootprint =>
  setFootprintStringChild(fp, 'tags', value);

/** Read the footprint's `(descr …)` / `(tags …)` text for the properties dialog. */
export function footprintStringChild(fp: PcbFootprint, name: string): string {
  for (const it of fp.source.items) {
    if (isList(it) && head(it) === name) {
      const v = it.items[1];
      return v && v.kind === 'string' ? v.value : v && v.kind === 'atom' ? v.value : '';
    }
  }
  return '';
}

// ----- pad properties ---------------------------------------------------------

export interface PadEdit {
  number?: string;
  type?: PadType;
  shape?: PadShape;
  at?: Vec2;
  angle?: number;
  size?: Vec2;
  /** A drill spec, or null to remove the drill (SMD pads). */
  drill?: { oblong: boolean; w: number; h: number } | null;
  layers?: string[];
}

const patchArgAtom = (src: SList, index: number, value: string): SList => {
  if (src.items.length <= index) return src;
  const items = src.items.slice();
  items[index] = atom(value);
  return { kind: 'list', items };
};

const removeChild = (src: SList, name: string): SList => ({
  kind: 'list',
  items: src.items.filter((it) => !(isList(it) && head(it) === name)),
});

const drillNode = (d: { oblong: boolean; w: number; h: number }): SList => {
  const items: SList['items'] = [atom('drill')];
  if (d.oblong) items.push(atom('oval'));
  if (d.w > 0) items.push(atom(mm(d.w)));
  if (d.oblong && d.h > 0 && d.h !== d.w) items.push(atom(mm(d.h)));
  return { kind: 'list', items };
};

/**
 * Apply a pad-properties edit, patching the pad's source node field-by-field so
 * every unmodelled property (pinfunction, custom primitives, margins…) survives
 * (DIALOG_PAD_PROPERTIES::TransferDataFromWindow). A source-less (just-placed)
 * pad is left for the canonical writer to build.
 */
export function patchPad(pad: PcbPad, e: PadEdit): PcbPad {
  const next: PcbPad = { ...pad };
  let src = pad.source;
  const hasSrc = src.items.length > 0;
  if (e.number !== undefined) {
    next.number = e.number;
    if (hasSrc) src = patchArg(src, 1, e.number);
  }
  if (e.type !== undefined) {
    next.type = e.type;
    if (hasSrc) src = patchArgAtom(src, 2, e.type);
  }
  if (e.shape !== undefined) {
    next.shape = e.shape;
    if (hasSrc) src = patchArgAtom(src, 3, e.shape);
  }
  if (e.angle !== undefined) next.angle = e.angle;
  if (e.at !== undefined || e.angle !== undefined) {
    next.at = e.at ?? pad.at;
    if (hasSrc) src = patchChild(src, 'at', atNode(next.at, next.angle));
  }
  if (e.size !== undefined) {
    next.size = e.size;
    if (hasSrc)
      src = patchChild(src, 'size', list(atom('size'), atom(mm(e.size.x)), atom(mm(e.size.y))));
  }
  if (e.drill !== undefined) {
    next.drill = e.drill ?? undefined;
    if (hasSrc)
      src = e.drill ? patchChild(src, 'drill', drillNode(e.drill)) : removeChild(src, 'drill');
  }
  if (e.layers !== undefined) {
    next.layers = e.layers;
    if (hasSrc)
      src = patchChild(src, 'layers', {
        kind: 'list',
        items: [atom('layers'), ...e.layers.map((l) => str(l))],
      });
  }
  next.source = src;
  return next;
}

/** Replace one item wholesale (a dialog edit); caller supplies a source-consistent item. */
export function replaceFootprintItem(
  fp: PcbFootprint,
  id: string,
  item: PcbPad | PcbShape | PcbTextItem,
): PcbFootprint {
  const ref = parseFpItemId(id);
  if (!ref) return fp;
  if (ref.kind === 'pad')
    return { ...fp, pads: fp.pads.map((p, i) => (i === ref.index ? (item as PcbPad) : p)) };
  if (ref.kind === 'shape')
    return { ...fp, shapes: fp.shapes.map((s, i) => (i === ref.index ? (item as PcbShape) : s)) };
  return { ...fp, texts: fp.texts.map((t, i) => (i === ref.index ? (item as PcbTextItem) : t)) };
}
