/**
 * Editing a hierarchical sheet's Sheetname / Sheetfile (DIALOG_SHEET_PROPERTIES):
 * replaceSheet with patched fields round-trips losslessly through the writer.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic, sheetName, sheetFile } from '@ziroeda/eeschema';
import { replaceSheet } from '@ziroeda/eeschema/src/tools/mutate.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (sheet (at 100 100) (size 30 20) (uuid "sh-1")
    (property "Sheetname" "amp" (at 100 99 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
    (property "Sheetfile" "amp.kicad_sch" (at 100 121 0) (effects (font (size 1.27 1.27)) (justify left top)))))`;

const load = () => readSchematic(parse(SCH));
const setField = (
  sheet: ReturnType<typeof load>['sheets'][number],
  key: string,
  value: string,
) => ({
  ...sheet,
  fields: sheet.fields.map((f) => (f.key === key ? { ...f, value } : f)),
});

describe('sheet properties edit', () => {
  it('renames Sheetname and round-trips', () => {
    const doc = load();
    const after = replaceSheet(0, setField(doc.sheets[0]!, 'Sheetname', 'power')).apply(doc);
    expect(sheetName(after.sheets[0]!)).toBe('power');
    expect(serializeSchematic(after)).toContain('(property "Sheetname" "power"');
  });

  it('changes Sheetfile and round-trips (basename via sheetFile)', () => {
    const doc = load();
    const after = replaceSheet(
      0,
      setField(doc.sheets[0]!, 'Sheetfile', 'sub/power.kicad_sch'),
    ).apply(doc);
    expect(sheetFile(after.sheets[0]!)).toBe('power.kicad_sch'); // helper returns basename
    expect(serializeSchematic(after)).toContain('(property "Sheetfile" "sub/power.kicad_sch"');
  });

  it('is undoable', () => {
    const doc = load();
    const h = new History();
    const after = h.execute(doc, replaceSheet(0, setField(doc.sheets[0]!, 'Sheetname', 'X')));
    expect(sheetName(after.sheets[0]!)).toBe('X');
    expect(sheetName(h.undo(after)!.sheets[0]!)).toBe('amp');
  });
});
