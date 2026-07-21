/**
 * Connection-aware component move (counterpart eeschema/tools/
 * sch_move_tool.cpp getConnectedDragItems + orthoLineDrag): wires whose
 * endpoints sit on a moved symbol's pins follow the move — stretching in
 * free mode, gaining 90° bends in H/V mode.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  readSchematic,
  readSymbolLib,
  placeSymbol,
  planMove,
  orthoMove,
  moveWithConnections,
  refId,
} from '@ziroeda/eeschema';
import { readFileSync } from 'node:fs';

const EMPTY = `(kicad_sch (version 20250114) (generator "t") (uuid "00000000-0000-0000-0000-000000000001") (paper "A4"))`;

describe('move with connections', () => {
  it('drags wire endpoints that touch moved symbol pins', () => {
    const lib = readSymbolLib(
      parse(
        readFileSync('/home/user/ziro-designer/designer/public/symbols/Device.kicad_sym', 'utf8'),
      ),
    ).find((s) => s.libId === 'R')!;
    const libR = { ...lib, libId: 'Device:R' };
    let sch = readSchematic(parse(EMPTY));
    sch = placeSymbol(libR, { x: 100000, y: 100000 }).apply(sch);
    const sym = sch.symbols[0]!;
    const libById = new Map([['Device:R', libR]]);
    // R pins are at (0, -3.81mm) and (0, +3.81mm) locally → world y 100000∓38100.
    const pinTop = { x: 100000, y: 100000 - 38100 };
    // Wire ending exactly on the top pin.
    sch = {
      ...sch,
      lines: [
        {
          kind: 'wire',
          start: { x: 100000, y: 20000 },
          end: pinTop,
          source: sch.source,
          uuid: 'w1',
        } as any,
      ],
    };

    const ids = new Set([refId('symbol', sym.uuid, 0)]);
    const spec = planMove(sch, libById, ids);
    expect(spec.wireEnd.size + spec.wireStart.size).toBe(1);

    // Free-mode drag: the wire endpoint follows the symbol.
    const moved = moveWithConnections(spec, { x: 25400, y: 12700 }).apply(sch);
    expect(moved.lines[0]!.end).toEqual({ x: 125400, y: 100000 - 38100 + 12700 });
    expect(moved.lines[0]!.start).toEqual({ x: 100000, y: 20000 }); // fixed end stays

    // Ortho (H/V) drag: vertical wire slides in x and gains a horizontal bend.
    const ortho = orthoMove(sch, spec, { x: 25400, y: 12700 }).apply(sch);
    const touching = ortho.lines.filter(
      (l) =>
        (l.start.x === 125400 && l.start.y === 100000 - 38100 + 12700) ||
        (l.end.x === 125400 && l.end.y === 100000 - 38100 + 12700),
    );
    expect(touching.length).toBeGreaterThan(0); // something still connects to the moved pin
  });
});
