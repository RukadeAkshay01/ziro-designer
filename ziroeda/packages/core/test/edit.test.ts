import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/sexpr/index.js';
import { readSchematic } from '../src/model/index.js';
import { mmToIU } from '../src/units.js';
import { hitTest } from '../src/edit/hittest.js';
import { History } from '../src/edit/command.js';
import { moveItems, moveWithConnections } from '../src/edit/move.js';
import { planMove, symbolPinPositions } from '../src/edit/connect.js';
import { symbolBodyBBox } from '../src/edit/bbox.js';
import type { LibSymbol, Schematic } from '../src/model/types.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const load = (): { sch: Schematic; libById: Map<string, LibSymbol> } => {
  const sch = readSchematic(parse(fixture('nfc-antenna.kicad_sch')));
  const libById = new Map(sch.libSymbols.map((l) => [l.libId, l]));
  return { sch, libById };
};

describe('hitTest', () => {
  const { sch, libById } = load();
  const acc = mmToIU(0.3);

  it('selects the symbol when clicking inside its body', () => {
    // The connector body spans roughly x in [-1.27, 1.27] mm about (156.21, 111.76).
    const hit = hitTest(sch, libById, { x: mmToIU(156.21), y: mmToIU(111.76) }, acc);
    expect(hit?.kind).toBe('symbol');
  });

  it('selects the wire when clicking along it', () => {
    // Wire runs vertically at x=161.29 between y=109.22 and 111.76.
    const hit = hitTest(sch, libById, { x: mmToIU(161.29), y: mmToIU(110.5) }, acc);
    expect(hit?.kind).toBe('line');
  });

  it('selects the label near its anchor', () => {
    const hit = hitTest(sch, libById, { x: mmToIU(161.6), y: mmToIU(109.0) }, acc);
    expect(hit?.kind).toBe('label');
  });

  it('returns null when clicking empty space', () => {
    expect(hitTest(sch, libById, { x: mmToIU(50), y: mmToIU(50) }, acc)).toBeNull();
  });
});

describe('symbolBodyBBox', () => {
  it('covers the connector body extent', () => {
    const { sch, libById } = load();
    const box = symbolBodyBBox(sch.symbols[0]!, libById.get(sch.symbols[0]!.libId));
    // Pin 1 connection point is at world (161.29, 111.76); the box must reach it.
    expect(box.maxX).toBeGreaterThanOrEqual(mmToIU(161.29) - 1);
    expect(box.minY).toBeLessThanOrEqual(mmToIU(111.76));
  });
});

describe('move command + history (undo/redo)', () => {
  it('moves the symbol and its fields, then undoes exactly', () => {
    const { sch } = load();
    const history = new History();
    const ids = new Set(['d5224ac6-3b29-4f27-99e0-c4e878a39680']); // J1 uuid

    const before = sch.symbols[0]!;
    const delta = { x: mmToIU(2.54), y: mmToIU(-1.27) };
    const moved = history.execute(sch, moveItems(ids, delta));

    expect(moved.symbols[0]!.at).toEqual({ x: before.at.x + delta.x, y: before.at.y + delta.y });
    // A field moved with the symbol.
    const refBefore = before.fields.find((f) => f.key === 'Reference')!;
    const refAfter = moved.symbols[0]!.fields.find((f) => f.key === 'Reference')!;
    expect(refAfter.at).toEqual({ x: refBefore.at!.x + delta.x, y: refBefore.at!.y + delta.y });

    // Undo restores the original position exactly.
    const undone = history.undo(moved)!;
    expect(undone.symbols[0]!.at).toEqual(before.at);
    expect(history.canRedo).toBe(true);

    // Redo re-applies.
    const redone = history.redo(undone)!;
    expect(redone.symbols[0]!.at).toEqual(moved.symbols[0]!.at);
  });

  it('does not touch unselected items', () => {
    const { sch } = load();
    const history = new History();
    const moved = history.execute(sch, moveItems(new Set(['nonexistent']), { x: 1000, y: 1000 }));
    expect(moved.symbols[0]!.at).toEqual(sch.symbols[0]!.at);
    expect(moved.lines[0]!.start).toEqual(sch.lines[0]!.start);
  });
});

describe('connection-aware move (rubber-banding)', () => {
  it('computes a symbol pin position that coincides with the wire end', () => {
    const { sch, libById } = load();
    const pins = symbolPinPositions(sch.symbols[0]!, libById.get(sch.symbols[0]!.libId));
    const wireEnd = sch.lines[0]!.end; // (161.29, 111.76) = pin 1
    expect(pins.some((p) => p.x === wireEnd.x && p.y === wireEnd.y)).toBe(true);
  });

  it('drags the connected wire endpoint with the symbol, keeping the far end fixed', () => {
    const { sch, libById } = load();
    const ids = new Set(['d5224ac6-3b29-4f27-99e0-c4e878a39680']); // J1
    const spec = planMove(sch, libById, ids);

    // The wire's end (touching pin 1) should be flagged to drag; its start should not.
    const wireId = sch.lines[0]!.uuid!;
    expect(spec.wireEnd.has(wireId)).toBe(true);
    expect(spec.wireStart.has(wireId)).toBe(false);

    const delta = { x: mmToIU(2.54), y: mmToIU(-1.27) };
    const moved = moveWithConnections(spec, delta).apply(sch);

    const before = sch.lines[0]!;
    // End moved with the symbol; start stayed put — the wire stayed connected.
    expect(moved.lines[0]!.end).toEqual({ x: before.end.x + delta.x, y: before.end.y + delta.y });
    expect(moved.lines[0]!.start).toEqual(before.start);
    // And the symbol moved too.
    expect(moved.symbols[0]!.at).toEqual({ x: sch.symbols[0]!.at.x + delta.x, y: sch.symbols[0]!.at.y + delta.y });
  });
});

describe('orthogonal move (keeps wires orthogonal with a bend)', () => {
  it('slides a vertical wire along its axis and adds a horizontal bend', async () => {
    const { orthoMove } = await import('../src/edit/ortho.js');
    const { sch, libById } = load();
    // The fixture wire is vertical (x=161.29 from y=109.22 to 111.76); its end
    // (161.29,111.76) connects to J1 pin 1. Move J1 by (Δx, Δy).
    const ids = new Set(['d5224ac6-3b29-4f27-99e0-c4e878a39680']); // J1
    const spec = planMove(sch, libById, ids);
    const delta = { x: mmToIU(2.54), y: mmToIU(-1.27) };
    const moved = orthoMove(sch, spec, delta).apply(sch);

    const wire = moved.lines[0]!;
    // Vertical wire: its dragged end slid only in Y (stays vertical), keeping x.
    expect(wire.start).toEqual(sch.lines[0]!.start); // fixed end unchanged
    expect(wire.end).toEqual({ x: sch.lines[0]!.end.x, y: sch.lines[0]!.end.y + delta.y });
    // A bend wire was added connecting the corner to the moved pin.
    expect(moved.lines.length).toBe(sch.lines.length + 1);
    const bend = moved.lines.at(-1)!;
    expect(bend.start).toEqual({ x: sch.lines[0]!.end.x, y: sch.lines[0]!.end.y + delta.y });
    expect(bend.end).toEqual({ x: sch.lines[0]!.end.x + delta.x, y: sch.lines[0]!.end.y + delta.y });
  });

  it('undoes an orthogonal move exactly (removes the bend, reverses)', async () => {
    const { orthoMove } = await import('../src/edit/ortho.js');
    const { sch, libById } = load();
    const ids = new Set(['d5224ac6-3b29-4f27-99e0-c4e878a39680']);
    const spec = planMove(sch, libById, ids);
    const history = new History();
    const cmd = orthoMove(sch, spec, { x: mmToIU(2.54), y: mmToIU(-1.27) });
    const moved = history.execute(sch, cmd);
    const undone = history.undo(moved)!;
    expect(undone.lines.length).toBe(sch.lines.length);
    expect(undone.lines[0]!.end).toEqual(sch.lines[0]!.end);
    expect(undone.symbols[0]!.at).toEqual(sch.symbols[0]!.at);
  });
});
