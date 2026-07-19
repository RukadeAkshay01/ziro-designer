/**
 * Item locking (SCH_EDIT_TOOL Lock / Unlock / Toggle + SCH_ITEM::IsLocked):
 * the `(locked yes)` token round-trips on symbols and the lock command
 * sets/clears/toggles it undoably.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { setSymbolsLockedCommand } from '@ziroeda/eeschema/src/tools/mutate.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const sym = (ref: string, uuid: string, locked = false): string =>
  `(symbol (lib_id "Device:R") (at 10 10 0) (unit 1)${locked ? ' (locked yes)' : ''}
    (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "1k" (at 0 0 0)) (uuid "${uuid}"))`;

const load = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

describe('symbol locking', () => {
  it('reads and writes the (locked yes) token', () => {
    const doc = load(sym('R1', 'u-1', true));
    expect(doc.symbols[0]!.locked).toBe(true);
    expect(serializeSchematic(doc)).toContain('(locked yes)');
  });

  it('lock / unlock / toggle set the flag and are undoable', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2', true)}`);
    const h = new History();

    const locked = h.execute(doc, setSymbolsLockedCommand(new Set(['u-1']), 'lock'));
    expect(locked.symbols[0]!.locked).toBe(true);
    expect(serializeSchematic(locked)).toContain('(locked yes)');

    // Undo restores the prior (unlocked) state exactly.
    const undone = h.undo(locked)!;
    expect(undone.symbols[0]!.locked ?? false).toBe(false);

    // Toggle over a mixed selection: because R2 is locked, upstream unlocks
    // ALL (modifyLockSelected: any locked -> OFF), not a per-item flip.
    const toggled = setSymbolsLockedCommand(new Set(['u-1', 'u-2']), 'toggle').apply(doc);
    expect(toggled.symbols[0]!.locked).toBe(false);
    expect(toggled.symbols[1]!.locked).toBe(false);

    // Toggle when none are locked locks all.
    const bothUnlocked = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')}`);
    const lockedAll = setSymbolsLockedCommand(new Set(['u-1', 'u-2']), 'toggle').apply(
      bothUnlocked,
    );
    expect(lockedAll.symbols.every((s) => s.locked)).toBe(true);

    // Unlock clears it.
    const unlocked = setSymbolsLockedCommand(new Set(['u-2']), 'unlock').apply(doc);
    expect(unlocked.symbols[1]!.locked).toBe(false);
  });
});
