import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  boardItemId,
  parseBoardItemId,
  boardHitCandidates,
  moveBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

// A footprint at (100,100) rotated 0°, with a reference "R1" at local (0,-2).
const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user))
  (net 0 "")
  (footprint "R_0805" (layer "F.Cu") (at 100 100)
    (fp_text reference "R1" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "10k" (at 0 2) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu"))
  )
)`;

describe('footprint text as an individually movable item', () => {
  it('ids round-trip with the sub-index', () => {
    expect(parseBoardItemId(boardItemId('fptext', 3, 1))).toEqual({
      kind: 'fptext',
      index: 3,
      sub: 1,
    });
    expect(parseBoardItemId('fptext:2:0')).toEqual({ kind: 'fptext', index: 2, sub: 0 });
    expect(parseBoardItemId('fptext:2')).toBeNull();
  });

  it('hit-tests the reference text as its own fptext item, over the footprint', () => {
    const board = readBoard(parse(BOARD));
    // The reference sits at board (100, 98). A hit there should offer the fptext
    // ahead of the footprint body.
    const ids = boardHitCandidates(board, { x: mmToIU(100), y: mmToIU(98) }, mmToIU(0.3));
    expect(ids[0]).toBe('fptext:0:0');
    expect(ids).toContain('footprint:0');
  });

  it('moves only the reference text, and serializes the new local position', () => {
    const board = readBoard(parse(BOARD));
    const before = board.footprints[0]!;
    const refBefore = { ...before.texts[0]!.at };
    const valBefore = { ...before.texts[1]!.at };
    const fpAtBefore = { ...before.at };

    // Drag the reference 3mm right, 1mm down.
    const moved = moveBoardItems(board, new Set(['fptext:0:0']), { x: mmToIU(3), y: mmToIU(1) });
    const fp = moved.footprints[0]!;
    // Only the reference moved; value and footprint origin unchanged.
    expect(fp.texts[0]!.at).toEqual({ x: refBefore.x + mmToIU(3), y: refBefore.y + mmToIU(1) });
    expect(fp.texts[1]!.at).toEqual(valBefore);
    expect(fp.at).toEqual(fpAtBefore);

    // Reserialize + reparse: the reference's board position persists.
    const back = readBoard(parse(serializeBoard(moved)));
    expect(back.footprints[0]!.texts[0]!.at.x).toBe(refBefore.x + mmToIU(3));
    expect(back.footprints[0]!.texts[0]!.at.y).toBe(refBefore.y + mmToIU(1));
    // The file stores the local at: reference was (0,-2) -> (3,-1).
    expect(serializeBoard(moved)).toContain('(at 3 -1)');
  });

  it('a rotated footprint moves its text in the correct local frame', () => {
    // Footprint rotated 90°; a board-frame +X drag maps to a local -Y shift.
    const ROT = BOARD.replace('(at 100 100)', '(at 100 100 90)');
    const board = readBoard(parse(ROT));
    const moved = moveBoardItems(board, new Set(['fptext:0:0']), { x: mmToIU(3), y: 0 });
    const back = readBoard(parse(serializeBoard(moved)));
    // Board position shifts by +3mm X regardless of rotation.
    const refBoard = back.footprints[0]!.texts[0]!.at;
    expect(refBoard.x).toBeCloseTo(board.footprints[0]!.texts[0]!.at.x + mmToIU(3), 0);
  });
});
