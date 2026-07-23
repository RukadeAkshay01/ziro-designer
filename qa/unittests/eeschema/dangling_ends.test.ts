/**
 * Wire-end / label dangling squares (counterpart SCH_LINE::UpdateDanglingState
 * + SCH_LABEL_BASE::UpdateDanglingState, drawn by drawDanglingIndicator):
 * a wire tip is marked when nothing connectable sits on it — rotating a symbol
 * away marks the freed wire ends, rotating it back clears them.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  addItems,
  makeWire,
  makeBus,
  makeJunction,
  makeLabel,
  makeNoConnect,
  refId,
  transformItems,
} from '@ziroeda/eeschema/src/tools/index.js';
import {
  danglingWireEnds,
  danglingLabelAnchors,
} from '@ziroeda/eeschema/src/connectivity/dangling.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

// One-pin part whose pin tip lands at (10, 0) when placed at (10, 5).
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

describe('danglingWireEnds', () => {
  it('marks free tips, not connected ones', () => {
    // Two wires joined end-to-end at (10,0): outer tips dangle, joint does not.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
    }).apply(EMPTY());
    const ends = danglingWireEnds(sch, new Map());
    expect(ends.map((e) => e.pos)).toEqual(expect.arrayContaining([at(0, 0), at(20, 0)]));
    expect(ends.length).toBe(2);
  });

  it('junctions, labels, no-connects and pins connect a tip; buses do not', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)), // end on junction
        makeWire(at(0, 10), at(10, 10)), // end on label
        makeWire(at(0, 20), at(10, 20)), // end on no-connect
        makeWire(at(0, 30), at(10, 30)), // end on a BUS end -> still dangling
        makeBus(at(10, 30), at(20, 30)),
      ],
      junctions: [makeJunction(at(10, 0))],
      labels: [makeLabel('label', 'N', at(10, 10), 0)],
      noConnects: [makeNoConnect(at(10, 20))],
    }).apply(EMPTY());
    const marked = danglingWireEnds(sch, new Map()).map((e) => `${e.pos.x},${e.pos.y}`);
    expect(marked).not.toContain(`${at(10, 0).x},${at(10, 0).y}`);
    expect(marked).not.toContain(`${at(10, 10).x},${at(10, 10).y}`);
    expect(marked).not.toContain(`${at(10, 20).x},${at(10, 20).y}`);
    expect(marked).toContain(`${at(10, 30).x},${at(10, 30).y}`);
  });

  it('rotating a symbol away marks the freed wire end; rotating back clears it', () => {
    const doc = readSchematic(parse(PIN_SCH));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0))] }).apply(doc);
    const symId = refId('symbol', 'u-pin', 0);

    // Connected: the pin tip sits on the wire end at (10,0).
    expect(danglingWireEnds(sch, libById).map((e) => e.pos)).toEqual([at(0, 0)]);

    // Rotate the symbol: the pin swings away, the wire tip at (10,0) dangles.
    const rotated = transformItems(new Set([symId]), 'rotateCCW').apply(sch);
    expect(danglingWireEnds(rotated, libById).map((e) => e.pos)).toEqual(
      expect.arrayContaining([at(0, 0), at(10, 0)]),
    );

    // Three more quarter turns bring it home: the square vanishes again.
    let back = rotated;
    for (let i = 0; i < 3; i++) back = transformItems(new Set([symId]), 'rotateCCW').apply(back);
    expect(danglingWireEnds(back, libById).map((e) => e.pos)).toEqual([at(0, 0)]);
  });
});

describe('danglingLabelAnchors', () => {
  it('a label mid-wire or at a tip is connected; a floating one is not', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [
        makeLabel('label', 'MID', at(10, 0), 0),
        makeLabel('label', 'TIP', at(20, 0), 0),
        makeLabel('global_label', 'FLOAT', at(40, 40), 0),
      ],
    }).apply(EMPTY());
    const marked = danglingLabelAnchors(sch, new Map());
    expect(marked.length).toBe(1);
    expect(marked[0]!.pos).toEqual(at(40, 40));
    expect(marked[0]!.kind).toBe('global_label');
  });
});
