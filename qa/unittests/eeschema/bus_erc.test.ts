/**
 * Bus ERC rules (CONNECTION_GRAPH::ercCheckBus*): net-not-bus-member taps,
 * direct wire-to-bus contact, bus labels on wires, and bus-to-bus port
 * mismatches — each honouring the Violation Severity settings.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { defaultErcSettings } from '@ziroeda/eeschema/src/erc/erc_settings.js';

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${body})`));

const TAP = (busLabel: string, tapLabel: string) => `
  (bus (pts (xy 0 0) (xy 60 0)) (uuid "b1"))
  (label "${busLabel}" (at 30 0 0) (uuid "bl"))
  (bus_entry (at 10 0) (size 2.54 2.54) (uuid "e1"))
  (wire (pts (xy 12.54 2.54) (xy 12.54 10)) (uuid "w1"))
  (label "${tapLabel}" (at 12.54 10 0) (uuid "l1"))`;

describe('bus ERC', () => {
  it('flags a tap whose net is not a bus member (warning, at the entry)', () => {
    const v = runErc(doc(TAP('D[0..3]', 'CLK')), new Map(), defaultErcSettings());
    const hit = v.find((x) => x.code === 'net_not_bus_member');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('warning');
    expect(hit!.message).toContain('CLK');
    expect(hit!.message).toContain('D[0..3]');
    expect(hit!.at).toEqual({ x: 100000, y: 0 }); // the entry position
  });

  it('stays silent for member taps and honours ignore', () => {
    expect(
      runErc(doc(TAP('D[0..3]', 'D2')), new Map(), defaultErcSettings()).some(
        (x) => x.code === 'net_not_bus_member',
      ),
    ).toBe(false);
    const s = defaultErcSettings();
    s.severities.net_not_bus_member = 'ignore';
    expect(
      runErc(doc(TAP('D[0..3]', 'CLK')), new Map(), s).some((x) => x.code === 'net_not_bus_member'),
    ).toBe(false);
  });

  it('flags a wire endpoint sitting directly on a bus (error)', () => {
    const v = runErc(
      doc(`
        (bus (pts (xy 0 0) (xy 60 0)) (uuid "b1"))
        (wire (pts (xy 30 0) (xy 30 10)) (uuid "w1"))`),
      new Map(),
      defaultErcSettings(),
    );
    const hit = v.find((x) => x.code === 'bus_to_net_conflict');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    expect(hit!.at).toEqual({ x: 300000, y: 0 });
  });

  it('flags a bus-syntax label driving a wire net', () => {
    const v = runErc(
      doc(`
        (wire (pts (xy 0 0) (xy 20 0)) (uuid "w1"))
        (label "D[0..3]" (at 20 0 0) (uuid "l1"))`),
      new Map(),
      defaultErcSettings(),
    );
    expect(v.some((x) => x.code === 'bus_to_net_conflict')).toBe(true);
  });

  it('flags a bus label vs hier port sharing no members; silent when they overlap', () => {
    const PAIR = (portLabel: string) => `
      (bus (pts (xy 0 0) (xy 60 0)) (uuid "b1"))
      (label "A[0..3]" (at 20 0 0) (uuid "bl"))
      (hierarchical_label "${portLabel}" (at 40 0 0) (shape input) (uuid "hl"))`;
    const bad = runErc(doc(PAIR('B[0..3]')), new Map(), defaultErcSettings());
    expect(bad.some((x) => x.code === 'bus_to_bus_conflict')).toBe(true);
    const ok = runErc(doc(PAIR('A[2..5]')), new Map(), defaultErcSettings());
    expect(ok.some((x) => x.code === 'bus_to_bus_conflict')).toBe(false);
  });
});
