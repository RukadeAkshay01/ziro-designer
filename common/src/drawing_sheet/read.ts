/**
 * `.kicad_wks` reader: parse a drawing-sheet S-expression into a `WksSheet`.
 *
 * Mirrors KiCad's DRAWING_SHEET_READER_PARSER (common/drawing_sheet/
 * drawing_sheet_reader_keywords / ds_data_model_io.cpp). Item heads are
 * `line`, `rect`, `tbtext`, `polygon`, `bitmap`; a coordinate is
 * `(start|end|pos X Y [corner])` with the corner defaulting to `rbcorner`
 * exactly as KiCad's reader does when the anchor token is omitted.
 */

import { parse } from '@ziroeda/sexpr/src/parser.js';
import { childNamed, childrenNamed, args, arg, numArg } from '@ziroeda/sexpr/src/query.js';
import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import {
  DEFAULT_SETUP,
  WKS_FILE_VERSION,
  type WksSheet,
  type WksItem,
  type WksSetup,
  type WksPoint,
  type WksCorner,
  type WksHJustify,
  type WksVJustify,
  type WksXY,
  type WksOption,
} from './types.js';

const CORNERS = new Set<WksCorner>(['ltcorner', 'rtcorner', 'lbcorner', 'rbcorner']);

function readCorner(token: string | undefined): WksCorner {
  return token && CORNERS.has(token as WksCorner) ? (token as WksCorner) : 'rbcorner';
}

/** `(start X Y [corner])` → point; corner defaults to rbcorner (KiCad's default). */
function readPoint(node: SList): WksPoint {
  const a = args(node);
  return { x: Number(a[0] ?? 0), y: Number(a[1] ?? 0), corner: readCorner(a[2]) };
}

function readOption(node: SList): WksOption {
  const opt = childNamed(node, 'option');
  const v = opt ? arg(opt, 0) : undefined;
  return v === 'page1only' || v === 'notonpage1' ? v : 'normal';
}

/** Read a named child's first numeric arg, or `fallback` when the child is absent. */
function numChild(node: SList, name: string, fallback: number): number {
  const c = childNamed(node, name);
  return c ? (numArg(c, 0) ?? fallback) : fallback;
}

/** Shared DS_DATA_ITEM fields (name, option, repeat, increments, comment). */
function readBase(node: SList): {
  name: string;
  option: WksOption;
  repeat: number;
  incrx: number;
  incry: number;
  incrlabel: number;
  comment: string;
} {
  const name = childNamed(node, 'name');
  const comment = childNamed(node, 'comment');
  return {
    name: (name && arg(name, 0)) || '',
    option: readOption(node),
    repeat: Math.max(1, numChild(node, 'repeat', 1)),
    incrx: numChild(node, 'incrx', 0),
    incry: numChild(node, 'incry', 0),
    incrlabel: numChild(node, 'incrlabel', 1),
    comment: (comment && arg(comment, 0)) || '',
  };
}

function readJustify(node: SList): { h: WksHJustify; v: WksVJustify } {
  const j = childNamed(node, 'justify');
  const tokens = j ? args(j) : [];
  const h: WksHJustify = tokens.includes('left')
    ? 'left'
    : tokens.includes('right')
      ? 'right'
      : 'center';
  const v: WksVJustify = tokens.includes('top')
    ? 'top'
    : tokens.includes('bottom')
      ? 'bottom'
      : 'center';
  return { h, v };
}

function readItem(node: SList): WksItem | null {
  const kind = head(node);
  const base = readBase(node);

  if (kind === 'line' || kind === 'rect') {
    const s = childNamed(node, 'start');
    const e = childNamed(node, 'end');
    const lw = childNamed(node, 'linewidth');
    return {
      type: kind === 'line' ? 'line' : 'rect',
      ...base,
      start: s ? readPoint(s) : { x: 0, y: 0, corner: 'rbcorner' },
      end: e ? readPoint(e) : { x: 0, y: 0, corner: 'rbcorner' },
      lineWidth: lw ? (numArg(lw, 0) ?? 0) : 0,
    } as WksItem;
  }

  if (kind === 'tbtext') {
    // The text string is the first non-list positional argument after the head.
    const text = args(node)[0] ?? '';
    const pos = childNamed(node, 'pos');
    const font = childNamed(node, 'font');
    const size = font && childNamed(font, 'size');
    const boldN = font && childNamed(font, 'bold');
    const italN = font && childNamed(font, 'italic');
    const flw = font && childNamed(font, 'linewidth');
    const { h, v } = readJustify(node);
    const rot = childNamed(node, 'rotate');
    const maxlen = childNamed(node, 'maxlen');
    const maxheight = childNamed(node, 'maxheight');
    return {
      type: 'text',
      ...base,
      text,
      pos: pos ? readPoint(pos) : { x: 0, y: 0, corner: 'rbcorner' },
      fontW: size ? (numArg(size, 0) ?? 0) : 0,
      fontH: size ? (numArg(size, 1) ?? 0) : 0,
      bold: !!boldN && arg(boldN, 0) !== 'no',
      italic: !!italN && arg(italN, 0) !== 'no',
      lineWidth: flw ? (numArg(flw, 0) ?? 0) : 0,
      hjustify: h,
      vjustify: v,
      rotate: rot ? (numArg(rot, 0) ?? 0) : 0,
      maxlen: maxlen ? (numArg(maxlen, 0) ?? 0) : 0,
      maxheight: maxheight ? (numArg(maxheight, 0) ?? 0) : 0,
    };
  }

  if (kind === 'polygon') {
    const pos = childNamed(node, 'pos');
    const rot = childNamed(node, 'rotate');
    const lw = childNamed(node, 'linewidth');
    const contours: WksXY[][] = [];
    for (const ptsNode of childrenNamed(node, 'pts')) {
      const contour: WksXY[] = [];
      for (const xy of childrenNamed(ptsNode, 'xy')) {
        contour.push({ x: numArg(xy, 0) ?? 0, y: numArg(xy, 1) ?? 0 });
      }
      if (contour.length > 0) contours.push(contour);
    }
    return {
      type: 'polygon',
      ...base,
      pos: pos ? readPoint(pos) : { x: 0, y: 0, corner: 'rbcorner' },
      rotate: rot ? (numArg(rot, 0) ?? 0) : 0,
      lineWidth: lw ? (numArg(lw, 0) ?? 0) : 0,
      contours,
    };
  }

  if (kind === 'bitmap') {
    const pos = childNamed(node, 'pos');
    // pngdata is a set of hex `(data "..")` lines; keep the concatenated hex.
    let hex = '';
    const png = childNamed(node, 'pngdata');
    if (png)
      for (const d of childrenNamed(png, 'data')) hex += (arg(d, 0) ?? '').replace(/\s+/g, '');
    return {
      type: 'bitmap',
      ...base,
      pos: pos ? readPoint(pos) : { x: 0, y: 0, corner: 'rbcorner' },
      scale: numChild(node, 'scale', 1),
      pngB64: hex,
      ppi: png ? numChild(png, 'ppi', 300) : 300,
    };
  }

  return null;
}

function readSetup(node: SList | undefined): WksSetup {
  if (!node) return { ...DEFAULT_SETUP };
  const ts = childNamed(node, 'textsize');
  const num = (name: string, fallback: number): number => {
    const c = childNamed(node, name);
    return c ? (numArg(c, 0) ?? fallback) : fallback;
  };
  return {
    textW: ts ? (numArg(ts, 0) ?? DEFAULT_SETUP.textW) : DEFAULT_SETUP.textW,
    textH: ts ? (numArg(ts, 1) ?? DEFAULT_SETUP.textH) : DEFAULT_SETUP.textH,
    lineWidth: num('linewidth', DEFAULT_SETUP.lineWidth),
    textLineWidth: num('textlinewidth', DEFAULT_SETUP.textLineWidth),
    leftMargin: num('left_margin', DEFAULT_SETUP.leftMargin),
    rightMargin: num('right_margin', DEFAULT_SETUP.rightMargin),
    topMargin: num('top_margin', DEFAULT_SETUP.topMargin),
    bottomMargin: num('bottom_margin', DEFAULT_SETUP.bottomMargin),
  };
}

/** Parse a `.kicad_wks` document (root `(kicad_wks …)`) into a `WksSheet`. */
export function readDrawingSheet(root: SList): WksSheet {
  if (head(root) !== 'kicad_wks') {
    throw new Error(`readDrawingSheet: expected (kicad_wks …), got (${head(root) ?? '?'} …)`);
  }
  const version = numArg(childNamed(root, 'version') ?? root, 0);
  const gen = childNamed(root, 'generator');
  const items: WksItem[] = [];
  for (const child of root.items) {
    if (!isList(child)) continue;
    const h = head(child);
    if (h === 'line' || h === 'rect' || h === 'tbtext' || h === 'polygon' || h === 'bitmap') {
      const it = readItem(child);
      if (it) items.push(it);
    }
  }
  return {
    version: childNamed(root, 'version') ? (version ?? WKS_FILE_VERSION) : WKS_FILE_VERSION,
    generator: (gen && arg(gen, 0)) || 'pl_editor',
    setup: readSetup(childNamed(root, 'setup')),
    items,
  };
}

/** Convenience: parse `.kicad_wks` source text straight to a `WksSheet`. */
export function parseDrawingSheet(text: string): WksSheet {
  return readDrawingSheet(parse(text));
}
