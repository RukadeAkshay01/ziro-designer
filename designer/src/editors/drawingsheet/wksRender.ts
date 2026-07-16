/**
 * Drawing-sheet canvas painter. Draws the resolved IU primitives from
 * `layoutDrawingSheet` the way KiCad's DS_PAINTER paints them in `pl_editor`
 * (common/drawing_sheet/ds_painter.cpp):
 *  - lines / rectangles are stroked with the pen width;
 *  - poly-polygons are *filled* with the item colour (DrawPolygon, fill on,
 *    stroke off), the way logos are drawn;
 *  - text uses the stroke font (Newstroke) by default, or the named outline
 *    font when the item carries a `face` — matching `font->Draw`, which strokes
 *    glyph paths for the stroke font and fills glyph outlines for an outline
 *    font;
 *  - bitmaps are centred and sized `pixels / ppi · scale`.
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

/** LAYER_DRAWINGSHEET default colour (a muted red-brown on the white page). */
export const DS_ITEM_COLOR = '#c8322d';
export const DS_PAGE_COLOR = '#ffffff';
export const DS_BG_COLOR = '#4a4a52';
/** Black-background display option (pl_editor_settings `black_background`). */
export const DS_BG_COLOR_DARK = '#000000';
export const DS_HILITE_COLOR = '#4aa3ff';
/** DS_RENDER_SETTINGS m_brightenedColor: hover highlight of the delete picker. */
export const DS_BRIGHTENED_COLOR = 'rgba(0,230,0,0.9)';

interface RenderOpts {
  color?: string;
  /** IU pen floor so hairlines stay visible; caller passes 1 world-unit ≈ n px. */
  minWidth?: number;
  /** Item index brightened by the interactive-delete picker (green). */
  brightened?: number | null;
}

/** Line-pitch factor for multi-line outline text (FONT_METRICS m_InterlinePitch). */
const INTERLINE_PITCH = 1.68;

/**
 * Map a stored `face` name to a CSS font-family. `sans`/`serif`/`monospace`
 * resolve to the CSS generics; any other name is passed through with a
 * sans-serif fallback so an unavailable face still renders.
 */
function cssFamily(face: string): string {
  const f = face.toLowerCase();
  if (f === 'sans' || f === 'sans-serif') return 'sans-serif';
  if (f === 'serif') return 'serif';
  if (f === 'monospace' || f === 'mono') return 'monospace';
  return `"${face}", sans-serif`;
}

/**
 * Fill one resolved text primitive with a named outline font, the way
 * `font->Draw` renders TTF glyphs (filled, not stroked). Positioning,
 * justification, rotation and the width/height ratio match the stroke path.
 */
/**
 * Reference glyph size (device px) the outline font is set at. Browsers clamp
 * `ctx.font` to a few thousand px, so setting an 8 mm = 80000 IU size directly
 * under the IU world transform gets dropped; instead the font is rasterised at
 * EM px and a nested scale maps EM → the item's world size.
 */
const OUTLINE_EM = 100;

function drawOutlineText(ctx: CanvasRenderingContext2D, t: DsTextItem, color: string): void {
  const size = t.h;
  if (size <= 0 || t.text === '') return;
  const lines = t.text.split('\n');
  const sx = size > 0 ? t.w / size : 1;
  const rad = (-t.rotate * Math.PI) / 180;
  const lineHeight = OUTLINE_EM * INTERLINE_PITCH; // in EM units
  const n = lines.length;
  // Vertical block anchor: top → first line at 0; bottom → last line at 0;
  // center → block centred. Canvas baselines line up with these.
  const baseline = t.vjustify === 'top' ? 'top' : t.vjustify === 'bottom' ? 'bottom' : 'middle';
  const y0 =
    t.vjustify === 'top'
      ? 0
      : t.vjustify === 'bottom'
        ? -(n - 1) * lineHeight
        : -((n - 1) / 2) * lineHeight;

  ctx.save();
  ctx.translate(t.at.x, t.at.y);
  ctx.rotate(rad);
  // Map the EM-sized font to `size` world units, applying the width/height ratio.
  ctx.scale((sx * size) / OUTLINE_EM, size / OUTLINE_EM);
  ctx.fillStyle = color;
  ctx.textAlign = t.hjustify === 'left' ? 'left' : t.hjustify === 'right' ? 'right' : 'center';
  ctx.textBaseline = baseline;
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${OUTLINE_EM}px ${cssFamily(t.face ?? '')}`;
  lines.forEach((line, i) => ctx.fillText(line, 0, y0 + i * lineHeight));
  ctx.restore();
}

/** Stroke one resolved text primitive with the Newstroke font. */
function drawText(
  ctx: CanvasRenderingContext2D,
  t: DsTextItem,
  color: string,
  minWidth: number,
): void {
  // A named outline font is filled (font->Draw); the default is the stroke font.
  if (t.face) {
    drawOutlineText(ctx, t, color);
    return;
  }
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
    // Priority: delete-picker brighten > selection > per-item colour > layer colour.
    const itemColor =
      d.kind === 'text' && d.color
        ? `rgba(${d.color.r},${d.color.g},${d.color.b},${d.color.a})`
        : baseColor;
    const color =
      opts.brightened === d.src ? DS_BRIGHTENED_COLOR : sel ? DS_HILITE_COLOR : itemColor;
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
        // DS_PAINTER fills poly-polygons (fill on, stroke off) — logos, not outlines.
        ctx.fillStyle = color;
        ctx.beginPath();
        d.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
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
