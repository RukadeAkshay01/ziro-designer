/**
 * IPC-2221 minimum electrical spacing (creepage/clearance) table.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_electrical_spacing_ipc2221.cpp`.
 *
 * Values in millimetres, from IPC-2221 Table 6-1. The last row is the extra
 * spacing *per volt* above 500 V.
 */

export const IPC2221_VOLTAGE_RANGES: readonly string[] = [
  '0 … 15 V',
  '16 … 30 V',
  '31 … 50 V',
  '51 … 100 V',
  '101 … 150 V',
  '151 … 170 V',
  '171 … 250 V',
  '251 … 300 V',
  '301 … 500 V',
  '> 500 V (per volt)',
];

export const IPC2221_CASES: readonly { id: string; description: string }[] = [
  { id: 'B1', description: 'Internal conductors' },
  { id: 'B2', description: 'External conductors, uncoated, sea level to 3050 m' },
  { id: 'B3', description: 'External conductors, uncoated, above 3050 m' },
  { id: 'B4', description: 'External conductors, with permanent polymer coating (any elevation)' },
  {
    id: 'A5',
    description: 'External conductors, with conformal coating over assembly (any elevation)',
  },
  { id: 'A6', description: 'External component lead/termination, uncoated, sea level to 3050 m' },
  {
    id: 'A7',
    description: 'External component lead/termination, with conformal coating (any elevation)',
  },
];

/** [voltage range][case] → spacing in mm. */
export const IPC2221_SPACING_MM: readonly (readonly number[])[] = [
  //  B1     B2     B3      B4     A5     A6     A7
  [0.05, 0.1, 0.1, 0.05, 0.13, 0.13, 0.13],
  [0.05, 0.1, 0.1, 0.05, 0.13, 0.25, 0.13],
  [0.1, 0.6, 0.6, 0.13, 0.13, 0.4, 0.13],
  [0.1, 0.6, 1.5, 0.13, 0.13, 0.5, 0.13],
  [0.2, 0.6, 3.2, 0.4, 0.4, 0.8, 0.4],
  [0.2, 1.25, 3.2, 0.4, 0.4, 0.8, 0.4],
  [0.2, 1.25, 6.4, 0.4, 0.4, 0.8, 0.4],
  [0.2, 1.25, 12.5, 0.4, 0.4, 0.8, 0.8],
  [0.25, 2.5, 12.5, 0.8, 0.8, 1.5, 0.8],
  [0.0025, 0.005, 0.025, 0.00305, 0.00305, 0.00305, 0.00305],
];

/** Row index of the table for a DC/AC-peak voltage, or -1 when > 500 V. */
export function ipc2221RowForVoltage(volts: number): number {
  const limits = [15, 30, 50, 100, 150, 170, 250, 300, 500];
  for (let i = 0; i < limits.length; i++) if (volts <= (limits[i] ?? 0)) return i;
  return -1;
}

/** Spacing (mm) for an arbitrary voltage, extrapolating above 500 V. */
export function ipc2221Spacing(volts: number, caseIdx: number): number {
  if (!(volts >= 0)) return NaN;
  const row = ipc2221RowForVoltage(volts);
  if (row >= 0) return IPC2221_SPACING_MM[row]?.[caseIdx] ?? NaN;
  const base = IPC2221_SPACING_MM[8]?.[caseIdx] ?? NaN;
  const perVolt = IPC2221_SPACING_MM[9]?.[caseIdx] ?? NaN;
  return base + (volts - 500) * perVolt;
}
