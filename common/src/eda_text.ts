/**
 * EDA_TEXT — the text geometry shared by pcb and schematic text
 * (common/eda_text.{h,cpp}). A mixin in KiCad; composed by PCB_TEXT here.
 * Ports the position/angle/justify accessors the transforms use, plus a
 * bounding-box TextHitTest.
 *
 * Fidelity note: KiCad's EDA_TEXT::TextHitTest builds GetEffectiveTextShape()
 * (the stroked glyph outline) or GetTextBox(); this uses an approximate glyph
 * box (len * size * 0.6) rotated into the text frame — the same as the earlier
 * board renderer/hit-test used. Marked for a later exact glyph pass.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type EDA_ANGLE, ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';

export enum GR_TEXT_H_ALIGN_T {
  LEFT = -1,
  CENTER = 0,
  RIGHT = 1,
}
export enum GR_TEXT_V_ALIGN_T {
  TOP = -1,
  CENTER = 0,
  BOTTOM = 1,
}

export class EDA_TEXT {
  protected m_text: string;
  protected m_pos: VECTOR2I;
  protected m_angle: EDA_ANGLE;
  protected m_size: VECTOR2I; // {x: width, y: height} of a glyph
  protected m_thickness: number;
  protected m_mirror: boolean;
  protected m_hJustify: GR_TEXT_H_ALIGN_T;
  protected m_vJustify: GR_TEXT_V_ALIGN_T;

  constructor(
    opts: {
      text?: string;
      pos?: VECTOR2I;
      angle?: EDA_ANGLE;
      size?: VECTOR2I;
      thickness?: number;
      mirror?: boolean;
      hJustify?: GR_TEXT_H_ALIGN_T;
      vJustify?: GR_TEXT_V_ALIGN_T;
    } = {},
  ) {
    this.m_text = opts.text ?? '';
    this.m_pos = { ...(opts.pos ?? { x: 0, y: 0 }) };
    this.m_angle = opts.angle ?? ANGLE_0.Clone();
    this.m_size = { ...(opts.size ?? { x: 1000, y: 1000 }) };
    this.m_thickness = opts.thickness ?? 0;
    this.m_mirror = opts.mirror ?? false;
    this.m_hJustify = opts.hJustify ?? GR_TEXT_H_ALIGN_T.CENTER;
    this.m_vJustify = opts.vJustify ?? GR_TEXT_V_ALIGN_T.CENTER;
  }

  GetText(): string {
    return this.m_text;
  }
  SetText(t: string): void {
    this.m_text = t;
  }
  GetTextPos(): VECTOR2I {
    return this.m_pos;
  }
  SetTextPos(p: VECTOR2I): void {
    this.m_pos = { ...p };
  }
  SetTextX(x: number): void {
    this.m_pos.x = x;
  }
  SetTextY(y: number): void {
    this.m_pos.y = y;
  }
  GetTextAngle(): EDA_ANGLE {
    return this.m_angle;
  }
  SetTextAngle(a: EDA_ANGLE): void {
    this.m_angle = a;
  }
  GetTextSize(): VECTOR2I {
    return this.m_size;
  }
  IsMirrored(): boolean {
    return this.m_mirror;
  }
  SetMirrored(m: boolean): void {
    this.m_mirror = m;
  }
  GetHorizJustify(): GR_TEXT_H_ALIGN_T {
    return this.m_hJustify;
  }
  SetHorizJustify(j: GR_TEXT_H_ALIGN_T): void {
    this.m_hJustify = j;
  }

  /** Approximate glyph bounding box hit-test (EDA_TEXT::TextHitTest). */
  TextHitTest(aPoint: VECTOR2I, aAccuracy = 0): boolean {
    // Into the text's local frame (undo rotation about the anchor).
    const local = RotatePoint(
      { x: aPoint.x - this.m_pos.x, y: aPoint.y - this.m_pos.y },
      this.m_angle.negate(),
    );
    const hw = Math.max(this.m_text.length, 1) * this.m_size.x * 0.6 + aAccuracy;
    const hh = this.m_size.y / 2 + aAccuracy;
    return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
  }
}
