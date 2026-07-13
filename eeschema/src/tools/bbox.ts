/**
 * Axis-aligned bounding boxes in world (internal-unit) space.
 *
 * Used for hit-testing and drawing selection highlights. The symbol body box
 * mirrors KiCad's `SCH_SYMBOL::GetBodyBoundingBox`: the extent of the unit's
 * graphics and pins, mapped through the placement transform (fields excluded).
 */

import { localToWorld, type Transform } from '@ziroeda/common/src/transform.js';
import { symbolTransform } from '@ziroeda/common/src/transform.js';
import type { LibSymbol, LibSymbolUnit, SchLabel, SchSymbol, Vec2 } from '../types.js';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmpty(b: BBox): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

export function includePoint(b: BBox, p: Vec2): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

export function inflate(b: BBox, d: number): BBox {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function contains(b: BBox, p: Vec2): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function includeUnit(b: BBox, unit: LibSymbolUnit, origin: Vec2, t: Transform): void {
  for (const g of unit.graphics) {
    switch (g.kind) {
      case 'rectangle':
        for (const c of [
          g.start,
          { x: g.end.x, y: g.start.y },
          g.end,
          { x: g.start.x, y: g.end.y },
        ])
          includePoint(b, localToWorld(origin, t, c));
        break;
      case 'polyline':
        for (const p of g.points) includePoint(b, localToWorld(origin, t, p));
        break;
      case 'circle':
        for (const c of [
          { x: g.center.x - g.radius, y: g.center.y },
          { x: g.center.x + g.radius, y: g.center.y },
          { x: g.center.x, y: g.center.y - g.radius },
          { x: g.center.x, y: g.center.y + g.radius },
        ])
          includePoint(b, localToWorld(origin, t, c));
        break;
      case 'arc':
        includePoint(b, localToWorld(origin, t, g.start));
        includePoint(b, localToWorld(origin, t, g.mid));
        includePoint(b, localToWorld(origin, t, g.end));
        break;
      case 'text':
        includePoint(b, localToWorld(origin, t, g.at));
        break;
    }
  }
  for (const pin of unit.pins) includePoint(b, localToWorld(origin, t, pin.at));
}

function unitMatches(u: LibSymbolUnit, unit: number, bodyStyle: number): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/**
 * Approximate text box of a label/text item: anchored at its connection point and
 * growing away from it per the justification. Shared by click and box selection.
 */
export function labelBox(l: SchLabel): BBox {
  const h = l.effects?.fontSize?.[0] ?? 12700;
  const justify = l.effects?.justify;
  const w = Math.max(1, l.text.length) * h * 0.7;
  const at = l.at;
  const left = justify?.includes('right') ? at.x - w : at.x;
  const right = justify?.includes('right') ? at.x : at.x + w;
  const top = justify?.includes('bottom')
    ? at.y - h
    : justify?.includes('top')
      ? at.y
      : at.y - h / 2;
  const bottom = justify?.includes('bottom')
    ? at.y
    : justify?.includes('top')
      ? at.y + h
      : at.y + h / 2;
  return { minX: left, minY: top, maxX: right, maxY: bottom };
}

/** Body bounding box of a placed symbol (graphics + pins through the transform). */
export function symbolBodyBBox(sym: SchSymbol, lib: LibSymbol | undefined): BBox {
  const b = emptyBBox();
  if (!lib) {
    // Fallback: a small box around the origin so the symbol is still selectable.
    includePoint(b, { x: sym.at.x - 12700, y: sym.at.y - 12700 });
    includePoint(b, { x: sym.at.x + 12700, y: sym.at.y + 12700 });
    return b;
  }
  const t = symbolTransform(sym.angle, sym.mirror);
  for (const u of lib.units) {
    if (unitMatches(u, sym.unit, sym.bodyStyle)) includeUnit(b, u, sym.at, t);
  }
  if (isEmpty(b)) includePoint(b, sym.at);
  return b;
}
