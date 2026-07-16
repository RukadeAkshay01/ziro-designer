import { describe, expect, it } from 'vitest';
import {
  BOARD_CLASS_COUNT,
  BOARD_CLASS_ROWS,
  CORROSION_METALS,
  colorCode,
  corrosionDeltaV,
} from '@ziroeda/pcb_calculator';

describe('board classes memo', () => {
  it('matches KiCad: 5 rows, one value per class, KiCad values', () => {
    expect(BOARD_CLASS_ROWS).toHaveLength(5);
    for (const row of BOARD_CLASS_ROWS) expect(row.mm).toHaveLength(BOARD_CLASS_COUNT);
    const byLabel = (l: string) => BOARD_CLASS_ROWS.find((r) => r.label === l)!.mm;
    expect(byLabel('Lines width')).toEqual([0.8, 0.5, 0.31, 0.21, 0.15, 0.12]);
    expect(byLabel('Minimum clearance')).toEqual([0.68, 0.5, 0.31, 0.21, 0.15, 0.12]);
    expect(byLabel('Plated Pad: (diameter - drill)')).toEqual([1.19, 0.78, 0.6, 0.49, 0.39, 0.35]);
    // KiCad marks some entries N/A (NaN here).
    expect(Number.isNaN(byLabel('Via: (diameter - drill)')[0]!)).toBe(true);
    expect(Number.isNaN(byLabel('NP Pad: (diameter - drill)')[3]!)).toBe(true);
  });

  it('defined values tighten with class where applicable', () => {
    const lines = BOARD_CLASS_ROWS.find((r) => r.label === 'Lines width')!.mm;
    for (let i = 1; i < lines.length; i++) expect(lines[i]!).toBeLessThanOrEqual(lines[i - 1]!);
  });
});

describe('galvanic corrosion memo', () => {
  it('copper vs zinc is a risky pair, copper vs nickel is not', () => {
    const cu = CORROSION_METALS.findIndex((m) => m.name === 'Copper');
    const zn = CORROSION_METALS.findIndex((m) => m.name === 'Zinc');
    const ni = CORROSION_METALS.findIndex((m) => m.name === 'Nickel');
    expect(corrosionDeltaV(cu, zn)).toBeGreaterThan(0.3);
    expect(corrosionDeltaV(cu, ni)).toBeLessThanOrEqual(0.3);
    expect(corrosionDeltaV(cu, cu)).toBe(0);
  });
});

describe('resistor colour code', () => {
  it('4.7 kΩ 5 % four-band: yellow violet red gold', () => {
    const r = colorCode(4700, 5, 4);
    expect(r.error).toBeUndefined();
    expect(r.digits.map((d) => d.name)).toEqual(['Yellow', 'Violet']);
    expect(r.multiplier.name).toBe('Red');
    expect(r.tolerance?.name).toBe('Gold');
    expect(r.encodedOhms).toBe(4700);
  });

  it('12.4 kΩ 1 % five-band: brown red yellow red brown', () => {
    const r = colorCode(12400, 1, 5);
    expect(r.digits.map((d) => d.name)).toEqual(['Brown', 'Red', 'Yellow']);
    expect(r.multiplier.name).toBe('Red');
    expect(r.tolerance?.name).toBe('Brown');
  });

  it('sub-ohm values use silver/gold multipliers', () => {
    const r = colorCode(0.47, 5, 4);
    expect(r.multiplier.name).toBe('Silver');
    expect(r.encodedOhms).toBeCloseTo(0.47, 9);
  });

  it('rejects nonsense', () => {
    expect(colorCode(-1, 5, 4).error).toBeTruthy();
    expect(colorCode(Number.NaN, 5, 4).error).toBeTruthy();
  });

  it('rounds to the nearest encodable value', () => {
    const r = colorCode(4990, 5, 4);
    expect(r.encodedOhms).toBe(5000);
  });

  it('6-band adds a temperature-coefficient band', () => {
    const r = colorCode(4700, 1, 6, 50);
    expect(r.digits.map((d) => d.name)).toEqual(['Yellow', 'Violet', 'Black']);
    expect(r.tolerance?.name).toBe('Brown');
    expect(r.tempco?.name).toBe('Red'); // 50 ppm/K
    expect(r.tempco?.ppm).toBe(50);
  });

  it('4/5-band carry no tempco band', () => {
    expect(colorCode(4700, 5, 4).tempco).toBeNull();
    expect(colorCode(4700, 1, 5).tempco).toBeNull();
  });
});
