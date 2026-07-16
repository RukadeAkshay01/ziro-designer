/**
 * Rectangular waveguide — faithful port of KiCad's
 * `transline_calculations/rectwaveguide.cpp` (Pozar §3.3): TE10 impedance,
 * guide wavelength, per-mode conductor loss, dielectric loss and the TE/TM
 * mode lists. Below cutoff the guide is evanescent (Z0 = 0).
 * Counterpart: KiCad `common/transline_calculations/rectwaveguide.cpp`.
 */

import { C0, LOG2DB, MU0, type TcElectrical, ZF0, skinDepth } from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

export interface RectWaveguidePhysical {
  /** Broad wall inner width a, m. */
  aM: number;
  /** Narrow wall inner height b, m. */
  bM: number;
  /** Guide length, m. */
  lengthM: number;
}

export interface RectWaveguideResult extends TranslineAnalysis {
  extra: {
    fcTE10Hz: number;
    fcTE20Hz: number;
    fcTE01Hz: number;
    guideWavelengthM: number;
  };
  teModes: string;
  tmModes: string;
}

const MAX_INDEX = 6;

function kValSquare(el: TcElectrical): number {
  const k = (2.0 * Math.PI * el.frequencyHz * Math.sqrt(el.mur * el.epsilonR)) / C0;
  return k * k;
}
function kcSquare(a: number, b: number, m: number, n: number): number {
  return ((m * Math.PI) / a) ** 2 + ((n * Math.PI) / b) ** 2;
}
function fc(a: number, b: number, el: TcElectrical, m: number, n: number): number {
  return (Math.sqrt(kcSquare(a, b, m, n) / el.mur / el.epsilonR) * C0) / (2.0 * Math.PI);
}

function alphaC(phys: RectWaveguidePhysical, el: TcElectrical): number {
  const { aM: a, bM: b } = phys;
  const f = el.frequencyHz;
  const rs = Math.sqrt((Math.PI * f * el.murC * MU0) / el.sigma);
  let ac = 0.0;
  const mmax = Math.floor(f / fc(a, b, el, 1, 0));
  const nmax = mmax;

  for (let n = 0; n <= nmax; n++) {
    for (let m = 1; m <= mmax; m++) {
      const fCut = fc(a, b, el, m, n);
      if (f <= fCut) continue;
      const r = (fCut / f) ** 2;
      if (n === 0) {
        ac += (rs / (b * ZF0 * Math.sqrt(1.0 - r))) * (1.0 + ((2.0 * b) / a) * r);
      } else {
        ac +=
          ((2.0 * rs) / (b * ZF0 * Math.sqrt(1.0 - r))) *
          ((1.0 + b / a) * r +
            (1.0 - r) * (((b / a) * ((b / a) * m ** 2 + n ** 2)) / (((b * m) / a) ** 2 + n ** 2)));
      }
    }
  }
  for (let n = 1; n <= nmax; n++) {
    for (let m = 1; m <= mmax; m++) {
      const fCut = fc(a, b, el, m, n);
      if (f <= fCut) continue;
      const r = (fCut / f) ** 2;
      ac +=
        ((2.0 * rs) / (b * ZF0 * Math.sqrt(1.0 - r))) *
        ((m ** 2 * (b / a) ** 3 + n ** 2) / (((m * b) / a) ** 2 + n ** 2));
    }
  }
  return ac * LOG2DB;
}

function alphaCCutoff(phys: RectWaveguidePhysical, el: TcElectrical): number {
  return LOG2DB * Math.sqrt(kcSquare(phys.aM, phys.bM, 1, 0) - kValSquare(el));
}

function alphaD(phys: RectWaveguidePhysical, el: TcElectrical): number {
  const kSq = kValSquare(el);
  const beta = Math.sqrt(kSq - kcSquare(phys.aM, phys.bM, 1, 0));
  return ((kSq * el.tanD) / (2.0 * beta)) * LOG2DB;
}

function modeStrings(phys: RectWaveguidePhysical, el: TcElectrical): { te: string; tm: string } {
  const { aM: a, bM: b } = phys;
  const f = el.frequencyHz;
  let te = '';
  let tm = '';
  if (f >= fc(a, b, el, 1, 0)) {
    for (let m = 0; m <= MAX_INDEX; m++)
      for (let n = 0; n <= MAX_INDEX; n++) {
        if (m === 0 && n === 0) continue;
        if (f >= fc(a, b, el, m, n)) te += `H(${m},${n}) `;
      }
  }
  if (f >= fc(a, b, el, 1, 1)) {
    for (let m = 1; m <= MAX_INDEX; m++)
      for (let n = 1; n <= MAX_INDEX; n++) if (f >= fc(a, b, el, m, n)) tm += `E(${m},${n}) `;
  }
  return { te: te.trim() || 'none', tm: tm.trim() || 'none' };
}

export function rectWaveguideAnalyze(
  phys: RectWaveguidePhysical,
  el: TcElectrical,
): RectWaveguideResult {
  const { aM: a, bM: b, lengthM: len } = phys;
  const f = el.frequencyHz;
  const kSq = kValSquare(el);
  const kc10Sq = kcSquare(a, b, 1, 0);
  const fc10 = fc(a, b, el, 1, 0);
  const modes = modeStrings(phys, el);
  const extra = {
    fcTE10Hz: fc10,
    fcTE20Hz: fc(a, b, el, 2, 0),
    fcTE01Hz: fc(a, b, el, 0, 1),
    guideWavelengthM: kc10Sq <= kSq ? (2.0 * Math.PI) / Math.sqrt(kSq - kc10Sq) : NaN,
  };

  if (kc10Sq <= kSq) {
    const factor = Math.sqrt(1.0 - (fc10 / f) ** 2);
    const z0 = (ZF0 * Math.sqrt(el.mur / el.epsilonR)) / factor;
    const lambdaG = (2.0 * Math.PI) / Math.sqrt(kSq - kc10Sq);
    return {
      z0,
      epsEff: 1.0 - (fc10 / f) ** 2,
      angleDeg: ((2.0 * Math.PI * len) / lambdaG) * (180 / Math.PI),
      conductorLossDb: alphaC(phys, el) * len,
      dielectricLossDb: alphaD(phys, el) * len,
      skinDepthM: skinDepth(el),
      extra,
      teModes: modes.te,
      tmModes: modes.tm,
    };
  }
  // Evanescent (below cutoff).
  return {
    z0: NaN,
    epsEff: NaN,
    angleDeg: NaN,
    conductorLossDb: alphaCCutoff(phys, el) * len,
    dielectricLossDb: NaN,
    skinDepthM: skinDepth(el),
    extra,
    teModes: modes.te,
    tmModes: modes.tm,
  };
}

/** Synthesis (KiCad): solve the broad wall a for the target Z0, then length. */
export function rectWaveguideSynthesize(
  phys: RectWaveguidePhysical,
  el: TcElectrical,
  z0Target: number,
  angleDeg: number,
): RectWaveguidePhysical | null {
  const eta = ZF0 * Math.sqrt(el.mur / el.epsilonR);
  const arg = 1.0 - (eta / z0Target) ** 2;
  if (!(arg > 0)) return null;
  const a = C0 / (Math.sqrt(el.mur * el.epsilonR) * 2.0 * el.frequencyHz * Math.sqrt(arg));
  if (!(a > 0)) return null;
  const next = { ...phys, aM: a };
  const kSq = kValSquare(el);
  const beta = Math.sqrt(kSq - kcSquare(a, phys.bM, 1, 0));
  if (!(beta > 0)) return null;
  const lambdaG = (2.0 * Math.PI) / beta;
  next.lengthM = (((angleDeg * Math.PI) / 180) * lambdaG) / (2.0 * Math.PI);
  return next;
}
