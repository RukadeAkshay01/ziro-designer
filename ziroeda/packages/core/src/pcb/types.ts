/**
 * Typed board model for `.kicad_pcb` files.
 *
 * Mirrors the item set of KiCad's `PCB_IO_KICAD_SEXPR_PARSER`
 * (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp). Coordinates are in
 * the same integer internal units as the schematic model (mmToIU), positions of
 * footprint children are stored board-absolute (the parent transform is applied
 * at read time exactly like the parser's legacy-file path: rotate by the
 * footprint orientation about its anchor, then translate — `RebakeFromLib`).
 * Every item keeps its source `SList` for lossless round-tripping.
 */

import type { SList } from '../sexpr/types.js';
import type { Vec2 } from '../model/types.js';

/** One `(N "Name" type [userName])` row of the `(layers …)` table. */
export interface PcbLayerDef {
  id: number;
  name: string;
  kind: string;
  userName?: string;
}

export type PadType = 'thru_hole' | 'smd' | 'connect' | 'np_thru_hole';
export type PadShape = 'circle' | 'rect' | 'oval' | 'trapezoid' | 'roundrect' | 'custom';

/** A drawing primitive of a custom pad, in pad-local coordinates. */
export interface PadPrimitive {
  kind: 'gr_poly' | 'gr_line' | 'gr_circle' | 'gr_arc' | 'gr_rect';
  pts?: Vec2[];
  start?: Vec2;
  mid?: Vec2;
  end?: Vec2;
  center?: Vec2;
  width: number;
  fill: boolean;
}

export interface PcbPad {
  number: string;
  type: PadType;
  shape: PadShape;
  /** Board-absolute centre (footprint transform applied). */
  at: Vec2;
  /** Degrees; the file value is board-frame absolute (parsePAD comment). */
  angle: number;
  size: Vec2;
  drill?: { oblong: boolean; w: number; h: number; offset?: Vec2 };
  layers: string[];
  roundrectRatio?: number;
  chamferRatio?: number;
  chamfer?: string[];
  delta?: Vec2;
  net?: number;
  primitives?: PadPrimitive[];
  uuid?: string;
  source: SList;
}

/** A board or footprint graphic (gr_line/fp_line families), board-absolute. */
export interface PcbShape {
  kind: 'line' | 'arc' | 'circle' | 'rect' | 'poly' | 'curve';
  start?: Vec2;
  end?: Vec2;
  mid?: Vec2;
  center?: Vec2;
  pts?: Vec2[];
  width: number;
  fill: boolean;
  layer: string;
  uuid?: string;
  source: SList;
}

/** Footprint property/fp_text or gr_text, board-absolute. */
export interface PcbTextItem {
  kind: 'reference' | 'value' | 'user';
  text: string;
  at: Vec2;
  /** Degrees, board-frame absolute (legacy fp_text semantics). */
  angle: number;
  layer: string;
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  mirror?: boolean;
  justify?: string[];
  hide?: boolean;
  knockout?: boolean;
  uuid?: string;
  source: SList;
}

export interface PcbFootprint {
  lib: string;
  at: Vec2;
  angle: number;
  /** 'F.Cu' or 'B.Cu'. */
  layer: string;
  reference?: string;
  value?: string;
  pads: PcbPad[];
  shapes: PcbShape[];
  texts: PcbTextItem[];
  uuid?: string;
  source: SList;
}

export interface PcbTrack {
  start: Vec2;
  end: Vec2;
  width: number;
  layer: string;
  net: number;
  uuid?: string;
  source: SList;
}

export interface PcbArcTrack {
  start: Vec2;
  mid: Vec2;
  end: Vec2;
  width: number;
  layer: string;
  net: number;
  uuid?: string;
  source: SList;
}

export interface PcbVia {
  at: Vec2;
  size: number;
  drill: number;
  layers: [string, string];
  kind: 'through' | 'blind' | 'micro';
  net: number;
  uuid?: string;
  source: SList;
}

export interface PcbZoneFill {
  layer: string;
  /** Filled polygons; arc segments in the file are tessellated at read time. */
  polys: Vec2[][];
}

export interface PcbZone {
  net: number;
  netName?: string;
  layers: string[];
  fills: PcbZoneFill[];
  uuid?: string;
  source: SList;
}

export interface Board {
  version: number;
  thickness?: number;
  paper?: string;
  layers: PcbLayerDef[];
  /** net code -> name, from the top-level `(net N "name")` declarations. */
  nets: Map<number, string>;
  footprints: PcbFootprint[];
  tracks: PcbTrack[];
  arcs: PcbArcTrack[];
  vias: PcbVia[];
  zones: PcbZone[];
  shapes: PcbShape[];
  texts: PcbTextItem[];
  fileName?: string;
  source: SList;
}
