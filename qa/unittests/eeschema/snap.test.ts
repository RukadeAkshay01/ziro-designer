import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  collectAnchors,
  selectionAnchors,
  nearestAnchor,
} from '@ziroeda/eeschema/src/tools/snap.js';
import { addItems, makeWire, placeSymbol } from '@ziroeda/eeschema/src/tools/index.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
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

describe('connectable snapping helpers', () => {
  it('collects wire endpoints and symbol pins as anchors', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(10, 0), at(20, 0))] }).apply(sch);
    const anchors = collectAnchors(sch, libMap(sch));
    // R has two pins + wire has two endpoints.
    expect(anchors.length).toBe(4);
    expect(anchors.some((a) => a.x === mmToIU(10) && a.y === 0)).toBe(true);
  });

  it('nearestAnchor snaps within range and ignores anchors outside it', () => {
    const anchors = [at(0, 0), at(10, 0)];
    expect(nearestAnchor(at(0.3, 0.2), anchors, mmToIU(0.5))).toEqual(at(0, 0));
    expect(nearestAnchor(at(5, 0), anchors, mmToIU(0.5))).toBeNull();
  });

  it('excludes the moved item from the fixed anchors and returns its own points', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(0, -3.81), at(20, -3.81))] }).apply(sch);
    const wireId = refId('line', sch.lines[0]!.uuid, 0);
    const moved = new Set([wireId]);
    const fixed = collectAnchors(sch, libMap(sch), moved); // only R's pins
    const own = selectionAnchors(sch, libMap(sch), moved); // the wire's endpoints
    expect(fixed.length).toBe(2);
    expect(own).toHaveLength(2);
    // The wire's near end coincides with R's pin, so snapping keeps them attached.
    expect(fixed.some((a) => a.x === own[0]!.x && a.y === own[0]!.y)).toBe(true);
  });
});
