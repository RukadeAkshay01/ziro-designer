/**
 * Schematic groups (SCH_GROUP + SCH_GROUP_TOOL): the `(group …)` grammar
 * round-trips per upstream (sorted members, empty groups unwritten), Group
 * moves members out of prior groups, Ungroup dissolves touched groups,
 * selection promotes to whole groups (nested transitively), and deleting a
 * member prunes it from its group.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic, withCleanup, deleteByIds } from '@ziroeda/eeschema';
import {
  groupItemsCommand,
  ungroupItemsCommand,
  addToGroupCommand,
  removeFromGroupCommand,
  canAddToGroup,
  canRemoveFromGroup,
  expandSelectionToGroups,
} from '@ziroeda/eeschema/src/tools/sch_group_tool.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const sym = (ref: string, uuid: string): string =>
  `(symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "1k" (at 0 0 0)))`;

const load = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

describe('schematic groups', () => {
  it('parses and re-serializes the upstream grammar (sorted members)', () => {
    const doc = load(`${sym('R1', 'u-b')} ${sym('R2', 'u-a')}
      (group "Power" (uuid "g-1") (members "u-b" "u-a"))`);
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0]!.name).toBe('Power');
    expect(doc.groups[0]!.members).toEqual(['u-b', 'u-a']);
    const text = serializeSchematic(doc);
    expect(text).toContain('(group "Power"');
    expect(text).toContain('(uuid "g-1")');
    // Members serialize sorted, as SCH_IO_KICAD_SEXPR::saveGroup does.
    const members = text.slice(text.indexOf('(members'));
    expect(members.indexOf('"u-a"')).toBeLessThan(members.indexOf('"u-b"'));
  });

  it('never writes an empty group', () => {
    const doc = load(`${sym('R1', 'u-1')} (group "Empty" (uuid "g-0") (members))`);
    expect(serializeSchematic(doc)).not.toContain('(group');
  });

  it('groups ≥2 items, moving members out of an existing group', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')} ${sym('R3', 'u-3')}
      (group "Old" (uuid "g-old") (members "u-1" "u-3"))`);
    const after = groupItemsCommand(new Set(['u-1', 'u-2'])).apply(doc);
    expect(after.groups).toHaveLength(2);
    expect(after.groups.find((g) => g.name === 'Old')!.members).toEqual(['u-3']);
    const fresh = after.groups.find((g) => g.name !== 'Old')!;
    expect([...fresh.members].sort()).toEqual(['u-1', 'u-2']);
    // Fewer than two groupable items is a no-op (canGroupItem gate).
    expect(groupItemsCommand(new Set(['u-1'])).apply(doc)).toBe(doc);
  });

  it('ungroups every group touched by the selection, keeping members', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')}
      (group "G" (uuid "g-1") (members "u-1" "u-2"))`);
    const after = ungroupItemsCommand(new Set(['u-1'])).apply(doc);
    expect(after.groups).toHaveLength(0);
    expect(after.symbols).toHaveLength(2); // members stay
  });

  it('promotes selection to whole groups, nested transitively', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')} ${sym('R3', 'u-3')}
      (group "Inner" (uuid "g-in") (members "u-1" "u-2"))
      (group "Outer" (uuid "g-out") (members "g-in" "u-3"))`);
    const sel = expandSelectionToGroups(doc, new Set(['u-1']));
    // Touching u-1 selects Inner, which as a member of Outer selects Outer and
    // every member — both group uuids and all three symbols.
    expect([...sel].sort()).toEqual(['g-in', 'g-out', 'u-1', 'u-2', 'u-3']);
  });

  it('prunes deleted members via cleanup; group edits undo in one step', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')}
      (group "G" (uuid "g-1") (members "u-1" "u-2"))`);
    const h = new History();
    const afterDelete = h.execute(doc, withCleanup(deleteByIds(new Set(['u-1']))));
    expect(afterDelete.groups[0]!.members).toEqual(['u-2']);

    const afterUngroup = h.execute(afterDelete, ungroupItemsCommand(new Set(['u-2'])));
    expect(afterUngroup.groups).toHaveLength(0);
    expect(h.undo(afterUngroup)!.groups[0]!.members).toEqual(['u-2']);
  });

  it('adds an ungrouped item to the single selected group', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')} ${sym('R3', 'u-3')}
      (group "G" (uuid "g-1") (members "u-1" "u-2"))`);
    // Whole-group selection (g-1 + members) plus the ungrouped u-3.
    const sel = new Set(['g-1', 'u-1', 'u-2', 'u-3']);
    expect(canAddToGroup(doc, sel)).toBe(true);
    const after = addToGroupCommand(sel).apply(doc);
    expect([...after.groups[0]!.members].sort()).toEqual(['u-1', 'u-2', 'u-3']);
    // With no ungrouped item selected it is disabled and a no-op.
    const selNoItem = new Set(['g-1', 'u-1', 'u-2']);
    expect(canAddToGroup(doc, selNoItem)).toBe(false);
    expect(addToGroupCommand(selNoItem).apply(doc)).toBe(doc);
  });

  it('removes members, dissolving a group left with fewer than two', () => {
    const doc = load(`${sym('R1', 'u-1')} ${sym('R2', 'u-2')} ${sym('R3', 'u-3')}
      (group "G" (uuid "g-1") (members "u-1" "u-2" "u-3"))`);
    expect(canRemoveFromGroup(doc, new Set(['u-3']))).toBe(true);
    const r1 = removeFromGroupCommand(new Set(['u-3'])).apply(doc);
    expect([...r1.groups[0]!.members].sort()).toEqual(['u-1', 'u-2']);
    // Down to one member -> the group dissolves; symbols remain.
    const r2 = removeFromGroupCommand(new Set(['u-2'])).apply(r1);
    expect(r2.groups).toHaveLength(0);
    expect(r2.symbols).toHaveLength(3);
    // Nothing selected from any group -> disabled, no-op.
    expect(canRemoveFromGroup(doc, new Set(['x']))).toBe(false);
    expect(removeFromGroupCommand(new Set(['x'])).apply(doc)).toBe(doc);
  });
});
