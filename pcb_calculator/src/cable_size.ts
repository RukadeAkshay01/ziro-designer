/**
 * Cable (round-wire) size: AWG ↔ diameter ↔ area, plus KiCad's fully-linked
 * wire/application model — every field can be edited and back-solves the wire
 * radius, everything else recomputes from it.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_cable_size.cpp`
 * (updateAll / On*Change handlers) and `common_data.cpp` material lists.
 */

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

/**
 * Conductor materials, as in KiCad `StandardCableConductorList()` /
 * `StandardCableTempCoefList()`: resistivity at 20 °C (Ω·m) and temperature
 * coefficient (1/K at 20 °C).
 */
export interface CableConductorMaterial {
  name: string;
  rho20: number;
  alpha: number;
}

export const CABLE_CONDUCTOR_MATERIALS: readonly CableConductorMaterial[] = [
  { name: 'Cu, Copper', rho20: 1.72e-8, alpha: 3.93e-3 },
  { name: 'Al, Aluminum', rho20: 2.62e-8, alpha: 4.29e-3 },
  { name: 'NiCr, Nichrome', rho20: 100e-8, alpha: 0.4e-3 },
  { name: 'Fe, Iron', rho20: 9.71e-8, alpha: 5e-3 },
  { name: 'W, Tungsten', rho20: 5.6e-8, alpha: 4.5e-3 },
];

// KiCad panel_cable_size.cpp constants.
export const CABLE_VACUUM_PERMEABILITY = 1.256637e-6;
export const CABLE_RELATIVE_PERMEABILITY = 1;

/** Independent inputs of the linked model (everything but the radius). */
export interface CableParams {
  /** Resistivity at 20 °C, Ω·m. */
  rho20: number;
  /** Temperature coefficient at 20 °C, 1/K. */
  alpha: number;
  /** Conductor temperature, °C. */
  temperatureC: number;
  /** Max allowed current density, A/mm². */
  ampPerMm2: number;
  /** Applied current, A. */
  currentA: number;
  /** Conductor length, m. */
  lengthM: number;
}

/** Everything KiCad's updateAll() derives from the radius. */
export interface CableState {
  radiusM: number;
  diameterM: number;
  areaM2: number;
  /** Resistivity at the conductor temperature, Ω·m. */
  rhoHot: number;
  /** Linear resistance at temperature, Ω/m. */
  linearResistance: number;
  /** Frequency at which the skin depth equals the radius, Hz. */
  maxFrequencyHz: number;
  /** Area × current density, A. */
  ampacityA: number;
  /** DC resistance of the full length at temperature, Ω. */
  resistanceDcOhm: number;
  voltageDropV: number;
  dissipatedPowerW: number;
}

/** Resistivity at temperature (KiCad: ρref·(1 + α·(T − 20))). */
export const cableHotResistivity = (rho20: number, alpha: number, tempC: number): number =>
  rho20 * (1 + alpha * (tempC - 20));

/** Port of PANEL_CABLE_SIZE::updateAll — derive every field from the radius. */
export function cableUpdateAll(radiusM: number, p: CableParams): CableState {
  const areaM2 = Math.PI * radiusM * radiusM;
  const rhoHot = cableHotResistivity(p.rho20, p.alpha, p.temperatureC);
  const linearResistance = rhoHot / areaM2;
  const maxFrequencyHz =
    rhoHot /
    (Math.PI * radiusM * radiusM * CABLE_VACUUM_PERMEABILITY * CABLE_RELATIVE_PERMEABILITY);
  const m2ByAmpere = 1 / p.ampPerMm2 / 1e6;
  const resistanceDcOhm = linearResistance * p.lengthM;
  const voltageDropV = resistanceDcOhm * p.currentA;
  return {
    radiusM,
    diameterM: radiusM * 2,
    areaM2,
    rhoHot,
    linearResistance,
    maxFrequencyHz,
    ampacityA: areaM2 / m2ByAmpere,
    resistanceDcOhm,
    voltageDropV,
    dissipatedPowerW: voltageDropV * p.currentA,
  };
}

// Inverse solvers — one per editable field, matching KiCad's On*Change
// handlers. All take SI values; rhoHot is the temperature-adjusted resistivity.
export const cableRadiusFromDiameter = (diameterM: number): number => diameterM / 2;

export const cableRadiusFromArea = (areaM2: number): number => Math.sqrt(areaM2 / Math.PI);

export const cableRadiusFromLinResistance = (linROhmPerM: number, rhoHot: number): number =>
  Math.sqrt(rhoHot / linROhmPerM / Math.PI);

export const cableRadiusFromFrequency = (fHz: number, rhoHot: number): number =>
  Math.sqrt(rhoHot / fHz / Math.PI / CABLE_VACUUM_PERMEABILITY / CABLE_RELATIVE_PERMEABILITY);

export const cableRadiusFromAmpacity = (ampacityA: number, ampPerMm2: number): number =>
  Math.sqrt((ampacityA * (1 / ampPerMm2 / 1e6)) / Math.PI);

export const cableRadiusFromResistanceDc = (
  rdcOhm: number,
  rhoHot: number,
  lengthM: number,
): number => Math.sqrt(((rhoHot / rdcOhm) * lengthM) / Math.PI);

export const cableRadiusFromVDrop = (
  vdropV: number,
  rhoHot: number,
  lengthM: number,
  currentA: number,
): number => Math.sqrt(((rhoHot / vdropV) * lengthM * currentA) / Math.PI);

export const cableRadiusFromPower = (
  powerW: number,
  rhoHot: number,
  lengthM: number,
  currentA: number,
): number => Math.sqrt(((rhoHot / powerW) * lengthM * currentA * currentA) / Math.PI);
