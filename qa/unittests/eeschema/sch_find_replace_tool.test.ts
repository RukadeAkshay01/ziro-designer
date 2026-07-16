/**
 * Find matching (counterpart eeschema/tools/sch_find_replace_tool.cpp +
 * EDA_ITEM::Matches): plain contains (case-insensitive by default),
 * whole-word, and wildcard whole-string modes, over labels/fields/pins/
 * sheets/text.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  matchesText,
  findMatches,
  replaceText,
  replaceCommand,
  defaultSearchData,
  type SchSearchData,
} from '@ziroeda/eeschema';

const data = (over: Partial<SchSearchData>): SchSearchData => ({
  ...defaultSearchData(),
  ...over,
});

describe('matchesText (EDA_ITEM::Matches)', () => {
  it('plain mode is case-insensitive contains; Match case restricts it', () => {
    expect(matchesText('Net_VCC_3V3', data({ findString: 'vcc' }))).toBe(true);
    expect(matchesText('Net_VCC_3V3', data({ findString: 'vcc', matchCase: true }))).toBe(false);
    expect(matchesText('Net_VCC_3V3', data({ findString: 'VCC', matchCase: true }))).toBe(true);
  });

  it('whole-word mode requires word boundaries', () => {
    expect(matchesText('VCC rail', data({ findString: 'VCC', matchMode: 'wholeword' }))).toBe(true);
    expect(matchesText('VCCIO', data({ findString: 'VCC', matchMode: 'wholeword' }))).toBe(false);
  });

  it('wildcard mode matches the whole string with * and ?', () => {
    expect(matchesText('R15', data({ findString: 'R?5', matchMode: 'wildcard' }))).toBe(true);
    expect(matchesText('R15', data({ findString: 'R*', matchMode: 'wildcard' }))).toBe(true);
    expect(matchesText('CR15', data({ findString: 'R*', matchMode: 'wildcard' }))).toBe(false);
  });

  it('an empty search string never matches', () => {
    expect(matchesText('anything', data({ findString: '' }))).toBe(false);
  });
});

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols (symbol "Device:R" (pin_numbers hide) (property "Reference" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 100 270) (length 100) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -100 90) (length 100) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:R") (at 100 50 0) (uuid "sym-1")
    (property "Reference" "R42" (at 100 45 0))
    (property "Value" "10k" (at 100 55 0))
    (property "MPN" "RC0603" (at 100 60 0) (effects (font (size 1.27 1.27)) hide)))
  (label "VCC_RAIL" (at 200 100 0) (uuid "lab-1") (effects (font (size 1.27 1.27))))
  (text "review this net" (at 300 200 0) (uuid "txt-1") (effects (font (size 1.27 1.27))))
)`;

describe('findMatches', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('finds labels and plain text', () => {
    const hits = findMatches(doc, libById, data({ findString: 'vcc' }));
    expect(hits.map((h) => h.kind)).toEqual(['label']);
    const txt = findMatches(doc, libById, data({ findString: 'review' }));
    expect(txt.map((h) => h.kind)).toEqual(['label']); // plain text is a label of kind 'text'
  });

  it('finds visible symbol fields; hidden ones only with searchAllFields', () => {
    expect(findMatches(doc, libById, data({ findString: 'R42' }))).toHaveLength(1);
    expect(findMatches(doc, libById, data({ findString: 'RC0603' }))).toHaveLength(0);
    expect(
      findMatches(doc, libById, data({ findString: 'RC0603', searchAllFields: true })),
    ).toHaveLength(1);
  });

  it('finds pin numbers only with searchAllPins', () => {
    expect(
      findMatches(doc, libById, data({ findString: '2', matchMode: 'wholeword' })),
    ).toHaveLength(0);
    const hits = findMatches(
      doc,
      libById,
      data({ findString: '2', matchMode: 'wholeword', searchAllPins: true }),
    );
    expect(hits.map((h) => h.kind)).toEqual(['symbol']);
  });

  it('in replace mode, reference fields match only with replaceReferences', () => {
    const base = { findString: 'R42', searchAndReplace: true };
    expect(findMatches(doc, libById, data(base))).toHaveLength(0);
    expect(findMatches(doc, libById, data({ ...base, replaceReferences: true }))).toHaveLength(1);
  });
});

describe('replaceText (EDA_ITEM::Replace)', () => {
  it('substitutes every occurrence, preserving the untouched text case', () => {
    expect(replaceText('vcc and VCC_IO', data({ findString: 'VCC', replaceString: '+3V3' }))).toBe(
      '+3V3 and +3V3_IO',
    );
  });

  it('respects whole-word boundaries per occurrence', () => {
    expect(
      replaceText(
        'VCC VCCIO',
        data({ findString: 'VCC', replaceString: '+5V', matchMode: 'wholeword' }),
      ),
    ).toBe('+5V VCCIO');
  });

  it('returns null when nothing changes', () => {
    expect(replaceText('GND', data({ findString: 'VCC', replaceString: '+5V' }))).toBeNull();
  });
});

describe('replaceCommand', () => {
  const doc = readSchematic(parse(SCH));
  const d = data({
    findString: 'VCC_RAIL',
    replaceString: 'VBUS',
    searchAndReplace: true,
  });

  it('replaces matched label text and is undoable', () => {
    const cmd = replaceCommand(d);
    const after = cmd.apply(doc);
    expect(after.labels.find((l) => l.text === 'VBUS')).toBeTruthy();
    expect(after.labels.find((l) => l.text === 'VCC_RAIL')).toBeUndefined();
    const undone = cmd.invert(doc).apply(after);
    expect(undone.labels.map((l) => l.text)).toEqual(doc.labels.map((l) => l.text));
  });

  it('never rewrites reference designators without replaceReferences', () => {
    const refCmd = replaceCommand(data({ findString: 'R42', replaceString: 'R99' }));
    const after = refCmd.apply(doc);
    const ref = after.symbols[0]!.fields.find((f) => f.key === 'Reference');
    expect(ref?.value).toBe('R42');
    const withFlag = replaceCommand(
      data({ findString: 'R42', replaceString: 'R99', replaceReferences: true }),
    ).apply(doc);
    expect(withFlag.symbols[0]!.fields.find((f) => f.key === 'Reference')?.value).toBe('R99');
  });

  it('limits replacement to the given ids', () => {
    const cmd = replaceCommand(d, new Set(['no-such-id']));
    expect(cmd.apply(doc).labels.find((l) => l.text === 'VBUS')).toBeUndefined();
  });
});
