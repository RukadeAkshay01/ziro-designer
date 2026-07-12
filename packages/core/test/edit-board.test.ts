import { describe, it, expect } from 'vitest';
import {
  boardItemId, parseBoardItemId, boardItemBBox,
  hitTestBoard, boardHitCandidates, boardItemsInBox, moveBoardItems,
} from '../src/pcb/edit-board.js';
import { parse } from '../src/sexpr/index.js';
import { readBoard } from '../src/pcb/read-board.js';
import { serializeBoard } from '../src/pcb/write-board.js';
import { mmToIU } from '../src/units.js';
import type { Board, PcbTrack, PcbArcTrack, PcbVia, PcbFootprint, PcbShape, PcbTextItem, PcbZone, PcbPad } from '../src/pcb/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

// Minimal typed-model builders (geometry is unit-agnostic; coords in internal units).
const track = (start: { x: number; y: number }, end: { x: number; y: number }, width = 100): PcbTrack =>
  ({ start, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const via = (at: { x: number; y: number }, size = 200): PcbVia =>
  ({ at, size, drill: 100, layers: ['F.Cu', 'B.Cu'], kind: 'through', net: 0, source: EMPTY });
const arcTrack = (start: { x: number; y: number }, mid: { x: number; y: number }, end: { x: number; y: number }, width = 100): PcbArcTrack =>
  ({ start, mid, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const pad = (at: { x: number; y: number }, sx: number, sy: number): PcbPad =>
  ({ number: '1', type: 'smd', shape: 'rect', at, angle: 0, size: { x: sx, y: sy }, layers: ['F.Cu'], source: EMPTY });
const footprint = (pads: PcbPad[]): PcbFootprint =>
  ({ lib: 'R', at: { x: 0, y: 0 }, angle: 0, layer: 'F.Cu', pads, shapes: [], texts: [], models: [], source: EMPTY });
const lineShape = (start: { x: number; y: number }, end: { x: number; y: number }, width = 100): PcbShape =>
  ({ kind: 'line', start, end, width, fill: false, layer: 'Edge.Cuts', source: EMPTY });
const text = (at: { x: number; y: number }, s: string, size = 1000): PcbTextItem =>
  ({ kind: 'user', text: s, at, angle: 0, layer: 'F.SilkS', size: { x: size, y: size }, source: EMPTY });
const zone = (poly: { x: number; y: number }[]): PcbZone =>
  ({ net: 0, layers: ['F.Cu'], fills: [{ layer: 'F.Cu', polys: [poly] }], source: EMPTY });

const board = (over: Partial<Board>): Board => ({
  version: 20241229, layers: [], nets: new Map(), footprints: [], tracks: [], arcs: [],
  vias: [], zones: [], shapes: [], texts: [], source: EMPTY, ...over,
});

describe('board item ids', () => {
  it('round-trips id <-> ref', () => {
    expect(parseBoardItemId(boardItemId('track', 3))).toEqual({ kind: 'track', index: 3 });
    expect(parseBoardItemId('footprint:0')).toEqual({ kind: 'footprint', index: 0 });
  });
  it('rejects malformed ids', () => {
    expect(parseBoardItemId('bogus:1')).toBeNull();
    expect(parseBoardItemId('track')).toBeNull();
    expect(parseBoardItemId('track:-1')).toBeNull();
    expect(parseBoardItemId('via:x')).toBeNull();
  });
});

describe('track hit-test (TestSegmentHit)', () => {
  const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)] });
  it('hits within accuracy + half-width of the segment', () => {
    expect(hitTestBoard(b, { x: 500, y: 40 }, 10)).toBe('track:0'); // 40 <= 10 + 50
  });
  it('misses beyond accuracy + half-width', () => {
    expect(hitTestBoard(b, { x: 500, y: 100 }, 10)).toBeNull(); // 100 > 60
  });
  it('misses past the endpoints', () => {
    expect(hitTestBoard(b, { x: 1200, y: 0 }, 10)).toBeNull();
  });
});

describe('via hit-test', () => {
  const b = board({ vias: [via({ x: 2000, y: 0 }, 200)] }); // radius 100
  it('hits inside the pad radius', () => {
    expect(hitTestBoard(b, { x: 2050, y: 0 }, 0)).toBe('via:0');
  });
  it('misses outside radius + accuracy', () => {
    expect(hitTestBoard(b, { x: 2000, y: 150 }, 10)).toBeNull(); // 150 > 110
  });
});

describe('arc hit-test (PCB_ARC::HitTest)', () => {
  // CCW quarter arc centred at origin, radius 1000: (1000,0) -> (707,707) -> (0,1000)
  const b = board({ arcs: [arcTrack({ x: 1000, y: 0 }, { x: 707, y: 707 }, { x: 0, y: 1000 }, 100)] });
  it('hits a point on the arc band within the sweep', () => {
    expect(hitTestBoard(b, { x: 707, y: 707 }, 20)).toBe('arc:0');
  });
  it('hits at an endpoint (short-circuit)', () => {
    expect(hitTestBoard(b, { x: 1000, y: 0 }, 5)).toBe('arc:0');
  });
  it('misses a point on the circle but outside the sweep', () => {
    expect(hitTestBoard(b, { x: -1000, y: 0 }, 20)).toBeNull(); // radius ok, angle 180 not in [0,90]
  });
  it('misses a point off the radial band', () => {
    expect(hitTestBoard(b, { x: 500, y: 500 }, 20)).toBeNull(); // dist ~707 vs r 1000
  });
});

describe('shape hit-test (EDA_SHAPE)', () => {
  it('line: near the segment', () => {
    const b = board({ shapes: [lineShape({ x: 0, y: 2000 }, { x: 1000, y: 2000 }, 100)] });
    expect(hitTestBoard(b, { x: 500, y: 2030 }, 10)).toBe('shape:0');
    expect(hitTestBoard(b, { x: 500, y: 2200 }, 10)).toBeNull();
  });
  it('unfilled rect: border is live, interior is not', () => {
    const s: PcbShape = { kind: 'rect', start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 }, width: 40, fill: false, layer: 'Edge.Cuts', source: EMPTY };
    const b = board({ shapes: [s] });
    expect(hitTestBoard(b, { x: 0, y: 500 }, 5)).toBe('shape:0'); // on left border
    expect(hitTestBoard(b, { x: 500, y: 500 }, 5)).toBeNull();    // interior
  });
  it('filled circle: interior hits', () => {
    const s: PcbShape = { kind: 'circle', center: { x: 0, y: 0 }, end: { x: 500, y: 0 }, width: 20, fill: true, layer: 'F.SilkS', source: EMPTY };
    const b = board({ shapes: [s] });
    expect(hitTestBoard(b, { x: 100, y: 100 }, 0)).toBe('shape:0');
  });
});

describe('text hit-test (bounding box)', () => {
  const b = board({ texts: [text({ x: 8000, y: 8000 }, 'AB', 1000)] });
  it('hits within the text box', () => {
    expect(hitTestBoard(b, { x: 8000, y: 8000 }, 0)).toBe('text:0');
  });
  it('misses well outside', () => {
    expect(hitTestBoard(b, { x: 8000, y: 9000 }, 0)).toBeNull();
  });
});

describe('zone hit-test (point in filled polygon)', () => {
  const b = board({ zones: [zone([{ x: 10000, y: 10000 }, { x: 11000, y: 10000 }, { x: 11000, y: 11000 }, { x: 10000, y: 11000 }])] });
  it('hits inside the pour', () => {
    expect(hitTestBoard(b, { x: 10500, y: 10500 }, 0)).toBe('zone:0');
  });
  it('misses outside the pour', () => {
    expect(hitTestBoard(b, { x: 9000, y: 10500 }, 0)).toBeNull();
  });
});

describe('footprint hit-test + selection priority', () => {
  // Footprint whose pad bbox spans 4800..5200; a track crosses the same region.
  const fp = footprint([pad({ x: 5000, y: 5000 }, 400, 400)]);
  const t = track({ x: 4000, y: 5000 }, { x: 6000, y: 5000 }, 100);
  it('selects the footprint when clicking its body (no smaller item)', () => {
    const b = board({ footprints: [fp] });
    expect(hitTestBoard(b, { x: 5000, y: 5100 }, 10)).toBe('footprint:0');
  });
  it('a track over a footprint wins the click (smaller item first)', () => {
    const b = board({ footprints: [fp], tracks: [t] });
    const cands = boardHitCandidates(b, { x: 5000, y: 5000 }, 10);
    expect(cands[0]).toBe('track:0');
    expect(cands).toContain('footprint:0');
  });
});

describe('box selection (contained vs crossing)', () => {
  const b = board({
    tracks: [
      track({ x: 0, y: 0 }, { x: 100, y: 0 }, 20),      // fully inside 0..1000
      track({ x: 900, y: 0 }, { x: 2000, y: 0 }, 20),   // straddles the right edge
    ],
    vias: [via({ x: 5000, y: 5000 }, 100)],             // far outside
  });
  it('contained: only items fully within the rect', () => {
    const sel = boardItemsInBox(b, 0, -500, 1000, 500, true);
    expect(sel).toContain('track:0');
    expect(sel).not.toContain('track:1');
    expect(sel).not.toContain('via:0');
  });
  it('crossing: items that merely intersect the rect', () => {
    const sel = boardItemsInBox(b, 0, -500, 1000, 500, false);
    expect(sel).toContain('track:0');
    expect(sel).toContain('track:1');
    expect(sel).not.toContain('via:0');
  });
});

describe('boardItemBBox', () => {
  it('via bbox is centre ± radius', () => {
    const b = board({ vias: [via({ x: 100, y: 200 }, 200)] });
    expect(boardItemBBox(b, 'via:0')).toEqual({ minX: 0, minY: 100, maxX: 200, maxY: 300 });
  });
  it('track bbox is inflated by half-width', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)] });
    expect(boardItemBBox(b, 'track:0')).toEqual({ minX: -50, minY: -50, maxX: 1050, maxY: 50 });
  });
  it('returns null for out-of-range / bad ids', () => {
    const b = board({});
    expect(boardItemBBox(b, 'track:0')).toBeNull();
    expect(boardItemBBox(b, 'nope:0')).toBeNull();
  });
});

describe('moveBoardItems', () => {
  it('moves only the selected items by the delta', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })],
      vias: [via({ x: 500, y: 500 })],
    });
    const moved = moveBoardItems(b, new Set(['track:0']), { x: 10, y: 20 });
    expect(moved.tracks[0]!.start).toEqual({ x: 10, y: 20 });
    expect(moved.tracks[0]!.end).toEqual({ x: 110, y: 20 });
    expect(moved.vias[0]!.at).toEqual({ x: 500, y: 500 }); // untouched
  });

  it('moves a footprint anchor and its board-absolute children together', () => {
    const b = board({ footprints: [footprint([pad({ x: 5000, y: 5000 }, 400, 400)])] });
    const moved = moveBoardItems(b, new Set(['footprint:0']), { x: 100, y: -100 });
    expect(moved.footprints[0]!.at).toEqual({ x: 100, y: -100 });
    expect(moved.footprints[0]!.pads[0]!.at).toEqual({ x: 5100, y: 4900 });
  });

  it('no-ops for an empty selection or a zero delta', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })] });
    expect(moveBoardItems(b, new Set(), { x: 10, y: 10 })).toBe(b);
    expect(moveBoardItems(b, new Set(['track:0']), { x: 0, y: 0 })).toBe(b);
  });

  it('patched sources survive a serialize round-trip at the new coordinates', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const moved = moveBoardItems(b, new Set(['track:0', 'via:0']), { x: mmToIU(5), y: mmToIU(0) });
    const reread = readBoard(parse(serializeBoard(moved)));
    expect(reread.tracks[0]!.start.x).toBe(mmToIU(15));
    expect(reread.tracks[0]!.end.x).toBe(mmToIU(35));
    expect(reread.vias[0]!.at.x).toBe(mmToIU(45));
    // The track kept its net/width (only coords were patched).
    expect(reread.tracks[0]!.net).toBe(1);
    expect(reread.tracks[0]!.width).toBe(mmToIU(0.25));
  });
});
