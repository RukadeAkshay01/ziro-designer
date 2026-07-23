/**
 * Ambiguous-click collection (counterpart SCH_SELECTION_TOOL::
 * GuessSelectionCandidates + GetItemDescription): exact hits beat sloppy
 * ones, the tight-box trim drops items with clickable area elsewhere, and
 * genuinely-overlapping items surface for the Clarify Selection menu.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { addItems, makeWire, makeJunction, makeLabel } from '@ziroeda/eeschema/src/tools/index.js';
import { collectAndGuess, describeItem } from '@ziroeda/eeschema/src/tools/sch_collectors.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const ACC = mmToIU(0.5);
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

describe('collectAndGuess', () => {
  it('a lone wire resolves to a single candidate', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(20, 0))] }).apply(EMPTY());
    const cands = collectAndGuess(sch, new Map(), at(10, 0.1), ACC);
    expect(cands.length).toBe(1);
    expect(cands[0]!.kind).toBe('line');
  });

  it('an exact junction hit wins instantly over the wires under it', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(20, 0)),
        makeWire(at(10, 0), at(10, 10)),
        makeWire(at(10, 0), at(20, 5)),
      ],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const cands = collectAndGuess(sch, new Map(), at(10, 0), ACC);
    expect(cands[0]!.kind).toBe('junction');
  });

  it('a plain crossing resolves to one wire (the other has area elsewhere)', () => {
    // The tight box around the closest wire excludes the crossing wire —
    // it has plenty of clickable area elsewhere (upstream drops it too).
    const crossing = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, -10), at(10, 10))],
    }).apply(EMPTY());
    expect(collectAndGuess(crossing, new Map(), at(10, 0), ACC).length).toBe(1);
  });

  it("a small item inside the closest item's tight box stays ambiguous", () => {
    // A no-connect flag sitting inside a text box: clicking between the two
    // centres hits both exactly, the text box wins the distance race, and the
    // flag survives the tight-box trim — Clarify menu with 2 rows.
    const base = EMPTY();
    const sch = {
      ...base,
      textBoxes: [
        { start: at(0, 0), end: at(60, 40), angle: 0, text: 'note', source: base.source },
      ],
      noConnects: [{ at: at(30.4, 20), source: base.source }],
    } as Schematic;
    const cands = collectAndGuess(sch, new Map(), at(30.1, 20), ACC);
    expect(cands.length).toBe(2);
    expect(new Set(cands.map((c) => c.kind))).toEqual(new Set(['textbox', 'noconnect']));
  });

  it('describes items with KiCad wording', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NETX', at(0, 0))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    // (12, 0.1) is past the junction dot's radius, so the wire wins there.
    const wireRef = collectAndGuess(sch, new Map(), at(12, 0.1), ACC)[0]!;
    expect(describeItem(sch, new Map(), wireRef)).toBe('Horizontal Wire, length 20.00 mm');
    const jRef = collectAndGuess(sch, new Map(), at(10, 0), ACC)[0]!;
    expect(describeItem(sch, new Map(), jRef)).toBe('Junction');
    const labelRef = collectAndGuess(sch, new Map(), at(0, -1), ACC)[0]!;
    expect(describeItem(sch, new Map(), labelRef)).toBe("Label 'NETX'");
  });
});
