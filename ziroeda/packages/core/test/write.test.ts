import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '../src/sexpr/index.js';
import { readSchematic, writeSchematic } from '../src/model/index.js';
import { mmToIU } from '../src/units.js';
import { moveItems } from '../src/edit/move.js';
import { placeSymbol } from '../src/edit/mutate.js';
import { readSymbolLib } from '../src/model/read-schematic.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/nfc-antenna.kicad_sch', import.meta.url)),
  'utf8',
);
const rLib = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('./fixtures/R.kicad_sym', import.meta.url)), 'utf8')),
);

describe('writeSchematic', () => {
  it('round-trips an unedited schematic with no data loss', () => {
    const sch = readSchematic(parse(fixture));
    // Re-reading our written output yields an equivalent model.
    const reSch = readSchematic(writeSchematic(sch));

    expect(reSch.symbols.length).toBe(sch.symbols.length);
    expect(reSch.lines.length).toBe(sch.lines.length);
    expect(reSch.labels.length).toBe(sch.labels.length);
    expect(reSch.libSymbols.length).toBe(sch.libSymbols.length);
    // The placed symbol keeps every field it had (including ones we don't model).
    expect(reSch.symbols[0]!.source.items.length).toBe(sch.symbols[0]!.source.items.length);
    expect(reSch.symbols[0]!.at).toEqual(sch.symbols[0]!.at);
    expect(reSch.symbols[0]!.fields.find((f) => f.key === 'Reference')!.value).toBe('J1');
  });

  it('writes moved coordinates back into the output', () => {
    const sch = readSchematic(parse(fixture));
    const delta = { x: mmToIU(2.54), y: mmToIU(-1.27) };
    const moved = moveItems(new Set([sch.symbols[0]!.uuid!]), delta).apply(sch);

    const reSch = readSchematic(writeSchematic(moved));
    expect(reSch.symbols[0]!.at).toEqual({ x: sch.symbols[0]!.at.x + delta.x, y: sch.symbols[0]!.at.y + delta.y });
  });

  it('writes a newly placed symbol and its embedded library definition', () => {
    const sch = readSchematic(parse(fixture));
    const placed = placeSymbol(rLib[0]!, { x: mmToIU(120), y: mmToIU(120) }).apply(sch);

    const text = serialize(writeSchematic(placed));
    expect(text).toContain('(lib_id "R")');

    const reSch = readSchematic(parse(text));
    expect(reSch.symbols.length).toBe(sch.symbols.length + 1);
    expect(reSch.libSymbols.some((l) => l.libId === 'R')).toBe(true);
    expect(reSch.symbols.at(-1)!.fields.find((f) => f.key === 'Reference')!.value).toBe('R?');
  });
});

describe('multi-point polyline round-trip', () => {
  it('preserves every vertex of a graphic polyline through parse->write->parse', () => {
    const src = `(kicad_sch (version 20230121) (generator eeschema) (lib_symbols)
      (polyline (pts (xy 20 20) (xy 120 20) (xy 120 80) (xy 20 80) (xy 20 20))
        (stroke (width 0.3) (type dash) (color 194 0 0 1)) (fill (type none))))`;
    const sch = readSchematic(parse(src));
    const poly = sch.lines[0]!;
    expect(poly.points?.length).toBe(5);
    expect(poly.stroke?.type).toBe('dash');
    expect(poly.stroke?.color).toEqual([194, 0, 0, 1]);
    // Written back and re-read, all five vertices survive (not collapsed to 2).
    const re = readSchematic(writeSchematic(sch));
    expect(re.lines[0]!.points?.length).toBe(5);
    expect(re.lines[0]!.points).toEqual(poly.points);
  });
});
