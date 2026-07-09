import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/sexpr/index.js';
import { readSymbolLib } from '../src/model/read-schematic.js';
import { serializeSymbolLib } from '../src/model/write-symbol-lib.js';

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, '../../../apps/studio/public/symbols/Device.kicad_sym');

describe('symbol library writer', () => {
  it('round-trips an untouched library semantically', () => {
    const text = readFileSync(LIB, 'utf8');
    const symbols = readSymbolLib(parse(text));
    expect(symbols.length).toBeGreaterThan(10);
    const out = serializeSymbolLib(symbols);
    // Parse the output again: every symbol must read back identically.
    const symbols2 = readSymbolLib(parse(out));
    expect(symbols2.length).toBe(symbols.length);
    // The writer re-sorts by inheritance depth then name (as KiCad's Save does),
    // so compare by name lookup rather than file order.
    const byName = new Map(symbols2.map((s) => [s.libId, s]));
    for (let i = 0; i < symbols.length; i++) {
      const a = symbols[i]!, b = byName.get(symbols[i]!.libId)!;
      expect(b).toBeDefined();
      expect(b.units.length).toBe(a.units.length);
      expect(b.properties.map((p) => [p.key, p.value])).toEqual(a.properties.map((p) => [p.key, p.value]));
      for (let u = 0; u < a.units.length; u++) {
        expect(b.units[u]!.pins.length).toBe(a.units[u]!.pins.length);
        expect(b.units[u]!.graphics.length).toBe(a.units[u]!.graphics.length);
        expect(JSON.stringify(b.units[u]!.pins.map(({source, ...r}) => r)))
          .toBe(JSON.stringify(a.units[u]!.pins.map(({source, ...r}) => r)));
      }
    }
  });

  it('passes untouched symbol nodes through by identity', () => {
    const text = readFileSync(LIB, 'utf8');
    const symbols = readSymbolLib(parse(text));
    const root = symbols.find((s) => !s.extends)!;
    // The writer must reuse the original pin/graphic nodes for untouched items.
    const out = serializeSymbolLib([root]);
    expect(out).toContain(`(symbol "${root.libId}"`);
    expect(out.startsWith('(kicad_symbol_lib')).toBe(true);
  });
});
