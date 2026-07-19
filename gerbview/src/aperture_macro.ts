/**
 * Aperture macros (RS-274X `AM` command), mirroring
 * `gerbview/aperture_macro.h/.cpp` and `gerbview/am_primitive.h/.cpp`.
 *
 * A macro is a named template built from primitives (circle, vector line,
 * center line, lower-left line, outline, polygon, moiré, thermal). Primitive
 * modifiers may be arithmetic expressions referencing the macro's call
 * parameters ($1, $2 …) and locally-assigned variables ($4=$1x2). When a
 * D-code aperture references the macro (`ADDnn<MACRO>,p1Xp2X…`), the call
 * parameters are substituted and the macro resolves to a set of exposure-on /
 * exposure-off shapes centred on the flash point.
 */

import type { Vec2 } from '@ziroeda/kimath';

/** AM primitive identifiers (AM_PRIMITIVE_ID). */
export enum AMP {
  COMMENT = 0,
  CIRCLE = 1,
  LINE2 = 2, // vector line (obsolete synonym of 20)
  LINE20 = 20, // vector line
  LINE21 = 21, // center line
  LINE22 = 22, // lower-left line
  OUTLINE = 4,
  POLYGON = 5,
  MOIRE = 6,
  THERMAL = 7,
  EOF = -1,
  UNKNOWN = -2,
}

/** A macro primitive: its id and the raw modifier expressions. */
export interface AmPrimitive {
  primitiveId: AMP;
  /** Modifier expressions in source order (already tokenised, still symbolic). */
  params: string[];
}

/** A resolved, flattened shape ready to render (coordinates in IU, macro origin). */
export type AmResolvedShape =
  | { kind: 'circle'; exposure: boolean; center: Vec2; radius: number }
  | { kind: 'polygon'; exposure: boolean; points: Vec2[] }
  | { kind: 'segment'; exposure: boolean; a: Vec2; b: Vec2; width: number };

/** Rotate a point about the origin by `angleDeg` (CCW, Gerber convention). */
function rotate(p: Vec2, angleDeg: number): Vec2 {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Evaluate a macro modifier expression. Supports numbers, `$n` parameter
 * references, unary minus, the operators `+ - x X /`, and parentheses
 * (AM_PRIMITIVE arithmetic). Unknown `$n` resolve to 0, as KiCad does.
 */
export function evalMacroExpr(expr: string, params: number[]): number {
  const src = expr.trim();
  let pos = 0;

  const peek = (): string => src[pos] ?? '';
  const skipWs = (): void => {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++;
  };

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipWs();
      const ch = peek();
      if (ch === '+') {
        pos++;
        value += parseTerm();
      } else if (ch === '-') {
        pos++;
        value -= parseTerm();
      } else break;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skipWs();
      const ch = peek();
      if (ch === 'x' || ch === 'X' || ch === '*') {
        pos++;
        value *= parseFactor();
      } else if (ch === '/') {
        pos++;
        const d = parseFactor();
        value = d === 0 ? 0 : value / d;
      } else break;
    }
    return value;
  }

  function parseFactor(): number {
    skipWs();
    const ch = peek();
    if (ch === '+') {
      pos++;
      return parseFactor();
    }
    if (ch === '-') {
      pos++;
      return -parseFactor();
    }
    if (ch === '(') {
      pos++;
      const v = parseExpr();
      skipWs();
      if (peek() === ')') pos++;
      return v;
    }
    if (ch === '$') {
      pos++;
      let num = '';
      while (pos < src.length && /[0-9]/.test(src[pos]!)) num += src[pos++]!;
      const idx = parseInt(num, 10);
      return Number.isFinite(idx) && idx >= 1 ? (params[idx - 1] ?? 0) : 0;
    }
    // number
    let num = '';
    while (pos < src.length && /[0-9.]/.test(src[pos]!)) num += src[pos++]!;
    const v = parseFloat(num);
    return Number.isFinite(v) ? v : 0;
  }

  const result = parseExpr();
  return Number.isFinite(result) ? result : 0;
}

/** Approximate a circle/arc segment count for polygonising rounded parts. */
const CIRCLE_SEGMENTS = 64;

/** Build a filled regular polygon (used for AMP.POLYGON and circles). */
function regularPolygon(center: Vec2, radius: number, sides: number, rotationDeg: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rotationDeg + (360 * i) / sides) * Math.PI) / 180;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

/**
 * An aperture macro definition. `resolve()` substitutes call parameters and
 * returns flattened shapes in IU relative to the flash origin.
 */
export class ApertureMacro {
  name: string;
  primitives: AmPrimitive[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Resolve the macro into renderable shapes. `callParams` are the numeric
   * arguments from the D-code (already scaled to IU where they are lengths —
   * we instead scale here using `iuScale`, matching KiCad which keeps macro
   * modifiers in file units and scales at build time). `iuScale` converts a
   * macro length (in the file unit) to IU.
   */
  resolve(callParams: number[], iuScale: number): AmResolvedShape[] {
    // Local parameter table: starts as the call parameters, extended by
    // `$n=expr` equation primitives encountered in order.
    const localParams = callParams.slice();
    const out: AmResolvedShape[] = [];
    const L = (v: number): number => v * iuScale;

    for (const prim of this.primitives) {
      const ev = (i: number): number => evalMacroExpr(prim.params[i] ?? '0', localParams);

      switch (prim.primitiveId) {
        case AMP.COMMENT:
          // A `$n=expr` assignment stored as a comment-class primitive.
          if (prim.params.length >= 2 && prim.params[0]!.startsWith('$')) {
            const idx = parseInt(prim.params[0]!.slice(1), 10);
            if (idx >= 1) localParams[idx - 1] = evalMacroExpr(prim.params[1]!, localParams);
          }
          break;

        case AMP.CIRCLE: {
          // exposure, diameter, centerX, centerY, [rotation]
          const exposure = ev(0) !== 0;
          const diameter = ev(1);
          let c: Vec2 = { x: ev(2), y: ev(3) };
          const rot = prim.params.length > 4 ? ev(4) : 0;
          c = rotate(c, rot);
          out.push({
            kind: 'circle',
            exposure,
            center: { x: L(c.x), y: L(c.y) },
            radius: L(diameter / 2),
          });
          break;
        }

        case AMP.LINE2:
        case AMP.LINE20: {
          // exposure, width, startX, startY, endX, endY, rotation
          const exposure = ev(0) !== 0;
          const width = ev(1);
          const rot = ev(6);
          const a = rotate({ x: ev(2), y: ev(3) }, rot);
          const b = rotate({ x: ev(4), y: ev(5) }, rot);
          out.push({
            kind: 'segment',
            exposure,
            a: { x: L(a.x), y: L(a.y) },
            b: { x: L(b.x), y: L(b.y) },
            width: L(width),
          });
          break;
        }

        case AMP.LINE21: {
          // exposure, width, height, centerX, centerY, rotation
          const exposure = ev(0) !== 0;
          const w = ev(1) / 2;
          const h = ev(2) / 2;
          const cx = ev(3);
          const cy = ev(4);
          const rot = ev(5);
          const corners: Vec2[] = [
            { x: cx - w, y: cy - h },
            { x: cx + w, y: cy - h },
            { x: cx + w, y: cy + h },
            { x: cx - w, y: cy + h },
          ].map((p) => rotate(p, rot));
          out.push({
            kind: 'polygon',
            exposure,
            points: corners.map((p) => ({ x: L(p.x), y: L(p.y) })),
          });
          break;
        }

        case AMP.LINE22: {
          // exposure, width, height, lowerLeftX, lowerLeftY, rotation
          const exposure = ev(0) !== 0;
          const w = ev(1);
          const h = ev(2);
          const x = ev(3);
          const y = ev(4);
          const rot = ev(5);
          const corners: Vec2[] = [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ].map((p) => rotate(p, rot));
          out.push({
            kind: 'polygon',
            exposure,
            points: corners.map((p) => ({ x: L(p.x), y: L(p.y) })),
          });
          break;
        }

        case AMP.OUTLINE: {
          // exposure, numVertices(n), x0, y0, ... xn, yn, rotation
          const exposure = ev(0) !== 0;
          const n = Math.round(ev(1));
          // There are n+1 coordinate pairs (start repeated at end).
          const rotIdx = 2 + (n + 1) * 2;
          const rot = prim.params.length > rotIdx ? ev(rotIdx) : 0;
          const pts: Vec2[] = [];
          for (let i = 0; i <= n; i++) {
            const px = ev(2 + i * 2);
            const py = ev(3 + i * 2);
            const p = rotate({ x: px, y: py }, rot);
            pts.push({ x: L(p.x), y: L(p.y) });
          }
          out.push({ kind: 'polygon', exposure, points: pts });
          break;
        }

        case AMP.POLYGON: {
          // exposure, numVertices, centerX, centerY, diameter, rotation
          const exposure = ev(0) !== 0;
          const sides = Math.max(3, Math.round(ev(1)));
          const c: Vec2 = { x: ev(2), y: ev(3) };
          const radius = ev(4) / 2;
          const rot = ev(5);
          const poly = regularPolygon(c, radius, sides, rot);
          out.push({
            kind: 'polygon',
            exposure,
            points: poly.map((p) => ({ x: L(p.x), y: L(p.y) })),
          });
          break;
        }

        case AMP.MOIRE: {
          // centerX, centerY, outerDiam, ringThickness, gap, maxRings,
          // crossHairThickness, crossHairLength, rotation
          const cx = ev(0);
          const cy = ev(1);
          let outer = ev(2);
          const thickness = ev(3);
          const gap = ev(4);
          const maxRings = Math.round(ev(5));
          const crossThick = ev(6);
          const crossLen = ev(7);
          const rot = ev(8);
          const c = rotate({ x: cx, y: cy }, rot);
          // Concentric rings: on (outer) then off (inner) pairs.
          for (let i = 0; i < maxRings && outer > 0; i++) {
            out.push({
              kind: 'circle',
              exposure: true,
              center: { x: L(c.x), y: L(c.y) },
              radius: L(outer / 2),
            });
            const inner = outer - 2 * thickness;
            if (inner > 0)
              out.push({
                kind: 'circle',
                exposure: false,
                center: { x: L(c.x), y: L(c.y) },
                radius: L(inner / 2),
              });
            outer = inner - 2 * gap;
          }
          // Cross-hair (two rectangles).
          if (crossThick > 0 && crossLen > 0) {
            const hl = crossLen / 2;
            const ht = crossThick / 2;
            const horiz: Vec2[] = [
              { x: cx - hl, y: cy - ht },
              { x: cx + hl, y: cy - ht },
              { x: cx + hl, y: cy + ht },
              { x: cx - hl, y: cy + ht },
            ].map((p) => rotate(p, rot));
            const vert: Vec2[] = [
              { x: cx - ht, y: cy - hl },
              { x: cx + ht, y: cy - hl },
              { x: cx + ht, y: cy + hl },
              { x: cx - ht, y: cy + hl },
            ].map((p) => rotate(p, rot));
            out.push({
              kind: 'polygon',
              exposure: true,
              points: horiz.map((p) => ({ x: L(p.x), y: L(p.y) })),
            });
            out.push({
              kind: 'polygon',
              exposure: true,
              points: vert.map((p) => ({ x: L(p.x), y: L(p.y) })),
            });
          }
          break;
        }

        case AMP.THERMAL: {
          // centerX, centerY, outerDiam, innerDiam, gapThickness, rotation
          const cx = ev(0);
          const cy = ev(1);
          const outer = ev(2);
          const inner = ev(3);
          const gap = ev(4);
          const rot = ev(5);
          const c = rotate({ x: cx, y: cy }, rot);
          // Ring: on outer, off inner.
          out.push({
            kind: 'circle',
            exposure: true,
            center: { x: L(c.x), y: L(c.y) },
            radius: L(outer / 2),
          });
          out.push({
            kind: 'circle',
            exposure: false,
            center: { x: L(c.x), y: L(c.y) },
            radius: L(inner / 2),
          });
          // Four gap rectangles (clear) crossing the ring at 0/90/180/270 + rot.
          const halfGap = gap / 2;
          const r = outer / 2 + 1;
          for (const base of [0, 90]) {
            const ang = base + rot;
            const rad = (ang * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = Math.sin(rad);
            // A thin clear rectangle along the direction (dx,dy), width=gap.
            const nx = -dy;
            const ny = dx;
            const pts: Vec2[] = [
              { x: cx - r * dx + halfGap * nx, y: cy - r * dy + halfGap * ny },
              { x: cx + r * dx + halfGap * nx, y: cy + r * dy + halfGap * ny },
              { x: cx + r * dx - halfGap * nx, y: cy + r * dy - halfGap * ny },
              { x: cx - r * dx - halfGap * nx, y: cy - r * dy - halfGap * ny },
            ];
            out.push({
              kind: 'polygon',
              exposure: false,
              points: pts.map((p) => ({ x: L(p.x), y: L(p.y) })),
            });
          }
          break;
        }

        default:
          break;
      }
    }
    return out;
  }
}

export { CIRCLE_SEGMENTS };
