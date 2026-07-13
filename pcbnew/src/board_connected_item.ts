/**
 * BOARD_CONNECTED_ITEM — base for board items that belong to a net
 * (pcbnew/board_connected_item.h): tracks, vias, pads, zones. Adds the net code
 * onto BOARD_ITEM. (KiCad also tracks netclass/teardrop state; added as needed.)
 */

import { BOARD_ITEM } from './board_item.js';
import type { PCB_LAYER_ID } from './layer_ids.js';

export abstract class BOARD_CONNECTED_ITEM extends BOARD_ITEM {
  /** Net code (BOARD_CONNECTED_ITEM::m_netinfo->GetNetCode()). */
  protected m_netCode: number;

  constructor(layer: PCB_LAYER_ID = 'F.Cu', netCode = 0) {
    super(layer);
    this.m_netCode = netCode;
  }

  GetNetCode(): number {
    return this.m_netCode;
  }
  SetNetCode(aNetCode: number): void {
    this.m_netCode = aNetCode;
  }
}
