import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/sexpr/index.js';
import { readSymbolLib } from '../src/model/read-schematic.js';
import { mmToIU, iuToMM } from '../src/units.js';
import { History } from '../src/edit/command.js';
import { placeSymbol } from '../src/edit/mutate.js';
import { makeSymbol } from '../src/edit/build.js';

const r = readFileSync(fileURLToPath(new URL('./fixtures/R.kicad_sym', import.meta.url)), 'utf8');
const lib = readSymbolLib(parse(r));

describe('readSymbolLib (a real Device:R .kicad_sym)', () => {
  it('reads the resistor definition with its pins and graphics', () => {
    expect(lib).toHaveLength(1);
    const R = lib[0]!;
    expect(R.libId).toBe('R');
    // R has a body (rectangle) and two pins.
    const pins = R.units.flatMap((u) => u.pins);
    expect(pins).toHaveLength(2);
    expect(R.units.some((u) => u.graphics.length > 0)).toBe(true);
  });
});

describe('placeSymbol', () => {
  it('makeSymbol derives a "R?" reference and Value from the library', () => {
    const sym = makeSymbol(lib[0]!, { x: mmToIU(100), y: mmToIU(100) });
    expect(sym.libId).toBe('R');
    expect(sym.fields.find((f) => f.key === 'Reference')!.value).toBe('R?');
    expect(sym.fields.find((f) => f.key === 'Value')!.value).toBe('R');
  });

  it('adds the instance and embeds the library def, and undoes both', () => {
    const empty = { version: 1, libSymbols: [], symbols: [], lines: [], junctions: [], labels: [], source: parse('(kicad_sch (version 1))') } as const;
    const history = new History();
    const placed = history.execute(empty, placeSymbol(lib[0]!, { x: mmToIU(100), y: mmToIU(100) }));
    expect(placed.symbols).toHaveLength(1);
    expect(placed.libSymbols).toHaveLength(1); // def embedded
    expect(placed.symbols[0]!.at).toEqual({ x: mmToIU(100), y: mmToIU(100) });

    const undone = history.undo(placed)!;
    expect(undone.symbols).toHaveLength(0);
    expect(undone.libSymbols).toHaveLength(0); // newly-added def removed too
  });
});

describe('derived symbols (extends)', () => {
  it('inherits the parent body/pins, keeps its own properties', () => {
    const text = `(kicad_symbol_lib (version 1) (generator "x")
      (symbol "BASE" (property "Reference" "D" (at 0 0 0))
        (symbol "BASE_0_1" (rectangle (start -1 1) (end 1 -1) (stroke (width 0.2)) (fill (type none))))
        (symbol "BASE_1_1" (pin passive line (at -3 0 0) (length 2) (name "A") (number "1"))))
      (symbol "CHILD" (extends "BASE")
        (property "Reference" "D" (at 0 0 0)) (property "Value" "CHILD" (at 0 -2 0))))`;
    const libs = readSymbolLib(parse(text));
    const child = libs.find((l) => l.libId === 'CHILD')!;
    // Inherited graphics + pins from BASE.
    expect(child.units.length).toBeGreaterThan(0);
    expect(child.units.flatMap((u) => u.graphics).length).toBeGreaterThan(0);
    expect(child.units.flatMap((u) => u.pins).length).toBe(1);
    // Own Value property preserved.
    expect(child.properties.find((p) => p.key === 'Value')!.value).toBe('CHILD');
  });

  it('inherits the parent pin name/number visibility and name offset', () => {
    // BASE hides pin numbers and names (offset 1.016); CHILD declares neither and must inherit.
    const text = `(kicad_symbol_lib (version 1) (generator "x")
      (symbol "BASE" (pin_numbers (hide yes)) (pin_names (offset 1.016) (hide yes))
        (property "Reference" "D" (at 0 0 0))
        (symbol "BASE_0_1" (rectangle (start -1 1) (end 1 -1) (stroke (width 0.2)) (fill (type none))))
        (symbol "BASE_1_1" (pin passive line (at -3 0 0) (length 2) (name "A") (number "1"))))
      (symbol "CHILD" (extends "BASE") (property "Value" "CHILD" (at 0 -2 0))))`;
    const libs = readSymbolLib(parse(text));
    const child = libs.find((l) => l.libId === 'CHILD')!;
    expect(child.pinNumbersHidden).toBe(true);
    expect(child.pinNamesHidden).toBe(true);
    expect(iuToMM(child.pinNameOffset)).toBeCloseTo(1.016, 5);
  });
});
