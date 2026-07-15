import { describe, expect, it } from 'vitest';
import {
  AttenuatorType,
  calculateAttenuator,
  coaxAnalyze,
  coaxSynthesize,
  coplanarAnalyze,
  coplanarSynthesize,
  coupledMicrostripAnalyze,
  coupledMicrostripSynthesize,
  fromFrequency,
  fromWavelengthMedium,
  microstripAnalyze,
  microstripSynthesize,
  minAttenuationDb,
  rectWaveguideAnalyze,
  striplineAnalyze,
  striplineSynthesize,
  twistedPairAnalyze,
  twistedPairSynthesize,
} from '@ziroeda/pcb_calculator';

const el = {
  frequencyHz: 1e9,
  epsilonR: 4.5,
  tanD: 0.02,
  sigma: 5.8e7,
  mur: 1,
  murC: 1,
};

describe('wavelength', () => {
  it('1 GHz in vacuum is 299.79 mm', () => {
    const s = fromFrequency(1e9, 1, 1);
    expect(s.wavelengthVacuumM * 1000).toBeCloseTo(299.79, 1);
    expect(s.periodS).toBeCloseTo(1e-9, 15);
  });

  it('medium wavelength shrinks by √(εr·µr) and inverts correctly', () => {
    const s = fromFrequency(1e9, 4, 1);
    expect(s.wavelengthMediumM).toBeCloseTo(s.wavelengthVacuumM / 2, 12);
    const back = fromWavelengthMedium(s.wavelengthMediumM, 4, 1);
    expect(back.frequencyHz).toBeCloseTo(1e9, 0);
  });
});

describe('RF attenuators', () => {
  it('PI 6.0206 dB (K=2) @ 50 Ω: R1=R3=150, R2=37.5', () => {
    const r = calculateAttenuator(AttenuatorType.PI, 6.0206, 50, 50);
    expect(r.error).toBeUndefined();
    expect(r.resistors[0]).toBeCloseTo(150, 1);
    expect(r.resistors[2]).toBeCloseTo(150, 1);
    expect(r.resistors[1]).toBeCloseTo(37.5, 1);
  });

  it('Tee 6.0206 dB (K=2) @ 50 Ω: R1=R2=16.67, R3=66.67', () => {
    const r = calculateAttenuator(AttenuatorType.TEE, 6.0206, 50, 50);
    expect(r.resistors[0]).toBeCloseTo(16.67, 1);
    expect(r.resistors[1]).toBeCloseTo(16.67, 1);
    expect(r.resistors[2]).toBeCloseTo(66.67, 1);
  });

  it('Bridged Tee 10 dB @ 50 Ω: R1≈108.1, R2≈23.12', () => {
    const r = calculateAttenuator(AttenuatorType.BRIDGED_TEE, 10, 50, 50);
    expect(r.resistors[0]).toBeCloseTo(108.11, 1);
    expect(r.resistors[1]).toBeCloseTo(23.12, 1);
  });

  it('Splitter @ 50 Ω is 16.67 Ω each at 6.02 dB', () => {
    const r = calculateAttenuator(AttenuatorType.SPLITTER, 0, 50, 50);
    expect(r.resistors[0]).toBeCloseTo(50 / 3, 6);
    expect(r.attenuationDb).toBeCloseTo(6.02, 2);
  });

  it('enforces minimum attenuation for unequal impedances', () => {
    // 75→50 Ω minimum is ≈ 5.72 dB.
    expect(minAttenuationDb(75, 50)).toBeCloseTo(5.72, 1);
    const bad = calculateAttenuator(AttenuatorType.PI, 3, 75, 50);
    expect(bad.error).toBeTruthy();
    const ok = calculateAttenuator(AttenuatorType.PI, 10, 75, 50);
    expect(ok.error).toBeUndefined();
    expect(ok.resistors).toHaveLength(3);
  });
});

describe('microstrip', () => {
  it('50 Ω on FR4: w/h ≈ 1.9 gives Z0 near 50', () => {
    const r = microstripAnalyze(
      { widthM: 3e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
    );
    expect(r.z0).toBeGreaterThan(45);
    expect(r.z0).toBeLessThan(55);
    expect(r.epsEff).toBeGreaterThan(3);
    expect(r.epsEff).toBeLessThan(4.5);
  });

  it('synthesis hits the target impedance', () => {
    const phys = { widthM: 1e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 };
    const syn = microstripSynthesize(phys, el, 50, 90)!;
    expect(syn).not.toBeNull();
    const check = microstripAnalyze(syn, el);
    expect(check.z0).toBeCloseTo(50, 3);
    expect(check.angleDeg).toBeCloseTo(90, 3);
  });

  it('narrower is higher impedance', () => {
    const wide = microstripAnalyze(
      { widthM: 4e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
    );
    const narrow = microstripAnalyze(
      { widthM: 0.5e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
    );
    expect(narrow.z0).toBeGreaterThan(wide.z0);
  });

  it('reports losses and skin depth', () => {
    const r = microstripAnalyze(
      { widthM: 3e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
    );
    expect(r.conductorLossDb).toBeGreaterThan(0);
    expect(r.dielectricLossDb).toBeGreaterThan(0);
    // Copper at 1 GHz: δ ≈ 2.09 µm.
    expect(r.skinDepthM * 1e6).toBeCloseTo(2.09, 1);
  });
});

describe('coplanar waveguide', () => {
  const phys = { widthM: 0.5e-3, gapM: 0.3e-3, heightM: 1.6e-3, lengthM: 0.05 };

  it('gives plausible Z0 and εeff (no ground)', () => {
    const r = coplanarAnalyze(phys, el, false);
    expect(r.z0).toBeGreaterThan(40);
    expect(r.z0).toBeLessThan(120);
    expect(r.epsEff).toBeGreaterThan(1);
    expect(r.epsEff).toBeLessThan(el.epsilonR);
  });

  it('bottom ground lowers the impedance', () => {
    const cpw = coplanarAnalyze(phys, el, false);
    const gcpw = coplanarAnalyze(phys, el, true);
    expect(gcpw.z0).toBeLessThan(cpw.z0);
  });

  it('synthesis solves the gap', () => {
    const syn = coplanarSynthesize(phys, el, false, 70, 90)!;
    expect(syn).not.toBeNull();
    expect(coplanarAnalyze(syn, el, false).z0).toBeCloseTo(70, 2);
  });
});

describe('coax', () => {
  it('KiCad formula: d=0.9 mm, D=2.95 mm, εr=2.3 → 46.936 Ω', () => {
    const r = coaxAnalyze(
      { innerDiaM: 0.9e-3, outerDiaM: 2.95e-3, lengthM: 1 },
      { ...el, epsilonR: 2.3, tanD: 2e-4 },
    );
    // Z0 = ZF0/(2π√εr)·ln(Dout/Din) = 376.730313/(2π√2.3)·ln(2.95/0.9)
    expect(r.z0).toBeCloseTo(46.936, 2);
    expect(r.epsEff).toBe(2.3);
    // TE11 cutoff = 2c/(π√εr·(Din+Dout)).
    expect(r.extra.te11CutoffHz).toBeCloseTo(
      (2 * 299792458) / (Math.PI * Math.sqrt(2.3) * (0.9e-3 + 2.95e-3)),
      0,
    );
    expect(r.conductorLossDb).toBeGreaterThan(0);
    expect(r.dielectricLossDb).toBeGreaterThan(0);
  });

  it('synthesis inverts exactly', () => {
    const syn = coaxSynthesize(
      { innerDiaM: 1e-3, outerDiaM: 5e-3, lengthM: 1 },
      { ...el, epsilonR: 2.3 },
      50,
      360,
    )!;
    const r = coaxAnalyze({ ...syn }, { ...el, epsilonR: 2.3 });
    expect(r.z0).toBeCloseTo(50, 6);
  });
});

describe('rectangular waveguide', () => {
  it('WR-90: a=22.86 mm → fc(TE10)=6.557 GHz; @10 GHz λg≈39.71 mm, Z0≈499 Ω', () => {
    const r = rectWaveguideAnalyze(
      { aM: 22.86e-3, bM: 10.16e-3, lengthM: 0.1 },
      { ...el, frequencyHz: 10e9, epsilonR: 1 },
    );
    expect(r.extra.fcTE10Hz / 1e9).toBeCloseTo(6.5576, 3);
    expect(r.extra.guideWavelengthM * 1000).toBeCloseTo(39.71, 1);
    // KiCad Z0 = ZF0·√(µr/εr)/√(1−(fc/f)²).
    expect(r.z0).toBeCloseTo(498.97, 1);
    expect(r.conductorLossDb).toBeGreaterThan(0);
    expect(r.teModes).toContain('H(1,0)');
  });

  it('below cutoff reports NaN', () => {
    const r = rectWaveguideAnalyze(
      { aM: 22.86e-3, bM: 10.16e-3, lengthM: 0.1 },
      { ...el, frequencyHz: 1e9, epsilonR: 1 },
    );
    expect(Number.isNaN(r.z0)).toBe(true);
  });
});

describe('stripline', () => {
  it('FR4 b=1.6 mm, w≈0.70 mm is near 50 Ω', () => {
    const r = striplineAnalyze(
      { widthM: 0.7e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
    );
    expect(r.z0).toBeGreaterThan(45);
    expect(r.z0).toBeLessThan(55);
    expect(r.epsEff).toBe(el.epsilonR);
  });

  it('synthesis hits the target', () => {
    const syn = striplineSynthesize(
      { widthM: 1e-3, heightM: 1.6e-3, thicknessM: 35e-6, lengthM: 0.05 },
      el,
      50,
      90,
    )!;
    expect(striplineAnalyze(syn, el).z0).toBeCloseTo(50, 3);
  });
});

describe('twisted pair', () => {
  const tpEl = { ...el, epsilonR: 3.5, epsilonRenv: 1 };

  it('typical hookup pair lands near 100–150 Ω', () => {
    const r = twistedPairAnalyze(
      { dinM: 0.511e-3, doutM: 0.93e-3, twistsPerM: 100, lengthM: 1 },
      tpEl,
    );
    expect(r.z0).toBeGreaterThan(70);
    expect(r.z0).toBeLessThan(200);
    expect(r.epsEff).toBeGreaterThan(1);
    expect(r.epsEff).toBeLessThan(3.5);
  });

  it('synthesis solves the conductor diameter', () => {
    const syn = twistedPairSynthesize(
      { dinM: 0.5e-3, doutM: 1e-3, twistsPerM: 100, lengthM: 1 },
      tpEl,
      120,
      360,
    )!;
    expect(syn).not.toBeNull();
    expect(twistedPairAnalyze(syn, tpEl).z0).toBeCloseTo(120, 2);
  });
});

describe('coupled microstrip', () => {
  const phys = {
    widthM: 0.3e-3,
    gapM: 0.2e-3,
    heightM: 0.2e-3,
    thicknessM: 35e-6,
    lengthM: 0.05,
  };

  it('even mode above odd mode, coupling in (0,1)', () => {
    const r = coupledMicrostripAnalyze(phys, el);
    expect(r.extra.z0Even).toBeGreaterThan(r.extra.z0Odd);
    expect(r.extra.coupling).toBeGreaterThan(0);
    expect(r.extra.coupling).toBeLessThan(1);
    expect(r.extra.zDiff).toBeCloseTo(2 * r.extra.z0Odd, 9);
  });

  it('wider gap decouples: Ze and Zo converge toward the single line', () => {
    const tight = coupledMicrostripAnalyze(phys, el);
    const loose = coupledMicrostripAnalyze({ ...phys, gapM: 2e-3 }, el);
    expect(loose.extra.coupling).toBeLessThan(tight.extra.coupling);
  });

  it('differential synthesis hits the target', () => {
    const syn = coupledMicrostripSynthesize(phys, el, 100, 90)!;
    expect(syn).not.toBeNull();
    expect(coupledMicrostripAnalyze(syn, el).extra.zDiff).toBeCloseTo(100, 1);
  });
});
