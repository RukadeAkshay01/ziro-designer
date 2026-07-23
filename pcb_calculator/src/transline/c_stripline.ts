/**
 * Coupled stripline (edge-coupled, optionally off-centre between the ground
 * planes) — port of KiCad `common/transline_calculations/coupled_stripline.cpp`.
 *
 * References (as in KiCad):
 *  [1] Cohn, "Characteristic Impedance of the Shielded-Strip Transmission
 *      Line", IRE MTT 2(2), 1954.
 *  [2] Cohn, "Shielded Coupled-Strip Transmission Line", IRE MTT 3(5), 1955.
 *  [3] Wadell, "Transmission Line Design Handbook", Artech House 1991,
 *      §3.6.3 off-center stripline (image method + three-term correction).
 */

import {
  C0,
  E0,
  LOG2DB,
  type TcElectrical,
  ZF0,
  ellipticIntegral,
  skinDepth,
  unitPropagationDelay,
} from './tc_common.js';
import { striplineAnalyze } from './stripline.js';

// KiCad's EllipticIntegral() takes the parameter m (b = sqrt(1 - arg)); the
// coupled-stripline code passes moduli straight in — mirror that convention.
const eK = (arg: number): number => ellipticIntegral(arg)[0];
const coth = (x: number): number => 1.0 / Math.tanh(x);
const sech = (x: number): number => 1.0 / Math.cosh(x);

export interface CoupledStriplinePhysical {
  /** Strip width W (each strip), m. */
  widthM: number;
  /** Edge-to-edge gap S, m. */
  gapM: number;
  /** Ground-to-ground substrate height H, m. */
  heightM: number;
  /**
   * Distance from the strip plane to the closest ground plane, m.
   * ≤ 0 (or omitted) means centred — the exact pre-offset behaviour.
   */
  offsetAM?: number;
  /** Strip thickness T, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
}

export interface CoupledStriplineResult {
  z0Even: number;
  z0Odd: number;
  zDiff: number;
  zComm: number;
  couplingK: number;
  /** Homogeneous dielectric: εeff = εr for both modes. */
  epsEffEven: number;
  epsEffOdd: number;
  /** ps/cm, both modes equal. */
  unitPropDelayEven: number;
  unitPropDelayOdd: number;
  attenCondEvenDb: number;
  attenCondOddDb: number;
  attenDielEvenDb: number;
  attenDielOddDb: number;
  angleDeg: number;
  skinDepthM: number;
}

// Reference [2] Eqs. 2-7: zero-thickness even/odd impedances for a centred pair
// with ground-to-ground spacing h.
function zeroThicknessCoupledImpedances(
  h: number,
  w: number,
  s: number,
  er: number,
): { z0e: number; z0o: number } {
  const kE = Math.tanh((Math.PI * w) / (2.0 * h)) * Math.tanh((Math.PI * (w + s)) / (2.0 * h));
  const kO = Math.tanh((Math.PI * w) / (2.0 * h)) * coth((Math.PI * (w + s)) / (2.0 * h));
  const kEp = Math.sqrt(1 - kE * kE);
  const kOp = Math.sqrt(1 - kO * kO);
  return {
    z0e: (ZF0 / (4.0 * Math.sqrt(er))) * (eK(kEp) / eK(kE)),
    z0o: (ZF0 / (4.0 * Math.sqrt(er))) * (eK(kOp) / eK(kO)),
  };
}

// Reference [3] Eq. 3.6.3.23 three-term correction (per mode).
function applyOffsetCorrection(
  zImage: number,
  offset: number,
  plateSpacing: number,
  width: number,
  thickness: number,
  er: number,
): number {
  const position = Math.abs(0.5 - offset / plateSpacing);
  const positionFactor = position ** 2.2;
  const widthFactor = ((thickness + width) / plateSpacing) ** 2.9;
  const correction =
    ((0.26 * Math.PI) / 8.0) * Math.sqrt(er) * zImage * positionFactor * widthFactor;
  return zImage * (1.0 - correction);
}

const isCenteredOffset = (a: number, h: number): boolean => Math.abs(a - h / 2.0) <= h * 1e-9;

// Reference [3]: the finite-thickness fringe formula needs t < h on each
// virtual plate spacing 2a / 2(h-a), i.e. t/2 < a < h - t/2.
const offsetWithinFiniteThicknessLimits = (a: number, h: number, t: number): boolean =>
  a > 0.5 * t && a < h - 0.5 * t;

interface CenteredParts {
  z0e: number;
  z0o: number;
}

// The centred finite-thickness solution (References [1] and [2]) for
// ground-to-ground spacing h: single-strip impedances + fringe capacitances.
function centeredFiniteThickness(
  h: number,
  w: number,
  s: number,
  t: number,
  er: number,
  el: TcElectrical,
  z0eZeroT: number,
  z0oZeroT: number,
): CenteredParts {
  // Finite-thickness single strip impedance via the stripline solver
  // (KiCad calcZ0SymmetricStripline: centred strip, tan δ = 0).
  const single = striplineAnalyze(
    { widthM: w, heightM: h, thicknessM: t, lengthM: 1 },
    { ...el, tanD: 0.0 },
  );
  const z0WHtH = single.z0;

  // Reference [1] Eqs. 5-6: zero-thickness single strip impedance.
  const k = sech((Math.PI * w) / (2.0 * h));
  const kP = Math.tanh((Math.PI * w) / (2.0 * h));
  const z0WH0 = (ZF0 / (4.0 * Math.sqrt(er))) * (eK(k) / eK(kP));

  // Reference [1] Eq. 2 and Reference [2] Eq. 13: fringe capacitances.
  const cFtH =
    ((E0 * er) / Math.PI) *
    ((2.0 / (1.0 - t / h)) * Math.log(1.0 / (1.0 - t / h) + 1.0) -
      (1.0 / (1.0 - t / h) - 1.0) * Math.log(1.0 / (1.0 - t / h) ** 2 - 1.0));
  const cF0 = ((E0 * er) / Math.PI) * 2.0 * Math.log(2.0);

  // Reference [2] Eq. 18 (even mode).
  const z0e = 1.0 / (1.0 / z0WHtH - (cFtH / cF0) * (1.0 / z0WH0 - 1.0 / z0eZeroT));

  // Reference [2] Eqs. 20 and 22 (odd mode; pick by s/t ratio).
  const zO1 = 1.0 / (1.0 / z0WHtH + (cFtH / cF0) * (1.0 / z0oZeroT - 1.0 / z0WH0));
  const zO2 =
    1.0 /
    (1.0 / z0oZeroT +
      (1.0 / z0WHtH - 1.0 / z0WH0) -
      (2.0 / ZF0) * (cFtH / E0 - cF0 / E0) +
      (2.0 * t) / (ZF0 * s));
  const z0o = s / t >= 5.0 ? zO1 : zO2;

  return { z0e, z0o };
}

export function coupledStriplineAnalyze(
  phys: CoupledStriplinePhysical,
  el: TcElectrical,
): CoupledStriplineResult {
  const w = phys.widthM;
  const t = phys.thicknessM;
  const s = phys.gapM;
  const h = phys.heightM;
  const er = el.epsilonR;
  const len = phys.lengthM;
  const freq = el.frequencyHz;

  // Non-positive offset means "never set": default to centred, as in KiCad.
  let a = phys.offsetAM ?? 0;
  if (a <= 0.0) a = h / 2.0;

  let z0e: number;
  let z0o: number;

  if (t === 0.0) {
    if (isCenteredOffset(a, h)) {
      ({ z0e, z0o } = zeroThicknessCoupledImpedances(h, w, s, er));
    } else {
      // Reference [3] Eq. 3.6.3.22 image method on the zero-thickness solution.
      const b1 = zeroThicknessCoupledImpedances(2.0 * a, w, s, er);
      const b2 = zeroThicknessCoupledImpedances(2.0 * (h - a), w, s, er);
      const z0eImage = 2.0 / (1.0 / b1.z0e + 1.0 / b2.z0e);
      const z0oImage = 2.0 / (1.0 / b1.z0o + 1.0 / b2.z0o);
      z0e = applyOffsetCorrection(z0eImage, a, h, w, t, er);
      z0o = applyOffsetCorrection(z0oImage, a, h, w, t, er);
    }
  } else if (isCenteredOffset(a, h)) {
    const zeroT = zeroThicknessCoupledImpedances(h, w, s, er);
    ({ z0e, z0o } = centeredFiniteThickness(h, w, s, t, er, el, zeroT.z0e, zeroT.z0o));
  } else if (!offsetWithinFiniteThicknessLimits(a, h, t)) {
    z0e = NaN;
    z0o = NaN;
  } else {
    // Image method on the finite-thickness solution, then the Wadell correction.
    const virt = (vh: number): CenteredParts => {
      const zeroT = zeroThicknessCoupledImpedances(vh, w, s, er);
      return centeredFiniteThickness(vh, w, s, t, er, el, zeroT.z0e, zeroT.z0o);
    };
    const b1 = virt(2.0 * a);
    const b2 = virt(2.0 * (h - a));
    const z0eImage = 2.0 / (1.0 / b1.z0e + 1.0 / b2.z0e);
    const z0oImage = 2.0 / (1.0 / b1.z0o + 1.0 / b2.z0o);
    z0e = applyOffsetCorrection(z0eImage, a, h, w, t, er);
    z0o = applyOffsetCorrection(z0oImage, a, h, w, t, er);
  }

  // Dielectric loss: homogeneous TEM, identical for both modes (Pozar §3.1).
  const alphaDdBPerM = LOG2DB * (Math.PI / C0) * freq * Math.sqrt(er) * el.tanD;
  const attenDiel = alphaDdBPerM * len;

  // Conductor loss via the single-stripline incremental-inductance result,
  // scaled per mode by Z0_single / Z0_mode (KiCad calcLosses).
  const single = striplineAnalyze(
    { widthM: w, heightM: h, thicknessM: t, lengthM: len },
    { ...el, tanD: 0.0 },
  );
  const attenCondEvenDb =
    z0e > 0 && Number.isFinite(z0e) ? single.conductorLossDb * (single.z0 / z0e) : 0.0;
  const attenCondOddDb =
    z0o > 0 && Number.isFinite(z0o) ? single.conductorLossDb * (single.z0 / z0o) : 0.0;

  // Homogeneous dielectric: both modes see εr; equal propagation delay.
  const v = C0 / Math.sqrt(er);
  const lambdaG = v / freq;
  const angLRad = (2.0 * Math.PI * len) / lambdaG;

  return {
    z0Even: z0e,
    z0Odd: z0o,
    zDiff: 2.0 * z0o,
    zComm: 0.5 * z0e,
    couplingK: z0e + z0o > 0.0 ? (z0e - z0o) / (z0e + z0o) : 0.0,
    epsEffEven: er,
    epsEffOdd: er,
    unitPropDelayEven: unitPropagationDelay(er),
    unitPropDelayOdd: unitPropagationDelay(er),
    attenCondEvenDb,
    attenCondOddDb,
    attenDielEvenDb: attenDiel,
    attenDielOddDb: attenDiel,
    angleDeg: (angLRad * 180) / Math.PI,
    skinDepthM: skinDepth(el),
  };
}

/**
 * Joint (W, S) synthesis for target even/odd impedances — port of KiCad's
 * COUPLED_STRIPLINE::Synthesize default path (wcalc-derived 2-D Newton
 * iteration with a coupled-microstrip initial guess and 10 % step clamps).
 */
export function coupledStriplineSynthesize(
  phys: CoupledStriplinePhysical,
  el: TcElectrical,
  z0eTarget: number,
  z0oTarget: number,
): CoupledStriplinePhysical | null {
  const h = phys.heightM;
  const er = el.epsilonR;

  const z0 = Math.sqrt(z0eTarget * z0oTarget);
  const k = (z0eTarget - z0oTarget) / (z0eTarget + z0oTarget);

  const maxiters = 50;
  const ai = [1, -0.301, 3.209, -27.282, 56.609, -37.746];
  const bi = [0.02, -0.623, 17.192, -68.946, 104.74, -16.148];
  const ci = [0.002, -0.347, 7.171, -36.91, 76.132, -51.616];

  const AW = Math.exp((z0 * Math.sqrt(er + 1.0)) / 42.4) - 1.0;
  const F1 = (8.0 * Math.sqrt((AW * (7.0 + 4.0 / er)) / 11.0 + (1.0 + 1.0 / er) / 0.81)) / AW;

  let F2 = 0.0;
  let F3 = 0.0;
  for (let i = 0; i <= 5; i++) F2 += (ai[i] ?? 0) * k ** i;
  for (let i = 0; i <= 5; i++) F3 += ((bi[i] ?? 0) - (ci[i] ?? 0) * (9.6 - er)) * (0.6 - k) ** i;

  let w = h * Math.abs(F1 * F2);
  let s = h * Math.abs(F1 * F3);

  const delta = 25.4e-6 * 1e-5; // UNIT_MIL * 1e-5
  const cval = 1e-12 * z0eTarget * z0oTarget;

  const analyse = (aw: number, as: number): { ze: number; zo: number } => {
    const r = coupledStriplineAnalyze({ ...phys, widthM: aw, gapM: as }, el);
    return { ze: r.z0Even, zo: r.z0Odd };
  };

  let done = false;
  for (let iters = 0; iters < maxiters && !done; iters++) {
    const { ze: ze0, zo: zo0 } = analyse(w, s);
    const err = (ze0 - z0eTarget) ** 2 + (zo0 - z0oTarget) ** 2;
    if (err < cval) {
      done = true;
      break;
    }

    const { ze: ze1, zo: zo1 } = analyse(w + delta, s);
    const { ze: ze2, zo: zo2 } = analyse(w, s + delta);

    const dedw = (ze1 - ze0) / delta;
    const dodw = (zo1 - zo0) / delta;
    const deds = (ze2 - ze0) / delta;
    const dods = (zo2 - zo0) / delta;

    const d = dedw * dods - deds * dodw;

    let dw = (-1.0 * ((ze0 - z0eTarget) * dods - (zo0 - z0oTarget) * deds)) / d;
    if (Math.abs(dw) > 0.1 * w) dw = dw > 0.0 ? 0.1 * w : -0.1 * w;
    w = Math.abs(w + dw);

    let ds = ((ze0 - z0eTarget) * dodw - (zo0 - z0oTarget) * dedw) / d;
    if (Math.abs(ds) > 0.1 * s) ds = ds > 0.0 ? 0.1 * s : -0.1 * s;
    s = Math.abs(s + ds);
  }

  if (!done) return null;
  return { ...phys, widthM: w, gapM: s };
}
