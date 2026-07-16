import { describe, expect, it } from 'vitest';
import {
  awgDiameterM,
  cableSize,
  fusingCurrent,
  ipc2221CurrentA,
  ipc2221RowForVoltage,
  ipc2221Spacing,
  nearestAwgIndex,
  trackWidth,
  viaSize,
} from '@ziroeda/pcb_calculator';

describe('track width (IPC-2221)', () => {
  it('matches the published external example: 1 A, 10 °C, 35 µm → ~0.25 mm', () => {
    const r = trackWidth({ currentA: 1, deltaTC: 10, lengthM: 0.1, thicknessM: 35e-6 }, true);
    expect(r.widthM * 1000).toBeGreaterThan(0.15);
    expect(r.widthM * 1000).toBeLessThan(0.35);
  });

  it('internal layers need about twice the width', () => {
    const ext = trackWidth({ currentA: 2, deltaTC: 10, lengthM: 0.1, thicknessM: 35e-6 }, true);
    const int = trackWidth({ currentA: 2, deltaTC: 10, lengthM: 0.1, thicknessM: 35e-6 }, false);
    expect(int.widthM / ext.widthM).toBeCloseTo(2 ** (1 / 0.725), 3);
  });

  it('round-trips area ↔ current', () => {
    const r = trackWidth({ currentA: 3, deltaTC: 20, lengthM: 1, thicknessM: 35e-6 }, true);
    expect(ipc2221CurrentA(r.areaM2, 20, true)).toBeCloseTo(3, 6);
  });

  it('computes ohmic results', () => {
    const r = trackWidth({ currentA: 1, deltaTC: 10, lengthM: 0.1, thicknessM: 35e-6 }, true);
    expect(r.resistanceOhm).toBeGreaterThan(0);
    expect(r.voltageDrop).toBeCloseTo(r.resistanceOhm, 9);
    expect(r.powerLossW).toBeCloseTo(r.voltageDrop, 9);
  });
});

describe('via size', () => {
  // KiCad panel defaults — results must match its displayed values.
  const base = {
    holeDiaM: 0.4e-3,
    platingM: 0.035e-3,
    lengthM: 1.6e-3,
    padDiaM: 0.6e-3,
    clearanceDiaM: 1.0e-3,
    z0Ohm: 50,
    epsilonR: 4.5,
    currentA: 1,
    resistivity: 1.72e-8,
    deltaTC: 10,
    riseTimeS: 1e-9,
  };

  it('matches KiCad to the displayed precision', () => {
    const r = viaSize(base);
    expect(r.resistanceOhm).toBeCloseTo(0.000575362, 9);
    expect(r.voltageDrop).toBeCloseTo(0.000575362, 9);
    expect(r.powerLossW).toBeCloseTo(0.000575362, 9);
    expect(r.thermalResistance).toBeCloseTo(83.2937, 3);
    expect(r.ampacityA).toBeCloseTo(2.9993, 3);
    expect(r.capacitanceF * 1e12).toBeCloseTo(0.599508, 5); // pF
    expect(r.riseTimeDegradationS * 1e12).toBeCloseTo(32.9729, 3); // ps
    expect(r.inductanceH * 1e9).toBeCloseTo(1.20723, 4); // nH
    expect(r.reactanceOhm).toBeCloseTo(3.79262, 4);
  });

  it('reactance follows the pulse rise time (halving it doubles X)', () => {
    const slow = viaSize(base);
    const fast = viaSize({ ...base, riseTimeS: 0.5e-9 });
    expect(fast.reactanceOhm).toBeCloseTo(2 * slow.reactanceOhm, 6);
  });

  it('capacitance is NaN when the antipad is smaller than the pad', () => {
    const r = viaSize({ ...base, clearanceDiaM: 0.5e-3 });
    expect(Number.isNaN(r.capacitanceF)).toBe(true);
  });
});

describe('electrical spacing (IPC-2221)', () => {
  it('picks the right rows', () => {
    expect(ipc2221RowForVoltage(12)).toBe(0);
    expect(ipc2221RowForVoltage(16)).toBe(1);
    expect(ipc2221RowForVoltage(500)).toBe(8);
    expect(ipc2221RowForVoltage(501)).toBe(-1);
  });

  it('reads the table and extrapolates over 500 V', () => {
    expect(ipc2221Spacing(30, 0)).toBe(0.05); // B1
    expect(ipc2221Spacing(240, 2)).toBe(6.4); // B3
    // 600 V, B2: 2.5 + 100·0.005 = 3.0 mm
    expect(ipc2221Spacing(600, 1)).toBeCloseTo(3.0, 9);
  });
});

describe('fusing current (KiCad energy-balance model)', () => {
  const base = {
    ambientC: 25,
    meltingC: 1084,
    widthM: 0.5e-3,
    thicknessM: 35e-6,
    currentA: 10,
    timeS: 1,
  } as const;

  it('solves current for a 0.5 mm × 35 µm track at 1 s', () => {
    const r = fusingCurrent({ ...base, solveFor: 'current' });
    expect(r.error).toBeUndefined();
    expect(r.currentA).toBeGreaterThan(4);
    expect(r.currentA).toBeLessThan(8); // ≈ 5.6 A
  });

  it('current and time are mutually consistent (round-trip)', () => {
    const cur = fusingCurrent({ ...base, solveFor: 'current' }).currentA;
    const t = fusingCurrent({ ...base, currentA: cur, solveFor: 'time' }).timeS;
    expect(t).toBeCloseTo(1, 6);
  });

  it('solves width and thickness back from a target current', () => {
    const cur = fusingCurrent({ ...base, solveFor: 'current' }).currentA;
    const w = fusingCurrent({ ...base, currentA: cur, solveFor: 'width' }).widthM;
    expect(w).toBeCloseTo(base.widthM, 9);
    const th = fusingCurrent({ ...base, currentA: cur, solveFor: 'thickness' }).thicknessM;
    expect(th).toBeCloseTo(base.thicknessM, 12);
  });

  it('longer fuse time lowers the current', () => {
    const short = fusingCurrent({ ...base, timeS: 0.1, solveFor: 'current' }).currentA;
    const long = fusingCurrent({ ...base, timeS: 5, solveFor: 'current' }).currentA;
    expect(long).toBeLessThan(short);
  });

  it('flags melting below ambient', () => {
    expect(fusingCurrent({ ...base, meltingC: 10, solveFor: 'current' }).error).toBeTruthy();
  });
});

describe('cable size', () => {
  it('AWG 24 diameter ≈ 0.511 mm', () => {
    expect(awgDiameterM(24) * 1000).toBeCloseTo(0.511, 2);
  });

  it('AWG 0000 diameter ≈ 11.68 mm', () => {
    expect(awgDiameterM(-3) * 1000).toBeCloseTo(11.68, 1);
  });

  it('nearest index round-trips', () => {
    // Index 27 = AWG 24.
    expect(nearestAwgIndex(awgDiameterM(24))).toBe(27);
  });

  it('AWG 10 is ~3.28 mΩ/m at 20 °C', () => {
    const r = cableSize({
      diameterM: awgDiameterM(10),
      conductorTempC: 20,
      currentDensity: 3,
      currentA: 10,
      lengthM: 1,
    });
    expect(r.resPerMeter20 * 1000).toBeGreaterThan(3.0);
    expect(r.resPerMeter20 * 1000).toBeLessThan(3.6);
    expect(r.voltageDrop).toBeCloseTo(r.resistanceOhm * 10, 9);
    expect(r.powerLossW).toBeCloseTo(r.voltageDrop * 10, 9);
  });

  it('resistance rises with temperature', () => {
    const cold = cableSize({
      diameterM: 1e-3,
      conductorTempC: 20,
      currentDensity: 3,
      currentA: 1,
      lengthM: 1,
    });
    const hot = cableSize({
      diameterM: 1e-3,
      conductorTempC: 100,
      currentDensity: 3,
      currentA: 1,
      lengthM: 1,
    });
    expect(hot.resPerMeter).toBeGreaterThan(cold.resPerMeter * 1.25);
  });
});
