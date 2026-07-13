import { describe, it, expect } from 'vitest';
import { ZONE } from '@ziroeda/pcbnew/src/zone.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const square = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const mk = (): ZONE => {
  const outline = square(mmToIU(10), mmToIU(10), mmToIU(20), mmToIU(20));
  const fills = new Map([['F.Cu', [outline.map((p) => ({ ...p }))]]]);
  return new ZONE({ outline, layers: ['F.Cu'], fills, netCode: 1 });
};

describe('ZONE', () => {
  it('HitTest on the outline edge/corner, not the interior', () => {
    const z = mk();
    expect(z.HitTest({ x: mmToIU(15), y: mmToIU(10) }, 0)).toBe(true); // on the top edge
    expect(z.HitTest({ x: mmToIU(10), y: mmToIU(10) }, 0)).toBe(true); // on a corner
    expect(z.HitTest({ x: mmToIU(15), y: mmToIU(15) }, 0)).toBe(false); // interior: not an outline hit
  });
  it('HitTestFilledArea hits inside the pour', () => {
    const z = mk();
    expect(z.HitTestFilledArea('F.Cu', { x: mmToIU(15), y: mmToIU(15) })).toBe(true);
    expect(z.HitTestFilledArea('F.Cu', { x: mmToIU(5), y: mmToIU(15) })).toBe(false);
  });
  it('Move / Rotate carry outline + fills', () => {
    const z = new ZONE({
      outline: square(0, 0, 100, 100),
      layers: ['F.Cu'],
      fills: new Map([['F.Cu', [square(0, 0, 100, 100)]]]),
      netCode: 1,
    });
    z.Move({ x: 10, y: 20 });
    expect(z.GetOutline()[0]).toEqual({ x: 10, y: 20 });
    z.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(z.GetOutline()[0]).toEqual({ x: 20, y: -10 });
    expect(z.GetFills().get('F.Cu')![0]![0]).toEqual({ x: 20, y: -10 });
  });
  it('Flip mirrors geometry and moves to the other side', () => {
    const z = new ZONE({
      outline: square(100, 0, 200, 100),
      layers: ['F.Cu'],
      fills: new Map([['F.Cu', [square(100, 0, 200, 100)]]]),
      netCode: 1,
    });
    z.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(z.GetLayer()).toBe('B.Cu');
    expect(z.GetFills().has('B.Cu')).toBe(true);
    expect(z.GetOutline()[0]).toEqual({ x: -100, y: 0 });
  });
});
