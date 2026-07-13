/**
 * PCB_TRACK / PCB_ARC / PCB_VIA — the copper routing items (pcbnew/pcb_track.{h,cpp}).
 * Faithful ports of the geometry-transform + hit-test methods; the object model
 * is mutated in place and later regenerated to the file by the sexpr writer.
 *
 * Method bodies mirror the C++ line-for-line:
 *   PCB_TRACK::Move/Rotate/Mirror/Flip (pcb_track.cpp:1093/1108/1123),
 *   PCB_TRACK::HitTest (:2496), PCB_ARC::HitTest (:2502), PCB_VIA::HitTest (:2537).
 */

import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import { type VECTOR2I, add, Distance } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE, ANGLE_0, ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { MIRROR, type FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

export class PCB_TRACK extends BOARD_CONNECTED_ITEM {
  protected m_Start: VECTOR2I;
  protected m_End: VECTOR2I;
  protected m_width: number;

  constructor(start: VECTOR2I, end: VECTOR2I, width: number, layer: PCB_LAYER_ID, netCode = 0) {
    super(layer, netCode);
    this.m_Start = { ...start };
    this.m_End = { ...end };
    this.m_width = width;
  }

  GetStart(): VECTOR2I {
    return this.m_Start;
  }
  GetEnd(): VECTOR2I {
    return this.m_End;
  }
  SetStart(p: VECTOR2I): void {
    this.m_Start = { ...p };
  }
  SetEnd(p: VECTOR2I): void {
    this.m_End = { ...p };
  }
  GetWidth(): number {
    return this.m_width;
  }
  SetWidth(w: number): void {
    this.m_width = w;
  }

  GetPosition(): VECTOR2I {
    return this.m_Start;
  }
  SetPosition(aPos: VECTOR2I): void {
    this.m_Start = { ...aPos };
  }

  Move(aMoveVector: VECTOR2I): void {
    this.m_Start = add(this.m_Start, aMoveVector);
    this.m_End = add(this.m_End, aMoveVector);
  }

  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_Start = RotatePoint(this.m_Start, aRotCentre, aAngle);
    this.m_End = RotatePoint(this.m_End, aRotCentre, aAngle);
  }

  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_Start, aCentre, aFlipDirection);
    MIRROR(this.m_End, aCentre, aFlipDirection);
  }

  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.Mirror(aCentre, aFlipDirection);
    this.SetLayer(FlipLayer(this.GetLayer()));
  }

  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    return TestSegmentHit(
      aPosition,
      this.m_Start,
      this.m_End,
      aAccuracy + Math.trunc(this.m_width / 2),
    );
  }
}

export class PCB_ARC extends PCB_TRACK {
  protected m_Mid: VECTOR2I;

  constructor(
    start: VECTOR2I,
    mid: VECTOR2I,
    end: VECTOR2I,
    width: number,
    layer: PCB_LAYER_ID,
    netCode = 0,
  ) {
    super(start, end, width, layer, netCode);
    this.m_Mid = { ...mid };
  }

  GetMid(): VECTOR2I {
    return this.m_Mid;
  }
  SetMid(p: VECTOR2I): void {
    this.m_Mid = { ...p };
  }

  /** Arc centre (circumcentre of start/mid/end) — PCB_ARC::GetPosition. */
  override GetPosition(): VECTOR2I {
    const a = this.m_Start,
      b = this.m_Mid,
      c = this.m_End;
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9)
      return { x: Math.round((a.x + c.x) / 2), y: Math.round((a.y + c.y) / 2) };
    const a2 = a.x * a.x + a.y * a.y,
      b2 = b.x * b.x + b.y * b.y,
      c2 = c.x * c.x + c.y * c.y;
    return {
      x: Math.round((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d) + 0, // +0 normalises -0
      y: Math.round((a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d) + 0,
    };
  }

  GetRadius(): number {
    return Distance(this.GetPosition(), this.m_Start);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    super.Rotate(aRotCentre, aAngle);
    this.m_Mid = RotatePoint(this.m_Mid, aRotCentre, aAngle);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    super.Mirror(aCentre, aFlipDirection);
    MIRROR(this.m_Mid, aCentre, aFlipDirection);
  }

  /** PCB_ARC::HitTest — endpoint short-circuit, radial band, then angle in sweep. */
  override HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    const maxDist = aAccuracy + this.m_width / 2.0;
    if (Distance(this.m_Start, aPosition) <= maxDist || Distance(this.m_End, aPosition) <= maxDist)
      return true;
    const center = this.GetPosition();
    const relpos = { x: aPosition.x - center.x, y: aPosition.y - center.y };
    const dist = Math.hypot(relpos.x, relpos.y);
    const radius = this.GetRadius();
    if (Math.abs(dist - radius) > maxDist) return false;
    const arcAngle = this.GetAngle();
    const arcAngleStart = this.GetArcAngleStart();
    const arcHittest = EDA_ANGLE.fromVector(relpos).sub(arcAngleStart).Normalize();
    if (arcAngle.lt(ANGLE_0)) return arcHittest.ge(ANGLE_360.add(arcAngle));
    return arcHittest.le(arcAngle);
  }

  /** Signed sweep angle start→end passing through mid (PCB_ARC::GetAngle helpers). */
  GetArcAngleStart(): EDA_ANGLE {
    const center = this.GetPosition();
    return EDA_ANGLE.fromVector({
      x: this.m_Start.x - center.x,
      y: this.m_Start.y - center.y,
    }).Normalize();
  }

  GetAngle(): EDA_ANGLE {
    const center = this.GetPosition();
    const startAngle = EDA_ANGLE.fromVector({
      x: this.m_Start.x - center.x,
      y: this.m_Start.y - center.y,
    });
    const midAngle = EDA_ANGLE.fromVector({
      x: this.m_Mid.x - center.x,
      y: this.m_Mid.y - center.y,
    });
    const endAngle = EDA_ANGLE.fromVector({
      x: this.m_End.x - center.x,
      y: this.m_End.y - center.y,
    });
    const angle1 = midAngle.sub(startAngle).Normalize();
    const angle2 = endAngle.sub(midAngle).Normalize();
    return angle1.add(angle2);
  }
}

export enum VIATYPE {
  THROUGH = 3,
  BLIND_BURIED = 2,
  MICROVIA = 1,
}

export class PCB_VIA extends PCB_TRACK {
  protected m_bottomLayer: PCB_LAYER_ID;
  protected m_viaType: VIATYPE;
  protected m_drill: number;

  constructor(
    pos: VECTOR2I,
    size: number,
    drill: number,
    topLayer: PCB_LAYER_ID,
    bottomLayer: PCB_LAYER_ID,
    viaType: VIATYPE,
    netCode = 0,
  ) {
    super(pos, pos, size, topLayer, netCode); // m_width == via diameter; start==end==centre
    this.m_bottomLayer = bottomLayer;
    this.m_viaType = viaType;
    this.m_drill = drill;
  }

  GetViaType(): VIATYPE {
    return this.m_viaType;
  }
  GetDrillValue(): number {
    return this.m_drill;
  }
  GetBottomLayer(): PCB_LAYER_ID {
    return this.m_bottomLayer;
  }

  /** PCB_VIA::HitTest — distance from centre within accuracy + radius. */
  override HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    const maxDist = aAccuracy + Math.trunc(this.m_width / 2);
    const rel = { x: aPosition.x - this.m_Start.x, y: aPosition.y - this.m_Start.y };
    return rel.x * rel.x + rel.y * rel.y <= maxDist * maxDist;
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.Mirror(aCentre, aFlipDirection);
    if (this.m_viaType !== VIATYPE.THROUGH) {
      const top = FlipLayer(this.GetLayer());
      const bottom = FlipLayer(this.m_bottomLayer);
      this.SetLayer(top);
      this.m_bottomLayer = bottom;
    }
  }
}
