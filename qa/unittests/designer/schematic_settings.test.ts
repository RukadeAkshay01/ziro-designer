/**
 * Schematic settings derived drawing defaults: junction-dot sizing
 * (SCHEMATIC_SETTINGS::GetJunctionSize counterpart in
 * designer/src/editors/schematic/schematic_settings.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  defaultSchematicSetup,
  junctionDotDiameterIU,
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
