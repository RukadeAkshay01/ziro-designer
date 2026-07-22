/**
 * Writer: typed `Board` model -> S-expression AST -> `.kicad_pcb` text.
 *
 * The board counterpart to write-footprint.ts and KiCad's
 * `PCB_IO_KICAD_SEXPR::format( const BOARD* )`
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr.cpp). Lossless by the same
 * patch-in-place strategy: the top-level `(kicad_pcb …)` node is rebuilt by
 * walking the *source* children in order, and for each child the model owns
 * (footprints, tracks/arcs, vias, zones, gr_* graphics, gr_text) the item's
 * `source` node — which board edits PATCH in place — is emitted. Everything the
 * typed model does not represent (general, paper, layers, setup, net decls,
 * embedded files, …) passes straight through, byte-faithful.
 *
 * Items are matched to the model positionally by node head, exactly the reader's
 * order (mirroring write-footprint.ts). Deletions drop trailing source children
 * of a kind; additions (source-less items built from scratch, or duplicated
 * items carrying a copied source) are appended after the walk, each emitted from
 * its source or a canonical builder.
 */

import { atom, str, isList, head, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { writeFootprintNode } from './write-footprint.js';
import type {
  Board,
  PcbTrack,
  PcbArcTrack,
  PcbVia,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbGroup,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Internal units -> trimmed millimetre string, KiCad's formatInternalUnits. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));
const atNode = (p: Vec2, angle = 0): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

// ----- canonical builders (used only for source-less / freshly-built items) ---

/** `(segment (start ..) (end ..) (width ..) (layer ..) (net ..) [(uuid ..)])`. */
export function buildTrackNode(t: PcbTrack): SList {
  const items: SNode[] = [
    atom('segment'),
    xy('start', t.start),
    xy('end', t.end),
    list(atom('width'), atom(mm(t.width))),
    list(atom('layer'), str(t.layer)),
    list(atom('net'), atom(String(t.net))),
  ];
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));
  return { kind: 'list', items };
}

/** `(arc (start ..) (mid ..) (end ..) (width ..) (layer ..) (net ..) [(uuid ..)])`. */
export function buildArcTrackNode(a: PcbArcTrack): SList {
  const items: SNode[] = [
    atom('arc'),
    xy('start', a.start),
    xy('mid', a.mid),
    xy('end', a.end),
    list(atom('width'), atom(mm(a.width))),
    list(atom('layer'), str(a.layer)),
    list(atom('net'), atom(String(a.net))),
  ];
  if (a.uuid) items.push(list(atom('uuid'), str(a.uuid)));
  return { kind: 'list', items };
}

/** `(via [micro|blind] (at ..) (size ..) (drill ..) (layers ..) (net ..) [(uuid ..)])`. */
export function buildViaNode(v: PcbVia): SList {
  const items: SNode[] = [atom('via')];
  if (v.kind === 'micro') items.push(atom('micro'));
  else if (v.kind === 'blind') items.push(atom('blind'));
  items.push(
    atNode(v.at),
    list(atom('size'), atom(mm(v.size))),
    list(atom('drill'), atom(mm(v.drill))),
    { kind: 'list', items: [atom('layers'), str(v.layers[0]), str(v.layers[1])] },
    list(atom('net'), atom(String(v.net))),
  );
  if (v.uuid) items.push(list(atom('uuid'), str(v.uuid)));
  return { kind: 'list', items };
}

/** `(gr_line|gr_arc|… (start ..) … (stroke ..) [(fill ..)] (layer ..) [(uuid ..)])`. */
export function buildBoardShapeNode(s: PcbShape): SList {
  const items: SNode[] = [atom(`gr_${s.kind}`)];
  const pt = (name: string, p: Vec2 | undefined): void => {
    if (p) items.push(xy(name, p));
  };
  if (s.kind === 'circle') {
    pt('center', s.center);
    pt('end', s.end);
  } else if (s.kind === 'arc') {
    pt('start', s.start);
    pt('mid', s.mid);
    pt('end', s.end);
  } else if (s.kind === 'poly' || s.kind === 'curve') {
    items.push({ kind: 'list', items: [atom('pts'), ...(s.pts ?? []).map((p) => xy('xy', p))] });
  } else {
    pt('start', s.start);
    pt('end', s.end);
  }
  items.push(
    list(atom('stroke'), list(atom('width'), atom(mm(s.width))), list(atom('type'), atom('solid'))),
  );
  if (s.fill) items.push(list(atom('fill'), atom('solid')));
  items.push(list(atom('layer'), str(s.layer)));
  if (s.uuid) items.push(list(atom('uuid'), str(s.uuid)));
  return { kind: 'list', items };
}

/**
 * `(zone (net ..) (net_name ..) (layer[s] ..) (hatch ..) … (polygon (pts …)))`
 * for a freshly-drawn zone, with KiCad's default zone settings
 * (ZONE_SETTINGS: clearance 0.5, min thickness 0.25, thermal 0.5/0.5).
 */
export function buildZoneNode(z: PcbZone): SList {
  const items: SNode[] = [
    atom('zone'),
    list(atom('net'), atom(String(z.net))),
    list(atom('net_name'), str(z.netName ?? '')),
  ];
  if (z.layers.length === 1) items.push(list(atom('layer'), str(z.layers[0]!)));
  else items.push({ kind: 'list', items: [atom('layers'), ...z.layers.map((l) => str(l))] });
  if (z.uuid) items.push(list(atom('uuid'), str(z.uuid)));
  const hatchStyle = z.hatchStyle ?? 'edge';
  items.push(list(atom('hatch'), atom(hatchStyle), atom(z.hatchPitch ? mm(z.hatchPitch) : '0.5')));
  items.push(list(atom('connect_pads'), list(atom('clearance'), atom('0.5'))));
  items.push(list(atom('min_thickness'), atom('0.25')));
  items.push(list(atom('filled_areas_thickness'), atom('no')));
  items.push(
    list(
      atom('fill'),
      atom('yes'),
      list(atom('thermal_gap'), atom('0.5')),
      list(atom('thermal_bridge_width'), atom('0.5')),
    ),
  );
  items.push(
    list(atom('polygon'), {
      kind: 'list',
      items: [atom('pts'), ...(z.outline ?? []).map((p) => xy('xy', p))],
    }),
  );
  return { kind: 'list', items };
}

/** `(gr_text "text" (at ..) (layer ..) (effects (font (size h w) [(thickness ..)])))`. */
export function buildBoardTextNode(t: PcbTextItem): SList {
  const items: SNode[] = [
    atom('gr_text'),
    str(t.text),
    atNode(t.at, t.angle),
    list(atom('layer'), str(t.layer)),
  ];
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if (t.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(t.thickness))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (t.justify && t.justify.length > 0)
    effects.push({ kind: 'list', items: [atom('justify'), ...t.justify.map((j) => atom(j))] });
  items.push({ kind: 'list', items: effects });
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));
  return { kind: 'list', items };
}

// A modelled item's node: its (patched) source, or a canonical build if source-less.
const trackNode = (t: PcbTrack): SNode =>
  t.source.items.length > 0 ? t.source : buildTrackNode(t);
const arcTrackNode = (a: PcbArcTrack): SNode =>
  a.source.items.length > 0 ? a.source : buildArcTrackNode(a);
const viaNode = (v: PcbVia): SNode => (v.source.items.length > 0 ? v.source : buildViaNode(v));
const shapeNode = (s: PcbShape): SNode =>
  s.source.items.length > 0 ? s.source : buildBoardShapeNode(s);
const textNode = (t: PcbTextItem): SNode =>
  t.source.items.length > 0 ? t.source : buildBoardTextNode(t);
const zoneNode = (z: PcbZone): SNode => (z.source.items.length > 0 ? z.source : buildZoneNode(z));

/** `(group "name" (uuid …) [(locked yes)] (members …))` — PCB_IO_KICAD_SEXPR::
 *  format(PCB_GROUP): members sorted alphabetically; empty groups not written
 *  (the walk drops a group whose model entry has no members). */
export function buildGroupNode(g: PcbGroup): SList {
  const items: SNode[] = [atom('group'), str(g.name)];
  if (g.uuid) items.push(list(atom('uuid'), str(g.uuid)));
  if (g.locked) items.push(list(atom('locked'), atom('yes')));
  items.push(list(atom('members'), ...[...g.members].sort().map((m) => str(m))));
  return { kind: 'list', items };
}
const groupNode = (g: PcbGroup): SNode =>
  g.source.items.length > 0 ? g.source : buildGroupNode(g);

/** A source child the reader parsed by these top-level heads. */
const GRAPHIC_HEADS = new Set(['gr_line', 'gr_arc', 'gr_circle', 'gr_rect', 'gr_poly', 'gr_curve']);

/**
 * Rebuild the `(kicad_pcb …)` node from the typed model, emitting each modelled
 * child from the model arrays (in source order), dropping deleted items and
 * appending newly-added ones after the walk.
 */
export function writeBoardNode(board: Board): SList {
  const src = board.source;
  if (src.items.length === 0) return src; // nothing to rebuild from
  const out: SNode[] = [];
  let ti = 0,
    ai = 0,
    vi = 0,
    zi = 0,
    si = 0,
    xi = 0,
    fi = 0,
    gi = 0;

  for (const it of src.items) {
    if (!isList(it)) {
      out.push(it);
      continue;
    }
    const h = head(it) ?? '';
    if (h === 'footprint' || h === 'module') {
      if (fi < board.footprints.length) out.push(writeFootprintNode(board.footprints[fi]!));
      fi++;
    } else if (h === 'segment') {
      if (ti < board.tracks.length) out.push(trackNode(board.tracks[ti]!));
      ti++;
    } else if (h === 'arc') {
      if (ai < board.arcs.length) out.push(arcTrackNode(board.arcs[ai]!));
      ai++;
    } else if (h === 'via') {
      if (vi < board.vias.length) out.push(viaNode(board.vias[vi]!));
      vi++;
    } else if (h === 'zone') {
      if (zi < board.zones.length) out.push(zoneNode(board.zones[zi]!));
      zi++;
    } else if (GRAPHIC_HEADS.has(h)) {
      if (si < board.shapes.length) out.push(shapeNode(board.shapes[si]!));
      si++;
    } else if (h === 'gr_text') {
      if (xi < board.texts.length) out.push(textNode(board.texts[xi]!));
      xi++;
    } else if (h === 'group') {
      // Empty groups are never written (PCB_IO_KICAD_SEXPR::format(PCB_GROUP)).
      if (gi < board.groups.length && board.groups[gi]!.members.length > 0)
        out.push(groupNode(board.groups[gi]!));
      gi++;
    } else out.push(it);
  }

  // Append items the model gained beyond what the source held (duplicate/place).
  for (; fi < board.footprints.length; fi++) out.push(writeFootprintNode(board.footprints[fi]!));
  for (; ti < board.tracks.length; ti++) out.push(trackNode(board.tracks[ti]!));
  for (; ai < board.arcs.length; ai++) out.push(arcTrackNode(board.arcs[ai]!));
  for (; vi < board.vias.length; vi++) out.push(viaNode(board.vias[vi]!));
  for (; si < board.shapes.length; si++) out.push(shapeNode(board.shapes[si]!));
  for (; xi < board.texts.length; xi++) out.push(textNode(board.texts[xi]!));
  for (; zi < board.zones.length; zi++) out.push(zoneNode(board.zones[zi]!));
  for (; gi < board.groups.length; gi++)
    if (board.groups[gi]!.members.length > 0) out.push(groupNode(board.groups[gi]!));

  return { kind: 'list', items: out };
}

/** Serialize a board to `.kicad_pcb` text. */
export function serializeBoard(board: Board): string {
  return serialize(writeBoardNode(board));
}
