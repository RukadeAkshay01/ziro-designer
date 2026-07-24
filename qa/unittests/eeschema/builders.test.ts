import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import { makeBus, makeLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { subReference } from '@ziroeda/eeschema/src/fieldbox.js';
import { makeTextBox, makeTable } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const EMPTY = () => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

describe('makeBus', () => {
  it('builds a bus line that serializes as a (bus ...) node', () => {
    const bus = makeBus(at(10, 10), at(30, 10));
    expect(bus.kind).toBe('bus');
    const doc = addItems({ lines: [bus] }).apply(EMPTY());
    const text = serialize({ kind: 'list', items: doc.lines.map((l) => l.source) });
    expect(text).toContain('(bus');
    expect(text).toContain('(xy 10 10)');
    expect(text).toContain('(xy 30 10)');
  });
});

describe('makeLabel', () => {
  it('builds local, global and hierarchical labels with the right head and shape', () => {
    const local = makeLabel('label', 'NET1', at(5, 5));
    const global = makeLabel('global_label', 'VCC', at(5, 5));
    const hier = makeLabel('hierarchical_label', 'CLK', at(5, 5));

    expect(local.kind).toBe('label');
    expect(local.text).toBe('NET1');
    expect(serialize(local.source)).toContain('(label "NET1"');

    const g = serialize(global.source);
    expect(g).toContain('(global_label "VCC"');
    expect(g).toContain('(shape bidirectional)');

    expect(serialize(hier.source)).toContain('(hierarchical_label "CLK"');
  });

  it('re-reads a serialized label back to the same kind/text/position', () => {
    const doc = addItems({ labels: [makeLabel('label', 'D0', at(12, 8))] }).apply(EMPTY());
    // Re-read the label's own node to confirm the writer/reader agree on it.
    const back = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols) ${serialize(doc.labels[0]!.source)})`),
    );
    expect(back.labels).toHaveLength(1);
    expect(back.labels[0]!.kind).toBe('label');
    expect(back.labels[0]!.text).toBe('D0');
    expect(back.labels[0]!.at).toEqual(at(12, 8));
  });

  it('carries the flag shape on global/hierarchical labels through read', () => {
    const g = makeLabel('global_label', 'VCC', at(0, 0));
    expect(g.shape).toBe('bidirectional');
    const back = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols) ${serialize(g.source)})`),
    );
    expect(back.labels[0]!.kind).toBe('global_label');
    expect(back.labels[0]!.shape).toBe('bidirectional');
  });
});

describe('makeTextBox', () => {
  it('builds a (text_box ...) node with at/size/margins/effects', () => {
    const tb = makeTextBox(at(10, 20), at(50, 40), 'Hello world');
    const s = serialize(tb.source);
    expect(s).toContain('(text_box "Hello world"');
    expect(s).toContain('(at 10 20 0)');
    expect(s).toContain('(size 40 20)'); // end - start
    expect(s).toContain('(margins');
    expect(s).toContain('(justify left top)');
  });

  it('round-trips through read/write, preserving text and corners', () => {
    const tb = makeTextBox(at(10, 20), at(50, 40), 'Note A');
    const doc = addItems({ textBoxes: [tb] }).apply(EMPTY());
    expect(doc.textBoxes).toHaveLength(1);
    const text = serialize(writeSchematic(doc));
    const back = readSchematic(parse(text));
    expect(back.textBoxes).toHaveLength(1);
    expect(back.textBoxes[0]!.text).toBe('Note A');
    expect(back.textBoxes[0]!.start).toEqual(at(10, 20));
    expect(back.textBoxes[0]!.end).toEqual(at(50, 40));
  });

  it('adds and deletes undoably (addItems inverse)', () => {
    const tb = makeTextBox(at(0, 0), at(20, 10), 'X');
    const cmd = addItems({ textBoxes: [tb] });
    const doc = cmd.apply(EMPTY());
    expect(doc.textBoxes).toHaveLength(1);
    const undone = cmd.invert(EMPTY()).apply(doc);
    expect(undone.textBoxes).toHaveLength(0);
  });
});

describe('makeTable', () => {
  it('builds a (table ...) node with column_count, widths, heights and cells', () => {
    const t = makeTable(at(10, 10), 2, 3, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(t.columnCount).toBe(3);
    expect(t.cells).toHaveLength(6);
    const s = serialize(t.source);
    expect(s).toContain('(table');
    expect(s).toContain('(column_count 3)');
    expect(s).toContain('(cells');
    expect(s).toContain('(table_cell "a"');
    expect(s).toContain('(span 1 1)');
  });

  it('round-trips through read/write with cell text and grid intact', () => {
    const t = makeTable(at(10, 10), 2, 2, ['R0C0', 'R0C1', 'R1C0', 'R1C1']);
    const doc = addItems({ tables: [t] }).apply(EMPTY());
    const back = readSchematic(parse(serialize(writeSchematic(doc))));
    expect(back.tables).toHaveLength(1);
    const bt = back.tables[0]!;
    expect(bt.columnCount).toBe(2);
    expect(bt.cells.map((c) => c.text)).toEqual(['R0C0', 'R0C1', 'R1C0', 'R1C1']);
    expect(bt.borderExternal).toBe(true);
    expect(bt.separatorRows).toBe(true);
  });

  it('adds and deletes undoably', () => {
    const cmd = addItems({ tables: [makeTable(at(0, 0), 2, 2)] });
    const doc = cmd.apply(EMPTY());
    expect(doc.tables).toHaveLength(1);
    expect(cmd.invert(EMPTY()).apply(doc).tables).toHaveLength(0);
  });
});

// SCHEMATIC_SETTINGS::SubReference: the unit-notation formatter.
describe('subReference', () => {
  it('formats letters and numbers with the chosen separator', () => {
    expect(subReference(2)).toBe('B'); // default: no separator, 'A' letters
    expect(subReference(2, { separator: 46, firstId: 65 })).toBe('.B'); // .A
    expect(subReference(2, { separator: 45, firstId: 49 })).toBe('-2'); // -1
    expect(subReference(3, { separator: 95, firstId: 49 })).toBe('_3'); // _1
    expect(subReference(27, { separator: 0, firstId: 65 })).toBe('AA'); // 27th unit
  });

  it('returns empty for unit < 1 and honours addSeparator=false', () => {
    expect(subReference(0)).toBe('');
    expect(subReference(2, { separator: 46, firstId: 65 }, false)).toBe('B');
  });
});
