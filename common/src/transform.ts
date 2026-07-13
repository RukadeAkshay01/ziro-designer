/**
 * Symbol placement transform.
 *
 * Grounded in KiCad's `TRANSFORM` class (libs/kimath) and `SCH_SYMBOL::SetOrientation`.
 * A placed symbol maps a point from symbol-local coordinates to schematic
 * coordinates with a 2x2 integer matrix:
 *
 *     worldX = x1 * localX + y1 * localY
 *     worldY = x2 * localX + y2 * localY
 *     world  = symbolPosition + (worldX, worldY)
 *
 * The matrix is the symbol's rotation (0/90/180/270) optionally composed with a
 * mirror about the X or Y axis. Both coordinate systems use the same +Y-down
 * convention KiCad's schematic format uses, so no extra Y-flip is introduced here.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A 2x2 integer transform, matching KiCad's `TRANSFORM { x1, y1, x2, y2 }`. */
export interface Transform {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export const IDENTITY: Transform = { x1: 1, y1: 0, x2: 0, y2: 1 };

/**
 * Base matrix for a symbol rotation, matching KiCad's parser:
 *   0 -> identity, 90 -> (0,1,-1,0), 180 -> (-1,0,0,-1), 270 -> (0,-1,1,0).
 */
export function rotationTransform(angleDeg: number): Transform {
  switch (((angleDeg % 360) + 360) % 360) {
    case 0:
      return { x1: 1, y1: 0, x2: 0, y2: 1 };
    case 90:
      return { x1: 0, y1: 1, x2: -1, y2: 0 };
    case 180:
      return { x1: -1, y1: 0, x2: 0, y2: -1 };
    case 270:
      return { x1: 0, y1: -1, x2: 1, y2: 0 };
    default:
      return IDENTITY;
  }
}

/**
 * Compose an existing transform with an incremental mirror, exactly as
 * KiCad's `SCH_SYMBOL::SetOrientation` does (new = old ∘ temp):
 *
 *   x1 = m.x1*t.x1 + m.x2*t.y1   y1 = m.y1*t.x1 + m.y2*t.y1
 *   x2 = m.x1*t.x2 + m.x2*t.y2   y2 = m.y1*t.x2 + m.y2*t.y2
 *
 * where temp is (1,0,0,-1) for mirror-X and (-1,0,0,1) for mirror-Y.
 */
export function composeMirror(m: Transform, axis: 'x' | 'y'): Transform {
  const t: Transform =
    axis === 'x' ? { x1: 1, y1: 0, x2: 0, y2: -1 } : { x1: -1, y1: 0, x2: 0, y2: 1 };
  const zz = (v: number): number => (v === 0 ? 0 : v);
  return {
    x1: zz(m.x1 * t.x1 + m.x2 * t.y1),
    y1: zz(m.y1 * t.x1 + m.y2 * t.y1),
    x2: zz(m.x1 * t.x2 + m.x2 * t.y2),
    y2: zz(m.y1 * t.x2 + m.y2 * t.y2),
  };
}

/** The final placement transform for a symbol's rotation + optional mirror. */
export function symbolTransform(angleDeg: number, mirror?: 'x' | 'y'): Transform {
  const base = rotationTransform(angleDeg);
  return mirror ? composeMirror(base, mirror) : base;
}

/** Map a symbol-local point through the transform (no translation). */
export function applyTransform(t: Transform, p: Vec2): Vec2 {
  return { x: t.x1 * p.x + t.y1 * p.y, y: t.x2 * p.x + t.y2 * p.y };
}

/** Map a symbol-local point to schematic/world coordinates given the symbol origin. */
export function localToWorld(origin: Vec2, t: Transform, p: Vec2): Vec2 {
  const r = applyTransform(t, p);
  return { x: origin.x + r.x, y: origin.y + r.y };
}

// ----- orientation algebra (KiCad SCH_SYMBOL::SetOrientation) ----------------

/**
 * Compose a transform with an incremental one, `new = old ∘ temp`, using KiCad's
 * exact formula (SCH_SYMBOL::SetOrientation):
 *   x1 = m.x1*t.x1 + m.x2*t.y1   y1 = m.y1*t.x1 + m.y2*t.y1
 *   x2 = m.x1*t.x2 + m.x2*t.y2   y2 = m.y1*t.x2 + m.y2*t.y2
 */
/** Normalize -0 to 0 so equal transforms compare equal (and never serialize "-0"). */
const z = (v: number): number => (v === 0 ? 0 : v);

export function composeTransform(m: Transform, t: Transform): Transform {
  return {
    x1: z(m.x1 * t.x1 + m.x2 * t.y1),
    y1: z(m.y1 * t.x1 + m.y2 * t.y1),
    x2: z(m.x1 * t.x2 + m.x2 * t.y2),
    y2: z(m.y1 * t.x2 + m.y2 * t.y2),
  };
}

/** Incremental transforms KiCad applies for each editing operation. */
export const ROTATE_CCW: Transform = { x1: 0, y1: 1, x2: -1, y2: 0 };
export const ROTATE_CW: Transform = { x1: 0, y1: -1, x2: 1, y2: 0 };
export const MIRROR_X_INCR: Transform = { x1: 1, y1: 0, x2: 0, y2: -1 };
export const MIRROR_Y_INCR: Transform = { x1: -1, y1: 0, x2: 0, y2: 1 };

/** A placed symbol's orientation as serialized: rotation plus an optional mirror axis. */
export interface Orientation {
  readonly angle: number;
  readonly mirror?: 'x' | 'y';
}

// The canonical (angle, mirror) states KiCad tries when decomposing a transform
// (SCH_SYMBOL::GetOrientation's rotate_values), in the same preference order so
// our serialization matches KiCad's.
const ORIENT_STATES: Orientation[] = [
  { angle: 0 },
  { angle: 90 },
  { angle: 180 },
  { angle: 270 },
  { angle: 0, mirror: 'x' },
  { angle: 90, mirror: 'x' },
  { angle: 270, mirror: 'x' },
  { angle: 0, mirror: 'y' },
  { angle: 90, mirror: 'y' },
  { angle: 180, mirror: 'y' },
  { angle: 270, mirror: 'y' },
];

const sameTransform = (a: Transform, b: Transform): boolean =>
  a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;

/** Decompose a transform back to a serializable (angle, mirror), matching KiCad. */
export function orientationFromTransform(t: Transform): Orientation {
  for (const s of ORIENT_STATES) {
    if (sameTransform(symbolTransform(s.angle, s.mirror), t)) return s;
  }
  return { angle: 0 };
}

/** Apply a 90° rotation to an orientation (CCW unless `cw`), as KiCad's Rotate does. */
export function rotateOrientation(o: Orientation, cw = false): Orientation {
  return orientationFromTransform(
    composeTransform(symbolTransform(o.angle, o.mirror), cw ? ROTATE_CW : ROTATE_CCW),
  );
}

/**
 * Apply a mirror to an orientation. `axis` is the serialized mirror axis: 'x' is
 * KiCad's MirrorVertically (flip top↔bottom), 'y' its MirrorHorizontally (flip
 * left↔right).
 */
export function mirrorOrientation(o: Orientation, axis: 'x' | 'y'): Orientation {
  const incr = axis === 'x' ? MIRROR_X_INCR : MIRROR_Y_INCR;
  return orientationFromTransform(composeTransform(symbolTransform(o.angle, o.mirror), incr));
}
