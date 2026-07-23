/**
 * Editing a label's text and shape (Properties): the replaceLabel command and
 * the lossless writer patch for `(shape …)` on global/hierarchical labels.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceLabel } from '@ziroeda/eeschema/src/tools/mutate.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (label "NET1" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "loc-1"))
  (global_label "BUS_A" (shape input) (at 80 60 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "glb-1"))
)`;

const load = () => readSchematic(parse(SCH));

describe('replaceLabel', () => {
  it('edits a net label’s text and round-trips through the writer', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, { ...orig, text: '+3V3' }).apply(doc);
    expect(after.labels[idx]!.text).toBe('+3V3');
    expect(serializeSchematic(after)).toContain('(label "+3V3"');
  });

  it('edits a global label’s shape and it round-trips', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'glb-1')!;
    const idx = doc.labels.indexOf(orig);
    expect(orig.shape).toBe('input');
    const after = replaceLabel(idx, { ...orig, shape: 'output' }).apply(doc);
    const text = serializeSchematic(after);
    expect(text).toContain('(shape output)');
    expect(text).not.toContain('(shape input)');
  });

  it('is undoable through History', () => {
    const doc = load();
    const h = new History();
    const idx = doc.labels.findIndex((l) => l.uuid === 'loc-1');
    const after = h.execute(doc, replaceLabel(idx, { ...doc.labels[idx]!, text: 'CHANGED' }));
    expect(after.labels[idx]!.text).toBe('CHANGED');
    const undone = h.undo(after)!;
    expect(undone.labels[idx]!.text).toBe('NET1');
  });
});

describe('writeLabel formatting/orientation patches', () => {
  it('bold + text size edits serialize into the (effects (font …)) node', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, {
      ...orig,
      effects: { hidden: false, ...orig.effects, bold: true, fontSize: [25400, 25400] },
    }).apply(doc);
    const text = serializeSchematic(after);
    expect(text).toContain('(bold yes)');
    expect(text).toContain('(size 2.54 2.54)');
  });

  it('an orientation edit updates the (at x y angle) argument', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, { ...orig, angle: 90 }).apply(doc);
    expect(serializeSchematic(after)).toContain('(at 50 50 90)');
  });

  it('an untouched label round-trips byte-stable despite the new patches', () => {
    const doc = load();
    const before = serializeSchematic(doc);
    const orig = doc.labels.find((l) => l.uuid === 'glb-1')!;
    const idx = doc.labels.indexOf(orig);
    // Identity replace: nothing semantically changed, nothing should move.
    const after = replaceLabel(idx, { ...orig }).apply(doc);
    expect(serializeSchematic(after)).toBe(before);
  });
});
