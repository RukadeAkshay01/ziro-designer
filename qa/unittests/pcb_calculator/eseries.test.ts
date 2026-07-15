import { describe, expect, it } from 'vitest';
import {
  E12_VALUES,
  E24_VALUES,
  E96_VALUES,
  ESeriesId,
  calculateResistorSubstitution,
  eseriesInRange,
  eseriesNearest,
} from '@ziroeda/pcb_calculator';

describe('eseries tables', () => {
  it('has the right series sizes', () => {
    expect(E12_VALUES).toHaveLength(12);
    expect(E24_VALUES).toHaveLength(24);
    expect(E96_VALUES).toHaveLength(96);
  });

  it('spans decades without float noise', () => {
    const vals = eseriesInRange(ESeriesId.E12, -1, 1);
    expect(vals).toContain(0.47);
    expect(vals).toContain(4.7);
    expect(vals).toContain(47);
    expect(vals).toHaveLength(36);
  });

  it('finds nearest values', () => {
    expect(eseriesNearest(ESeriesId.E24, 4990)).toBe(5100);
    expect(eseriesNearest(ESeriesId.E12, 3.5)).toBe(3.3);
    expect(eseriesNearest(ESeriesId.E96, 10000)).toBe(10000);
  });
});

describe('resistor substitution', () => {
  it('returns an exact single when the target is in-series', () => {
    const r = calculateResistorSubstitution(4700, ESeriesId.E24)!;
    expect(r.r1.value).toBe(4700);
    expect(r.r1.deviationPct).toBe(0);
  });

  it('improves (or matches) accuracy with more resistors', () => {
    const r = calculateResistorSubstitution(3456, ESeriesId.E12)!;
    const e1 = Math.abs(r.r1.deviationPct);
    const e2 = Math.abs(r.r2.deviationPct);
    const e3 = Math.abs(r.r3.deviationPct);
    const e4 = Math.abs(r.r4.deviationPct);
    expect(e2).toBeLessThanOrEqual(e1);
    expect(e3).toBeLessThanOrEqual(e2);
    expect(e4).toBeLessThanOrEqual(e3);
    // 4 E12 resistors should get well under 0.1 %.
    expect(e4).toBeLessThan(0.1);
  });

  it('finds the classic series pair', () => {
    // 14.7k from E12: e.g. 12k + 2.7k = 14.7k exactly.
    const r = calculateResistorSubstitution(14700, ESeriesId.E12)!;
    expect(Math.abs(r.r2.deviationPct)).toBeLessThan(1e-9);
  });

  it('rejects nonsense input', () => {
    expect(calculateResistorSubstitution(-5, ESeriesId.E24)).toBeNull();
    expect(calculateResistorSubstitution(Number.NaN, ESeriesId.E24)).toBeNull();
  });

  it('honours excluded values', () => {
    // 4700 is exact in E24; excluding 4.7k (all decades) forces a worse single.
    const excl = calculateResistorSubstitution(4700, ESeriesId.E24, [4700])!;
    expect(excl.r1.value).not.toBe(4700);
    // The excluded mantissa must not appear as a single-resistor pick.
    expect(Math.round(excl.r1.value)).not.toBe(4700);
    // A multi-resistor network can still approach the target closely.
    expect(Math.abs(excl.r4.deviationPct)).toBeLessThan(2);
  });
});
