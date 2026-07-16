/**
 * The complete official symbol + footprint libraries must parse with our
 * engines. Local-only sweeps (skipped in CI): merged symbol libraries come
 * from the uploader's staging dir, footprints from the upstream clone.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import { readFootprintFile } from '@ziroeda/pcbnew';

const SYM_STAGED = fileURLToPath(new URL('../../../tools/libraries/out/symbols/', import.meta.url));
const FP_SRC = fileURLToPath(new URL('../../../kicad-footprints-src/', import.meta.url));

describe.skipIf(!existsSync(SYM_STAGED))('official symbol library sweep (merged)', () => {
  const libs = existsSync(SYM_STAGED)
    ? readdirSync(SYM_STAGED).filter((f) => f.endsWith('.kicad_sym'))
    : [];

  it(`parses every merged library (${libs.length})`, { timeout: 300_000 }, () => {
    let symbols = 0;
    for (const f of libs) {
      const syms = readSymbolLib(parse(readFileSync(SYM_STAGED + f, 'utf8')));
      expect(syms.length, f).toBeGreaterThan(0);
      symbols += syms.length;
    }
    expect(symbols).toBeGreaterThan(20000);
  });
});

describe.skipIf(!existsSync(FP_SRC))('official footprint library sweep', () => {
  const pretties = existsSync(FP_SRC)
    ? readdirSync(FP_SRC).filter((d) => d.endsWith('.pretty'))
    : [];

  it(`parses every footprint in all ${pretties.length} libraries`, { timeout: 600_000 }, () => {
    let count = 0;
    for (const dir of pretties) {
      for (const f of readdirSync(FP_SRC + dir)) {
        if (!f.endsWith('.kicad_mod')) continue;
        const fp = readFootprintFile(parse(readFileSync(`${FP_SRC}${dir}/${f}`, 'utf8')));
        expect(fp, `${dir}/${f}`).toBeTruthy();
        count++;
      }
    }
    expect(count).toBeGreaterThan(15000);
  });
});
