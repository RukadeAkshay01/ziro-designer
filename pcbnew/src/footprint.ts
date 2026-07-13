/**
 * FOOTPRINT — a placed component (pcbnew/footprint.{h,cpp}). Children (pads,
 * fields, graphics, zones) are stored in board-absolute coordinates, exactly
 * like KiCad; the footprint's position and orientation are bookkeeping used for
 * pick-and-place and library updates.
 *
 * The transforms mirror footprint.cpp line-for-line:
 *   Move (:Move)                 → SetPosition(m_pos + v): translate all children.
 *   Rotate (:Rotate)             → move m_pos about centre, then SetOrientation
 *                                  (rotate every child about the new anchor).
 *   Flip (:2902) — the operation this whole architecture was about — mirrors the
 *   anchor, flips the layer, negates orientation, and Flips EVERY child about the
 *   anchor (TOP_BOTTOM), then rotates 180° for a LEFT_RIGHT flip.
 *   HitTest (:2319)              → bounding box inflated by accuracy.
 */

import { BOARD_ITEM } from './board_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import type { PAD } from './pad.js';
import type { PCB_FIELD } from './pcb_field.js';
import { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { ZONE } from './zone.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type EDA_ANGLE, ANGLE_0, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { MIRRORVAL, FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

/** A footprint drawing is a graphic or a text (KiCad's m_drawings BOARD_ITEMs). */
export type FP_DRAWING = PCB_SHAPE | PCB_TEXT;

export class FOOTPRINT extends BOARD_ITEM {
  protected m_pos: VECTOR2I;
  protected m_orient: EDA_ANGLE;
  protected m_fpid: string; // library id "lib:name"
  protected m_fields: PCB_FIELD[];
  protected m_pads: PAD[];
  protected m_drawings: FP_DRAWING[];
  protected m_zones: ZONE[];

  constructor(
    opts: {
      fpid?: string;
      pos?: VECTOR2I;
      orient?: EDA_ANGLE;
      layer?: PCB_LAYER_ID;
      fields?: PCB_FIELD[];
      pads?: PAD[];
      drawings?: FP_DRAWING[];
      zones?: ZONE[];
    } = {},
  ) {
    super(opts.layer ?? 'F.Cu');
    this.m_fpid = opts.fpid ?? '';
    this.m_pos = { ...(opts.pos ?? { x: 0, y: 0 }) };
    this.m_orient = opts.orient ?? ANGLE_0.Clone();
    this.m_fields = opts.fields ?? [];
    this.m_pads = opts.pads ?? [];
    this.m_drawings = opts.drawings ?? [];
    this.m_zones = opts.zones ?? [];
  }

  GetFPID(): string {
    return this.m_fpid;
  }
  GetOrientation(): EDA_ANGLE {
    return this.m_orient;
  }
  Pads(): PAD[] {
    return this.m_pads;
  }
  Fields(): PCB_FIELD[] {
    return this.m_fields;
  }
  GraphicalItems(): FP_DRAWING[] {
    return this.m_drawings;
  }
  Zones(): ZONE[] {
    return this.m_zones;
  }

  GetReference(): string {
    return this.m_fields.find((f) => f.IsReference())?.GetText() ?? '';
  }
  GetValue(): string {
    return this.m_fields.find((f) => f.IsValue())?.GetText() ?? '';
  }

  private children(): BOARD_ITEM[] {
    return [...this.m_fields, ...this.m_pads, ...this.m_drawings, ...this.m_zones];
  }

  GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  /** FOOTPRINT::SetPosition — translate the anchor and every child by the delta. */
  SetPosition(aPos: VECTOR2I): void {
    const delta = { x: aPos.x - this.m_pos.x, y: aPos.y - this.m_pos.y };
    this.m_pos = { ...aPos };
    for (const child of this.children()) child.Move(delta);
  }

  /** FOOTPRINT::SetOrientation — rotate every child about the anchor by the change. */
  SetOrientation(aNewAngle: EDA_ANGLE): void {
    const angleChange = aNewAngle.sub(this.m_orient);
    this.m_orient = aNewAngle.Normalized().Normalize180();
    for (const child of this.children()) child.Rotate(this.GetPosition(), angleChange);
  }

  Move(aMoveVector: VECTOR2I): void {
    if (aMoveVector.x === 0 && aMoveVector.y === 0) return;
    this.SetPosition({ x: this.m_pos.x + aMoveVector.x, y: this.m_pos.y + aMoveVector.y });
  }

  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    if (aAngle.equals(ANGLE_0)) return;
    const newOrientation = this.m_orient.add(aAngle);
    this.SetPosition(RotatePoint(this.m_pos, aRotCentre, aAngle));
    this.SetOrientation(newOrientation);
  }

  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Footprints don't mirror without flipping side; Flip is the real operation.
    this.Flip(aCentre, aFlipDirection);
  }

  /** FOOTPRINT::Flip (footprint.cpp:2902). */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Mirror the anchor's Y about the X axis, then relocate (moves children).
    const finalPos = { x: this.m_pos.x, y: MIRRORVAL(this.m_pos.y, aCentre.y) };
    this.SetPosition(finalPos);

    this.SetLayer(FlipLayer(this.GetLayer()));

    const newOrientation = this.m_orient.negate().Normalize180();
    this.m_orient = ANGLE_0.Clone(); // clear for child flipping (KiCad sets the field directly)

    for (const child of this.children()) child.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    this.m_orient = newOrientation;

    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) this.Rotate(aCentre, ANGLE_180);
  }

  /** Bounding box of the footprint's geometry (pads / drawings / field anchors). */
  GetBoundingBox(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const grow = (x0: number, y0: number, x1: number, y1: number): void => {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    };
    for (const pad of this.m_pads) {
      const p = pad.GetPosition(),
        r = pad.GetBoundingRadius();
      grow(p.x - r, p.y - r, p.x + r, p.y + r);
    }
    for (const d of this.m_drawings) {
      if (d instanceof PCB_SHAPE) {
        const s = d.GetStart(),
          e = d.GetEnd();
        grow(Math.min(s.x, e.x), Math.min(s.y, e.y), Math.max(s.x, e.x), Math.max(s.y, e.y));
      } else {
        const p = d.GetPosition();
        grow(p.x, p.y, p.x, p.y);
      }
    }
    for (const f of this.m_fields) {
      const p = f.GetPosition();
      grow(p.x, p.y, p.x, p.y);
    }
    return minX <= maxX ? { minX, minY, maxX, maxY } : null;
  }

  /** FOOTPRINT::HitTest — bbox inflated by accuracy contains the point. */
  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    const b = this.GetBoundingBox();
    if (!b) return false;
    return (
      aPosition.x >= b.minX - aAccuracy &&
      aPosition.x <= b.maxX + aAccuracy &&
      aPosition.y >= b.minY - aAccuracy &&
      aPosition.y <= b.maxY + aAccuracy
    );
  }
}
