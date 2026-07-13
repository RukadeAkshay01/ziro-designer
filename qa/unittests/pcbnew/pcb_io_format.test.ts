import { describe, it, expect } from 'vitest';
import { formatBoard } from '@ziroeda/pcbnew/src/pcb_io/sexpr/pcb_io_sexpr.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_TRACK, PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/src/pcb_track.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/src/pcb_shape.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/src/footprint.js';
import { PAD, PAD_SHAPE, PAD_ATTRIB } from '@ziroeda/pcbnew/src/pad.js';
import { PCB_FIELD, MANDATORY_FIELD_T } from '@ziroeda/pcbnew/src/pcb_field.js';
// Cross-check the formatter output with the (proven) existing reader.
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

function sampleBoard(): BOARD {
  const b = new BOARD();
  b.SetLayers([
    { id: 0, name: 'F.Cu', type: 'signal' },
    { id: 2, name: 'B.Cu', type: 'signal' },
    { id: 25, name: 'Edge.Cuts', type: 'user' },
    { id: 5, name: 'F.SilkS', type: 'user', userName: 'F.Silkscreen' },
  ]);
  b.SetNet(0, '');
  b.SetNet(1, 'GND');
  b.Add(
    new PCB_TRACK(
      { x: mmToIU(10), y: mmToIU(10) },
      { x: mmToIU(30), y: mmToIU(10) },
      mmToIU(0.25),
      'F.Cu',
      1,
    ),
  );
  b.Add(
    new PCB_VIA(
      { x: mmToIU(40), y: mmToIU(10) },
      mmToIU(0.8),
      mmToIU(0.4),
      'F.Cu',
      'B.Cu',
      VIATYPE.THROUGH,
      1,
    ),
  );
  b.Add(
    new PCB_SHAPE(SHAPE_T.SEGMENT, 'Edge.Cuts', {
      start: { x: 0, y: 0 },
      end: { x: mmToIU(50), y: 0 },
      width: mmToIU(0.15),
    }),
  );
  const pad = new PAD({
    number: '1',
    pos: { x: mmToIU(10), y: mmToIU(10) },
    size: { x: mmToIU(0.9), y: mmToIU(0.95) },
    shape: PAD_SHAPE.RECTANGLE,
    attribute: PAD_ATTRIB.SMD,
    layers: ['F.Cu'],
  });
  const ref = new PCB_FIELD('F.SilkS', MANDATORY_FIELD_T.REFERENCE, 'Reference', {
    text: 'R1',
    pos: { x: mmToIU(10), y: mmToIU(9) },
    size: { x: mmToIU(1), y: mmToIU(1) },
  });
  b.Add(
    new FOOTPRINT({
      fpid: 'R_0603',
      pos: { x: mmToIU(10), y: mmToIU(10) },
      layer: 'F.Cu',
      pads: [pad],
      fields: [ref],
    }),
  );
  return b;
}

describe('PCB_IO_KICAD_SEXPR formatter', () => {
  it('emits valid .kicad_pcb that the reader parses back', () => {
    const text = formatBoard(sampleBoard());
    const rb = readBoard(parse(text));
    expect(rb.tracks).toHaveLength(1);
    expect(rb.vias).toHaveLength(1);
    expect(rb.shapes).toHaveLength(1);
    expect(rb.footprints).toHaveLength(1);
    expect([...rb.nets.entries()]).toContainEqual([1, 'GND']);
  });

  it('preserves track/via geometry and net through the format', () => {
    const rb = readBoard(parse(formatBoard(sampleBoard())));
    expect(rb.tracks[0]!.start.x).toBe(mmToIU(10));
    expect(rb.tracks[0]!.end.x).toBe(mmToIU(30));
    expect(rb.tracks[0]!.net).toBe(1);
    expect(rb.vias[0]!.at.x).toBe(mmToIU(40));
    expect(rb.vias[0]!.size).toBe(mmToIU(0.8));
  });

  it('places the footprint pad at the right board coordinate', () => {
    const rb = readBoard(parse(formatBoard(sampleBoard())));
    const fp = rb.footprints[0]!;
    expect(fp.reference).toBe('R1');
    expect(fp.pads[0]!.at).toEqual({ x: mmToIU(10), y: mmToIU(10) });
  });
});
