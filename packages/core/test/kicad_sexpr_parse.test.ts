import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/kicad/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { formatBoard } from '../src/kicad/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_VIA } from '../src/kicad/pcbnew/pcb_track.js';
import { mmToIU } from '../src/units.js';

const SRC = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(paper "A4")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen"))
	(net 0 "") (net 1 "GND")
	(footprint "R_0603" (layer "F.Cu") (at 10 10 90)
		(property "Reference" "R1" (at 0 -1 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu") (roundrect_rratio 0.25))
		(fp_line (start -0.5 -0.3) (end 0.5 -0.3) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
	)
	(gr_line (start 0 0) (end 50 0) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(arc (start 30 10) (mid 35 12) (end 40 10) (width 0.25) (layer "F.Cu") (net 1))
	(via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;

describe('PCB_IO_KICAD_SEXPR_PARSER', () => {
  it('parses items into the BOARD object model', () => {
    const b = parseBoard(SRC);
    expect(b.Tracks()).toHaveLength(3);         // segment + arc + via
    expect(b.Footprints()).toHaveLength(1);
    expect(b.Drawings()).toHaveLength(1);       // gr_line
    expect(b.GetNetname(1)).toBe('GND');
    expect(b.GetLayers().map((l) => l.name)).toContain('F.SilkS');
  });

  it('bakes footprint children to board-absolute (rotated)', () => {
    const b = parseBoard(SRC);
    const fp = b.Footprints()[0]!;
    expect(fp.GetReference()).toBe('R1');
    expect(fp.GetOrientation().AsDegrees()).toBe(90);
    // Pad local (-0.8, 0) at 90°: RotatePoint((-0.8,0),90)=(0,0.8), + anchor(10,10) = (10, 10.8).
    expect(fp.Pads()[0]!.GetPosition()).toEqual({ x: mmToIU(10), y: mmToIU(10.8) });
  });

  it('classifies the via as a PCB_VIA', () => {
    const via = parseBoard(SRC).Tracks().find((t) => t instanceof PCB_VIA) as PCB_VIA;
    expect(via).toBeDefined();
    expect(via.GetPosition()).toEqual({ x: mmToIU(40), y: mmToIU(10) });
  });

  it('round-trips parse -> format -> parse (geometry preserved)', () => {
    const b1 = parseBoard(SRC);
    const b2 = parseBoard(formatBoard(b1));
    expect(b2.Tracks()).toHaveLength(3);
    expect(b2.Footprints()[0]!.Pads()[0]!.GetPosition()).toEqual(b1.Footprints()[0]!.Pads()[0]!.GetPosition());
    expect(b2.Footprints()[0]!.GetOrientation().AsDegrees()).toBe(90);
  });
});
