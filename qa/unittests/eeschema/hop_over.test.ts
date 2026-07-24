/**
 * Wire hop-over geometry — SCH_LINE::ShouldHopOver + BuildWireWithHopShape
 * (eeschema/sch_line.cpp). Each quirk asserted here matches the C++ source:
 * horizontal wires hop over vertical ones, the shallower of two sloped wires
 * hops, endpoint (T-junction) crossings never hop, coincident crossings from
 * several wires produce one arc, and hops are ordered by distance from the
 * wire's start point.
 */

import { describe, expect, it } from 'vitest';
import {
  buildWireWithHopShape,
  shouldHopOver,
  type HopShapePart,
} from '@ziroeda/eeschema/src/tools/hop_over.js';
import { makeBus, makeWire } from '@ziroeda/eeschema/src/tools/build.js';
import type { SchLine, Vec2 } from '@ziroeda/eeschema/src/types.js';

const w = (x1: number, y1: number, x2: number, y2: number): SchLine =>
  makeWire({ x: x1, y: y1 }, { x: x2, y: y2 });

// Arc radius under test: 6-mil default line width (1524 IU) × "Smallest" would
// be 2590; a plain 1524 keeps the expected coordinates readable.
const R = 1524;

describe('shouldHopOver (SCH_LINE::ShouldHopOver)', () => {
  it('a horizontal wire hops over a vertical one, not the reverse', () => {
    const horizontal = w(0, 0, 100, 0);
    const vertical = w(50, -50, 50, 50);
    expect(shouldHopOver(horizontal, vertical)).toBe(true);
    expect(shouldHopOver(vertical, horizontal)).toBe(false);
  });

  it('the shallower of two sloped wires hops', () => {
    const shallow = w(0, 0, 100, 10); // slope 0.1
    const steep = w(0, 100, 100, -100); // slope -2
    expect(shouldHopOver(shallow, steep)).toBe(true);
    expect(shouldHopOver(steep, shallow)).toBe(false);
  });

  it('equal |slope| (45° crossing) resolves by signed slope comparison', () => {
    const down = w(0, 0, 100, 100); // slope +1 (screen-down in KiCad coords)
    const up = w(0, 100, 100, 0); // slope -1
    expect(shouldHopOver(up, down)).toBe(true);
    expect(shouldHopOver(down, up)).toBe(false);
  });
});

describe('buildWireWithHopShape (SCH_LINE::BuildWireWithHopShape)', () => {
  it('a horizontal wire crossing a vertical one breaks into two segments and an arc', () => {
    const line = w(0, 0, 200, 0);
    const cross = w(100, -100, 100, 100);
    const parts = buildWireWithHopShape(line, [line, cross], R);

    expect(parts.map((p) => p.kind)).toEqual(['seg', 'arc', 'seg']);
    const [before, arc, after] = parts as [
      Extract<HopShapePart, { kind: 'seg' }>,
      Extract<HopShapePart, { kind: 'arc' }>,
      Extract<HopShapePart, { kind: 'seg' }>,
    ];
    // beforeHop / afterHop are R along the line either side of the crossing.
    expect(before.a).toEqual({ x: 0, y: 0 });
    expect(before.b).toEqual({ x: 100 - R, y: 0 });
    expect(after.a).toEqual({ x: 100 + R, y: 0 });
    expect(after.b).toEqual({ x: 200, y: 0 });
    // For a horizontal line (arcAngle 0) the arc's midpoint sits R above the
    // crossing: hopMid + ( R·sin 0, −R·cos 0 ).
    expect(arc.start).toEqual({ x: 100 - R, y: 0 });
    expect(arc.mid).toEqual({ x: 100, y: -R });
    expect(arc.end).toEqual({ x: 100 + R, y: 0 });
  });

  it('the vertical wire of the crossing draws plain', () => {
    const line = w(100, -100, 100, 100);
    const cross = w(0, 0, 200, 0);
    const parts = buildWireWithHopShape(line, [line, cross], R);
    expect(parts).toEqual([
      { kind: 'seg', a: { x: 100, y: -100 }, b: { x: 100, y: 100 } },
    ] satisfies HopShapePart[]);
  });

  it('a crossing at either line’s endpoint (T-junction) never hops', () => {
    const line = w(0, 0, 200, 0);
    const tee = w(100, 0, 100, 100); // starts ON the line
    expect(buildWireWithHopShape(line, [line, tee], R)).toEqual([
      { kind: 'seg', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
    ]);
  });

  it('multiple crossings hop in order of distance from the start point', () => {
    const line = w(0, 0, 400, 0);
    const c1 = w(300, -50, 300, 50);
    const c2 = w(100, -50, 100, 50);
    const parts = buildWireWithHopShape(line, [line, c1, c2], R);
    expect(parts.map((p) => p.kind)).toEqual(['seg', 'arc', 'seg', 'arc', 'seg']);
    const arcs = parts.filter((p): p is Extract<HopShapePart, { kind: 'arc' }> => p.kind === 'arc');
    expect(arcs[0]!.mid.x).toBe(100);
    expect(arcs[1]!.mid.x).toBe(300);
  });

  it('several wires crossing at the same point produce a single arc', () => {
    const line = w(0, 0, 200, 0);
    const v1 = w(100, -100, 100, 100);
    const v2 = w(100, -200, 100, 200);
    const parts = buildWireWithHopShape(line, [line, v1, v2], R);
    expect(parts.filter((p) => p.kind === 'arc')).toHaveLength(1);
  });

  it('graphic polylines pass through untouched, and buses hop like wires', () => {
    const graphic: SchLine = { ...w(0, 0, 200, 0), kind: 'polyline' };
    const cross = w(100, -100, 100, 100);
    expect(buildWireWithHopShape(graphic, [cross], R)).toEqual([
      { kind: 'seg', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
    ]);

    const bus = makeBus({ x: 0, y: 0 }, { x: 200, y: 0 });
    const busCross = makeBus({ x: 100, y: -100 }, { x: 100, y: 100 });
    expect(
      buildWireWithHopShape(bus, [bus, busCross], R).filter((p) => p.kind === 'arc'),
    ).toHaveLength(1);
  });

  it('a 45° crossing hops with the arc perpendicular to the wire', () => {
    // up-slope wire (slope −1) hops over the down-slope one (slope +1).
    const up = w(0, 200, 200, 0);
    const down = w(0, 0, 200, 200);
    const parts = buildWireWithHopShape(up, [up, down], R);
    expect(parts.map((p) => p.kind)).toEqual(['seg', 'arc', 'seg']);
    const arc = parts[1] as Extract<HopShapePart, { kind: 'arc' }>;
    // lineAngle = −45°; arcAngle normalizes to 135°: mid = hopMid + R·(sin135, −cos135).
    const s = Math.trunc(R * Math.SQRT1_2);
    expect(arc.mid).toEqual({ x: 100 + s, y: 100 + s });

    // The down-slope wire draws plain.
    expect(buildWireWithHopShape(down, [up, down], R).map((p) => p.kind)).toEqual(['seg']);
  });

  it('collinear overlapping wires never intersect (SEG::Intersect determinant 0)', () => {
    const line = w(0, 0, 200, 0);
    const overlap = w(50, 0, 300, 0);
    expect(buildWireWithHopShape(line, [line, overlap], R).map((p) => p.kind)).toEqual(['seg']);
  });
});
