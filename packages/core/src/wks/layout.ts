/**
 * Drawing-sheet layout resolver: turn corner-anchored millimetre items into
 * concrete IU page geometry for a specific page, mirroring KiCad's
 * DS_DRAW_ITEM_LIST::BuildDrawItemsList (common/drawing_sheet/ds_draw_item.cpp).
 *
 * Responsibilities, all from KiCad:
 *  - corner anchoring: the four page corners are the margin-box corners, and an
 *    item coordinate is measured *inward* from its anchor corner;
 *  - repeats: an item with `repeat > 1` is emitted `repeat` times, each copy
 *    offset by (incrx, incry) mm and — for text — its trailing label incremented
 *    by `incrlabel` (DS_DATA_ITEM_TEXT::IncrementLabel);
 *  - page filtering: `page1only` / `notonpage1` items are dropped as appropriate;
 *  - text variables: `${…}` tokens are expanded against the supplied title-block
 *    / page context (EDA_TEXT::GetShownText / DS_DRAW_ITEM_LIST::BuildFullText).
 */

import { mmToIU } from '../units.js';
import type { Vec2 } from '../model/types.js';
import type {
  WksSheet, WksItem, WksPoint, WksCorner, WksHJustify, WksVJustify,
} from './types.js';

/** Page dimensions in millimetres (landscape/portrait already applied). */
export interface WksPage {
  widthMM: number;
  heightMM: number;
}

/** Values the `${…}` variables and page-number tokens resolve against. */
export interface WksResolveContext {
  /** 1-based page number (the "Page 1 / Page N" preview). */
  pageNumber?: number;
  /** Total number of sheets. */
  sheetCount?: number;
  title?: string;
  rev?: string;
  date?: string;
  company?: string;
  comments?: string[];
  /** Paper size string (e.g. "A4"). */
  paper?: string;
  fileName?: string;
  sheetName?: string;
  sheetPath?: string;
  appVersion?: string;
}

export interface DsLineItem {
  kind: 'line' | 'rect';
  a: Vec2;
  b: Vec2;
  width: number;
  src: number;
}
export interface DsTextItem {
  kind: 'text';
  text: string;
  at: Vec2;
  w: number;
  h: number;
  thickness: number;
  bold: boolean;
  italic: boolean;
  hjustify: WksHJustify;
  vjustify: WksVJustify;
  rotate: number;
  src: number;
}
export interface DsPolyItem {
  kind: 'poly';
  pts: Vec2[];
  width: number;
  src: number;
}
export interface DsBitmapItem {
  kind: 'bitmap';
  at: Vec2;
  scale: number;
  pngB64: string;
  ppi: number;
  /** Natural pixel dimensions, when the image has been decoded (see WksBitmap). */
  pxW?: number;
  pxH?: number;
  src: number;
}
export type DsDrawItem = DsLineItem | DsTextItem | DsPolyItem | DsBitmapItem;

interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Resolve a corner-anchored mm coordinate (+ per-repeat offset) to IU page space. */
function resolvePoint(p: WksPoint, m: Margins, dx: number, dy: number): Vec2 {
  const x = p.x + dx;
  const y = p.y + dy;
  let mx: number;
  let my: number;
  switch (p.corner as WksCorner) {
    case 'ltcorner': mx = m.left + x; my = m.top + y; break;
    case 'rtcorner': mx = m.right - x; my = m.top + y; break;
    case 'lbcorner': mx = m.left + x; my = m.bottom - y; break;
    case 'rbcorner': default: mx = m.right - x; my = m.bottom - y; break;
  }
  return { x: mmToIU(mx), y: mmToIU(my) };
}

/** Expand `${…}` variables in a template string (KiCad text-variable resolve). */
export function resolveDrawingSheetText(text: string, ctx: WksResolveContext): string {
  const page = ctx.pageNumber ?? 1;
  const count = ctx.sheetCount ?? 1;
  return text.replace(/\$\{([^}]*)\}/g, (whole, name: string) => {
    const key = name.trim().toUpperCase();
    switch (key) {
      case 'TITLE': return ctx.title ?? '';
      case 'REV': case 'REVISION': return ctx.rev ?? '';
      case 'DATE': case 'ISSUE_DATE': return ctx.date ?? '';
      case 'COMPANY': return ctx.company ?? '';
      case 'PAPER': return ctx.paper ?? '';
      case 'FILENAME': return ctx.fileName ?? '';
      case 'SHEETNAME': return ctx.sheetName ?? '';
      case 'SHEETPATH': return ctx.sheetPath ?? '';
      case 'KICAD_VERSION': return ctx.appVersion ?? 'ZiroEDA';
      case '#': return String(page);
      case '##': return String(count);
      default: {
        const cm = /^COMMENT(\d)$/.exec(key);
        if (cm) return ctx.comments?.[Number(cm[1]) - 1] ?? '';
        return whole; // leave unknown tokens intact, as KiCad does
      }
    }
  });
}

/**
 * Increment a text label for a repeat, mirroring DS_DATA_ITEM_TEXT::IncrementLabel:
 * a trailing run of digits is incremented numerically; otherwise the last
 * character's code point is shifted (so "A" → "B", "1" → "2", "Pin1" → "Pin2").
 */
export function incrementLabel(text: string, incr: number): string {
  if (text === '' || incr === 0) return text;
  const digits = /(\d+)$/.exec(text);
  if (digits) {
    const n = Number(digits[1]) + incr;
    return text.slice(0, digits.index) + String(n);
  }
  const last = text.charCodeAt(text.length - 1);
  return text.slice(0, -1) + String.fromCharCode(last + incr);
}

/** True if `option` should be drawn on this page number. */
function visibleOnPage(option: WksItem['option'], pageNumber: number): boolean {
  if (option === 'page1only') return pageNumber === 1;
  if (option === 'notonpage1') return pageNumber !== 1;
  return true;
}

/**
 * Resolve every item of `sheet` into concrete IU draw primitives for `page`.
 * The returned items carry `src` (their index in `sheet.items`) so a caller can
 * map a picked primitive back to the model item it came from.
 */
export function layoutDrawingSheet(
  sheet: WksSheet,
  page: WksPage,
  ctx: WksResolveContext = {},
): DsDrawItem[] {
  const s = sheet.setup;
  const m: Margins = {
    left: s.leftMargin,
    top: s.topMargin,
    right: page.widthMM - s.rightMargin,
    bottom: page.heightMM - s.bottomMargin,
  };
  const pageNumber = ctx.pageNumber ?? 1;
  const defLineW = mmToIU(s.lineWidth);
  const out: DsDrawItem[] = [];

  sheet.items.forEach((it, src) => {
    if (!visibleOnPage(it.option, pageNumber)) return;
    const reps = Math.max(1, it.repeat);
    for (let i = 0; i < reps; i++) {
      const dx = it.incrx * i;
      const dy = it.incry * i;
      switch (it.type) {
        case 'line':
        case 'rect':
          out.push({
            kind: it.type,
            a: resolvePoint(it.start, m, dx, dy),
            b: resolvePoint(it.end, m, dx, dy),
            width: it.lineWidth > 0 ? mmToIU(it.lineWidth) : defLineW,
            src,
          });
          break;
        case 'text': {
          const label = i === 0 ? it.text : incrementLabel(it.text, it.incrlabel * i);
          out.push({
            kind: 'text',
            text: resolveDrawingSheetText(label, ctx),
            at: resolvePoint(it.pos, m, dx, dy),
            w: mmToIU(it.fontW > 0 ? it.fontW : s.textW),
            h: mmToIU(it.fontH > 0 ? it.fontH : s.textH),
            thickness: it.lineWidth > 0 ? mmToIU(it.lineWidth) : mmToIU(s.textLineWidth),
            bold: it.bold,
            italic: it.italic,
            hjustify: it.hjustify,
            vjustify: it.vjustify,
            rotate: it.rotate,
            src,
          });
          break;
        }
        case 'polygon': {
          const origin = resolvePoint(it.pos, m, dx, dy);
          const rad = (it.rotate * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // A poly-polygon draws each contour independently, rotated about pos.
          for (const contour of it.contours) {
            const pts = contour.map((p) => {
              const px = mmToIU(p.x);
              const py = mmToIU(p.y);
              return { x: origin.x + px * cos - py * sin, y: origin.y + px * sin + py * cos };
            });
            out.push({ kind: 'poly', pts, width: it.lineWidth > 0 ? mmToIU(it.lineWidth) : defLineW, src });
          }
          break;
        }
        case 'bitmap':
          out.push({
            kind: 'bitmap',
            at: resolvePoint(it.pos, m, dx, dy),
            scale: it.scale,
            pngB64: it.pngB64,
            ppi: it.ppi,
            ...(it.pxW ? { pxW: it.pxW } : {}),
            ...(it.pxH ? { pxH: it.pxH } : {}),
            src,
          });
          break;
      }
    }
  });

  return out;
}
