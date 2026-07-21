/**
 * D_CODE — a Gerber aperture, mirroring `gerbview/dcode.h/.cpp`. Each aperture
 * has a shape (circle, rect, obround, regular polygon, or a macro reference),
 * outer dimensions, and an optional drilled hole (round or rectangular) that is
 * cleared from the flashed pad. Dimensions are stored in the file unit that was
 * active when the aperture was defined, together with that unit's IU scale, so
 * flashes resolve to IU consistently even if the `MO` unit later changes.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { APERTURE_T } from './types.js';
import type { ApertureMacro, AmResolvedShape } from './aperture_macro.js';

/** Hole shape of an aperture drill (D_CODE::m_DrillShape). */
export enum APERTURE_DEF_HOLE {
  NO_HOLE = 0,
  ROUND = 1,
  RECT = 2,
}

export class D_CODE {
  /** D-code number (10…999). */
  num_Dcode: number;
  shape: APERTURE_T = APERTURE_T.APT_CIRCLE;
  /** Outer size in file units (width in x, height in y). */
  size: Vec2 = { x: 0, y: 0 };
  /** Drill/hole size in file units. */
  drill: Vec2 = { x: 0, y: 0 };
  drillShape: APERTURE_DEF_HOLE = APERTURE_DEF_HOLE.NO_HOLE;
  /** Regular-polygon vertex count (APT_POLYGON). */
  edgesCount = 0;
  /** Aperture rotation in degrees (APT_POLYGON / macro). */
  rotation = 0;
  /** Macro reference (APT_MACRO). */
  macro: ApertureMacro | null = null;
  /** Macro call parameters (file units / plain numbers). */
  macroParams: number[] = [];
  /** IU-per-file-unit scale active when this aperture was defined. */
  iuScale: number;
  /** True once the aperture has been fully defined (AD seen). */
  defined = false;

  constructor(num: number, iuScale: number) {
    this.num_Dcode = num;
    this.iuScale = iuScale;
  }

  /** Convenience: is this a macro aperture? */
  isMacro(): boolean {
    return this.shape === APERTURE_T.APT_MACRO;
  }

  /**
   * Generate the flashed shape as a list of exposure-tagged primitives, in IU
   * relative to the flash point (before applying the item's own rotation /
   * mirroring). Standard apertures emit the pad body (exposure on) plus the
   * cleared hole (exposure off); macros defer to APERTURE_MACRO::resolve.
   */
  getFlashShapes(): AmResolvedShape[] {
    const s = this.iuScale;
    const out: AmResolvedShape[] = [];
    const L = (v: number): number => v * s;

    if (this.shape === APERTURE_T.APT_MACRO && this.macro) {
      return this.macro.resolve(this.macroParams, s);
    }

    switch (this.shape) {
      case APERTURE_T.APT_CIRCLE: {
        out.push({
          kind: 'circle',
          exposure: true,
          center: { x: 0, y: 0 },
          radius: L(this.size.x / 2),
        });
        break;
      }
      case APERTURE_T.APT_RECT: {
        const w = L(this.size.x) / 2;
        const h = L(this.size.y) / 2;
        out.push({
          kind: 'polygon',
          exposure: true,
          points: [
            { x: -w, y: -h },
            { x: w, y: -h },
            { x: w, y: h },
            { x: -w, y: h },
          ],
        });
        break;
      }
      case APERTURE_T.APT_OVAL: {
        // Obround: a thick segment whose width is the shorter dimension.
        const w = L(this.size.x);
        const h = L(this.size.y);
        if (w > h) {
          const half = (w - h) / 2;
          out.push({
            kind: 'segment',
            exposure: true,
            a: { x: -half, y: 0 },
            b: { x: half, y: 0 },
            width: h,
          });
        } else {
          const half = (h - w) / 2;
          out.push({
            kind: 'segment',
            exposure: true,
            a: { x: 0, y: -half },
            b: { x: 0, y: half },
            width: w,
          });
        }
        break;
      }
      case APERTURE_T.APT_POLYGON: {
        const radius = L(this.size.x / 2);
        const sides = Math.max(3, this.edgesCount);
        const pts: Vec2[] = [];
        for (let i = 0; i < sides; i++) {
          const a = ((this.rotation + (360 * i) / sides) * Math.PI) / 180;
          pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
        }
        out.push({ kind: 'polygon', exposure: true, points: pts });
        break;
      }
      default:
        break;
    }

    // Drilled hole (cleared from the pad body).
    if (this.drillShape === APERTURE_DEF_HOLE.ROUND && this.drill.x > 0) {
      out.push({
        kind: 'circle',
        exposure: false,
        center: { x: 0, y: 0 },
        radius: L(this.drill.x / 2),
      });
    } else if (this.drillShape === APERTURE_DEF_HOLE.RECT && this.drill.x > 0) {
      const w = L(this.drill.x) / 2;
      const h = L(this.drill.y || this.drill.x) / 2;
      out.push({
        kind: 'polygon',
        exposure: false,
        points: [
          { x: -w, y: -h },
          { x: w, y: -h },
          { x: w, y: h },
          { x: -w, y: h },
        ],
      });
    }
    return out;
  }

  /** A short human description, e.g. "Round 0.60mm" (used by the DCode list). */
  describe(): string {
    const shapeName: Record<APERTURE_T, string> = {
      [APERTURE_T.APT_CIRCLE]: 'Round',
      [APERTURE_T.APT_RECT]: 'Rect',
      [APERTURE_T.APT_OVAL]: 'Oval',
      [APERTURE_T.APT_POLYGON]: 'Poly',
      [APERTURE_T.APT_MACRO]: 'Macro',
    };
    return shapeName[this.shape] ?? 'Round';
  }
}
