/**
 * "Board Classes" memo table: minimal manufacturing values per class
 * (finer class ⇒ tighter geometry ⇒ higher cost). Values are the KiCad set;
 * NaN marks an entry KiCad shows as not applicable for that class.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_board_class.cpp`.
 */

export const BOARD_CLASS_COUNT = 6;

export interface BoardClassRow {
  label: string;
  /** One value per class 1…6, in millimetres (NaN = not applicable). */
  mm: readonly number[];
}

const NA = Number.NaN;

export const BOARD_CLASS_ROWS: readonly BoardClassRow[] = [
  { label: 'Lines width', mm: [0.8, 0.5, 0.31, 0.21, 0.15, 0.12] },
  { label: 'Minimum clearance', mm: [0.68, 0.5, 0.31, 0.21, 0.15, 0.12] },
  { label: 'Via: (diameter - drill)', mm: [NA, NA, 0.45, 0.34, 0.24, 0.2] },
  { label: 'Plated Pad: (diameter - drill)', mm: [1.19, 0.78, 0.6, 0.49, 0.39, 0.35] },
  { label: 'NP Pad: (diameter - drill)', mm: [1.57, 1.13, 0.9, NA, NA, NA] },
];
