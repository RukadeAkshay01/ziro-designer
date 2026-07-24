/**
 * Schematic settings derived drawing defaults: junction-dot sizing
 * (SCHEMATIC_SETTINGS::GetJunctionSize counterpart in
 * designer/src/editors/schematic/schematic_settings.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  blankNetClass,
  defaultSchematicSetup,
  hopOverArcRadiusIU,
  junctionDotDiameterIU,
  resolveEffectiveNetClass,
  type NetClassesData,
} from '@ziroeda/designer/src/editors/schematic/schematic_settings.js';

describe('junctionDotDiameterIU', () => {
  it('matches DEFAULT_JUNCTION_DIAM for the default setup', () => {
    // Default netclass wire width 6 mils × multiplier 6 = 36 mils = 9144 IU.
    expect(junctionDotDiameterIU(defaultSchematicSetup())).toBe(9144);
  });

  it('returns 1 ("draw nothing") for the None choice', () => {
    const s = defaultSchematicSetup();
    s.formatting.junctionDotChoice = 0;
    expect(junctionDotDiameterIU(s)).toBe(1);
  });

  it('rounds like KiROUND for fractional multipliers', () => {
    const s = defaultSchematicSetup();
    s.formatting.junctionDotChoice = 1; // Smallest: ×1.7
    expect(junctionDotDiameterIU(s)).toBe(Math.round(6 * 254 * 1.7)); // 2591
  });

  it('scales with the Default netclass wire width', () => {
    const s = defaultSchematicSetup();
    s.netClasses.classes[0]!.wireThickness = '12';
    s.formatting.junctionDotChoice = 5; // Largest: ×12
    expect(junctionDotDiameterIU(s)).toBe(12 * 254 * 12);
  });

  it('falls back to the 6-mil wire width when the netclass leaves it blank', () => {
    const s = defaultSchematicSetup();
    s.netClasses.classes = [];
    expect(junctionDotDiameterIU(s)).toBe(9144);
  });
});

// NET_SETTINGS::GetEffectiveNetClass over the dialog's netclass grid.
describe('hopOverArcRadiusIU', () => {
  it('is 0 for the default "None" choice', () => {
    expect(hopOverArcRadiusIU(defaultSchematicSetup())).toBe(0);
  });

  it('scales the default line width by hopover_size_mult_list', () => {
    const s = defaultSchematicSetup();
    s.formatting.hopOverChoice = 1; // "Smallest" ×1.7
    expect(hopOverArcRadiusIU(s)).toBeCloseTo(6 * 254 * 1.7); // 2590.8
    s.formatting.hopOverChoice = 5; // "Largest" ×12
    s.formatting.defaultLineWidthMils = 10;
    expect(hopOverArcRadiusIU(s)).toBe(10 * 254 * 12);
  });
});

describe('resolveEffectiveNetClass', () => {
  const data = (): NetClassesData => ({
    classes: [
      { ...blankNetClass('Default'), wireThickness: '6', color: '' },
      { ...blankNetClass('Power'), wireThickness: '20', color: '#ff0000' },
      { ...blankNetClass('Clocks'), lineStyle: 'Dashed' },
    ],
    assignments: [
      { pattern: 'VCC', netClass: 'Power' },
      { pattern: 'CLK*', netClass: 'Clocks' },
    ],
  });

  it('resolves unmatched nets to Default', () => {
    const eff = resolveEffectiveNetClass('N1', data());
    expect(eff.name).toBe('Default');
    expect(eff.wireWidthMils).toBe(6);
    expect(eff.color).toBeUndefined();
  });

  it('prefix-matches plain patterns and wildcard-matches * patterns', () => {
    expect(resolveEffectiveNetClass('VCC3V3', data()).name).toBe('Power'); // prefix
    expect(resolveEffectiveNetClass('CLK_50M', data()).name).toBe('Clocks'); // wildcard
    expect(resolveEffectiveNetClass('XVCC', data()).name).toBe('Default'); // StartsWith only
  });

  it('completes missing parameters from Default', () => {
    const eff = resolveEffectiveNetClass('CLK1', data());
    expect(eff.name).toBe('Clocks');
    expect(eff.lineStyle).toBe('Dashed');
    expect(eff.wireWidthMils).toBe(6); // Clocks sets no width -> Default's
  });

  it('merges multiple matches by grid priority into a composite', () => {
    const d = data();
    d.assignments.push({ pattern: 'VCC*', netClass: 'Clocks' });
    const eff = resolveEffectiveNetClass('VCC1', d);
    expect(eff.name).toBe('Effective for net: VCC1');
    // Power sits above Clocks in the grid -> higher priority wins the width,
    // Clocks still contributes its dashed style.
    expect(eff.wireWidthMils).toBe(20);
    expect(eff.color).toBe('#ff0000');
    expect(eff.lineStyle).toBe('Dashed');
  });

  it('resolves the empty net name straight to Default', () => {
    expect(resolveEffectiveNetClass('', data()).name).toBe('Default');
  });
});
