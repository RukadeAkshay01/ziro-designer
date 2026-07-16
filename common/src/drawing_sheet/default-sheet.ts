/**
 * The built-in default drawing sheet, rebuilt as a `WksSheet`.
 *
 * This mirrors the stationery KiCad draws when a project has no custom
 * `.kicad_wks` (common/drawing_sheet/drawing_sheet_default_description.cpp):
 *
 *  - the page border as ONE rect item anchored at the margin corners and
 *    repeated twice with a 2 mm step — the repeat produces the inner border;
 *  - the coordinate reference band on all four edges: tick lines every 50 mm
 *    (repeat 30) and centred labels ("1", "2", … along the top/bottom via the
 *    per-repeat label increment; "A", "B", … down the sides) in 1.3 mm text
 *    (repeat 100 — the page-clip rule stops them at the page edge);
 *  - the 110 × 34 mm title block in the bottom-right corner: separator lines
 *    at 5.5 / 8.5 / 12.5 / 18.5 mm plus two verticals, and the `${…}` variable
 *    text fields (title in 2 mm bold italic, revision/company in bold).
 *
 * Every item keeps the upstream defaults: empty name, all-pages option, and
 * per-field values exactly as the default description defines them.
 */

import {
  DEFAULT_SETUP,
  WKS_FILE_VERSION,
  type WksSheet,
  type WksItem,
  type WksCorner,
  type WksLine,
  type WksRect,
  type WksText,
  type WksHJustify,
  type WksVJustify,
} from './types.js';

/** Item-base defaults: shown on all pages, single instance, unit label step. */
const BASE = {
  name: '',
  option: 'normal' as const,
  repeat: 1,
  incrx: 0,
  incry: 0,
  incrlabel: 1,
  comment: '',
};

interface LineOpts {
  corner?: WksCorner;
  repeat?: number;
  incrx?: number;
  incry?: number;
}

function line(x1: number, y1: number, x2: number, y2: number, o: LineOpts = {}): WksLine {
  const corner = o.corner ?? 'rbcorner';
  return {
    type: 'line',
    ...BASE,
    ...(o.repeat ? { repeat: o.repeat } : {}),
    ...(o.incrx ? { incrx: o.incrx } : {}),
    ...(o.incry ? { incry: o.incry } : {}),
    start: { x: x1, y: y1, corner },
    end: { x: x2, y: y2, corner },
    lineWidth: 0,
  };
}

interface TextOpts {
  corner?: WksCorner;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  hjustify?: WksHJustify;
  vjustify?: WksVJustify;
  repeat?: number;
  incrx?: number;
  incry?: number;
  comment?: string;
}

function text(t: string, x: number, y: number, o: TextOpts = {}): WksText {
  return {
    type: 'text',
    ...BASE,
    ...(o.repeat ? { repeat: o.repeat } : {}),
    ...(o.incrx ? { incrx: o.incrx } : {}),
    ...(o.incry ? { incry: o.incry } : {}),
    ...(o.comment ? { comment: o.comment } : {}),
    text: t,
    pos: { x, y, corner: o.corner ?? 'rbcorner' },
    fontW: o.size ?? 0,
    fontH: o.size ?? 0,
    bold: !!o.bold,
    italic: !!o.italic,
    lineWidth: 0,
    hjustify: o.hjustify ?? 'left',
    vjustify: o.vjustify ?? 'center',
    rotate: 0,
    maxlen: 0,
    maxheight: 0,
  };
}

/** Build a fresh copy of the default drawing sheet. */
export function defaultDrawingSheet(): WksSheet {
  // Title-block frame: bottom-right 110 × 34 mm box.
  const titleBlockRect: WksRect = {
    type: 'rect',
    ...BASE,
    comment: 'rect around the title block',
    start: { x: 110, y: 34, corner: 'rbcorner' },
    end: { x: 2, y: 2, corner: 'rbcorner' },
    lineWidth: 0,
  };
  // Page border: one rect repeated twice — the 2 mm step draws the inner border.
  const border: WksRect = {
    type: 'rect',
    ...BASE,
    repeat: 2,
    incrx: 2,
    incry: 2,
    start: { x: 0, y: 0, corner: 'ltcorner' },
    end: { x: 0, y: 0, corner: 'rbcorner' },
    lineWidth: 0,
  };

  const items: WksItem[] = [
    titleBlockRect,
    border,
    // Coordinate band: ticks + incrementing labels, clipped by the page edge.
    line(50, 2, 50, 0, { corner: 'ltcorner', repeat: 30, incrx: 50 }),
    text('1', 25, 1, { corner: 'ltcorner', size: 1.3, repeat: 100, incrx: 50 }),
    line(50, 2, 50, 0, { corner: 'lbcorner', repeat: 30, incrx: 50 }),
    text('1', 25, 1, { corner: 'lbcorner', size: 1.3, repeat: 100, incrx: 50 }),
    line(0, 50, 2, 50, { corner: 'ltcorner', repeat: 30, incry: 50 }),
    text('A', 1, 25, {
      corner: 'ltcorner',
      size: 1.3,
      hjustify: 'center',
      repeat: 100,
      incry: 50,
    }),
    line(0, 50, 2, 50, { corner: 'rtcorner', repeat: 30, incry: 50 }),
    text('A', 1, 25, {
      corner: 'rtcorner',
      size: 1.3,
      hjustify: 'center',
      repeat: 100,
      incry: 50,
    }),
    // Title block fields and separators.
    text('Date: ${ISSUE_DATE}', 87, 6.9),
    line(110, 5.5, 2, 5.5),
    text('${KICAD_VERSION}', 109, 4.1, { comment: 'Kicad version' }),
    line(110, 8.5, 2, 8.5),
    text('Rev: ${REVISION}', 24, 6.9, { bold: true }),
    text('Size: ${PAPER}', 109, 6.9, { comment: 'Paper format name' }),
    text('Id: ${#}/${##}', 24, 4.1, { comment: 'Sheet id' }),
    line(110, 12.5, 2, 12.5),
    text('Title: ${TITLE}', 109, 10.7, { size: 2, bold: true, italic: true }),
    text('File: ${FILENAME}', 109, 14.3),
    line(110, 18.5, 2, 18.5),
    text('Sheet: ${SHEETPATH}', 109, 17),
    text('${COMPANY}', 109, 20, { bold: true, comment: 'Company name' }),
    text('${COMMENT1}', 109, 23, { comment: 'Comment 0' }),
    text('${COMMENT2}', 109, 26, { comment: 'Comment 1' }),
    text('${COMMENT3}', 109, 29, { comment: 'Comment 2' }),
    text('${COMMENT4}', 109, 32, { comment: 'Comment 3' }),
    line(90, 8.5, 90, 5.5),
    line(26, 8.5, 26, 2),
  ];

  return {
    version: WKS_FILE_VERSION,
    generator: 'pl_editor',
    setup: { ...DEFAULT_SETUP },
    items,
  };
}

/**
 * The "empty" drawing sheet: like upstream's emptyDrawingSheet it still holds
 * one zero-length line (`segm1:Line`) so the model is never itemless.
 */
export function emptyDrawingSheet(): WksSheet {
  return {
    version: WKS_FILE_VERSION,
    generator: 'pl_editor',
    setup: { ...DEFAULT_SETUP },
    items: [{ ...line(0, 0, 0, 0), name: 'segm1:Line' }],
  };
}
