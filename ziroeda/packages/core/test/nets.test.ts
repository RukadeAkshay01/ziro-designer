import { describe, it, expect } from 'vitest';
import { parse } from '../src/sexpr/index.js';
import { readSchematic, readSymbolLib } from '../src/model/read-schematic.js';
import { computeNetlist } from '../src/connectivity/nets.js';
import { addItems, makeWire, makeJunction, makeLabel, placeSymbol } from '../src/edit/index.js';
import { refId } from '../src/edit/hittest.js';
import { mmToIU } from '../src/units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '../src/model/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) => new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));

// A 2-pin part (R) so we have real pins to connect.
const R = readSymbolLib(parse(readFileSync(fileURLToPath(new URL('./fixtures/R.kicad_sym', import.meta.url)), 'utf8')))[0]!;

describe('computeNetlist', () => {
  it('joins two wires that share an endpoint into one net', () => {
    let sch = EMPTY();
    sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(10, 10))] }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
    expect(nets[0]!.items).toHaveLength(2);
  });

  it('keeps two wires that merely cross (no junction) on separate nets', () => {
    let sch = EMPTY();
    // Horizontal wire and a vertical wire crossing its middle, no junction.
    sch = addItems({ lines: [makeWire(at(0, 5), at(10, 5)), makeWire(at(5, 0), at(5, 10))] }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(2);
  });

  it('a junction ties wires that cross at its position into one net', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 5), at(10, 5)), makeWire(at(5, 0), at(5, 10))],
      junctions: [makeJunction(at(5, 5))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
  });

  it('names the net from a label sharing a wire endpoint', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      labels: [makeLabel('label', 'CLK', at(0, 0))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
    expect(nets[0]!.name).toBe('CLK');
  });

  it('a global label outranks a local label on the same net', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      labels: [makeLabel('label', 'LOCAL', at(0, 0)), makeLabel('global_label', 'VBUS', at(10, 0))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets[0]!.name).toBe('VBUS');
  });

  it('connects a symbol pin to a wire at the pin position and reports its net', () => {
    let sch = EMPTY();
    // Place R at (0,0): R has pins at (0, +3.81) and (0, -3.81) in IU (vertical).
    sch = placeSymbol(R, at(0, 0)).apply(sch);
    const sym = sch.symbols[0]!;
    const symId = refId('symbol', sym.uuid, 0);
    // Wire from pin 1 (top, at y=-3.81 after inversion) outward, and label it.
    sch = addItems({
      lines: [makeWire(at(0, -3.81), at(20, -3.81))],
      labels: [makeLabel('label', 'TOP', at(20, -3.81))],
    }).apply(sch);
    const { nets, netByItem } = computeNetlist(sch, libMap(sch));
    const topNet = nets.find((n) => n.name === 'TOP');
    expect(topNet).toBeDefined();
    // The symbol's first pin node should be on the TOP net.
    expect(netByItem.get(`${symId}:pin0`)).toBe(topNet!.code);
  });
});
