/**
 * Symbol Properties editing: the editSymbolProperties command (ported from
 * DIALOG_SYMBOL_PROPERTIES::TransferDataFromWindow), the lossless field/effects
 * writer, and the SCH_FIELD bounding-box/justification geometry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { editSymbolProperties, type EditedField } from '@ziroeda/eeschema/src/tools/properties.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  fieldTextBox,
  fieldBoundingBox,
  fieldDrawRotation,
  letterSubReference,
  fieldShownText,
  effectiveHorizJustify,
  isHorizJustifyFlipped,
  DEFAULT_TEXT_SIZE,
} from '@ziroeda/eeschema/src/fieldbox.js';
import type { SchField, SchSymbol, TextEffects } from '@ziroeda/eeschema/src/types.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../data/nfc-antenna.kicad_sch', import.meta.url)),
  'utf8',
);

// A simple advance model for tests: each character is 0.8 em wide.
const measure = (text: string, size: number): number => Math.round(text.length * 0.8 * size);

function editedFields(sym: SchSymbol, patch?: (f: EditedField) => EditedField): EditedField[] {
  return sym.fields.map((f) => {
    const rel: EditedField = {
      ...f,
      at: f.at ? { x: f.at.x - sym.at.x, y: f.at.y - sym.at.y } : undefined,
    };
    return patch ? patch(rel) : rel;
  });
}

const baseEdit = (sym: SchSymbol) => ({
  angle: sym.angle,
  mirror: sym.mirror,
  unit: sym.unit,
  inBom: sym.inBom,
  onBoard: sym.onBoard,
  dnp: sym.dnp,
  excludedFromSim: sym.excludedFromSim,
});

describe('editSymbolProperties', () => {
  it('a no-op edit leaves the serialized file byte-identical', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const next = editSymbolProperties(id, { ...baseEdit(sym), fields: editedFields(sym) }).apply(
      sch,
    );
    expect(serialize(writeSchematic(next))).toBe(serialize(writeSchematic(sch)));
  });

  it('changes a field value and visibility, and is undoable', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const cmd = editSymbolProperties(id, {
      ...baseEdit(sym),
      fields: editedFields(sym, (f) =>
        f.key === 'Reference'
          ? { ...f, value: 'J99', effects: { ...(f.effects ?? { hidden: false }), hidden: true } }
          : f,
      ),
    });
    const next = cmd.apply(sch);
    const re = readSchematic(writeSchematic(next));
    const ref = re.symbols[0]!.fields.find((f) => f.key === 'Reference')!;
    expect(ref.value).toBe('J99');
    expect(ref.effects?.hidden).toBe(true);
    // Undo restores the exact original bytes.
    const undone = cmd.invert(sch).apply(next);
    expect(serialize(writeSchematic(undone))).toBe(serialize(writeSchematic(sch)));
  });

  it('adds a new field (KiCad: hidden, named FieldN) and removes it again', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const newField: EditedField = {
      key: 'MPN',
      value: 'ABC-123',
      at: { x: 0, y: mmToIU(5.08) },
      angle: 0,
      effects: { hidden: true, fontSize: [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE] },
    };
    const withField = editSymbolProperties(id, {
      ...baseEdit(sym),
      fields: [...editedFields(sym), newField],
    }).apply(sch);

    const text = serialize(writeSchematic(withField));
    expect(text).toContain('(property "MPN" "ABC-123"');
    const re = readSchematic(parse(text));
    const mpn = re.symbols[0]!.fields.find((f) => f.key === 'MPN')!;
    expect(mpn.value).toBe('ABC-123');
    expect(mpn.effects?.hidden).toBe(true);
    // Position was symbol-relative in the dialog; stored absolute.
    expect(mpn.at).toEqual({ x: sym.at.x, y: sym.at.y + mmToIU(5.08) });

    // Delete it again.
    const sym2 = re.symbols[0]!;
    const without = editSymbolProperties(refId('symbol', sym2.uuid, 0), {
      ...baseEdit(sym2),
      fields: editedFields(sym2).filter((f) => f.key !== 'MPN'),
    }).apply(re);
    expect(serialize(writeSchematic(without))).not.toContain('"MPN"');
  });

  it('drops empty-name+empty-value rows and names valued ones "untitled"', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const extra: EditedField[] = [
      { key: '', value: '', angle: 0, at: { x: 0, y: 0 }, effects: { hidden: true } },
      { key: '', value: 'kept', angle: 0, at: { x: 0, y: 0 }, effects: { hidden: true } },
    ];
    const next = editSymbolProperties(id, {
      ...baseEdit(sym),
      fields: [...editedFields(sym), ...extra],
    }).apply(sch);
    const re = readSchematic(writeSchematic(next));
    const keys = re.symbols[0]!.fields.map((f) => f.key);
    expect(keys).toContain('untitled');
    expect(re.symbols[0]!.fields.length).toBe(sym.fields.length + 1); // empty+empty dropped
  });

  it('writes unit / dnp / in_bom / on_board / mirror / orientation', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const next = editSymbolProperties(id, {
      fields: editedFields(sym),
      angle: 90,
      mirror: 'x',
      unit: 2,
      inBom: false,
      onBoard: false,
      dnp: true,
      excludedFromSim: true,
    }).apply(sch);
    const text = serialize(writeSchematic(next));
    expect(text).toContain('(dnp yes)');
    expect(text).toContain('(in_bom no)');
    expect(text).toContain('(on_board no)');
    expect(text).toContain('(exclude_from_sim yes)');
    expect(text).toContain('(mirror x)');
    const re = readSchematic(parse(text));
    expect(re.symbols[0]!.angle).toBe(90);
    expect(re.symbols[0]!.mirror).toBe('x');
    expect(re.symbols[0]!.unit).toBe(2);
    expect(re.symbols[0]!.dnp).toBe(true);
    expect(re.symbols[0]!.inBom).toBe(false);
    expect(re.symbols[0]!.excludedFromSim).toBe(true);
  });

  it('patches font size, bold, italic, justify and show_name losslessly', () => {
    const sch = readSchematic(parse(fixture));
    const sym = sch.symbols[0]!;
    const id = refId('symbol', sym.uuid, 0);
    const fx: TextEffects = {
      hidden: false,
      fontSize: [mmToIU(2.54), mmToIU(2.54)],
      bold: true,
      italic: true,
      justify: ['right', 'top'],
    };
    const next = editSymbolProperties(id, {
      ...baseEdit(sym),
      fields: editedFields(sym, (f) =>
        f.key === 'Value' ? { ...f, effects: fx, nameShown: true } : f,
      ),
    }).apply(sch);
    const text = serialize(writeSchematic(next));
    const re = readSchematic(parse(text));
    const val = re.symbols[0]!.fields.find((f) => f.key === 'Value')!;
    expect(val.effects?.fontSize).toEqual([mmToIU(2.54), mmToIU(2.54)]);
    expect(val.effects?.bold).toBe(true);
    expect(val.effects?.italic).toBe(true);
    expect(val.effects?.justify).toEqual(['right', 'top']);
    expect(val.nameShown).toBe(true);
    expect(text).toContain('(show_name yes)');
  });
});

describe('field geometry (SCH_FIELD::GetBoundingBox port)', () => {
  const mkSym = (angle = 0, mirror?: 'x' | 'y'): SchSymbol => ({
    libId: 'X',
    at: { x: 100000, y: 100000 },
    angle,
    unit: 1,
    bodyStyle: 1,
    inBom: true,
    onBoard: true,
    dnp: false,
    fields: [],
    source: { kind: 'list', items: [] },
    ...(mirror ? { mirror } : {}),
  });
  const mkField = (justify?: readonly string[], angle = 0): SchField => ({
    key: 'Reference',
    value: 'R1',
    angle,
    at: { x: 120000, y: 100000 },
    effects: { hidden: false, fontSize: [12700, 12700], ...(justify ? { justify } : {}) },
    source: { kind: 'list', items: [] },
  });

  it('anchors a left/bottom-justified field to the right of and above its position', () => {
    const f = mkField(['left', 'bottom']);
    const box = fieldTextBox(f, 'R1', measure);
    // Left: box starts at the anchor. Bottom: box ends slightly below it (fudge).
    expect(box.x).toBe(f.at!.x);
    expect(box.y + box.h).toBeGreaterThan(f.at!.y - 1000);
    expect(box.y).toBeLessThan(f.at!.y);
  });

  it('mirroring the symbol flips which side the box lands on (justify flip)', () => {
    const sym = mkSym();
    const f = mkField(['left']);
    const plain = fieldBoundingBox(f, sym, 'R1', measure);
    const mirrored = fieldBoundingBox(f, mkSym(0, 'y'), 'R1', measure);
    // Left-justified: the box grows rightward from the anchor. Mirror-Y flips the
    // text run around the anchor (the file position is the *transformed* one —
    // SCH_FIELD::GetPosition), so the box now grows leftward, ending at it.
    expect(plain.x).toBe(f.at!.x); // box starts at the anchor
    expect(Math.abs(mirrored.x + mirrored.w - f.at!.x)).toBeLessThan(3000); // ends at the anchor
    expect(mirrored.x).toBeLessThan(plain.x);
    expect(isHorizJustifyFlipped(f, mkSym(0, 'y'), 'R1', measure)).toBe(true);
    expect(effectiveHorizJustify(f, mkSym(0, 'y'), 'R1', measure)).toBe('right');
    expect(effectiveHorizJustify(f, sym, 'R1', measure)).toBe('left');
  });

  it('rotating the symbol 90° toggles the field draw rotation', () => {
    const f = mkField(undefined, 0);
    expect(fieldDrawRotation(f, mkSym(0))).toBe(0);
    expect(fieldDrawRotation(f, mkSym(90))).toBe(90);
    expect(fieldDrawRotation({ ...f, angle: 90 }, mkSym(90))).toBe(0);
  });

  it('letterSubReference matches LIB_SYMBOL::LetterSubReference', () => {
    expect(letterSubReference(1)).toBe('A');
    expect(letterSubReference(26)).toBe('Z');
    expect(letterSubReference(27)).toBe('AA');
  });

  it('multi-unit references gain the unit letter; show_name prefixes the key', () => {
    const sym = { ...mkSym(), unit: 2 };
    const f = mkField();
    expect(fieldShownText(f, sym, 3)).toBe('R1B');
    expect(fieldShownText({ ...f, nameShown: true }, sym, 1)).toBe('Reference: R1');
  });
});
