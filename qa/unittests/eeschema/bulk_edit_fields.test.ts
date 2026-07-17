/**
 * Bulk field edit (Symbol Fields Table edit view): bulkEditFieldsCommand sets
 * field values on many symbols in one undoable commit — updating in place,
 * appending missing fields, removing emptied non-mandatory fields — and
 * round-trips through the writer.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic, refId } from '@ziroeda/eeschema';
import { bulkEditFieldsCommand } from '@ziroeda/eeschema/src/tools/properties.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (lib_symbols)
  (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 10 10 0))
    (property "Value" "1k" (at 10 12 0))
    (property "MPN" "OLD-MPN" (at 10 14 0)))
  (symbol (lib_id "Device:R") (at 20 10 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 20 10 0))
    (property "Value" "2k" (at 20 12 0))))`;

const load = () => readSchematic(parse(SCH));
const idOf = (doc: ReturnType<typeof load>, uuid: string) =>
  refId(
    'symbol',
    uuid,
    doc.symbols.findIndex((s) => s.uuid === uuid),
  );
const fieldValue = (doc: ReturnType<typeof load>, uuid: string, key: string) =>
  doc.symbols.find((s) => s.uuid === uuid)?.fields.find((f) => f.key === key)?.value;

describe('bulkEditFieldsCommand', () => {
  it('updates, appends, and removes fields across symbols in one commit', () => {
    const doc = load();
    const after = bulkEditFieldsCommand(
      new Map<string, Record<string, string>>([
        [idOf(doc, 'r1'), { Value: '10k', MPN: '' }], // update + remove custom
        [idOf(doc, 'r2'), { MPN: 'RC0603FR-072KL' }], // append a missing field
      ]),
    ).apply(doc);

    expect(fieldValue(after, 'r1', 'Value')).toBe('10k');
    expect(fieldValue(after, 'r1', 'MPN')).toBeUndefined();
    expect(fieldValue(after, 'r2', 'MPN')).toBe('RC0603FR-072KL');

    const text = serializeSchematic(after);
    expect(text).toContain('(property "Value" "10k"');
    expect(text).toContain('(property "MPN" "RC0603FR-072KL"');
    expect(text).not.toContain('OLD-MPN');
  });

  it('never removes a mandatory field, even when emptied', () => {
    const doc = load();
    const after = bulkEditFieldsCommand(new Map([[idOf(doc, 'r1'), { Value: '' }]])).apply(doc);
    expect(fieldValue(after, 'r1', 'Value')).toBe('');
  });

  it('is undoable in one step', () => {
    const doc = load();
    const h = new History();
    const after = h.execute(
      doc,
      bulkEditFieldsCommand(
        new Map<string, Record<string, string>>([
          [idOf(doc, 'r1'), { Value: '10k' }],
          [idOf(doc, 'r2'), { Value: '20k' }],
        ]),
      ),
    );
    expect(fieldValue(after, 'r1', 'Value')).toBe('10k');
    const back = h.undo(after)!;
    expect(fieldValue(back, 'r1', 'Value')).toBe('1k');
    expect(fieldValue(back, 'r2', 'Value')).toBe('2k');
  });
});
