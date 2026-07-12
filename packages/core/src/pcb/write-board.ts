/**
 * Writer: typed `Board` model -> S-expression AST -> `.kicad_pcb` text.
 *
 * The board counterpart to write-footprint.ts and KiCad's
 * `PCB_IO_KICAD_SEXPR::format( const BOARD* )`
 * (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp). Lossless by the same
 * patch-in-place strategy: the top-level `(kicad_pcb …)` node is rebuilt by
 * walking the *source* children in order, and for each child the model owns
 * (footprints, tracks/arcs, vias, zones, gr_* graphics, gr_text) the item's
 * `source` node — which board edits PATCH in place — is emitted. Everything the
 * typed model does not represent (general, paper, layers, setup, net decls,
 * groups, embedded files, …) passes straight through, byte-faithful.
 *
 * Items are matched to the model positionally by their node head (the Nth
 * `(segment …)` child is `board.tracks[N]`, etc.), exactly the reader's order —
 * mirroring write-footprint.ts's positional rule. An untouched board therefore
 * round-trips model-identically; only edited items differ (their patched source).
 */

import { isList, head, type SList, type SNode } from '../sexpr/index.js';
import { serialize } from '../sexpr/serializer.js';
import { writeFootprintNode } from './write-footprint.js';
import type { Board, PcbFootprint } from './types.js';

/** A source child the reader parsed by these top-level heads. */
const GRAPHIC_HEADS = new Set(['gr_line', 'gr_arc', 'gr_circle', 'gr_rect', 'gr_poly', 'gr_curve']);

/** Emit a modelled item: its (possibly patched) source, or — for a source-less
 *  item built from scratch — a caller-supplied fallback. Board editing patches
 *  the source node in place, so read items always carry a non-empty source. */
const srcOr = (source: SList | undefined, fallback: SNode): SNode =>
  source && source.items.length > 0 ? source : fallback;

const footprintNode = (fp: PcbFootprint | undefined, original: SNode): SNode =>
  fp ? writeFootprintNode(fp) : original;

/**
 * Rebuild the `(kicad_pcb …)` node from the typed model, emitting each modelled
 * child from the model arrays (in source order) and passing every other child
 * through unchanged.
 */
export function writeBoardNode(board: Board): SList {
  const src = board.source;
  if (src.items.length === 0) return src; // nothing to rebuild from
  const out: SNode[] = [];
  let ti = 0, ai = 0, vi = 0, zi = 0, si = 0, xi = 0, fi = 0;

  for (const it of src.items) {
    if (!isList(it)) { out.push(it); continue; }
    const h = head(it) ?? '';
    if (h === 'footprint' || h === 'module') out.push(footprintNode(board.footprints[fi++], it));
    else if (h === 'segment') out.push(srcOr(board.tracks[ti++]?.source, it));
    else if (h === 'arc') out.push(srcOr(board.arcs[ai++]?.source, it));
    else if (h === 'via') out.push(srcOr(board.vias[vi++]?.source, it));
    else if (h === 'zone') out.push(srcOr(board.zones[zi++]?.source, it));
    else if (GRAPHIC_HEADS.has(h)) out.push(srcOr(board.shapes[si++]?.source, it));
    else if (h === 'gr_text') out.push(srcOr(board.texts[xi++]?.source, it));
    else out.push(it);
  }
  return { kind: 'list', items: out };
}

/** Serialize a board to `.kicad_pcb` text. */
export function serializeBoard(board: Board): string {
  return serialize(writeBoardNode(board));
}
