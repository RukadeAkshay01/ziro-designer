/**
 * IPC-2221 track width vs. current capacity, plus the derived resistance /
 * voltage-drop / power-loss figures shown on the panel.
 * Counterpart: KiCad `pcb_calculator/tracks_width_versus_current_formula.h`
 * + `calculator_panels/panel_track_width.cpp`.
 *
 * IPC-2221 §6.2:  I = K · ΔT^0.44 · (W·H)^0.725
 * with W·H the copper cross-section in mil², K = 0.048 external / 0.024
 * internal, ΔT the allowed temperature rise in °C.
 */

export const COPPER_RESISTIVITY_OHM_M = 1.72e-8; // at 20 °C
export const COPPER_TEMP_COEFF_PER_K = 3.93e-3;

const MIL_PER_M = 39370.0787; // 1 m = 39370.08 mil
const K_EXTERNAL = 0.048;
const K_INTERNAL = 0.024;

export interface TrackLayerResult {
  /** Required track width in metres. */
  widthM: number;
  /** Copper cross-section area in m². */
  areaM2: number;
  resistanceOhm: number;
  voltageDrop: number;
  powerLossW: number;
}

export interface TrackWidthParams {
  currentA: number;
  /** Allowed temperature rise, °C. */
  deltaTC: number;
  /** Conductor length, metres. */
  lengthM: number;
  /** Copper thickness, metres. */
  thicknessM: number;
  /** Conductor resistivity at 20 °C, Ω·m. */
  resistivity?: number;
  /** Ambient temperature °C (for hot resistance). */
  ambientC?: number;
}

/** Required cross-section area (m²) for `current` at `deltaT`, per IPC-2221. */
export function ipc2221AreaM2(currentA: number, deltaTC: number, external: boolean): number {
  const k = external ? K_EXTERNAL : K_INTERNAL;
  const areaMil2 = (currentA / (k * deltaTC ** 0.44)) ** (1 / 0.725);
  return areaMil2 / (MIL_PER_M * MIL_PER_M);
}

/** Max current for a copper cross-section (m²), per IPC-2221. */
export function ipc2221CurrentA(areaM2: number, deltaTC: number, external: boolean): number {
  const k = external ? K_EXTERNAL : K_INTERNAL;
  const areaMil2 = areaM2 * MIL_PER_M * MIL_PER_M;
  return k * deltaTC ** 0.44 * areaMil2 ** 0.725;
}

export function trackWidth(p: TrackWidthParams, external: boolean): TrackLayerResult {
  const rho = p.resistivity ?? COPPER_RESISTIVITY_OHM_M;
  const areaM2 = ipc2221AreaM2(p.currentA, p.deltaTC, external);
  const widthM = areaM2 / p.thicknessM;
  // Resistance at the conductor's actual (ambient + rise) temperature.
  const tempC = (p.ambientC ?? 20) + p.deltaTC;
  const rhoHot = rho * (1 + COPPER_TEMP_COEFF_PER_K * (tempC - 20));
  const resistanceOhm = (rhoHot * p.lengthM) / areaM2;
  const voltageDrop = resistanceOhm * p.currentA;
  return {
    widthM,
    areaM2,
    resistanceOhm,
    voltageDrop,
    powerLossW: voltageDrop * p.currentA,
  };
}
