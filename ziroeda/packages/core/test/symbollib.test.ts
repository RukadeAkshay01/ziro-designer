import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/sexpr/index.js';
import { readSymbolLib } from '../src/model/read-schematic.js';
import { mmToIU } from '../src/units.js';
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
