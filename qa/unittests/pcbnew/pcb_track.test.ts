import { describe, it, expect } from 'vitest';
import { PCB_TRACK, PCB_ARC, PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/src/pcb_track.js';
import { EDA_ANGLE, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { FlipLayer } from '@ziroeda/pcbnew/src/layer_ids.js';

describe('EDA_ANGLE', () => {
  it('normalizes into [0, 360)', () => {
    expect(new EDA_ANGLE(-90).Normalize().AsDegrees()).toBe(270);
    expect(new EDA_ANGLE(450).Normalize().AsDegrees()).toBe(90);
  });
  it('Normalize180 into (-180, 180]', () => {
    expect(new EDA_ANGLE(270).Normalize180().AsDegrees()).toBe(-90);
  });
  it('cardinal Sin/Cos are exact', () => {
    expect(ANGLE_90.Sin()).toBe(1);
    expect(ANGLE_90.Cos()).toBe(0);
  });
  it('fromVector is cardinal-exact', () => {
    expect(EDA_ANGLE.fromVector({ x: 1, y: 0 }).AsDegrees()).toBe(0);
    expect(EDA_ANGLE.fromVector({ x: 0, y: 1 }).AsDegrees()).toBe(90);
    expect(EDA_ANGLE.fromVector({ x: 5, y: 5 }).AsDegrees()).toBe(45);
  });
});

describe('RotatePoint / TestSegmentHit', () => {
  it('rotates cardinally (90° = (y, -x))', () => {
    expect(RotatePoint({ x: 100, y: 0 }, ANGLE_90)).toEqual({ x: 0, y: -100 });
  });
  it('rotates about a centre', () => {
    expect(RotatePoint({ x: 110, y: 10 }, { x: 10, y: 10 }, ANGLE_90)).toEqual({ x: 10, y: -90 });
  });
  it('TestSegmentHit within distance', () => {
    expect(TestSegmentHit({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toBe(true);
    expect(TestSegmentHit({ x: 50, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toBe(false);
  });
});

describe('FlipLayer', () => {
  it('swaps front/back', () => {
    expect(FlipLayer('F.Cu')).toBe('B.Cu');
    expect(FlipLayer('B.SilkS')).toBe('F.SilkS');
    expect(FlipLayer('Edge.Cuts')).toBe('Edge.Cuts');
  });
});

describe('PCB_TRACK', () => {
  const mk = (): PCB_TRACK => new PCB_TRACK({ x: 100, y: 0 }, { x: 200, y: 0 }, 100, 'F.Cu', 1);

  it('Move translates both endpoints', () => {
    const t = mk();
    t.Move({ x: 10, y: 20 });
    expect(t.GetStart()).toEqual({ x: 110, y: 20 });
    expect(t.GetEnd()).toEqual({ x: 210, y: 20 });
  });
  it('Rotate 90° about origin', () => {
    const t = mk();
    t.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(t.GetStart()).toEqual({ x: 0, y: -100 });
    expect(t.GetEnd()).toEqual({ x: 0, y: -200 });
  });
  it('Flip left-right mirrors X and flips the layer', () => {
    const t = mk();
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetStart()).toEqual({ x: -100, y: 0 });
    expect(t.GetEnd()).toEqual({ x: -200, y: 0 });
    expect(t.GetLayer()).toBe('B.Cu');
  });
  it('HitTest respects half-width + accuracy', () => {
    const t = mk();
    expect(t.HitTest({ x: 150, y: 40 }, 10)).toBe(true); // 40 <= 10 + 50
    expect(t.HitTest({ x: 150, y: 100 }, 10)).toBe(false);
  });
});

describe('PCB_ARC', () => {
  // CCW quarter arc, centre origin, radius 1000.
  const mk = (): PCB_ARC =>
    new PCB_ARC({ x: 1000, y: 0 }, { x: 707, y: 707 }, { x: 0, y: 1000 }, 100, 'F.Cu', 1);

  it('centre and radius', () => {
    const a = mk();
    expect(a.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(Math.round(a.GetRadius())).toBe(1000);
  });
  it('HitTest on the arc, and misses off-sweep', () => {
    const a = mk();
    expect(a.HitTest({ x: 707, y: 707 }, 20)).toBe(true);
    expect(a.HitTest({ x: -1000, y: 0 }, 20)).toBe(false); // radius ok, wrong angle
  });
  it('Rotate carries the mid point', () => {
    const a = mk();
    a.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(a.GetMid()).toEqual({ x: 707, y: -707 });
  });
});

describe('PCB_VIA', () => {
  it('HitTest inside the pad radius', () => {
    const v = new PCB_VIA({ x: 0, y: 0 }, 200, 100, 'F.Cu', 'B.Cu', VIATYPE.THROUGH, 1);
    expect(v.HitTest({ x: 50, y: 0 }, 0)).toBe(true);
    expect(v.HitTest({ x: 0, y: 150 }, 10)).toBe(false);
  });
  it('through via keeps its layers on flip; blind via swaps them', () => {
    const through = new PCB_VIA({ x: 100, y: 0 }, 200, 100, 'F.Cu', 'B.Cu', VIATYPE.THROUGH, 1);
    through.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(through.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(through.GetLayer()).toBe('F.Cu'); // through: unchanged

    const blind = new PCB_VIA(
      { x: 100, y: 0 },
      200,
      100,
      'F.Cu',
      'In1.Cu',
      VIATYPE.BLIND_BURIED,
      1,
    );
    blind.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(blind.GetLayer()).toBe('B.Cu');
    expect(blind.GetBottomLayer()).toBe('In1.Cu');
  });
});
