/**
 * GERBER_DRAW_ITEM — one graphic element of a Gerber image, mirroring
 * `gerbview/gerber_draw_item.h/.cpp`. It can be a drawn trace (segment/arc/
 * circle), a filled region polygon (G36/G37), or a flashed aperture (a "spot"
 * shape). Coordinates are absolute IU (the image transform is already applied).
 * X2 net/aperture/object attributes travel with the item for the inspector and
 * highlighting.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { GBR_BASIC_SHAPE } from './types.js';
import type { D_CODE } from './dcode.js';
import type { AmResolvedShape } from './aperture_macro.js';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Per-item X2 attribute snapshot (subset of GBR_NETLIST_METADATA). */
export interface GbrNetMetadata {
  netName?: string;
  componentRef?: string; // %TO.C ...
  padName?: string; // %TO.P ...
  apertureAttributes?: string[]; // %TA...
  objectAttributes?: string[]; // %TO...
}

/** Aperture-level transform captured at flash time (LM / LR / LS). */
export interface ApertureTransform {
  mirror: 'N' | 'X' | 'Y' | 'XY';
  rotation: number; // degrees, CCW
  scale: number;
}

export class GERBER_DRAW_ITEM {
  shape: GBR_BASIC_SHAPE = GBR_BASIC_SHAPE.GBR_SEGMENT;
  start: Vec2 = { x: 0, y: 0 };
  end: Vec2 = { x: 0, y: 0 };
  /** Arc centre (absolute IU) for GBR_ARC. */
  arcCentre: Vec2 = { x: 0, y: 0 };
  /** Arc direction for GBR_ARC: true = CCW (G03), false = CW (G02). */
  arcCcw = false;
  /** Trace width (IU) for segment/arc/circle shapes. */
  width = 0;
  /** Filled region / macro outline vertices (absolute IU) for GBR_POLYGON. */
  polyPoints: Vec2[] = [];
  /** Owning aperture (null for regions, which have no D-code). */
  dcode: D_CODE | null = null;
  dcodeNum = 0;
  /** Layer polarity when drawn: true = dark (add), false = clear (erase). */
  layerPolarity = true;
  /** Aperture transform for flashed spots. */
  apTransform: ApertureTransform = { mirror: 'N', rotation: 0, scale: 1 };
  /** X2 metadata. */
  netMetadata: GbrNetMetadata = {};
  /** Index of the source layer in the layout (set when added). */
  layer = 0;

  /**
   * For flashed spots, resolve the aperture into absolute-IU primitives.
   * Applies the aperture transform (mirror/rotate/scale) then translates to the
   * flash point (`start`).
   */
  resolveFlashShapes(): AmResolvedShape[] {
    if (!this.dcode) return [];
    const base = this.dcode.getFlashShapes();
    const t = this.apTransform;
    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const mx = t.mirror === 'X' || t.mirror === 'XY' ? -1 : 1;
    const my = t.mirror === 'Y' || t.mirror === 'XY' ? -1 : 1;
    const sc = t.scale;
    const tf = (p: Vec2): Vec2 => {
      const x = p.x * sc * mx;
      const y = p.y * sc * my;
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return { x: rx + this.start.x, y: ry + this.start.y };
    };
    return base.map((sh) => {
      if (sh.kind === 'circle') return { ...sh, center: tf(sh.center), radius: sh.radius * sc };
      if (sh.kind === 'segment') return { ...sh, a: tf(sh.a), b: tf(sh.b), width: sh.width * sc };
      return { ...sh, points: sh.points.map(tf) };
    });
  }

  /** Axis-aligned bounding box in IU. */
  getBoundingBox(): BBox {
    const halfW = this.width / 2;
    switch (this.shape) {
      case GBR_BASIC_SHAPE.GBR_POLYGON: {
        if (this.polyPoints.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of this.polyPoints) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { minX, minY, maxX, maxY };
      }
      case GBR_BASIC_SHAPE.GBR_ARC:
      case GBR_BASIC_SHAPE.GBR_CIRCLE: {
        const r =
          Math.hypot(this.start.x - this.arcCentre.x, this.start.y - this.arcCentre.y) + halfW;
        return {
          minX: this.arcCentre.x - r,
          minY: this.arcCentre.y - r,
          maxX: this.arcCentre.x + r,
          maxY: this.arcCentre.y + r,
        };
      }
      case GBR_BASIC_SHAPE.GBR_SEGMENT: {
        return {
          minX: Math.min(this.start.x, this.end.x) - halfW,
          minY: Math.min(this.start.y, this.end.y) - halfW,
          maxX: Math.max(this.start.x, this.end.x) + halfW,
          maxY: Math.max(this.start.y, this.end.y) + halfW,
        };
      }
      default: {
        // Flashed spot: bound the resolved shapes.
        const shapes = this.resolveFlashShapes();
        if (shapes.length === 0) {
          const s = 1000;
          return {
            minX: this.start.x - s,
            minY: this.start.y - s,
            maxX: this.start.x + s,
            maxY: this.start.y + s,
          };
        }
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        const acc = (x: number, y: number): void => {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        };
        for (const sh of shapes) {
          if (sh.kind === 'circle') {
            acc(sh.center.x - sh.radius, sh.center.y - sh.radius);
            acc(sh.center.x + sh.radius, sh.center.y + sh.radius);
          } else if (sh.kind === 'segment') {
            const hw = sh.width / 2;
            acc(Math.min(sh.a.x, sh.b.x) - hw, Math.min(sh.a.y, sh.b.y) - hw);
            acc(Math.max(sh.a.x, sh.b.x) + hw, Math.max(sh.a.y, sh.b.y) + hw);
          } else {
            for (const p of sh.points) acc(p.x, p.y);
          }
        }
        return { minX, minY, maxX, maxY };
      }
    }
  }

  /** Distance-based hit test in IU (used by the item picker/inspector). */
  hitTest(pos: Vec2, tolerance: number): boolean {
    switch (this.shape) {
      case GBR_BASIC_SHAPE.GBR_SEGMENT:
        return distToSegment(pos, this.start, this.end) <= this.width / 2 + tolerance;
      case GBR_BASIC_SHAPE.GBR_CIRCLE:
      case GBR_BASIC_SHAPE.GBR_ARC: {
        const r = Math.hypot(this.start.x - this.arcCentre.x, this.start.y - this.arcCentre.y);
        const d = Math.hypot(pos.x - this.arcCentre.x, pos.y - this.arcCentre.y);
        return Math.abs(d - r) <= this.width / 2 + tolerance;
      }
      case GBR_BASIC_SHAPE.GBR_POLYGON:
        return pointInPolygon(pos, this.polyPoints);
      default: {
        for (const sh of this.resolveFlashShapes()) {
          if (!sh.exposure) continue;
          if (sh.kind === 'circle') {
            if (Math.hypot(pos.x - sh.center.x, pos.y - sh.center.y) <= sh.radius + tolerance)
              return true;
          } else if (sh.kind === 'segment') {
            if (distToSegment(pos, sh.a, sh.b) <= sh.width / 2 + tolerance) return true;
          } else if (pointInPolygon(pos, sh.points)) return true;
        }
        return false;
      }
    }
  }

  /** A one-line label for the inspector / status bar. */
  describe(): string {
    const shapeNames: Record<GBR_BASIC_SHAPE, string> = {
      [GBR_BASIC_SHAPE.GBR_SEGMENT]: 'Line',
      [GBR_BASIC_SHAPE.GBR_ARC]: 'Arc',
      [GBR_BASIC_SHAPE.GBR_CIRCLE]: 'Circle',
      [GBR_BASIC_SHAPE.GBR_POLYGON]: 'Region',
      [GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE]: 'Flashed round',
      [GBR_BASIC_SHAPE.GBR_SPOT_RECT]: 'Flashed rect',
      [GBR_BASIC_SHAPE.GBR_SPOT_OVAL]: 'Flashed oval',
      [GBR_BASIC_SHAPE.GBR_SPOT_POLY]: 'Flashed poly',
      [GBR_BASIC_SHAPE.GBR_SPOT_MACRO]: 'Flashed macro',
    };
    const d = this.dcodeNum ? ` D${this.dcodeNum}` : '';
    return `${shapeNames[this.shape]}${d}`;
  }
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if (pi.y > p.y !== pj.y > p.y) {
      const xCross = ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}
