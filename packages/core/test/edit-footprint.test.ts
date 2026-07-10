import { describe, it, expect } from 'vitest';
import { parse } from '../src/sexpr/index.js';
import { readFootprintFile } from '../src/pcb/read-board.js';
import { serializeFootprint } from '../src/pcb/write-footprint.js';
import {
  fpItemId, hitTestFootprint, footprintBBox, moveFootprintItems,
  rotateFootprintItems, mirrorFootprintItems, deleteFootprintItems, itemsInBox,
  setFootprintReference, setFootprintValue, setFootprintDescription, footprintStringChild, addPad, patchPad, addShape,
} from '../src/pcb/edit-footprint.js';
import type { PcbPad, PcbShape } from '../src/pcb/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
import { mmToIU, iuToMM } from '../src/units.js';

// A two-pad footprint with a silk line and a reference, in local coords.
const SRC = `(footprint "R"
	(version 20241229) (generator "pcbnew") (generator_version "9.0")
	(layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1.5 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(property "Value" "R" (at 0 1.5 0) (layer "F.Fab")
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

  it('edits reference, value and description losslessly', () => {
    let fp = read();
    fp = setFootprintReference(fp, 'R1');
    fp = setFootprintValue(fp, '10k');
    fp = setFootprintDescription(fp, 'A 10k resistor');
    expect(fp.reference).toBe('R1');
    expect(fp.value).toBe('10k');
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.reference).toBe('R1');
    expect(reread.value).toBe('10k');
    expect(footprintStringChild(reread, 'descr')).toBe('A 10k resistor');
    // Untouched geometry + unmodelled pad fields survive.
    expect(reread.pads).toHaveLength(2);
    expect(serializeFootprint(fp)).toContain('(pinfunction "A")');
  });

  it('adds a new through-hole pad that serializes canonically', () => {
    const pad: PcbPad = {
      number: '3', type: 'thru_hole', shape: 'circle',
      at: { x: mmToIU(2), y: 0 }, angle: 0,
      size: { x: mmToIU(1.524), y: mmToIU(1.524) },
      drill: { oblong: false, w: mmToIU(0.762), h: mmToIU(0.762) },
      layers: ['*.Cu', '*.Mask'],
      source: { kind: 'list', items: [] },
    };
    const fp = addPad(read(), pad);
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.pads).toHaveLength(3);
    const p = reread.pads[2]!;
    expect(p.number).toBe('3');
    expect(p.type).toBe('thru_hole');
    expect(p.shape).toBe('circle');
    expect(iuToMM(p.size.x)).toBeCloseTo(1.524, 4);
    expect(iuToMM(p.drill!.w)).toBeCloseTo(0.762, 4);
    expect(p.layers).toEqual(['*.Cu', '*.Mask']);
    // The earlier pads (with pinfunction) are untouched.
    expect(serializeFootprint(fp)).toContain('(pinfunction "A")');
  });

  it('patches an existing pad, keeping unmodelled fields', () => {
    const fp = read();
    const edited = patchPad(fp.pads[0]!, {
      number: '7', shape: 'rect', size: { x: mmToIU(1.2), y: mmToIU(1.4) },
    });
    const fp2 = { ...fp, pads: fp.pads.map((p, i) => (i === 0 ? edited : p)) };
    const reread = readFootprintFile(parse(serializeFootprint(fp2)))!;
    const p = reread.pads[0]!;
    expect(p.number).toBe('7');
    expect(p.shape).toBe('rect');
    expect(iuToMM(p.size.x)).toBeCloseTo(1.2, 4);
    expect(iuToMM(p.size.y)).toBeCloseTo(1.4, 4);
    // pinfunction/pintype on pad 1 were not modelled but must survive the edit.
    const out = serializeFootprint(fp2);
    expect(out).toContain('(pinfunction "A")');
    expect(out).toContain('(pintype "passive")');
  });

  it('adds silk graphics (line + circle) that round-trip on their layer', () => {
    const line: PcbShape = { kind: 'line', start: { x: 0, y: 0 }, end: { x: mmToIU(1), y: 0 }, width: mmToIU(0.1), fill: false, layer: 'F.SilkS', source: EMPTY };
    const circle: PcbShape = { kind: 'circle', center: { x: 0, y: 0 }, end: { x: mmToIU(0.5), y: 0 }, width: mmToIU(0.1), fill: false, layer: 'F.SilkS', source: EMPTY };
    const fp = addShape(addShape(read(), line), circle);
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.shapes.filter((s) => s.kind === 'line')).toHaveLength(2); // the original + the new one
    const c = reread.shapes.find((s) => s.kind === 'circle')!;
    expect(c.layer).toBe('F.SilkS');
    expect(iuToMM(Math.hypot(c.end!.x - c.center!.x, c.end!.y - c.center!.y))).toBeCloseTo(0.5, 4);
  });

  it('deletes selected items and reindexes', () => {
    const d = deleteFootprintItems(read(), new Set([fpItemId('pad', 0)]));
    expect(d.pads).toHaveLength(1);
    expect(iuToMM(d.pads[0]!.at.x)).toBeCloseTo(0.8, 6); // old pad 2 is now pad 0
    void at; // (helper kept for readability of intent)
  });
});
