/**
 * `.kicad_wks` reader: parse a drawing-sheet S-expression into a `WksSheet`.
 *
 * Mirrors KiCad's DRAWING_SHEET_PARSER (common/drawing_sheet/
 * drawing_sheet_parser.cpp). Item heads are `line`, `rect`, `tbtext`,
 * `polygon`, `bitmap`; a coordinate is `(start|end|pos X Y [corner])` with the
 * corner defaulting to `rbcorner` exactly as the upstream reader does when the
 * anchor token is omitted.
 *
 * Format notes (all from the upstream parser):
 *  - text justification defaults to LEFT / CENTER; the `center` token inside
 *    `(justify …)` sets BOTH axes to center, `left`/`right`/`top`/`bottom`
 *    set one axis each;
 *  - `(font …)` carries bare `bold` / `italic` atoms (not `(bold yes)` lists —
 *    those are accepted leniently for older third-party writers), plus
 *    `(face NAME)`, `(size W H)`, `(linewidth W)` and `(color R G B A)`;
 *  - bitmap image data is base64 `(data "…" "…")` chunks directly under the
 *    `bitmap` node (files ≥ 20230607), with the legacy hex
 *    `(pngdata (data "…") …)` form still readable;
 *  - `(repeat N)` is clamped to 1..100.
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
  type WksColor,
  type WksHJustify,
  type WksVJustify,
  type WksXY,
  type WksOption,
} from './types.js';

const CORNERS = new Set<WksCorner>(['ltcorner', 'rtcorner', 'lbcorner', 'rbcorner']);

function readCorner(token: string | undefined): WksCorner {
  return token && CORNERS.has(token as WksCorner) ? (token as WksCorner) : 'rbcorner';
}

/** `(start X Y [corner])` → point; corner defaults to rbcorner (upstream default). */
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
  // parseInt(1, 100): the repeat count is clamped, not rejected.
  const repeat = Math.min(100, Math.max(1, Math.round(numChild(node, 'repeat', 1))));
  return {
    name: (name && arg(name, 0)) || '',
    option: readOption(node),
    repeat,
    incrx: numChild(node, 'incrx', 0),
    incry: numChild(node, 'incry', 0),
    incrlabel: numChild(node, 'incrlabel', 1),
    comment: (comment && arg(comment, 0)) || '',
  };
}

/**
 * `(justify …)` tokens. Defaults are LEFT / CENTER (DS_DATA_ITEM_TEXT ctor);
 * `center` centers both axes, the other tokens set one axis each.
 */
function readJustify(node: SList): { h: WksHJustify; v: WksVJustify } {
  let h: WksHJustify = 'left';
  let v: WksVJustify = 'center';
  const j = childNamed(node, 'justify');
  for (const token of j ? args(j) : []) {
    if (token === 'center') {
      h = 'center';
      v = 'center';
    } else if (token === 'left') h = 'left';
    else if (token === 'right') h = 'right';
    else if (token === 'top') v = 'top';
    else if (token === 'bottom') v = 'bottom';
  }
  return { h, v };
}

/** A bare atom child (`bold`) or a lenient `(bold yes)` list from older writers. */
function fontFlag(font: SList, name: string): boolean {
  for (const child of font.items.slice(1)) {
    if (!isList(child)) {
      if (child.kind === 'atom' && child.value === name) return true;
    } else if (head(child) === name) {
      return arg(child, 0) !== 'no';
    }
  }
  return false;
}

const HEX_RE = /^[0-9a-fA-F\s]+$/;
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hex payload (legacy `pngdata`) → base64, so the model always stores base64. */
function hexToBase64(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2]! + B64_ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 63]!;
  }
  return out;
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
    const faceN = font && childNamed(font, 'face');
    const colorN = font && childNamed(font, 'color');
    const flw = font && childNamed(font, 'linewidth');
    const { h, v } = readJustify(node);
    const rot = childNamed(node, 'rotate');
    const maxlen = childNamed(node, 'maxlen');
    const maxheight = childNamed(node, 'maxheight');
    let color: WksColor | undefined;
    if (colorN) {
      color = {
        r: Math.min(255, Math.max(0, numArg(colorN, 0) ?? 0)),
        g: Math.min(255, Math.max(0, numArg(colorN, 1) ?? 0)),
        b: Math.min(255, Math.max(0, numArg(colorN, 2) ?? 0)),
        a: Math.min(1, Math.max(0, numArg(colorN, 3) ?? 1)),
      };
    }
    const face = faceN ? arg(faceN, 0) : undefined;
    return {
      type: 'text',
      ...base,
      text,
      pos: pos ? readPoint(pos) : { x: 0, y: 0, corner: 'rbcorner' },
      fontW: size ? (numArg(size, 0) ?? 0) : 0,
      fontH: size ? (numArg(size, 1) ?? 0) : 0,
      bold: !!font && fontFlag(font, 'bold'),
      italic: !!font && fontFlag(font, 'italic'),
      ...(face ? { face } : {}),
      ...(color ? { color } : {}),
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
    let b64 = '';
    let ppi = 300;
    // Current format: base64 chunks in (data "…" "…") directly under bitmap.
    const data = childNamed(node, 'data');
    if (data) {
      b64 = args(data).join('');
    } else {
      // Legacy: (pngdata (data "hex line") … ) — 32 hex bytes per line; also
      // tolerate a (ppi N) child written by some historic exporters.
      const png = childNamed(node, 'pngdata');
      if (png) {
        let hex = '';
        for (const d of childrenNamed(png, 'data')) hex += (arg(d, 0) ?? '').replace(/\s+/g, '');
        if (hex && HEX_RE.test(hex)) b64 = hexToBase64(hex);
        ppi = numChild(png, 'ppi', 300);
      }
    }
    return {
      type: 'bitmap',
      ...base,
      pos: pos ? readPoint(pos) : { x: 0, y: 0, corner: 'rbcorner' },
      scale: numChild(node, 'scale', 1),
      pngB64: b64,
      ppi,
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
