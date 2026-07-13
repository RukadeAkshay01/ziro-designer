/**
 * BOARD — the root container (pcbnew/board.{h,cpp}). Holds the footprints,
 * tracks/arcs/vias, zones and board-level graphics/text, plus the layer table
 * and net map. KiCad's BOARD is itself a BOARD_ITEM_CONTAINER with a great deal
 * of design-settings/connectivity state; this port starts with the item
 * collections + Add/Remove + the accessors the tools and formatter need.
 */

import { FlipLayer as flipLayerImpl, type PCB_LAYER_ID } from './layer_ids.js';
import { FOOTPRINT } from './footprint.js';
import { PCB_TRACK } from './pcb_track.js';
import { ZONE } from './zone.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TEXT } from './pcb_text.js';

/** Anything that can sit at board scope. */
export type BOARD_TOP_ITEM = FOOTPRINT | PCB_TRACK | ZONE | PCB_SHAPE | PCB_TEXT;

/** One row of the `(layers …)` table. */
export interface BOARD_LAYER {
  id: number;
  name: string;
  type: string;
  userName?: string;
}

export class BOARD {
  protected m_footprints: FOOTPRINT[] = [];
  /** Tracks, arcs and vias — KiCad keeps them together in m_tracks. */
  protected m_tracks: PCB_TRACK[] = [];
  protected m_zones: ZONE[] = [];
  /** Board-level graphics + text (KiCad m_drawings). */
  protected m_drawings: (PCB_SHAPE | PCB_TEXT)[] = [];

  protected m_layers: BOARD_LAYER[] = [];
  /** Net code -> net name (BOARD::m_NetInfo). */
  protected m_nets = new Map<number, string>();

  // Optional page/title metadata (BOARD design settings hold much more).
  paper?: string;
  titleBlock?: { title?: string; date?: string; rev?: string; company?: string };

  Footprints(): FOOTPRINT[] {
    return this.m_footprints;
  }
  Tracks(): PCB_TRACK[] {
    return this.m_tracks;
  }
  Zones(): ZONE[] {
    return this.m_zones;
  }
  Drawings(): (PCB_SHAPE | PCB_TEXT)[] {
    return this.m_drawings;
  }

  GetLayers(): BOARD_LAYER[] {
    return this.m_layers;
  }
  SetLayers(layers: BOARD_LAYER[]): void {
    this.m_layers = layers;
  }

  GetNetInfo(): Map<number, string> {
    return this.m_nets;
  }
  SetNet(code: number, name: string): void {
    this.m_nets.set(code, name);
  }
  GetNetname(code: number): string {
    return this.m_nets.get(code) ?? '';
  }

  /** BOARD::FlipLayer — the opposite-side layer (delegates to layer_ids). */
  FlipLayer(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
    return flipLayerImpl(aLayer);
  }

  /** BOARD::Add — file the item into the right collection by its class. */
  Add(item: BOARD_TOP_ITEM): void {
    if (item instanceof FOOTPRINT) this.m_footprints.push(item);
    else if (item instanceof PCB_TRACK)
      this.m_tracks.push(item); // PCB_ARC / PCB_VIA are PCB_TRACKs
    else if (item instanceof ZONE) this.m_zones.push(item);
    else this.m_drawings.push(item); // PCB_SHAPE | PCB_TEXT
  }

  /** BOARD::Remove — drop the item from its collection (by identity). */
  Remove(item: BOARD_TOP_ITEM): void {
    const drop = <T>(arr: T[], it: T): void => {
      const i = arr.indexOf(it);
      if (i >= 0) arr.splice(i, 1);
    };
    if (item instanceof FOOTPRINT) drop(this.m_footprints, item);
    else if (item instanceof PCB_TRACK) drop(this.m_tracks, item);
    else if (item instanceof ZONE) drop(this.m_zones, item);
    else drop(this.m_drawings, item as PCB_SHAPE | PCB_TEXT);
  }

  /** Every top-level item (the order the selection tool / formatter iterate). */
  AllItems(): BOARD_TOP_ITEM[] {
    return [...this.m_footprints, ...this.m_tracks, ...this.m_zones, ...this.m_drawings];
  }
}
