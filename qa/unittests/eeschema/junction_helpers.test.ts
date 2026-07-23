/**
 * Junction-point analysis (counterpart eeschema/junction_helpers.cpp
 * AnalyzePoint + SCH_SCREEN::IsExplicitJunction*): pins, buses, bus entries
 * and labels all count toward junction need, and cleanup no longer deletes
 * legitimate dots at bus tees or pin-on-wire points.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { addItems, makeWire, makeBus, makeJunction } from '@ziroeda/eeschema/src/tools/index.js';
import {
  analyzePoint,
  isExplicitJunction,
  isExplicitJunctionNeeded,
  isBusLabelText,
} from '@ziroeda/eeschema/src/tools/junction_helpers.js';
import { mergeColinearWires } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { finishWires } from '@ziroeda/eeschema/src/tools/sch_line_wire_bus_tool.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

// A one-pin symbol whose pin lands at (10, 0) mm: the R body sits at (10, 5)
// with a 5 mm pin pointing up (angle 90 in symbol space, Y-down file coords).
const PIN_SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "T:P1" (property "Reference" "U" (at 0 0 0))
      (symbol "P1_1_1"
        (pin passive line (at 0 5 90) (length 5)
          (name "1" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "T:P1") (at 10 5 0) (unit 1) (uuid "u-pin")
    (property "Reference" "U1" (at 10 5 0)))
)`;

describe('analyzePoint (JUNCTION_HELPERS::AnalyzePoint)', () => {
  it('three bus exits are a junction; two are not', () => {
    const tee = addItems({
      lines: [
        makeBus(at(0, 0), at(10, 0)),
        makeBus(at(10, 0), at(20, 0)),
        makeBus(at(10, 0), at(10, 10)),
      ],
    }).apply(EMPTY());
    expect(analyzePoint(tee, undefined, at(10, 0)).isJunction).toBe(true);
    const corner = addItems({
      lines: [makeBus(at(0, 0), at(10, 0)), makeBus(at(10, 0), at(10, 10))],
    }).apply(EMPTY());
    expect(analyzePoint(corner, undefined, at(10, 0)).isJunction).toBe(false);
  });

  it('stacked collinear wire ends are one exit direction, not a junction', () => {
    // Three wire ends meet at (10,0) but only two distinct directions leave it —
    // the old end-count rule called this a junction; AnalyzePoint does not.
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)),
        makeWire(at(10, 0), at(20, 0)),
        makeWire(at(10, 0), at(20, 0)),
      ],
    }).apply(EMPTY());
    expect(analyzePoint(sch, undefined, at(10, 0)).isJunction).toBe(false);
  });

  it('a pin landing on a wire interior makes a junction', () => {
    const doc = readSchematic(parse(PIN_SCH));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const sch = addItems({ lines: [makeWire(at(0, 0), at(20, 0))] }).apply(doc);
    expect(isExplicitJunctionNeeded(sch, libById, at(10, 0))).toBe(true);
    // Without the pin the same point is a plain pass-through.
    expect(isExplicitJunctionNeeded(sch, undefined, at(10, 0))).toBe(false);
  });

  it('a wire crossing without any endpoint is not a junction', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, -10), at(10, 10))],
    }).apply(EMPTY());
    expect(analyzePoint(sch, undefined, at(10, 0)).isJunction).toBe(false);
  });

  it('bus entries suppress the dot unless the root feeds several wires', () => {
    // A wire ENDING at the entry root: one wire + the entry = two wire exits,
    // one bus exit — no explicit junction (the entry itself is the joint).
    const base = addItems({ lines: [makeWire(at(0, 0), at(10, 0))] }).apply(EMPTY());
    const entry = {
      ...base,
      busEntries: [
        { at: at(10, 0), size: { x: mmToIU(2.54), y: mmToIU(-2.54) }, source: base.source },
      ],
    } as Schematic;
    const info = analyzePoint(entry, undefined, at(10, 0));
    expect(info.hasBusEntry).toBe(true);
    expect(info.hasBusEntryToMultipleWires).toBe(false);
    expect(isExplicitJunction(entry, undefined, at(10, 0))).toBe(false);
    // The root tapping the MIDDLE of a wire feeds both directions — that is
    // "bus entry to multiple wires" and the dot is legitimate.
    const tapped = {
      ...entry,
      lines: [makeWire(at(0, 0), at(20, 0))],
    } as Schematic;
    expect(analyzePoint(tapped, undefined, at(10, 0)).hasBusEntryToMultipleWires).toBe(true);
    expect(isExplicitJunction(tapped, undefined, at(10, 0))).toBe(true);
  });
});

describe('cleanup keeps legitimate junctions (SCH_SCREEN::IsExplicitJunction)', () => {
  it('a junction at a three-bus tee survives cleanup', () => {
    const sch = addItems({
      lines: [
        makeBus(at(0, 0), at(10, 0)),
        makeBus(at(10, 0), at(20, 0)),
        makeBus(at(10, 0), at(10, 10)),
      ],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const cleaned = mergeColinearWires(sch);
    expect(cleaned.junctions.length).toBe(1);
  });

  it('a junction where a pin meets mid-wire survives cleanup', () => {
    const doc = readSchematic(parse(PIN_SCH));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(doc);
    expect(mergeColinearWires(sch, libById).junctions.length).toBe(1);
    // The old wire-only rule (no libById) still deletes it — the fix needs pins.
    expect(mergeColinearWires(sch).junctions.length).toBe(0);
  });

  it('cleanup adds the missing dot at a bus tee', () => {
    const sch = addItems({
      lines: [
        makeBus(at(0, 0), at(10, 0)),
        makeBus(at(10, 0), at(20, 0)),
        makeBus(at(10, 0), at(10, 10)),
      ],
    }).apply(EMPTY());
    const cleaned = mergeColinearWires(sch);
    expect(cleaned.junctions.length).toBe(1);
    expect(cleaned.junctions[0]!.at).toEqual(at(10, 0));
  });
});

describe('finishWires junctions', () => {
  it('finishing a bus onto a bus tee adds a junction dot', () => {
    const sch = addItems({ lines: [makeBus(at(0, 0), at(20, 0))] }).apply(EMPTY());
    const cmd = finishWires(sch, new Map(), [{ a: at(10, 0), b: at(10, 10) }], 'bus');
    expect(cmd).not.toBeNull();
    const next = cmd!.apply(sch);
    expect(next.junctions.length).toBe(1);
    expect(next.junctions[0]!.at).toEqual(at(10, 0));
  });
});

describe('isBusLabelText (SCH_CONNECTION::IsBusLabel)', () => {
  it('recognises vector and group buses, rejects plain nets', () => {
    expect(isBusLabelText('DATA[7..0]')).toBe(true);
    expect(isBusLabelText('PWR{VCC GND}')).toBe(true);
    expect(isBusLabelText('{A B}')).toBe(true);
    expect(isBusLabelText('VCC')).toBe(false);
    expect(isBusLabelText('NET1')).toBe(false);
  });
});
