import { describe, it, expect } from 'vitest';
import { parse } from '../src/sexpr/index.js';
import { readFootprintFile } from '../src/pcb/read-board.js';
import { serializeFootprint } from '../src/pcb/write-footprint.js';
import {
  fpItemId, hitTestFootprint, footprintBBox, moveFootprintItems,
  rotateFootprintItems, mirrorFootprintItems, deleteFootprintItems, itemsInBox,
} from '../src/pcb/edit-footprint.js';
import { mmToIU, iuToMM } from '../src/units.js';

// A two-pad footprint with a silk line and a reference, in local coords.
const SRC = `(footprint "R"
	(version 20241229) (generator "pcbnew") (generator_version "9.0")
	(layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1.5 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25) (pinfunction "A") (pintype "passive"))
	(pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25))
	(fp_line (start -0.5 -0.6) (end 0.5 -0.6) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
)
`;

const read = () => readFootprintFile(parse(SRC))!;
const at = (fp: ReturnType<typeof read>, kind: 'pad' | 'text', i: number) =>
  kind === 'pad' ? fp.pads[i]!.at : fp.texts[i]!.at;

describe('footprint editing', () => {
  it('bounding box spans the pads', () => {
    const box = footprintBBox(read())!;
    expect(iuToMM(box.minX)).toBeCloseTo(-1.25, 3); // pad1 left edge: -0.8 - 0.45
    expect(iuToMM(box.maxX)).toBeCloseTo(1.25, 3);
  });

  it('hit-tests a pad, a line and empty space', () => {
    const fp = read();
    expect(hitTestFootprint(fp, { x: mmToIU(-0.8), y: 0 }, 0)).toBe(fpItemId('pad', 0));
    expect(hitTestFootprint(fp, { x: mmToIU(0.8), y: 0 }, 0)).toBe(fpItemId('pad', 1));
    expect(hitTestFootprint(fp, { x: 0, y: mmToIU(-0.6) }, mmToIU(0.05))).toBe(fpItemId('shape', 0));
    expect(hitTestFootprint(fp, { x: mmToIU(5), y: mmToIU(5) }, 0)).toBeNull();
  });

  it('box-selects overlapping items', () => {
    const ids = itemsInBox(read(), mmToIU(-2), mmToIU(-2), mmToIU(2), mmToIU(2));
    expect(ids).toContain(fpItemId('pad', 0));
    expect(ids).toContain(fpItemId('pad', 1));
    expect(ids).toContain(fpItemId('shape', 0));
  });

  it('moves a pad and the change survives a serialize round-trip', () => {
    const moved = moveFootprintItems(read(), new Set([fpItemId('pad', 0)]), { x: mmToIU(1), y: mmToIU(2) });
    expect(iuToMM(moved.pads[0]!.at.x)).toBeCloseTo(0.2, 6);
    expect(iuToMM(moved.pads[0]!.at.y)).toBeCloseTo(2, 6);
    const reread = readFootprintFile(parse(serializeFootprint(moved)))!;
    expect(iuToMM(reread.pads[0]!.at.x)).toBeCloseTo(0.2, 6);
    expect(iuToMM(reread.pads[0]!.at.y)).toBeCloseTo(2, 6);
    // The untouched pad and its unmodelled fields (pinfunction) survive.
    expect(iuToMM(reread.pads[1]!.at.x)).toBeCloseTo(0.8, 6);
    expect(serializeFootprint(moved)).toContain('(pinfunction "A")');
  });

  it('rotates a pad 90° CCW about the origin', () => {
    const rot = rotateFootprintItems(read(), new Set([fpItemId('pad', 0)]), true, { x: 0, y: 0 });
    // (-0.8, 0) rotated +90 (KiCad RotatePoint): (x,y) -> (y, -x) => (0, 0.8).
    expect(iuToMM(rot.pads[0]!.at.x)).toBeCloseTo(0, 6);
    expect(iuToMM(rot.pads[0]!.at.y)).toBeCloseTo(0.8, 6);
    expect(rot.pads[0]!.angle).toBe(90);
    const reread = readFootprintFile(parse(serializeFootprint(rot)))!;
    expect(reread.pads[0]!.angle).toBe(90);
  });

  it('mirrors pads across the Y axis', () => {
    const m = mirrorFootprintItems(read(), new Set([fpItemId('pad', 0), fpItemId('pad', 1)]), { x: 0, y: 0 });
    expect(iuToMM(m.pads[0]!.at.x)).toBeCloseTo(0.8, 6);
    expect(iuToMM(m.pads[1]!.at.x)).toBeCloseTo(-0.8, 6);
  });

  it('deletes selected items and reindexes', () => {
    const d = deleteFootprintItems(read(), new Set([fpItemId('pad', 0)]));
    expect(d.pads).toHaveLength(1);
    expect(iuToMM(d.pads[0]!.at.x)).toBeCloseTo(0.8, 6); // old pad 2 is now pad 0
    void at; // (helper kept for readability of intent)
  });
});
