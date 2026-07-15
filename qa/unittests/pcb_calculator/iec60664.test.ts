import { describe, expect, it } from 'vitest';
import { iec60664, ratedImpulseWithstandVoltageV } from '@ziroeda/pcb_calculator';

describe('IEC 60664 rated impulse withstand voltage (Table F.1)', () => {
  it('matches published breakpoints', () => {
    expect(ratedImpulseWithstandVoltageV(300, 2)).toBe(2500);
    expect(ratedImpulseWithstandVoltageV(1000, 4)).toBe(12000);
    expect(ratedImpulseWithstandVoltageV(50, 1)).toBe(330);
    expect(ratedImpulseWithstandVoltageV(600, 3)).toBe(6000);
  });

  it('reports out-of-range as -1', () => {
    expect(ratedImpulseWithstandVoltageV(2000, 1)).toBe(-1);
  });
});

const base = {
  ratedVoltageV: 300,
  overvoltageCategory: 3 as const,
  pollutionDegree: 2 as const,
  materialGroup: 'I' as const,
  insulationType: 'basic' as const,
  field: 'inhomogeneous' as const,
  pcbMaterial: false,
  altitudeM: 2000,
  rmsVoltageV: 250,
  peakVoltageKv: 2.5,
  transientVoltageKv: 4,
};

describe('IEC 60664 clearance / creepage', () => {
  it('computes a basic-insulation case from the tables', () => {
    const r = iec60664(base);
    // Transient 4 kV inhomogeneous PD2 → 3.0 mm; peaks 2.5 kV inhomo → 1.8 mm;
    // clearance = max × altitude factor(2000m)=1.0 = 3.0 mm.
    expect(r.clearanceMm).toBeCloseTo(3.0, 6);
    // Creepage: RMS 250 V, PD2, MG_I → 1.25 mm, but not below clearance → 3.0.
    expect(r.creepageMm).toBeCloseTo(3.0, 6);
    // Groove width for PD2 with clearance ≥ 3 mm → 1.0 mm.
    expect(r.grooveWidthMm).toBeCloseTo(1.0, 6);
  });

  it('reinforced insulation roughly doubles creepage and steps clearance up', () => {
    const basicR = iec60664(base);
    const reinf = iec60664({ ...base, insulationType: 'reinforced' });
    expect(reinf.clearanceMm).toBeGreaterThan(basicR.clearanceMm);
    // Creepage before the clearance floor: reinforced ×2 of 1.25 = 2.5,
    // still below the (larger) reinforced clearance, so it tracks clearance.
    expect(reinf.creepageMm).toBe(reinf.clearanceMm);
  });

  it('applies the altitude correction factor', () => {
    const high = iec60664({ ...base, altitudeM: 5000 });
    const low = iec60664({ ...base, altitudeM: 2000 });
    // 5000 m factor 1.48 vs 1.0.
    expect(high.clearanceMm / low.clearanceMm).toBeCloseTo(1.48, 6);
  });

  it('PD2 creepage uses the higher creepage when it exceeds the clearance', () => {
    // Large RMS at low transient: creepage dominates.
    const r = iec60664({
      ...base,
      transientVoltageKv: 0.5,
      peakVoltageKv: 0.5,
      rmsVoltageV: 1000,
      materialGroup: 'IIIb',
    });
    expect(r.creepageMm).toBeGreaterThan(r.clearanceMm - 1e-9);
  });
});
