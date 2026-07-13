import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';
import { addItems, deleteByIds, needsJunction } from '@ziroeda/eeschema/src/tools/mutate.js';
import { makeWire } from '@ziroeda/eeschema/src/tools/build.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../data/nfc-antenna.kicad_sch', import.meta.url)),
  'utf8',
);
const load = () => readSchematic(parse(fixture));
const P = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

describe('addItems / deleteByIds', () => {
  it('adds a wire and undoes it exactly', () => {
    const sch = load();
    const history = new History();
    const wire = makeWire(P(100, 100), P(110, 100));

    const added = history.execute(sch, addItems({ lines: [wire] }));
    expect(added.lines).toHaveLength(sch.lines.length + 1);
    expect(added.lines.at(-1)!.start).toEqual(P(100, 100));

    const undone = history.undo(added)!;
    expect(undone.lines).toHaveLength(sch.lines.length);
  });

  it('deletes the existing wire and restores it on undo', () => {
    const sch = load();
    const history = new History();
    const wireId = refId('line', sch.lines[0]!.uuid, 0);

    const deleted = history.execute(sch, deleteByIds(new Set([wireId])));
    expect(deleted.lines).toHaveLength(0);

    const restored = history.undo(deleted)!;
    expect(restored.lines).toHaveLength(1);
    expect(restored.lines[0]!.start).toEqual(sch.lines[0]!.start);
  });

  it('a freshly built wire serializes to a valid (wire ...) node', () => {
    const wire = makeWire(P(100, 100), P(110, 105));
    const text = serialize(wire.source);
    expect(text).toContain('(wire');
    expect(text).toContain('(xy 100 100)');
    expect(text).toContain('(xy 110 105)');
    // And it round-trips back to the same coordinates.
    const reparsed = readSchematic(parse(`(kicad_sch (version 1) ${text})`));
    expect(reparsed.lines[0]!.start).toEqual(P(100, 100));
  });
});

describe('needsJunction', () => {
  it('is true where three wire ends meet', () => {
    let sch = load();
    const hub = P(120, 120);
    sch = addItems({
      lines: [makeWire(hub, P(130, 120)), makeWire(hub, P(120, 130)), makeWire(hub, P(110, 120))],
    }).apply(sch);
    expect(needsJunction(sch, hub)).toBe(true);
  });

  it('is false where only two wire ends meet (a simple corner)', () => {
    let sch = load();
    const corner = P(120, 120);
    sch = addItems({ lines: [makeWire(corner, P(130, 120)), makeWire(corner, P(120, 130))] }).apply(
      sch,
    );
    expect(needsJunction(sch, corner)).toBe(false);
  });

  it('is true where a wire end tees into another wire interior', () => {
    let sch = load();
    sch = addItems({ lines: [makeWire(P(100, 100), P(140, 100))] }).apply(sch); // horizontal
    sch = addItems({ lines: [makeWire(P(120, 100), P(120, 120))] }).apply(sch); // tee at (120,100)
    expect(needsJunction(sch, P(120, 100))).toBe(true);
  });
});
