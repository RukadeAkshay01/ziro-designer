import { describe, it, expect } from 'vitest';
import { PAD, PAD_SHAPE, PAD_ATTRIB } from '@ziroeda/pcbnew/src/pad.js';
import { EDA_ANGLE, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

const mk = (
  shape: PAD_SHAPE,
  size = { x: 200, y: 200 },
  extra: Partial<ConstructorParameters<typeof PAD>[0]> = {},
): PAD =>
  new PAD({
    number: '1',
    pos: { x: 0, y: 0 },
    size,
    shape,
    attribute: PAD_ATTRIB.SMD,
    layers: ['F.Cu', 'F.Paste', 'F.Mask'],
    netCode: 1,
    ...extra,
  });

describe('PAD transforms', () => {
  it('Move / Rotate update position and orientation', () => {
    const p = mk(PAD_SHAPE.RECTANGLE);
    p.SetPosition({ x: 100, y: 0 });
    p.Move({ x: 10, y: 20 });
    expect(p.GetPosition()).toEqual({ x: 110, y: 20 });

    const q = new PAD({
      number: '1',
      pos: { x: 100, y: 0 },
      size: { x: 200, y: 200 },
      shape: PAD_SHAPE.RECTANGLE,
      attribute: PAD_ATTRIB.SMD,
      layers: ['F.Cu'],
    });
    q.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(q.GetPosition()).toEqual({ x: 0, y: -100 });
    expect(q.GetOrientation().AsDegrees()).toBe(90);
  });

  it('Flip mirrors position, negates orientation, flips layers', () => {
    const p = new PAD({
      number: '1',
      pos: { x: 100, y: 0 },
      orient: new EDA_ANGLE(90),
      size: { x: 200, y: 200 },
      shape: PAD_SHAPE.RECTANGLE,
      attribute: PAD_ATTRIB.SMD,
      layers: ['F.Cu', 'F.Paste', 'F.Mask'],
    });
    p.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(p.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(p.GetOrientation().AsDegrees()).toBe(-90);
    expect(p.GetLayerSet()).toEqual(['B.Cu', 'B.Paste', 'B.Mask']);
    expect(p.GetLayer()).toBe('B.Cu');
  });
});

describe('PAD HitTest by shape', () => {
  it('circle', () => {
    const p = mk(PAD_SHAPE.CIRCLE);
    expect(p.HitTest({ x: 50, y: 0 }, 0)).toBe(true);
    expect(p.HitTest({ x: 0, y: 150 }, 0)).toBe(false);
  });
  it('rectangle honors half-size', () => {
    const p = mk(PAD_SHAPE.RECTANGLE, { x: 400, y: 200 });
    expect(p.HitTest({ x: 150, y: 90 }, 0)).toBe(true);
    expect(p.HitTest({ x: 150, y: 150 }, 0)).toBe(false);
  });
  it('oval is a stadium', () => {
    const p = mk(PAD_SHAPE.OVAL, { x: 400, y: 200 });
    expect(p.HitTest({ x: 150, y: 0 }, 0)).toBe(true);
    expect(p.HitTest({ x: 0, y: 150 }, 0)).toBe(false);
  });
  it('roundrect rounds the corners', () => {
    const p = mk(PAD_SHAPE.ROUNDRECT, { x: 200, y: 200 }, { roundRectRadiusRatio: 0.25 });
    expect(p.HitTest({ x: 60, y: 0 }, 0)).toBe(true); // straight edge
    expect(p.HitTest({ x: 99, y: 99 }, 0)).toBe(false); // clipped corner
  });
  it('respects orientation (rotated rect)', () => {
    const p = mk(PAD_SHAPE.RECTANGLE, { x: 400, y: 200 }, { orient: new EDA_ANGLE(90) });
    // After 90° the long axis is vertical: (90,150) should now be inside.
    expect(p.HitTest({ x: 90, y: 150 }, 0)).toBe(true);
    expect(p.HitTest({ x: 150, y: 90 }, 0)).toBe(false);
  });
});
