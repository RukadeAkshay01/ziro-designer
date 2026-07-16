/**
 * IEC 60063 preferred-number (E-series) tables and helpers.
 * Counterpart: KiCad `common/eseries.cpp` + `pcb_calculator/calculator_panels/panel_eseries_display.cpp`.
 */

export enum ESeriesId {
  E1 = 0,
  E3 = 1,
  E6 = 2,
  E12 = 3,
  E24 = 4,
  E48 = 5,
  E96 = 6,
}

/** First-decade base values (1.0 ≤ v < 10) for each series. */
export const E1_VALUES: readonly number[] = [1.0];

export const E3_VALUES: readonly number[] = [1.0, 2.2, 4.7];

export const E6_VALUES: readonly number[] = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

export const E12_VALUES: readonly number[] = [
  1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2,
];

export const E24_VALUES: readonly number[] = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6,
  6.2, 6.8, 7.5, 8.2, 9.1,
];

export const E48_VALUES: readonly number[] = [
  1.0, 1.05, 1.1, 1.15, 1.21, 1.27, 1.33, 1.4, 1.47, 1.54, 1.62, 1.69, 1.78, 1.87, 1.96, 2.05, 2.15,
  2.26, 2.37, 2.49, 2.61, 2.74, 2.87, 3.01, 3.16, 3.32, 3.48, 3.65, 3.83, 4.02, 4.22, 4.42, 4.64,
  4.87, 5.11, 5.36, 5.62, 5.9, 6.19, 6.49, 6.81, 7.15, 7.5, 7.87, 8.25, 8.66, 9.09, 9.53,
];

export const E96_VALUES: readonly number[] = [
  1.0, 1.02, 1.05, 1.07, 1.1, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.3, 1.33, 1.37, 1.4, 1.43, 1.47,
  1.5, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.0, 2.05, 2.1, 2.15, 2.21,
  2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.8, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24,
  3.32, 3.4, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22, 4.32, 4.42, 4.53, 4.64, 4.75,
  4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.9, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98,
  7.15, 7.32, 7.5, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76,
];

export const ESERIES: readonly { id: ESeriesId; name: string; values: readonly number[] }[] = [
  { id: ESeriesId.E1, name: 'E1', values: E1_VALUES },
  { id: ESeriesId.E3, name: 'E3', values: E3_VALUES },
  { id: ESeriesId.E6, name: 'E6', values: E6_VALUES },
  { id: ESeriesId.E12, name: 'E12', values: E12_VALUES },
  { id: ESeriesId.E24, name: 'E24', values: E24_VALUES },
  { id: ESeriesId.E48, name: 'E48', values: E48_VALUES },
  { id: ESeriesId.E96, name: 'E96', values: E96_VALUES },
];

export function eseriesValues(id: ESeriesId): readonly number[] {
  return ESERIES[id]?.values ?? E24_VALUES;
}

/**
 * All values of a series across the given decade span.
 * `firstDecade`/`lastDecade` are powers of ten (e.g. -1 → 0.1…, 6 → 1 MΩ…).
 */
export function eseriesInRange(id: ESeriesId, firstDecade: number, lastDecade: number): number[] {
  const out: number[] = [];
  for (let d = firstDecade; d <= lastDecade; d++) {
    const mult = 10 ** d;
    for (const v of eseriesValues(id)) out.push(roundSig(v * mult));
  }
  return out;
}

/** Nearest series value to `target` (searching neighbouring decades). */
export function eseriesNearest(id: ESeriesId, target: number): number {
  if (!(target > 0) || !Number.isFinite(target)) return NaN;
  const dec = Math.floor(Math.log10(target));
  let best = NaN;
  let bestErr = Infinity;
  for (const v of eseriesInRange(id, dec - 1, dec + 1)) {
    const err = Math.abs(v - target);
    if (err < bestErr) {
      bestErr = err;
      best = v;
    }
  }
  return best;
}

/** Kill float noise from decade multiplication (4.7 * 0.01 → 0.047). */
function roundSig(v: number): number {
  return Number(v.toPrecision(12));
}
