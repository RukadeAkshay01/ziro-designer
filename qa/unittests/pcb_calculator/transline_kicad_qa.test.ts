/**
 * KiCad master's transline QA vectors, ported from
 * `qa/tests/common/transline_calculations/` (checked out 2026-07-22).
 * These pin our engines to the exact numbers KiCad's own test suite pins its
 * implementation to — if one of these fails after an engine edit, the port
 * has drifted from upstream.
 */

import { describe, expect, it } from 'vitest';
import {
  applySoldermaskCorrection,
  coaxAnalyze,
  coplanarAnalyze,
  coupledMicrostripAnalyze,
  coupledStriplineAnalyze,
  coupledStriplineSynthesize,
  djordjevicSarkarFit,
  dsEpsilonRealAt,
  dsTanDeltaAt,
  microstripSoldermaskDeltaQ,
  rectWaveguideAnalyze,
  twistedPairAnalyze,
} from '@ziroeda/pcb_calculator';

const mm = 1e-3;
const um = 1e-6;
const mil = 25.4e-6;

/** Common electrical defaults used across the KiCad fixtures. */
const el = (over: Record<string, number> = {}) => ({
  frequencyHz: 1e9,
  epsilonR: 4.4,
  tanD: 0,
  sigma: 5.8e7,
  mur: 1,
  murC: 1,
  ...over,
});

describe('coax (test_coax.cpp)', () => {
  const phys = { innerDiaM: 1.63 * mm, outerDiaM: 3.75 * mm, lengthM: 100 * mm };

  it('air-filled 50 Ω: Z0 ≈ 60·ln(Dout/Din)', () => {
    const r = coaxAnalyze(phys, el({ epsilonR: 1 }));
    expect(r.z0).toBeCloseTo(50.0, 0); // ±0.5 Ω in KiCad
    expect(Math.abs(r.z0 - 50.0)).toBeLessThan(0.5);
  });

  it('TE11 cutoff ≈ 35.4 GHz', () => {
    const r = coaxAnalyze(phys, el({ epsilonR: 1 }));
    expect(r.extra.te11CutoffHz / 35.4e9).toBeCloseTo(1, 2);
  });
});

describe('coplanar (test_coplanar.cpp)', () => {
  const fr4 = {
    widthM: 0.5 * mm,
    gapM: 0.3 * mm,
    heightM: 0.8 * mm,
    thicknessM: 35 * um,
    lengthM: 100 * mm,
  };

  it('ungrounded CPW on FR-4 pins Z0 = 72.30 ±2 %', () => {
    const r = coplanarAnalyze(fr4, el(), false);
    expect(Math.abs(r.z0 - 72.3) / 72.3).toBeLessThan(0.02);
  });

  it('back metal lowers Z0 by at least 2 Ω at h = 0.25 mm', () => {
    const thin = { ...fr4, heightM: 0.25 * mm };
    const cpw = coplanarAnalyze(thin, el(), false);
    const cbcpw = coplanarAnalyze(thin, el(), true);
    expect(cpw.z0 - cbcpw.z0).toBeGreaterThanOrEqual(2.0);
  });
});

describe('rectangular waveguide (test_rectwaveguide.cpp)', () => {
  const wr90 = { aM: 22.86 * mm, bM: 10.16 * mm, lengthM: 100 * mm };

  it('WR-90 at 10 GHz: TE10 cutoff 6.557 GHz, Z0 ≈ 500 Ω', () => {
    const r = rectWaveguideAnalyze(wr90, el({ epsilonR: 1, frequencyHz: 10e9 }));
    expect(Math.abs(r.extra.fcTE10Hz - 6.557e9) / 6.557e9).toBeLessThan(0.005);
    expect(Math.abs(r.z0 - 500.0)).toBeLessThan(20.0);
    expect(r.conductorLossDb).toBeGreaterThan(0);
    expect(Math.abs(r.conductorLossDb - 0.011) / 0.011).toBeLessThan(0.3);
  });

  it('dielectric loss scales linearly with tan δ', () => {
    const lo = rectWaveguideAnalyze(wr90, el({ epsilonR: 2.1, tanD: 0.001, frequencyHz: 10e9 }));
    const hi = rectWaveguideAnalyze(wr90, el({ epsilonR: 2.1, tanD: 0.002, frequencyHz: 10e9 }));
    expect(hi.dielectricLossDb / lo.dielectricLossDb).toBeCloseTo(2.0, 9);
  });
});

describe('twisted pair (test_twistedpair.cpp)', () => {
  const phys = { dinM: 0.511 * mm, doutM: 1.0 * mm, twistsPerM: 49, lengthM: 1 };

  it('PE pair at 100 MHz: Z0 = 131.16, εeff = 1.3947 (±1 %)', () => {
    const r = twistedPairAnalyze(phys, {
      ...el({ epsilonR: 2.3, frequencyHz: 100e6 }),
      epsilonRenv: 1,
    });
    expect(Math.abs(r.z0 - 131.16) / 131.16).toBeLessThan(0.01);
    expect(Math.abs(r.epsEff - 1.3947) / 1.3947).toBeLessThan(0.01);
  });

  it('no twist in air matches the analytic acosh form exactly', () => {
    const r = twistedPairAnalyze(
      { ...phys, twistsPerM: 0 },
      { ...el({ epsilonR: 1, frequencyHz: 100e6 }), epsilonRenv: 1 },
    );
    const analytic = (376.730313412 / Math.PI) * Math.acosh(1.0 / 0.511);
    expect(r.z0).toBeCloseTo(analytic, 9);
    expect(r.epsEff).toBeCloseTo(1.0, 12);
  });
});

describe('coupled microstrip (test_coupled_microstrip.cpp)', () => {
  it('Zdiff = 2·Z0_odd', () => {
    const r = coupledMicrostripAnalyze(
      {
        widthM: 0.3 * mm,
        gapM: 0.2 * mm,
        heightM: 1.6 * mm,
        thicknessM: 35 * um,
        lengthM: 100 * mm,
      },
      el({ epsilonR: 4.3, tanD: 0.02 }),
    );
    expect(r.extra.zDiff).toBeCloseTo(2 * r.extra.z0Odd, 9);
  });
});

describe('coupled stripline (test_coupled_stripline.cpp)', () => {
  // b = 20 mil, W = S = 8 mil, T = 0.7 mil, εr 4.3, tan δ 0.02, 1 GHz, 100 mm.
  const phys = {
    widthM: 8 * mil,
    gapM: 8 * mil,
    heightM: 20 * mil,
    thicknessM: 0.7 * mil,
    lengthM: 0.1,
  };
  const fr4 = el({ epsilonR: 4.3, tanD: 0.02 });

  it('dielectric loss matches the homogeneous-TEM closed form (0.378 dB ±3 %)', () => {
    const r = coupledStriplineAnalyze(phys, fr4);
    expect(Math.abs(r.attenDielEvenDb - 0.378) / 0.378).toBeLessThan(0.03);
    // Even/odd symmetric within 0.1 %.
    expect(Math.abs(r.attenDielEvenDb - r.attenDielOddDb) / r.attenDielEvenDb).toBeLessThan(0.001);
  });

  it('conductor loss is positive and odd > even', () => {
    const r = coupledStriplineAnalyze(phys, fr4);
    expect(r.attenCondEvenDb).toBeGreaterThan(0);
    expect(r.attenCondOddDb).toBeGreaterThan(r.attenCondEvenDb);
  });

  it('synthesis round-trips the fixture geometry', () => {
    const target = coupledStriplineAnalyze(phys, fr4);
    const syn = coupledStriplineSynthesize(
      { ...phys, widthM: 5 * mil, gapM: 5 * mil },
      fr4,
      target.z0Even,
      target.z0Odd,
    );
    expect(syn).not.toBeNull();
    expect(syn!.widthM / mil).toBeCloseTo(8, 2);
    expect(syn!.gapM / mil).toBeCloseTo(8, 2);
  });

  it('off-center strip stays finite and lowers both mode impedances', () => {
    const centred = coupledStriplineAnalyze(phys, fr4);
    const offset = coupledStriplineAnalyze({ ...phys, offsetAM: 6 * mil }, fr4);
    expect(Number.isFinite(offset.z0Even)).toBe(true);
    expect(offset.z0Even).toBeLessThan(centred.z0Even);
    expect(offset.z0Odd).toBeLessThan(centred.z0Odd);
  });
});

describe('Djordjevic–Sarkar (test_djordjevic_sarkar.cpp, scikit-rf oracle)', () => {
  const model = djordjevicSarkarFit(4.4, 0.02, 1e9)!;

  it('FR-4 fit: εinf = 4.01276, m = 0.05606', () => {
    expect(model.lossless).toBe(false);
    expect(model.epsInf).toBeCloseTo(4.01276, 4);
    expect(model.m).toBeCloseTo(0.05606, 4);
  });

  it('evaluations at 1 MHz / 10 GHz / anchor', () => {
    expect(Math.abs(dsEpsilonRealAt(model, 1e6) - 4.7872) / 4.7872).toBeLessThan(0.01);
    expect(Math.abs(dsTanDeltaAt(model, 1e6) - 0.01838)).toBeLessThan(0.0005);
    expect(Math.abs(dsEpsilonRealAt(model, 1e10) - 4.2709) / 4.2709).toBeLessThan(0.01);
    expect(Math.abs(dsTanDeltaAt(model, 1e10) - 0.02049)).toBeLessThan(0.0005);
    expect(dsEpsilonRealAt(model, 1e9)).toBeCloseTo(4.4, 2);
    expect(dsTanDeltaAt(model, 1e9)).toBeCloseTo(0.02, 3);
  });

  it('lossless spec short-circuits', () => {
    const ll = djordjevicSarkarFit(4.4, 0.0, 1e9)!;
    expect(ll.lossless).toBe(true);
    expect(dsTanDeltaAt(ll, 1e10)).toBe(0);
  });
});

describe('soldermask (test_soldermask.cpp)', () => {
  const mask = {
    present: true,
    thicknessM: 0.125 * mm,
    epsilonR: 3.5,
    tanD: 0.025,
    fillsGaps: true,
  };

  it('Wan-Hoorfar hand computation: Δq = 0.0466, εeff 3.3 → 3.4166', () => {
    const dq = microstripSoldermaskDeltaQ(1.75, 0.125);
    expect(dq).toBeCloseTo(0.0466, 3);
    const r = applySoldermaskCorrection(mask, 1 * mm, 3.3, 0.02, 4.4, dq);
    expect(r.epsEff).toBeCloseTo(3.4166, 3);
    expect(r.epsEff).toBeCloseTo(3.3 + dq * 2.5, 6);
  });

  it('thick mask approaches the Bahl-Stuchly limit within 5 %', () => {
    const dq = microstripSoldermaskDeltaQ(1.75, 100);
    const r = applySoldermaskCorrection(
      { ...mask, thicknessM: 100 * mm },
      1 * mm,
      3.3,
      0.02,
      4.4,
      dq,
    );
    const qSub = (3.3 - 1) / (4.4 - 1);
    const limit = qSub * 4.4 + (1 - qSub) * 3.5;
    expect(r.epsEff).toBeGreaterThan(3.3);
    expect(Math.abs(r.epsEff - limit) / limit).toBeLessThan(0.05);
  });

  it('mask disabled / zero thickness are bit-identical no-ops', () => {
    const dq = microstripSoldermaskDeltaQ(1.75, 0.125);
    expect(
      applySoldermaskCorrection({ ...mask, present: false }, 1 * mm, 3.3, 0.02, 4.4, dq),
    ).toEqual({
      epsEff: 3.3,
      tanD: 0.02,
      changed: false,
    });
    expect(
      applySoldermaskCorrection({ ...mask, thicknessM: 0 }, 1 * mm, 3.3, 0.02, 4.4, dq).changed,
    ).toBe(false);
  });

  it('CPW: gaps-filled drop exceeds traces-only drop (wide strip)', () => {
    const phys = {
      widthM: 0.5 * mm,
      gapM: 0.3 * mm,
      heightM: 0.25 * mm,
      thicknessM: 35 * um,
      lengthM: 0.1,
    };
    const lpi = { ...mask, thicknessM: 25 * um };
    const base = coplanarAnalyze(phys, el(), false);
    const gaps = coplanarAnalyze(phys, el(), false, { ...lpi, fillsGaps: true });
    const traces = coplanarAnalyze(phys, el(), false, { ...lpi, fillsGaps: false });
    expect(base.z0 - gaps.z0).toBeGreaterThan(base.z0 - traces.z0);
    expect(base.z0 - traces.z0).toBeGreaterThan(0);
  });

  it('coupled microstrip: both mode impedances drop under mask', () => {
    const phys = {
      widthM: 0.3 * mm,
      gapM: 0.2 * mm,
      heightM: 0.2 * mm,
      thicknessM: 35 * um,
      lengthM: 0.1,
    };
    const off = coupledMicrostripAnalyze(phys, el());
    const on = coupledMicrostripAnalyze(phys, el(), { ...mask, thicknessM: 25 * um });
    expect(on.extra.z0Even).toBeLessThan(off.extra.z0Even);
    expect(on.extra.z0Odd).toBeLessThan(off.extra.z0Odd);
  });
});
