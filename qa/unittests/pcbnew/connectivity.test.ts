import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  connectedTrackEnds,
  dragBoardItems,
  moveBoardItems,
  boardItemId,
  type Board,
} from '@ziroeda/pcbnew';

const load = (): Board =>
  readBoard(
    parse(
      readFileSync(
        new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
        'utf8',
      ),
    ),
  );

/** Index of the first footprint that has at least one net-connected pad. */
function firstConnectedFootprint(board: Board): number {
  for (let i = 0; i < board.footprints.length; i++) {
    if (board.footprints[i]!.pads.some((p) => (p.net ?? 0) > 0)) return i;
  }
  return -1;
}

describe('board connectivity + drag', () => {
  it('finds track ends attached to a footprint pad (same net, on pad)', () => {
    const board = load();
    const fpIdx = firstConnectedFootprint(board);
    expect(fpIdx).toBeGreaterThanOrEqual(0);
    const ends = connectedTrackEnds(board, new Set([fpIdx]));
    // The demo board is fully routed, so a connected footprint has ≥1 attached end.
    expect(ends.length).toBeGreaterThan(0);
    // Every reported end really lands on one of that footprint's pads, same net.
    const pads = board.footprints[fpIdx]!.pads;
    for (const e of ends) {
      const seg = e.kind === 'track' ? board.tracks[e.index]! : board.arcs[e.index]!;
      const pt = e.end === 'start' ? seg.start : seg.end;
      const hit = pads.some(
        (p) =>
          (p.net ?? -1) === seg.net &&
          Math.hypot(pt.x - p.at.x, pt.y - p.at.y) <= Math.max(p.size.x, p.size.y) / 2,
      );
      expect(hit).toBe(true);
    }
  });

  it('drag stretches attached track ends; move leaves them behind', () => {
    const board = load();
    const fpIdx = firstConnectedFootprint(board);
    const ends = connectedTrackEnds(board, new Set([fpIdx]));
    const first = ends[0]!;
    const seg0 = first.kind === 'track' ? board.tracks[first.index]! : board.arcs[first.index]!;
    const before = first.end === 'start' ? seg0.start : seg0.end;

    const delta = { x: 5000, y: -3000 };
    const id = boardItemId('footprint', fpIdx);

    const dragged = dragBoardItems(board, new Set([id]), delta);
    const dSeg = first.kind === 'track' ? dragged.tracks[first.index]! : dragged.arcs[first.index]!;
    const dPt = first.end === 'start' ? dSeg.start : dSeg.end;
    expect(dPt.x).toBe(before.x + delta.x);
    expect(dPt.y).toBe(before.y + delta.y);

    const movedOnly = moveBoardItems(board, new Set([id]), delta);
    const mSeg =
      first.kind === 'track' ? movedOnly.tracks[first.index]! : movedOnly.arcs[first.index]!;
    const mPt = first.end === 'start' ? mSeg.start : mSeg.end;
    expect(mPt.x).toBe(before.x); // move does not drag the track
    expect(mPt.y).toBe(before.y);
  });
});
