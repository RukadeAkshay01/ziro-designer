/**
 * Symbol annotation (counterpart eeschema/annotate.cpp +
 * sch_reference_list.cpp): assign first-free numbers per prefix, sorted by
 * position, with keep/reset, sheet-× algos, scope, and power-symbol exclusion.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  annotateSymbols,
  clearAnnotationCommand,
  splitReference,
  defaultAnnotateOptions,
  type AnnotateOptions,
} from '@ziroeda/eeschema';

// Three resistors placed left→right at increasing X (R?, R?, R2) plus a power
// symbol (#PWR01) which must never be re-annotated.
const sym = (ref: string, x: number, y: number, uuid: string): string => `
  (symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "10k" (at ${x} ${y} 0)))`;

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
  ${sym('R?', 100, 50, 'u-a')}
  ${sym('R?', 50, 50, 'u-b')}
  ${sym('R2', 150, 50, 'u-c')}
  (symbol (lib_id "power:GND") (at 10 10 0) (unit 1) (uuid "u-p")
    (property "Reference" "#PWR01" (at 10 10 0))
    (property "Value" "GND" (at 10 10 0)))
)`;

const opts = (over: Partial<AnnotateOptions>): AnnotateOptions => ({
  ...defaultAnnotateOptions(),
  ...over,
});

const refOf = (s: { fields: readonly { key: string; value: string }[] }): string =>
  s.fields.find((f) => f.key === 'Reference')!.value;

describe('splitReference (SCH_REFERENCE::Split)', () => {
  it('separates prefix and number; leaves ? / bare prefix numberless', () => {
    expect(splitReference('IC12')).toEqual({ prefix: 'IC', num: 12 });
    expect(splitReference('R?')).toEqual({ prefix: 'R' });
    expect(splitReference('R')).toEqual({ prefix: 'R' });
  });
});

describe('annotateSymbols', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('keeps existing numbers and fills ? by X position, avoiding taken numbers', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: false, order: 'x' }));
    // R2 kept; the two R? get the first free numbers by X order: R1 (x=50), R3 (x=100).
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1'); // leftmost
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R3');
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R2'); // unchanged
  });

  it('reset re-numbers everything by position from 1', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: true, order: 'x' }));
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1'); // x=50
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R2'); // x=100
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R3'); // x=150
  });

  it('never annotates power symbols', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: true }));
    expect(refOf(next.find((s) => s.uuid === 'u-p')!)).toBe('#PWR01');
  });

  it('sheet number × 100 starts numbering at 101', () => {
    const next = annotateSymbols(
      doc,
      libById,
      opts({ resetExisting: true, algo: 'sheet_100', sheetNumber: 1, order: 'x' }),
    );
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R101');
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R103');
  });

  it('start number offsets the first free number', () => {
    const next = annotateSymbols(
      doc,
      libById,
      opts({ resetExisting: true, startNumber: 10, order: 'x' }),
    );
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R11');
  });
});

describe('clearAnnotationCommand', () => {
  const doc = readSchematic(parse(SCH));
  it('resets references to prefix + ? and leaves power symbols', () => {
    const after = clearAnnotationCommand('all').apply(doc);
    expect(after.symbols.filter((s) => refOf(s) === 'R?')).toHaveLength(3);
    expect(refOf(after.symbols.find((s) => s.uuid === 'u-p')!)).toBe('#PWR01');
  });
  it('is undoable', () => {
    const cmd = clearAnnotationCommand('all');
    const after = cmd.apply(doc);
    const undone = cmd.invert(doc).apply(after);
    expect(undone.symbols.map(refOf)).toEqual(doc.symbols.map(refOf));
  });
});
