/**
 * Cable (round-wire) size: AWG ↔ diameter ↔ area, ampacity by current
 * density, and the linear/application results (resistance, drop, losses).
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_cable_size.cpp`.
 */

import {
  COPPER_RESISTIVITY_OHM_M,
  COPPER_TEMP_COEFF_PER_K,
} from './tracks_width_versus_current_formula.js';

// Same gauge range and naming as KiCad's CABLE_SIZE_ENTRY list (AWG0000 … AWG30).
export const AWG_NAMES: readonly string[] = [
  'AWG0000',
  'AWG000',
  'AWG00',
  'AWG0',
  ...Array.from({ length: 30 }, (_, i) => `AWG${i + 1}`),
];

/** Diameter (m) of AWG gauge n, where n = -3 for 0000 … 36. */
export function awgDiameterM(n: number): number {
  return 0.000127 * 92 ** ((36 - n) / 39);
}

/** Gauge number for the AWG_NAMES index (0 → -3 = 0000). */
export const awgIndexToGauge = (idx: number): number => idx - 3;

/** Nearest AWG_NAMES index for a diameter (m). */
export function nearestAwgIndex(diaM: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let idx = 0; idx < AWG_NAMES.length; idx++) {
    const err = Math.abs(awgDiameterM(awgIndexToGauge(idx)) - diaM);
    if (err < bestErr) {
      bestErr = err;
      best = idx;
    }
  }
  return best;
}

export interface CableSizeParams {
  diameterM: number;
  /** Conductor temperature, °C. */
  conductorTempC: number;
  /** Max allowed current density, A/mm² (typ. 1–10). */
  currentDensity: number;
  /** Applied current, A. */
  currentA: number;
  /** One-way cable length, m (resistance uses the full round trip ×1 — as on the panel, length is the conductor length). */
  lengthM: number;
  /** Resistivity at 20 °C, Ω·m. */
  resistivity?: number;
}

export interface CableSizeResult {
  areaMm2: number;
  /** Resistance per metre at 20 °C, Ω/m. */
  resPerMeter20: number;
  /** Resistance per metre at conductor temperature, Ω/m. */
  resPerMeter: number;
  /** Max ampacity from the current-density limit, A. */
  ampacityA: number;
  /** Total resistance of `lengthM` at temperature, Ω. */
  resistanceOhm: number;
  voltageDrop: number;
  powerLossW: number;
}

export function cableSize(p: CableSizeParams): CableSizeResult {
  const rho20 = p.resistivity ?? COPPER_RESISTIVITY_OHM_M;
  const areaM2 = (Math.PI / 4) * p.diameterM * p.diameterM;
  const areaMm2 = areaM2 * 1e6;
  const rho = rho20 * (1 + COPPER_TEMP_COEFF_PER_K * (p.conductorTempC - 20));
  const resPerMeter = rho / areaM2;
  const resistanceOhm = resPerMeter * p.lengthM;
  const voltageDrop = resistanceOhm * p.currentA;
  return {
    areaMm2,
    resPerMeter20: rho20 / areaM2,
    resPerMeter,
    ampacityA: p.currentDensity * areaMm2,
    resistanceOhm,
    voltageDrop,
    powerLossW: voltageDrop * p.currentA,
  };
}
