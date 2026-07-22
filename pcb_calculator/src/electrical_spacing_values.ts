/**
 * IPC-2221 minimum electrical spacing (creepage/clearance) table.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_electrical_spacing_ipc2221.cpp`.
 *
 * Values in millimetres, from IPC-2221C Dec 2023 (Table 6-1). The last row is
 * the extra spacing *per volt* above 500 V.
 */

export const IPC2221_VOLTAGE_RANGES: readonly string[] = [
  '0 .. 15 V',
  '16 .. 30 V',
  '31 .. 50 V',
  '51 .. 100 V',
  '101 .. 150 V',
  '151 .. 170 V',
  '171 .. 250 V',
  '251 .. 300 V',
  '301 .. 500 V',
  ' > 500 V',
];

export const IPC2221_CASES: readonly { id: string; description: string }[] = [
  { id: 'B1', description: 'Internal Conductors' },
  { id: 'B2', description: 'External Conductors, uncoated, sea level to 3050 m' },
  { id: 'B3', description: 'External Conductors, uncoated, over 3050 m or a vacuum' },
  { id: 'B4', description: 'External Conductors, with permanent polymer coating (any elevation)' },
  { id: 'B5', description: 'External Conductors, with conformal (any elevation or in a vacuum)' },
  {
    id: 'A6',
    description:
      'External Component lead termination, with conformal coating (any elevation or in a vacuum)',
  },
  { id: 'A7', description: 'External Component lead/termination, uncoated, sea level to 3050 m' },
  {
    id: 'A8',
    description: 'External Component lead/termination, uncoated, over 3050m or in a vacuum',
  },
];

/** [voltage range][case] → spacing in mm. */
export const IPC2221_SPACING_MM: readonly (readonly number[])[] = [
  //  B1     B2     B3      B4     B5     A6     A7     A8
  [0.05, 0.1, 0.1, 0.075, 0.075, 0.13, 0.13, 0.13],
  [0.05, 0.1, 0.1, 0.075, 0.075, 0.13, 0.25, 0.25],
  [0.1, 0.64, 0.64, 0.3, 0.13, 0.13, 0.4, 0.8],
  [0.1, 0.64, 1.5, 0.3, 0.13, 0.13, 0.5, 1],
  [0.2, 0.64, 3.2, 0.8, 0.4, 0.4, 0.8, 1.6],
  [0.2, 1.25, 3.2, 0.8, 0.4, 0.4, 0.8, 1.6],
  [0.2, 1.25, 6.4, 0.8, 0.4, 0.4, 0.8, 1.6],
  [0.2, 1.25, 12.5, 0.8, 0.4, 0.4, 0.8, 1.6],
  [0.25, 2.5, 12.5, 1.6, 0.8, 0.8, 1.5, 3],
  [0.0025, 0.005, 0.025, 0.00305, 0.00305, 0.00305, 0.00305, 0.0061],
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
