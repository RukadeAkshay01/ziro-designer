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

/**
 * Circumcenter of three points (faithful port of the VECTOR2D CalcArcCenter in
 * trigo.cpp): special cases for clustered/collinear/axis-crossing inputs, then
 * the two-chord-slope formula, with KiCad's rounding-uncertainty estimate that
 * snaps the center to a nearby multiple of 100 or 10 IU when every value inside
 * the uncertainty range is equally true.
 */
export function CalcArcCenter(
  aStart: { x: number; y: number },
  aMid: { x: number; y: number },
  aEnd: { x: number; y: number },
): { x: number; y: number } {
  // If the three input points are clustered within a 10 IU bounding box, no
  // meaningful circumcircle exists so return the centroid
  const kCoincidentRadius = 5.0;
  const minX = Math.min(aStart.x, aMid.x, aEnd.x);
  const maxX = Math.max(aStart.x, aMid.x, aEnd.x);
  const minY = Math.min(aStart.y, aMid.y, aEnd.y);
  const maxY = Math.max(aStart.y, aMid.y, aEnd.y);

  if (maxX - minX < kCoincidentRadius && maxY - minY < kCoincidentRadius) {
    return { x: (aStart.x + aMid.x + aEnd.x) / 3.0, y: (aStart.y + aMid.y + aEnd.y) / 3.0 };
  }

  let yDelta_21 = aMid.y - aStart.y;
  let xDelta_21 = aMid.x - aStart.x;
  let yDelta_32 = aEnd.y - aMid.y;
  let xDelta_32 = aEnd.x - aMid.x;

  // This is a special case for aMid as the half-way point when aSlope = 0 and
  // bSlope = inf or the other way around.  In that case, the center lies in a
  // straight line between aStart and aEnd
  if ((xDelta_21 === 0.0 && yDelta_32 === 0.0) || (yDelta_21 === 0.0 && xDelta_32 === 0.0)) {
    return { x: (aStart.x + aEnd.x) / 2.0, y: (aStart.y + aEnd.y) / 2.0 };
  }

  const EPS = Number.EPSILON;

  // Prevent div-by-0 errors
  if (xDelta_21 === 0.0) xDelta_21 = EPS;
  if (xDelta_32 === 0.0) xDelta_32 = -EPS;

  let aSlope = yDelta_21 / xDelta_21;
  let bSlope = yDelta_32 / xDelta_32;

  // Guard the y-deltas after the slopes are taken so a horizontal chord keeps
  // its exact zero slope while the 0.5/yDelta uncertainty terms below stay
  // finite instead of a NaN-yielding inf
  if (yDelta_21 === 0.0) yDelta_21 = EPS;
  if (yDelta_32 === 0.0) yDelta_32 = EPS;

  const daSlope = aSlope * Math.hypot(0.5 / yDelta_21, 0.5 / xDelta_21);
  const dbSlope = bSlope * Math.hypot(0.5 / yDelta_32, 0.5 / xDelta_32);

  if (aSlope === bSlope) {
    if (aStart.x === aEnd.x && aStart.y === aEnd.y) {
      // This is a special case for a 360 degrees arc.  In this case, the
      // center is halfway between the midpoint and either end point.
      return { x: (aStart.x + aMid.x) / 2.0, y: (aStart.y + aMid.y) / 2.0 };
    }
    // If the points are colinear, the center is at infinity, so offset the
    // slope by a minimal amount.  Warning: This will induce a small error in
    // the center location
    aSlope += EPS;
    bSlope -= EPS;
  }

  // Prevent divide by zero error — a small value is used;
  // std::numeric_limits<double>::epsilon() is too small and generates false results
  if (aSlope === 0.0) aSlope = 1e-10;
  if (bSlope === 0.0) bSlope = 1e-10;

  // Calculation of the center using the slope of the two lines as well as the
  // propagated error that occurs when rounding to the nearest nanometer.
  const M_SQRT1_2 = Math.SQRT1_2;

  const abSlopeStartEndY = aSlope * bSlope * (aStart.y - aEnd.y);
  const dabSlopeStartEndY =
    abSlopeStartEndY *
    Math.sqrt(
      (daSlope / aSlope) * (daSlope / aSlope) +
        (dbSlope / bSlope) * (dbSlope / bSlope) +
        (M_SQRT1_2 / (aStart.y - aEnd.y)) * (M_SQRT1_2 / (aStart.y - aEnd.y)),
    );

  const bSlopeStartMidX = bSlope * (aStart.x + aMid.x);
  const dbSlopeStartMidX =
    bSlopeStartMidX *
    Math.sqrt(
      (dbSlope / bSlope) * (dbSlope / bSlope) +
        (M_SQRT1_2 / (aStart.x + aMid.x)) * (M_SQRT1_2 / (aStart.x + aMid.x)),
    );

  const aSlopeMidEndX = aSlope * (aMid.x + aEnd.x);
  const daSlopeMidEndX =
    aSlopeMidEndX *
    Math.sqrt(
      (daSlope / aSlope) * (daSlope / aSlope) +
        (M_SQRT1_2 / (aMid.x + aEnd.x)) * (M_SQRT1_2 / (aMid.x + aEnd.x)),
    );

  const twiceBASlopeDiff = 2 * (bSlope - aSlope);
  const dtwiceBASlopeDiff = 2 * Math.sqrt(dbSlope * dbSlope + daSlope * daSlope);

  const centerNumeratorX = abSlopeStartEndY + bSlopeStartMidX - aSlopeMidEndX;
  const dCenterNumeratorX = Math.sqrt(
    dabSlopeStartEndY * dabSlopeStartEndY +
      dbSlopeStartMidX * dbSlopeStartMidX +
      daSlopeMidEndX * daSlopeMidEndX,
  );

  const centerX = (abSlopeStartEndY + bSlopeStartMidX - aSlopeMidEndX) / twiceBASlopeDiff;
  const dCenterX =
    centerX *
    Math.sqrt(
      (dCenterNumeratorX / centerNumeratorX) * (dCenterNumeratorX / centerNumeratorX) +
        (dtwiceBASlopeDiff / twiceBASlopeDiff) * (dtwiceBASlopeDiff / twiceBASlopeDiff),
    );

  const centerNumeratorY = (aStart.x + aMid.x) / 2.0 - centerX;
  const dCenterNumeratorY = Math.sqrt(1.0 / 8.0 + dCenterX * dCenterX);

  const centerFirstTerm = centerNumeratorY / aSlope;
  const dcenterFirstTermY =
    centerFirstTerm *
    Math.sqrt(
      (dCenterNumeratorY / centerNumeratorY) * (dCenterNumeratorY / centerNumeratorY) +
        (daSlope / aSlope) * (daSlope / aSlope),
    );

  const centerY = centerFirstTerm + (aStart.y + aMid.y) / 2.0;
  const dCenterY = Math.sqrt(dcenterFirstTermY * dcenterFirstTermY + 1.0 / 8.0);

  const rounded100CenterX = Math.floor((centerX + 50.0) / 100.0) * 100.0;
  const rounded100CenterY = Math.floor((centerY + 50.0) / 100.0) * 100.0;
  const rounded10CenterX = Math.floor((centerX + 5.0) / 10.0) * 10.0;
  const rounded10CenterY = Math.floor((centerY + 5.0) / 10.0) * 10.0;

  // The last step is to find the nice, round numbers near our baseline
  // estimate and see if they are within our uncertainty range.  If they are,
  // then we use this round value as the true value.
  if (
    Math.abs(rounded100CenterX - centerX) < dCenterX &&
    Math.abs(rounded100CenterY - centerY) < dCenterY
  ) {
    return { x: rounded100CenterX, y: rounded100CenterY };
  }
  if (
    Math.abs(rounded10CenterX - centerX) < dCenterX &&
    Math.abs(rounded10CenterY - centerY) < dCenterY
  ) {
    return { x: rounded10CenterX, y: rounded10CenterY };
  }
  return { x: centerX, y: centerY };
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
