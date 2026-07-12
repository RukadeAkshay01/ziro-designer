/**
 * Board-level hit-testing, bounding boxes and item identity — the geometry
 * behind KiCad's PCB_SELECTION_TOOL (pcbnew/tools/pcb_selection_tool.cpp) and the
 * per-item BOARD_ITEM::HitTest overrides. This is the foundation the board
 * editing tools build on: every click, box-select and highlight resolves through
 * here. Pure functions over the typed `Board`; no rendering or React.
 *
 * Faithful to KiCad 10.0.0 HitTest math:
 *   - PCB_TRACK::HitTest  — point-to-segment distance <= accuracy + width/2.
 *   - PCB_ARC::HitTest    — endpoint short-circuit, then |dist-radius| <= acc+w/2
 *                           AND the point's angle lies within the arc sweep.
 *   - PCB_VIA::HitTest     — distance from centre <= accuracy + width/2.
 *   - FOOTPRINT::HitTest   — bbox.Inflate(accuracy).Contains(pos) (the simple,
 *                            non-accurate variant the selection tool uses first).
 *   - EDA_SHAPE::hitTest   — per shape kind (segment / arc / circle / rect border
 *                            vs. filled / polygon edges).
 *   - PCB_TEXT / ZONE      — text bounding box; point-in-filled-polygon.
 *
 * A board is a flat set of items across typed arrays; an item is addressed by a
 * stable `${kind}:${index}` id (mirrors the Footprint Editor's id scheme so the
 * two canvases share selection conventions). A footprint selects as a whole —
 * clicking any of its geometry yields the footprint, matching pcbnew's default
 * (KiCad selects the FOOTPRINT, not its pad, unless you alt/nested-select).
 */

import { atom, isList, head, type SList, type SNode } from '../sexpr/index.js';
import { iuToMM } from '../units.js';
import { arcCenter } from './read-board.js';
import { footprintBBox } from './edit-footprint.js';
import type { Board, PcbFootprint, PcbTrack, PcbArcTrack, PcbVia, PcbShape, PcbTextItem, PcbZone } from './types.js';
import type { Vec2 } from '../model/types.js';

// ----- item ids ---------------------------------------------------------------

export type BoardItemKind = 'track' | 'arc' | 'via' | 'footprint' | 'zone' | 'shape' | 'text';
export interface BoardItemRef { kind: BoardItemKind; index: number }

const KINDS: ReadonlySet<string> = new Set<BoardItemKind>(['track', 'arc', 'via', 'footprint', 'zone', 'shape', 'text']);

export const boardItemId = (kind: BoardItemKind, index: number): string => `${kind}:${index}`;

export function parseBoardItemId(id: string): BoardItemRef | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const kind = id.slice(0, i);
  const index = Number(id.slice(i + 1));
  if (KINDS.has(kind) && Number.isInteger(index) && index >= 0) {
    return { kind: kind as BoardItemKind, index };
  }
  return null;
}

// ----- geometry helpers -------------------------------------------------------

/** Distance from `p` to segment `a`–`b` (KiCad TestSegmentHit's core). */
const distToSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const TWO_PI = Math.PI * 2;
/** CCW angular distance from `from` to `to`, in [0, 2π). */
const ccwSpan = (from: number, to: number): number => {
  let d = to - from;
  while (d < 0) d += TWO_PI;
  while (d >= TWO_PI) d -= TWO_PI;
  return d;
};

// ----- bounding box -----------------------------------------------------------

export interface BoardBBox { minX: number; minY: number; maxX: number; maxY: number }

const growBox = (b: BoardBBox, p: Vec2): void => {
  if (p.x < b.minX) b.minX = p.x; if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x; if (p.y > b.maxY) b.maxY = p.y;
};
const emptyBox = (): BoardBBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const isEmpty = (b: BoardBBox): boolean => b.minX > b.maxX;
const inflate = (b: BoardBBox, d: number): BoardBBox => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const bboxArea = (b: BoardBBox): number => (isEmpty(b) ? Infinity : (b.maxX - b.minX) * (b.maxY - b.minY));
const boxContainsPt = (b: BoardBBox, p: Vec2): boolean => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const boxContainsBox = (o: BoardBBox, i: BoardBBox): boolean => o.minX <= i.minX && o.minY <= i.minY && o.maxX >= i.maxX && o.maxY >= i.maxY;
const boxIntersects = (a: BoardBBox, b: BoardBBox): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Every explicit point of a shape (endpoints/centre/pts), plus a circle's extent. */
const shapePoints = (s: PcbShape): Vec2[] => {
  const pts: Vec2[] = [];
  if (s.start) pts.push(s.start);
  if (s.end) pts.push(s.end);
  if (s.mid) pts.push(s.mid);
  if (s.center) pts.push(s.center);
  if (s.pts) pts.push(...s.pts);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = dist(s.center, s.end);
    pts.push({ x: s.center.x - r, y: s.center.y - r }, { x: s.center.x + r, y: s.center.y + r });
  }
  return pts;
};

const shapeBBox = (s: PcbShape): BoardBBox => {
  const b = emptyBox();
  for (const p of shapePoints(s)) growBox(b, p);
  return inflate(b, s.width / 2);
};

const textBBox = (t: PcbTextItem): BoardBBox => {
  const hw = Math.max(t.text.length, 1) * t.size.x * 0.6;
  const hh = t.size.y / 2;
  return { minX: t.at.x - hw, minY: t.at.y - hh, maxX: t.at.x + hw, maxY: t.at.y + hh };
};

const zoneBBox = (z: PcbZone): BoardBBox => {
  const b = emptyBox();
  for (const f of z.fills) for (const poly of f.polys) for (const p of poly) growBox(b, p);
  return b;
};

/** Bounding box of one board item (for the selection highlight), or null. */
export function boardItemBBox(board: Board, id: string): BoardBBox | null {
  const ref = parseBoardItemId(id);
  if (!ref) return null;
  switch (ref.kind) {
    case 'track': {
      const t = board.tracks[ref.index]; if (!t) return null;
      const b = emptyBox(); growBox(b, t.start); growBox(b, t.end); return inflate(b, t.width / 2);
    }
    case 'arc': {
      const a = board.arcs[ref.index]; if (!a) return null;
      const b = emptyBox(); growBox(b, a.start); growBox(b, a.mid); growBox(b, a.end); return inflate(b, a.width / 2);
    }
    case 'via': {
      const v = board.vias[ref.index]; if (!v) return null;
      const r = v.size / 2;
      return { minX: v.at.x - r, minY: v.at.y - r, maxX: v.at.x + r, maxY: v.at.y + r };
    }
    case 'footprint': {
      const f = board.footprints[ref.index]; if (!f) return null;
      return footprintBBox(f);
    }
    case 'zone': {
      const z = board.zones[ref.index]; if (!z) return null;
      const b = zoneBBox(z); return isEmpty(b) ? null : b;
    }
    case 'shape': {
      const s = board.shapes[ref.index]; if (!s) return null;
      const b = shapeBBox(s); return isEmpty(b) ? null : b;
    }
    case 'text': {
      const t = board.texts[ref.index]; return t ? textBBox(t) : null;
    }
  }
}

// ----- per-item hit tests -----------------------------------------------------

/** PCB_ARC::HitTest — endpoint short-circuit, radial band, then angle in sweep. */
const arcHit = (start: Vec2, mid: Vec2, end: Vec2, width: number, pos: Vec2, tol: number): boolean => {
  const maxDist = tol + width / 2;
  if (dist(start, pos) <= maxDist || dist(end, pos) <= maxDist) return true;
  const c = arcCenter(start, mid, end);
  if (!c) return distToSeg(pos, start, end) <= maxDist; // degenerate/collinear
  const radius = dist(c, start);
  if (Math.abs(dist(c, pos) - radius) > maxDist) return false;
  // Angle must lie on the arc's start→mid→end sweep (direction chosen by mid).
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  const ap = Math.atan2(pos.y - c.y, pos.x - c.x);
  const sweepCCW = ccwSpan(a0, a1);
  if (ccwSpan(a0, am) <= sweepCCW) return ccwSpan(a0, ap) <= sweepCCW; // CCW arc
  return ccwSpan(ap, a0) <= ccwSpan(a1, a0); // CW arc
};

/** EDA_SHAPE::hitTest — per shape kind. */
const shapeHit = (s: PcbShape, pos: Vec2, tol: number): boolean => {
  const t = tol + s.width / 2;
  if (s.kind === 'line' && s.start && s.end) return distToSeg(pos, s.start, s.end) <= t;
  if (s.kind === 'arc' && s.start && s.mid && s.end) return arcHit(s.start, s.mid, s.end, s.width, pos, tol);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = dist(s.center, s.end);
    const d = dist(s.center, pos);
    return s.fill ? d <= r + t : Math.abs(d - r) <= t;
  }
  if (s.kind === 'rect' && s.start && s.end) {
    const x0 = Math.min(s.start.x, s.end.x), x1 = Math.max(s.start.x, s.end.x);
    const y0 = Math.min(s.start.y, s.end.y), y1 = Math.max(s.start.y, s.end.y);
    if (pos.x < x0 - t || pos.x > x1 + t || pos.y < y0 - t || pos.y > y1 + t) return false;
    if (s.fill) return true;
    // Unfilled: only the border is live.
    const near = Math.min(Math.abs(pos.x - x0), Math.abs(pos.x - x1), Math.abs(pos.y - y0), Math.abs(pos.y - y1));
    return near <= t;
  }
  // poly / curve: nearest edge, plus interior when filled.
  const pts = s.pts ?? shapePoints(s);
  if (s.fill && pts.length >= 3 && pointInPolygon(pos, pts)) return true;
  for (let i = 1; i < pts.length; i++) if (distToSeg(pos, pts[i - 1]!, pts[i]!) <= t) return true;
  if (pts.length >= 3 && distToSeg(pos, pts[pts.length - 1]!, pts[0]!) <= t) return true;
  return false;
};

/** Even-odd ray cast: is `p` inside polygon `poly`. */
const pointInPolygon = (p: Vec2, poly: Vec2[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const zoneHit = (z: PcbZone, pos: Vec2, tol: number): boolean => {
  for (const f of z.fills) for (const poly of f.polys) {
    if (poly.length >= 3 && pointInPolygon(pos, poly)) return true;
    for (let i = 1; i < poly.length; i++) if (distToSeg(pos, poly[i - 1]!, poly[i]!) <= tol) return true;
  }
  return false;
};

// ----- collection & priority --------------------------------------------------

/** Ordering weight for disambiguation — small items beat large containers, so a
 *  track over a footprint/zone wins (approximates GENERAL_COLLECTOR's preference
 *  for connected/smaller items in PCB_SELECTION_TOOL::guessSelectionCandidates). */
const typeRank = (kind: BoardItemKind): number => (kind === 'zone' ? 2 : kind === 'footprint' ? 1 : 0);

/**
 * Every board item hit at `pos` within `tol`, best candidate first (smallest,
 * most-specific item wins). `tol` is in internal units — the editor derives it
 * from a few screen pixels at the current zoom (KiCad's COLLECTORS_GUIDE
 * accuracy). Used both for click-select (take [0]) and disambiguation menus.
 */
export function boardHitCandidates(board: Board, pos: Vec2, tol: number): string[] {
  const hits: { id: string; kind: BoardItemKind; area: number }[] = [];
  const add = (kind: BoardItemKind, index: number): void => {
    const id = boardItemId(kind, index);
    const b = boardItemBBox(board, id);
    hits.push({ id, kind, area: b ? bboxArea(b) : Infinity });
  };

  board.vias.forEach((v, i) => { if (dist(pos, v.at) <= tol + v.size / 2) add('via', i); });
  board.tracks.forEach((t, i) => { if (distToSeg(pos, t.start, t.end) <= tol + t.width / 2) add('track', i); });
  board.arcs.forEach((a, i) => { if (arcHit(a.start, a.mid, a.end, a.width, pos, tol)) add('arc', i); });
  board.texts.forEach((t, i) => { if (boxContainsPt(inflate(textBBox(t), tol), pos)) add('text', i); });
  board.shapes.forEach((s, i) => { if (shapeHit(s, pos, tol)) add('shape', i); });
  board.zones.forEach((z, i) => { if (zoneHit(z, pos, tol)) add('zone', i); });
  board.footprints.forEach((f, i) => {
    const b = footprintBBox(f);
    if (b && boxContainsPt(inflate(b, tol), pos)) add('footprint', i);
  });

  hits.sort((a, b) => (typeRank(a.kind) - typeRank(b.kind)) || (a.area - b.area));
  return hits.map((h) => h.id);
}

/** Topmost board item at `pos` (the click-select winner), or null. */
export function hitTestBoard(board: Board, pos: Vec2, tol: number): string | null {
  return boardHitCandidates(board, pos, tol)[0] ?? null;
}

// ----- box-select geometry (mirrors each BOARD_ITEM::HitTest(BOX2I)) ----------

/** Do segments a-b and c-d intersect? (orientation test.) */
const segSeg = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const o = (p: Vec2, q: Vec2, r: Vec2): number => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const onSeg = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  return (o1 === 0 && onSeg(a, c, b)) || (o2 === 0 && onSeg(a, d, b)) || (o3 === 0 && onSeg(c, a, d)) || (o4 === 0 && onSeg(c, b, d));
};

/** Does segment a-b intersect (or lie inside) `r`? */
const segInRect = (r: BoardBBox, a: Vec2, b: Vec2): boolean => {
  if (boxContainsPt(r, a) || boxContainsPt(r, b)) return true;
  const c1 = { x: r.minX, y: r.minY }, c2 = { x: r.maxX, y: r.minY }, c3 = { x: r.maxX, y: r.maxY }, c4 = { x: r.minX, y: r.maxY };
  return segSeg(a, b, c1, c2) || segSeg(a, b, c2, c3) || segSeg(a, b, c3, c4) || segSeg(a, b, c4, c1);
};

/** Does the circle (centre, radius) intersect rect `r`? (nearest-point test.) */
const circleInRect = (r: BoardBBox, c: Vec2, radius: number): boolean => {
  const nx = Math.max(r.minX, Math.min(c.x, r.maxX));
  const ny = Math.max(r.minY, Math.min(c.y, r.maxY));
  return Math.hypot(c.x - nx, c.y - ny) <= radius;
};

/** Does rect `r` cross polygon `poly` (edge crossing, or one contains the other)? */
const polyInRect = (r: BoardBBox, poly: Vec2[]): boolean => {
  if (poly.length < 2) return false;
  for (const p of poly) if (boxContainsPt(r, p)) return true;           // a vertex inside the rect
  if (pointInPolygon({ x: r.minX, y: r.minY }, poly)) return true;      // rect inside the polygon
  for (let i = 0; i < poly.length; i++) {
    if (segInRect(r, poly[i]!, poly[(i + 1) % poly.length]!)) return true;
  }
  return false;
};

/**
 * Every board item selected by a rubber-band from (x0,y0) to (x1,y1). KiCad's
 * two modes: `contained` (drag left→right — window select, item fully inside)
 * vs. crossing (drag right→left — item merely intersects). Each item mirrors its
 * own BOARD_ITEM::HitTest(BOX2I): a track by its endpoints (not its width),
 * a via by its circle, an arc/footprint/graphic by geometry-or-bbox.
 */
export function boardItemsInBox(
  board: Board, x0: number, y0: number, x1: number, y1: number, contained: boolean,
): string[] {
  const rect: BoardBBox = { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
  const out: string[] = [];
  const push = (kind: BoardItemKind, i: number): void => { out.push(boardItemId(kind, i)); };
  // Item's bbox is fully inside the rect (the shared `contained` fast path).
  const bboxContained = (kind: BoardItemKind, i: number): boolean => {
    const b = boardItemBBox(board, boardItemId(kind, i));
    return !!b && !isEmpty(b) && boxContainsBox(rect, b);
  };

  board.tracks.forEach((t, i) => {
    const hit = contained
      ? boxContainsPt(rect, t.start) && boxContainsPt(rect, t.end)   // PCB_TRACK: endpoints
      : segInRect(rect, t.start, t.end);
    if (hit) push('track', i);
  });
  board.arcs.forEach((a, i) => {                                     // PCB_ARC: bbox of s/m/e + w/2
    const b = boardItemBBox(board, boardItemId('arc', i))!;
    if (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b)) push('arc', i);
  });
  board.vias.forEach((v, i) => {
    const hit = contained ? bboxContained('via', i) : circleInRect(rect, v.at, v.size / 2);
    if (hit) push('via', i);
  });
  board.footprints.forEach((_, i) => {                              // FOOTPRINT: bbox contain/intersect
    const b = boardItemBBox(board, boardItemId('footprint', i));
    if (b && (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b))) push('footprint', i);
  });
  board.shapes.forEach((s, i) => {
    if (contained) { if (bboxContained('shape', i)) push('shape', i); return; }
    if (s.kind === 'line' && s.start && s.end) { if (segInRect(rect, s.start, s.end)) push('shape', i); return; }
    const b = boardItemBBox(board, boardItemId('shape', i));
    if (b && boxIntersects(rect, b)) push('shape', i);
  });
  board.texts.forEach((_, i) => {
    const b = boardItemBBox(board, boardItemId('text', i))!;
    if (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b)) push('text', i);
  });
  board.zones.forEach((z, i) => {
    if (contained) { if (bboxContained('zone', i)) push('zone', i); return; }
    if (z.fills.some((f) => f.polys.some((p) => polyInRect(rect, p)))) push('zone', i);
  });
  return out;
}

// ----- move (PCB_MOVE_TOOL / EDIT_TOOL::Move) ---------------------------------
//
// Source-patched exactly like edit-footprint.ts: an edited item keeps its
// `source` node and only the changed coordinate child (`(start …)`, `(at …)`,
// `(pts …)`) is rewritten, so serializeBoard round-trips every unmodelled field.

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Internal units -> trimmed millimetre string (KiCad formatInternalUnits). */
const mm = (iu: number): string => {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

/** Replace (or append) the first `name` child of a source node. */
function patchChild(src: SList, name: string, node: SList): SList {
  let replaced = false;
  const items = src.items.map((it) => {
    if (!replaced && isList(it) && head(it) === name) { replaced = true; return node; }
    return it;
  });
  if (!replaced) items.push(node);
  return { kind: 'list', items };
}

const atNode = (p: Vec2, angle = 0): SList =>
  angle ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
        : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));
const xyNode = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));
const ptsNode = (pts: Vec2[]): SList => ({
  kind: 'list', items: [atom('pts'), ...pts.map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y))))],
});

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

const moveTrack = (t: PcbTrack, d: Vec2): PcbTrack => {
  const start = add(t.start, d), end = add(t.end, d);
  let src = patchChild(t.source, 'start', xyNode('start', start));
  src = patchChild(src, 'end', xyNode('end', end));
  return { ...t, start, end, source: src };
};

const moveArc = (a: PcbArcTrack, d: Vec2): PcbArcTrack => {
  const start = add(a.start, d), mid = add(a.mid, d), end = add(a.end, d);
  let src = patchChild(a.source, 'start', xyNode('start', start));
  src = patchChild(src, 'mid', xyNode('mid', mid));
  src = patchChild(src, 'end', xyNode('end', end));
  return { ...a, start, mid, end, source: src };
};

const moveVia = (v: PcbVia, d: Vec2): PcbVia => {
  const at = add(v.at, d);
  return { ...v, at, source: patchChild(v.source, 'at', atNode(at)) };
};

const moveText = (t: PcbTextItem, d: Vec2): PcbTextItem => {
  const at = add(t.at, d);
  return { ...t, at, source: patchChild(t.source, 'at', atNode(at, t.angle)) };
};

/** Shift every coordinate of a board graphic and patch its source in place. */
const moveShape = (s: PcbShape, d: Vec2): PcbShape => {
  let src = s.source;
  const next: PcbShape = { ...s };
  if (s.center) { next.center = add(s.center, d); src = patchChild(src, 'center', xyNode('center', next.center)); }
  if (s.start) { next.start = add(s.start, d); src = patchChild(src, 'start', xyNode('start', next.start)); }
  if (s.end) { next.end = add(s.end, d); src = patchChild(src, 'end', xyNode('end', next.end)); }
  if (s.mid) { next.mid = add(s.mid, d); src = patchChild(src, 'mid', xyNode('mid', next.mid)); }
  if (s.pts) { next.pts = s.pts.map((p) => add(p, d)); src = patchChild(src, 'pts', ptsNode(next.pts)); }
  next.source = src;
  return next;
};

/**
 * Move a whole footprint: only its anchor `(at …)` is patched in the source
 * (children stay in the footprint's local frame, exactly as the writer emits
 * them). The model's board-absolute child coordinates are shifted too, so
 * hit-testing and rendering follow the footprint to its new spot.
 */
const moveFootprint = (fp: PcbFootprint, d: Vec2): PcbFootprint => ({
  ...fp,
  at: add(fp.at, d),
  pads: fp.pads.map((p) => ({ ...p, at: add(p.at, d) })),
  texts: fp.texts.map((t) => ({ ...t, at: add(t.at, d) })),
  shapes: fp.shapes.map((s) => {
    const n: PcbShape = { ...s };
    if (s.center) n.center = add(s.center, d);
    if (s.start) n.start = add(s.start, d);
    if (s.end) n.end = add(s.end, d);
    if (s.mid) n.mid = add(s.mid, d);
    if (s.pts) n.pts = s.pts.map((p) => add(p, d));
    return n;
  }),
  source: patchChild(fp.source, 'at', atNode(add(fp.at, d), fp.angle)),
});

/**
 * Move the selected board items by `delta` (internal units). Mirrors
 * PCB_MOVE_TOOL committing a drag. Zones are not moved yet (their outline lives
 * in the source polygon; that lands with zone editing) — their ids are ignored.
 */
export function moveBoardItems(board: Board, ids: ReadonlySet<string>, delta: Vec2): Board {
  if ((delta.x === 0 && delta.y === 0) || ids.size === 0) return board;
  const idx: Record<BoardItemKind, Set<number>> = {
    track: new Set(), arc: new Set(), via: new Set(), footprint: new Set(),
    zone: new Set(), shape: new Set(), text: new Set(),
  };
  for (const id of ids) { const r = parseBoardItemId(id); if (r) idx[r.kind].add(r.index); }
  return {
    ...board,
    tracks: board.tracks.map((t, i) => (idx.track.has(i) ? moveTrack(t, delta) : t)),
    arcs: board.arcs.map((a, i) => (idx.arc.has(i) ? moveArc(a, delta) : a)),
    vias: board.vias.map((v, i) => (idx.via.has(i) ? moveVia(v, delta) : v)),
    shapes: board.shapes.map((s, i) => (idx.shape.has(i) ? moveShape(s, delta) : s)),
    texts: board.texts.map((t, i) => (idx.text.has(i) ? moveText(t, delta) : t)),
    footprints: board.footprints.map((f, i) => (idx.footprint.has(i) ? moveFootprint(f, delta) : f)),
  };
}
