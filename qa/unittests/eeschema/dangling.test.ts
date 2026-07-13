import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { danglingPinPositions } from '@ziroeda/eeschema/src/connectivity/dangling.js';
import { addItems, makeWire, placeSymbol } from '@ziroeda/eeschema/src/tools/index.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) =>
  new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));
const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

describe('danglingPinPositions', () => {
  it('reports both pins of a lone resistor as dangling', () => {
    const sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    const dangling = danglingPinPositions(sch, libMap(sch));
    expect(dangling.length).toBe(2);
  });

  it('a pin with a wire attached to its tip is no longer dangling', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    // R's pins (from fixture) are at y = ±3.81mm on x=0 after placement at origin.
    const dangling0 = danglingPinPositions(sch, libMap(sch));
    const pin = dangling0[0]!;
    sch = addItems({ lines: [makeWire(pin, { x: pin.x + mmToIU(10), y: pin.y })] }).apply(sch);
    const dangling1 = danglingPinPositions(sch, libMap(sch));
    expect(dangling1.length).toBe(1);
    // The remaining dangling pin is the other one, not the wired one.
    expect(dangling1[0]!.x === pin.x && dangling1[0]!.y === pin.y).toBe(false);
  });

  it('a wire passing through a pin (mid-segment) also connects it', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    const pins = danglingPinPositions(sch, libMap(sch));
    const p = pins[0]!;
    // Wire spanning across the pin so the pin lies in its interior.
    sch = addItems({
      lines: [makeWire({ x: p.x - mmToIU(5), y: p.y }, { x: p.x + mmToIU(5), y: p.y })],
    }).apply(sch);
    const after = danglingPinPositions(sch, libMap(sch));
    expect(after.some((q) => q.x === p.x && q.y === p.y)).toBe(false);
  });
});
