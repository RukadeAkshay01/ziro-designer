/**
 * Drawing-sheet editing geometry: bounding boxes, picking, and corner-aware
 * moves over the `WksSheet` model. The editor works in resolved IU page space
 * for hit-testing (so the user clicks what they see) but writes changes back to
 * the anchored millimetre model, flipping the delta sign per corner exactly as
 * KiCad's DS_DATA_ITEM stores offsets inward from each page corner.
 */

import { iuToMM } from '../eda_units.js';
import type { Vec2 } from '@ziroeda/kimath';
import type { WksItem, WksPoint, WksCorner } from './types.js';
import type { DsDrawItem } from './layout.js';

export interface WksBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Approximate glyph advance as a fraction of height (Newstroke ≈ 0.7·h wide). */
const GLYPH_ASPECT = 0.72;

/** Bounding box (IU) of one resolved draw primitive. */
export function drawItemBBox(d: DsDrawItem): WksBBox {
  switch (d.kind) {
    case 'line':
    case 'rect': {
      const pad = Math.max(d.width / 2, 1);
      return {
        minX: Math.min(d.a.x, d.b.x) - pad,
        minY: Math.min(d.a.y, d.b.y) - pad,
        maxX: Math.max(d.a.x, d.b.x) + pad,
        maxY: Math.max(d.a.y, d.b.y) + pad,
      };
    }
    case 'poly': {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of d.pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = Math.max(d.width / 2, 1);
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }
    case 'text': {
      // Approximate: width by glyph count, then rotate the box corners.
      const longest = d.text.split('\n').reduce((n, l) => Math.max(n, l.length), 0);
      const lines = d.text.split('\n').length;
      const w = Math.max(longest, 1) * d.w * GLYPH_ASPECT;
      const h = lines * d.h * 1.3;
      const hx = d.hjustify === 'left' ? 0 : d.hjustify === 'right' ? -w : -w / 2;
      const hy = d.vjustify === 'top' ? 0 : d.vjustify === 'bottom' ? -h : -h / 2;
      const rad = (-d.rotate * Math.PI) / 180;
      const cos = Math.cos(rad),
        sin = Math.sin(rad);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [cx, cy] of [
        [hx, hy],
        [hx + w, hy],
        [hx + w, hy + h],
        [hx, hy + h],
      ] as const) {
        const x = d.at.x + cx * cos - cy * sin;
        const y = d.at.y + cx * sin + cy * cos;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'bitmap': {
      // IU per inch = 25.4 mm/in · 10000 IU/mm. Size = pixels / ppi (inch) · scale.
      // Fall back to a 1-inch square when the image hasn't been decoded yet, so a
      // freshly-placed / not-yet-loaded bitmap is still visible and pickable.
      const IU_PER_INCH = 254000;
      const px = (n: number | undefined): number => (n && n > 0 ? n : d.ppi);
      const halfW = ((px(d.pxW) / d.ppi) * IU_PER_INCH * d.scale) / 2;
      const halfH = ((px(d.pxH) / d.ppi) * IU_PER_INCH * d.scale) / 2;
      return {
        minX: d.at.x - halfW,
        minY: d.at.y - halfH,
        maxX: d.at.x + halfW,
        maxY: d.at.y + halfH,
      };
    }
  }
}

/** Union bbox (IU) of every resolved primitive belonging to model item `src`. */
export function itemBBox(draws: DsDrawItem[], src: number): WksBBox | null {
  let box: WksBBox | null = null;
  for (const d of draws) {
    if (d.src !== src) continue;
    const b = drawItemBBox(d);
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b;
  }
  return box;
}

const inside = (b: WksBBox, p: Vec2, tol: number): boolean =>
  p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;

/**
 * Pick the top-most model item at `world` (IU), within `tol`. Returns the
 * `src` index or `null`. Later items paint on top, so they win ties.
 */
export function pickDrawItem(draws: DsDrawItem[], world: Vec2, tol: number): number | null {
  let best: number | null = null;
  for (const d of draws) {
    if (inside(drawItemBBox(d), world, tol)) best = d.src;
  }
  return best;
}

/** Model-item indices whose union bbox intersects the given IU box. */
export function itemsInBox(
  draws: DsDrawItem[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number[] {
  const minX = Math.min(ax, bx),
    maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by),
    maxY = Math.max(ay, by);
  const hits = new Set<number>();
  for (const d of draws) {
    const b = drawItemBBox(d);
    if (b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY) hits.add(d.src);
  }
  return [...hits].sort((a, z) => a - z);
}

const isRightCorner = (c: WksCorner): boolean => c === 'rtcorner' || c === 'rbcorner';
const isBottomCorner = (c: WksCorner): boolean => c === 'lbcorner' || c === 'rbcorner';

/** Apply a page-space mm delta to one anchored point (sign flips per corner). */
function shiftPoint(p: WksPoint, dxMM: number, dyMM: number): WksPoint {
  return {
    ...p,
    x: p.x + (isRightCorner(p.corner) ? -dxMM : dxMM),
    y: p.y + (isBottomCorner(p.corner) ? -dyMM : dyMM),
  };
}

/** Translate an item by a page-space delta given in IU (used by drag-move). */
export function translateItem(item: WksItem, deltaIU: Vec2): WksItem {
  const dxMM = iuToMM(deltaIU.x);
  const dyMM = iuToMM(deltaIU.y);
  switch (item.type) {
    case 'line':
    case 'rect':
      return {
        ...item,
        start: shiftPoint(item.start, dxMM, dyMM),
        end: shiftPoint(item.end, dxMM, dyMM),
      };
    case 'text':
      return { ...item, pos: shiftPoint(item.pos, dxMM, dyMM) };
    case 'polygon':
    case 'bitmap':
      return { ...item, pos: shiftPoint(item.pos, dxMM, dyMM) };
  }
}

/** Immutably replace item at `index` in a sheet's item list. */
export function replaceItem<T extends { items: WksItem[] }>(
  sheet: T,
  index: number,
  next: WksItem,
): T {
  const items = sheet.items.slice();
  items[index] = next;
  return { ...sheet, items };
}
