/**
 * Bus label parsing/expansion (NET_SETTINGS::ParseBusVector/ParseBusGroup +
 * SCH_CONNECTION::ConfigureFromLabel): vector ranges, group members, alias
 * resolution, formatting-marker rules and the invalid forms.
 */
import { describe, expect, it } from 'vitest';
import {
  expandBusLabel,
  isBusLabel,
  parseBusGroup,
  parseBusVector,
} from '@ziroeda/eeschema/src/connectivity/bus.js';

describe('parseBusVector', () => {
  it('expands a basic range', () => {
    expect(parseBusVector('D[0..3]')).toEqual({
      name: 'D',
      members: ['D0', 'D1', 'D2', 'D3'],
    });
  });

  it('swaps reversed bounds and rejects equal bounds', () => {
    expect(parseBusVector('A[3..1]')?.members).toEqual(['A1', 'A2', 'A3']);
    expect(parseBusVector('A[2..2]')).toBeNull();
  });

  it('keeps polarity suffixes', () => {
    expect(parseBusVector('LVDS[0..1]P')?.members).toEqual(['LVDS0P', 'LVDS1P']);
  });

  it('strips a subscript that decorates the range (D_{[1..2]})', () => {
    expect(parseBusVector('D_{[1..2]}')?.members).toEqual(['D1', 'D2']);
  });

  it('keeps a marker that wraps the name (~{BE[0..2]})', () => {
    expect(parseBusVector('~{BE[0..2]}')?.members).toEqual(['~{BE0}', '~{BE1}', '~{BE2}']);
  });

  it('rejects non-vector forms', () => {
    expect(parseBusVector('PLAIN')).toBeNull();
    expect(parseBusVector('D[0..]')).toBeNull();
    expect(parseBusVector('D[a..2]')).toBeNull();
    expect(parseBusVector('D [0..2]')).toBeNull();
    expect(parseBusVector('{A B}')).toBeNull();
  });
});

describe('parseBusGroup', () => {
  it('parses unnamed and named groups with space/comma separators', () => {
    expect(parseBusGroup('{A B, C}')).toEqual({ name: '', members: ['A', 'B', 'C'] });
    expect(parseBusGroup('USB{DP DM}')).toEqual({ name: 'USB', members: ['DP', 'DM'] });
  });

  it('keeps formatting markers in member names (~{CAS} is not CAS)', () => {
    expect(parseBusGroup('{RAS ~{CAS}}')?.members).toEqual(['RAS', '~{CAS}']);
  });

  it('rejects non-group forms', () => {
    expect(parseBusGroup('PLAIN')).toBeNull();
    expect(parseBusGroup('{A B')).toBeNull();
    expect(parseBusGroup('BAD NAME{A}')).toBeNull();
  });
});

describe('expandBusLabel', () => {
  const aliases = new Map<string, readonly string[]>([
    ['USB', ['DP', 'DM']],
    ['MEM', ['D[0..1]', 'WE']],
  ]);

  it('returns null for plain net labels', () => {
    expect(expandBusLabel('CLK')).toBeNull();
  });

  it('prefixes named-group members with NAME.', () => {
    expect(expandBusLabel('PWR{VCC GND}')?.members).toEqual(['PWR.VCC', 'PWR.GND']);
  });

  it('expands nested vectors inside groups', () => {
    expect(expandBusLabel('{D[0..2] EN}')?.members).toEqual(['D0', 'D1', 'D2', 'EN']);
  });

  it('resolves aliases, including alias members that are vectors', () => {
    expect(expandBusLabel('{USB}', aliases)?.members).toEqual(['DP', 'DM']);
    expect(expandBusLabel('CON{MEM}', aliases)?.members).toEqual(['CON.D0', 'CON.D1', 'CON.WE']);
  });

  it('survives alias cycles via the depth cap', () => {
    const cyclic = new Map<string, readonly string[]>([['A', ['{A}']]]);
    // Must terminate; the innermost unresolved token stays verbatim.
    expect(expandBusLabel('{A}', cyclic)).not.toBeNull();
  });
});

describe('isBusLabel', () => {
  it('classifies vectors and groups, not plain nets', () => {
    expect(isBusLabel('D[0..7]')).toBe(true);
    expect(isBusLabel('{A B}')).toBe(true);
    expect(isBusLabel('DATA')).toBe(false);
  });
});
