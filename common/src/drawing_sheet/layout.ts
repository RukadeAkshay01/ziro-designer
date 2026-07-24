/**
 * Drawing-sheet layout resolver: turn corner-anchored millimetre items into
 * concrete IU page geometry for a specific page, mirroring KiCad's
 * DS_DRAW_ITEM_LIST::BuildDrawItemsList + DS_DATA_ITEM::SyncDrawItems
 * (common/drawing_sheet/ds_draw_item.cpp, ds_data_item.cpp).
 *
 * Responsibilities, all from upstream:
 *  - corner anchoring: the four page corners are the margin-box corners, and an
 *    item coordinate is measured *inward* from its anchor corner;
 *  - repeats: an item with `repeat > 1` is emitted per repeat, each copy offset
 *    by (incrx, incry) mm — but a repeat other than the first is dropped when it
 *    falls outside the margin box (DS_DATA_ITEM::IsInsidePage), which is what
 *    clips the `repeat 100` coordinate-band labels at the page edge;
 *  - per-repeat text labels increment via DS_DATA_ITEM_TEXT::IncrementLabel
 *    (last character only), never for multiline texts;
 *  - literal `\n` / `\\` sequences in text become newline / backslash
 *    (ReplaceAntiSlashSequence);
 *  - `maxlen` / `maxheight` shrink the text size proportionally, never grow it
 *    (SetConstrainedTextSize);
 *  - page filtering: `page1only` / `notonpage1` items are dropped as appropriate;
 *  - text variables: `${…}` tokens are expanded against the supplied title-block
 *    / page context.
 */

import { mmToIU } from '../eda_units.js';
import type { Vec2 } from '@ziroeda/kimath';
import { layoutText } from '../font/stroke_font.js';
import type {
  WksSheet,
  WksItem,
  WksText,
  WksPoint,
  WksCorner,
  WksColor,
  WksHJustify,
  WksVJustify,
} from './types.js';

/** Page dimensions in millimetres (landscape/portrait already applied). */
export interface WksPage {
  widthMM: number;
  heightMM: number;
}

/** Values the `${…}` variables and page-number tokens resolve against. */
export interface WksResolveContext {
  /** 1-based sheet ordinal (DS_DRAW_ITEM_LIST m_sheetNumber) — drives the
   *  page1only/notonpage1 item visibility and is the `${#}` fallback. */
  pageNumber?: number;
  /** The page number *string* shown by `${#}` (DS_DRAW_ITEM_LIST
   *  m_pageNumber / SCH_SHEET_PATH::GetPageNumber — may be "A", "ii", …).
   *  Unset = the ordinal. */
  pageName?: string;
  /** Total number of sheets. */
  sheetCount?: number;
  title?: string;
  rev?: string;
  date?: string;
  company?: string;
  comments?: string[];
  /** Paper size string (e.g. "A4"). */
  paper?: string;
  layer?: string;
  fileName?: string;
  sheetName?: string;
  sheetPath?: string;
  appVersion?: string;
  /**
   * When true, leave `${…}` tokens unresolved (the editor's "Show title block
   * in edit mode", where the raw field templates are shown instead of data).
   */
  rawText?: boolean;
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
  /** Font face name; empty/undefined = stroke font. */
  face?: string;
  /** Per-item colour override, if any. */
  color?: WksColor;
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

/** Corner-anchored mm coordinate (+ per-repeat offset) → page-space mm. */
function resolveMM(p: WksPoint, m: Margins, dx: number, dy: number): { x: number; y: number } {
  const x = p.x + dx;
  const y = p.y + dy;
  switch (p.corner as WksCorner) {
    case 'ltcorner':
      return { x: m.left + x, y: m.top + y };
    case 'rtcorner':
      return { x: m.right - x, y: m.top + y };
    case 'lbcorner':
      return { x: m.left + x, y: m.bottom - y };
    default:
      return { x: m.right - x, y: m.bottom - y };
  }
}

const toIU = (p: { x: number; y: number }): Vec2 => ({ x: mmToIU(p.x), y: mmToIU(p.y) });

/** DS_DATA_ITEM::IsInsidePage: point within the margin box (mm)? */
function insidePage(p: { x: number; y: number }, m: Margins): boolean {
  return p.x >= m.left && p.x <= m.right && p.y >= m.top && p.y <= m.bottom;
}

/** Expand `${…}` variables in a template string (title-block text variables). */
export function resolveDrawingSheetText(text: string, ctx: WksResolveContext): string {
  const page = ctx.pageNumber ?? 1;
  const count = ctx.sheetCount ?? 1;
  return text.replace(/\$\{([^}]*)\}/g, (whole, name: string) => {
    const key = name.trim().toUpperCase();
    switch (key) {
      case 'TITLE':
        return ctx.title ?? '';
      case 'REVISION':
        return ctx.rev ?? '';
      case 'ISSUE_DATE':
        return ctx.date ?? '';
      case 'COMPANY':
        return ctx.company ?? '';
      case 'PAPER':
        return ctx.paper ?? '';
      case 'LAYER':
        return ctx.layer ?? '';
      case 'FILENAME':
        return ctx.fileName ?? '';
      case 'SHEETNAME':
        return ctx.sheetName ?? '';
      case 'SHEETPATH':
        return ctx.sheetPath ?? '';
      case 'KICAD_VERSION':
        return ctx.appVersion ?? '';
      case '#':
        return ctx.pageName ?? String(page);
      case '##':
        return String(count);
      default: {
        const cm = /^COMMENT([1-9])$/.exec(key);
        if (cm) return ctx.comments?.[Number(cm[1]) - 1] ?? '';
        return whole; // leave unknown tokens intact, as upstream does
      }
    }
  });
}

/**
 * Increment a text label for a repeat, mirroring DS_DATA_ITEM_TEXT::
 * IncrementLabel: only the LAST character is considered — a digit is replaced
 * by the integer (digit + incr) (so "9" + 1 → "10"), any other character is
 * shifted by code point ("A" → "B").
 */
export function incrementLabel(text: string, incr: number): string {
  if (text === '') return text;
  const last = text[text.length - 1]!;
  const stem = text.slice(0, -1);
  if (last >= '0' && last <= '9') return stem + String(incr + (last.charCodeAt(0) - 48));
  return stem + String.fromCharCode(last.charCodeAt(0) + incr);
}

/**
 * Replace literal `\n` with a newline and `\\` with `\`
 * (DS_DATA_ITEM_TEXT::ReplaceAntiSlashSequence).
 */
export function expandTextEscapes(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      const n = text[i + 1]!;
      if (n === '\\') {
        out += '\\';
        i++;
        continue;
      }
      if (n === 'n') {
        out += '\n';
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Line-pitch factor used for multi-line text height (FONT_METRICS). */
const INTERLINE_PITCH = 1.68;

/**
 * Measure a text's box in mm at a given size (approximating EDA_TEXT::
 * GetTextBox with the stroke font), for the maxlen/maxheight constraint.
 */
function measureTextMM(text: string, wMM: number, hMM: number): { w: number; h: number } {
  const lines = text.split('\n');
  let widest = 0;
  for (const line of lines) {
    const { width } = layoutText(line, hMM);
    if (width > widest) widest = width;
  }
  const scaleX = hMM > 0 ? wMM / hMM : 1;
  const height = hMM + (lines.length - 1) * hMM * INTERLINE_PITCH;
  return { w: widest * scaleX, h: height };
}

/**
 * DS_DATA_ITEM_TEXT::SetConstrainedTextSize: start from the item size (or the
 * setup default), and if the measured box exceeds maxlen/maxheight shrink each
 * axis proportionally. Never grows the text.
 */
export function constrainedTextSize(
  t: WksText,
  fullText: string,
  defaultW: number,
  defaultH: number,
): { w: number; h: number } {
  let w = t.fontW !== 0 ? t.fontW : defaultW;
  let h = t.fontH !== 0 ? t.fontH : defaultH;
  if (t.maxlen > 0 || t.maxheight > 0) {
    const size = measureTextMM(fullText, w, h);
    if (t.maxlen > 0 && size.w > t.maxlen) w *= t.maxlen / size.w;
    if (t.maxheight > 0 && size.h > t.maxheight) h *= t.maxheight / size.h;
  }
  return { w, h };
}

/** GetPenSizeForBold: bold stroke width is size / 5. */
const penSizeForBold = (sizeMM: number): number => sizeMM / 5;

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
    for (let i = 0; i < it.repeat; i++) {
      const dx = it.incrx * i;
      const dy = it.incry * i;
      switch (it.type) {
        case 'line':
        case 'rect': {
          const a = resolveMM(it.start, m, dx, dy);
          const b = resolveMM(it.end, m, dx, dy);
          // Repeats beyond the first are dropped once off the margin box.
          if (i > 0 && !(insidePage(a, m) && insidePage(b, m))) continue;
          out.push({
            kind: it.type,
            a: toIU(a),
            b: toIU(b),
            width: it.lineWidth > 0 ? mmToIU(it.lineWidth) : defLineW,
            src,
          });
          break;
        }
        case 'text': {
          const at = resolveMM(it.pos, m, dx, dy);
          if (i > 0 && !insidePage(at, m)) continue;
          const raw = expandTextEscapes(it.text);
          const multiline = raw.includes('\n');
          const label = i === 0 || multiline ? raw : incrementLabel(raw, it.incrlabel * i);
          const fullText = ctx.rawText ? label : resolveDrawingSheetText(label, ctx);
          const size = constrainedTextSize(it, fullText, s.textW, s.textH);
          const basePen = it.lineWidth > 0 ? it.lineWidth : s.textLineWidth;
          const pen = it.bold ? penSizeForBold(Math.min(size.w, size.h)) : basePen;
          out.push({
            kind: 'text',
            text: fullText,
            at: toIU(at),
            w: mmToIU(size.w),
            h: mmToIU(size.h),
            thickness: mmToIU(pen),
            bold: it.bold,
            italic: it.italic,
            ...(it.face ? { face: it.face } : {}),
            ...(it.color ? { color: it.color } : {}),
            hjustify: it.hjustify,
            vjustify: it.vjustify,
            rotate: it.rotate,
            src,
          });
          break;
        }
        case 'polygon': {
          const origin = resolveMM(it.pos, m, dx, dy);
          if (i > 0 && !insidePage(origin, m)) continue;
          const at = toIU(origin);
          const rad = (it.rotate * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // A poly-polygon draws each contour independently, rotated about pos.
          for (const contour of it.contours) {
            const pts = contour.map((p) => {
              const px = mmToIU(p.x);
              const py = mmToIU(p.y);
              return { x: at.x + px * cos - py * sin, y: at.y + px * sin + py * cos };
            });
            out.push({
              kind: 'poly',
              pts,
              width: it.lineWidth > 0 ? mmToIU(it.lineWidth) : defLineW,
              src,
            });
          }
          break;
        }
        case 'bitmap': {
          const at = resolveMM(it.pos, m, dx, dy);
          if (i > 0 && !insidePage(at, m)) continue;
          out.push({
            kind: 'bitmap',
            at: toIU(at),
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
    }
  });

  return out;
}
