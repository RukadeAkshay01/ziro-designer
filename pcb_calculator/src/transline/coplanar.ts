/**
 * Coplanar waveguide (with and without bottom ground) — faithful port of
 * KiCad's `transline_calculations/coplanar.cpp`. Quasi-static conformal mapping
 * (Ghione & Naldi) on AGM-based complete elliptic integrals, finite-thickness
 * correction (Gupta et al.), Gevorgian effective-permittivity dispersion and
 * Wheeler incremental-inductance conductor loss. The panel exposes no soldermask
 * or Djordjevic–Sarkar dielectric model, so those corrections take KiCad's
 * documented no-op paths and are omitted here.
 * Counterpart: KiCad `common/transline_calculations/coplanar.cpp`.
 */

import {
  C0,
  LOG2DB,
  MU0,
  type TcElectrical,
  ZF0,
  ellipticIntegral,
  skinDepth,
  unitPropagationDelay,
} from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

// KiCad's EllipticIntegral() interprets its argument as the *parameter* m
// (b = sqrt(1 - arg)), yet the coplanar code passes the modulus k straight in.
// The QA-pinned results (e.g. Z0 = 72.30 for the FR-4 vector) depend on that
// convention, so mirror it exactly rather than using the classical K(k).
const ellipticK = (arg: number): number => ellipticIntegral(arg)[0];

export interface CoplanarPhysical {
  /** Centre-strip width W, m. */
  widthM: number;
  /** Gap S between strip and coplanar grounds, m. */
  gapM: number;
  /** Substrate height H, m. */
  heightM: number;
  /** Strip thickness T, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
}

export interface CoplanarResult extends TranslineAnalysis {
  /** Propagation delay per unit length (ps/cm). */
  unitPropDelay: number;
}

export function coplanarAnalyze(
  phys: CoplanarPhysical,
  el: TcElectrical,
  withGround: boolean,
): CoplanarResult {
  const W = phys.widthM;
  const S = phys.gapM;
  const H = phys.heightM;
  const T = phys.thicknessM;
  const freq = el.frequencyHz;
  const epsr = el.epsilonR;
  const len = phys.lengthM;
  const tand = el.tanD;
  const sigma = el.sigma;

  // Quasi-static conformal mapping. k1 is the coplanar half-plane ratio.
  const k1 = W / (W + S + S);
  const kk1 = ellipticK(k1);
  const kpk1 = ellipticK(Math.sqrt(1.0 - k1 * k1));
  const q1 = kk1 / kpk1;

  let q3 = 0.0;
  let qz = 0.0;
  let er0 = 0.0;
  let zlFactor = 0.0;

  if (withGround) {
    const k3 =
      Math.tanh((Math.PI / 4.0) * (W / H)) / Math.tanh((Math.PI / 4.0) * ((W + S + S) / H));
    q3 = ellipticK(k3) / ellipticK(Math.sqrt(1.0 - k3 * k3));
    qz = 1.0 / (q1 + q3);
    er0 = 1.0 + q3 * qz * (epsr - 1.0);
    zlFactor = (ZF0 / 2.0) * qz;
  } else {
    const k2 =
      Math.sinh((Math.PI / 4.0) * (W / H)) / Math.sinh((Math.PI / 4.0) * ((W + S + S) / H));
    const q2 = ellipticK(k2) / ellipticK(Math.sqrt(1.0 - k2 * k2));
    er0 = 1.0 + ((epsr - 1.0) / 2.0) * (q2 / q1);
    zlFactor = ZF0 / 4.0 / q1;
  }

  // Finite-thickness correction (Gupta et al., eq. 7.98-7.100).
  if (T > 0.0) {
    const d = ((T * 1.25) / Math.PI) * (1.0 + Math.log((4.0 * Math.PI * W) / T));
    const se = S - d;
    const We = W + d;
    const ke = We / (We + se + se);
    const qe = ellipticK(ke) / ellipticK(Math.sqrt(1.0 - ke * ke));

    if (withGround) {
      qz = 1.0 / (qe + q3);
      er0 = 1.0 + q3 * qz * (epsr - 1.0);
      zlFactor = (ZF0 / 2.0) * qz;
    } else {
      zlFactor = ZF0 / 4.0 / qe;
    }

    er0 = er0 - (0.7 * (er0 - 1.0) * T) / S / (q1 + (0.7 * T) / S);
  }

  const srEr = Math.sqrt(epsr);
  const srEr0 = Math.sqrt(er0);

  // TE0 cutoff and the Gevorgian dispersion factor G.
  const fte = C0 / 4.0 / (H * Math.sqrt(epsr - 1.0));
  const p = Math.log(W / H);
  const u = 0.54 - (0.64 - 0.015 * p) * p;
  const v = 0.43 - (0.86 - 0.54 * p) * p;
  const G = Math.exp(u * Math.log(W / S) + v);

  // Wheeler incremental-inductance conductor loss (T > 0 only).
  let ac = 0.0;
  if (T > 0.0) {
    const n = ((1.0 - k1) * 8.0 * Math.PI) / (T * (1.0 + k1));
    const a = W / 2.0;
    const b = a + S;
    ac = (Math.PI + Math.log(n * a)) / a + (Math.PI + Math.log(n * b)) / b;
  }

  const acFactor = ac / (4.0 * ZF0 * kk1 * kpk1 * (1.0 - k1 * k1));
  const adFactor = (epsr / (epsr - 1.0)) * tand * Math.PI * (1.0 / C0);

  let srErF = srEr0;
  srErF += (srEr - srEr0) / (1.0 + G * (freq / fte) ** -1.8);

  const conductorLossDb =
    LOG2DB * len * acFactor * srEr0 * Math.sqrt((Math.PI * MU0 * freq) / sigma);
  const dielectricLossDb = LOG2DB * len * adFactor * freq * ((srErF * srErF - 1.0) / srErF);
  const angLRad = (2.0 * Math.PI * len * srErF * freq) / C0;
  const epsEff = srErF * srErF;

  return {
    z0: zlFactor / srErF,
    epsEff,
    angleDeg: (angLRad * 180) / Math.PI,
    conductorLossDb,
    dielectricLossDb,
    skinDepthM: skinDepth(el),
    unitPropDelay: unitPropagationDelay(epsEff),
  };
}

/** Synthesis: adjust the gap for a target Z0 (width kept), then the length. */
export function coplanarSynthesize(
  phys: CoplanarPhysical,
  el: TcElectrical,
  withGround: boolean,
  z0Target: number,
  angleDeg: number,
): CoplanarPhysical | null {
  const zOf = (s: number): number => coplanarAnalyze({ ...phys, gapM: s }, el, withGround).z0;
  // Z0 rises with the gap; bracket from a sliver to very wide. The finite-thickness
  // correction requires the gap to exceed the strip-widening term d (se = S − d > 0),
  // so floor the lower bracket there to keep the analysis finite.
  const T = phys.thicknessM;
  const dFloor =
    T > 0 ? ((T * 1.25) / Math.PI) * (1.0 + Math.log((4.0 * Math.PI * phys.widthM) / T)) : 0;
  let lo = Math.max(phys.widthM * 1e-4, dFloor * 1.0001);
  let hi = phys.widthM * 1000;
  const zLo = zOf(lo);
  const zHi = zOf(hi);
  if (!Number.isFinite(zLo) || !Number.isFinite(zHi)) return null;
  if ((zLo - z0Target) * (zHi - z0Target) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (zOf(mid) < z0Target) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  const r = coplanarAnalyze({ ...phys, gapM: s }, el, withGround);
  const lambda = C0 / (el.frequencyHz * Math.sqrt(r.epsEff));
  return { ...phys, gapM: s, lengthM: (angleDeg / 360) * lambda };
}
