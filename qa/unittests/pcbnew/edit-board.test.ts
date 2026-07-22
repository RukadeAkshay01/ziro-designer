import { describe, it, expect } from 'vitest';
import {
  boardItemId,
  parseBoardItemId,
  boardItemBBox,
  hitTestBoard,
  boardHitCandidates,
  boardItemsInBox,
  moveBoardItems,
  deleteBoardItems,
  rotateBoardItems,
  duplicateBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  Board,
  PcbTrack,
  PcbArcTrack,
  PcbVia,
  PcbFootprint,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbPad,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

// Minimal typed-model builders (geometry is unit-agnostic; coords in internal units).
const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbTrack => ({ start, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const via = (at: { x: number; y: number }, size = 200): PcbVia => ({
  at,
  size,
  drill: 100,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 0,
  source: EMPTY,
});
const arcTrack = (
  start: { x: number; y: number },
  mid: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbArcTrack => ({ start, mid, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const pad = (at: { x: number; y: number }, sx: number, sy: number): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at,
  angle: 0,
  size: { x: sx, y: sy },
  layers: ['F.Cu'],
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
const lineShape = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbShape => ({
  kind: 'line',
  start,
  end,
  width,
  fill: false,
  layer: 'Edge.Cuts',
  source: EMPTY,
});
const text = (at: { x: number; y: number }, s: string, size = 1000): PcbTextItem => ({
  kind: 'user',
  text: s,
  at,
  angle: 0,
  layer: 'F.SilkS',
  size: { x: size, y: size },
  source: EMPTY,
});
const zone = (poly: { x: number; y: number }[]): PcbZone => ({
  net: 0,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys: [poly] }],
  source: EMPTY,
});

const board = (over: Partial<Board>): Board => ({
  version: 20241229,
  layers: [],
  nets: new Map(),
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
  const b = board({
    arcs: [arcTrack({ x: 1000, y: 0 }, { x: 707, y: 707 }, { x: 0, y: 1000 }, 100)],
  });
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
    const s: PcbShape = {
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 1000 },
      width: 40,
      fill: false,
      layer: 'Edge.Cuts',
      source: EMPTY,
    };
    const b = board({ shapes: [s] });
    expect(hitTestBoard(b, { x: 0, y: 500 }, 5)).toBe('shape:0'); // on left border
    expect(hitTestBoard(b, { x: 500, y: 500 }, 5)).toBeNull(); // interior
  });
  it('filled circle: interior hits', () => {
    const s: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: 500, y: 0 },
      width: 20,
      fill: true,
      layer: 'F.SilkS',
      source: EMPTY,
    };
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
  const b = board({
    zones: [
      zone([
        { x: 10000, y: 10000 },
        { x: 11000, y: 10000 },
        { x: 11000, y: 11000 },
        { x: 10000, y: 11000 },
      ]),
    ],
  });
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
  it('clicking a pad selects the pad — the larger footprint is rejected (area heuristic)', () => {
    // Two pads make the footprint's hull much larger than one pad, so
    // GuessSelectionCandidates rejects it at the 1.5× area jump and the pad is
    // the sole survivor — no disambiguation, no unchecking "Footprints".
    const fp2 = footprint([
      pad({ x: 5000, y: 5000 }, 400, 400),
      pad({ x: 9000, y: 5000 }, 400, 400),
    ]);
    const b = board({ footprints: [fp2] });
    expect(boardHitCandidates(b, { x: 5000, y: 5100 }, 10)).toEqual(['pad:0:0']);
  });
  it('clicking the trace centerline over a pad prefers the trace (smallest coverage area)', () => {
    // Track coverage area is width² — far below the pad's face — so the pad is
    // rejected ("clicked on a small item within a larger one"). This footprint
    // is 100% covered by its single pad, so the >70% coverage exception keeps
    // it for the disambiguation menu, exactly like GuessSelectionCandidates.
    const b = board({ footprints: [fp], tracks: [t] });
    expect(boardHitCandidates(b, { x: 5000, y: 5000 }, 10)).toEqual(['track:0', 'footprint:0']);
  });
  it('a sloppy track hit loses to an exact pad hit (prefer exact hits)', () => {
    // Click inside the pad but ~50 IU off the trace edge: the pad hit is exact
    // (slop 0) while the track hit is sloppy, so the track is pruned first.
    const fp2 = footprint([
      pad({ x: 5000, y: 5000 }, 400, 400),
      pad({ x: 9000, y: 5000 }, 400, 400),
    ]);
    const b = board({ footprints: [fp2], tracks: [t] });
    const cands = boardHitCandidates(b, { x: 5000, y: 5100 }, 60);
    expect(cands).toEqual(['pad:0:0']);
  });
});

describe('box selection (contained vs crossing)', () => {
  const b = board({
    tracks: [
      track({ x: 0, y: 0 }, { x: 100, y: 0 }, 20), // fully inside 0..1000
      track({ x: 900, y: 0 }, { x: 2000, y: 0 }, 20), // straddles the right edge
    ],
    vias: [via({ x: 5000, y: 5000 }, 100)], // far outside
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

describe('deleteBoardItems', () => {
  it('removes only the selected items', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: 1, y: 0 }), track({ x: 0, y: 5 }, { x: 1, y: 5 })],
      vias: [via({ x: 9, y: 9 })],
    });
    const out = deleteBoardItems(b, new Set(['track:0', 'via:0']));
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0]!.start).toEqual({ x: 0, y: 5 }); // the surviving track
    expect(out.vias).toHaveLength(0);
  });

  it('no-ops for an empty selection', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1, y: 0 })] });
    expect(deleteBoardItems(b, new Set())).toBe(b);
  });

  it('drops the right source child when a MIDDLE item is deleted (writer)', () => {
    // Three named tracks; delete the middle one and confirm the writer emits the
    // other two (positional deletion, not "drop the last").
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "A") (net 2 "B") (net 3 "C")
	(segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 1))
	(segment (start 0 1) (end 1 1) (width 0.2) (layer "F.Cu") (net 2))
	(segment (start 0 2) (end 1 2) (width 0.2) (layer "F.Cu") (net 3))
)
`;
    const b = readBoard(parse(TEXT));
    const out = deleteBoardItems(b, new Set(['track:1'])); // the net-2 track
    const reread = readBoard(parse(serializeBoard(out)));
    expect(reread.tracks.map((t) => t.net)).toEqual([1, 3]);
  });
});

describe('rotateBoardItems', () => {
  it('rotates a track ±90° about an explicit centre', () => {
    // rotatePcb(90): (x,y) -> (y, -x). About origin: (100,0)->(0,-100).
    const b = board({ tracks: [track({ x: 100, y: 0 }, { x: 200, y: 0 }, 20)] });
    const r = rotateBoardItems(b, new Set(['track:0']), true, { x: 0, y: 0 });
    expect(r.tracks[0]!.start).toEqual({ x: 0, y: -100 });
    expect(r.tracks[0]!.end).toEqual({ x: 0, y: -200 });
  });

  it('advances a footprint angle and rotates its children', () => {
    const b = board({ footprints: [footprint([pad({ x: 100, y: 0 }, 400, 400)])] });
    const r = rotateBoardItems(b, new Set(['footprint:0']), true, { x: 0, y: 0 });
    expect(r.footprints[0]!.angle).toBe(90);
    expect(r.footprints[0]!.at).toEqual({ x: 0, y: 0 });
    expect(r.footprints[0]!.pads[0]!.at).toEqual({ x: 0, y: -100 });
  });

  it('four 90° rotations return to the original geometry', () => {
    const b = board({ tracks: [track({ x: 300, y: 100 }, { x: 500, y: 400 }, 20)] });
    let r = b;
    for (let i = 0; i < 4; i++) r = rotateBoardItems(r, new Set(['track:0']), true, { x: 0, y: 0 });
    expect(r.tracks[0]!.start).toEqual({ x: 300, y: 100 });
    expect(r.tracks[0]!.end).toEqual({ x: 500, y: 400 });
  });

  it('patched source survives a serialize round-trip', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const rotated = rotateBoardItems(b, new Set(['track:0']), true, {
      x: mmToIU(20),
      y: mmToIU(10),
    });
    const reread = readBoard(parse(serializeBoard(rotated)));
    // start (10,10) about (20,10): rel (-10,0) -> (0,10) -> (20,20) mm.
    expect(reread.tracks[0]!.start).toEqual({ x: mmToIU(20), y: mmToIU(20) });
    expect(reread.tracks[0]!.net).toBe(1);
  });
});

describe('duplicateBoardItems', () => {
  it('appends offset copies and returns their ids', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })] });
    const { board: out, ids } = duplicateBoardItems(b, new Set(['track:0']), { x: 10, y: 20 });
    expect(out.tracks).toHaveLength(2);
    expect(ids).toEqual(['track:1']);
    expect(out.tracks[0]!.start).toEqual({ x: 0, y: 0 }); // original untouched
    expect(out.tracks[1]!.start).toEqual({ x: 10, y: 20 }); // copy offset
  });

  it('gives the copy a fresh uuid', () => {
    const t = track({ x: 0, y: 0 }, { x: 1, y: 0 });
    t.uuid = 'aaaa';
    const b = board({ tracks: [t] });
    const { board: out } = duplicateBoardItems(b, new Set(['track:0']), { x: 5, y: 0 });
    expect(out.tracks[1]!.uuid).toBeDefined();
    expect(out.tracks[1]!.uuid).not.toBe('aaaa');
  });

  it('the appended copy serializes (writer append pass) and re-reads', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const { board: out } = duplicateBoardItems(b, new Set(['track:0']), {
      x: mmToIU(0),
      y: mmToIU(5),
    });
    const reread = readBoard(parse(serializeBoard(out)));
    expect(reread.tracks).toHaveLength(2);
    expect(reread.tracks[1]!.start).toEqual({ x: mmToIU(10), y: mmToIU(15) });
    expect(reread.tracks[1]!.net).toBe(1);
  });
});

describe('canonical builders (source-less items append + re-read)', () => {
  it('serializes a board with freshly-built (source-less) items', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user))
	(net 0 "") (net 1 "GND")
)
`;
    const b = readBoard(parse(TEXT));
    // Push items with EMPTY source — the writer must build them canonically.
    const withNew: Board = {
      ...b,
      tracks: [
        track({ x: mmToIU(0), y: mmToIU(0) }, { x: mmToIU(10), y: mmToIU(0) }, mmToIU(0.25)),
      ],
      vias: [via({ x: mmToIU(10), y: mmToIU(0) }, mmToIU(0.8))],
      shapes: [
        lineShape({ x: mmToIU(0), y: mmToIU(0) }, { x: mmToIU(20), y: mmToIU(0) }, mmToIU(0.15)),
      ],
      texts: [text({ x: mmToIU(5), y: mmToIU(5) }, 'HI', mmToIU(1))],
    };
    const reread = readBoard(parse(serializeBoard(withNew)));
    expect(reread.tracks).toHaveLength(1);
    expect(reread.tracks[0]!.start.x).toBe(mmToIU(0));
    expect(reread.vias).toHaveLength(1);
    expect(reread.vias[0]!.at.x).toBe(mmToIU(10));
    expect(reread.shapes).toHaveLength(1);
    expect(reread.texts).toHaveLength(1);
    expect(reread.texts[0]!.text).toBe('HI');
  });
});
