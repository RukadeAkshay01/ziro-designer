/**
 * ZONE — a copper pour / rule area (pcbnew/zone.{h,cpp}). Ported for the
 * geometry transforms and hit-testing.
 *
 * KiCad stores the outline and per-layer fills as SHAPE_POLY_SET (with holes);
 * this port models the outline as a point ring and the fills as per-layer point
 * rings — enough for Move/Rotate/Mirror/Flip and hit-testing. Multi-outline /
 * hole handling is TODO (marked). Method structure mirrors zone.cpp:1028/1083/
 * 1094 and the ZONE::HitTest corner/edge test (:735).
 */

import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';
import { type VECTOR2I, Distance } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { MIRROR, type FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

export class ZONE extends BOARD_CONNECTED_ITEM {
  protected m_outline: VECTOR2I[];
  protected m_layers: PCB_LAYER_ID[];
  /** Per-layer filled areas (each an array of point rings). */
  protected m_fills: Map<PCB_LAYER_ID, VECTOR2I[][]>;

  constructor(opts: {
    outline?: VECTOR2I[];
    layers: PCB_LAYER_ID[];
    fills?: Map<PCB_LAYER_ID, VECTOR2I[][]>;
    netCode?: number;
  }) {
    super(opts.layers[0] ?? 'F.Cu', opts.netCode ?? 0);
    this.m_outline = (opts.outline ?? []).map((p) => ({ ...p }));
    this.m_layers = [...opts.layers];
    this.m_fills = opts.fills ?? new Map();
  }

  GetLayerSet(): PCB_LAYER_ID[] {
    return this.m_layers;
  }
  GetOutline(): VECTOR2I[] {
    return this.m_outline;
  }
  GetFills(): Map<PCB_LAYER_ID, VECTOR2I[][]> {
    return this.m_fills;
  }

  GetPosition(): VECTOR2I {
    return this.m_outline[0] ?? { x: 0, y: 0 };
  }
  SetPosition(aPos: VECTOR2I): void {
    const cur = this.GetPosition();
    this.Move({ x: aPos.x - cur.x, y: aPos.y - cur.y });
  }

  private forEachPoint(fn: (p: VECTOR2I) => VECTOR2I): void {
    this.m_outline = this.m_outline.map(fn);
    for (const [layer, rings] of this.m_fills)
      this.m_fills.set(
        layer,
        rings.map((r) => r.map(fn)),
      );
  }

  Move(offset: VECTOR2I): void {
    this.forEachPoint((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
  }

  Rotate(aCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.forEachPoint((p) => RotatePoint(p, aCentre, aAngle));
  }

  Mirror(aMirrorRef: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.forEachPoint((p) => {
      const q = { ...p };
      MIRROR(q, aMirrorRef, aFlipDirection);
      return q;
    });
  }

  /** ZONE::Flip — mirror geometry, then move the layers/fills to the other side. */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.Mirror(aCentre, aFlipDirection);
    this.m_layers = this.m_layers.map((l) => FlipLayer(l));
    const flipped = new Map<PCB_LAYER_ID, VECTOR2I[][]>();
    for (const [layer, rings] of this.m_fills) flipped.set(FlipLayer(layer), rings);
    this.m_fills = flipped;
    this.SetLayer(this.m_layers[0] ?? this.GetLayer());
  }

  /** ZONE::HitTest — near an outline corner (accuracy*2) or edge (accuracy),
   *  with a 0.1 mm floor on accuracy (zone.cpp:735). */
  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    const accuracy = Math.max(aAccuracy, mmToIU(0.1));
    return (
      this.HitTestForCorner(aPosition, accuracy * 2) || this.HitTestForEdge(aPosition, accuracy)
    );
  }

  HitTestForCorner(refPos: VECTOR2I, aAccuracy: number): boolean {
    return this.m_outline.some((v) => Distance(refPos, v) <= aAccuracy);
  }

  HitTestForEdge(refPos: VECTOR2I, aAccuracy: number): boolean {
    const n = this.m_outline.length;
    for (let i = 0; i < n; i++) {
      if (TestSegmentHit(refPos, this.m_outline[i]!, this.m_outline[(i + 1) % n]!, aAccuracy))
        return true;
    }
    return false;
  }

  /** ZONE::HitTestFilledArea — inside a filled polygon on `aLayer`. */
  HitTestFilledArea(aLayer: PCB_LAYER_ID, aRefPos: VECTOR2I): boolean {
    const rings = this.m_fills.get(aLayer);
    if (!rings) return false;
    return rings.some((ring) => ring.length >= 3 && pointInPolygon(aRefPos, ring));
  }
}

function pointInPolygon(p: VECTOR2I, poly: VECTOR2I[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
