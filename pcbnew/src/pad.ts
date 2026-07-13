/**
 * PAD — a footprint pad (pcbnew/pad.{h,cpp}). Ported faithfully for the geometry
 * transforms (Move/Rotate/Mirror/Flip) and hit-testing.
 *
 * Fidelity note: KiCad's PAD::HitTest (pad.cpp:1997) rejects by bounding radius
 * then tests GetEffectivePolygon(...)->Contains(pos) — the fully-built pad shape
 * polygon (corner rounding, chamfers, custom primitives, per-layer padstack). We
 * model the common padstack (single shape/size/orientation) and test the point
 * analytically in the pad's local frame — the same result for circle / rect /
 * oval / roundrect. Custom-primitive pads and per-layer padstacks are TODO
 * (marked) and fall back to the bounding rectangle.
 */

import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import { type VECTOR2I, SquaredEuclideanNorm } from '@ziroeda/kimath/src/math/vector2.js';
import { type EDA_ANGLE, ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { MIRROR, type FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

export enum PAD_SHAPE {
  CIRCLE,
  RECTANGLE,
  OVAL,
  TRAPEZOID,
  ROUNDRECT,
  CHAMFERED_RECT,
  CUSTOM,
}
export enum PAD_ATTRIB {
  PTH,
  SMD,
  CONN,
  NPTH,
}

export class PAD extends BOARD_CONNECTED_ITEM {
  protected m_pos: VECTOR2I;
  protected m_number: string;
  protected m_orient: EDA_ANGLE; // board-frame absolute orientation
  protected m_size: VECTOR2I;
  protected m_shape: PAD_SHAPE;
  protected m_attribute: PAD_ATTRIB;
  protected m_layerSet: PCB_LAYER_ID[];
  protected m_roundRectRadiusRatio: number;
  protected m_chamferRatio: number;
  /** roundrect corner radius (absolute IU) — derived from ratio for hit-test. */

  constructor(opts: {
    number?: string;
    pos: VECTOR2I;
    orient?: EDA_ANGLE;
    size: VECTOR2I;
    shape: PAD_SHAPE;
    attribute: PAD_ATTRIB;
    layers: PCB_LAYER_ID[];
    netCode?: number;
    roundRectRadiusRatio?: number;
    chamferRatio?: number;
  }) {
    super(opts.layers[0] ?? 'F.Cu', opts.netCode ?? 0);
    this.m_number = opts.number ?? '';
    this.m_pos = { ...opts.pos };
    this.m_orient = opts.orient ?? ANGLE_0.Clone();
    this.m_size = { ...opts.size };
    this.m_shape = opts.shape;
    this.m_attribute = opts.attribute;
    this.m_layerSet = [...opts.layers];
    this.m_roundRectRadiusRatio = opts.roundRectRadiusRatio ?? 0.25;
    this.m_chamferRatio = opts.chamferRatio ?? 0;
  }

  GetNumber(): string {
    return this.m_number;
  }
  GetOrientation(): EDA_ANGLE {
    return this.m_orient;
  }
  SetOrientation(a: EDA_ANGLE): void {
    this.m_orient = a;
  }
  GetSize(): VECTOR2I {
    return this.m_size;
  }
  GetShape(): PAD_SHAPE {
    return this.m_shape;
  }
  GetAttribute(): PAD_ATTRIB {
    return this.m_attribute;
  }
  GetLayerSet(): PCB_LAYER_ID[] {
    return this.m_layerSet;
  }

  GetPosition(): VECTOR2I {
    return this.m_pos;
  }
  SetPosition(aPos: VECTOR2I): void {
    this.m_pos = { ...aPos };
  }

  /** Half the diagonal of the pad's bounding box — the HitTest reject radius
   *  (approximates PAD::GetBoundingRadius for the common shapes). */
  GetBoundingRadius(): number {
    return Math.hypot(this.m_size.x / 2, this.m_size.y / 2);
  }

  Move(aMoveVector: VECTOR2I): void {
    this.m_pos = { x: this.m_pos.x + aMoveVector.x, y: this.m_pos.y + aMoveVector.y };
  }

  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_pos = RotatePoint(this.m_pos, aRotCentre, aAngle);
    this.m_orient = this.m_orient.add(aAngle);
  }

  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_pos, aCentre, aFlipDirection);
  }

  /** PAD::Flip (pad.cpp:1454) — mirror position, negate orientation, flip the
   *  pad's layer set. (Chamfer-corner + custom-primitive flipping is TODO.) */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_pos, aCentre, aFlipDirection);
    this.m_orient = this.m_orient.negate();
    this.m_layerSet = this.m_layerSet.map((l) => FlipLayer(l));
    this.SetLayer(this.m_layerSet[0] ?? this.GetLayer());
  }

  /** PAD::HitTest — bounding-radius reject, then point-in-shape in pad-local frame. */
  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    const delta = { x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y };
    const boundingRadius = this.GetBoundingRadius() + aAccuracy;
    if (SquaredEuclideanNorm(delta) > boundingRadius * boundingRadius) return false;

    // Into the pad's local frame (undo orientation): rotate by -orientation.
    const local = RotatePoint(delta, this.m_orient.negate());
    const hw = this.m_size.x / 2 + aAccuracy;
    const hh = this.m_size.y / 2 + aAccuracy;
    const ax = Math.abs(local.x),
      ay = Math.abs(local.y);

    switch (this.m_shape) {
      case PAD_SHAPE.CIRCLE: {
        const r = this.m_size.x / 2 + aAccuracy;
        return local.x * local.x + local.y * local.y <= r * r;
      }
      case PAD_SHAPE.OVAL: {
        // Stadium: two half-circles joined by a rectangle along the long axis.
        const r = Math.min(this.m_size.x, this.m_size.y) / 2 + aAccuracy;
        if (this.m_size.x >= this.m_size.y) {
          const cx = Math.min(ax, this.m_size.x / 2 - this.m_size.y / 2);
          return (ax - cx) * (ax - cx) + local.y * local.y <= r * r && ay <= hh;
        }
        const cy = Math.min(ay, this.m_size.y / 2 - this.m_size.x / 2);
        return local.x * local.x + (ay - cy) * (ay - cy) <= r * r && ax <= hw;
      }
      case PAD_SHAPE.ROUNDRECT: {
        const rad = Math.min(this.m_size.x, this.m_size.y) * this.m_roundRectRadiusRatio;
        if (ax > hw || ay > hh) return false;
        const dx = ax - (this.m_size.x / 2 - rad);
        const dy = ay - (this.m_size.y / 2 - rad);
        if (dx <= 0 || dy <= 0) return true; // in the straight edges
        return dx * dx + dy * dy <= (rad + aAccuracy) * (rad + aAccuracy); // rounded corner
      }
      // RECTANGLE / TRAPEZOID / CHAMFERED_RECT / CUSTOM: bounding rectangle (TODO exact).
      default:
        return ax <= hw && ay <= hh;
    }
  }
}
