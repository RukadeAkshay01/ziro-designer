/**
 * Shared constants and helpers for the transmission-line models, ported from
 * KiCad's `common/transline_calculations/` (units.h + transline_calculation_base).
 * These are faithful ports of the standard microwave formulas; results match
 * KiCad's calculator to the precision of the models.
 */

export const MU0 = 12.566370614e-7; // magnetic constant, H/m
export const E0 = 8.854e-12; // permittivity of free space, F/m
export const C0 = 299792458.0; // speed of light, m/s
export const ZF0 = 376.730313412; // free-space wave impedance, Ω
export const LOG2DB = 20.0 / Math.log(10); // Nepers → dB (≈ 8.68589)
export const UNIT_MICRON = 1e-6;

/** Common electrical inputs shared by every line type. */
export interface TcElectrical {
  frequencyHz: number;
  /** Substrate/dielectric relative permittivity. */
  epsilonR: number;
  /** Dielectric loss tangent. */
  tanD: number;
  /** Conductor conductivity, S/m (copper ≈ 5.8e7). */
  sigma: number;
  /** Relative permeability of the dielectric (usually 1). */
  mur: number;
  /** Relative permeability of the conductor (usually 1). */
  murC: number;
}

/** Skin depth δ = 1/√(π·f·µrc·µ0·σ). */
export function skinDepth(el: TcElectrical): number {
  return 1.0 / Math.sqrt(Math.PI * el.frequencyHz * el.murC * MU0 * el.sigma);
}

/** Surface resistance Rs = √(π·f·µrc·µ0/σ). */
export function surfaceResistance(el: TcElectrical): number {
  return Math.sqrt((Math.PI * el.frequencyHz * el.murC * MU0) / el.sigma);
}

/** Propagation delay per unit length (ps/cm) from effective permittivity. */
export function unitPropagationDelay(epsilonEff: number): number {
  return Math.sqrt(epsilonEff) * (1.0e10 / 2.99e8);
}

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Complete elliptic integrals of the first (K) and second (E) kind, computed by
 * the arithmetic-geometric mean, faithful to KiCad's
 * `TRANSLINE_CALCULATION_BASE::EllipticIntegral`. `arg` is the modulus squared
 * (m = k²). Returns `[K, E]`.
 */
export function ellipticIntegral(arg: number): [number, number] {
  const NR_EPSI = 2.2204460492503131e-16;
  const iMax = 16;

  if (arg === 1.0) return [Number.POSITIVE_INFINITY, 0];
  if (arg === Number.NEGATIVE_INFINITY) return [0, Number.POSITIVE_INFINITY];

  let fk = 1;
  let fe = 1;
  let da = arg;
  if (arg < 0) {
    fk = 1 / Math.sqrt(1 - arg);
    fe = Math.sqrt(1 - arg);
    da = -arg / (1 - arg);
  }

  let a = 1;
  let b = Math.sqrt(1 - da);
  let c = Math.sqrt(da);
  let fr = 0.5;
  let s = fr * c * c;
  let i = 0;
  for (; i < iMax; i++) {
    const t = (a + b) / 2;
    c = (a - b) / 2;
    b = Math.sqrt(a * b);
    a = t;
    fr *= 2;
    s += fr * c * c;
    if (c / a < NR_EPSI) break;
  }

  if (i >= iMax) return [0, 0];
  let k = Math.PI / 2 / a;
  let e = ((Math.PI / 2) * (1 - s)) / a;
  if (arg < 0) {
    k *= fk;
    e *= fe;
  }
  return [k, e];
}

/** K(k) for a modulus k (not k²), matching KiCad's `EllipticIntegral(k).first`. */
export const ellipticK = (k: number): number => ellipticIntegral(k * k)[0];

// ---------------------------------------------------------------------------
// Djordjevic–Sarkar causal wideband Debye dielectric model.
// Port of KiCad `common/transline_calculations/dielectric_djordjevic_sarkar.cpp`
// (Djordjevic et al., IEEE Trans. EMC 43(4):662-667, 2001, eqs. (8)-(11)).
// ---------------------------------------------------------------------------

export interface DjordjevicSarkarModel {
  lossless: boolean;
  epsInf: number;
  m: number;
  f1: number;
  f2: number;
}

/**
 * Fit the model to the substrate spec (εr, tan δ at fSpec). Returns null for
 * invalid inputs — KiCad falls back to the constant model in that case.
 */
export function djordjevicSarkarFit(
  epsRSpec: number,
  tanDSpec: number,
  fSpec: number,
  f1 = 1.0e3,
  f2 = 1.0e12,
): DjordjevicSarkarModel | null {
  if (!(f1 > 0.0) || !(f2 > f1) || !(fSpec >= f1) || !(fSpec <= f2)) return null;

  if (tanDSpec === 0.0) return { lossless: true, epsInf: epsRSpec, m: 0.0, f1, f2 };

  // k = log((f2 + j·fSpec) / (f1 + j·fSpec))
  const kRe = 0.5 * Math.log((f2 * f2 + fSpec * fSpec) / (f1 * f1 + fSpec * fSpec));
  const kIm = Math.atan2(fSpec, f2) - Math.atan2(fSpec, f1);

  return {
    lossless: false,
    m: (-tanDSpec * epsRSpec) / kIm,
    epsInf: epsRSpec * (1.0 + (tanDSpec * kRe) / kIm),
    f1,
    f2,
  };
}

/** Complex ε(f), eq. (8): εinf + m·log((f2 + j·f)/(f1 + j·f)). */
function dsComplexEpsilonAt(ds: DjordjevicSarkarModel, f: number): [number, number] {
  if (ds.lossless) return [ds.epsInf, 0.0];
  const logRe = 0.5 * Math.log((ds.f2 * ds.f2 + f * f) / (ds.f1 * ds.f1 + f * f));
  const logIm = Math.atan2(f, ds.f2) - Math.atan2(f, ds.f1);
  return [ds.epsInf + ds.m * logRe, ds.m * logIm];
}

export const dsEpsilonRealAt = (ds: DjordjevicSarkarModel, f: number): number =>
  dsComplexEpsilonAt(ds, f)[0];

export function dsTanDeltaAt(ds: DjordjevicSarkarModel, f: number): number {
  if (ds.lossless) return 0.0;
  const [re, im] = dsComplexEpsilonAt(ds, f);
  return -im / re;
}

/** Panel-level dielectric model selection (KiCad DIELECTRIC_MODEL_SEL). */
export interface DielectricModelParams {
  model: 'constant' | 'djordjevic_sarkar';
  /** Frequency at which the substrate εr / tan δ are specified, Hz. */
  specFreqHz?: number;
}

/**
 * The substrate values an analysis should actually use — the constant inputs,
 * or the Djordjevic–Sarkar dispersion of them at the operating frequency
 * (KiCad UpdateDielectricModel + GetDispersedEpsilonR/TanDelta; invalid spec
 * frequency falls back to the constant model).
 */
export function dispersedSubstrate(
  el: TcElectrical,
  diel?: DielectricModelParams,
): { epsilonR: number; tanD: number } {
  if (diel?.model !== 'djordjevic_sarkar') return { epsilonR: el.epsilonR, tanD: el.tanD };
  const fSpec = diel.specFreqHz ?? NaN;
  if (!Number.isFinite(fSpec) || fSpec <= 0.0) return { epsilonR: el.epsilonR, tanD: el.tanD };
  const ds = djordjevicSarkarFit(el.epsilonR, el.tanD, fSpec);
  if (!ds) return { epsilonR: el.epsilonR, tanD: el.tanD };
  return {
    epsilonR: dsEpsilonRealAt(ds, el.frequencyHz),
    tanD: dsTanDeltaAt(ds, el.frequencyHz),
  };
}
