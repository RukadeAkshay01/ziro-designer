import { describe, it, expect } from 'vitest';
import { PCB_SHAPE } from '../src/kicad/pcbnew/pcb_shape.js';
import { SHAPE_T } from '../src/kicad/common/eda_shape.js';
import { ANGLE_90 } from '../src/kicad/common/eda_angle.js';
import { FLIP_DIRECTION } from '../src/kicad/common/mirror.js';

describe('PCB_SHAPE segment', () => {
  const mk = (): PCB_SHAPE => new PCB_SHAPE(SHAPE_T.SEGMENT, 'Edge.Cuts', { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, width: 100 });
  it('HitTest near the segment', () => {
    expect(mk().HitTest({ x: 500, y: 30 }, 10)).toBe(true);
    expect(mk().HitTest({ x: 500, y: 200 }, 10)).toBe(false);
  });
  it('Move / Rotate / Flip', () => {
    const s = mk();
    s.Move({ x: 10, y: 20 });
    expect(s.GetStart()).toEqual({ x: 10, y: 20 });
    s.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(s.GetStart()).toEqual({ x: 20, y: -10 });
    const f = new PCB_SHAPE(SHAPE_T.SEGMENT, 'F.SilkS', { start: { x: 100, y: 0 }, end: { x: 200, y: 0 }, width: 50 });
    f.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(f.GetStart()).toEqual({ x: -100, y: 0 });
    expect(f.GetLayer()).toBe('B.SilkS');
  });
});

describe('PCB_SHAPE rectangle', () => {
  it('unfilled: border live, interior not', () => {
    const s = new PCB_SHAPE(SHAPE_T.RECTANGLE, 'Edge.Cuts', { start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 }, width: 40, filled: false });
    expect(s.HitTest({ x: 0, y: 500 }, 5)).toBe(true);
    expect(s.HitTest({ x: 500, y: 500 }, 5)).toBe(false);
  });
  it('filled: interior hits', () => {
    const s = new PCB_SHAPE(SHAPE_T.RECTANGLE, 'F.Cu', { start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 }, width: 0, filled: true });
    expect(s.HitTest({ x: 500, y: 500 }, 0)).toBe(true);
  });
});

describe('PCB_SHAPE circle', () => {
  it('filled interior vs ring', () => {
    const filled = new PCB_SHAPE(SHAPE_T.CIRCLE, 'F.Cu', { start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, width: 20, filled: true });
    expect(filled.HitTest({ x: 100, y: 100 }, 0)).toBe(true);
    const ring = new PCB_SHAPE(SHAPE_T.CIRCLE, 'F.SilkS', { start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, width: 20, filled: false });
    expect(ring.HitTest({ x: 100, y: 100 }, 0)).toBe(false); // interior of a ring: miss
    expect(ring.HitTest({ x: 500, y: 0 }, 5)).toBe(true);    // on the circumference
  });
});

describe('PCB_SHAPE arc', () => {
  // CCW quarter arc, centre origin, radius 1000.
  const mk = (): PCB_SHAPE => new PCB_SHAPE(SHAPE_T.ARC, 'F.SilkS', { start: { x: 1000, y: 0 }, mid: { x: 707, y: 707 }, end: { x: 0, y: 1000 }, width: 100 });
  it('hits on-sweep, misses off-sweep', () => {
    expect(mk().HitTest({ x: 707, y: 707 }, 20)).toBe(true);
    expect(mk().HitTest({ x: -1000, y: 0 }, 20)).toBe(false);
  });
});
