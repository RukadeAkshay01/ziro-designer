import { describe, it, expect } from 'vitest';
import { buildRatsnest } from '@ziroeda/pcbnew/src/ratsnest.js';
import type {
  Board,
  PcbPad,
  PcbFootprint,
  PcbTrack,
  PcbVia,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

const pad = (at: { x: number; y: number }, net: number, type: PcbPad['type'] = 'smd'): PcbPad => ({
  number: '1',
  type,
  shape: 'rect',
  at,
  angle: 0,
  size: { x: 100, y: 100 },
  layers: type === 'thru_hole' ? ['*.Cu'] : ['F.Cu'],
  net,
  source: EMPTY,
});
const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
});
const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  net: number,
  layer = 'F.Cu',
): PcbTrack => ({ start, end, width: 100, layer, net, source: EMPTY });
const via = (at: { x: number; y: number }, net: number): PcbVia => ({
  at,
  size: 200,
  drill: 100,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
});
const zone = (
  net: number,
  layer: string,
  poly: { x: number; y: number }[],
  fillPolys?: { x: number; y: number }[][],
): PcbZone => ({
  net,
  layers: [layer],
  outline: poly,
  fills: (fillPolys ?? [poly]).map((polys) => ({ layer, polys: [polys] })),
  source: EMPTY,
});

const board = (over: Partial<Board>): Board => ({
  version: 20241229,
  layers: [],
  nets: new Map([
    [1, 'N1'],
    [2, 'N2'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  groups: [],
  source: EMPTY,
  ...over,
});

describe('buildRatsnest', () => {
  it('two unconnected pads of a net make one airwire; a track closes it', () => {
    const open = board({
      footprints: [footprint([pad({ x: 0, y: 0 }, 1), pad({ x: 1000, y: 0 }, 1)])],
    });
    const edges = buildRatsnest(open);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.net).toBe(1);

    const routed = board({
      footprints: [footprint([pad({ x: 0, y: 0 }, 1), pad({ x: 1000, y: 0 }, 1)])],
      tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1)],
    });
    expect(buildRatsnest(routed)).toHaveLength(0);
  });

  it('multi-segment routes and vias connect across layers', () => {
    const b = board({
      footprints: [
        footprint([pad({ x: 0, y: 0 }, 1, 'thru_hole'), pad({ x: 2000, y: 0 }, 1, 'thru_hole')]),
      ],
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }, 1, 'B.Cu'),
      ],
      vias: [via({ x: 1000, y: 0 }, 1)],
    });
    expect(buildRatsnest(b)).toHaveLength(0);
  });

  it('a filled zone connects the items inside it', () => {
    const b = board({
      footprints: [footprint([pad({ x: 100, y: 100 }, 1), pad({ x: 900, y: 900 }, 1)])],
      zones: [
        zone(1, 'F.Cu', [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 1000 },
          { x: 0, y: 1000 },
        ]),
      ],
    });
    expect(buildRatsnest(b)).toHaveLength(0);
  });

  it('a poured zone connects thermally-relieved pads whose centres miss the fill', () => {
    // The fill is the outer ring only (a big hole in the middle), so neither
    // pad centre lands inside a fill polygon — but both are inside the zone
    // outline, so the pour still connects them (no airwire), like KiCad.
    const outerRing = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const holeFill = [
      // a thin frame with a big empty centre — pad centres fall in the hole
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const b = board({
      footprints: [footprint([pad({ x: 1000, y: 500 }, 1), pad({ x: 1000, y: 1500 }, 1)])],
      zones: [zone(1, 'F.Cu', outerRing, [holeFill])],
    });
    expect(buildRatsnest(b)).toHaveLength(0);
  });

  it('an unfilled (not poured) zone does not connect pads', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ];
    const b = board({
      footprints: [footprint([pad({ x: 100, y: 100 }, 1), pad({ x: 900, y: 900 }, 1)])],
      zones: [
        { net: 1, layers: ['F.Cu'], outline, fills: [], source: { kind: 'list', items: [] } },
      ],
    });
    expect(buildRatsnest(b)).toHaveLength(1);
  });

  it('separate nets and disconnected clusters each get their own airwires', () => {
    const b = board({
      footprints: [
        footprint([pad({ x: 0, y: 0 }, 1), pad({ x: 1000, y: 0 }, 1), pad({ x: 2000, y: 0 }, 1)]),
        footprint([pad({ x: 0, y: 5000 }, 2), pad({ x: 1000, y: 5000 }, 2)]),
      ],
    });
    const edges = buildRatsnest(b);
    // Net 1: three clusters -> two airwires; net 2: two clusters -> one.
    expect(edges.filter((e) => e.net === 1)).toHaveLength(2);
    expect(edges.filter((e) => e.net === 2)).toHaveLength(1);
  });

  it('SMD pads on different layers do not join without a via', () => {
    const front = pad({ x: 0, y: 0 }, 1);
    const back: PcbPad = { ...pad({ x: 0, y: 0 }, 1), layers: ['B.Cu'] };
    const b = board({ footprints: [footprint([front, back])] });
    expect(buildRatsnest(b)).toHaveLength(1);
  });
});
