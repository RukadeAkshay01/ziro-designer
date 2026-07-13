/**
 * PCB_TEXT — board text (pcbnew/pcb_text.{h,cpp}). KiCad derives from BOARD_ITEM
 * and EDA_TEXT; here it extends BOARD_ITEM and composes an EDA_TEXT (m_eda).
 * Rotate/Mirror/Flip mirror pcb_text.cpp:420/432/453.
 */

import { BOARD_ITEM } from './board_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import { EDA_TEXT, type GR_TEXT_H_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import { EDA_ANGLE, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { MIRRORVAL, FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

type EdaTextOpts = ConstructorParameters<typeof EDA_TEXT>[0];

const ANGLE_HORIZONTAL = new EDA_ANGLE(0);
const ANGLE_VERTICAL = new EDA_ANGLE(90);

export class PCB_TEXT extends BOARD_ITEM {
  readonly m_eda: EDA_TEXT;

  constructor(layer: PCB_LAYER_ID, opts: EdaTextOpts = {}) {
    super(layer);
    this.m_eda = new EDA_TEXT(opts);
  }

  GetText(): string {
    return this.m_eda.GetText();
  }

  GetPosition(): VECTOR2I {
    return this.m_eda.GetTextPos();
  }
  SetPosition(aPos: VECTOR2I): void {
    this.m_eda.SetTextPos(aPos);
  }

  Move(aMoveVector: VECTOR2I): void {
    const p = this.m_eda.GetTextPos();
    this.m_eda.SetTextPos({ x: p.x + aMoveVector.x, y: p.y + aMoveVector.y });
  }

  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_eda.SetTextPos(RotatePoint(this.m_eda.GetTextPos(), aRotCentre, aAngle));
    this.m_eda.SetTextAngle(this.m_eda.GetTextAngle().add(aAngle).Normalize());
  }

  /** PCB_TEXT::Mirror — position + justification mirror, text unchanged. */
  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const pos = this.m_eda.GetTextPos();
    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) {
      if (this.m_eda.GetTextAngle().equals(ANGLE_VERTICAL))
        this.m_eda.SetHorizJustify(-this.m_eda.GetHorizJustify() as GR_TEXT_H_ALIGN_T);
      this.m_eda.SetTextY(MIRRORVAL(pos.y, aCentre.y));
    } else {
      if (this.m_eda.GetTextAngle().equals(ANGLE_HORIZONTAL))
        this.m_eda.SetHorizJustify(-this.m_eda.GetHorizJustify() as GR_TEXT_H_ALIGN_T);
      this.m_eda.SetTextX(MIRRORVAL(pos.x, aCentre.x));
    }
  }

  /** PCB_TEXT::Flip — mirror + angle change + FlipLayer + toggle mirrored. */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const pos = this.m_eda.GetTextPos();
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.m_eda.SetTextX(MIRRORVAL(pos.x, aCentre.x));
      this.m_eda.SetTextAngle(this.m_eda.GetTextAngle().negate());
    } else {
      this.m_eda.SetTextY(MIRRORVAL(pos.y, aCentre.y));
      this.m_eda.SetTextAngle(ANGLE_180.sub(this.m_eda.GetTextAngle()));
    }
    this.SetLayer(FlipLayer(this.GetLayer()));
    this.m_eda.SetMirrored(!this.m_eda.IsMirrored()); // board text is side-specific
  }

  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    return this.m_eda.TextHitTest(aPosition, aAccuracy);
  }
}
