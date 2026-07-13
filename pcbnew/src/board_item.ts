/**
 * BOARD_ITEM — the abstract base of every board object (pcbnew/board_item.h).
 * A faithful port of the geometry-transform + layer interface every pcbnew item
 * implements. KiCad's BOARD_ITEM also carries parent/group/locked state and a
 * KICAD_T type tag; those are added as the port needs them.
 *
 * The transform methods (Move/Rotate/Flip/Mirror) mutate the item in place,
 * exactly like KiCad — the object model is the source of truth, and the writer
 * (pcb_io_sexpr) regenerates the file from it.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import type { PCB_LAYER_ID } from './layer_ids.js';

export abstract class BOARD_ITEM {
  /** The primary layer the item lives on (BOARD_ITEM::m_layer). */
  protected m_layer: PCB_LAYER_ID;

  constructor(layer: PCB_LAYER_ID = 'F.Cu') {
    this.m_layer = layer;
  }

  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }
  SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
  }
  IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_layer === aLayer;
  }

  abstract GetPosition(): VECTOR2I;
  abstract SetPosition(aPos: VECTOR2I): void;

  /** Move the item by a vector (BOARD_ITEM::Move). */
  abstract Move(aMoveVector: VECTOR2I): void;
  /** Rotate the item about a centre (BOARD_ITEM::Rotate). */
  abstract Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void;
  /** Mirror the item about a point, without changing side (BOARD_ITEM::Mirror). */
  abstract Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void;
  /** Flip the item to the other board side (BOARD_ITEM::Flip). */
  abstract Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void;

  /** Whether `aPosition` (within `aAccuracy`) hits the item (BOARD_ITEM::HitTest). */
  abstract HitTest(aPosition: VECTOR2I, aAccuracy: number): boolean;
}
