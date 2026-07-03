import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '../src/sexpr/index.js';
import { readBoard, rotatePcb, arcCenter } from '../src/pcb/read-board.js';
import { mmToIU } from '../src/units.js';

const STICKHUB = '/home/user/pcb/kicad-src/demos/stickhub/StickHub.kicad_pcb';

describe.skipIf(!existsSync(STICKHUB))('readBoard (real KiCad demo board)', () => {
  const board = readBoard(parse(readFileSync(STICKHUB, 'utf8')));

  it('reads the layer table, nets and main item arrays', () => {
    expect(board.layers.length).toBeGreaterThan(5);
    expect(board.layers.some((l) => l.name === 'F.Cu')).toBe(true);
    expect(board.nets.get(0)).toBe('');
    expect(board.footprints.length).toBeGreaterThan(0);
    expect(board.tracks.length).toBeGreaterThan(0);
  });

  it('applies the footprint transform to pads (legacy RebakeFromLib path)', () => {
    // Every SMD pad with a net should have geometry in board space: at least
    // one pad must coincide with a track endpoint (they connect there).
    const ends = board.tracks.flatMap((t) => [t.start, t.end]);
    let matched = 0;
    let checked = 0;
    for (const fp of board.footprints) {
      for (const p of fp.pads) {
        if (p.net === undefined) continue;
        checked++;
        const tol = Math.max(p.size.x, p.size.y) / 2 + mmToIU(0.01);
        if (ends.some((e) => Math.abs(e.x - p.at.x) <= tol && Math.abs(e.y - p.at.y) <= tol)) matched++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(matched / checked).toBeGreaterThan(0.5);
  });
});

describe('rotatePcb', () => {
  it('matches KiCad RotatePoint (trigo.cpp): +90° maps (x,y) -> (y,-x)', () => {
    expect(rotatePcb({ x: 100, y: 0 }, 90)).toEqual({ x: 0, y: -100 });
    expect(rotatePcb({ x: 100, y: 0 }, 180)).toEqual({ x: -100, y: 0 });
    expect(rotatePcb({ x: 100, y: 0 }, 270)).toEqual({ x: 0, y: 100 });
  });
});

describe('arcCenter', () => {
  it('finds the circumcentre of a right-angle arc', () => {
    const c = arcCenter({ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 });
    expect(Math.abs(c!.x)).toBeLessThan(1e-6);
    expect(Math.abs(c!.y)).toBeLessThan(1e-6);
  });
  it('returns null for collinear points', () => {
    expect(arcCenter({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('readBoard (synthetic)', () => {
  // A 90°-rotated footprint: pad at local (1, 0) must land at fp + (0, -1)
  // (KiCad RotatePoint +90°: (x,y) -> (y,-x)), and the file pad angle is
  // board-absolute so it stays 90 regardless of the footprint rotation.
  const src = `(kicad_pcb (version 20241229) (generator "pcbnew")
    (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
    (net 0 "") (net 1 "GND")
    (footprint "T:FP" (layer "F.Cu") (at 100 50 90)
      (pad "1" smd rect (at 1 0 90) (size 1 0.5) (layers "F.Cu") (net 1 "GND"))
      (pad "2" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu"))
      (fp_line (start 0 0) (end 2 0) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
    )
    (segment (start 100 49) (end 110 49) (width 0.25) (layer "F.Cu") (net 1))
    (via (at 105 49) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
    (zone (net 1) (net_name "GND") (layers "B.Cu")
      (filled_polygon (layer "B.Cu") (pts (xy 90 40) (xy 120 40) (xy 120 60) (xy 90 60)))))`;
  const board = readBoard(parse(src));

  it('rotates footprint children into board coordinates', () => {
    const fp = board.footprints[0]!;
    const pad1 = fp.pads.find((p) => p.number === '1')!;
    expect(pad1.at).toEqual({ x: mmToIU(100), y: mmToIU(49) });
    expect(pad1.angle).toBe(90); // board-absolute, straight from the file
    // fp_line end (2,0) -> (100, 48)
    const line = fp.shapes[0]!;
    expect(line.end).toEqual({ x: mmToIU(100), y: mmToIU(48) });
    // The rotated pad now coincides with the track start.
    expect(board.tracks[0]!.start).toEqual(pad1.at);
  });

  it('reads via, zone fill and through-pad drill', () => {
    expect(board.vias[0]!.size).toBe(mmToIU(0.6));
    expect(board.vias[0]!.kind).toBe('through');
    expect(board.zones[0]!.fills[0]!.layer).toBe('B.Cu');
    expect(board.zones[0]!.fills[0]!.polys[0]!.length).toBe(4);
    const pad2 = board.footprints[0]!.pads.find((p) => p.number === '2')!;
    expect(pad2.drill).toEqual({ oblong: false, w: mmToIU(0.8), h: mmToIU(0.8), offset: undefined });
    expect(pad2.layers).toEqual(['*.Cu']);
  });
});
