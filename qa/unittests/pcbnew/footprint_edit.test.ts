import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  serializeBoard,
  setFootprintField,
  setFootprintLocked,
  setFootprintOrientation,
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

describe('footprint property edits', () => {
  it('setFootprintField updates Value in model, text items, and serialized output', () => {
    const board = load();
    const next = setFootprintField(board, 0, 'value', 'CHANGED');
    expect(next.footprints[0]!.value).toBe('CHANGED');
    // Any value text item for the footprint carries the new text.
    const vtexts = next.footprints[0]!.texts.filter((t) => t.kind === 'value');
    expect(vtexts.length).toBeGreaterThan(0);
    for (const t of vtexts) expect(t.text).toBe('CHANGED');
    expect(serializeBoard(next)).toContain('"CHANGED"');
    // Original board is untouched (immutability).
    expect(board.footprints[0]!.value).not.toBe('CHANGED');
  });

  it('setFootprintLocked toggles (locked yes) in the model and source', () => {
    const board = load();
    const locked = setFootprintLocked(board, 0, true);
    expect(locked.footprints[0]!.locked).toBe(true);
    expect(serializeBoard(locked)).toContain('(locked yes)');
    const unlocked = setFootprintLocked(locked, 0, false);
    expect(unlocked.footprints[0]!.locked).toBe(false);
    expect(serializeBoard(unlocked)).not.toContain('(locked yes)');
  });

  it('setFootprintOrientation rotates the footprint about its anchor', () => {
    const board = load();
    const fp = board.footprints[0]!;
    const anchor = { ...fp.at };
    const pad0 = fp.pads[0]!;
    const next = setFootprintOrientation(board, 0, fp.angle + 90);
    const nfp = next.footprints[0]!;
    // Anchor stays put; angle advanced by 90 (mod 360).
    expect(nfp.at.x).toBe(anchor.x);
    expect(nfp.at.y).toBe(anchor.y);
    expect((((nfp.angle - (fp.angle + 90)) % 360) + 360) % 360).toBe(0);
    // A pad off the anchor actually moved (rotated), unless it sat on the anchor.
    if (Math.hypot(pad0.at.x - anchor.x, pad0.at.y - anchor.y) > 1) {
      const np0 = nfp.pads[0]!;
      expect(np0.at.x !== pad0.at.x || np0.at.y !== pad0.at.y).toBe(true);
    }
  });
});
