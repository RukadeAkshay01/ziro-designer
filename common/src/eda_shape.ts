/**
 * EDA_SHAPE — the graphic-shape geometry shared by pcb and schematic items
 * (common/eda_shape.{h,cpp}). In KiCad it is a mixin base; TypeScript has no
 * multiple inheritance, so PCB_SHAPE composes an EDA_SHAPE (pcb_shape.ts).
 *
 * Ports move/rotate/flip and hitTest for the shape kinds that appear in a
 * `.kicad_pcb`: SEGMENT, RECTANGLE, CIRCLE, ARC, POLY, BEZIER. Method bodies
 * mirror eda_shape.cpp (move/rotate/flip and hitTest at :1273). Heavy paths
 * KiCad routes through SHAPE_POLY_SET (hatched fill, rounded-rect edge collide)
 * are simplified to the analytic equivalent and marked.
 */

import { type VECTOR2I, Distance } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { MIRROR, type FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

export enum SHAPE_T {
  UNDEFINED,
  SEGMENT,
  RECTANGLE,
  ARC,
  CIRCLE,
  POLY,
  BEZIER,
}

/** Circumcentre of three points (KiCad CalcArcCenter), or the start/end midpoint. */
function circumcenter(a: VECTOR2I, b: VECTOR2I, c: VECTOR2I): VECTOR2I {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return { x: Math.round((a.x + c.x) / 2), y: Math.round((a.y + c.y) / 2) };
  const a2 = a.x * a.x + a.y * a.y,
    b2 = b.x * b.x + b.y * b.y,
    c2 = c.x * c.x + c.y * c.y;
  return {
    x: Math.round((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d) + 0,
    y: Math.round((a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d) + 0,
  };
}

export class EDA_SHAPE {
  protected m_shape: SHAPE_T;
  protected m_start: VECTOR2I;
  protected m_end: VECTOR2I;
  protected m_mid: VECTOR2I; // ARC third point (KiCad reconstructs m_arcCenter from it)
  protected m_poly: VECTOR2I[]; // POLY/BEZIER points
  protected m_width: number;
  protected m_filled: boolean;

  constructor(
    shape: SHAPE_T,
    opts: {
      start?: VECTOR2I;
      end?: VECTOR2I;
      mid?: VECTOR2I;
      poly?: VECTOR2I[];
      width?: number;
      filled?: boolean;
    } = {},
  ) {
    this.m_shape = shape;
    this.m_start = { ...(opts.start ?? { x: 0, y: 0 }) };
    this.m_end = { ...(opts.end ?? { x: 0, y: 0 }) };
    this.m_mid = { ...(opts.mid ?? { x: 0, y: 0 }) };
    this.m_poly = (opts.poly ?? []).map((p) => ({ ...p }));
    this.m_width = opts.width ?? 0;
    this.m_filled = opts.filled ?? false;
  }

  GetShape(): SHAPE_T {
    return this.m_shape;
  }
  GetStart(): VECTOR2I {
    return this.m_start;
  }
  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  GetWidth(): number {
    return this.m_width;
  }
  IsFilledForHitTesting(): boolean {
    return this.m_filled;
  }

  /** getCenter(): circle centre is m_start; arc centre is the circumcentre. */
  getCenter(): VECTOR2I {
    if (this.m_shape === SHAPE_T.ARC) return circumcenter(this.m_start, this.m_mid, this.m_end);
    return this.m_start;
  }

  GetRadius(): number {
    if (this.m_shape === SHAPE_T.ARC) return Distance(this.getCenter(), this.m_start);
    return Distance(this.m_start, this.m_end);
  }

  /** Corners of a RECTANGLE (m_start / m_end are opposite corners). */
  GetRectCorners(): VECTOR2I[] {
    return [
      { x: this.m_start.x, y: this.m_start.y },
      { x: this.m_end.x, y: this.m_start.y },
      { x: this.m_end.x, y: this.m_end.y },
      { x: this.m_start.x, y: this.m_end.y },
    ];
  }

  // ---- transforms (EDA_SHAPE::move / rotate / flip) -------------------------
  move(aMoveVector: VECTOR2I): void {
    const mv = (p: VECTOR2I): VECTOR2I => ({ x: p.x + aMoveVector.x, y: p.y + aMoveVector.y });
    this.m_start = mv(this.m_start);
    this.m_end = mv(this.m_end);
    if (this.m_shape === SHAPE_T.ARC) this.m_mid = mv(this.m_mid);
    if (this.m_shape === SHAPE_T.POLY || this.m_shape === SHAPE_T.BEZIER)
      this.m_poly = this.m_poly.map(mv);
  }

  rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    const rp = (p: VECTOR2I): VECTOR2I => RotatePoint(p, aRotCentre, aAngle);
    this.m_start = rp(this.m_start);
    this.m_end = rp(this.m_end);
    if (this.m_shape === SHAPE_T.ARC) this.m_mid = rp(this.m_mid);
    if (this.m_shape === SHAPE_T.POLY || this.m_shape === SHAPE_T.BEZIER)
      this.m_poly = this.m_poly.map(rp);
  }

  flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_start, aCentre, aFlipDirection);
    MIRROR(this.m_end, aCentre, aFlipDirection);
    if (this.m_shape === SHAPE_T.ARC) {
      MIRROR(this.m_mid, aCentre, aFlipDirection);
      [this.m_start, this.m_end] = [this.m_end, this.m_start]; // KiCad swaps start/end
    }
    if (this.m_shape === SHAPE_T.POLY || this.m_shape === SHAPE_T.BEZIER) {
      for (const p of this.m_poly) MIRROR(p, aCentre, aFlipDirection);
    }
  }

  // ---- hit test (EDA_SHAPE::hitTest, eda_shape.cpp:1273) --------------------
  hitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    let maxdist = aAccuracy;
    if (this.m_width > 0) maxdist += this.m_width / 2.0;

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE: {
        const radius = this.GetRadius();
        const dist = Distance(aPosition, this.getCenter());
        if (this.IsFilledForHitTesting()) return dist <= radius + maxdist;
        return Math.abs(radius - dist) <= maxdist;
      }
      case SHAPE_T.ARC: {
        if (Distance(aPosition, this.m_start) <= maxdist) return true;
        if (Distance(aPosition, this.m_end) <= maxdist) return true;
        const center = this.getCenter();
        const relPos = { x: aPosition.x - center.x, y: aPosition.y - center.y };
        const dist = Math.hypot(relPos.x, relPos.y);
        const radius = this.GetRadius();
        if (this.IsFilledForHitTesting()) {
          if (dist > radius + maxdist) return false;
        } else if (Math.abs(radius - dist) > maxdist) return false;
        return this.arcSweepContains(relPos);
      }
      case SHAPE_T.SEGMENT:
        return TestSegmentHit(aPosition, this.m_start, this.m_end, maxdist);
      case SHAPE_T.RECTANGLE: {
        if (this.IsFilledForHitTesting()) {
          const x0 = Math.min(this.m_start.x, this.m_end.x) - maxdist,
            x1 = Math.max(this.m_start.x, this.m_end.x) + maxdist;
          const y0 = Math.min(this.m_start.y, this.m_end.y) - maxdist,
            y1 = Math.max(this.m_start.y, this.m_end.y) + maxdist;
          return aPosition.x >= x0 && aPosition.x <= x1 && aPosition.y >= y0 && aPosition.y <= y1;
        }
        const p = this.GetRectCorners();
        return (
          TestSegmentHit(aPosition, p[0]!, p[1]!, maxdist) ||
          TestSegmentHit(aPosition, p[1]!, p[2]!, maxdist) ||
          TestSegmentHit(aPosition, p[2]!, p[3]!, maxdist) ||
          TestSegmentHit(aPosition, p[3]!, p[0]!, maxdist)
        );
      }
      case SHAPE_T.POLY:
      case SHAPE_T.BEZIER: {
        if (this.m_poly.length < 2) return false;
        if (
          this.IsFilledForHitTesting() &&
          this.m_poly.length >= 3 &&
          pointInPolygon(aPosition, this.m_poly)
        )
          return true;
        for (let i = 1; i < this.m_poly.length; i++) {
          if (TestSegmentHit(aPosition, this.m_poly[i - 1]!, this.m_poly[i]!, maxdist)) return true;
        }
        if (
          this.m_shape === SHAPE_T.POLY &&
          this.m_poly.length >= 3 &&
          TestSegmentHit(aPosition, this.m_poly[this.m_poly.length - 1]!, this.m_poly[0]!, maxdist)
        )
          return true;
        return false;
      }
      default:
        return false;
    }
  }

  /** Whether a point's angle (relative to centre) lies on the arc's sweep. */
  private arcSweepContains(relPos: VECTOR2I): boolean {
    const center = this.getCenter();
    const a0 = Math.atan2(this.m_start.y - center.y, this.m_start.x - center.x);
    const am = Math.atan2(this.m_mid.y - center.y, this.m_mid.x - center.x);
    const a1 = Math.atan2(this.m_end.y - center.y, this.m_end.x - center.x);
    const ap = Math.atan2(relPos.y, relPos.x);
    const span = (from: number, to: number): number => {
      let d = to - from;
      while (d < 0) d += Math.PI * 2;
      return d;
    };
    const sweep = span(a0, a1);
    if (span(a0, am) <= sweep) return span(a0, ap) <= sweep; // CCW arc
    return span(ap, a0) <= span(a1, a0); // CW arc
  }
}

/** Even-odd ray cast (point in polygon). */
function pointInPolygon(p: VECTOR2I, poly: VECTOR2I[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
