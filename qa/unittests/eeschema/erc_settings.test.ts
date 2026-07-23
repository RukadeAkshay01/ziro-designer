/**
 * ERC settings (Schematic Setup → Electrical Rules): the Violation Severity and
 * Pin Conflicts Map panels feed runErc. Overriding a rule's severity or a
 * matrix cell must change the reported violations.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { defaultErcSettings, typeIndex } from '@ziroeda/eeschema/src/erc/erc_settings.js';

function libDef(name: string, type: string): string {
  return `(symbol "T:${name}" (pin_names (offset 0.254))
    (property "Reference" "U" (at 0 0 0))
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
function sch(body: string) {
  const text = `(kicad_sch (version 20230121) (generator eeschema)
    (lib_symbols ${libDef('OUT', 'output')})
    ${body})`;
  const doc = readSchematic(parse(text));
  return { doc, libById: new Map(doc.libSymbols.map((l) => [l.libId, l])) };
}
// Two outputs on one wire — O×O is an error in the default matrix.
const TWO_OUTPUTS = `
  ${place('OUT', 'U1', 10, 10, 'u1')} ${place('OUT', 'U2', 20, 10, 'u2')}
  (wire (pts (xy 10 10) (xy 20 10)) (uuid "w1"))`;

describe('ERC settings drive runErc', () => {
  it('default settings report the output-output conflict as an error', () => {
    const { doc, libById } = sch(TWO_OUTPUTS);
    const v = runErc(doc, libById, defaultErcSettings());
    const conflict = v.find((x) => x.code === 'pin_to_pin_error');
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe('error');
  });

  it('setting the rule to "ignore" drops the violation', () => {
    const { doc, libById } = sch(TWO_OUTPUTS);
    const s = defaultErcSettings();
    s.severities.pin_to_pin_error = 'ignore';
    const v = runErc(doc, libById, s);
    expect(v.some((x) => x.code === 'pin_to_pin_error')).toBe(false);
  });

  it('setting the rule to "warning" changes the reported severity', () => {
    const { doc, libById } = sch(TWO_OUTPUTS);
    const s = defaultErcSettings();
    s.severities.pin_to_pin_error = 'warning';
    const v = runErc(doc, libById, s);
    expect(v.find((x) => x.code === 'pin_to_pin_error')?.severity).toBe('warning');
  });

  it('editing the pin-conflict matrix to OK removes the conflict', () => {
    const { doc, libById } = sch(TWO_OUTPUTS);
    const s = defaultErcSettings();
    const o = typeIndex('output');
    s.pinMap[o]![o] = 0; // OK
    const v = runErc(doc, libById, s);
    expect(v.some((x) => x.code === 'pin_to_pin_error')).toBe(false);
  });
});

// ERC_TESTER::TestOffGridEndpoints: the Formatting page's connection grid
// (m_ConnectionGridSize) flags wire ends and symbol pins off that grid.
describe('off-grid endpoint test (connection grid)', () => {
  const GRID = { connectionGridIU: 12700 }; // 50 mil, the KiCad default

  it('stays silent when everything sits on the grid', () => {
    const { doc, libById } = sch(`
      ${place('OUT', 'U1', 2.54, 2.54, 'u1')}
      (wire (pts (xy 2.54 2.54) (xy 5.08 2.54)) (uuid "w1"))`);
    const v = runErc(doc, libById, defaultErcSettings(), GRID);
    expect(v.some((x) => x.code === 'endpoint_off_grid')).toBe(false);
  });

  it('flags an off-grid wire end once (start wins over end, like upstream)', () => {
    const { doc, libById } = sch(`(wire (pts (xy 3 2.54) (xy 6 2.54)) (uuid "w1"))`);
    const v = runErc(doc, libById, defaultErcSettings(), GRID);
    const hits = v.filter((x) => x.code === 'endpoint_off_grid');
    expect(hits.length).toBe(1);
    expect(hits[0]!.severity).toBe('warning'); // KiCad's default for this rule
    expect(hits[0]!.at).toEqual({ x: 30000, y: 25400 }); // the start point
  });

  it('flags one marker per symbol with off-grid pins', () => {
    const { doc, libById } = sch(`${place('OUT', 'U1', 3.1, 2.54, 'u1')}`);
    const v = runErc(doc, libById, defaultErcSettings(), GRID);
    expect(v.filter((x) => x.code === 'endpoint_off_grid').length).toBe(1);
  });

  it('is disabled without a connection grid, and respects "ignore"', () => {
    const { doc, libById } = sch(`(wire (pts (xy 3 2.54) (xy 6 2.54)) (uuid "w1"))`);
    expect(
      runErc(doc, libById, defaultErcSettings()).some((x) => x.code === 'endpoint_off_grid'),
    ).toBe(false);
    const s = defaultErcSettings();
    s.severities.endpoint_off_grid = 'ignore';
    expect(runErc(doc, libById, s, GRID).some((x) => x.code === 'endpoint_off_grid')).toBe(false);
  });
});
