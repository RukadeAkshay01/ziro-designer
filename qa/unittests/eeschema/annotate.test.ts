/**
 * Symbol annotation (counterpart eeschema/annotate.cpp +
 * sch_reference_list.cpp): assign first-free numbers per prefix, sorted by
 * position, with keep/reset, sheet-× algos, scope, and power-symbol exclusion.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  RefDesTracker,
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

describe('annotateSymbols — multi-unit sharing (REFDES_TRACKER::GetNextRefDesForUnits)', () => {
  // A two-unit part: fresh unit A + unit B placed separately, plus a kept
  // U1 unit A to join, and a different-value dual op-amp that must not share.
  const multiSym = (ref: string, value: string, unit: number, x: number, uuid: string): string => `
  (symbol (lib_id "Amp:Dual") (at ${x} 50 0) (unit ${unit}) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} 50 0))
    (property "Value" "${value}" (at ${x} 50 0)))`;

  const MULTI_SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
    (lib_symbols
      (symbol "Amp:Dual" (property "Reference" "U" (at 0 0 0))
        (symbol "Dual_1_1") (symbol "Dual_2_1")))
    ${multiSym('U1', 'TL072', 1, 10, 'm-kept')}
    ${multiSym('U?', 'TL072', 2, 20, 'm-b')}
    ${multiSym('U?', 'TL072', 1, 30, 'm-a2')}
    ${multiSym('U?', 'NE5532', 1, 40, 'm-other')}
  )`;

  const doc = readSchematic(parse(MULTI_SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('fresh units fill free unit slots of a same-lib same-value number', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: false, order: 'x' }));
    // Unit 2 joins the kept U1 (unit 1 taken, unit 2 free).
    expect(refOf(next.find((s) => s.uuid === 'm-b')!)).toBe('U1');
    // A second unit 1 cannot join U1 (slot taken) → first fully-free number
    // for unit 1 is U2.
    expect(refOf(next.find((s) => s.uuid === 'm-a2')!)).toBe('U2');
    // A different value must not share U2's number even though unit 2 is free.
    expect(refOf(next.find((s) => s.uuid === 'm-other')!)).toBe('U3');
    expect(refOf(next.find((s) => s.uuid === 'm-kept')!)).toBe('U1');
  });

  it('reset keeps units that shared a reference together', () => {
    const SHARED = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
      (lib_symbols
        (symbol "Amp:Dual" (property "Reference" "U" (at 0 0 0))
          (symbol "Dual_1_1") (symbol "Dual_2_1")))
      ${multiSym('U7', 'TL072', 1, 10, 's-a')}
      ${multiSym('U7', 'TL072', 2, 90, 's-b')}
      ${multiSym('U3', 'TL072', 1, 50, 's-solo')}
    )`;
    const sdoc = readSchematic(parse(SHARED));
    const slib = new Map(sdoc.libSymbols.map((l) => [l.libId, l]));
    const next = annotateSymbols(sdoc, slib, opts({ resetExisting: true, order: 'x' }));
    // The U7 pair stays paired on one number despite s-solo sitting between
    // them in X order.
    const a = refOf(next.find((s) => s.uuid === 's-a')!);
    const b = refOf(next.find((s) => s.uuid === 's-b')!);
    expect(a).toBe(b);
    expect(refOf(next.find((s) => s.uuid === 's-solo')!)).not.toBe(a);
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

// REFDES_TRACKER (schematic.used_designators): serialization round-trip and
// the reuse gate in annotation numbering.
describe('RefDesTracker', () => {
  it('serializes ranges and escapes, and round-trips', () => {
    const t = new RefDesTracker();
    for (const r of ['R1', 'R2', 'R3', 'R7', 'U1', 'X-Y2']) t.insert(r);
    const text = t.serialize();
    expect(text).toBe('R1-3,R7,U1,X\\-Y2');
    const t2 = new RefDesTracker();
    expect(t2.deserialize(text)).toBe(true);
    expect(t2.contains('R2')).toBe(true);
    expect(t2.contains('X-Y2')).toBe(true);
    expect(t2.contains('R4')).toBe(false);
  });

  it('rejects malformed data and clears', () => {
    const t = new RefDesTracker();
    t.insert('R1');
    expect(t.deserialize('R0')).toBe(false); // non-positive number fails parsePositiveInt
    expect(t.size).toBe(0);
  });
});

// GetNextRefDesForUnits' reuse gate: with reuse off, previously-used-but-freed
// numbers are skipped; with reuse on (the default), they come back.
describe('annotate with a REFDES_TRACKER', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('skips previously used numbers when reuse is off', () => {
    const tracker = new RefDesTracker();
    tracker.reuseRefDes = false;
    tracker.deserialize('R1,R3'); // freed earlier in the project's history
    const next = annotateSymbols(doc, libById, opts({ order: 'x', tracker }));
    // R2 is taken on-sheet; R1/R3 are gated -> the two R? become R4 and R5.
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R4');
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R5');
    // Every assignment is recorded for the next run.
    expect(tracker.contains('R4')).toBe(true);
    expect(tracker.contains('R5')).toBe(true);
  });

  it('reuses freed numbers when reuse is on', () => {
    const tracker = new RefDesTracker();
    tracker.reuseRefDes = true;
    tracker.deserialize('R1,R3');
    const next = annotateSymbols(doc, libById, opts({ order: 'x', tracker }));
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1');
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R3');
  });
});
