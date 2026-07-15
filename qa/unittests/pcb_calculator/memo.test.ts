import { describe, expect, it } from 'vitest';
import {
  BOARD_CLASS_COUNT,
  BOARD_CLASS_ROWS,
  CORROSION_METALS,
  colorCode,
  corrosionDeltaV,
} from '@ziroeda/pcb_calculator';

describe('board classes memo', () => {
  it('every row has one value per class, tightening monotonically', () => {
    for (const row of BOARD_CLASS_ROWS) {
      expect(row.mm).toHaveLength(BOARD_CLASS_COUNT);
      for (let i = 1; i < row.mm.length; i++) {
        expect(row.mm[i]!).toBeLessThanOrEqual(row.mm[i - 1]!);
      }
    }
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
