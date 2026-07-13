/**
 * ERC engine tests: pin-to-pin matrix, driver checks, unconnected pins,
 * no-connect flags, and label checks — against KiCad's documented behaviour
 * (erc.cpp, erc_settings.cpp, connection_graph.cpp).
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { makeNoConnect } from '@ziroeda/eeschema/src/tools/build.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** One-pin test symbol; the pin's connection point is the symbol position. */
function libDef(name: string, type: string, power = false): string {
  return `(symbol "T:${name}" ${power ? '(power) ' : ''}(pin_names (offset 0.254))
    (property "Reference" "${power ? '#PWR' : 'U'}" (at 0 0 0))
    (property "Value" "${name}" (at 0 0 0))
    (symbol "${name}_1_1"
      (pin ${type} line (at 0 0 0) (length 2.54)
        (name "P" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))`;
}

function place(libName: string, ref: string, x: number, y: number, uuid: string): string {
  return `(symbol (lib_id "T:${libName}") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "${libName}" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;
}

const LIBS =
  ['IN input', 'OUT output', 'PAS passive', 'PWRIN power_in', 'NC no_connect']
    .map((s) => {
      const [n, t] = s.split(' ');
      return libDef(n!, t!);
    })
    .join('\n') +
  libDef('GND', 'power_in', true) +
  libDef('VOUT', 'power_out', true);

function sch(body: string) {
  const text = `(kicad_sch (version 20230121) (generator eeschema)
    (lib_symbols ${LIBS})
    ${body})`;
  const doc = readSchematic(parse(text));
  return { doc, libById: new Map(doc.libSymbols.map((l) => [l.libId, l])) };
}

const wire = (x1: number, y1: number, x2: number, y2: number, id: string): string =>
  `(wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (uuid "${id}"))`;

const codes = (v: { code: string }[]): string[] => v.map((x) => x.code);

describe('runErc', () => {
  it('flags two connected outputs as a pin-to-pin error (matrix O x O = ERR)', () => {
    const { doc, libById } = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('OUT', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    const v = runErc(doc, libById);
    expect(codes(v)).toContain('pin_to_pin_error');
    const err = v.find((x) => x.code === 'pin_to_pin_error')!;
    expect(err.message).toBe('Pins of type Output and Output are connected');
    expect(err.severity).toBe('error');
  });

  it('output driving an input is clean; two inputs alone are not driven', () => {
    const ok = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(runErc(ok.doc, ok.libById)).toEqual([]);

    const bad = sch(`
      ${place('IN', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(bad.doc, bad.libById))).toContain('pin_not_driven');
  });

  it('a power net needs a power-output driver, not just any output', () => {
    // power_in driven by a plain output: matrix says OK pair, but the power net
    // is not driven (only PT_POWER_OUT drives power nets — DrivingPowerPinTypes).
    const bad = sch(`
      ${place('PWRIN', 'U1', 10, 10, 'u1')} ${place('OUT', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(bad.doc, bad.libById))).toContain('power_pin_not_driven');

    const ok = sch(`
      ${place('PWRIN', 'U1', 10, 10, 'u1')} ${place('VOUT', '#PWR01', 20, 10, 'p1')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(ok.doc, ok.libById))).not.toContain('power_pin_not_driven');
  });

  it('flags an unconnected pin, unless a no-connect flag covers it', () => {
    const bare = sch(place('IN', 'U1', 10, 10, 'u1'));
    const v = runErc(bare.doc, bare.libById);
    expect(codes(v)).toContain('pin_not_connected');
    expect(v.find((x) => x.code === 'pin_not_connected')!.severity).toBe('error');
    // Note: the lone input pin's net has no driver either, but KiCad suppresses
    // nothing here — yet with no wires there is no *net* needing a driver check;
    // the pin subgraph is single-pin so only the unconnected error is expected.

    const covered = sch(`${place('IN', 'U1', 10, 10, 'u1')} (no_connect (at 10 10) (uuid "nc1"))`);
    expect(codes(runErc(covered.doc, covered.libById))).not.toContain('pin_not_connected');
  });

  it('reports a dangling no-connect and a connected no-connect', () => {
    const dangling = sch('(no_connect (at 50 50) (uuid "nc1"))');
    expect(codes(runErc(dangling.doc, dangling.libById))).toContain('no_connect_dangling');

    const connected = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')} (no_connect (at 20 10) (uuid "nc1"))`);
    expect(codes(runErc(connected.doc, connected.libById))).toContain('no_connect_connected');
  });

  it('flags an NC-type pin that is wired to anything (TestNoConnectPins)', () => {
    const { doc, libById } = sch(`
      ${place('NC', 'U1', 10, 10, 'u1')} ${wire(10, 10, 20, 10, 'w1')}`);
    const v = runErc(doc, libById);
    expect(codes(v)).toContain('no_connect_connected');
  });

  it('label checks: not connected (error) and single-pin (warning)', () => {
    const floating = sch(`${wire(10, 10, 20, 10, 'w1')} (label "N1" (at 10 10 0) (uuid "l1"))`);
    const v1 = runErc(floating.doc, floating.libById);
    expect(codes(v1)).toContain('label_not_connected');
    expect(v1.find((x) => x.code === 'label_not_connected')!.severity).toBe('error');

    const onePin = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${wire(10, 10, 20, 10, 'w1')}
      (label "N1" (at 20 10 0) (uuid "l1"))`);
    const v2 = runErc(onePin.doc, onePin.libById);
    expect(codes(v2)).toContain('label_single_pin');
    expect(v2.find((x) => x.code === 'label_single_pin')!.severity).toBe('warning');
  });

  it('stacked pins of one symbol are exempt from conflicts', () => {
    // Two outputs joined across two symbols errors (above); the same two pin
    // types stacked at one point of one symbol must not.
    const twoPin = `(symbol "T:DBL" (pin_names (offset 0.254))
      (property "Reference" "U" (at 0 0 0)) (property "Value" "DBL" (at 0 0 0))
      (symbol "DBL_1_1"
        (pin output line (at 0 0 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin output line (at 0 0 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))`;
    const text = `(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols ${twoPin})
      (symbol (lib_id "T:DBL") (at 10 10 0) (unit 1)
        (property "Reference" "U1" (at 10 10 0)) (property "Value" "DBL" (at 10 10 0)) (uuid "u1"))
      ${wire(10, 10, 20, 10, 'w1')} ${wire(20, 10, 20, 20, 'w2')}`;
    const doc = readSchematic(parse(`${text})`));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    expect(codes(runErc(doc, libById))).not.toContain('pin_to_pin_error');
  });
});

describe('no_connect model round-trip', () => {
  it('parses, moves through edits, and serializes (no_connect (at ..))', () => {
    const { doc } = sch(place('IN', 'U1', 10, 10, 'u1'));
    const next = addItems({ noConnects: [makeNoConnect({ x: mmToIU(10), y: mmToIU(10) })] }).apply(
      doc,
    );
    const text = serialize(writeSchematic(next));
    expect(text).toContain('(no_connect');
    expect(text).toContain('(at 10 10)');
    const re = readSchematic(parse(text));
    expect(re.noConnects.length).toBe(1);
    expect(re.noConnects[0]!.at).toEqual({ x: mmToIU(10), y: mmToIU(10) });
  });
});
