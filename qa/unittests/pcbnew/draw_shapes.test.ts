import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  addBoardShape,
  addBoardTrack,
  addBoardVia,
  addBoardText,
  addBoardZone,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MIN_BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
)`;

const mk = (): Board => readBoard(parse(MIN_BOARD));

describe('addBoardShape (DRAWING_TOOL commits)', () => {
  it('adds a line and round-trips it through the writer', () => {
    const { board, id } = addBoardShape(mk(), {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: mmToIU(10), y: 0 },
      width: mmToIU(0.05),
      fill: false,
      layer: 'Edge.Cuts',
    });
    expect(id).toBe('shape:0');
    const text = serializeBoard(board);
    expect(text).toContain('gr_line');
    const back = readBoard(parse(text));
    expect(back.shapes).toHaveLength(1);
    expect(back.shapes[0]!.kind).toBe('line');
    expect(back.shapes[0]!.layer).toBe('Edge.Cuts');
    expect(back.shapes[0]!.end!.x).toBe(mmToIU(10));
    expect(back.shapes[0]!.width).toBe(mmToIU(0.05));
  });

  it('round-trips rect, circle, arc and polygon', () => {
    let b = mk();
    b = addBoardShape(b, {
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: mmToIU(5), y: mmToIU(4) },
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
    }).board;
    b = addBoardShape(b, {
      kind: 'circle',
      center: { x: mmToIU(2), y: mmToIU(2) },
      end: { x: mmToIU(4), y: mmToIU(2) },
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
    }).board;
    b = addBoardShape(b, {
      kind: 'arc',
      start: { x: 0, y: 0 },
      mid: { x: mmToIU(1), y: mmToIU(1) },
      end: { x: mmToIU(2), y: 0 },
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
    }).board;
    b = addBoardShape(b, {
      kind: 'poly',
      pts: [
        { x: 0, y: 0 },
        { x: mmToIU(3), y: 0 },
        { x: mmToIU(3), y: mmToIU(3) },
      ],
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
    }).board;

    const back = readBoard(parse(serializeBoard(b)));
    expect(back.shapes.map((s) => s.kind)).toEqual(['rect', 'circle', 'arc', 'poly']);
    expect(back.shapes[1]!.center).toEqual({ x: mmToIU(2), y: mmToIU(2) });
    expect(back.shapes[2]!.mid).toEqual({ x: mmToIU(1), y: mmToIU(1) });
    expect(back.shapes[3]!.pts).toHaveLength(3);
  });

  it('round-trips routed tracks, vias and placed text (ROUTER_TOOL / PlaceText)', () => {
    let b = mk();
    b = addBoardTrack(b, {
      start: { x: 0, y: 0 },
      end: { x: mmToIU(5), y: 0 },
      width: mmToIU(0.2),
      layer: 'F.Cu',
      net: 0,
    }).board;
    b = addBoardVia(b, {
      at: { x: mmToIU(5), y: 0 },
      size: mmToIU(0.6),
      drill: mmToIU(0.3),
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: 0,
    }).board;
    b = addBoardText(b, {
      kind: 'user',
      text: 'REV A',
      at: { x: mmToIU(1), y: mmToIU(1) },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: mmToIU(1), y: mmToIU(1) },
      thickness: mmToIU(0.1),
    }).board;

    const back = readBoard(parse(serializeBoard(b)));
    expect(back.tracks).toHaveLength(1);
    expect(back.tracks[0]!.width).toBe(mmToIU(0.2));
    expect(back.vias).toHaveLength(1);
    expect(back.vias[0]!.size).toBe(mmToIU(0.6));
    expect(back.texts).toHaveLength(1);
    expect(back.texts[0]!.text).toBe('REV A');
    expect(back.texts[0]!.layer).toBe('F.SilkS');
  });

  it('round-trips a freshly-drawn (unfilled) zone', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: mmToIU(10), y: 0 },
      { x: mmToIU(10), y: mmToIU(10) },
      { x: 0, y: mmToIU(10) },
    ];
    const { board } = addBoardZone(mk(), {
      net: 0,
      netName: '',
      layers: ['F.Cu'],
      outline,
      hatchStyle: 'edge',
      hatchPitch: mmToIU(0.5),
    });
    const text = serializeBoard(board);
    expect(text).toContain('(zone');
    const back = readBoard(parse(text));
    expect(back.zones).toHaveLength(1);
    expect(back.zones[0]!.layers).toEqual(['F.Cu']);
    expect(back.zones[0]!.outline).toHaveLength(4);
    expect(back.zones[0]!.outline![1]).toEqual({ x: mmToIU(10), y: 0 });
    expect(back.zones[0]!.hatchStyle).toBe('edge');
    expect(back.zones[0]!.fills).toHaveLength(0);
  });
});
