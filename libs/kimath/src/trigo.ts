/**
 * Faithful port of the integer RotatePoint from KiCad's libs/kimath/src/trigo.cpp.
 * KiCad mutates points through pointers; in TypeScript these return a new
 * VECTOR2I. Cardinal angles use the same exact-integer shortcuts KiCad does.
 */

import { EDA_ANGLE, ANGLE_0, ANGLE_90, ANGLE_180, ANGLE_270 } from './geometry/eda_angle.js';
import { VECTOR2I } from './math/vector2.js';

/** Rotate a point about the origin by `aAngle` (KiCad RotatePoint(int*,int*,angle)). */
export function RotatePoint(point: VECTOR2I, aAngle: EDA_ANGLE): VECTOR2I;
/** Rotate a point about `aCentre` by `aAngle` (KiCad RotatePoint(pt,centre,angle)). */
export function RotatePoint(point: VECTOR2I, aCentre: VECTOR2I, aAngle: EDA_ANGLE): VECTOR2I;
export function RotatePoint(point: VECTOR2I, b: VECTOR2I | EDA_ANGLE, c?: EDA_ANGLE): VECTOR2I {
  if (b instanceof EDA_ANGLE) return rotateAboutOrigin(point, b);
  const centre = b,
    angle = c as EDA_ANGLE;
  const o = rotateAboutOrigin({ x: point.x - centre.x, y: point.y - centre.y }, angle);
  return { x: o.x + centre.x, y: o.y + centre.y };
}

/** Squared distance from a point to segment a-b (KiCad SEG::SquaredDistance). */
function segSquaredDistance(ref: VECTOR2I, a: VECTOR2I, b: VECTOR2I): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = ref.x - a.x,
      ey = ref.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((ref.x - a.x) * dx + (ref.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx,
    py = a.y + t * dy;
  const ex = ref.x - px,
    ey = ref.y - py;
  return ex * ex + ey * ey;
}

/**
 * Whether `aRefPoint` is within `aDist` of segment aStart-aEnd (faithful port of
 * TestSegmentHit in trigo.cpp — bbox rejects, axis-aligned shortcuts, then the
 * general squared-distance test against (aDist+1)^2).
 */
export function TestSegmentHit(
  aRefPoint: VECTOR2I,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aDist: number,
): boolean {
  let xmin = aStart.x,
    xmax = aEnd.x,
    ymin = aStart.y,
    ymax = aEnd.y;
  const delta = { x: aStart.x - aRefPoint.x, y: aStart.y - aRefPoint.y };
  if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
  if (ymax < ymin) [ymin, ymax] = [ymax, ymin];
  if (ymin - aRefPoint.y > aDist || aRefPoint.y - ymax > aDist) return false;
  if (xmin - aRefPoint.x > aDist || aRefPoint.x - xmax > aDist) return false;
  if (aStart.x === aEnd.x && aRefPoint.y > ymin && aRefPoint.y < ymax)
    return Math.abs(delta.x) <= aDist;
  if (aStart.y === aEnd.y && aRefPoint.x > xmin && aRefPoint.x < xmax)
    return Math.abs(delta.y) <= aDist;
  return segSquaredDistance(aRefPoint, aStart, aEnd) < (aDist + 1) * (aDist + 1);
}

function rotateAboutOrigin(p: VECTOR2I, aAngle: EDA_ANGLE): VECTOR2I {
  const angle = aAngle.Normalized();
  // Cheap, exact shortcuts for 0, 90, 180, 270 degrees.
  if (angle.equals(ANGLE_0)) return VECTOR2I(p.x, p.y);
  if (angle.equals(ANGLE_90)) return VECTOR2I(p.y, -p.x); // sin=1, cos=0
  if (angle.equals(ANGLE_180)) return VECTOR2I(-p.x, -p.y); // sin=0, cos=-1
  if (angle.equals(ANGLE_270)) return VECTOR2I(-p.y, p.x); // sin=-1, cos=0
  const s = angle.Sin();
  const cos = angle.Cos();
  return VECTOR2I(Math.round(p.y * s + p.x * cos), Math.round(p.y * cos - p.x * s));
}
