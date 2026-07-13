import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

// A minimal but real-shaped KiCad 9 `.kicad_mod`: a two-pad SMD resistor with a
// reference/value property and silkscreen + courtyard graphics. Children are in
// footprint-LOCAL coordinates (no top-level (at ...)).
const R_0603 = `(footprint "R_0603_1608Metric"
	(version 20241229)
	(generator "pcbnew")
	(generator_version "9.0")
	(layer "F.Cu")
	(descr "Resistor SMD 0603")
	(tags "resistor")
	(property "Reference" "REF**"
		(at 0 -1.43 0)
		(layer "F.SilkS")
		(uuid "11111111-1111-1111-1111-111111111111")
		(effects
			(font
				(size 1 1)
				(thickness 0.15)
			)
		)
	)
	(property "Value" "R_0603"
		(at 0 1.43 0)
		(layer "F.Fab")
		(uuid "22222222-2222-2222-2222-222222222222")
		(effects
			(font
				(size 1 1)
				(thickness 0.15)
			)
		)
	)
	(fp_line
		(start -0.8 -0.4)
		(end 0.8 -0.4)
		(stroke
			(width 0.12)
			(type solid)
		)
		(layer "F.SilkS")
		(uuid "33333333-3333-3333-3333-333333333333")
	)
	(pad "1" smd roundrect
		(at -0.7875 0)
		(size 0.875 0.95)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25)
		(uuid "44444444-4444-4444-4444-444444444444")
	)
	(pad "2" smd roundrect
		(at 0.7875 0)
		(size 0.875 0.95)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25)
		(uuid "55555555-5555-5555-5555-555555555555")
	)
)
`;

/** Drop `source` (and undefined keys) so two reads compare by value, not AST identity. */
const strip = (fp: PcbFootprint): unknown =>
  JSON.parse(JSON.stringify({ ...fp, source: undefined }));

describe('readFootprintFile / serializeFootprint (.kicad_mod)', () => {
  it('reads a footprint in its own local frame', () => {
    const fp = readFootprintFile(parse(R_0603))!;
    expect(fp).not.toBeNull();
    expect(fp.lib).toBe('R_0603_1608Metric');
    expect(fp.layer).toBe('F.Cu');
    expect(fp.pads).toHaveLength(2);
    expect(fp.shapes).toHaveLength(1);
    // Local coordinates are preserved verbatim (no board transform baked in).
    expect(fp.pads[0]!.at.x).toBe(mmToIU(-0.7875));
    expect(fp.pads[1]!.at.x).toBe(mmToIU(0.7875));
    expect(fp.pads[0]!.roundrectRatio).toBeCloseTo(0.25, 6);
    // Reference/Value become text items.
    expect(fp.reference).toBe('REF**');
    expect(fp.value).toBe('R_0603');
    expect(fp.texts.some((t) => t.kind === 'reference')).toBe(true);
  });

  it('round-trips losslessly (model is identical after write + re-read)', () => {
    const fp1 = readFootprintFile(parse(R_0603))!;
    const text = serializeFootprint(fp1);
    const fp2 = readFootprintFile(parse(text))!;
    expect(strip(fp2)).toEqual(strip(fp1));
  });

  it('rejects a non-footprint node', () => {
    expect(readFootprintFile(parse('(kicad_pcb (version 20241229))'))).toBeNull();
  });
});

// Opportunistic check against a real KiCad demo footprint when the source tree
// is present (custom pads exercise the primitive-preservation path).
const ONEPIN = '/home/akshay/zeo/demos/custom_pads_test/custom_pads_test.pretty/1pin.kicad_mod';
describe.skipIf(!existsSync(ONEPIN))('readFootprintFile (real KiCad demo footprint)', () => {
  it('round-trips a real .kicad_mod', () => {
    const src = readFileSync(ONEPIN, 'utf8');
    const fp1 = readFootprintFile(parse(src))!;
    expect(fp1).not.toBeNull();
    const fp2 = readFootprintFile(parse(serializeFootprint(fp1)))!;
    expect(strip(fp2)).toEqual(strip(fp1));
  });
});

// Sweep the library the Footprint Editor actually bundles (designer/public):
// every real KiCad 9 footprint the editor can open must parse and round-trip.
const BUNDLED = new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url)
  .pathname;
describe.skipIf(!existsSync(BUNDLED))('bundled footprint library (CM5IO.pretty)', () => {
  const files = readdirSync(BUNDLED).filter((f) => f.endsWith('.kicad_mod'));
  it('parses every bundled footprint', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const fp = readFootprintFile(parse(readFileSync(`${BUNDLED}/${f}`, 'utf8')));
      expect(fp, f).not.toBeNull();
    }
  });
  it('round-trips every bundled footprint model-identically', () => {
    for (const f of files) {
      const fp1 = readFootprintFile(parse(readFileSync(`${BUNDLED}/${f}`, 'utf8')))!;
      const fp2 = readFootprintFile(parse(serializeFootprint(fp1)))!;
      expect(strip(fp2), f).toEqual(strip(fp1));
    }
  });
});
