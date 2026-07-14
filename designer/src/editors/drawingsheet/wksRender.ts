/**
 * Drawing-sheet canvas painter. Draws the resolved IU primitives from
 * `layoutDrawingSheet` the way KiCad's DS_DRAW_ITEM classes paint in
 * `pl_editor` — segments, rectangles, poly-polygons, stroke-font text (via the
 * Newstroke font, matching the rest of the suite) and bitmap placeholders.
 *
 * The caller sets the world transform on the context (IU → device pixels)
 * before calling; everything here is in schematic internal units.
 */

import type { DsDrawItem, DsTextItem, DsBitmapItem } from '@ziroeda/common';
import { layoutText } from '@ziroeda/common/src/font/stroke_font.js';

// KiCad's italic shear (common/font/font.h ITALIC_TILT = 1/8).
const ITALIC_TILT = 1 / 8;
import { getBitmapImage } from './wksBitmap.js';

/** IU per inch: 25.4 mm/in · 10000 IU/mm. */
const IU_PER_INCH = 254000;

/** KiCad LAYER_DRAWINGSHEET default colour (a muted red-brown on the white page). */
export const DS_ITEM_COLOR = '#c8322d';
export const DS_PAGE_COLOR = '#ffffff';
export const DS_BG_COLOR = '#4a4a52';
export const DS_HILITE_COLOR = '#4aa3ff';

interface RenderOpts {
  color?: string;
  /** IU pen floor so hairlines stay visible; caller passes 1 world-unit ≈ n px. */
  minWidth?: number;
}

/** Stroke one resolved text primitive with the Newstroke font. */
function drawText(
  ctx: CanvasRenderingContext2D,
  t: DsTextItem,
  color: string,
  minWidth: number,
): void {
  const size = t.h;
  if (size <= 0 || t.text === '') return;
  const { strokes, width } = layoutText(t.text, size);
  // EDA_TEXT pen: file thickness else bold→size/5 / normal→size/8, clamped ≤ size·0.25.
  const raw = t.thickness > 0 ? t.thickness : t.bold ? size / 5 : size / 8;
  const thickness = Math.max(Math.min(raw, size * 0.25), minWidth);
  const offX = t.hjustify === 'left' ? 0 : t.hjustify === 'right' ? -width : -width / 2;
  const offY = t.vjustify === 'top' ? size : t.vjustify === 'bottom' ? 0 : size / 2;
  const rad = (-t.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = size > 0 ? t.w / size : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = (stroke[i]!.x + offX) * sx - stroke[i]!.y * tilt;
      const gy = stroke[i]!.y + offY;
      const x = t.at.x + gx * cos - gy * sin;
      const y = t.at.y + gx * sin + gy * cos;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (stroke.length === 1) ctx.lineTo(x + 1, y);
    }
  }
  ctx.stroke();
}

/**
 * Draw one bitmap. KiCad centres the image on its anchor point and sizes it at
 * `pixels / ppi · scale`. While the PNG is still decoding (or when it has no
 * payload) a dashed placeholder box of the same footprint is drawn instead, so
 * the item stays visible, selectable and movable.
 */
function drawBitmap(
  ctx: CanvasRenderingContext2D,
  d: DsBitmapItem,
  color: string,
  minWidth: number,
): void {
  const decoded = d.pngB64 ? getBitmapImage(d.pngB64) : null;
  const pxW = decoded?.w ?? (d.pxW && d.pxW > 0 ? d.pxW : d.ppi);
  const pxH = decoded?.h ?? (d.pxH && d.pxH > 0 ? d.pxH : d.ppi);
  const w = (pxW / d.ppi) * IU_PER_INCH * d.scale;
  const h = (pxH / d.ppi) * IU_PER_INCH * d.scale;
  const x = d.at.x - w / 2;
  const y = d.at.y - h / 2;
  if (decoded) {
    ctx.drawImage(decoded.img, x, y, w, h);
  } else {
    ctx.strokeStyle = color;
    ctx.setLineDash([Math.max(w, h) / 40, Math.max(w, h) / 60]);
    ctx.lineWidth = minWidth;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

/** Draw all resolved primitives; `selected` is the set of source item indices. */
export function drawDrawingSheetItems(
  ctx: CanvasRenderingContext2D,
  draws: DsDrawItem[],
  selected: ReadonlySet<number>,
  opts: RenderOpts = {},
): void {
  const baseColor = opts.color ?? DS_ITEM_COLOR;
  const minWidth = opts.minWidth ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const d of draws) {
    const sel = selected.has(d.src);
    const color = sel ? DS_HILITE_COLOR : baseColor;
    switch (d.kind) {
      case 'line': {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(d.width, minWidth);
        ctx.beginPath();
        ctx.moveTo(d.a.x, d.a.y);
        ctx.lineTo(d.b.x, d.b.y);
        ctx.stroke();
        break;
      }
      case 'rect': {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(d.width, minWidth);
        ctx.strokeRect(
          Math.min(d.a.x, d.b.x),
          Math.min(d.a.y, d.b.y),
          Math.abs(d.b.x - d.a.x),
          Math.abs(d.b.y - d.a.y),
        );
        break;
      }
      case 'poly': {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(d.width, minWidth);
        ctx.beginPath();
        d.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'text':
        drawText(ctx, d, color, minWidth);
        break;
      case 'bitmap':
        drawBitmap(ctx, d, color, minWidth);
        break;
    }
  }
}
