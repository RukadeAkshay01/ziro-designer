/**
 * Shared transmission-line infrastructure: physical constants, skin depth,
 * elliptic-integral ratio, and the generic synthesis root-finder.
 * Counterpart: KiCad `pcb_calculator/transline/transline.cpp` + `units.h`.
 */

export const C0 = 299792458; // m/s
export const MU0 = 4e-7 * Math.PI; // H/m
export const ETA0 = 376.730313668; // Ω, impedance of free space

/** Common electrical inputs of every line type. */
export interface TranslineElectrical {
  frequencyHz: number;
  /** Substrate relative permittivity. */
  epsilonR: number;
  /** Dielectric loss tangent. */
  tanD: number;
  /** Conductor conductivity, S/m (copper ≈ 5.8e7). */
  sigma: number;
  /** Conductor relative permeability. */
  murC: number;
}

export interface TranslineAnalysis {
  /** Characteristic impedance, Ω. */
  z0: number;
  /** Effective permittivity. */
  epsEff: number;
  /** Electrical length, degrees, for the given physical length. */
  angleDeg: number;
  /** Conductor loss, dB (over the physical length); NaN if not modelled. */
  conductorLossDb: number;
  /** Dielectric loss, dB (over the physical length); NaN if not modelled. */
  dielectricLossDb: number;
  /** Skin depth, m; NaN if not applicable. */
  skinDepthM: number;
  /** Extra per-line results, e.g. even/odd impedances or cutoff frequencies. */
  extra?: Record<string, number>;
}

/** Skin depth δ = sqrt(1/(π·f·µ·σ)). */
export function skinDepth(frequencyHz: number, sigma: number, murC: number): number {
  return 1 / Math.sqrt(Math.PI * frequencyHz * MU0 * murC * sigma);
}

/** Electrical length (deg) of `lengthM` at `frequencyHz` with `epsEff`. */
export function electricalLengthDeg(lengthM: number, frequencyHz: number, epsEff: number): number {
  const lambda = C0 / (frequencyHz * Math.sqrt(epsEff));
  return (lengthM / lambda) * 360;
}

/** Physical length (m) for an electrical length in degrees. */
export function physicalLengthM(angleDeg: number, frequencyHz: number, epsEff: number): number {
  const lambda = C0 / (frequencyHz * Math.sqrt(epsEff));
  return (angleDeg / 360) * lambda;
}

/**
 * Ratio K(k)/K'(k) of complete elliptic integrals (Hilberg's approximation,
 * accurate to ~3 ppm — the standard form used in CPW models).
 */
export function ellipticRatio(k: number): number {
  if (k < 0 || k > 1) return NaN;
  const kp = Math.sqrt(1 - k * k);
  if (k > Math.SQRT1_2) {
    // K/K' = ln(2(1+√k)/(1−√k)) / π  for 1/√2 ≤ k ≤ 1
    return Math.log((2 * (1 + Math.sqrt(k))) / (1 - Math.sqrt(k))) / Math.PI;
  }
  return Math.PI / Math.log((2 * (1 + Math.sqrt(kp))) / (1 - Math.sqrt(kp)));
}

/**
 * Solve f(x) = target over [lo, hi] by bisection, assuming f is monotonic.
 * Used to synthesise a physical dimension from a wanted Z0.
 */
export function bisectSolve(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  iterations = 80,
): number {
  let flo = f(lo) - target;
  const fhi = f(hi) - target;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return NaN;
  if (flo * fhi > 0) return NaN; // target not bracketed
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const fm = f(m) - target;
    if (fm === 0) return m;
    if (flo * fm < 0) b = m;
    else {
      a = m;
      flo = fm;
    }
  }
  return (a + b) / 2;
}
