/**
 * Editing wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES) and junction diameter
 * (DIALOG_JUNCTION_PROPS): replaceLine / replaceJunction with the lossless
 * writer patches for `(stroke …)` and `(diameter …)`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceLine, replaceJunction } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (wire (pts (xy 50 50) (xy 80 50)) (stroke (width 0) (type default)) (uuid "w-1"))
  (junction (at 80 50) (diameter 0) (uuid "j-1"))
)`;
const load = () => readSchematic(parse(SCH));

describe('wire stroke edit', () => {
  it('sets width and style and round-trips', () => {
    const doc = load();
    const orig = doc.lines[0]!;
    const after = replaceLine(0, {
      ...orig,
      stroke: { width: mmToIU(0.25), type: 'dash' },
    }).apply(doc);
    expect(iuToMM(after.lines[0]!.stroke!.width)).toBeCloseTo(0.25);
    expect(after.lines[0]!.stroke!.type).toBe('dash');
    const text = serializeSchematic(after);
    expect(text).toContain('(width 0.25)');
    expect(text).toContain('(type dash)');
  });

  it('is undoable', () => {
    const doc = load();
    const cmd = replaceLine(0, { ...doc.lines[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } });
    const after = cmd.apply(doc);
    const undone = cmd.invert(doc).apply(after);
    expect(undone.lines[0]!.stroke!.width).toBe(0);
    expect(undone.lines[0]!.stroke!.type).toBe('default');
  });
});

describe('junction diameter edit', () => {
  it('sets the diameter and round-trips', () => {
    const doc = load();
    const after = replaceJunction(0, { ...doc.junctions[0]!, diameter: mmToIU(0.9) }).apply(doc);
    expect(iuToMM(after.junctions[0]!.diameter)).toBeCloseTo(0.9);
    expect(serializeSchematic(after)).toContain('(diameter 0.9)');
  });
});
