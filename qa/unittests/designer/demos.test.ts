/**
 * Bundled demo projects must parse with our own engines — a demo that fails
 * to open would be the worst possible first impression, and the classic
 * upstream project doubles as a real-world compatibility fixture.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema';
import { readBoard, readFootprintFile } from '@ziroeda/pcbnew';

const DEMO = fileURLToPath(new URL('../../../designer/public/demos/ecc83/', import.meta.url));
// Full corpus sweep source: the gitignored upstream clone (local dev only —
// in CI the bundled ecc83 fixture above is the guaranteed compatibility test).
const DEMOS_ROOT = fileURLToPath(new URL('../../../kicad-src/demos/', import.meta.url));
const read = (name: string): string => readFileSync(DEMO + name, 'utf8');

describe.skipIf(!existsSync(DEMO))('bundled demo project (ecc83)', () => {
  it('schematic parses and has real content', () => {
    const sch = readSchematic(parse(read('ecc83-pp.kicad_sch')));
    expect(sch.symbols.length).toBeGreaterThan(5);
    expect(sch.lines.length).toBeGreaterThan(10);
  });

  it('board parses with layers, nets and footprints', () => {
    const board = readBoard(parse(read('ecc83-pp.kicad_pcb')));
    expect(board.layers.length).toBeGreaterThan(2);
    expect(board.footprints.length).toBeGreaterThan(5);
    expect(board.tracks.length).toBeGreaterThan(10);
  });

  it('local symbol library parses', () => {
    const symbols = readSymbolLib(parse(read('ecc83-pp.kicad_sym')));
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('every bundled footprint parses', () => {
    const dir = `${DEMO}footprints.pretty/`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.kicad_mod'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const fp = readFootprintFile(parse(readFileSync(dir + f, 'utf8')));
      expect(fp).toBeTruthy();
    }
  });
});

/** The full upstream demo corpus must parse with our engines — run locally
 * against the reference clone (skipped in CI where the clone is absent). */
describe.skipIf(!existsSync(DEMOS_ROOT))('upstream demo corpus parse sweep', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
    );
  // Guarded walk: vitest executes skipped suite factories during collection,
  // so this must not touch the filesystem when the clone is absent (CI).
  // The jetson/vme-wren showcase boards are 81/67 MB — parseable, but not
  // worth a minute of every local test run; everything else sweeps.
  const all = existsSync(DEMOS_ROOT)
    ? walk(DEMOS_ROOT).filter((f) => statSync(f).size < 20 * 1024 * 1024)
    : [];
  const schs = all.filter((f) => f.endsWith('.kicad_sch'));
  const pcbs = all.filter((f) => f.endsWith('.kicad_pcb'));

  it(`parses every demo schematic (${schs.length})`, { timeout: 60_000 }, () => {
    for (const f of schs) {
      const sch = readSchematic(parse(readFileSync(f, 'utf8')));
      expect(sch.version, f).toBeGreaterThan(0);
    }
  });

  it(`parses every demo board (${pcbs.length})`, { timeout: 120_000 }, () => {
    for (const f of pcbs) {
      const board = readBoard(parse(readFileSync(f, 'utf8')));
      expect(board.layers.length, f).toBeGreaterThan(0);
    }
  });
});
