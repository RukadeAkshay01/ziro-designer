import { describe, it, expect } from 'vitest';
import { parse } from '../src/sexpr/index.js';
import { readSchematic } from '../src/model/read-schematic.js';
import { addItems, makeWire, makeBus, makeJunction } from '../src/edit/index.js';
import { mergeColinearWires, withCleanup } from '../src/edit/cleanup.js';
import { History } from '../src/edit/command.js';
import { mmToIU } from '../src/units.js';
import type { Schematic } from '../src/model/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

describe('mergeColinearWires (KiCad SchematicCleanUp / MergeOverlap)', () => {
  it('merges two colinear touching wires into one', () => {
    let sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))] }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(20)]);
  });

  it('merges overlapping colinear wires', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(15, 0)), makeWire(at(10, 0), at(25, 0))] }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(25)]);
  });

  it('removes a non-explicit junction on two collinear wires and merges them (KiCad CleanUp)', () => {
    // KiCad AnalyzePoint: two collinear wires have only 2 exit angles, so the point
    // is not an explicit junction -> CleanUp deletes the dot and merges the wires.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    expect(merged.junctions.length).toBe(0);
  });

  it('adds a junction where a wire tees in, keeping the through-wire whole', () => {
    // A vertical wire ending on the middle of a horizontal wire: KiCad keeps the
    // horizontal wire as one segment and just adds a junction dot at the tee.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, 0), at(10, 10))],
    }).apply(EMPTY());
    const out = mergeColinearWires(sch);
    expect(out.lines.length).toBe(2); // through-wire stays whole
    expect(out.junctions.some((j) => j.at.x === mmToIU(10) && j.at.y === 0)).toBe(true);
  });

  it('does NOT merge perpendicular wires meeting at a corner', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(10, 10))] }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(2);
  });

  it('does NOT merge a wire and a bus that are colinear (different layers)', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0)), makeBus(at(10, 0), at(20, 0))] }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(2);
  });

  it('removes an exact duplicate wire', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(0, 0))] }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
  });

  it('withCleanup merges as part of the edit and undo restores the pre-merge state', () => {
    const base = EMPTY();
    const history = new History();
    // Add a wire that is colinear-touching an existing one; cleanup should merge them.
    const withFirst = history.execute(base, withCleanup(addItems({ lines: [makeWire(at(0, 0), at(10, 0))] })));
    expect(withFirst.lines.length).toBe(1);
    const merged = history.execute(withFirst, withCleanup(addItems({ lines: [makeWire(at(10, 0), at(20, 0))] })));
    expect(merged.lines.length).toBe(1); // merged into a single wire
    // Undo the second edit: back to the single original wire (0..10), not the merged span.
    const undone = history.undo(merged)!;
    expect(undone.lines.length).toBe(1);
    const l = undone.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(10)]);
    // Redo restores the merged wire.
    const redone = history.redo(undone)!;
    expect(redone.lines.length).toBe(1);
    const rxs = [redone.lines[0]!.start.x, redone.lines[0]!.end.x].sort((a, b) => a - b);
    expect(rxs).toEqual([mmToIU(0), mmToIU(20)]);
  });

  it('collapses a chain of three colinear segments', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0)), makeWire(at(20, 0), at(30, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(30)]);
  });
});
