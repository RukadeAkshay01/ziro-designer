/**
 * Plated through-hole via characteristics: resistance, IPC-2221 ampacity,
 * thermal resistance, parasitic C/L, rise-time degradation and reactance.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_via_size.cpp`.
 *
 * The equations mirror the KiCad panel exactly (Johnson & Graham, "High-Speed
 * Digital Design", and IPC-2221 for the ampacity), so results match to the
 * displayed precision.
 */

export const COPPER_PLATING_RESISTIVITY_OHM_M = 1.72e-8;
/** Thermal resistivity of copper plating, m·K/W (≙ 401 W/(m·K)). */
export const COPPER_THERMAL_RESISTIVITY = 2.49e-3;

const UNIT_MIL = 0.0254e-3; // 1 mil in metres

export interface ViaSizeParams {
  /** Finished (drilled) hole diameter, m. */
  holeDiaM: number;
  /** Plating (barrel wall) thickness, m. */
  platingM: number;
  /** Via length (board thickness), m. */
  lengthM: number;
  /** Via pad diameter, m (for capacitance). */
  padDiaM: number;
  /** Clearance-hole (antipad) diameter in planes, m (for capacitance). */
  clearanceDiaM: number;
  /** Characteristic impedance of the line, Ω (for rise-time degradation). */
  z0Ohm: number;
  /** Relative permittivity of the substrate. */
  epsilonR: number;
  /** Applied current, A. */
  currentA: number;
  /** Plating resistivity, Ω·m. */
  resistivity: number;
  /** Allowed temperature rise, °C (for ampacity). */
  deltaTC: number;
  /** Signal pulse rise time, s (for reactance). */
  riseTimeS: number;
}

export interface ViaSizeResult {
  /** Barrel copper cross-section, m². */
  areaM2: number;
  resistanceOhm: number;
  voltageDrop: number;
  powerLossW: number;
  /** Max current for the allowed temperature rise (IPC-2221). */
  ampacityA: number;
  /** Thermal resistance end-to-end, K/W. */
  thermalResistance: number;
  /** Parasitic capacitance, F. */
  capacitanceF: number;
  /** Rise-time degradation from the via capacitance, s. */
  riseTimeDegradationS: number;
  /** Parasitic inductance, H. */
  inductanceH: number;
  /** Reactance at the signal's effective frequency (1/2·riseTime), Ω. */
  reactanceOhm: number;
}

export function viaSize(p: ViaSizeParams): ViaSizeResult {
  // Cross-sectional area of the plated barrel: π·(D + t)·t = π·((D/2+t)²−(D/2)²).
  const area = Math.PI * (p.holeDiaM + p.platingM) * p.platingM;

  const resistanceOhm = (p.resistivity * p.lengthM) / area;
  const voltageDrop = p.currentA * resistanceOhm;
  const powerLossW = p.currentA * voltageDrop;

  const thermalResistance = (COPPER_THERMAL_RESISTIVITY * p.lengthM) / area;

  // IPC-2221 ampacity uses the barrel area in mil².
  const areaMil2 = area / (UNIT_MIL * UNIT_MIL);
  const ampacityA = 0.048 * p.deltaTC ** 0.44 * areaMil2 ** 0.725;

  // Capacitance (F): 55.51·εr·L·D_pad / (D_clear − D_pad), lengths in metres.
  const capacitanceF =
    p.clearanceDiaM > p.padDiaM
      ? (55.51e-12 * p.epsilonR * p.lengthM * p.padDiaM) / (p.clearanceDiaM - p.padDiaM)
      : NaN;

  // 10–90 % rise-time degradation: 2.2·C·(Z0/2).
  const riseTimeDegradationS = (2.2 * capacitanceF * p.z0Ohm) / 2;

  // Inductance (H): (μ0/2π)·L·(ln(4L/D) + 1) = 200 nH/m · L · (…).
  const inductanceH = 2e-7 * p.lengthM * (Math.log((4 * p.lengthM) / p.holeDiaM) + 1);

  // Reactance at the signal frequency implied by the pulse rise time.
  const reactanceOhm = (Math.PI * inductanceH) / p.riseTimeS;

  return {
    areaM2: area,
    resistanceOhm,
    voltageDrop,
    powerLossW,
    ampacityA,
    thermalResistance,
    capacitanceF,
    riseTimeDegradationS,
    inductanceH,
    reactanceOhm,
  };
}
