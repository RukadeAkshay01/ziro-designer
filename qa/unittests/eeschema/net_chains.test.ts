/**
 * Net-chain detection (CONNECTION_GRAPH::RebuildNetChains +
 * buildBridgeAdjacency): 2-pin passthrough symbols on collinear wires bridge
 * their nets into chains; power-touching edges drop; labels name chains.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { detectNetChains } from '@ziroeda/eeschema/src/connectivity/net_chains.js';

// A horizontal 2-pin resistor: pins at (x-2.54, y) and (x+2.54, y).
const res = (ref: string, x: number, y: number, uuid: string): string => `
  (symbol (lib_id "Device:R") (at ${x} ${y} 90) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "10k" (at ${x} ${y} 0)))`;

const LIB = `(lib_symbols
  (symbol "power:GND" (power) (property "Reference" "#PWR" (at 0 0 0))
    (symbol "GND_1_1"
      (pin power_in line (at 0 0 90) (length 0)
        (name "GND" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))
  (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 2.54 270) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -2.54 90) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${LIB} ${body})`));

const chainsOf = (d: ReturnType<typeof doc>) =>
  detectNetChains(
    d,
    new Map(d.libSymbols.map((l) => [l.libId, l])),
    computeNetlist(d, new Map(d.libSymbols.map((l) => [l.libId, l]))),
  );

describe('detectNetChains', () => {
  // R1 at 90° spans (10-2.54, 10)..(10+2.54, 10) horizontally; wires left and
  // right are horizontal and collinear (same y) — the default-mode gate.
  const TWO_NETS = `
    ${res('R1', 10, 10, 'r1')}
    (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
    (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
    (label "IN" (at 0 10 0) (uuid "la"))
    (label "MID" (at 20 10 0) (uuid "lb"))`;

  it('bridges two labelled nets through a series resistor, named by label', () => {
    const chains = chainsOf(doc(TWO_NETS));
    expect(chains.length).toBe(1);
    expect(chains[0]!.nets).toEqual(['IN', 'MID']);
    expect(['IN', 'MID']).toContain(chains[0]!.name); // a member label names it
    expect(chains[0]!.symbols).toEqual(['r1']);
  });

  it('chains extend across several bridges', () => {
    const chains = chainsOf(
      doc(`
        ${res('R1', 10, 10, 'r1')}
        ${res('R2', 30, 10, 'r2')}
        (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
        (wire (pts (xy 12.54 10) (xy 27.46 10)) (uuid "wb"))
        (wire (pts (xy 32.54 10) (xy 40 10)) (uuid "wc"))
        (label "A" (at 0 10 0) (uuid "la"))
        (label "B" (at 12.54 10 0) (uuid "lb"))
        (label "C" (at 40 10 0) (uuid "lc"))`),
    );
    expect(chains.length).toBe(1);
    expect(chains[0]!.nets).toEqual(['A', 'B', 'C']);
    expect(chains[0]!.symbols).toEqual(['r1', 'r2']);
  });

  it('drops edges that touch a power net', () => {
    const chains = chainsOf(
      doc(`
        ${res('R1', 10, 10, 'r1')}
        (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
        (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
        (label "IN" (at 0 10 0) (uuid "la"))
        (symbol (lib_id "power:GND") (at 20 10 0) (unit 1) (uuid "up")
          (property "Reference" "#PWR01" (at 20 10 0))
          (property "Value" "GND" (at 20 10 0)))`),
    );
    expect(chains.length).toBe(0);
  });

  it('falls back to NetChain<n> when no member carries a label', () => {
    const chains = chainsOf(
      doc(`
        ${res('R1', 10, 10, 'r1')}
        (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
        (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
        (global_label "IN" (at 0 10 0) (shape input) (uuid "ga"))
        (global_label "OUT" (at 20 10 0) (shape output) (uuid "gb"))`),
    );
    // Global labels name nets but only SCH_LABEL_T names chains, like upstream.
    expect(chains.length).toBe(1);
    expect(chains[0]!.name).toBe('NetChain1');
  });

  it('ignores 2-pin symbols whose wires are not collinear', () => {
    const chains = chainsOf(
      doc(`
        ${res('R1', 10, 10, 'r1')}
        (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
        (wire (pts (xy 12.54 10) (xy 12.54 20)) (uuid "wb"))
        (label "A" (at 0 10 0) (uuid "la"))
        (label "B" (at 12.54 20 0) (uuid "lb"))`),
    );
    expect(chains.length).toBe(0);
  });
});
