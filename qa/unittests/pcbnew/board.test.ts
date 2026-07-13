import { describe, it, expect } from 'vitest';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_TRACK, PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/src/pcb_track.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/src/pcb_shape.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/src/footprint.js';
import { ZONE } from '@ziroeda/pcbnew/src/zone.js';

describe('BOARD', () => {
  it('Add files items into the right collection by class', () => {
    const b = new BOARD();
    b.Add(new PCB_TRACK({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 'F.Cu', 1));
    b.Add(new PCB_VIA({ x: 50, y: 0 }, 200, 100, 'F.Cu', 'B.Cu', VIATYPE.THROUGH, 1));
    b.Add(new FOOTPRINT({ fpid: 'R:0603' }));
    b.Add(new ZONE({ outline: [], layers: ['F.Cu'] }));
    b.Add(
      new PCB_SHAPE(SHAPE_T.SEGMENT, 'Edge.Cuts', { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
    );

    expect(b.Tracks()).toHaveLength(2); // track + via both live in m_tracks
    expect(b.Footprints()).toHaveLength(1);
    expect(b.Zones()).toHaveLength(1);
    expect(b.Drawings()).toHaveLength(1);
    expect(b.AllItems()).toHaveLength(5);
  });

  it('Remove drops the item', () => {
    const b = new BOARD();
    const t = new PCB_TRACK({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 'F.Cu', 1);
    b.Add(t);
    b.Remove(t);
    expect(b.Tracks()).toHaveLength(0);
  });

  it('net map + FlipLayer', () => {
    const b = new BOARD();
    b.SetNet(1, 'GND');
    expect(b.GetNetname(1)).toBe('GND');
    expect(b.FlipLayer('F.Cu')).toBe('B.Cu');
  });
});
