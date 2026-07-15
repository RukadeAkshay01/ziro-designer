/**
 * Symmetric stripline — faithful port of KiCad's
 * `transline_calculations/stripline.cpp` (Wheeler/Cohn line impedance combined
 * as two parallel half-lines). For the centred strip the offset a = (h−t)/2.
 * Counterpart: KiCad `common/transline_calculations/stripline.cpp`.
 */

import { C0, LOG2DB, type TcElectrical, ZF0, skinDepth } from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

export interface StriplinePhysical {
  /** Strip width, m. */
  widthM: number;
  /** Ground-to-ground spacing h, m. */
  heightM: number;
  /** Strip thickness, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
}

/** KiCad STRIPLINE::lineImpedance — returns ZL and the conductor loss ac. */
function lineImpedance(
  aHeight: number,
  w: number,
  t: number,
  epsr: number,
  freq: number,
  sigma: number,
): { zl: number; ac: number } {
  const hmt = aHeight - t;
  let ac = Math.sqrt(freq / sigma / 17.2);
  let zl: number;

  if (w / hmt >= 0.35) {
    zl =
      w +
      (2.0 * aHeight * Math.log((2.0 * aHeight - t) / hmt) -
        t * Math.log((aHeight * aHeight) / hmt / hmt - 1.0)) /
        Math.PI;
    zl = (ZF0 * hmt) / Math.sqrt(epsr) / 4.0 / zl;

    ac *= (2.02e-6 * epsr * zl) / hmt;
    ac *=
      1.0 + (2.0 * w) / hmt + ((aHeight + t) / hmt / Math.PI) * Math.log((2.0 * aHeight) / t - 1.0);
  } else {
    let tdw = t / w;
    if (t / w > 1.0) tdw = w / t;
    let de = 1.0 + (tdw / Math.PI) * (1.0 + Math.log((4.0 * Math.PI) / tdw)) + 0.236 * tdw ** 1.65;
    de *= t / w > 1.0 ? t / 2.0 : w / 2.0;
    zl = (ZF0 / 2.0 / Math.PI / Math.sqrt(epsr)) * Math.log((4.0 * aHeight) / Math.PI / de);

    ac *= 0.01141 / zl / de;
    ac *=
      de / aHeight +
      0.5 +
      tdw / 2.0 / Math.PI +
      (0.5 / Math.PI) * Math.log((4.0 * Math.PI) / tdw) +
      0.1947 * tdw ** 0.65 -
      0.0767 * tdw ** 1.65;
  }
  return { zl, ac };
}

function analyseZ0(
  phys: StriplinePhysical,
  el: TcElectrical,
): { z0: number; ac1: number; ac2: number } {
  const { widthM: w, heightM: h, thicknessM: t } = phys;
  const a = (h - t) / 2.0; // centred strip
  const l1 = lineImpedance(2.0 * a + t, w, t, el.epsilonR, el.frequencyHz, el.sigma);
  const l2 = lineImpedance(2.0 * (h - a) - t, w, t, el.epsilonR, el.frequencyHz, el.sigma);
  const z0 = 2.0 / (1.0 / l1.zl + 1.0 / l2.zl);
  return { z0, ac1: l1.ac, ac2: l2.ac };
}

export function striplineAnalyze(phys: StriplinePhysical, el: TcElectrical): TranslineAnalysis {
  const { lengthM: len } = phys;
  const { z0, ac1, ac2 } = analyseZ0(phys, el);
  const angLRad = (2.0 * Math.PI * len * Math.sqrt(el.epsilonR) * el.frequencyHz) / C0;
  const dielectric =
    LOG2DB * len * (Math.PI / C0) * el.frequencyHz * Math.sqrt(el.epsilonR) * el.tanD;

  return {
    z0,
    epsEff: el.epsilonR,
    angleDeg: (angLRad * 180) / Math.PI,
    conductorLossDb: len * (ac1 + ac2),
    dielectricLossDb: dielectric,
    skinDepthM: skinDepth(el),
  };
}

/** Synthesis: solve the strip width for the target Z0 (KiCad MinimiseZ0Error1D). */
export function striplineSynthesize(
  phys: StriplinePhysical,
  el: TcElectrical,
  z0Target: number,
  angleDeg: number,
): StriplinePhysical | null {
  const z0Of = (w: number): number => analyseZ0({ ...phys, widthM: w }, el).z0;
  // Z0 falls monotonically with width; bracket from a sliver to very wide.
  let lo = phys.heightM * 1e-4;
  let hi = phys.heightM * 50;
  const target = z0Target;
  if ((z0Of(lo) - target) * (z0Of(hi) - target) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (z0Of(mid) > target) lo = mid;
    else hi = mid;
  }
  const w = (lo + hi) / 2;
  const lambda = C0 / (el.frequencyHz * Math.sqrt(el.epsilonR));
  return { ...phys, widthM: w, lengthM: (angleDeg / 360) * lambda };
}
