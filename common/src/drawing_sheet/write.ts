/**
 * `.kicad_wks` writer: serialize a `WksSheet` back to drawing-sheet source text.
 *
 * Mirrors KiCad's DS_DATA_MODEL::SaveInString / Format (ds_data_model_io.cpp):
 * heads are `line`/`rect`/`tbtext`/`polygon`/`bitmap`, coordinates are written
 * `(start X Y corner)` (the corner token is emitted only when it is not the
 * default `rbcorner`, exactly as KiCad omits it), and optional fields are only
 * written when they differ from the model defaults. This is a semantic
 * serializer (KiCad-loadable), not a byte-preserving round-trip.
 */

import { list, atom, str, type SNode, type SList } from '@ziroeda/sexpr/src/types.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import {
  WKS_FILE_VERSION,
  type WksSheet,
  type WksItem,
  type WksPoint,
  type WksText,
  type WksItemBase,
} from './types.js';

const A = atom;
const S = str;

/** `(name value)` with a numeric value, formatted without trailing noise. */
function numNode(name: string, value: number): SList {
  // Keep small decimals tidy (KiCad writes plain decimals like `1.5`, `0.15`).
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  return list(A(name), A(text));
}

function pointNode(name: string, p: WksPoint): SList {
  const items: SNode[] = [A(name), A(fmt(p.x)), A(fmt(p.y))];
  if (p.corner !== 'rbcorner') items.push(A(p.corner));
  return list(...items);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

/** Shared trailing fields (option, repeat, increments, comment), in KiCad's order. */
function baseNodes(base: WksItemBase): SNode[] {
  const out: SNode[] = [];
  if (base.option !== 'normal') out.push(list(A('option'), A(base.option)));
  if (base.repeat > 1) {
    out.push(numNode('repeat', base.repeat));
    if (base.incrx !== 0) out.push(numNode('incrx', base.incrx));
    if (base.incry !== 0) out.push(numNode('incry', base.incry));
    if (base.incrlabel !== 1) out.push(numNode('incrlabel', base.incrlabel));
  }
  if (base.comment) out.push(list(A('comment'), S(base.comment)));
  return out;
}

function fontNode(t: WksText): SList | null {
  const items: SNode[] = [A('font')];
  let any = false;
  if (t.fontW > 0 || t.fontH > 0) {
    items.push(list(A('size'), A(fmt(t.fontH || t.fontW)), A(fmt(t.fontW || t.fontH))));
    any = true;
  }
  if (t.bold) {
    items.push(list(A('bold'), A('yes')));
    any = true;
  }
  if (t.italic) {
    items.push(list(A('italic'), A('yes')));
    any = true;
  }
  if (t.lineWidth > 0) {
    items.push(numNode('linewidth', t.lineWidth));
    any = true;
  }
  return any ? list(...items) : null;
}

function justifyNode(t: WksText): SList | null {
  const tokens: string[] = [];
  if (t.hjustify !== 'center') tokens.push(t.hjustify);
  if (t.vjustify !== 'center') tokens.push(t.vjustify);
  return tokens.length ? list(A('justify'), ...tokens.map(A)) : null;
}

function itemNode(it: WksItem): SList {
  const nameNode = list(A('name'), S(it.name));
  switch (it.type) {
    case 'line':
    case 'rect': {
      const items: SNode[] = [
        A(it.type),
        nameNode,
        pointNode('start', it.start),
        pointNode('end', it.end),
      ];
      if (it.lineWidth > 0) items.push(numNode('linewidth', it.lineWidth));
      items.push(...baseNodes(it));
      return list(...items);
    }
    case 'text': {
      const items: SNode[] = [A('tbtext'), S(it.text), nameNode, pointNode('pos', it.pos)];
      const font = fontNode(it);
      if (font) items.push(font);
      const just = justifyNode(it);
      if (just) items.push(just);
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      if (it.maxlen > 0) items.push(numNode('maxlen', it.maxlen));
      if (it.maxheight > 0) items.push(numNode('maxheight', it.maxheight));
      items.push(...baseNodes(it));
      return list(...items);
    }
    case 'polygon': {
      const items: SNode[] = [A('polygon'), nameNode, pointNode('pos', it.pos)];
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      if (it.lineWidth > 0) items.push(numNode('linewidth', it.lineWidth));
      items.push(...baseNodes(it));
      for (const contour of it.contours) {
        items.push(list(A('pts'), ...contour.map((p) => list(A('xy'), A(fmt(p.x)), A(fmt(p.y))))));
      }
      return list(...items);
    }
    case 'bitmap': {
      const items: SNode[] = [
        A('bitmap'),
        nameNode,
        pointNode('pos', it.pos),
        numNode('scale', it.scale),
      ];
      items.push(...baseNodes(it));
      if (it.pngB64) {
        // Emit the stored hex payload back as a single data chunk.
        items.push(list(A('pngdata'), list(A('data'), S(it.pngB64))));
      }
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
  return list(
    A('kicad_wks'),
    list(A('version'), A(String(sheet.version || WKS_FILE_VERSION))),
    list(A('generator'), S(sheet.generator || 'pl_editor')),
    setup,
    ...sheet.items.map(itemNode),
  );
}

/** Serialize a `WksSheet` to `.kicad_wks` text. */
export function serializeDrawingSheet(sheet: WksSheet): string {
  return serialize(writeDrawingSheet(sheet));
}
