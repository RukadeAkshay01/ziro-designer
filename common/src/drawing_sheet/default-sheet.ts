/**
 * KiCad's built-in default drawing sheet, rebuilt as a `WksSheet`.
 *
 * This mirrors the layout KiCad draws when a project has no custom `.kicad_wks`
 * (common/drawing_sheet/drawing_sheet_default_description.cpp): the margin
 * border, a second border 2 mm inside, and the 110 × 34 mm title block in the
 * bottom-right corner whose fields are `${…}` variables resolved from the
 * project's title block. `pl_editor`'s File → New produces exactly this.
 */

import {
  DEFAULT_SETUP,
  WKS_FILE_VERSION,
  type WksSheet,
  type WksItem,
  type WksLine,
  type WksRect,
  type WksText,
  type WksHJustify,
  type WksVJustify,
} from './types.js';

/** All items default to: normal option, no repeat, unit label increment. */
const NOREP = {
  option: 'normal' as const,
  repeat: 1,
  incrx: 0,
  incry: 0,
  incrlabel: 1,
  comment: '',
};

function rbLine(name: string, x1: number, y1: number, x2: number, y2: number): WksLine {
  return {
    type: 'line',
    name,
    ...NOREP,
    start: { x: x1, y: y1, corner: 'rbcorner' },
    end: { x: x2, y: y2, corner: 'rbcorner' },
    lineWidth: 0,
  };
}

function rbText(
  name: string,
  text: string,
  x: number,
  y: number,
  size: number,
  h: WksHJustify,
  opts: { bold?: boolean } = {},
): WksText {
  return {
    type: 'text',
    name,
    ...NOREP,
    text,
    pos: { x, y, corner: 'rbcorner' },
    fontW: size,
    fontH: size,
    bold: !!opts.bold,
    italic: false,
    lineWidth: 0,
    hjustify: h,
    vjustify: 'center' as WksVJustify,
    rotate: 0,
    maxlen: 0,
    maxheight: 0,
  };
}

/** Build a fresh copy of the KiCad default drawing sheet. */
export function defaultDrawingSheet(): WksSheet {
  const border: WksRect = {
    type: 'rect',
    name: 'border',
    ...NOREP,
    start: { x: 0, y: 0, corner: 'ltcorner' },
    end: { x: 0, y: 0, corner: 'rbcorner' },
    lineWidth: 0,
  };
  const innerBorder: WksRect = {
    type: 'rect',
    name: 'inner border',
    ...NOREP,
    start: { x: 2, y: 2, corner: 'ltcorner' },
    end: { x: 2, y: 2, corner: 'rbcorner' },
    lineWidth: 0,
  };
  const tbRect: WksRect = {
    type: 'rect',
    name: 'title block',
    ...NOREP,
    start: { x: 110, y: 34, corner: 'rbcorner' },
    end: { x: 2, y: 2, corner: 'rbcorner' },
    lineWidth: 0,
  };

  const items: WksItem[] = [
    border,
    innerBorder,
    tbRect,
    // Title-block separator lines (mm up from the bottom-right margin corner).
    rbLine('sep 1', 110, 5.5, 2, 5.5),
    rbLine('sep 2', 110, 8.5, 2, 8.5),
    rbLine('sep 3', 110, 12.5, 2, 12.5),
    rbLine('sep 4', 110, 18.5, 2, 18.5),
    rbLine('sep 5', 90, 8.5, 90, 5.5),
    rbLine('sep 6', 26, 8.5, 26, 2),
    // Title-block fields — static labels plus their `${…}` value tokens.
    rbText('date', 'Date: ${ISSUE_DATE}', 87, 6.9, 1.5, 'left'),
    rbText('kicad version', '${KICAD_VERSION}', 109, 4.1, 1.5, 'left'),
    rbText('rev', 'Rev: ${REVISION}', 24, 6.9, 1.5, 'left', { bold: true }),
    rbText('size', 'Size: ${PAPER}', 109, 6.9, 1.5, 'left'),
    rbText('sheet number', 'Id: ${#}/${##}', 24, 4.1, 1.5, 'left'),
    rbText('title', 'Title: ${TITLE}', 109, 10.7, 2.0, 'left', { bold: true }),
    rbText('file', 'File: ${FILENAME}', 109, 14.3, 1.5, 'left'),
    rbText('sheet path', 'Sheet: ${SHEETPATH}', 109, 17, 1.5, 'left'),
    rbText('company', '${COMPANY}', 109, 20, 1.5, 'left', { bold: true }),
    rbText('comment 1', '${COMMENT1}', 109, 23, 1.5, 'left'),
    rbText('comment 2', '${COMMENT2}', 109, 26, 1.5, 'left'),
    rbText('comment 3', '${COMMENT3}', 109, 29, 1.5, 'left'),
    rbText('comment 4', '${COMMENT4}', 109, 32, 1.5, 'left'),
  ];

  return {
    version: WKS_FILE_VERSION,
    generator: 'pl_editor',
    setup: { ...DEFAULT_SETUP },
    items,
  };
}

/** An empty drawing sheet (File → New with everything cleared). */
export function emptyDrawingSheet(): WksSheet {
  return {
    version: WKS_FILE_VERSION,
    generator: 'pl_editor',
    setup: { ...DEFAULT_SETUP },
    items: [],
  };
}
