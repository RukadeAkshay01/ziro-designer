/**
 * Wire hop-over geometry. Counterparts: `SCH_LINE::ShouldHopOver` +
 * `SCH_LINE::BuildWireWithHopShape` (eeschema/sch_line.cpp) and the painter's
 * consumption (sch_painter.cpp: arc radius = default line width ×
 * SCHEMATIC_SETTINGS::GetHopOverScale()).
 *
 * Where two unconnected wires cross, the "hopping" wire is drawn as segments
 * broken by a small arc over each crossing. Which wire hops: horizontal wires
 * hop over vertical ones; between sloped wires the shallower hops; equal
 * |slope| (45° crossings) resolves by signed slope comparison, like upstream.
 * Crossings at either line's endpoint (a T-junction) never hop.
 */

import type { SchLine, Vec2 } from '../types.js';

export type HopShapePart =
  | { kind: 'seg'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; start: Vec2; mid: Vec2; end: Vec2 };

/** SCH_LINE::ShouldHopOver — should `me` hop over `candidate`? */
export function shouldHopOver(me: SchLine, candidate: SchLine): boolean {
  const isMeVertical = me.end.x === me.start.x;
  const isCandidateVertical = candidate.end.x === candidate.start.x;

  // Vertical vs. horizontal: the horizontal wire hops.
  if (isMeVertical && !isCandidateVertical) return false;
  if (isCandidateVertical && !isMeVertical) return true;

  const slopeMe = (me.end.y - me.start.y) / (me.end.x - me.start.x);
  const slopeCandidate =
    (candidate.end.y - candidate.start.y) / (candidate.end.x - candidate.start.x);

  if (Math.abs(slopeMe) === Math.abs(slopeCandidate))
    // Can easily happen with 45° wires; signs are certainly different.
    return slopeMe < slopeCandidate;

  return Math.abs(slopeMe) < Math.abs(slopeCandidate); // the shallower hops
}

const isEndPoint = (l: SchLine, p: Vec2): boolean =>
  (l.start.x === p.x && l.start.y === p.y) || (l.end.x === p.x && l.end.y === p.y);

/** KiROUND — round half away from zero (std::llround). */
const kiRound = (v: number): number => Math.sign(v) * Math.floor(Math.abs(v) + 0.5);

/** rescale<int64_t> — aNumerator × aValue / aDenominator, rounded to nearest
 *  half away from zero, in exact integer arithmetic. */
function rescale(aNumerator: bigint, aValue: bigint, aDenominator: bigint): number {
  const numerator = aNumerator * aValue;
  const half = aDenominator / 2n; // BigInt division truncates, like C++
  const r = numerator < 0n !== aDenominator < 0n ? numerator - half : numerator + half;
  return Number(r / aDenominator);
}

/** SEG::Intersect( seg, aIgnoreEndpoints=true, aLines=false ) — the crossing
 *  point of two segments, null when parallel, collinear, non-crossing, or (per
 *  aIgnoreEndpoints) meeting at a shared vertex of both. Exact integer port of
 *  SEG::intersects(); the point is existing.A + rescale( q/d )·f. */
function segIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  // Quick rejection: segment bounding boxes must overlap.
  if (
    Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
    Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
    Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
    Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
  )
    return null;

  // Parametric form: P₁ = a1 + t·e, P₂ = b1 + s·f  (e = dir1, f = dir2).
  const e = { x: BigInt(a2.x - a1.x), y: BigInt(a2.y - a1.y) };
  const f = { x: BigInt(b2.x - b1.x), y: BigInt(b2.y - b1.y) };
  const ac = { x: BigInt(b1.x - a1.x), y: BigInt(b1.y - a1.y) };
  const d = f.x * e.y - f.y * e.x; // determinant = f × e
  if (d === 0n) return null; // parallel or collinear (collinear overlap can't hop)

  const q = e.x * ac.y - e.y * ac.x; // param1_num = e × ac
  const p = f.x * ac.y - f.y * ac.x; // param2_num = f × ac

  if (d > 0n) {
    if (q < 0n || q > d || p < 0n || p > d) return null;
  } else {
    if (q > 0n || q < d || p > 0n || p < d) return null;
  }

  // aIgnoreEndpoints: exclude only shared-vertex meetings of both segments.
  if ((q === 0n || q === d) && (p === 0n || p === d)) return null;

  return { x: b1.x + rescale(q, f.x, d), y: b1.y + rescale(q, f.y, d) };
}

/**
 * SCH_LINE::BuildWireWithHopShape — the wire's draw shape with a hop arc over
 * every crossing it should hop. `others` are the sheet's other wire/bus lines
 * (candidates); `arcRadius` = default line width × the hop-over scale.
 */
export function buildWireWithHopShape(
  line: SchLine,
  others: readonly SchLine[],
  arcRadius: number,
): HopShapePart[] {
  const out: HopShapePart[] = [];
  if (line.kind !== 'wire' && line.kind !== 'bus') {
    out.push({ kind: 'seg', a: line.start, b: line.end });
    return out;
  }

  const intersections: Vec2[] = [];
  for (const existing of others) {
    if (existing.kind !== 'wire' && existing.kind !== 'bus') continue;
    if (
      existing.start.x === line.start.x &&
      existing.start.y === line.start.y &&
      existing.end.x === line.end.x &&
      existing.end.y === line.end.y
    )
      continue;
    if (!shouldHopOver(line, existing)) continue;

    const intersect = segIntersect(line.start, line.end, existing.start, existing.end);
    if (intersect) {
      if (isEndPoint(line, intersect) || isEndPoint(existing, intersect)) continue;
      // Skip a point already just entered (several wires crossing at one spot).
      const last = intersections[intersections.length - 1];
      if (!last || last.x !== intersect.x || last.y !== intersect.y) intersections.push(intersect);
    }
  }

  if (intersections.length === 0) {
    out.push({ kind: 'seg', a: line.start, b: line.end });
    return out;
  }

  const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
  intersections.sort((a, b) => dist(line.start, a) - dist(line.start, b));

  let currentStart = line.start;
  const R = arcRadius;
  for (const hopMid of intersections) {
    const lineAngle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
    // Normalize to [0, π) so the arc side doesn't depend on start-vs-end.
    let arcAngle = lineAngle;
    if (arcAngle < 0) arcAngle += Math.PI;
    else if (arcAngle >= Math.PI) arcAngle -= Math.PI;

    const arcMidPoint: Vec2 = {
      x: hopMid.x + Math.trunc(R * Math.sin(arcAngle)),
      y: hopMid.y - Math.trunc(R * Math.cos(arcAngle)),
    };
    const beforeHop: Vec2 = {
      x: hopMid.x - kiRound(R * Math.cos(lineAngle)),
      y: hopMid.y - kiRound(R * Math.sin(lineAngle)),
    };
    const afterHop: Vec2 = {
      x: hopMid.x + kiRound(R * Math.cos(lineAngle)),
      y: hopMid.y + kiRound(R * Math.sin(lineAngle)),
    };

    out.push({ kind: 'seg', a: currentStart, b: beforeHop });
    out.push({ kind: 'arc', start: beforeHop, mid: arcMidPoint, end: afterHop });
    currentStart = afterHop;
  }
  out.push({ kind: 'seg', a: currentStart, b: line.end });
  return out;
}
