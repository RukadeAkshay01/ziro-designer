import { describe, it, expect } from 'vitest';
import { parse, serialize } from '../src/sexpr/index.js';
import { readSchematic } from '../src/model/read-schematic.js';
import { makeBus, makeLabel } from '../src/edit/build.js';
import { addItems } from '../src/edit/mutate.js';
import { mmToIU } from '../src/units.js';

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
    const back = readSchematic(parse(`(kicad_sch (version 1) (lib_symbols) ${serialize(doc.labels[0]!.source)})`));
    expect(back.labels).toHaveLength(1);
    expect(back.labels[0]!.kind).toBe('label');
    expect(back.labels[0]!.text).toBe('D0');
    expect(back.labels[0]!.at).toEqual(at(12, 8));
  });

  it('carries the flag shape on global/hierarchical labels through read', () => {
    const g = makeLabel('global_label', 'VCC', at(0, 0));
    expect(g.shape).toBe('bidirectional');
    const back = readSchematic(parse(`(kicad_sch (version 1) (lib_symbols) ${serialize(g.source)})`));
    expect(back.labels[0]!.kind).toBe('global_label');
    expect(back.labels[0]!.shape).toBe('bidirectional');
  });
});
