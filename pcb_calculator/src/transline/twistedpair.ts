/**
 * Twisted pair — faithful port of KiCad's
 * `transline_calculations/twistedpair.cpp` (Lefferson 1971; loss forms from
 * Wadell §3.2.3). Pitch angle θ = atan(T·π·Dout), εeff = εenv + (0.25 +
 * 0.0007·θ°²)·(εr − εenv), Z0 = ZF0/(π√εeff)·acosh(Dout/Din).
 * Counterpart: KiCad `common/transline_calculations/twistedpair.cpp`.
 */

import { C0, LOG2DB, type TcElectrical, ZF0, skinDepth } from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

export interface TwistedPairPhysical {
  /** Bare conductor diameter, m. */
  dinM: number;
  /** Outer (insulation) diameter, m. */
  doutM: number;
  /** Twists per metre. */
  twistsPerM: number;
  /** Cable length, m. */
  lengthM: number;
}

export interface TwistedPairElectrical extends TcElectrical {
  /** Relative permittivity of the surrounding medium (usually air = 1). */
  epsilonRenv: number;
}

function analyse(
  phys: TwistedPairPhysical,
  el: TwistedPairElectrical,
): {
  z0: number;
  epsEff: number;
} {
  const { dinM: din, doutM: dout, twistsPerM: twist } = phys;
  const thetaRad = Math.atan(twist * Math.PI * dout);
  const thetaDeg = thetaRad * (180.0 / Math.PI);
  const epsEff =
    el.epsilonRenv + (0.25 + 0.0007 * thetaDeg * thetaDeg) * (el.epsilonR - el.epsilonRenv);
  const z0 = (ZF0 / Math.PI / Math.sqrt(epsEff)) * Math.acosh(dout / din);
  return { z0, epsEff };
}

export function twistedPairAnalyze(
  phys: TwistedPairPhysical,
  el: TwistedPairElectrical,
): TranslineAnalysis {
  const { dinM: din, lengthM: len } = phys;
  const { z0, epsEff } = analyse(phys, el);
  const delta = skinDepth(el);

  const conductorLossDb = ((LOG2DB / 2.0) * len) / delta / el.sigma / Math.PI / z0 / (din - delta);
  const dielectricLossDb =
    ((LOG2DB * len * Math.PI) / C0) * el.frequencyHz * Math.sqrt(epsEff) * el.tanD;
  const angLRad = (2.0 * Math.PI * len * Math.sqrt(epsEff) * el.frequencyHz) / C0;

  return {
    z0,
    epsEff,
    angleDeg: (angLRad * 180) / Math.PI,
    conductorLossDb,
    dielectricLossDb,
    skinDepthM: delta,
  };
}

/** Synthesis: solve the bare conductor diameter for the target Z0, then length. */
export function twistedPairSynthesize(
  phys: TwistedPairPhysical,
  el: TwistedPairElectrical,
  z0Target: number,
  angleDeg: number,
): TwistedPairPhysical | null {
  const z0Of = (din: number): number => analyse({ ...phys, dinM: din }, el).z0;
  // Z0 rises as din shrinks; bracket from a sliver to just under dout.
  let lo = phys.doutM * 1e-4;
  let hi = phys.doutM * 0.9999;
  if ((z0Of(lo) - z0Target) * (z0Of(hi) - z0Target) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    // Z0 decreases with din, so shrink the upper bound when Z0 is too low.
    if (z0Of(mid) < z0Target) hi = mid;
    else lo = mid;
  }
  const din = (lo + hi) / 2;
  const epsEff = analyse({ ...phys, dinM: din }, el).epsEff;
  const lambda = C0 / (el.frequencyHz * Math.sqrt(epsEff));
  return { ...phys, dinM: din, lengthM: (angleDeg / 360) * lambda };
}
