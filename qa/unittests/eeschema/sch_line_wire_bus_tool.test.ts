/**
 * Interactive wire-drawing model (counterpart eeschema/tools/
 * sch_line_wire_bus_tool.cpp): two-segment break-point coercion in 90°/45°
 * modes, posture switching, backtrack simplification, and the finishing
 * commit with automatic junctions.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  readSchematic,
  startSegments,
  computeBreakPoint,
  switchPosture90,
  simplifyWireList,
  finishWires,
  isTerminalPoint,
  type WireSeg,
} from '@ziroeda/eeschema';

const seg = (ax: number, ay: number, bx: number, by: number): WireSeg => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

const EMPTY_SCH = `(kicad_sch (version 20250114) (generator "test") (uuid "00000000-0000-0000-0000-000000000000") (paper "A4"))`;

describe('computeBreakPoint (90° mode)', () => {
  it('bends horizontal-first when the cursor delta is mostly horizontal', () => {
    const [s1, s2] = startSegments({ x: 0, y: 0 }, '90') as [WireSeg, WireSeg];
    computeBreakPoint(s1, s2, { x: 100, y: 40 }, '90', false);
    expect(s1.b).toEqual({ x: 100, y: 0 });
    expect(s2.a).toEqual({ x: 100, y: 0 });
    expect(s2.b).toEqual({ x: 100, y: 40 });
  });

  it('maintains the existing first-segment direction', () => {
    // First segment already vertical: keep it vertical even though the
    // remaining delta is mostly horizontal.
    const s1 = seg(0, 0, 0, 50);
    const s2 = seg(0, 50, 10, 50);
    computeBreakPoint(s1, s2, { x: 200, y: 60 }, '90', false);
    expect(s1.a.x).toBe(0);
    expect(s1.b).toEqual({ x: 0, y: 60 });
    expect(s2.b).toEqual({ x: 200, y: 60 });
  });

  it('switchPosture90 swaps the H/V order of the live pair', () => {
    const s1 = seg(0, 0, 100, 0);
    const s2 = seg(100, 0, 100, 40);
    switchPosture90(s1, s2);
    expect(s1.b).toEqual({ x: 0, y: 40 });
    expect(s2.a).toEqual({ x: 0, y: 40 });
    expect(s2.b).toEqual({ x: 100, y: 40 });
  });
});

describe('computeBreakPoint (45° mode)', () => {
  it('ends with the angled portion at the cursor (posture false)', () => {
    const [s1, s2] = startSegments({ x: 0, y: 0 }, '45') as [WireSeg, WireSeg];
    computeBreakPoint(s1, s2, { x: 100, y: 40 }, '45', false);
    // First leg horizontal, second leg a pure 45° diagonal into the cursor.
    expect(s1.b).toEqual({ x: 60, y: 0 });
    const d = { x: s2.b.x - s2.a.x, y: s2.b.y - s2.a.y };
    expect(Math.abs(d.x)).toBe(Math.abs(d.y));
    expect(s2.b).toEqual({ x: 100, y: 40 });
  });

  it('leads with the angled portion when the posture is flipped', () => {
    const [s1, s2] = startSegments({ x: 0, y: 0 }, '45') as [WireSeg, WireSeg];
    computeBreakPoint(s1, s2, { x: 100, y: 40 }, '45', true);
    const d1 = { x: s1.b.x - s1.a.x, y: s1.b.y - s1.a.y };
    expect(Math.abs(d1.x)).toBe(Math.abs(d1.y)); // diagonal first
    expect(s2.b).toEqual({ x: 100, y: 40 });
  });
});

describe('simplifyWireList', () => {
  it('drops null segments', () => {
    expect(simplifyWireList([seg(0, 0, 0, 0), seg(0, 0, 50, 0)])).toEqual([seg(0, 0, 50, 0)]);
  });

  it('merges collinear continuations', () => {
    expect(simplifyWireList([seg(0, 0, 50, 0), seg(50, 0, 80, 0)])).toEqual([seg(0, 0, 80, 0)]);
  });

  it('removes backtracks over the previous segment', () => {
    expect(simplifyWireList([seg(0, 0, 100, 0), seg(100, 0, 40, 0)])).toEqual([seg(0, 0, 40, 0)]);
    // Complete backtrack cancels out entirely.
    expect(simplifyWireList([seg(0, 0, 100, 0), seg(100, 0, 0, 0)])).toEqual([]);
  });
});

describe('finishWires', () => {
  it('commits the simplified chain as wire lines', () => {
    const sch = readSchematic(parse(EMPTY_SCH));
    const cmd = finishWires(sch, new Map(), [seg(0, 0, 100, 0), seg(100, 0, 100, 50)], 'wire');
    const next = cmd!.apply(sch);
    expect(next.lines.filter((l) => l.kind === 'wire')).toHaveLength(2);
    expect(next.junctions).toHaveLength(0);
  });

  it('adds a junction where a new wire ends on an existing wire interior', () => {
    const sch = readSchematic(parse(EMPTY_SCH));
    const base = finishWires(sch, new Map(), [seg(0, 0, 100, 0)], 'wire')!.apply(sch);
    const next = finishWires(base, new Map(), [seg(50, 0, 50, 80)], 'wire')!.apply(base);
    expect(next.junctions).toHaveLength(1);
    expect(next.junctions[0]!.at).toEqual({ x: 50, y: 0 });
  });

  it('is terminal on another wire but not on empty space', () => {
    const sch = readSchematic(parse(EMPTY_SCH));
    const base = finishWires(sch, new Map(), [seg(0, 0, 100, 0)], 'wire')!.apply(sch);
    expect(isTerminalPoint(base, new Map(), { x: 50, y: 0 }, 'wire')).toBe(true);
    expect(isTerminalPoint(base, new Map(), { x: 50, y: 40 }, 'wire')).toBe(false);
    // A wire is not a terminal for a bus.
    expect(isTerminalPoint(base, new Map(), { x: 50, y: 0 }, 'bus')).toBe(false);
  });
});
