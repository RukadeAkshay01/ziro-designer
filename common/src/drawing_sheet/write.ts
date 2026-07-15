/**
 * `.kicad_wks` writer: serialize a `WksSheet` back to drawing-sheet source text.
 *
 * Mirrors KiCad's DS_DATA_MODEL_IO (common/drawing_sheet/ds_data_model_io.cpp):
 * same node heads, same field order and the same emit-only-when-non-default
 * rules, so output loads identically in upstream tools:
 *  - root carries `(version …) (generator "pl_editor") (generator_version "…")`;
 *  - a coordinate corner token is written only when it is not `rbcorner`;
 *  - `(justify …)` is written when hjustify ≠ left OR vjustify ≠ center;
 *  - font `bold` / `italic` are bare atoms; `(face …)`, `(size W H)`,
 *    `(linewidth …)` and `(color R G B A)` appear only when set;
 *  - a line/rect `linewidth` is skipped when zero or equal to the setup default;
 *  - `(incrlabel …)` is written only for text items and only when ≠ 1;
 *  - bitmaps with no image payload are not written at all, and image bytes go
 *    out as base64 `(data "…" "…")` chunks.
 */

import { list, atom, str, type SNode, type SList } from '@ziroeda/sexpr/src/types.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import {
  WKS_FILE_VERSION,
  WKS_GENERATOR_VERSION,
  type WksSheet,
  type WksItem,
  type WksPoint,
  type WksText,
  type WksItemBase,
} from './types.js';

const A = atom;
const S = str;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

/** `(name value)` with a numeric value, formatted without trailing noise. */
function numNode(name: string, value: number): SList {
  return list(A(name), A(fmt(value)));
}

function pointNode(name: string, p: WksPoint): SList {
  const items: SNode[] = [A(name), A(fmt(p.x)), A(fmt(p.y))];
  if (p.corner !== 'rbcorner') items.push(A(p.corner));
  return list(...items);
}

/** `(option page1only|notonpage1)`, only when not shown on all pages. */
function optionNode(base: WksItemBase): SNode[] {
  return base.option !== 'normal' ? [list(A('option'), A(base.option))] : [];
}

/** `(repeat N) (incrx …) (incry …) [(incrlabel …)]` — formatRepeatParameters. */
function repeatNodes(base: WksItemBase, isText: boolean): SNode[] {
  if (base.repeat <= 1) return [];
  const out: SNode[] = [numNode('repeat', base.repeat)];
  if (base.incrx !== 0) out.push(numNode('incrx', base.incrx));
  if (base.incry !== 0) out.push(numNode('incry', base.incry));
  if (isText && base.incrlabel !== 1) out.push(numNode('incrlabel', base.incrlabel));
  return out;
}

function commentNode(base: WksItemBase): SNode[] {
  return base.comment ? [list(A('comment'), S(base.comment))] : [];
}

function fontNode(t: WksText): SList | null {
  const items: SNode[] = [A('font')];
  let any = false;
  if (t.face) {
    items.push(list(A('face'), S(t.face)));
    any = true;
  }
  if (t.lineWidth > 0) {
    items.push(numNode('linewidth', t.lineWidth));
    any = true;
  }
  if (t.fontW !== 0 || t.fontH !== 0) {
    items.push(list(A('size'), A(fmt(t.fontW)), A(fmt(t.fontH))));
    any = true;
  }
  if (t.bold) {
    items.push(A('bold'));
    any = true;
  }
  if (t.italic) {
    items.push(A('italic'));
    any = true;
  }
  if (t.color) {
    items.push(
      list(
        A('color'),
        A(String(Math.round(t.color.r))),
        A(String(Math.round(t.color.g))),
        A(String(Math.round(t.color.b))),
        A(fmt(t.color.a)),
      ),
    );
    any = true;
  }
  return any ? list(...items) : null;
}

/** Written when hjustify ≠ left or vjustify ≠ center (the model defaults). */
function justifyNode(t: WksText): SList | null {
  if (t.hjustify === 'left' && t.vjustify === 'center') return null;
  const tokens: string[] = [];
  if (t.hjustify === 'center') tokens.push('center');
  else if (t.hjustify === 'right') tokens.push('right');
  if (t.vjustify === 'top') tokens.push('top');
  else if (t.vjustify === 'bottom') tokens.push('bottom');
  return list(A('justify'), ...tokens.map(A));
}

/** Base64 payload → `(data "chunk" "chunk" …)`, 76 chars per chunk. */
function dataNode(b64: string): SList {
  const chunks: SNode[] = [A('data')];
  for (let i = 0; i < b64.length; i += 76) chunks.push(S(b64.slice(i, i + 76)));
  return list(...chunks);
}

function itemNode(it: WksItem, defaultLineWidth: number): SList | null {
  const nameNode = list(A('name'), S(it.name));
  switch (it.type) {
    case 'line':
    case 'rect': {
      const items: SNode[] = [
        A(it.type),
        nameNode,
        pointNode('start', it.start),
        pointNode('end', it.end),
        ...optionNode(it),
      ];
      if (it.lineWidth !== 0 && it.lineWidth !== defaultLineWidth) {
        items.push(numNode('linewidth', it.lineWidth));
      }
      items.push(...repeatNodes(it, false), ...commentNode(it));
      return list(...items);
    }
    case 'text': {
      const items: SNode[] = [
        A('tbtext'),
        S(it.text),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
      ];
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      const font = fontNode(it);
      if (font) items.push(font);
      const just = justifyNode(it);
      if (just) items.push(just);
      if (it.maxlen !== 0) items.push(numNode('maxlen', it.maxlen));
      if (it.maxheight !== 0) items.push(numNode('maxheight', it.maxheight));
      items.push(...repeatNodes(it, true), ...commentNode(it));
      return list(...items);
    }
    case 'polygon': {
      const items: SNode[] = [
        A('polygon'),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
        ...repeatNodes(it, false),
      ];
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      if (it.lineWidth !== 0) items.push(numNode('linewidth', it.lineWidth));
      items.push(...commentNode(it));
      for (const contour of it.contours) {
        items.push(list(A('pts'), ...contour.map((p) => list(A('xy'), A(fmt(p.x)), A(fmt(p.y))))));
      }
      return list(...items);
    }
    case 'bitmap': {
      // Upstream refuses to save a bitmap without image data.
      if (!it.pngB64) return null;
      const items: SNode[] = [
        A('bitmap'),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
        numNode('scale', it.scale),
        ...repeatNodes(it, false),
        ...commentNode(it),
        dataNode(it.pngB64),
      ];
      return list(...items);
    }
  }
}

/** Build the `(kicad_wks …)` AST for a sheet. */
export function writeDrawingSheet(sheet: WksSheet): SList {
  const s = sheet.setup;
  const setup = list(
    A('setup'),
    list(A('textsize'), A(fmt(s.textW)), A(fmt(s.textH))),
    numNode('linewidth', s.lineWidth),
    numNode('textlinewidth', s.textLineWidth),
    numNode('left_margin', s.leftMargin),
    numNode('right_margin', s.rightMargin),
    numNode('top_margin', s.topMargin),
    numNode('bottom_margin', s.bottomMargin),
  );
  const items = sheet.items
    .map((it) => itemNode(it, s.lineWidth))
    .filter((n): n is SList => n !== null);
  return list(
    A('kicad_wks'),
    list(A('version'), A(String(WKS_FILE_VERSION))),
    list(A('generator'), S('pl_editor')),
    list(A('generator_version'), S(WKS_GENERATOR_VERSION)),
    setup,
    ...items,
  );
}

/** Serialize a `WksSheet` to `.kicad_wks` text. */
export function serializeDrawingSheet(sheet: WksSheet): string {
  return serialize(writeDrawingSheet(sheet));
}
