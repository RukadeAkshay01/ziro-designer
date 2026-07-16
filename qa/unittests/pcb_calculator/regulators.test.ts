import { describe, expect, it } from 'vitest';
import { RegulatorSolve, RegulatorType, solveRegulator } from '@ziroeda/pcb_calculator';

const lm317 = {
  type: RegulatorType.THREE_TERMINAL,
  vrefMin: 1.2,
  vrefTyp: 1.25,
  vrefMax: 1.3,
  iadjTyp: 50e-6,
  iadjMax: 100e-6,
  resTolPct: 1,
};

describe('regulator calculator', () => {
  it('solves Vout for the LM317 datasheet example (R1=240, R2=720)', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: 240,
      r2Typ: 720,
      voutTyp: 0,
    });
    // Vout = 1.25 * (240+720)/240 + 50µ*720 = 5 + 0.036 = 5.036
    expect(r.vout.typ).toBeCloseTo(5.036, 3);
    expect(r.vout.min).toBeLessThan(r.vout.typ);
    expect(r.vout.max).toBeGreaterThan(r.vout.typ);
    expect(r.tolNegPct).toBeLessThan(0);
    expect(r.tolPosPct).toBeGreaterThan(0);
  });

  it('solves R2 and round-trips through Vout', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R2,
      r1Typ: 240,
      r2Typ: 0,
      voutTyp: 5,
    });
    const back = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: 240,
      r2Typ: r.r2.typ,
      voutTyp: 0,
    });
    expect(back.vout.typ).toBeCloseTo(5, 9);
  });

  it('solves R1 and round-trips through Vout', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 720,
      voutTyp: 5,
    });
    const back = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: r.r1.typ,
      r2Typ: 720,
      voutTyp: 0,
    });
    expect(back.vout.typ).toBeCloseTo(5, 9);
  });

  it('standard type uses Vout = Vref·(R1+R2)/R2 and ignores Iadj', () => {
    const r = solveRegulator({
      type: RegulatorType.STANDARD,
      solve: RegulatorSolve.VOUT,
      r1Typ: 3000,
      r2Typ: 1000,
      voutTyp: 0,
      vrefMin: 1.2,
      vrefTyp: 1.25,
      vrefMax: 1.3,
      iadjTyp: 50e-6,
      iadjMax: 100e-6,
      resTolPct: 0,
    });
    // 1.25 · (3000+1000) / 1000 = 5
    expect(r.vout.typ).toBeCloseTo(5, 9);
  });

  it('standard type solves R1 and R2 back (Vref·(R1+R2)/R2)', () => {
    const std = {
      type: RegulatorType.STANDARD,
      vrefMin: 1.2,
      vrefTyp: 1.25,
      vrefMax: 1.3,
      iadjTyp: 0,
      iadjMax: 0,
      resTolPct: 0,
    };
    const r1 = solveRegulator({
      ...std,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 1000,
      voutTyp: 5,
    });
    expect(r1.r1.typ).toBeCloseTo(3000, 6);
    const r2 = solveRegulator({
      ...std,
      solve: RegulatorSolve.R2,
      r1Typ: 3000,
      r2Typ: 0,
      voutTyp: 5,
    });
    expect(r2.r2.typ).toBeCloseTo(1000, 6);
  });

  it('flags impossible targets', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 720,
      voutTyp: 1.0, // below Vref
    });
    expect(r.error).toBeTruthy();
  });
});
