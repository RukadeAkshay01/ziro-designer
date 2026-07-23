/**
 * Ambiguous-click collection. Counterpart: `eeschema/sch_collectors.cpp`
 * (SCH_COLLECTOR) + `SCH_SELECTION_TOOL::GuessSelectionCandidates`
 * (eeschema/tools/sch_selection_tool.cpp) + the per-item
 * `GetItemDescription` strings the Clarify Selection menu shows.
 *
 * `collectAndGuess` gathers every selectable item under the cursor and trims
 * the list exactly as upstream does: exact hits beat sloppy ones, the closest
 * item is found (junctions win instantly; filled shapes are "dominating" and
 * never win the distance race), then everything not fully inside a tight box
 * (the closest item's bbox deflated by a quarter) is dropped. One survivor
 * selects directly; several mean the caller shows the Clarify menu.
 */

import type { LibSymbol, SchLabel, Schematic, Vec2 } from '../types.js';
import { iuToMM } from '@ziroeda/common';
import { refId, type ItemRef, hitTest } from './hittest.js';
import { contains, inflate, labelBox, symbolBodyBBox, type BBox } from './bbox.js';

interface Candidate {
  ref: ItemRef;
  index: number;
  exact: boolean;
  /** Distance metric for the closest-item race (world IU). */
  dist: number;
  /** Filled shapes win hit tests anywhere inside — kept selectable but never
   *  promoted to closest (upstream's `dominating`). */
  dominating: boolean;
  /** Instant winner of the closest race (junctions; upstream also pins). */
  instant: boolean;
  bbox: BBox;
}

const dSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Distance from `p` to a rect: 0 when inside, else to the boundary. */
function dRect(p: Vec2, b: BBox): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
}

const boxOf = (pts: Vec2[]): BBox => {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
};

const boxWithin = (inner: BBox, outer: BBox): boolean =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY &&
  inner.maxY <= outer.maxY;

/**
 * All selectable items within `accuracy` of `p`, trimmed by the
 * GuessSelectionCandidates heuristics, closest first. `lineSlop` is the
 * "6 pixels in world units" leeway lines/arcs/polylines keep even for the
 * exact-hit test (they are hard to hit).
 */
export function collectAndGuess(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  accuracy: number,
  lineSlop = accuracy,
): ItemRef[] {
  const cands: Candidate[] = [];

  for (let i = 0; i < sch.junctions.length; i++) {
    const j = sch.junctions[i]!;
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2;
    const d = Math.hypot(p.x - j.at.x, p.y - j.at.y);
    if (d <= r + accuracy) {
      cands.push({
        ref: { kind: 'junction', id: refId('junction', j.uuid, i) },
        index: i,
        exact: d <= r,
        dist: d,
        dominating: false,
        instant: d <= r,
        bbox: { minX: j.at.x - r, minY: j.at.y - r, maxX: j.at.x + r, maxY: j.at.y + r },
      });
    }
  }

  for (let i = 0; i < sch.noConnects.length; i++) {
    const nc = sch.noConnects[i]!;
    const half = 6096; // 24 mil in IU
    const bbox: BBox = {
      minX: nc.at.x - half,
      minY: nc.at.y - half,
      maxX: nc.at.x + half,
      maxY: nc.at.y + half,
    };
    if (dRect(p, bbox) <= accuracy) {
      cands.push({
        ref: { kind: 'noconnect', id: refId('noconnect', nc.uuid, i) },
        index: i,
        exact: contains(bbox, p),
        dist: Math.hypot(p.x - nc.at.x, p.y - nc.at.y),
        dominating: false,
        instant: false,
        bbox,
      });
    }
  }

  for (let i = 0; i < sch.labels.length; i++) {
    const l = sch.labels[i]!;
    const bbox = labelBox(l);
    if (contains(inflate(bbox, accuracy), p)) {
      cands.push({
        ref: { kind: 'label', id: refId('label', l.uuid, i) },
        index: i,
        exact: contains(bbox, p),
        // Upstream collides against the glyph shape; the bbox boundary-or-
        // centre blend below keeps small labels competitive with wires.
        dist: Math.hypot(p.x - (bbox.minX + bbox.maxX) / 2, p.y - (bbox.minY + bbox.maxY) / 2) / 2,
        dominating: false,
        instant: false,
        bbox,
      });
    }
  }

  for (let i = 0; i < sch.lines.length; i++) {
    const ln = sch.lines[i]!;
    const half = ln.stroke && ln.stroke.width > 0 ? ln.stroke.width / 2 : 0;
    const d = dSeg(p, ln.start, ln.end);
    if (d <= accuracy + half) {
      cands.push({
        ref: { kind: 'line', id: refId('line', ln.uuid, i) },
        index: i,
        exact: d <= lineSlop + half,
        dist: d,
        dominating: false,
        instant: false,
        bbox: boxOf([ln.start, ln.end]),
      });
    }
  }

  for (let i = 0; i < sch.busEntries.length; i++) {
    const be = sch.busEntries[i]!;
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    const d = dSeg(p, be.at, end);
    if (d <= accuracy) {
      cands.push({
        ref: { kind: 'busentry', id: refId('busentry', be.uuid, i) },
        index: i,
        exact: d <= lineSlop,
        dist: d,
        dominating: false,
        instant: false,
        bbox: boxOf([be.at, end]),
      });
    }
  }

  for (let i = 0; i < sch.graphics.length; i++) {
    const g = sch.graphics[i]!;
    const info = graphicHitInfo(g, p, accuracy, lineSlop);
    if (info) {
      cands.push({
        ref: { kind: 'graphic', id: refId('graphic', undefined, i) },
        index: i,
        ...info,
        instant: false,
      });
    }
  }

  for (let i = 0; i < sch.symbols.length; i++) {
    const s = sch.symbols[i]!;
    const bbox = symbolBodyBBox(s, libById.get(s.libId));
    if (contains(inflate(bbox, accuracy / 2), p)) {
      cands.push({
        ref: { kind: 'symbol', id: refId('symbol', s.uuid, i) },
        index: i,
        exact: contains(bbox, p),
        // Inside the body: distance to its centre (GuessSelectionCandidates'
        // symbol rule), so a wire crossing the body still wins near itself.
        dist: contains(bbox, p)
          ? Math.hypot(p.x - (bbox.minX + bbox.maxX) / 2, p.y - (bbox.minY + bbox.maxY) / 2)
          : dRect(p, bbox),
        dominating: false,
        instant: false,
        bbox,
      });
    }
  }

  for (let i = 0; i < sch.textBoxes.length; i++) {
    const tb = sch.textBoxes[i]!;
    const bbox = boxOf([tb.start, tb.end]);
    if (dRect(p, bbox) <= accuracy) {
      cands.push({
        ref: { kind: 'textbox', id: refId('textbox', tb.uuid, i) },
        index: i,
        exact: contains(bbox, p),
        dist: Math.hypot(p.x - (bbox.minX + bbox.maxX) / 2, p.y - (bbox.minY + bbox.maxY) / 2),
        dominating: false,
        instant: false,
        bbox,
      });
    }
  }

  for (let i = 0; i < sch.sheets.length; i++) {
    const sh = sch.sheets[i]!;
    const bbox: BBox = {
      minX: sh.at.x,
      minY: sh.at.y,
      maxX: sh.at.x + sh.size.w,
      maxY: sh.at.y + sh.size.h,
    };
    if (contains(inflate(bbox, accuracy), p)) {
      cands.push({
        ref: { kind: 'sheet', id: refId('sheet', sh.uuid, i) },
        index: i,
        exact: contains(bbox, p),
        dist: Math.hypot(p.x - (bbox.minX + bbox.maxX) / 2, p.y - (bbox.minY + bbox.maxY) / 2),
        // A sheet body contains everything drawn on it — like a filled shape,
        // it must not win the closest race against items inside it.
        dominating: true,
        instant: false,
        bbox,
      });
    }
  }

  if (cands.length === 0) {
    // Fall back to the plain hit test for kinds not modelled here (images,
    // tables) so behavior never regresses.
    const hit = hitTest(sch, libById, p, accuracy);
    return hit ? [hit] : [];
  }

  // Prefer exact hits to sloppy ones.
  const exactCount = cands.filter((c) => c.exact).length;
  let pool = cands;
  if (exactCount > 0 && exactCount < cands.length) pool = cands.filter((c) => c.exact);

  // Closest item: junctions win instantly; dominating items never win.
  let closest: Candidate | null = null;
  for (const c of pool) {
    if (c.instant && c.exact) {
      closest = c;
      break;
    }
    if (c.dominating) continue;
    if (!closest || c.dist < closest.dist) closest = c;
  }

  // Drop everything not fully inside the closest item's tight box — those
  // items have clickable area elsewhere.
  if (closest) {
    const w = closest.bbox.maxX - closest.bbox.minX;
    const h = closest.bbox.maxY - closest.bbox.minY;
    const tight: BBox = {
      minX: closest.bbox.minX + w / 4,
      maxX: closest.bbox.maxX - w / 4,
      minY: closest.bbox.minY + h / 4,
      maxY: closest.bbox.maxY - h / 4,
    };
    pool = pool.filter((c) => c === closest || boxWithin(c.bbox, tight));
  }

  pool = [...pool].sort((a, b) => (a === closest ? -1 : b === closest ? 1 : a.dist - b.dist));
  return pool.map((c) => c.ref);
}

function graphicHitInfo(
  g: import('../types.js').LibGraphic,
  p: Vec2,
  accuracy: number,
  lineSlop: number,
): { exact: boolean; dist: number; dominating: boolean; bbox: BBox } | null {
  switch (g.kind) {
    case 'rectangle': {
      const bbox = boxOf([g.start, g.end]);
      const filled = !!g.fill && g.fill.type !== 'none';
      const edge = Math.min(
        dSeg(p, { x: bbox.minX, y: bbox.minY }, { x: bbox.maxX, y: bbox.minY }),
        dSeg(p, { x: bbox.minX, y: bbox.maxY }, { x: bbox.maxX, y: bbox.maxY }),
        dSeg(p, { x: bbox.minX, y: bbox.minY }, { x: bbox.minX, y: bbox.maxY }),
        dSeg(p, { x: bbox.maxX, y: bbox.minY }, { x: bbox.maxX, y: bbox.maxY }),
      );
      const inside = contains(bbox, p);
      if (filled && inside) return { exact: true, dist: edge, dominating: true, bbox };
      if (edge <= accuracy) return { exact: edge <= lineSlop, dist: edge, dominating: false, bbox };
      return null;
    }
    case 'circle': {
      const d = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      const bbox: BBox = {
        minX: g.center.x - g.radius,
        minY: g.center.y - g.radius,
        maxX: g.center.x + g.radius,
        maxY: g.center.y + g.radius,
      };
      const filled = !!g.fill && g.fill.type !== 'none';
      if (filled && d <= g.radius)
        return { exact: true, dist: Math.abs(d - g.radius), dominating: true, bbox };
      if (Math.abs(d - g.radius) <= accuracy)
        return {
          exact: Math.abs(d - g.radius) <= lineSlop,
          dist: Math.abs(d - g.radius),
          dominating: false,
          bbox,
        };
      return null;
    }
    case 'arc': {
      const d = Math.min(dSeg(p, g.start, g.mid), dSeg(p, g.mid, g.end));
      if (d > accuracy) return null;
      return {
        exact: d <= lineSlop,
        dist: d,
        dominating: false,
        bbox: boxOf([g.start, g.mid, g.end]),
      };
    }
    case 'polyline':
    case 'bezier': {
      let d = Infinity;
      for (let i = 1; i < g.points.length; i++)
        d = Math.min(d, dSeg(p, g.points[i - 1]!, g.points[i]!));
      if (d > accuracy) return null;
      return { exact: d <= lineSlop, dist: d, dominating: false, bbox: boxOf([...g.points]) };
    }
    case 'text': {
      // Rough glyph box around the anchor; fine for clarify-menu purposes.
      const h = g.effects?.fontSize?.[0] ?? 1.27 * 10000;
      const w = (g.text?.length ?? 1) * h * 0.7;
      const bbox: BBox = {
        minX: g.at.x - w / 2,
        maxX: g.at.x + w / 2,
        minY: g.at.y - h,
        maxY: g.at.y + h,
      };
      if (!contains(inflate(bbox, accuracy), p)) return null;
      return {
        exact: contains(bbox, p),
        dist: Math.hypot(p.x - g.at.x, p.y - g.at.y),
        dominating: false,
        bbox,
      };
    }
    default:
      return null;
  }
}

const ellipsize = (s: string, n = 36): string => (s.length > n ? `${s.slice(0, n)}…` : s);

const mm = (iu: number): string => `${iuToMM(iu).toFixed(2)} mm`;

const labelDescription = (l: SchLabel): string => {
  switch (l.kind) {
    case 'global_label':
      return `Global Label '${ellipsize(l.text)}'`;
    case 'hierarchical_label':
      return `Hierarchical Label '${ellipsize(l.text)}'`;
    case 'text':
      return `Graphic Text '${ellipsize(l.text)}'`;
    default:
      return `Label '${ellipsize(l.text)}'`;
  }
};

/** The Clarify Selection row text — each item's GetItemDescription. */
export function describeItem(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ref: ItemRef,
): string {
  const find = <T>(arr: readonly T[], uuid: (t: T, i: number) => string): T | undefined => {
    for (let i = 0; i < arr.length; i++) if (uuid(arr[i]!, i) === ref.id) return arr[i]!;
    return undefined;
  };
  switch (ref.kind) {
    case 'symbol': {
      const s = find(sch.symbols, (t, i) => refId('symbol', t.uuid, i));
      if (!s) return 'Symbol';
      const r = s.fields.find((f) => f.key === 'Reference')?.value ?? '?';
      const name = s.libId.split(':').pop() ?? s.libId;
      return `Symbol ${ellipsize(r)} [${ellipsize(name)}]`;
    }
    case 'line': {
      const l = find(sch.lines, (t, i) => refId('line', t.uuid, i));
      if (!l) return 'Wire';
      const len = mm(Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y));
      const orient =
        l.start.x === l.end.x ? 'Vertical ' : l.start.y === l.end.y ? 'Horizontal ' : '';
      const kind = l.kind === 'bus' ? 'Bus' : l.kind === 'wire' ? 'Wire' : 'Graphic Line';
      return `${orient}${kind}, length ${len}`;
    }
    case 'junction':
      return 'Junction';
    case 'noconnect':
      return 'No Connect';
    case 'label': {
      const l = find(sch.labels, (t, i) => refId('label', t.uuid, i));
      return l ? labelDescription(l) : 'Label';
    }
    case 'sheet': {
      const sh = find(sch.sheets, (t, i) => refId('sheet', t.uuid, i));
      const name = sh?.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
      return `Hierarchical Sheet '${ellipsize(name)}'`;
    }
    case 'busentry':
      return 'Bus to wire entry';
    case 'image':
      return 'Bitmap Image';
    case 'graphic': {
      const idx = Number(/^graphic:idx:(\d+)$/.exec(ref.id)?.[1] ?? -1);
      const g = sch.graphics[idx];
      if (!g) return 'Graphic';
      switch (g.kind) {
        case 'rectangle':
          return 'Rectangle';
        case 'circle':
          return `Circle, radius ${mm(g.radius)}`;
        case 'arc':
          return 'Arc';
        case 'bezier':
          return 'Bezier Curve';
        case 'text':
          return `Graphic Text '${ellipsize(g.text ?? '')}'`;
        default:
          return 'Polyline';
      }
    }
    case 'textbox': {
      const tb = find(sch.textBoxes, (t, i) => refId('textbox', t.uuid, i));
      return `Text box '${ellipsize(tb?.text ?? '')}'`;
    }
    case 'table':
      return 'Table';
    default:
      return ref.kind;
  }
}
