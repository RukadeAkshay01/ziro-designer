/**
 * Faithful port of KiCad's include/core/mirror.h — FLIP_DIRECTION and the MIRROR
 * helpers used throughout BOARD_ITEM::Flip.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export enum FLIP_DIRECTION {
  LEFT_RIGHT, // Flip left to right (around the Y axis)
  TOP_BOTTOM, // Flip top to bottom (around the X axis)
}

/** Mirror of aPoint relative to aMirrorRef (scalar). */
export function MIRRORVAL(aPoint: number, aMirrorRef: number): number {
  return -(aPoint - aMirrorRef) + aMirrorRef;
}

/** Mirror a point about a reference point, in the given direction (in place). */
export function MIRROR(
  aPoint: VECTOR2I,
  aMirrorRef: VECTOR2I,
  aFlipDirection: FLIP_DIRECTION,
): void {
  if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) aPoint.x = MIRRORVAL(aPoint.x, aMirrorRef.x);
  else aPoint.y = MIRRORVAL(aPoint.y, aMirrorRef.y);
}
