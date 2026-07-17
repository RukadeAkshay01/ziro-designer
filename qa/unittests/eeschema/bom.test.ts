/**
 * BOM export (Symbol Fields Table export, Tools > Generate Bill of Materials):
 * symbols group by Value+Footprint, power symbols and not-in-BOM parts drop
 * out, references natural-sort, multi-unit parts count once, and the CSV
 * quotes per RFC 4180.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { buildBom, bomToCsv, compareRefs } from '@ziroeda/eeschema/src/exporters/bom.js';

const sym = (
  ref: string,
  value: string,
  fp: string,
  uuid: string,
  extra = '',
): string => `(symbol (lib_id "Device:R") (at 0 0 0) (unit 1) ${extra} (uuid "${uuid}")
  (property "Reference" "${ref}" (at 0 0 0))
  (property "Value" "${value}" (at 0 0 0))
  (property "Footprint" "${fp}" (at 0 0 0)))`;

const load = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

describe('BOM export', () => {
  it('groups equal Value+Footprint and naturally sorts references', () => {
    const doc = load(`
      ${sym('R10', '10k', 'R_0603', 'a')}
      ${sym('R2', '10k', 'R_0603', 'b')}
      ${sym('R1', '10k', 'R_0805', 'c')}
      ${sym('C1', '100n', 'C_0603', 'd')}`);
    const rows = buildBom([doc]);
    expect(rows).toHaveLength(3);
    const tenK = rows.find((r) => r.refs.startsWith('R2'));
    expect(tenK?.refs).toBe('R2,R10'); // natural order, not lexicographic
    expect(tenK?.qty).toBe(2);
  });

  it('drops power symbols and not-in-BOM parts; DNP is opt-in', () => {
    const doc = load(`
      ${sym('#PWR01', 'GND', '', 'p')}
      ${sym('R1', '1k', 'R_0603', 'a', '(in_bom no)')}
      ${sym('R2', '1k', 'R_0603', 'b', '(dnp yes)')}
      ${sym('R3', '1k', 'R_0603', 'c')}`);
    expect(buildBom([doc]).map((r) => r.refs)).toEqual(['R3']);
    const withDnp = buildBom([doc], { groupBy: ['Value', 'Footprint'], includeDNP: true });
    // DNP parts stay a separate row from populated ones of the same value.
    expect(withDnp.map((r) => [r.refs, r.dnp])).toEqual([
      ['R2', true],
      ['R3', false],
    ]);
  });

  it('counts a multi-unit symbol (shared reference) once', () => {
    const doc = load(`
      ${sym('U1', 'LM324', 'SOIC-14', 'u1a')}
      ${sym('U1', 'LM324', 'SOIC-14', 'u1b')}`);
    const rows = buildBom([doc]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(1);
  });

  it('serializes CSV with quoting', () => {
    const doc = load(sym('R1', '1k, 1%', 'R_0603', 'a'));
    const csv = bomToCsv(buildBom([doc]), ['Reference', 'Value', 'Qty']);
    expect(csv).toBe('Reference,Value,Qty\nR1,"1k, 1%",1\n');
  });

  it('compareRefs orders prefixes then numbers', () => {
    expect(['R10', 'C2', 'R2', 'C10'].sort(compareRefs)).toEqual(['C2', 'C10', 'R2', 'R10']);
  });
});
