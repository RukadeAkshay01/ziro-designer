/**
 * Drag connectivity (counterpart SCH_MOVE_TOOL::getConnectedDragItems +
 * SPECIAL_CASE_LABEL_INFO): no-connects join the drag, unselected junctions
 * isolate it behind a stub, sheet pins stub, and labels ride a moved wire's
 * body at the same parametric spot.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  addItems,
  makeWire,
  makeJunction,
  makeLabel,
  makeNoConnect,
  refId,
} from '@ziroeda/eeschema/src/tools/index.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const lineId = (sch: Schematic, i: number): string => refId('line', sch.lines[i]!.uuid, i);

describe('planMove drag connectivity', () => {
  it('an unselected no-connect at a moved point joins the drag', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      noConnects: [makeNoConnect(at(10, 0))],
    }).apply(EMPTY());
    const wire = lineId(sch, 0);
    const spec = planMove(sch, new Map(), new Set([wire]));
    const ncId = refId('noconnect', sch.noConnects[0]!.uuid, 0);
    expect(spec.fullIds.has(ncId)).toBe(true);
    const moved = moveWithConnections(spec, at(0, 5)).apply(sch);
    expect(moved.noConnects[0]!.at).toEqual(at(10, 5));
  });

  it('an unselected junction isolates the drag: neighbours stay, a stub bridges', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)), // selected
        makeWire(at(10, 0), at(20, 0)), // neighbour beyond the junction
        makeWire(at(10, 0), at(10, 10)), // neighbour beyond the junction
      ],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    expect(spec.wireStart.has(lineId(sch, 1))).toBe(false);
    expect(spec.wireStart.has(lineId(sch, 2))).toBe(false);
    expect(spec.newWires.length).toBe(1);
    expect(spec.newWires[0]!.fixed).toEqual(at(10, 0));
  });

  it('a mid-span label rides a stretching wire at the same parametric spot', () => {
    // W1 spans (0,0)-(20,0) with a label at its middle; dragging W2 pulls
    // W1's end, and the label slides to the new midpoint.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(20, 0), at(30, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 1)]));
    expect(spec.labelRides.length).toBe(1);
    expect(spec.labelRides[0]!.t).toBeCloseTo(0.5);
    const moved = moveWithConnections(spec, at(0, 10)).apply(sch);
    // W1 is now (0,0)-(20,10); t=0.5 puts the label at (10,5).
    expect(moved.labels[0]!.at).toEqual(at(10, 5));
  });

  it('a label on a fully-moved wire translates rigidly', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(5, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    const moved = moveWithConnections(spec, at(3, 7)).apply(sch);
    expect(moved.labels[0]!.at).toEqual(at(8, 7));
  });

  it('an unselected sheet pin at a moved point anchors a stub', () => {
    const base = addItems({ lines: [makeWire(at(10, 0), at(20, 0))] }).apply(EMPTY());
    const sch = {
      ...base,
      sheets: [
        {
          at: at(0, -5),
          size: { w: mmToIU(10), h: mmToIU(10) },
          fields: [],
          pins: [{ name: 'A', shape: 'input', at: at(10, 0), angle: 0 }],
          instances: [],
          source: base.source,
        },
      ],
    } as unknown as Schematic;
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    expect(spec.newWires.some((w) => w.fixed.x === at(10, 0).x && w.fixed.y === 0)).toBe(true);
  });
});
