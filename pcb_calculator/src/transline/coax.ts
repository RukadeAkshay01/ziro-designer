/**
 * Coaxial line — faithful port of KiCad's `transline_calculations/coax.cpp`
 * (Pozar, "Microwave Engineering" 4th ed. §2.2, §3.5). TEM Z0, electrical
 * length, dielectric/conductor loss and higher-order TE/TM mode cut-offs.
 * Counterpart: KiCad `common/transline_calculations/coax.cpp`.
 */

import {
  C0,
  LOG2DB,
  type TcElectrical,
  ZF0,
  degToRad,
  radToDeg,
  skinDepth,
  surfaceResistance,
} from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

export interface CoaxPhysical {
  /** Inner conductor diameter, m. */
  innerDiaM: number;
  /** Shield (outer conductor inner) diameter, m. */
  outerDiaM: number;
  /** Line length, m. */
  lengthM: number;
}

export interface CoaxResult extends TranslineAnalysis {
  extra: { te11CutoffHz: number };
  /** Propagating TE modes (KiCad "H(1,1) …"), or "none". */
  teModes: string;
  /** Propagating TM modes (KiCad "E(0,1) …"), or "none". */
  tmModes: string;
}

/** Higher-order mode lists (KiCad UpdateModeCutoffs). */
function modeCutoffs(
  din: number,
  dout: number,
  epsr: number,
  mur: number,
  freq: number,
): { te11: number; te: string; tm: string } {
  const sqrtMuEr = Math.sqrt(epsr * mur);
  const fcTE11 = (2.0 * C0) / (Math.PI * sqrtMuEr * (din + dout));
  const fcStep = C0 / (sqrtMuEr * (dout - din));

  let te = '';
  let tm = '';
  if (fcTE11 <= freq) {
    te = 'H(1,1) ';
    for (let m = 2; m < 10; m++) {
      const fc = fcTE11 + (m - 1) * fcStep;
      if (fc > freq) break;
      te += `H(1,${m}) `;
    }
  }
  for (let m = 1; m < 10; m++) {
    const fc = m * fcStep;
    if (fc > freq) break;
    tm += `E(0,${m}) `;
  }
  return { te11: fcTE11, te: te.trim() || 'none', tm: tm.trim() || 'none' };
}

export function coaxAnalyze(phys: CoaxPhysical, el: TcElectrical): CoaxResult {
  const { innerDiaM: din, outerDiaM: dout, lengthM: len } = phys;
  const { epsilonR: epsr, mur, tanD } = el;

  const z0 = (ZF0 / (2.0 * Math.PI * Math.sqrt(epsr))) * Math.log(dout / din);
  const lambdaG = C0 / el.frequencyHz / Math.sqrt(epsr * mur);
  const angLRad = (2.0 * Math.PI * len) / lambdaG;

  // Dielectric loss αd = (π/c)·f·√εr·tanδ, in dB/m after LOG2DB.
  const alphaD = (Math.PI / C0) * el.frequencyHz * Math.sqrt(epsr) * tanD * LOG2DB;
  // Conductor loss αc = √εr·(1/Din+1/Dout)/ln(Dout/Din)·Rs/ZF0, dB/m.
  const rs = surfaceResistance(el);
  const alphaC =
    ((Math.sqrt(epsr) * (1.0 / din + 1.0 / dout)) / Math.log(dout / din)) * (rs / ZF0) * LOG2DB;

  const modes = modeCutoffs(din, dout, epsr, mur, el.frequencyHz);

  return {
    z0,
    epsEff: epsr,
    angleDeg: radToDeg(angLRad),
    conductorLossDb: alphaC * len,
    dielectricLossDb: alphaD * len,
    skinDepthM: skinDepth(el),
    extra: { te11CutoffHz: modes.te11 },
    teModes: modes.te,
    tmModes: modes.tm,
  };
}

/**
 * Synthesis (KiCad COAX::Synthesize). Solve one diameter for the target Z0,
 * then the length for the electrical angle. `target` picks which diameter is
 * solved (default: inner).
 */
export function coaxSynthesize(
  phys: CoaxPhysical,
  el: TcElectrical,
  z0Target: number,
  angleDeg: number,
  target: 'inner' | 'outer' = 'inner',
): CoaxPhysical | null {
  const { epsilonR: epsr, mur } = el;
  const k = ((z0Target * Math.sqrt(epsr)) / ZF0) * 2.0 * Math.PI;
  const out = { ...phys };
  if (target === 'inner') out.innerDiaM = phys.outerDiaM / Math.exp(k);
  else out.outerDiaM = phys.innerDiaM * Math.exp(k);

  if (!(out.innerDiaM > 0) || !(out.outerDiaM > 0) || out.innerDiaM >= out.outerDiaM) return null;

  const lambdaG = C0 / el.frequencyHz / Math.sqrt(epsr * mur);
  out.lengthM = (lambdaG * degToRad(angleDeg)) / (2.0 * Math.PI);
  return out;
}
