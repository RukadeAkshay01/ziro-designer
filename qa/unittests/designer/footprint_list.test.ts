/**
 * Chooser footprint list (counterparts common/footprint_info.cpp and
 * common/footprint_filter.cpp): fp_filter glob matching and the
 * footprint→board→scene render pipeline used by the preview widget.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { filterFootprints } from '@ziroeda/designer/src/widgets/footprint_list.js';
import { parseFootprint } from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';

describe('footprint filters', () => {
  const index = [
    {
      name: 'Resistor_THT',
      footprints: ['R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 'R_Axial_DIN0309'],
    },
    { name: 'Capacitor_SMD', footprints: ['C_0402_1005Metric', 'C_0805_2012Metric'] },
  ];
  it('matches name globs and library-qualified globs', () => {
    expect(filterFootprints(index, ['R_*'])).toHaveLength(2);
    expect(filterFootprints(index, ['C_0402*'])).toEqual(['Capacitor_SMD:C_0402_1005Metric']);
    expect(filterFootprints(index, ['Capacitor_SMD:C_*'])).toHaveLength(2);
    expect(filterFootprints(index, ['SOT?23'])).toHaveLength(0);
    expect(filterFootprints(index, [])).toHaveLength(0);
  });
});

describe('footprint preview pipeline', () => {
  // buildScene needs the browser's Path2D; the canvas render is covered by the
  // in-app smoke. Here: every hosted .kicad_mod parses into a footprint.
  it('parses hosted .kicad_mod files', () => {
    const dir = '/home/user/ziro-designer/designer/public/footprints/CM5IO.pretty';
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.kicad_mod'))) {
      const fp = parseFootprint(readFileSync(`${dir}/${file}`, 'utf8'));
      expect(fp, file).not.toBeNull();
    }
  });
});
