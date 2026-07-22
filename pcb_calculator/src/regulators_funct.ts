/**
 * Adjustable-regulator divider maths with worst-case (min/typ/max) analysis.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_regulator.cpp`
 * + `pcb_calculator/class_regulator_data.h`.
 *
 * 3-terminal type:  Vout = Vref · (R1 + R2) / R1 + Iadj · R2
 * Standard type:    Vout = Vref · (R1 + R2) / R2
 * (R1 from output to ADJ/FB, R2 from ADJ/FB to ground — as drawn on the panel.)
 */

export enum RegulatorType {
  STANDARD = 0,
  THREE_TERMINAL = 1,
}

export interface RegulatorData {
  name: string;
  vrefMin: number;
  vrefTyp: number;
  vrefMax: number;
  /** Adjust-pin current in amps (3-terminal type only). */
  iadjTyp: number;
  iadjMax: number;
  type: RegulatorType;
}

/** Ships with the tool, like KiCad's default `pcb_calculator.ini` datafile. */
export const BUILTIN_REGULATORS: readonly RegulatorData[] = [
  {
    name: 'LM317',
    vrefMin: 1.2,
    vrefTyp: 1.25,
    vrefMax: 1.3,
    iadjTyp: 50e-6,
    iadjMax: 100e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LM1117',
    vrefMin: 1.225,
    vrefTyp: 1.25,
    vrefMax: 1.275,
    iadjTyp: 60e-6,
    iadjMax: 120e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LT1086',
    vrefMin: 1.225,
    vrefTyp: 1.25,
    vrefMax: 1.27,
    iadjTyp: 55e-6,
    iadjMax: 120e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LM2596',
    vrefMin: 1.193,
    vrefTyp: 1.23,
    vrefMax: 1.267,
    iadjTyp: 0,
    iadjMax: 0,
    type: RegulatorType.STANDARD,
  },
  {
    name: 'TL431',
    vrefMin: 2.44,
    vrefTyp: 2.495,
    vrefMax: 2.55,
    iadjTyp: 2e-6,
    iadjMax: 4e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
];

export enum RegulatorSolve {
  R1 = 0,
  R2 = 1,
  VOUT = 2,
}

export interface RegulatorParams {
  type: RegulatorType;
  /** Which quantity to solve for; the other two must carry `typ` values. */
  solve: RegulatorSolve;
  r1Typ: number; // ohms
  r2Typ: number; // ohms
  voutTyp: number; // volts
  vrefMin: number;
  vrefTyp: number;
  vrefMax: number;
  iadjTyp: number; // amps (0 for standard type)
  iadjMax: number; // amps
  /** Resistor tolerance in percent (e.g. 1). */
  resTolPct: number;
}

export interface RegulatorResult {
  r1: { min: number; typ: number; max: number };
  r2: { min: number; typ: number; max: number };
  vout: { min: number; typ: number; max: number };
  /** Overall output tolerance vs typ, percent (negative and positive side). */
  tolNegPct: number;
  tolPosPct: number;
  error?: string;
}

/**
 * Solve the divider and compute the min/typ/max columns, using KiCad's exact
 * per-type equations and worst-case corners:
 *   3-terminal: Vout = Vref·(R1+R2)/R1 + Iadj·R2
 *   standard:   Vout = Vref·(R1+R2)/R2
 * (`solve` picks which of R1/R2/Vout is derived from the other two typicals.)
 */
export function solveRegulator(p: RegulatorParams): RegulatorResult {
  let r1 = p.r1Typ;
  let r2 = p.r2Typ;
  let vout = p.voutTyp;
  const { vrefMin, vrefTyp, vrefMax, resTolPct } = p;
  const restol = resTolPct / 100;

  const fail = (msg: string): RegulatorResult => ({
    r1: nan3(),
    r2: nan3(),
    vout: nan3(),
    tolNegPct: NaN,
    tolPosPct: NaN,
    error: msg,
  });

  if (!(vrefTyp > 0)) return fail('Vref must be greater than 0.');
  if (!(vrefMin <= vrefTyp && vrefTyp <= vrefMax))
    return fail('Vref must satisfy VrefMin ≤ VrefTyp ≤ VrefMax.');

  let voutMin: number;
  let voutMax: number;

  if (p.type === RegulatorType.THREE_TERMINAL) {
    const iadjTyp = p.iadjTyp;
    const iadjMax = p.iadjMax;
    if (!(iadjTyp <= iadjMax)) return fail('Iadj must satisfy IadjTyp ≤ IadjMax.');

    if (p.solve === RegulatorSolve.R1) {
      const denom = vout - vrefTyp - r2 * iadjTyp;
      if (!(denom > 0)) return fail('Vout must be greater than Vref.');
      r1 = (vrefTyp * r2) / denom;
    } else if (p.solve === RegulatorSolve.R2) {
      r2 = (vout - vrefTyp) / (iadjTyp + vrefTyp / r1);
    } else {
      vout = (vrefTyp * (r1 + r2)) / r1 + r2 * iadjTyp;
    }
    if (!(r1 > 0) || !(r2 > 0) || !(vout > 0)) return fail('No valid solution for these values.');

    const r1min = r1 - r1 * restol;
    const r1max = r1 + r1 * restol;
    const r2min = r2 - r2 * restol;
    const r2max = r2 + r2 * restol;
    voutMin = (vrefMin * (r1max + r2min)) / r1max + r2min * iadjTyp;
    voutMax = (vrefMax * (r1min + r2max)) / r1min + r2max * iadjMax;
  } else {
    // Standard type: Vout = Vref·(R1+R2)/R2, no Iadj.
    if (p.solve === RegulatorSolve.R1) {
      r1 = (vout / vrefTyp - 1) * r2;
    } else if (p.solve === RegulatorSolve.R2) {
      const k = vout / vrefTyp - 1;
      if (!(k > 0)) return fail('Vout must be greater than Vref.');
      r2 = r1 / k;
    } else {
      vout = (vrefTyp * (r1 + r2)) / r2;
    }
    if (!(r1 > 0) || !(r2 > 0) || !(vout > 0)) return fail('No valid solution for these values.');

    const r1min = r1 - r1 * restol;
    const r1max = r1 + r1 * restol;
    const r2min = r2 - r2 * restol;
    const r2max = r2 + r2 * restol;
    voutMin = (vrefMin * (r1min + r2max)) / r2max;
    voutMax = (vrefMax * (r1max + r2min)) / r2min;
  }

  return {
    r1: { min: r1 - r1 * restol, typ: r1, max: r1 + r1 * restol },
    r2: { min: r2 - r2 * restol, typ: r2, max: r2 + r2 * restol },
    vout: { min: voutMin, typ: vout, max: voutMax },
    // KiCad's normalization: min vs typ, max vs itself.
    tolNegPct: ((voutMin - vout) / vout) * 100,
    tolPosPct: ((voutMax - vout) / voutMax) * 100,
  };
}

const nan3 = (): { min: number; typ: number; max: number } => ({
  min: NaN,
  typ: NaN,
  max: NaN,
});
