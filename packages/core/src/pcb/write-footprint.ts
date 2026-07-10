/**
 * Writer: typed PcbFootprint model -> S-expression AST -> `.kicad_mod` text.
 *
 * The faithful counterpart to KiCad's `PCB_IO_KICAD_SEXPR::format( const
 * FOOTPRINT* )` and the per-item `format()` overloads for PAD / PCB_SHAPE /
 * PCB_TEXT (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp), writing the
 * footprint in its own local frame (a library `.kicad_mod`).
 *
 * Lossless by patching, exactly like the schematic and symbol-library writers:
 * every footprint child keeps the `source` node it was read from, so an
 * untouched footprint round-trips byte-for-byte while only edited (or newly
 * created, source-less) pads/graphics/texts are rebuilt in canonical form.
 * Children the typed model does not represent (descr, tags, attr, models,
 * zones, groups, non-Reference/Value properties, …) pass straight through.
 *
 * Coordinate note: `.kicad_pcb`/`.kicad_mod` store +Y **down**, the same sign
 * as the typed model (unlike symbol libraries), so no Y inversion is applied.
 */

import { atom, str, isList, head, type SList, type SNode } from '../sexpr/index.js';
import { arg } from '../sexpr/query.js';
import { serialize } from '../sexpr/serializer.js';
import { iuToMM } from '../units.js';
import type { PcbFootprint, PcbPad, PcbShape, PcbTextItem } from './types.js';
import type { Vec2 } from '../model/types.js';

/** SEXPR board/footprint file version (KiCad 9.0; matches pcbnew's output). */
export const FOOTPRINT_FILE_VERSION = 20241229;

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Internal units -> trimmed millimetre string, KiCad's formatInternalUnits. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const atNode = (p: Vec2, angle = 0): SList =>
  angle ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
        : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

// ----- canonical item builders (used only for edited / new items) -------------

/** `(pad "n" <type> <shape> (at ..) (size ..) [(drill ..)] (layers ..) …)`. */
export function buildPadNode(pad: PcbPad): SList {
  const items: SNode[] = [
    atom('pad'), str(pad.number), atom(pad.type), atom(pad.shape),
    atNode(pad.at, pad.angle),
    list(atom('size'), atom(mm(pad.size.x)), atom(mm(pad.size.y))),
  ];
  if (pad.delta) items.push(list(atom('rect_delta'), atom(mm(pad.delta.x)), atom(mm(pad.delta.y))));
  if (pad.drill) {
    const d: SNode[] = [atom('drill')];
    if (pad.drill.oblong) d.push(atom('oval'));
    if (pad.drill.w > 0) d.push(atom(mm(pad.drill.w)));
    if (pad.drill.oblong && pad.drill.h > 0 && pad.drill.h !== pad.drill.w) d.push(atom(mm(pad.drill.h)));
    if (pad.drill.offset) d.push(list(atom('offset'), atom(mm(pad.drill.offset.x)), atom(mm(pad.drill.offset.y))));
    items.push({ kind: 'list', items: d });
  }
  items.push({ kind: 'list', items: [atom('layers'), ...pad.layers.map((l) => str(l))] });
  if (pad.roundrectRatio !== undefined) items.push(list(atom('roundrect_rratio'), atom(mm(pad.roundrectRatio))));
  if (pad.chamferRatio !== undefined) items.push(list(atom('chamfer_ratio'), atom(mm(pad.chamferRatio))));
  if (pad.chamfer && pad.chamfer.length > 0) items.push({ kind: 'list', items: [atom('chamfer'), ...pad.chamfer.map((c) => atom(c))] });
  if (pad.uuid) items.push(list(atom('uuid'), str(pad.uuid)));
  return { kind: 'list', items };
}

/** `(fp_line|fp_arc|… (start ..) … (stroke ..) [(fill ..)] (layer ..) [(uuid ..)])`. */
export function buildShapeNode(shape: PcbShape): SList {
  const tag = `fp_${shape.kind}`;
  const items: SNode[] = [atom(tag)];
  const pt = (name: string, p: Vec2 | undefined): void => { if (p) items.push(list(atom(name), atom(mm(p.x)), atom(mm(p.y)))); };
  if (shape.kind === 'circle') {
    pt('center', shape.center);
    pt('end', shape.end);
  } else if (shape.kind === 'arc') {
    pt('start', shape.start); pt('mid', shape.mid); pt('end', shape.end);
  } else if (shape.kind === 'poly' || shape.kind === 'curve') {
    items.push({ kind: 'list', items: [atom('pts'), ...(shape.pts ?? []).map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y))))] });
  } else {
    pt('start', shape.start); pt('end', shape.end);
  }
  items.push(list(atom('stroke'), list(atom('width'), atom(mm(shape.width))), list(atom('type'), atom('solid'))));
  if (shape.fill) items.push(list(atom('fill'), atom('solid')));
  items.push(list(atom('layer'), str(shape.layer)));
  if (shape.uuid) items.push(list(atom('uuid'), str(shape.uuid)));
  return { kind: 'list', items };
}

/** `(fp_text <kind> "text" (at ..) (layer ..) [(hide yes)] (effects (font (size h w) [(thickness t)]))) `. */
export function buildTextNode(text: PcbTextItem): SList {
  const items: SNode[] = [
    atom('fp_text'), atom(text.kind), str(text.text),
    atNode(text.at, text.angle),
    list(atom('layer'), str(text.layer)),
  ];
  if (text.hide) items.push(list(atom('hide'), atom('yes')));
  // (size h w): height first, matching the reader's {x: w, y: h} <-> file order.
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(text.size.y)), atom(mm(text.size.x)))];
  if (text.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(text.thickness))));
  if (text.bold) font.push(list(atom('bold'), atom('yes')));
  if (text.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (text.justify && text.justify.length > 0) effects.push({ kind: 'list', items: [atom('justify'), ...text.justify.map((j) => atom(j))] });
  items.push({ kind: 'list', items: effects });
  if (text.uuid) items.push(list(atom('uuid'), str(text.uuid)));
  return { kind: 'list', items };
}

// ----- footprint node ---------------------------------------------------------

/** A modelled child node: pass the untouched source through, rebuild when source-less. */
const padNode = (p: PcbPad): SList => (p.source.items.length > 0 ? p.source : buildPadNode(p));
const shapeNode = (s: PcbShape): SList => (s.source.items.length > 0 ? s.source : buildShapeNode(s));
const textNode = (t: PcbTextItem): SList => (t.source.items.length > 0 ? t.source : buildTextNode(t));

const GRAPHIC_HEADS = new Set(['fp_line', 'fp_arc', 'fp_circle', 'fp_rect', 'fp_poly', 'fp_curve']);

/** Whether a source child is one the model owns as a text (Reference/Value or fp_text). */
function isTextSource(it: SList): boolean {
  const h = head(it);
  if (h === 'fp_text') return true;
  if (h === 'property') { const k = arg(it, 0); return k === 'Reference' || k === 'Value'; }
  return false;
}

/**
 * Rebuild the `(footprint …)` node from the typed model. The modelled item
 * classes (pads, graphics, Reference/Value + fp_text) are emitted from the model
 * arrays — in model order — one per corresponding source child (so an edited
 * item's PATCHED source is used, deletions drop trailing source nodes, and
 * additions append after their group). Every unmodelled child (descr, tags,
 * attr, models, other properties, …) passes through in place, byte-faithful.
 */
export function writeFootprintNode(fp: PcbFootprint): SList {
  const src = fp.source;
  const out: SNode[] = [];
  let pi = 0, si = 0, ti = 0; // next model pad / shape / text to emit

  if (src.items.length > 0) {
    for (const it of src.items) {
      if (!isList(it)) { out.push(it); continue; }
      const h = head(it);
      if (h === 'pad') { if (pi < fp.pads.length) out.push(padNode(fp.pads[pi]!)); pi++; }
      else if (GRAPHIC_HEADS.has(h ?? '')) { if (si < fp.shapes.length) out.push(shapeNode(fp.shapes[si]!)); si++; }
      else if (isTextSource(it)) { if (ti < fp.texts.length) out.push(textNode(fp.texts[ti]!)); ti++; }
      else out.push(it);
    }
  } else {
    // No source (a footprint built from scratch): emit the canonical header.
    out.push(atom('footprint'), str(fp.lib),
      list(atom('version'), atom(String(FOOTPRINT_FILE_VERSION))),
      list(atom('generator'), str('pcbnew')),
      list(atom('generator_version'), str('9.0')),
      list(atom('layer'), str(fp.layer || 'F.Cu')));
  }

  // Append newly added items (model has more than the source held), by group.
  for (; ti < fp.texts.length; ti++) out.push(textNode(fp.texts[ti]!));
  for (; si < fp.shapes.length; si++) out.push(shapeNode(fp.shapes[si]!));
  for (; pi < fp.pads.length; pi++) out.push(padNode(fp.pads[pi]!));

  return { kind: 'list', items: out };
}

/** Serialize a footprint to `.kicad_mod` text. */
export function serializeFootprint(fp: PcbFootprint): string {
  return serialize(writeFootprintNode(fp));
}
