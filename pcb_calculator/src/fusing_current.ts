/**
 * Copper conductor fusing (melting) current, using the energy-balance model:
 * the I²R·t energy dissipated over the fuse time must supply the heat to raise
 * the copper to its melting point plus the latent heat of fusion. Any one of
 * width, thickness, current or time can be solved from the other three.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_fusing_current.cpp`.
 *
 * Copper only, matching KiCad: cp = 385 J/(kg·K), latent heat 205350 J/kg,
 * density 8940 kg/m³, ρ₂₀ = 1.72e-8 Ω·m, α = 0.00393 /K.
 */

const ABS_ZERO = -273.15;
const LATENT_HEAT = 205350; // J/kg (phase change)
const CP = 385; // J/(kg·K)
const DENSITY = 8940; // kg/m³
const RHO20 = 1.72e-8; // Ω·m at 20 °C (293 K)
const ALPHA = 0.00393; // 1/K

export type FusingSolveFor = 'width' | 'thickness' | 'current' | 'time';

export interface FusingParams {
  /** Ambient temperature, °C. */
  ambientC: number;
  /** Melting temperature, °C (copper: 1084). */
  meltingC: number;
  /** Conductor width, m. */
  widthM: number;
  /** Conductor thickness, m. */
  thicknessM: number;
  /** Applied current, A. */
  currentA: number;
  /** Fuse time, s. */
  timeS: number;
  /** Which quantity to solve for; the other three are inputs. */
  solveFor: FusingSolveFor;
}

export interface FusingResult {
  widthM: number;
  thicknessM: number;
  currentA: number;
  timeS: number;
  error?: string;
  /** Validity-domain caveat (adiabatic model breaks down for long fuse times). */
  comment?: string;
}

/** Energy-per-volume ÷ average resistivity coefficient (t = coeff·(A/I)²). */
function coefficient(ambientC: number, meltingC: number): number {
  const deltaEnthalpy = (meltingC - ambientC) * CP;
  const volumicEnergy = DENSITY * (deltaEnthalpy + LATENT_HEAT);
  const ra = ((ambientC - ABS_ZERO - 293) * ALPHA + 1) * RHO20;
  const rm = ((meltingC - ABS_ZERO - 293) * ALPHA + 1) * RHO20;
  const r = (ra + rm) / 2;
  return volumicEnergy / r;
}

/**
 * Adiabatic-model validity check, following the paper KiCad cites
 * (https://adam-research.de/pdfs/TRM_WhitePaper10_AdiabaticWire.pdf): the track
 * is approximated by a circle of the same area; if the fuse time is not short
 * compared to the radiative thermal time constant τ, the computed current is
 * underestimated.
 */
function validityComment(areaM2: number, timeS: number, meltingC: number): string | undefined {
  const r = Math.sqrt(areaM2 / Math.PI); // radius in m
  const epsilon = 5.67e-8; // Stefan-Boltzmann constant, W/(m²·K⁴)
  const sigma = 0.5; // surface radiative emissivity (between polished and oxidized)
  const tmKelvin = meltingC - ABS_ZERO;
  const frad = 0.5 * (tmKelvin + 293) * (tmKelvin + 293) * (tmKelvin + 293);
  const tau = (CP * DENSITY * r) / (epsilon * sigma * frad * 2);
  if (2 * timeS < tau) return undefined;
  return 'Current calculation is underestimated due to long fusing time.';
}

export function fusingCurrent(p: FusingParams): FusingResult {
  const out: FusingResult = {
    widthM: p.widthM,
    thicknessM: p.thicknessM,
    currentA: p.currentA,
    timeS: p.timeS,
  };
  if (!(p.meltingC > p.ambientC)) {
    return { ...out, error: 'Melting temperature must exceed ambient.' };
  }
  const coeff = coefficient(p.ambientC, p.meltingC);

  switch (p.solveFor) {
    case 'current': {
      if (!(p.widthM > 0) || !(p.thicknessM > 0) || !(p.timeS > 0))
        return { ...out, error: 'Enter positive width, thickness and time.' };
      const area = p.widthM * p.thicknessM;
      out.currentA = area * Math.sqrt(coeff / p.timeS);
      out.comment = validityComment(area, out.timeS, p.meltingC);
      return out;
    }
    case 'time': {
      if (!(p.widthM > 0) || !(p.thicknessM > 0) || !(p.currentA > 0))
        return { ...out, error: 'Enter positive width, thickness and current.' };
      const area = p.widthM * p.thicknessM;
      out.timeS = (coeff * area * area) / (p.currentA * p.currentA);
      out.comment = validityComment(area, out.timeS, p.meltingC);
      return out;
    }
    case 'width': {
      if (!(p.thicknessM > 0) || !(p.currentA > 0) || !(p.timeS > 0))
        return { ...out, error: 'Enter positive thickness, current and time.' };
      const area = p.currentA / Math.sqrt(coeff / p.timeS);
      out.widthM = area / p.thicknessM;
      out.comment = validityComment(area, out.timeS, p.meltingC);
      return out;
    }
    case 'thickness': {
      if (!(p.widthM > 0) || !(p.currentA > 0) || !(p.timeS > 0))
        return { ...out, error: 'Enter positive width, current and time.' };
      const area = p.currentA / Math.sqrt(coeff / p.timeS);
      out.thicknessM = area / p.widthM;
      out.comment = validityComment(area, out.timeS, p.meltingC);
      return out;
    }
  }
}
