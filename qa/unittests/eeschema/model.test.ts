import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../data/${name}`, import.meta.url)), 'utf8');

const sch = readSchematic(parse(fixture('nfc-antenna.kicad_sch')));

describe('units', () => {
  it('converts mm to integer internal units (100 nm)', () => {
    expect(mmToIU(161.29)).toBe(1612900);
    expect(mmToIU(0)).toBe(0);
    expect(mmToIU(-1.27)).toBe(-12700);
  });
});

describe('readSchematic: header', () => {
  it('reads version, generator, paper, uuid', () => {
    expect(sch.version).toBe(20250114);
    expect(sch.generator).toBe('eeschema');
    expect(sch.generatorVersion).toBe('9.0');
    expect(sch.paper).toBe('A4');
    expect(sch.uuid).toBe('1d90eb76-94ad-42ee-a1c7-3c040dcf91c0');
  });
});

describe('readSchematic: instance items', () => {
  it('reads the placed symbol with position in IU, angle, and fields', () => {
    expect(sch.symbols).toHaveLength(1);
    const j1 = sch.symbols[0]!;
    expect(j1.libId).toBe('Connector_Generic:Conn_01x02');
    expect(j1.at).toEqual({ x: mmToIU(156.21), y: mmToIU(111.76) });
    expect(j1.angle).toBe(180);
    expect(j1.unit).toBe(1);
    expect(j1.dnp).toBe(false);
    expect(j1.inBom).toBe(true);
    // Reference field "J1" is present and visible.
    const ref = j1.fields.find((f) => f.key === 'Reference');
    expect(ref?.value).toBe('J1');
  });

  it('reads the wire as two IU endpoints', () => {
    expect(sch.lines).toHaveLength(1);
    const w = sch.lines[0]!;
    expect(w.kind).toBe('wire');
    expect(w.start).toEqual({ x: mmToIU(161.29), y: mmToIU(109.22) });
    expect(w.end).toEqual({ x: mmToIU(161.29), y: mmToIU(111.76) });
  });

  it('reads the label text, position, and justification', () => {
    expect(sch.labels).toHaveLength(1);
    const l = sch.labels[0]!;
    expect(l.kind).toBe('label');
    expect(l.text).toBe('ANT');
    expect(l.at).toEqual({ x: mmToIU(161.29), y: mmToIU(109.22) });
    expect(l.effects?.justify).toEqual(['left', 'bottom']);
  });
});

describe('readSchematic: library symbol', () => {
  const lib = sch.libSymbols[0]!;

  it('reads the lib symbol id and its unit', () => {
    expect(sch.libSymbols).toHaveLength(1);
    expect(lib.libId).toBe('Connector_Generic:Conn_01x02');
    expect(lib.units).toHaveLength(1);
    expect(lib.units[0]!.name).toBe('Conn_01x02_1_1');
    expect(lib.units[0]!.unit).toBe(1);
    expect(lib.units[0]!.bodyStyle).toBe(1);
  });

  it('reads body graphics (rectangles) with stroke and fill', () => {
    const rects = lib.units[0]!.graphics.filter((g) => g.kind === 'rectangle');
    expect(rects.length).toBe(3);
    const outline = rects[0]!;
    expect(outline.kind).toBe('rectangle');
    if (outline.kind === 'rectangle') {
      // Symbol-library Y is +up; the reader inverts it to the model's +Y-down space,
      // so the stored corner (-1.27, 1.27) becomes (-1.27, -1.27).
      expect(outline.start).toEqual({ x: mmToIU(-1.27), y: mmToIU(-1.27) });
      expect(outline.fill?.type).toBe('background');
    }
  });

  it('reads the two pins with electrical type, position, and numbers', () => {
    const pins = lib.units[0]!.pins;
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.number)).toEqual(['1', '2']);
    expect(pins[0]!.electricalType).toBe('passive');
    expect(pins[0]!.at).toEqual({ x: mmToIU(-5.08), y: mmToIU(0) });
    expect(pins[0]!.length).toBe(mmToIU(3.81));
  });
});

describe('readSchematic: losslessness is preserved alongside the typed view', () => {
  it('keeps the source AST node on every modelled item', () => {
    expect(sch.source.kind).toBe('list');
    expect(sch.symbols[0]!.source.kind).toBe('list');
    expect(sch.lines[0]!.source.kind).toBe('list');
    expect(sch.libSymbols[0]!.units[0]!.pins[0]!.source.kind).toBe('list');
  });
});

describe('legacy bare-hide and per-pin text sizes', () => {
  it('treats a bare `hide` token in effects as hidden (Altium-import files)', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
      (text "SECRET" (at 0 0 0) (effects (font (size 1.27 1.27)) hide)))`),
    );
    expect(sch.labels[0]!.effects?.hidden).toBe(true);
  });

  it('parses per-pin name/number sizes; size 0 marks the text as not drawn', () => {
    const libs = readSymbolLib(
      parse(`(kicad_symbol_lib (symbol "X"
      (symbol "X_1_1"
        (pin passive line (at 0 0 0) (length 2.54)
          (name "IN" (effects (font (size 0 0))))
          (number "1" (effects (font (size 1.27 1.27)))))))
    )`),
    );
    const pin = libs[0]!.units[0]!.pins[0]!;
    expect(pin.nameSize).toBe(0);
    expect(pin.numberSize).toBe(12700);
  });

  it('parses bold and font colour from effects', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
      (text "T" (at 0 0 0) (effects (font (size 4.572 4.572) bold (color 194 0 0 1)))))`),
    );
    expect(sch.labels[0]!.effects?.bold).toBe(true);
    expect(sch.labels[0]!.effects?.color).toEqual([194, 0, 0, 1]);
  });
});
