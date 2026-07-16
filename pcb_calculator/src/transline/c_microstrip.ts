/**
 * Coupled microstrip lines — faithful port of KiCad's
 * `transline_calculations/coupled_microstrip.cpp` (Garg–Bahl static even/odd
 * model, Jansen thickness correction, Kirschning–Jansen even/odd dispersion and
 * impedance dispersion, per-mode conductor and dielectric loss). The single-line
 * reference is the ported Hammerstad–Jensen microstrip evaluated at zero
 * thickness. The panel exposes no top cover, surface roughness, soldermask or
 * Djordjevic–Sarkar model, so those corrections take KiCad's documented no-op
 * paths (cover → q_c = 1, ΔZ0_cover = 0) and are omitted here.
 * Counterpart: KiCad `common/transline_calculations/coupled_microstrip.cpp`.
 */

import { microstripAnalyze } from './microstrip.js';
import { C0, LOG2DB, type TcElectrical, ZF0, skinDepth } from './tc_common.js';
import type { TranslineAnalysis } from './transline.js';

export interface CoupledMicrostripPhysical {
  /** Trace width (each line), m. */
  widthM: number;
  /** Gap between the traces, m. */
  gapM: number;
  /** Substrate height, m. */
  heightM: number;
  /** Copper thickness, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
}

export interface CoupledMicrostripResult extends TranslineAnalysis {
  extra: {
    z0Even: number;
    z0Odd: number;
    epsEffEven: number;
    epsEffOdd: number;
    /** Coupling factor k = (Ze−Zo)/(Ze+Zo). */
    coupling: number;
    /** Differential impedance (2·Zo). */
    zDiff: number;
    /** Common-mode impedance (Ze/2). */
    zComm: number;
  };
}

// --- KiCad building blocks (names kept) ---

function deltaUThicknessSingle(u: number, tH: number): number {
  if (!(tH > 0.0)) return 0.0;
  return (
    ((1.25 * tH) / Math.PI) *
    (1.0 +
      Math.log(
        (2.0 + (4.0 * Math.PI * u - 2.0) / (1.0 + Math.exp(-100.0 * (u - 1.0 / (2.0 * Math.PI))))) /
          tH,
      ))
  );
}

const deltaQThickness = (u: number, tH: number): number =>
  ((2.0 * Math.log(2.0)) / Math.PI) * (tH / Math.sqrt(u));

function fillingFactorEven(u: number, g: number, er: number): number {
  const v = (u * (20.0 + g * g)) / (10.0 + g * g) + g * Math.exp(-g);
  const v3 = v * v * v;
  const v4 = v3 * v;
  const aE =
    1.0 +
    Math.log((v4 + (v * v) / 2704.0) / (v4 + 0.432)) / 49.0 +
    Math.log(1.0 + v3 / 5929.741) / 18.7;
  const bE = 0.564 * ((er - 0.9) / (er + 3.0)) ** 0.053;
  return (1.0 + 10.0 / v) ** (-aE * bE);
}

function fillingFactorOdd(u: number, g: number, er: number): number {
  const bOdd = (0.747 * er) / (0.15 + er);
  const cOdd = bOdd - (bOdd - 0.207) * Math.exp(-0.414 * u);
  const dOdd = 0.593 + 0.694 * Math.exp(-0.562 * u);
  return Math.exp(-cOdd * g ** dOdd);
}

interface SingleLine {
  z0Static: number; // Z0_0
  erEffStatic: number; // er_eff_0
  z0Dispersed: number; // Z0 (dispersed)
  erEffDispersed: number; // EPSILON_EFF (dispersed)
}

/** KiCad compute_single_line(): the aux microstrip at zero thickness, no cover. */
function singleLine(phys: CoupledMicrostripPhysical, el: TcElectrical): SingleLine {
  const r = microstripAnalyze(
    { widthM: phys.widthM, heightM: phys.heightM, thicknessM: 0, lengthM: phys.lengthM },
    el,
  );
  return {
    z0Static: r.z0Static,
    erEffStatic: r.epsEffStatic,
    z0Dispersed: r.z0,
    erEffDispersed: r.epsEff,
  };
}

interface Statics {
  erEffE0: number;
  erEffO0: number;
  z0E0: number;
  z0O0: number;
  wTe: number;
  wTo: number;
  single: SingleLine;
}

/** delta_u_thickness → er_eff_static → Z0_even_odd (no-cover path). */
function computeStatics(phys: CoupledMicrostripPhysical, el: TcElectrical): Statics {
  const er = el.epsilonR;
  const h = phys.heightM;
  const u = phys.widthM / h;
  const g = phys.gapM / h;
  const tH = phys.thicknessM / h;

  // delta_u_thickness()
  let wTe = phys.widthM;
  let wTo = phys.widthM;
  if (tH > 0.0) {
    const deltaU = deltaUThicknessSingle(u, tH);
    const deltaT = tH / (g * er);
    const deltaUe = deltaU * (1.0 - 0.5 * Math.exp((-0.69 * deltaU) / deltaT));
    const deltaUo = deltaUe + deltaT;
    wTe = phys.widthM + deltaUe * h;
    wTo = phys.widthM + deltaUo * h;
  }

  const single = singleLine(phys, el);
  const erEffSingle = single.erEffStatic;

  const uTe = wTe / h;
  const uTo = wTo / h;

  // er_eff_static() — cover effect q_c = 1 (no cover).
  let qInf = fillingFactorEven(uTe, g, er);
  let qT = deltaQThickness(uTe, tH);
  let q = qInf - qT; // × q_c(=1)
  const erEffE0 = 0.5 * (er + 1.0) + 0.5 * (er - 1.0) * q;

  qInf = fillingFactorOdd(uTo, g, er);
  qT = deltaQThickness(uTo, tH);
  q = qInf - qT; // × q_c(=1)
  const aO = 0.7287 * (erEffSingle - 0.5 * (er + 1.0)) * (1.0 - Math.exp(-0.179 * uTo));
  const erEffO0 = (0.5 * (er + 1.0) + aO - erEffSingle) * q + erEffSingle;

  // Z0_even_odd() — cover corrections ΔZ0 = 0 (no cover).
  const z0Single = single.z0Static;

  const Q1 = 0.8695 * uTe ** 0.194;
  const Q2 = 1.0 + 0.7519 * g + 0.189 * g ** 2.31;
  const Q3 =
    0.1975 +
    (16.6 + (8.4 / g) ** 6.0) ** -0.387 +
    Math.log(g ** 10.0 / (1.0 + (g / 3.4) ** 10.0)) / 241.0;
  const Q4 = (2.0 * Q1) / (Q2 * (Math.exp(-g) * uTe ** Q3 + (2.0 - Math.exp(-g)) * uTe ** -Q3));
  const z0E0 =
    (z0Single * Math.sqrt(erEffSingle / erEffE0)) /
    (1.0 - (Math.sqrt(erEffSingle) * Q4 * z0Single) / ZF0);

  const Q5 = 1.794 + 1.14 * Math.log(1.0 + 0.638 / (g + 0.517 * g ** 2.43));
  const Q6 =
    0.2305 +
    Math.log(g ** 10.0 / (1.0 + (g / 5.8) ** 10.0)) / 281.3 +
    Math.log(1.0 + 0.598 * g ** 1.154) / 5.1;
  const Q7 = (10.0 + 190.0 * g * g) / (1.0 + 82.3 * g * g * g);
  const Q8 = Math.exp(-6.5 - 0.95 * Math.log(g) - (g / 0.15) ** 5.0);
  const Q9 = Math.log(Q7) * (Q8 + 1.0 / 16.5);
  const Q10 = (Q2 * Q4 - Q5 * Math.exp(Math.log(uTo) * Q6 * uTo ** -Q9)) / Q2;
  const z0O0 =
    (z0Single * Math.sqrt(erEffSingle / erEffO0)) /
    (1.0 - (Math.sqrt(erEffSingle) * Q10 * z0Single) / ZF0);

  return { erEffE0, erEffO0, z0E0, z0O0, wTe, wTo, single };
}

interface FreqResult {
  erEffE: number;
  erEffO: number;
  z0E: number;
  z0O: number;
}

/** er_eff_freq() + Z0_dispersion(). */
function computeDispersion(
  phys: CoupledMicrostripPhysical,
  el: TcElectrical,
  st: Statics,
): FreqResult {
  const er = el.epsilonR;
  const h = phys.heightM;
  const u = phys.widthM / h;
  const g = phys.gapM / h;
  const fn = (el.frequencyHz * h) / 1e6; // GHz·mm

  // --- er_eff_freq() ---
  const P1 =
    0.27488 + (0.6315 + 0.525 / (1.0 + 0.0157 * fn) ** 20.0) * u - 0.065683 * Math.exp(-8.7513 * u);
  const P2 = 0.33622 * (1.0 - Math.exp(-0.03442 * er));
  const P3 = 0.0363 * Math.exp(-4.6 * u) * (1.0 - Math.exp(-((fn / 38.7) ** 4.97)));
  const P4 = 1.0 + 2.751 * (1.0 - Math.exp(-((er / 15.916) ** 8.0)));
  const P5 = 0.334 * Math.exp(-3.3 * (er / 15.0) ** 3.0) + 0.746;
  const P6 = P5 * Math.exp(-((fn / 18.0) ** 0.368));
  const P7 = 1.0 + 4.069 * P6 * g ** 0.479 * Math.exp(-1.347 * g ** 0.595 - 0.17 * g ** 2.5);
  const Fe = P1 * P2 * ((P3 * P4 + 0.1844 * P7) * fn) ** 1.5763;
  const erEffE = er - (er - st.erEffE0) / (1.0 + Fe);

  const P8 = 0.7168 * (1.0 + 1.076 / (1.0 + 0.0576 * (er - 1.0)));
  const P9 =
    P8 -
    0.7913 * (1.0 - Math.exp(-((fn / 20.0) ** 1.424))) * Math.atan(2.481 * (er / 8.0) ** 0.946);
  const P10 = 0.242 * (er - 1.0) ** 0.55;
  const P11 = 0.6366 * (Math.exp(-0.3401 * fn) - 1.0) * Math.atan(1.263 * (u / 3.0) ** 1.629);
  const P12 = P9 + (1.0 - P9) / (1.0 + 1.183 * u ** 1.376);
  const P13 = (1.695 * P10) / (0.414 + 1.605 * P10);
  const P14 = 0.8928 + 0.1072 * (1.0 - Math.exp(-0.42 * (fn / 20.0) ** 3.215));
  const P15 = Math.abs(1.0 - (0.8928 * (1.0 + P11) * P12 * Math.exp(-P13 * g ** 1.092)) / P14);
  const Fo = P1 * P2 * ((P3 * P4 + 0.1844) * fn * P15) ** 1.5763;
  const erEffO = er - (er - st.erEffO0) / (1.0 + Fo);

  // --- Z0_dispersion() ---
  const erEffSingleF = st.single.erEffDispersed;
  const erEffSingle0 = st.single.erEffStatic;
  const z0SingleF = st.single.z0Dispersed;
  const erEffOf = erEffO;
  const erEffO0 = st.erEffO0;

  const Q11 = 0.893 * (1.0 - 0.3 / (1.0 + 0.7 * (er - 1.0)));
  const Q12 =
    2.121 *
    ((fn / 20.0) ** 4.91 / (1.0 + Q11 * (fn / 20.0) ** 4.91)) *
    Math.exp(-2.87 * g) *
    g ** 0.902;
  const Q13 = 1.0 + 0.038 * (er / 8.0) ** 5.1;
  const Q14 = 1.0 + (1.203 * (er / 15.0) ** 4.0) / (1.0 + (er / 15.0) ** 4.0);
  const Q15 =
    (1.887 * Math.exp(-1.5 * g ** 0.84) * g ** Q14) /
    (1.0 + (0.41 * (fn / 15.0) ** 3.0 * u ** (2.0 / Q13)) / (0.125 + u ** (1.626 / Q13)));
  const Q16 = (1.0 + 9.0 / (1.0 + 0.403 * (er - 1.0) ** 2)) * Q15;
  const Q17 =
    0.394 *
    (1.0 - Math.exp(-1.47 * (u / 7.0) ** 0.672)) *
    (1.0 - Math.exp(-4.25 * (fn / 20.0) ** 1.87));
  const Q18 = (0.61 * (1.0 - Math.exp(-2.13 * (u / 8.0) ** 1.593))) / (1.0 + 6.544 * g ** 4.17);
  const Q19 =
    (0.21 * g * g * g * g) /
    ((1.0 + 0.18 * g ** 4.9) * (1.0 + 0.1 * u * u) * (1.0 + (fn / 24.0) ** 3.0));
  const Q20 = (0.09 + 1.0 / (1.0 + 0.1 * (er - 1) ** 2.7)) * Q19;
  const Q21 = Math.abs(
    1.0 - (42.54 * g ** 0.133 * Math.exp(-0.812 * g) * u ** 2.5) / (1.0 + 0.033 * u ** 2.5),
  );

  const rE = (fn / 28.843) ** 12;
  const qE = 0.016 + (0.0514 * er * Q21) ** 4.524;
  const pE = 4.766 * Math.exp(-3.228 * u ** 0.641);
  const dE =
    5.086 *
    qE *
    (rE / (0.3838 + 0.386 * qE)) *
    (Math.exp(-22.2 * u ** 1.92) / (1.0 + 1.2992 * rE)) *
    ((er - 1.0) ** 6.0 / (1.0 + 10 * (er - 1.0) ** 6.0));
  const Ce =
    1.0 +
    1.275 * (1.0 - Math.exp(-0.004625 * pE * er ** 1.674 * (fn / 18.365) ** 2.745)) -
    Q12 +
    Q16 -
    Q17 +
    Q18 +
    Q20;

  const R1 = 0.03891 * er ** 1.4;
  const R2 = 0.267 * u ** 7.0;
  const R7 = 1.206 - 0.3144 * Math.exp(-R1) * (1.0 - Math.exp(-R2));
  const R10 = 0.00044 * er ** 2.136 + 0.0184;
  let tmpf = (fn / 19.47) ** 6.0;
  const R11 = tmpf / (1.0 + 0.0962 * tmpf);
  const R12 = 1.0 / (1.0 + 0.00245 * u * u);
  const R15 = 0.707 * R10 * (fn / 12.3) ** 1.097;
  const R16 = 1.0 + 0.0503 * er * er * R11 * (1.0 - Math.exp(-((u / 15.0) ** 6.0)));
  const Q0 = R7 * (1.0 - 1.1241 * (R12 / R16) * Math.exp(-0.026 * fn ** 1.15656 - R15));

  const z0E =
    (st.z0E0 * (0.9408 * erEffSingleF ** Ce - 0.9603) ** Q0) /
    ((0.9408 - dE) * erEffSingle0 ** Ce - 0.9603) ** Q0;

  const Q29 = 15.16 / (1.0 + 0.196 * (er - 1.0) ** 2.0);
  tmpf = (er - 1.0) ** 3.0;
  const Q28 = (0.149 * tmpf) / (94.5 + 0.038 * tmpf);
  tmpf = (er - 1.0) ** 1.5;
  const Q27 = 0.4 * g ** 0.84 * (1.0 + (2.5 * tmpf) / (5.0 + tmpf));
  tmpf = ((er - 1.0) / 13.0) ** 12.0;
  const Q26 = 30.0 - 22.2 * (tmpf / (1.0 + 3.0 * tmpf)) - Q29;
  tmpf = (er - 1.0) * (er - 1.0);
  const Q25 = ((0.3 * fn * fn) / (10.0 + fn * fn)) * (1.0 + (2.333 * tmpf) / (5.0 + tmpf));
  const Q24 =
    (2.506 * Q28 * u ** 0.894 * (((1.0 + 1.3 * u) * fn) / 99.25) ** 4.29) / (3.575 + u ** 0.894);
  const Q23 =
    1.0 + (0.005 * fn * Q27) / ((1.0 + 0.812 * (fn / 15.0) ** 1.9) * (1.0 + 0.025 * u * u));
  const Q22 = (0.925 * (fn / Q26) ** 1.536) / (1.0 + 0.3 * (fn / 30.0) ** 1.536);

  const z0O =
    z0SingleF +
    (st.z0O0 * (erEffOf / erEffO0) ** Q22 - z0SingleF * Q23) /
      (1.0 + Q24 + (0.46 * g) ** 2.2 * Q25);

  return { erEffE, erEffO, z0E, z0O };
}

export function coupledMicrostripAnalyze(
  phys: CoupledMicrostripPhysical,
  el: TcElectrical,
): CoupledMicrostripResult {
  const st = computeStatics(phys, el);
  const fr = computeDispersion(phys, el, st);
  const len = phys.lengthM;
  const er = el.epsilonR;
  const delta = skinDepth(el);

  // conductor_losses() (ROUGH = 0).
  let attenCondE = 0.0;
  let attenCondO = 0.0;
  if (el.frequencyHz > 0.0) {
    const z0He = st.z0E0 * Math.sqrt(st.erEffE0);
    const z0Ho = st.z0O0 * Math.sqrt(st.erEffO0);
    const K = Math.exp(-1.2 * ((z0He + z0Ho) / (2.0 * ZF0)) ** 0.7);
    const Rs = 1.0 / (el.sigma * delta);
    const Qce = (Math.PI * z0He * phys.widthM * el.frequencyHz) / (Rs * C0 * K);
    const Qco = (Math.PI * z0Ho * phys.widthM * el.frequencyHz) / (Rs * C0 * K);
    const alphaCe = (LOG2DB * el.frequencyHz * Math.sqrt(st.erEffE0)) / (C0 * Qce);
    const alphaCo = (LOG2DB * el.frequencyHz * Math.sqrt(st.erEffO0)) / (C0 * Qco);
    attenCondE = alphaCe * len;
    attenCondO = alphaCo * len;
  }

  // dielectric_losses().
  const alphaDe =
    LOG2DB *
    (el.frequencyHz / C0) *
    (er / Math.sqrt(st.erEffE0)) *
    ((st.erEffE0 - 1.0) / (er - 1.0)) *
    el.tanD;
  const alphaDo =
    LOG2DB *
    (el.frequencyHz / C0) *
    (er / Math.sqrt(st.erEffO0)) *
    ((st.erEffO0 - 1.0) / (er - 1.0)) *
    el.tanD;
  const attenDielE = alphaDe * len;
  const attenDielO = alphaDo * len;

  // line_angle() — reported angle is √(ang_l_e·ang_l_o).
  const angLe = (2.0 * Math.PI * len * el.frequencyHz * Math.sqrt(fr.erEffE)) / C0;
  const angLo = (2.0 * Math.PI * len * el.frequencyHz * Math.sqrt(fr.erEffO)) / C0;
  const angDeg = (Math.sqrt(angLe * angLo) * 180) / Math.PI;

  const zDiff = 2.0 * fr.z0O; // diff_impedance()
  const coupling = (fr.z0E - fr.z0O) / (fr.z0E + fr.z0O);

  return {
    z0: Math.sqrt(fr.z0E * fr.z0O),
    epsEff: 0.5 * (fr.erEffE + fr.erEffO),
    angleDeg: angDeg,
    conductorLossDb: 0.5 * (attenCondE + attenCondO),
    dielectricLossDb: 0.5 * (attenDielE + attenDielO),
    skinDepthM: delta,
    extra: {
      z0Even: fr.z0E,
      z0Odd: fr.z0O,
      epsEffEven: fr.erEffE,
      epsEffOdd: fr.erEffO,
      coupling,
      zDiff,
      zComm: fr.z0E / 2.0,
    },
  };
}

/**
 * Synthesis for a differential impedance: solve the gap for Zdiff at the given
 * width, then the length from the electrical angle (KiCad MinimiseZ0Error1D on
 * PHYS_S with the Z0_O target — Zdiff = 2·Z0_O).
 */
export function coupledMicrostripSynthesize(
  phys: CoupledMicrostripPhysical,
  el: TcElectrical,
  zDiffTarget: number,
  angleDeg: number,
): CoupledMicrostripPhysical | null {
  const zOf = (s: number): number => coupledMicrostripAnalyze({ ...phys, gapM: s }, el).extra.zDiff;
  // Zdiff rises with the gap; bracket from a sliver to wide.
  let lo = phys.heightM * 1e-3;
  let hi = phys.heightM * 50;
  const zLo = zOf(lo);
  const zHi = zOf(hi);
  if (!Number.isFinite(zLo) || !Number.isFinite(zHi)) return null;
  if ((zLo - zDiffTarget) * (zHi - zDiffTarget) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (zOf(mid) < zDiffTarget) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  const r = coupledMicrostripAnalyze({ ...phys, gapM: s }, el);
  const lambda = C0 / (el.frequencyHz * Math.sqrt(r.epsEff));
  return { ...phys, gapM: s, lengthM: (angleDeg / 360) * lambda };
}
