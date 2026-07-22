/**
 * Wrap a single library footprint as a one-item BOARD so the existing
 * PCB_PAINTER pipeline (renderBoard.ts) can draw it unchanged.
 *
 * This mirrors KiCad exactly: `FOOTPRINT_EDIT_FRAME` is a `PCB_BASE_EDIT_FRAME`
 * that owns a `BOARD` holding the one footprint being edited (see
 * `footprint_edit_frame.cpp` — `GetBoard()->Add( footprint )`). The footprint is
 * placed at the board origin (0,0, 0°), so its stored local coordinates are also
 * its board coordinates and no transform is applied.
 */

import { parse } from '@ziroeda/sexpr';
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import {
  readFootprintFile,
  type Board,
  type PcbFootprint,
  type PcbLayerDef,
} from '@ziroeda/pcbnew';

/**
 * The footprint-editor layer table: every board layer a footprint may live on,
 * matching the canonical KiCad layer ids/names (pcbnew's default 2-layer stack
 * plus the full technical/user set). buildScene only reads copper names off this
 * for `*.Cu` pad expansion; the Appearance panel lists the rest.
 */
export const FOOTPRINT_LAYERS: PcbLayerDef[] = [
  { id: 0, name: 'F.Cu', kind: 'signal' },
  { id: 2, name: 'B.Cu', kind: 'signal' },
  { id: 9, name: 'F.Adhes', kind: 'user', userName: 'F.Adhesive' },
  { id: 11, name: 'B.Adhes', kind: 'user', userName: 'B.Adhesive' },
  { id: 13, name: 'F.Paste', kind: 'user' },
  { id: 15, name: 'B.Paste', kind: 'user' },
  { id: 5, name: 'F.SilkS', kind: 'user', userName: 'F.Silkscreen' },
  { id: 7, name: 'B.SilkS', kind: 'user', userName: 'B.Silkscreen' },
  { id: 1, name: 'F.Mask', kind: 'user' },
  { id: 3, name: 'B.Mask', kind: 'user' },
  { id: 17, name: 'Dwgs.User', kind: 'user', userName: 'User.Drawings' },
  { id: 19, name: 'Cmts.User', kind: 'user', userName: 'User.Comments' },
  { id: 21, name: 'Eco1.User', kind: 'user', userName: 'User.Eco1' },
  { id: 23, name: 'Eco2.User', kind: 'user', userName: 'User.Eco2' },
  { id: 25, name: 'Edge.Cuts', kind: 'user' },
  { id: 27, name: 'Margin', kind: 'user' },
  { id: 31, name: 'F.CrtYd', kind: 'user', userName: 'F.Courtyard' },
  { id: 29, name: 'B.CrtYd', kind: 'user', userName: 'B.Courtyard' },
  { id: 35, name: 'F.Fab', kind: 'user' },
  { id: 33, name: 'B.Fab', kind: 'user' },
];

/** Board holding just the given footprint (or empty), for the footprint canvas. */
export function footprintToBoard(fp: PcbFootprint | null): Board {
  return {
    version: 20241229,
    layers: FOOTPRINT_LAYERS,
    nets: new Map([[0, '']]),
    footprints: fp ? [fp] : [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    groups: [],
    source: EMPTY_SOURCE,
  };
}

/** Parse `.kicad_mod` text into a footprint, or null if it isn't one. */
export function parseFootprint(text: string): PcbFootprint | null {
  try {
    return readFootprintFile(parse(text));
  } catch {
    return null;
  }
}
