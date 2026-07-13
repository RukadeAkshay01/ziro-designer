import { describe, it, expect } from 'vitest';
import { FOOTPRINT } from '@ziroeda/pcbnew/src/footprint.js';
import { PAD, PAD_SHAPE, PAD_ATTRIB } from '@ziroeda/pcbnew/src/pad.js';
import { PCB_FIELD, MANDATORY_FIELD_T } from '@ziroeda/pcbnew/src/pcb_field.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

const mkFp = (pos = { x: 0, y: 0 }, padPos = { x: 0, y: 100 }): FOOTPRINT => {
  const pad = new PAD({
    number: '1',
    pos: padPos,
    size: { x: 60, y: 60 },
    shape: PAD_SHAPE.CIRCLE,
    attribute: PAD_ATTRIB.SMD,
    layers: ['F.Cu'],
  });
  const ref = new PCB_FIELD('F.SilkS', MANDATORY_FIELD_T.REFERENCE, 'Reference', {
    text: 'R1',
    pos,
    size: { x: 1000, y: 1000 },
  });
  return new FOOTPRINT({ fpid: 'R:0603', pos, layer: 'F.Cu', pads: [pad], fields: [ref] });
};

describe('FOOTPRINT', () => {
  it('reads reference and pads', () => {
    const fp = mkFp();
    expect(fp.GetReference()).toBe('R1');
    expect(fp.Pads()).toHaveLength(1);
  });

  it('Move translates the anchor and children', () => {
    const fp = mkFp({ x: 0, y: 0 }, { x: 0, y: 100 });
    fp.Move({ x: 10, y: 20 });
    expect(fp.GetPosition()).toEqual({ x: 10, y: 20 });
    expect(fp.Pads()[0]!.GetPosition()).toEqual({ x: 10, y: 120 });
  });

  it('Rotate advances orientation and rotates children about the anchor', () => {
    const fp = mkFp({ x: 0, y: 0 }, { x: 100, y: 0 });
    fp.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(fp.GetOrientation().AsDegrees()).toBe(90);
    expect(fp.Pads()[0]!.GetPosition()).toEqual({ x: 0, y: -100 });
  });

  it('Flip TOP_BOTTOM flips side + mirrors children (FOOTPRINT::Flip)', () => {
    const fp = mkFp({ x: 0, y: 0 }, { x: 0, y: 100 });
    fp.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    expect(fp.GetLayer()).toBe('B.Cu');
    const pad = fp.Pads()[0]!;
    expect(pad.GetPosition()).toEqual({ x: 0, y: -100 }); // mirrored about the anchor's Y
    expect(pad.GetLayer()).toBe('B.Cu'); // child layer flipped too
  });

  it('Flip LEFT_RIGHT flips side and child layers', () => {
    const fp = mkFp({ x: 100, y: 0 }, { x: 150, y: 0 });
    fp.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(fp.GetLayer()).toBe('B.Cu');
    expect(fp.Pads()[0]!.GetLayer()).toBe('B.Cu');
  });

  it('HitTest inside the footprint bounding box', () => {
    const fp = mkFp({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(fp.HitTest({ x: 0, y: 100 }, 0)).toBe(true);
    expect(fp.HitTest({ x: 5000, y: 5000 }, 0)).toBe(false);
  });
});
