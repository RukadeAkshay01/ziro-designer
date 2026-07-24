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

import { atom, str, isList, head, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { arcCenter, rotatePcb } from './read-board.js';
import { connectedTrackEnds } from './connectivity.js';
import { footprintBBox, padBBox } from './edit-footprint.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbTrack,
  PcbArcTrack,
  PcbVia,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbGroup,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- item ids ---------------------------------------------------------------

export type BoardItemKind =
  | 'track'
  | 'arc'
  | 'via'
  | 'footprint'
  | 'zone'
  | 'shape'
  | 'text'
  | 'fptext'
  | 'pad'
  | 'group';
export interface BoardItemRef {
  kind: BoardItemKind;
  index: number;
  /** For 'fptext'/'pad': the text/pad index within footprint `index`. */
  sub?: number;
}

const KINDS: ReadonlySet<string> = new Set<BoardItemKind>([
  'track',
  'arc',
  'via',
  'footprint',
  'zone',
  'shape',
  'text',
  'fptext',
  'pad',
  'group',
]);

// `fptext` and `pad` ids carry a second index (`<kind>:<footprint>:<sub>`), the
// text/pad within the footprint — pcbnew selects the child, not the footprint,
// when the Selection Filter allows it.
const SUB_KINDS: ReadonlySet<string> = new Set(['fptext', 'pad']);

/** `fptext`/`pad` ids carry a second index: `<kind>:<footprint>:<sub>`. */
export const boardItemId = (kind: BoardItemKind, index: number, sub?: number): string =>
  SUB_KINDS.has(kind) ? `${kind}:${index}:${sub ?? 0}` : `${kind}:${index}`;

export function parseBoardItemId(id: string): BoardItemRef | null {
  const parts = id.split(':');
  const kind = parts[0];
  if (!kind || !KINDS.has(kind)) return null;
  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0) return null;
  if (SUB_KINDS.has(kind)) {
    const sub = Number(parts[2]);
    if (!Number.isInteger(sub) || sub < 0) return null;
    return { kind: kind as BoardItemKind, index, sub };
  }
  return { kind: kind as BoardItemKind, index };
}

// ----- geometry helpers -------------------------------------------------------

/** Distance from `p` to segment `a`–`b` (KiCad TestSegmentHit's core). */
const distToSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
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

export interface BoardBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const growBox = (b: BoardBBox, p: Vec2): void => {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
};
const emptyBox = (): BoardBBox => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});
const isEmpty = (b: BoardBBox): boolean => b.minX > b.maxX;
const inflate = (b: BoardBBox, d: number): BoardBBox => ({
  minX: b.minX - d,
  minY: b.minY - d,
  maxX: b.maxX + d,
  maxY: b.maxY + d,
});
const bboxArea = (b: BoardBBox): number =>
  isEmpty(b) ? Infinity : (b.maxX - b.minX) * (b.maxY - b.minY);
const boxContainsPt = (b: BoardBBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const boxContainsBox = (o: BoardBBox, i: BoardBBox): boolean =>
  o.minX <= i.minX && o.minY <= i.minY && o.maxX >= i.maxX && o.maxY >= i.maxY;
const boxIntersects = (a: BoardBBox, b: BoardBBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

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
      const t = board.tracks[ref.index];
      if (!t) return null;
      const b = emptyBox();
      growBox(b, t.start);
      growBox(b, t.end);
      return inflate(b, t.width / 2);
    }
    case 'arc': {
      const a = board.arcs[ref.index];
      if (!a) return null;
      const b = emptyBox();
      growBox(b, a.start);
      growBox(b, a.mid);
      growBox(b, a.end);
      return inflate(b, a.width / 2);
    }
    case 'via': {
      const v = board.vias[ref.index];
      if (!v) return null;
      const r = v.size / 2;
      return { minX: v.at.x - r, minY: v.at.y - r, maxX: v.at.x + r, maxY: v.at.y + r };
    }
    case 'footprint': {
      const f = board.footprints[ref.index];
      if (!f) return null;
      return footprintBBox(f);
    }
    case 'zone': {
      const z = board.zones[ref.index];
      if (!z) return null;
      const b = zoneBBox(z);
      return isEmpty(b) ? null : b;
    }
    case 'shape': {
      const s = board.shapes[ref.index];
      if (!s) return null;
      const b = shapeBBox(s);
      return isEmpty(b) ? null : b;
    }
    case 'text': {
      const t = board.texts[ref.index];
      return t ? textBBox(t) : null;
    }
    case 'fptext': {
      const f = board.footprints[ref.index];
      const t = f?.texts[ref.sub ?? 0];
      return t ? textBBox(t) : null;
    }
    case 'pad': {
      const f = board.footprints[ref.index];
      const p = f?.pads[ref.sub ?? 0];
      return p ? padBBox(p) : null;
    }
    case 'group': {
      const g = board.groups[ref.index];
      if (!g) return null;
      const b = emptyBox();
      for (const mid of groupMemberIds(board, g)) {
        const ib = boardItemBBox(board, mid);
        if (ib && !isEmpty(ib)) {
          growBox(b, { x: ib.minX, y: ib.minY });
          growBox(b, { x: ib.maxX, y: ib.maxY });
        }
      }
      return isEmpty(b) ? null : b;
    }
  }
}

// ----- per-item hit tests -----------------------------------------------------

/** PCB_ARC::HitTest — endpoint short-circuit, radial band, then angle in sweep. */
const arcHit = (
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  width: number,
  pos: Vec2,
  tol: number,
): boolean => {
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
  if (s.kind === 'arc' && s.start && s.mid && s.end)
    return arcHit(s.start, s.mid, s.end, s.width, pos, tol);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = dist(s.center, s.end);
    const d = dist(s.center, pos);
    return s.fill ? d <= r + t : Math.abs(d - r) <= t;
  }
  if (s.kind === 'rect' && s.start && s.end) {
    const x0 = Math.min(s.start.x, s.end.x),
      x1 = Math.max(s.start.x, s.end.x);
    const y0 = Math.min(s.start.y, s.end.y),
      y1 = Math.max(s.start.y, s.end.y);
    if (pos.x < x0 - t || pos.x > x1 + t || pos.y < y0 - t || pos.y > y1 + t) return false;
    if (s.fill) return true;
    // Unfilled: only the border is live.
    const near = Math.min(
      Math.abs(pos.x - x0),
      Math.abs(pos.x - x1),
      Math.abs(pos.y - y0),
      Math.abs(pos.y - y1),
    );
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
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};

const zoneHit = (z: PcbZone, pos: Vec2, tol: number): boolean => {
  for (const f of z.fills)
    for (const poly of f.polys) {
      if (poly.length >= 3 && pointInPolygon(pos, poly)) return true;
      for (let i = 1; i < poly.length; i++)
        if (distToSeg(pos, poly[i - 1]!, poly[i]!) <= tol) return true;
    }
  return false;
};

// ----- collection & priority --------------------------------------------------
//
// Transcribed from PCB_SELECTION_TOOL::selectPoint / GuessSelectionCandidates /
// hitTestDistance and FOOTPRINT::GetCoverageArea (pcb_selection_tool.cpp,
// footprint.cpp). The collector gathers every item within the slop radius with
// its exact hit distance and coverage area; the heuristics then prune sloppy
// hits, drop items much larger than the smallest, and prefer the active layer.

/** Shoelace area of a polygon. */
const polyArea = (pts: Vec2[]): number => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);
  return Math.abs(a / 2);
};

/** Distance from a point to a bbox (0 inside). */
const bboxDist = (b: BoardBBox, p: Vec2): number => {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
};

/** Overlap area of two bboxes. */
const bboxIntersectArea = (a: BoardBBox, b: BoardBBox): number => {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Distance from a point to a pad's face (0 inside), in the pad's local frame. */
const padDist = (pad: PcbPad, pos: Vec2): number => {
  const d = { x: pos.x - pad.at.x, y: pos.y - pad.at.y };
  const l = pad.angle ? rotatePcb(d, pad.angle) : d;
  if (pad.shape === 'circle') return Math.max(0, Math.hypot(l.x, l.y) - pad.size.x / 2);
  const dx = Math.max(0, Math.abs(l.x) - pad.size.x / 2);
  const dy = Math.max(0, Math.abs(l.y) - pad.size.y / 2);
  return Math.hypot(dx, dy);
};

/** Distance from a point to an arc track's stroke (0 on it). */
const arcDist = (a: PcbArcTrack, pos: Vec2): number => {
  const c = arcCenter(a.start, a.mid, a.end);
  if (!c) return Math.max(0, distToSeg(pos, a.start, a.end) - a.width / 2);
  const radius = dist(c, a.start);
  const a0 = Math.atan2(a.start.y - c.y, a.start.x - c.x);
  const am = Math.atan2(a.mid.y - c.y, a.mid.x - c.x);
  const a1 = Math.atan2(a.end.y - c.y, a.end.x - c.x);
  const ap = Math.atan2(pos.y - c.y, pos.x - c.x);
  const sweepCCW = ccwSpan(a0, a1);
  const inSweep =
    ccwSpan(a0, am) <= sweepCCW ? ccwSpan(a0, ap) <= sweepCCW : ccwSpan(ap, a0) <= ccwSpan(a1, a0);
  if (inSweep) return Math.max(0, Math.abs(dist(c, pos) - radius) - a.width / 2);
  return Math.max(0, Math.min(dist(pos, a.start), dist(pos, a.end)) - a.width / 2);
};

/** Distance from a point to a graphic shape (0 inside a filled shape). */
const shapeDist = (s: PcbShape, pos: Vec2): number => {
  const half = s.width / 2;
  if (s.kind === 'line' && s.start && s.end)
    return Math.max(0, distToSeg(pos, s.start, s.end) - half);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = dist(s.center, s.end);
    const d = dist(s.center, pos);
    return s.fill ? Math.max(0, d - r - half) : Math.max(0, Math.abs(d - r) - half);
  }
  if (s.kind === 'rect' && s.start && s.end) {
    const b: BoardBBox = {
      minX: Math.min(s.start.x, s.end.x),
      minY: Math.min(s.start.y, s.end.y),
      maxX: Math.max(s.start.x, s.end.x),
      maxY: Math.max(s.start.y, s.end.y),
    };
    if (s.fill) return bboxDist(b, pos);
    const corners: Vec2[] = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    let d = Infinity;
    for (let i = 0; i < 4; i++) d = Math.min(d, distToSeg(pos, corners[i]!, corners[(i + 1) % 4]!));
    return Math.max(0, d - half);
  }
  const pts = s.pts ?? shapePoints(s);
  if (s.fill && pts.length >= 3 && pointInPolygon(pos, pts)) return 0;
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSeg(pos, pts[i - 1]!, pts[i]!));
  if (pts.length >= 3) d = Math.min(d, distToSeg(pos, pts[pts.length - 1]!, pts[0]!));
  return Math.max(0, d - half);
};

interface HitEntry {
  id: string;
  kind: BoardItemKind;
  /** Exact hit distance (hitTestDistance): 0 = exact hit, grows with slop. */
  dist: number;
  /** Coverage area (FOOTPRINT::GetCoverageArea + caller special cases). */
  area: number;
  /** The layer(s) the item lives on, for the active-layer disambiguation. */
  layers: string[];
}

/** Does an item whose layer list is `layers` live on `layer`? ('*.Cu' etc.) */
const onLayer = (layers: string[], layer: string): boolean =>
  layers.some((l) => l === layer || (l.startsWith('*.') && layer.endsWith(l.slice(1))));

export interface BoardHitOpts {
  /** Stateful Selection Filter predicate — runs before the heuristics, like
   *  FilterCollectedItems runs before GuessSelectionCandidates. */
  filter?: (id: string) => boolean;
  /** Active layer: enables the silk preference and the final layer filter. */
  activeLayer?: string;
  /** Visible layers (PCB_SELECTION_TOOL::Selectable): items living only on
   *  hidden layers are not selectable and never enter the candidate list. */
  visibleLayers?: ReadonlySet<string>;
  /** Viewport size in IU: footprints larger than it are last-resort picks. */
  viewportIU?: { w: number; h: number };
}

/**
 * Every board item hit at `pos` within `tol`, pruned by KiCad's selection
 * heuristics, most-specific first. `tol` is the max slop in IU (the editor
 * derives it from MAX_SLOP=5 pixels at the current zoom). More than one
 * returned id means KiCad would pop the disambiguation menu.
 */
export function boardHitCandidates(
  board: Board,
  pos: Vec2,
  tol: number,
  opts: BoardHitOpts = {},
): string[] {
  let hits: HitEntry[] = [];
  const singlePixel = tol / 5; // MAX_SLOP is 5 pixels (GuessSelectionCandidates)

  // PCB_SELECTION_TOOL::Selectable — an item on only-hidden layers can't be
  // picked. Footprints stay selectable (their bodies span several layers).
  const vis = opts.visibleLayers;
  const selectable = (layers: string[]): boolean =>
    !vis ||
    layers.some((l) =>
      l.startsWith('*.') ? [...vis].some((v) => v.endsWith(l.slice(1))) : vis.has(l),
    );

  board.vias.forEach((v, i) => {
    const d = Math.max(0, dist(pos, v.at) - v.size / 2);
    if (d <= tol)
      hits.push({
        id: boardItemId('via', i),
        kind: 'via',
        dist: d,
        // "Vias rarely hide other things" — area is r² of the DRILL, not πr².
        area: (v.drill / 2) ** 2,
        layers: ['*.Cu'],
      });
  });
  board.tracks.forEach((t, i) => {
    const d = Math.max(0, distToSeg(pos, t.start, t.end) - t.width / 2);
    if (d <= tol)
      hits.push({
        id: boardItemId('track', i),
        kind: 'track',
        dist: d,
        // "Approximate linear shapes with just their width squared."
        area: t.width * t.width,
        layers: [t.layer],
      });
  });
  board.arcs.forEach((a, i) => {
    const d = arcDist(a, pos);
    if (d <= tol)
      hits.push({
        id: boardItemId('arc', i),
        kind: 'arc',
        dist: d,
        area: a.width * a.width,
        layers: [a.layer],
      });
  });
  board.texts.forEach((t, i) => {
    const b = textBBox(t);
    const d0 = bboxDist(b, pos);
    // "Add a bit of slop to text-shapes": distance is credited by maxSlop/2.
    if (d0 <= tol)
      hits.push({
        id: boardItemId('text', i),
        kind: 'text',
        dist: Math.max(0, d0 - tol / 2),
        area: bboxArea(b),
        layers: [t.layer],
      });
  });
  board.shapes.forEach((s, i) => {
    const d = shapeDist(s, pos);
    if (d <= tol) {
      // Unfilled / linear shapes count width²; filled shapes their real area.
      let area = s.width * s.width;
      if (s.fill) {
        if (s.kind === 'circle' && s.center && s.end) {
          const r = dist(s.center, s.end);
          area = Math.PI * r * r;
        } else if (s.kind === 'rect' && s.start && s.end) {
          area = Math.abs(s.end.x - s.start.x) * Math.abs(s.end.y - s.start.y);
        } else if (s.pts && s.pts.length >= 3) {
          area = polyArea(s.pts);
        }
      }
      hits.push({ id: boardItemId('shape', i), kind: 'shape', dist: d, area, layers: [s.layer] });
    }
  });
  board.zones.forEach((z, i) => {
    // Zone edges are very specific; the filled interior is an exact hit too.
    let edge = Infinity;
    let inside = false;
    for (const f of z.fills)
      for (const poly of f.polys) {
        if (!inside && poly.length >= 3 && pointInPolygon(pos, poly)) inside = true;
        for (let j = 1; j < poly.length; j++)
          edge = Math.min(edge, distToSeg(pos, poly[j - 1]!, poly[j]!));
      }
    const d = edge <= tol / 2 ? 0 : edge <= tol ? tol / 2 : inside ? 0 : Infinity;
    if (d <= tol) {
      const filled = z.fills.reduce((s, f) => s + f.polys.reduce((q, p) => q + polyArea(p), 0), 0);
      hits.push({
        id: boardItemId('zone', i),
        kind: 'zone',
        dist: d,
        // A border hit makes the zone "small"; otherwise its filled area.
        area:
          edge <= tol / 2
            ? singlePixel * singlePixel * 5
            : filled > 0
              ? filled
              : z.outline
                ? polyArea(z.outline)
                : Infinity,
        layers: z.layers,
      });
    }
  });
  board.footprints.forEach((f, i) => {
    f.texts.forEach((t, ti) => {
      if (t.hide) return;
      const b = textBBox(t);
      const d0 = bboxDist(b, pos);
      if (d0 <= tol)
        hits.push({
          id: boardItemId('fptext', i, ti),
          kind: 'fptext',
          dist: Math.max(0, d0 - tol / 2),
          area: bboxArea(b),
          layers: [t.layer],
        });
    });
    f.pads.forEach((p, pi) => {
      const d = padDist(p, pos);
      if (d <= tol)
        hits.push({
          id: boardItemId('pad', i, pi),
          kind: 'pad',
          dist: d,
          area:
            p.shape === 'circle' ? Math.PI * (p.size.x / 2) ** 2 : Math.abs(p.size.x * p.size.y),
          layers: p.layers,
        });
    });
    const b = footprintBBox(f);
    if (b) {
      let d = bboxDist(b, pos);
      // "Consider footprints larger than the viewport only as a last resort."
      if (
        opts.viewportIU &&
        (b.maxX - b.minX > opts.viewportIU.w || b.maxY - b.minY > opts.viewportIU.h)
      )
        d = Number.MAX_SAFE_INTEGER / 2;
      if (d <= tol)
        hits.push({
          id: boardItemId('footprint', i),
          kind: 'footprint',
          dist: d,
          area: bboxArea(b),
          layers: [f.layer],
        });
    }
  });

  // Selectable(): drop items living only on hidden layers, then the stateful
  // Selection Filter (FilterCollectedItems) — both run before the guesses.
  hits = hits.filter((h) => h.kind === 'footprint' || selectable(h.layers));
  if (opts.filter) hits = hits.filter((h) => opts.filter!(h.id));
  if (hits.length <= 1) return hits.map((h) => h.id);

  // --- GuessSelectionCandidates ---

  // Silk preference: with a silk layer in front, single-layer items on either
  // silk layer take priority.
  const silk = ['F.SilkS', 'B.SilkS'];
  if (opts.activeLayer && silk.includes(opts.activeLayer)) {
    const preferred = hits.filter(
      (h) =>
        (h.kind === 'text' || h.kind === 'fptext' || h.kind === 'shape') &&
        silk.includes(h.layers[0]!),
    );
    if (preferred.length > 0) hits = preferred;
    if (hits.length === 1) return hits.map((h) => h.id);
  }

  // Prefer exact hits to sloppy ones: prune items more than one pixel sloppier
  // than the closest hit.
  const minSlop = Math.min(...hits.map((h) => h.dist));
  hits = hits.filter((h) => h.dist <= minSlop + singlePixel);

  // "If the user clicked on a small item within a much larger one then it's
  // pretty clear they're trying to select the smaller one" — sort by coverage
  // area and start rejecting at the first 1.5× jump.
  const sizeRatio = 1.5;
  const byArea = [...hits].sort((a, b) => a.area - b.area);
  const rejected = new Set<HitEntry>();
  let rejecting = false;
  for (let i = 1; i < byArea.length; i++) {
    if (byArea[i]!.area > byArea[i - 1]!.area * sizeRatio) rejecting = true;
    if (rejecting) rejected.add(byArea[i]!);
  }

  // Special case: a footprint completely covered by other features would be
  // unselectable — keep it for the disambiguation menu (CoverageRatio > 0.70).
  const maxCoverRatio = 0.7;
  for (const h of byArea) {
    if (h.kind !== 'footprint' || !rejected.has(h)) continue;
    const fb = boardItemBBox(board, h.id);
    if (!fb) continue;
    let covered = 0;
    for (const other of byArea) {
      if (other === h) continue;
      const ob = boardItemBBox(board, other.id);
      if (ob) covered += bboxIntersectArea(fb, ob);
    }
    if (covered / Math.max(1, bboxArea(fb)) > maxCoverRatio) rejected.delete(h);
  }

  if (hits.length > rejected.size) hits = byArea.filter((h) => !rejected.has(h));
  else hits = byArea;

  // Finally, reject items not on the active layer (when something is on it),
  // to reduce the number of disambiguation menus shown.
  if (hits.length > 1 && opts.activeLayer) {
    const onActive = hits.filter((h) => onLayer(h.layers, opts.activeLayer!));
    if (onActive.length > 0) hits = onActive;
  }

  return hits.map((h) => h.id);
}

/** Topmost board item at `pos` (the click-select winner), or null. */
export function hitTestBoard(board: Board, pos: Vec2, tol: number): string | null {
  return boardHitCandidates(board, pos, tol)[0] ?? null;
}

// ----- box-select geometry (mirrors each BOARD_ITEM::HitTest(BOX2I)) ----------

/** Do segments a-b and c-d intersect? (orientation test.) */
const segSeg = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const o = (p: Vec2, q: Vec2, r: Vec2): number =>
    Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const o1 = o(a, b, c),
    o2 = o(a, b, d),
    o3 = o(c, d, a),
    o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const onSeg = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y &&
    q.y <= Math.max(p.y, r.y);
  return (
    (o1 === 0 && onSeg(a, c, b)) ||
    (o2 === 0 && onSeg(a, d, b)) ||
    (o3 === 0 && onSeg(c, a, d)) ||
    (o4 === 0 && onSeg(c, b, d))
  );
};

/** Does segment a-b intersect (or lie inside) `r`? */
const segInRect = (r: BoardBBox, a: Vec2, b: Vec2): boolean => {
  if (boxContainsPt(r, a) || boxContainsPt(r, b)) return true;
  const c1 = { x: r.minX, y: r.minY },
    c2 = { x: r.maxX, y: r.minY },
    c3 = { x: r.maxX, y: r.maxY },
    c4 = { x: r.minX, y: r.maxY };
  return (
    segSeg(a, b, c1, c2) || segSeg(a, b, c2, c3) || segSeg(a, b, c3, c4) || segSeg(a, b, c4, c1)
  );
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
  for (const p of poly) if (boxContainsPt(r, p)) return true; // a vertex inside the rect
  if (pointInPolygon({ x: r.minX, y: r.minY }, poly)) return true; // rect inside the polygon
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
  board: Board,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  contained: boolean,
): string[] {
  const rect: BoardBBox = {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
  const out: string[] = [];
  const push = (kind: BoardItemKind, i: number): void => {
    out.push(boardItemId(kind, i));
  };
  // Item's bbox is fully inside the rect (the shared `contained` fast path).
  const bboxContained = (kind: BoardItemKind, i: number): boolean => {
    const b = boardItemBBox(board, boardItemId(kind, i));
    return !!b && !isEmpty(b) && boxContainsBox(rect, b);
  };

  board.tracks.forEach((t, i) => {
    const hit = contained
      ? boxContainsPt(rect, t.start) && boxContainsPt(rect, t.end) // PCB_TRACK: endpoints
      : segInRect(rect, t.start, t.end);
    if (hit) push('track', i);
  });
  board.arcs.forEach((_a, i) => {
    // PCB_ARC: bbox of s/m/e + w/2
    const b = boardItemBBox(board, boardItemId('arc', i))!;
    if (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b)) push('arc', i);
  });
  board.vias.forEach((v, i) => {
    const hit = contained ? bboxContained('via', i) : circleInRect(rect, v.at, v.size / 2);
    if (hit) push('via', i);
  });
  board.footprints.forEach((_, i) => {
    // FOOTPRINT: bbox contain/intersect
    const b = boardItemBBox(board, boardItemId('footprint', i));
    if (b && (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b))) push('footprint', i);
  });
  board.shapes.forEach((s, i) => {
    if (contained) {
      if (bboxContained('shape', i)) push('shape', i);
      return;
    }
    if (s.kind === 'line' && s.start && s.end) {
      if (segInRect(rect, s.start, s.end)) push('shape', i);
      return;
    }
    const b = boardItemBBox(board, boardItemId('shape', i));
    if (b && boxIntersects(rect, b)) push('shape', i);
  });
  board.texts.forEach((_, i) => {
    const b = boardItemBBox(board, boardItemId('text', i))!;
    if (contained ? boxContainsBox(rect, b) : boxIntersects(rect, b)) push('text', i);
  });
  board.zones.forEach((z, i) => {
    if (contained) {
      if (bboxContained('zone', i)) push('zone', i);
      return;
    }
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
    if (!replaced && isList(it) && head(it) === name) {
      replaced = true;
      return node;
    }
    return it;
  });
  if (!replaced) items.push(node);
  return { kind: 'list', items };
}

const atNode = (p: Vec2, angle = 0): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));
const xyNode = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));
const ptsNode = (pts: Vec2[]): SList => ({
  kind: 'list',
  items: [atom('pts'), ...pts.map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y))))],
});

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

const moveTrack = (t: PcbTrack, d: Vec2): PcbTrack => {
  const start = add(t.start, d),
    end = add(t.end, d);
  let src = patchChild(t.source, 'start', xyNode('start', start));
  src = patchChild(src, 'end', xyNode('end', end));
  return { ...t, start, end, source: src };
};

const moveArc = (a: PcbArcTrack, d: Vec2): PcbArcTrack => {
  const start = add(a.start, d),
    mid = add(a.mid, d),
    end = add(a.end, d);
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
  if (s.center) {
    next.center = add(s.center, d);
    src = patchChild(src, 'center', xyNode('center', next.center));
  }
  if (s.start) {
    next.start = add(s.start, d);
    src = patchChild(src, 'start', xyNode('start', next.start));
  }
  if (s.end) {
    next.end = add(s.end, d);
    src = patchChild(src, 'end', xyNode('end', next.end));
  }
  if (s.mid) {
    next.mid = add(s.mid, d);
    src = patchChild(src, 'mid', xyNode('mid', next.mid));
  }
  if (s.pts) {
    next.pts = s.pts.map((p) => add(p, d));
    src = patchChild(src, 'pts', ptsNode(next.pts));
  }
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
  const idx = indicesByKind(ids);
  const fpTexts = fpTextsByFp(ids);
  return {
    ...board,
    tracks: board.tracks.map((t, i) => (idx.track.has(i) ? moveTrack(t, delta) : t)),
    arcs: board.arcs.map((a, i) => (idx.arc.has(i) ? moveArc(a, delta) : a)),
    vias: board.vias.map((v, i) => (idx.via.has(i) ? moveVia(v, delta) : v)),
    shapes: board.shapes.map((s, i) => (idx.shape.has(i) ? moveShape(s, delta) : s)),
    texts: board.texts.map((t, i) => (idx.text.has(i) ? moveText(t, delta) : t)),
    footprints: board.footprints.map((f, i) => {
      // A whole-footprint move takes precedence over its individual texts.
      if (idx.footprint.has(i)) return moveFootprint(f, delta);
      const ti = fpTexts.get(i);
      return ti ? moveFootprintTexts(f, ti, delta) : f;
    }),
  };
}

/** Move one or both ends of a track by `d`, patching only the moved ends. */
const moveTrackEnds = (t: PcbTrack, ends: ReadonlySet<'start' | 'end'>, d: Vec2): PcbTrack => {
  let src = t.source;
  const start = ends.has('start') ? add(t.start, d) : t.start;
  const end = ends.has('end') ? add(t.end, d) : t.end;
  if (ends.has('start')) src = patchChild(src, 'start', xyNode('start', start));
  if (ends.has('end')) src = patchChild(src, 'end', xyNode('end', end));
  return { ...t, start, end, source: src };
};

/** Move one or both ends of an arc by `d` (mid stays; drag arc reshaping is later). */
const moveArcEnds = (a: PcbArcTrack, ends: ReadonlySet<'start' | 'end'>, d: Vec2): PcbArcTrack => {
  let src = a.source;
  const start = ends.has('start') ? add(a.start, d) : a.start;
  const end = ends.has('end') ? add(a.end, d) : a.end;
  if (ends.has('start')) src = patchChild(src, 'start', xyNode('start', start));
  if (ends.has('end')) src = patchChild(src, 'end', xyNode('end', end));
  return { ...a, start, end, source: src };
};

/**
 * Drag the selection like {@link moveBoardItems}, but additionally stretch the
 * track/arc ends attached to any moving footprint so the routing follows the
 * part (EDIT_TOOL's Drag, as opposed to Move which leaves the tracks behind).
 * Ends whose track is itself selected are skipped — the whole track already
 * moved with the selection.
 */
export function dragBoardItems(board: Board, ids: ReadonlySet<string>, delta: Vec2): Board {
  if ((delta.x === 0 && delta.y === 0) || ids.size === 0) return board;
  const idx = indicesByKind(ids);
  const moved = moveBoardItems(board, ids, delta);
  if (idx.footprint.size === 0) return moved;

  const trackEnds = new Map<number, Set<'start' | 'end'>>();
  const arcEnds = new Map<number, Set<'start' | 'end'>>();
  for (const e of connectedTrackEnds(board, idx.footprint)) {
    const target = e.kind === 'track' ? trackEnds : arcEnds;
    const selected = e.kind === 'track' ? idx.track : idx.arc;
    if (selected.has(e.index)) continue; // whole track already moved
    let set = target.get(e.index);
    if (!set) {
      set = new Set();
      target.set(e.index, set);
    }
    set.add(e.end);
  }
  if (trackEnds.size === 0 && arcEnds.size === 0) return moved;

  return {
    ...moved,
    tracks: moved.tracks.map((t, i) => {
      const es = trackEnds.get(i);
      return es ? moveTrackEnds(t, es, delta) : t;
    }),
    arcs: moved.arcs.map((a, i) => {
      const es = arcEnds.get(i);
      return es ? moveArcEnds(a, es, delta) : a;
    }),
  };
}

// ----- footprint field edits (PCB_PROPERTIES_PANEL) ---------------------------

/** Replace the `argIndex`-th positional atom (head = atom 0) of a source list. */
function replaceArg(src: SList, argIndex: number, value: string): SList {
  let atomN = -1;
  const target = argIndex + 1;
  const items = src.items.map((it) => {
    if (!isList(it)) {
      atomN++;
      if (atomN === target) return str(value);
    }
    return it;
  });
  return { kind: 'list', items };
}

/** Drop every `name` child from a source list. */
function removeChild(src: SList, name: string): SList {
  return { kind: 'list', items: src.items.filter((it) => !(isList(it) && head(it) === name)) };
}

const replaceFp = (board: Board, index: number, fp: PcbFootprint): Board => ({
  ...board,
  footprints: board.footprints.map((f, i) => (i === index ? fp : f)),
});

/**
 * Set a footprint's Reference or Value text. The writer emits these from the
 * model's text items (their own `(property …)` / `(fp_text …)` source), so we
 * patch each matching text item's text and its source's value atom (arg 1).
 */
export function setFootprintField(
  board: Board,
  index: number,
  field: 'reference' | 'value',
  value: string,
): Board {
  const f = board.footprints[index];
  if (!f) return board;
  const patchTextSrc = (src: SList): SList => {
    const h = head(src);
    return h === 'property' || h === 'fp_text' ? replaceArg(src, 1, value) : src;
  };
  return replaceFp(board, index, {
    ...f,
    reference: field === 'reference' ? value : f.reference,
    value: field === 'value' ? value : f.value,
    texts: f.texts.map((t) =>
      t.kind === field ? { ...t, text: value, source: patchTextSrc(t.source) } : t,
    ),
  });
}

/** Lock or unlock a footprint (`(locked yes)`). */
export function setFootprintLocked(board: Board, index: number, locked: boolean): Board {
  const f = board.footprints[index];
  if (!f) return board;
  const source = locked
    ? patchChild(f.source, 'locked', list(atom('locked'), atom('yes')))
    : removeChild(f.source, 'locked');
  return replaceFp(board, index, { ...f, locked, source });
}

/** Set a footprint's absolute orientation (degrees), rotating about its anchor. */
export function setFootprintOrientation(board: Board, index: number, deg: number): Board {
  const f = board.footprints[index];
  if (!f || !Number.isFinite(deg)) return board;
  const delta = deg - f.angle;
  if (delta === 0) return board;
  return replaceFp(board, index, rotateFootprintAbout(f, f.at, delta));
}

// ----- delete (EDIT_TOOL::Remove) ---------------------------------------------

/** Split a selection id set into per-kind index sets. */
function indicesByKind(ids: ReadonlySet<string>): Record<BoardItemKind, Set<number>> {
  const idx: Record<BoardItemKind, Set<number>> = {
    track: new Set(),
    arc: new Set(),
    via: new Set(),
    footprint: new Set(),
    zone: new Set(),
    shape: new Set(),
    text: new Set(),
    fptext: new Set(),
    pad: new Set(),
    group: new Set(),
  };
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r) idx[r.kind].add(r.index);
  }
  return idx;
}

/** Map footprint index -> set of its selected pad indices (from pad ids). */
function fpPadsByFp(ids: ReadonlySet<string>): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r?.kind === 'pad') {
      let s = m.get(r.index);
      if (!s) {
        s = new Set();
        m.set(r.index, s);
      }
      s.add(r.sub ?? 0);
    }
  }
  return m;
}

/** Map footprint index -> set of its selected text indices (from fptext ids). */
function fpTextsByFp(ids: ReadonlySet<string>): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r?.kind === 'fptext') {
      let s = m.get(r.index);
      if (!s) {
        s = new Set();
        m.set(r.index, s);
      }
      s.add(r.sub ?? 0);
    }
  }
  return m;
}

/** Replace the x/y atoms of an `(at x y …)` node, keeping any trailing tokens
 *  (angle, `unlocked`) intact. */
const patchAtCoords = (atSrc: SList, xMM: string, yMM: string): SList => {
  const items = [...atSrc.items];
  if (items.length >= 3) {
    items[1] = atom(xMM);
    items[2] = atom(yMM);
  }
  return { kind: 'list', items };
};

/**
 * Move only the given texts of a footprint (individual FP_TEXT drag). The
 * board-absolute `at` shifts for hit-test/render; the fp_text source's local
 * `(at)` is rewritten from the new board position: local = rotate(board −
 * fp.at, −fp.angle), the inverse of the reader's toBoard.
 */
const moveFootprintTexts = (
  fp: PcbFootprint,
  textIdx: ReadonlySet<number>,
  d: Vec2,
): PcbFootprint => ({
  ...fp,
  texts: fp.texts.map((t, i) => {
    if (!textIdx.has(i)) return t;
    const at = add(t.at, d);
    const localIU = rotatePcb({ x: at.x - fp.at.x, y: at.y - fp.at.y }, -fp.angle);
    const srcAt = childNamed(t.source, 'at');
    const src = srcAt
      ? patchChild(t.source, 'at', patchAtCoords(srcAt, mm(localIU.x), mm(localIU.y)))
      : t.source;
    return { ...t, at, source: src };
  }),
});

/**
 * Remove the selected items from the board (Delete key / EDIT_TOOL::Remove).
 * The writer drops the corresponding source children positionally, so a deleted
 * item leaves no trace in the serialized `.kicad_pcb`.
 */
export function deleteBoardItems(board: Board, ids: ReadonlySet<string>): Board {
  if (ids.size === 0) return board;
  const idx = indicesByKind(ids);
  const fpTexts = fpTextsByFp(ids);
  return {
    ...board,
    groups: board.groups.filter((_, i) => !idx.group.has(i)),
    tracks: board.tracks.filter((_, i) => !idx.track.has(i)),
    arcs: board.arcs.filter((_, i) => !idx.arc.has(i)),
    vias: board.vias.filter((_, i) => !idx.via.has(i)),
    zones: board.zones.filter((_, i) => !idx.zone.has(i)),
    shapes: board.shapes.filter((_, i) => !idx.shape.has(i)),
    texts: board.texts.filter((_, i) => !idx.text.has(i)),
    footprints: board.footprints
      // Remove individually-selected footprint texts first (on original indices,
      // so the fptext map stays aligned), then drop whole selected footprints.
      // This also hides the moving text from the move backdrop.
      .map((f, i) => {
        const ti = fpTexts.get(i);
        return ti ? { ...f, texts: f.texts.filter((_, j) => !ti.has(j)) } : f;
      })
      .filter((_, i) => !idx.footprint.has(i)),
  };
}

/**
 * Append a freshly-drawn graphic shape (DRAWING_TOOL commit). The shape is
 * source-less; the writer emits it from buildBoardShapeNode.
 */
export function addBoardShape(
  board: Board,
  shape: Omit<PcbShape, 'source'>,
): { board: Board; id: string } {
  const withSource: PcbShape = { ...shape, source: { kind: 'list', items: [] } };
  return {
    board: { ...board, shapes: [...board.shapes, withSource] },
    id: boardItemId('shape', board.shapes.length),
  };
}

/** Append a routed track segment (ROUTER_TOOL commit); writer-canonical. */
export function addBoardTrack(
  board: Board,
  track: Omit<PcbTrack, 'source'>,
): { board: Board; id: string } {
  const withSource: PcbTrack = { ...track, source: { kind: 'list', items: [] } };
  return {
    board: { ...board, tracks: [...board.tracks, withSource] },
    id: boardItemId('track', board.tracks.length),
  };
}

/** Append a via (ROUTER_TOOL layer switch / free via placement). */
export function addBoardVia(
  board: Board,
  via: Omit<PcbVia, 'source'>,
): { board: Board; id: string } {
  const withSource: PcbVia = { ...via, source: { kind: 'list', items: [] } };
  return {
    board: { ...board, vias: [...board.vias, withSource] },
    id: boardItemId('via', board.vias.length),
  };
}

/** Append a free text item (DRAWING_TOOL::PlaceText commit). */
export function addBoardText(
  board: Board,
  text: Omit<PcbTextItem, 'source'>,
): { board: Board; id: string } {
  const withSource: PcbTextItem = { ...text, source: { kind: 'list', items: [] } };
  return {
    board: { ...board, texts: [...board.texts, withSource] },
    id: boardItemId('text', board.texts.length),
  };
}

/** Append a freshly-drawn (unfilled) zone (DRAWING_TOOL::DrawZone commit). */
export function addBoardZone(
  board: Board,
  zone: Omit<PcbZone, 'source' | 'fills'> & { fills?: PcbZone['fills'] },
): { board: Board; id: string } {
  const withSource: PcbZone = {
    fills: [],
    ...zone,
    source: { kind: 'list', items: [] },
  };
  return {
    board: { ...board, zones: [...board.zones, withSource] },
    id: boardItemId('zone', board.zones.length),
  };
}

/**
 * A board holding only the selected items, keeping all board metadata (layers,
 * stackup, paper…) so it renders identically. Used as the live move overlay:
 * the moving items are drawn from this subset following the cursor while the
 * static backdrop is the board with those same items removed (EDIT_TOOL::Move,
 * which puts the dragged items on a GAL overlay and hides them in the base view).
 */
export function subsetBoardItems(board: Board, ids: ReadonlySet<string>): Board {
  const idx = indicesByKind(ids);
  const fpTexts = fpTextsByFp(ids);
  const fpPads = fpPadsByFp(ids);
  const footprints: PcbFootprint[] = [];
  board.footprints.forEach((f, i) => {
    if (idx.footprint.has(i)) {
      footprints.push(f);
    } else {
      // A footprint with only individually-selected pads/text: strip everything
      // but those children so the overlay highlights just the pad(s)/text.
      const ti = fpTexts.get(i);
      const pi = fpPads.get(i);
      if (ti || pi) {
        footprints.push({
          ...f,
          pads: pi ? f.pads.filter((_, j) => pi.has(j)) : [],
          shapes: [],
          models: [],
          texts: ti ? f.texts.filter((_, j) => ti.has(j)) : [],
        });
      }
    }
  });
  return {
    ...board,
    tracks: board.tracks.filter((_, i) => idx.track.has(i)),
    arcs: board.arcs.filter((_, i) => idx.arc.has(i)),
    vias: board.vias.filter((_, i) => idx.via.has(i)),
    zones: board.zones.filter((_, i) => idx.zone.has(i)),
    shapes: board.shapes.filter((_, i) => idx.shape.has(i)),
    texts: board.texts.filter((_, i) => idx.text.has(i)),
    footprints,
  };
}

// ----- rotate (EDIT_TOOL::Rotate) ---------------------------------------------

/** Normalise degrees to [0, 360). */
const norm360 = (a: number): number => ((a % 360) + 360) % 360;
/** Rotate a point about a centre by `deg` (KiCad RotatePoint convention). */
const rotAbout = (p: Vec2, c: Vec2, deg: number): Vec2 => {
  const r = rotatePcb({ x: p.x - c.x, y: p.y - c.y }, deg);
  return { x: r.x + c.x, y: r.y + c.y };
};

/** Combined bounding box of the selected items, or null when empty. */
export function boardSelectionBBox(board: Board, ids: ReadonlySet<string>): BoardBBox | null {
  const b = emptyBox();
  for (const id of ids) {
    const ib = boardItemBBox(board, id);
    if (ib && !isEmpty(ib)) {
      growBox(b, { x: ib.minX, y: ib.minY });
      growBox(b, { x: ib.maxX, y: ib.maxY });
    }
  }
  return isEmpty(b) ? null : b;
}

const rotShapeCoords = <
  T extends { center?: Vec2; start?: Vec2; end?: Vec2; mid?: Vec2; pts?: Vec2[] },
>(
  s: T,
  c: Vec2,
  deg: number,
): Partial<T> => {
  const n: { center?: Vec2; start?: Vec2; end?: Vec2; mid?: Vec2; pts?: Vec2[] } = {};
  if (s.center) n.center = rotAbout(s.center, c, deg);
  if (s.start) n.start = rotAbout(s.start, c, deg);
  if (s.end) n.end = rotAbout(s.end, c, deg);
  if (s.mid) n.mid = rotAbout(s.mid, c, deg);
  if (s.pts) n.pts = s.pts.map((p) => rotAbout(p, c, deg));
  return n as Partial<T>;
};

/** Rotate a whole footprint by `deg` about centre `c` (anchor + children + source). */
function rotateFootprintAbout(f: PcbFootprint, c: Vec2, deg: number): PcbFootprint {
  const at = rotAbout(f.at, c, deg);
  const angle = norm360(f.angle + deg);
  return {
    ...f,
    at,
    angle,
    pads: f.pads.map((p) => ({ ...p, at: rotAbout(p.at, c, deg), angle: norm360(p.angle + deg) })),
    texts: f.texts.map((t) => ({
      ...t,
      at: rotAbout(t.at, c, deg),
      angle: norm360(t.angle + deg),
    })),
    shapes: f.shapes.map((s) => ({ ...s, ...rotShapeCoords(s, c, deg) })),
    source: patchChild(f.source, 'at', atNode(at, angle)),
  };
}

/**
 * Rotate the selected items by ±90° about a centre (EDIT_TOOL::Rotate).
 * `ccw` picks the direction; `center` defaults to the selection's bounding-box
 * centre (KiCad rotates about the selection centre / rotation point). Footprints
 * rotate by patching their `(at … angle)` anchor (children stay local, so the
 * writer re-bakes them); their model-absolute child coords rotate too.
 */
export function rotateBoardItems(
  board: Board,
  ids: ReadonlySet<string>,
  ccw: boolean,
  center?: Vec2,
): Board {
  if (ids.size === 0) return board;
  const c =
    center ??
    (() => {
      const b = boardSelectionBBox(board, ids);
      return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
    })();
  const deg = ccw ? 90 : -90;
  const idx = indicesByKind(ids);

  const rotTrack = (t: PcbTrack): PcbTrack => {
    const start = rotAbout(t.start, c, deg),
      end = rotAbout(t.end, c, deg);
    let src = patchChild(t.source, 'start', xyNode('start', start));
    src = patchChild(src, 'end', xyNode('end', end));
    return { ...t, start, end, source: src };
  };
  const rotArc = (a: PcbArcTrack): PcbArcTrack => {
    const start = rotAbout(a.start, c, deg),
      mid = rotAbout(a.mid, c, deg),
      end = rotAbout(a.end, c, deg);
    let src = patchChild(a.source, 'start', xyNode('start', start));
    src = patchChild(src, 'mid', xyNode('mid', mid));
    src = patchChild(src, 'end', xyNode('end', end));
    return { ...a, start, mid, end, source: src };
  };
  const rotVia = (v: PcbVia): PcbVia => {
    const at = rotAbout(v.at, c, deg);
    return { ...v, at, source: patchChild(v.source, 'at', atNode(at)) };
  };
  const rotText = (t: PcbTextItem): PcbTextItem => {
    const at = rotAbout(t.at, c, deg),
      angle = norm360(t.angle + deg);
    return { ...t, at, angle, source: patchChild(t.source, 'at', atNode(at, angle)) };
  };
  const rotShape = (s: PcbShape): PcbShape => {
    const next = { ...s, ...rotShapeCoords(s, c, deg) };
    let src = s.source;
    if (next.center) src = patchChild(src, 'center', xyNode('center', next.center));
    if (next.start) src = patchChild(src, 'start', xyNode('start', next.start));
    if (next.end) src = patchChild(src, 'end', xyNode('end', next.end));
    if (next.mid) src = patchChild(src, 'mid', xyNode('mid', next.mid));
    if (next.pts) src = patchChild(src, 'pts', ptsNode(next.pts));
    return { ...next, source: src };
  };
  const rotFootprint = (f: PcbFootprint): PcbFootprint => rotateFootprintAbout(f, c, deg);

  return {
    ...board,
    tracks: board.tracks.map((t, i) => (idx.track.has(i) ? rotTrack(t) : t)),
    arcs: board.arcs.map((a, i) => (idx.arc.has(i) ? rotArc(a) : a)),
    vias: board.vias.map((v, i) => (idx.via.has(i) ? rotVia(v) : v)),
    texts: board.texts.map((t, i) => (idx.text.has(i) ? rotText(t) : t)),
    shapes: board.shapes.map((s, i) => (idx.shape.has(i) ? rotShape(s) : s)),
    footprints: board.footprints.map((f, i) => (idx.footprint.has(i) ? rotFootprint(f) : f)),
  };
}

// ----- groups (PCB_GROUP; ACTIONS::group / ungroup) ---------------------------

/** uuid -> board item id, for every item carrying a uuid (group membership). */
export function boardUuidIndex(board: Board): Map<string, string> {
  const m = new Map<string, string>();
  const put = (uuid: string | undefined, id: string): void => {
    if (uuid) m.set(uuid, id);
  };
  board.tracks.forEach((t, i) => put(t.uuid, boardItemId('track', i)));
  board.arcs.forEach((a, i) => put(a.uuid, boardItemId('arc', i)));
  board.vias.forEach((v, i) => put(v.uuid, boardItemId('via', i)));
  board.zones.forEach((z, i) => put(z.uuid, boardItemId('zone', i)));
  board.shapes.forEach((s, i) => put(s.uuid, boardItemId('shape', i)));
  board.texts.forEach((t, i) => put(t.uuid, boardItemId('text', i)));
  board.footprints.forEach((f, i) => put(f.uuid, boardItemId('footprint', i)));
  board.groups.forEach((g, i) => put(g.uuid, boardItemId('group', i)));
  return m;
}

/** Item ids of a group's members (unresolvable uuids are skipped, like the
 *  writer validates member pointers against the board). */
function groupMemberIds(board: Board, g: PcbGroup): string[] {
  const idx = boardUuidIndex(board);
  return g.members.map((u) => idx.get(u)).filter((id): id is string => !!id);
}

/** The uuid of the item behind a board item id, if it has one. */
function uuidOfItemId(board: Board, id: string): string | undefined {
  const r = parseBoardItemId(id);
  if (!r) return undefined;
  switch (r.kind) {
    case 'track':
      return board.tracks[r.index]?.uuid;
    case 'arc':
      return board.arcs[r.index]?.uuid;
    case 'via':
      return board.vias[r.index]?.uuid;
    case 'zone':
      return board.zones[r.index]?.uuid;
    case 'shape':
      return board.shapes[r.index]?.uuid;
    case 'text':
      return board.texts[r.index]?.uuid;
    case 'footprint':
      return board.footprints[r.index]?.uuid;
    case 'group':
      return board.groups[r.index]?.uuid;
    default:
      return undefined; // pads / fp texts can't be group members
  }
}

/**
 * The TOP-LEVEL group containing this item, or null (PCB_GROUP::TopLevelGroup:
 * clicking a member selects the outermost containing group).
 *
 * `stopAtGroupUuid` is the currently "entered" group (SELECTION_TOOL::EnterGroup):
 * the walk stops at its boundary, so a click inside resolves to the immediate
 * child within that group (or the bare item), never the entered group itself.
 */
export function groupContaining(board: Board, id: string, stopAtGroupUuid?: string): string | null {
  const uuid0 = uuidOfItemId(board, id);
  if (!uuid0) return null;
  let uuid = uuid0;
  let found: string | null = null;
  // Walk up: a group's uuid may itself be a member of an outer group.
  for (let hops = 0; hops < 16; hops++) {
    const gi = board.groups.findIndex((g) => g.members.includes(uuid));
    if (gi < 0) break;
    const gUuid = board.groups[gi]!.uuid;
    if (stopAtGroupUuid && gUuid === stopAtGroupUuid) break;
    found = boardItemId('group', gi);
    if (!gUuid) break;
    uuid = gUuid;
  }
  return found;
}

/**
 * Expand group ids to their member item ids (recursively for nested groups);
 * other ids pass through. Editing commands operate on the expansion so moving/
 * rotating/deleting a group carries all its members.
 */
export function expandGroupIds(board: Board, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const visit = (id: string, depth: number): void => {
    const r = parseBoardItemId(id);
    if (r?.kind === 'group' && depth < 16) {
      const g = board.groups[r.index];
      if (g) for (const mid of groupMemberIds(board, g)) visit(mid, depth + 1);
    } else {
      out.add(id);
    }
  };
  for (const id of ids) visit(id, 0);
  return out;
}

/**
 * Group the selected items (ACTIONS::group): a new PCB_GROUP whose members are
 * the items' uuids. Items without a uuid (freshly drawn, not yet saved) and
 * pads/footprint-texts (children, not groupable) are skipped, and existing
 * group ids join as nested member groups.
 */
export function groupBoardItems(
  board: Board,
  ids: ReadonlySet<string>,
  name = '',
): { board: Board; id: string | null } {
  const members: string[] = [];
  for (const id of ids) {
    const uuid = uuidOfItemId(board, id);
    if (uuid) members.push(uuid);
  }
  if (members.length < 1) return { board, id: null };
  const g: PcbGroup = {
    name,
    uuid: genUuid(),
    members,
    source: { kind: 'list', items: [] },
  };
  return {
    board: { ...board, groups: [...board.groups, g] },
    id: boardItemId('group', board.groups.length),
  };
}

/** Dissolve the selected groups (ACTIONS::ungroup): members stay on the board. */
export function ungroupBoardItems(board: Board, ids: ReadonlySet<string>): Board {
  const gidx = new Set<number>();
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r?.kind === 'group') gidx.add(r.index);
  }
  if (gidx.size === 0) return board;
  return { ...board, groups: board.groups.filter((_, i) => !gidx.has(i)) };
}

/** The index of the group directly owning this item's uuid, or -1 (an item's
 *  immediate parent group — GetParentGroup, one level, unlike groupContaining
 *  which walks to the top). */
function parentGroupIndex(board: Board, id: string): number {
  const uuid = uuidOfItemId(board, id);
  if (!uuid) return -1;
  return board.groups.findIndex((g) => g.members.includes(uuid));
}

/**
 * Add the selected ungrouped items to the one selected group (ACTIONS::addToGroup,
 * GROUP_TOOL::AddToGroup): enabled only when exactly one group and at least one
 * item that isn't already in a group are selected. Items already in the target
 * group, and pads / footprint texts (no uuid, not groupable), are skipped.
 */
export function addToGroupItems(board: Board, ids: ReadonlySet<string>): Board {
  let groupIdx = -1;
  const toAdd: string[] = [];
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r?.kind === 'group') {
      if (groupIdx >= 0) return board; // only one group may be selected
      groupIdx = r.index;
    } else if (parentGroupIndex(board, id) < 0) {
      const uuid = uuidOfItemId(board, id);
      if (uuid) toAdd.push(uuid);
    }
  }
  const g = groupIdx >= 0 ? board.groups[groupIdx] : undefined;
  if (!g || toAdd.length === 0) return board;
  const fresh = toAdd.filter((u) => !g.members.includes(u));
  if (fresh.length === 0) return board;
  const groups = board.groups.map((grp, i) =>
    i === groupIdx ? { ...grp, members: [...grp.members, ...fresh] } : grp,
  );
  return { ...board, groups };
}

/**
 * Remove the selected items from their parent groups (ACTIONS::removeFromGroup,
 * GROUP_TOOL::RemoveFromGroup). A group left with fewer than two members is then
 * dissolved, mirroring the ">= 2 members" invariant.
 */
export function removeFromGroupItems(board: Board, ids: ReadonlySet<string>): Board {
  const remove = new Map<number, Set<string>>(); // group index -> member uuids to drop
  for (const id of ids) {
    const gi = parentGroupIndex(board, id);
    if (gi < 0) continue;
    const uuid = uuidOfItemId(board, id);
    if (!uuid) continue;
    (remove.get(gi) ?? remove.set(gi, new Set()).get(gi)!).add(uuid);
  }
  if (remove.size === 0) return board;
  const dissolve = new Set<number>();
  const groups = board.groups.map((g, i) => {
    const drop = remove.get(i);
    if (!drop) return g;
    const members = g.members.filter((u) => !drop.has(u));
    if (members.length < 2) dissolve.add(i);
    return { ...g, members };
  });
  return {
    ...board,
    groups: groups.filter((_, i) => !dissolve.has(i)),
  };
}

// ----- lock / unlock (PCB_ACTIONS::lock / unlock) -----------------------------

/** Is the item (or, for pads / footprint text, its parent footprint) locked? */
export function isBoardItemLocked(board: Board, id: string): boolean {
  const r = parseBoardItemId(id);
  if (!r) return false;
  switch (r.kind) {
    case 'track':
      return !!board.tracks[r.index]?.locked;
    case 'arc':
      return !!board.arcs[r.index]?.locked;
    case 'via':
      return !!board.vias[r.index]?.locked;
    case 'zone':
      return !!board.zones[r.index]?.locked;
    case 'shape':
      return !!board.shapes[r.index]?.locked;
    case 'text':
      return !!board.texts[r.index]?.locked;
    case 'footprint':
    case 'pad':
    case 'fptext':
      return !!board.footprints[r.index]?.locked;
    case 'group':
      return !!board.groups[r.index]?.locked;
  }
}

/**
 * Lock or unlock the selected items (`(locked yes)` per lockable formatter —
 * tracks, arcs, vias, zones, graphics, text, footprints, groups). Pads /
 * footprint texts lock their parent footprint, like KiCad.
 */
export function setBoardItemsLocked(
  board: Board,
  ids: ReadonlySet<string>,
  locked: boolean | 'toggle',
): Board {
  const idx = indicesByKind(ids);
  // Pads / fp texts resolve to their parent footprint.
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r && (r.kind === 'pad' || r.kind === 'fptext')) idx.footprint.add(r.index);
  }
  const patch = <T extends { locked?: boolean; source: SList }>(item: T): T => {
    // 'toggle' flips each item independently (PCB_ACTIONS::toggleLock).
    const next = locked === 'toggle' ? !item.locked : locked;
    return {
      ...item,
      locked: next,
      source: next
        ? patchChild(item.source, 'locked', list(atom('locked'), atom('yes')))
        : removeChild(item.source, 'locked'),
    };
  };
  return {
    ...board,
    tracks: board.tracks.map((t, i) => (idx.track.has(i) ? patch(t) : t)),
    arcs: board.arcs.map((a, i) => (idx.arc.has(i) ? patch(a) : a)),
    vias: board.vias.map((v, i) => (idx.via.has(i) ? patch(v) : v)),
    zones: board.zones.map((z, i) => (idx.zone.has(i) ? patch(z) : z)),
    shapes: board.shapes.map((s, i) => (idx.shape.has(i) ? patch(s) : s)),
    texts: board.texts.map((t, i) => (idx.text.has(i) ? patch(t) : t)),
    footprints: board.footprints.map((f, i) => (idx.footprint.has(i) ? patch(f) : f)),
    groups: board.groups.map((g, i) => (idx.group.has(i) ? patch(g) : g)),
  };
}

// ----- page settings (DIALOG_PAGES_SETTINGS) ----------------------------------

/** The page settings the dialog edits (paper token + title block fields). */
export interface BoardPageSettings {
  /** `"A4"`, `"A4 portrait"`, or `"User <w> <h>"` (mm) — the schematic token. */
  paper: string;
  title: string;
  date: string;
  rev: string;
  company: string;
  /** Up to 9 comment lines; empty ones are dropped. */
  comments: readonly string[];
}

/**
 * Apply the Page Settings dialog result: rebuild the `(paper …)` and
 * `(title_block …)` source nodes (replace-or-append, like the schematic's
 * page_settings command) and mirror the typed model fields.
 */
export function setBoardPageSettings(board: Board, s: BoardPageSettings): Board {
  const parts = s.paper.split(/\s+/);
  const paperItems: SNode[] = [atom('paper'), str(parts[0] ?? 'A4')];
  if (parts[0] === 'User' && parts.length >= 3) paperItems.push(atom(parts[1]!), atom(parts[2]!));
  else if (parts[1] === 'portrait') paperItems.push(atom('portrait'));

  const tb: SNode[] = [atom('title_block')];
  if (s.title) tb.push(list(atom('title'), str(s.title)));
  if (s.date) tb.push(list(atom('date'), str(s.date)));
  if (s.rev) tb.push(list(atom('rev'), str(s.rev)));
  if (s.company) tb.push(list(atom('company'), str(s.company)));
  s.comments.forEach((c, i) => {
    if (c) tb.push(list(atom('comment'), atom(String(i + 1)), str(c)));
  });

  let source = patchChild(board.source, 'paper', { kind: 'list', items: paperItems });
  source =
    tb.length > 1
      ? patchChild(source, 'title_block', { kind: 'list', items: tb })
      : removeChild(source, 'title_block');
  return {
    ...board,
    paper: s.paper,
    titleBlock:
      tb.length > 1
        ? {
            title: s.title || undefined,
            date: s.date || undefined,
            rev: s.rev || undefined,
            company: s.company || undefined,
            comments: s.comments.some((c) => c) ? [...s.comments] : undefined,
          }
        : undefined,
    source,
  };
}

// ----- mirror (EDIT_TOOL::Mirror) ---------------------------------------------

/**
 * Mirror the selected items about the selection centre (EDIT_TOOL::Mirror).
 * `'v'` = mirrorV = FLIP_DIRECTION::TOP_BOTTOM (y flips), `'h'` = mirrorH =
 * LEFT_RIGHT (x flips). Mirrorable kinds: tracks, arcs, vias, graphics, text
 * (EDIT_TOOL::MirrorableItems). Footprints are skipped — KiCad: "Footprints
 * cannot be mirrored. Use Flip to move them to the other side of the board."
 * Zones are skipped like move/rotate (zone outline editing is staged).
 */
export function mirrorBoardItems(
  board: Board,
  ids: ReadonlySet<string>,
  direction: 'v' | 'h',
  center?: Vec2,
): Board {
  if (ids.size === 0) return board;
  const c =
    center ??
    (() => {
      const b = boardSelectionBBox(board, ids);
      return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
    })();
  const mir = (p: Vec2): Vec2 =>
    direction === 'v' ? { x: p.x, y: 2 * c.y - p.y } : { x: 2 * c.x - p.x, y: p.y };
  // Reflecting a rotation: across a horizontal axis θ→−θ, vertical θ→180−θ.
  const mirAngle = (deg: number): number => norm360(direction === 'v' ? -deg : 180 - deg);
  const idx = indicesByKind(ids);

  const mirTrack = (t: PcbTrack): PcbTrack => {
    const start = mir(t.start),
      end = mir(t.end);
    let src = patchChild(t.source, 'start', xyNode('start', start));
    src = patchChild(src, 'end', xyNode('end', end));
    return { ...t, start, end, source: src };
  };
  const mirArc = (a: PcbArcTrack): PcbArcTrack => {
    const start = mir(a.start),
      mid = mir(a.mid),
      end = mir(a.end);
    let src = patchChild(a.source, 'start', xyNode('start', start));
    src = patchChild(src, 'mid', xyNode('mid', mid));
    src = patchChild(src, 'end', xyNode('end', end));
    return { ...a, start, mid, end, source: src };
  };
  const mirVia = (v: PcbVia): PcbVia => {
    const at = mir(v.at);
    return { ...v, at, source: patchChild(v.source, 'at', atNode(at)) };
  };
  const mirText = (t: PcbTextItem): PcbTextItem => {
    const at = mir(t.at),
      angle = mirAngle(t.angle);
    return { ...t, at, angle, source: patchChild(t.source, 'at', atNode(at, angle)) };
  };
  const mirShape = (s: PcbShape): PcbShape => {
    const next = { ...s };
    if (s.center) next.center = mir(s.center);
    if (s.start) next.start = mir(s.start);
    if (s.end) next.end = mir(s.end);
    if (s.mid) next.mid = mir(s.mid);
    if (s.pts) next.pts = s.pts.map(mir);
    let src = s.source;
    if (next.center) src = patchChild(src, 'center', xyNode('center', next.center));
    if (next.start) src = patchChild(src, 'start', xyNode('start', next.start));
    if (next.end) src = patchChild(src, 'end', xyNode('end', next.end));
    if (next.mid) src = patchChild(src, 'mid', xyNode('mid', next.mid));
    if (next.pts) src = patchChild(src, 'pts', ptsNode(next.pts));
    return { ...next, source: src };
  };

  return {
    ...board,
    tracks: board.tracks.map((t, i) => (idx.track.has(i) ? mirTrack(t) : t)),
    arcs: board.arcs.map((a, i) => (idx.arc.has(i) ? mirArc(a) : a)),
    vias: board.vias.map((v, i) => (idx.via.has(i) ? mirVia(v) : v)),
    texts: board.texts.map((t, i) => (idx.text.has(i) ? mirText(t) : t)),
    shapes: board.shapes.map((s, i) => (idx.shape.has(i) ? mirShape(s) : s)),
  };
}

// ----- duplicate (EDIT_TOOL::Duplicate) ---------------------------------------

const genUuid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Deep-clone a board item and give it a fresh uuid (model + source). */
function cloneItem<T extends { uuid?: string; source: SList }>(item: T): T {
  const c = structuredClone(item);
  const uuid = genUuid();
  c.uuid = uuid;
  c.source = patchChild(c.source, 'uuid', list(atom('uuid'), str(uuid)));
  return c;
}

/**
 * Duplicate the selected items (EDIT_TOOL::Duplicate). Each clone is a deep copy
 * with a fresh uuid, appended to its array, then offset by `delta` so it doesn't
 * sit exactly on the original. Returns the new board plus the ids of the copies
 * (so the caller can select them / attach them to the cursor). Zones aren't
 * duplicated yet (see moveBoardItems).
 */
export function duplicateBoardItems(
  board: Board,
  ids: ReadonlySet<string>,
  delta: Vec2,
): { board: Board; ids: string[] } {
  if (ids.size === 0) return { board, ids: [] };
  const idx = indicesByKind(ids);
  const tracks = [...board.tracks],
    arcs = [...board.arcs],
    vias = [...board.vias];
  const footprints = [...board.footprints],
    shapes = [...board.shapes],
    texts = [...board.texts];
  const newIds: string[] = [];
  const dup = <T extends { uuid?: string; source: SList }>(
    arr: T[],
    src: T[],
    sel: Set<number>,
    kind: BoardItemKind,
  ): void => {
    for (const i of [...sel].sort((a, b) => a - b)) {
      const orig = src[i];
      if (!orig) continue;
      newIds.push(boardItemId(kind, arr.length));
      arr.push(cloneItem(orig));
    }
  };
  dup(tracks, board.tracks, idx.track, 'track');
  dup(arcs, board.arcs, idx.arc, 'arc');
  dup(vias, board.vias, idx.via, 'via');
  dup(footprints, board.footprints, idx.footprint, 'footprint');
  dup(shapes, board.shapes, idx.shape, 'shape');
  dup(texts, board.texts, idx.text, 'text');
  const copied: Board = { ...board, tracks, arcs, vias, footprints, shapes, texts };
  return { board: moveBoardItems(copied, new Set(newIds), delta), ids: newIds };
}
