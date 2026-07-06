import { describe, it, expect } from 'vitest';
import {
  rotationTransform,
  symbolTransform,
  applyTransform,
  localToWorld,
} from '../src/geom/transform.js';
import { mmToIU } from '../src/units.js';

describe('rotationTransform', () => {
  it('matches KiCad rotation matrices', () => {
    expect(rotationTransform(0)).toEqual({ x1: 1, y1: 0, x2: 0, y2: 1 });
    expect(rotationTransform(90)).toEqual({ x1: 0, y1: 1, x2: -1, y2: 0 });
    expect(rotationTransform(180)).toEqual({ x1: -1, y1: 0, x2: 0, y2: -1 });
    expect(rotationTransform(270)).toEqual({ x1: 0, y1: -1, x2: 1, y2: 0 });
  });

  it('rotates a unit vector correctly', () => {
    // Local +X under 90° rotation maps to (0, -1) given world +Y is down.
    expect(applyTransform(rotationTransform(90), { x: 10, y: 0 })).toEqual({ x: 0, y: -10 });
  });
});

describe('symbolTransform with mirror', () => {
  it('composes mirror-Y onto identity (flip X)', () => {
    expect(symbolTransform(0, 'y')).toEqual({ x1: -1, y1: 0, x2: 0, y2: 1 });
  });

  it('composes mirror-X onto identity (flip Y)', () => {
    expect(symbolTransform(0, 'x')).toEqual({ x1: 1, y1: 0, x2: 0, y2: -1 });
  });
});

describe('localToWorld — verified against the real fixture geometry', () => {
  it('maps Conn_01x02 pin 1 to the wire start point', () => {
    // From nfc-antenna.kicad_sch: symbol J1 placed at (156.21, 111.76) angle 180,
    // pin 1 local position (-5.08, 0). KiCad's transform must land it on the wire
    // start at (161.29, 111.76).
    const origin = { x: mmToIU(156.21), y: mmToIU(111.76) };
    const t = symbolTransform(180);
    const pin1Local = { x: mmToIU(-5.08), y: mmToIU(0) };
    expect(localToWorld(origin, t, pin1Local)).toEqual({
      x: mmToIU(161.29),
      y: mmToIU(111.76),
    });
  });
});
