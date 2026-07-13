/**
 * PCB_SHAPE — a board graphic (pcbnew/pcb_shape.{h,cpp}). In KiCad it derives
 * from both BOARD_ITEM and EDA_SHAPE; here it extends BOARD_ITEM and composes an
 * EDA_SHAPE (m_eda), delegating the geometry. Transform/hit-test bodies mirror
 * pcb_shape.cpp: Move→move, Rotate→rotate, Mirror→flip, Flip→flip + FlipLayer.
 */

import { BOARD_ITEM } from './board_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import { EDA_SHAPE, SHAPE_T } from '../common/eda_shape.js';
import type { VECTOR2I } from '../common/math/vector2.js';
import type { EDA_ANGLE } from '../common/eda_angle.js';
import type { FLIP_DIRECTION } from '../common/mirror.js';

export class PCB_SHAPE extends BOARD_ITEM {
  /** The composed shape geometry (KiCad's EDA_SHAPE base). */
  readonly m_eda: EDA_SHAPE;

  constructor(shape: SHAPE_T, layer: PCB_LAYER_ID, opts: {
    start?: VECTOR2I; end?: VECTOR2I; mid?: VECTOR2I; poly?: VECTOR2I[]; width?: number; filled?: boolean;
  } = {}) {
    super(layer);
    this.m_eda = new EDA_SHAPE(shape, opts);
  }

  GetShape(): SHAPE_T { return this.m_eda.GetShape(); }
  GetStart(): VECTOR2I { return this.m_eda.GetStart(); }
  GetEnd(): VECTOR2I { return this.m_eda.GetEnd(); }
  GetWidth(): number { return this.m_eda.GetWidth(); }

  GetPosition(): VECTOR2I { return this.m_eda.GetStart(); }
  SetPosition(aPos: VECTOR2I): void {
    const cur = this.m_eda.GetStart();
    this.m_eda.move({ x: aPos.x - cur.x, y: aPos.y - cur.y });
  }

  Move(aMoveVector: VECTOR2I): void { this.m_eda.move(aMoveVector); }
  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void { this.m_eda.rotate(aRotCentre, aAngle); }
  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void { this.m_eda.flip(aCentre, aFlipDirection); }

  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.m_eda.flip(aCentre, aFlipDirection);
    this.SetLayer(FlipLayer(this.GetLayer()));
  }

  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean { return this.m_eda.hitTest(aPosition, aAccuracy); }
}
