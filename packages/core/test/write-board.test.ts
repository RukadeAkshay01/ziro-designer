import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '../src/sexpr/index.js';
import { readBoard } from '../src/pcb/read-board.js';
import { serializeBoard } from '../src/pcb/write-board.js';
import type { Board } from '../src/pcb/types.js';

// Strip `source` (and turn Maps into entry arrays) so two boards compare by
// their modelled content, like the footprint round-trip test's strip().
const strip = (b: Board): unknown =>
  JSON.parse(JSON.stringify(b, (k, v) => (k === 'source' ? undefined : v instanceof Map ? [...v] : v)));

// A small but representative board: a footprint, two graphics, a track, an arc
// track and a via, across a minimal layer table with two nets.
const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(general (thickness 1.6))
	(paper "A4")
	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(25 "Edge.Cuts" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(35 "F.Fab" user)
	)
	(net 0 "")
	(net 1 "GND")
	(footprint "R_0603" (layer "F.Cu") (at 10 10 0)
		(property "Reference" "R1" (at 0 -1 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
		(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu") (roundrect_rratio 0.25))
		(pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu") (roundrect_rratio 0.25))
	)
	(gr_line (start 0 0) (end 50 0) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
	(gr_text "Hello" (at 20 20 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(arc (start 30 10) (mid 35 12) (end 40 10) (width 0.25) (layer "F.Cu") (net 1))
	(via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;

describe('serializeBoard (.kicad_pcb writer)', () => {
  it('re-parses to an equal model (lossless round-trip)', () => {
    const b1 = readBoard(parse(BOARD));
    const b2 = readBoard(parse(serializeBoard(b1)));
    expect(strip(b2)).toEqual(strip(b1));
  });

  it('preserves every item array through a write + re-read', () => {
    const b = readBoard(parse(serializeBoard(readBoard(parse(BOARD)))));
    expect(b.footprints).toHaveLength(1);
    expect(b.footprints[0]!.pads).toHaveLength(2);
    expect(b.tracks).toHaveLength(1);
    expect(b.arcs).toHaveLength(1);
    expect(b.vias).toHaveLength(1);
    expect(b.shapes).toHaveLength(1);
    expect(b.texts).toHaveLength(1);
    expect([...b.nets.entries()]).toContainEqual([1, 'GND']);
  });

  it('is idempotent (serialize twice yields identical text)', () => {
    const once = serializeBoard(readBoard(parse(BOARD)));
    const twice = serializeBoard(readBoard(parse(once)));
    expect(twice).toBe(once);
  });
});

// Opportunistic: real KiCad demo boards when the source tree is present.
const DEMOS = [
  '/home/akshay/zeo/demos/test_pads_inside_pads/test_pads_inside_pads.kicad_pcb',
  '/home/akshay/zeo/demos/custom_pads_test/custom_pads_test.kicad_pcb',
];
for (const path of DEMOS) {
  describe.skipIf(!existsSync(path))(`serializeBoard (real demo: ${path.split('/').pop()})`, () => {
    it('round-trips the real board model-identically', () => {
      const b1 = readBoard(parse(readFileSync(path, 'utf8')));
      const b2 = readBoard(parse(serializeBoard(b1)));
      expect(strip(b2)).toEqual(strip(b1));
    });
  });
}
