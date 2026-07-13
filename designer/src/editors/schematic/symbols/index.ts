/**
 * Symbol library access.
 *
 * The full set of (combined) KiCad symbol libraries lives under `public/symbols`
 * as static assets — a names index (`index.json`, loaded up front for search) and
 * one `<Library>.kicad_sym` per library (fetched and parsed on demand when a symbol
 * is placed). This keeps the JS bundle small while making thousands of real KiCad
 * symbols available. They are read natively with the same parser as schematics.
 */
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';

export interface LibIndexEntry {
  name: string;
  count: number;
  symbols: string[];
}

const BASE = import.meta.env.BASE_URL; // '/' locally, '/pcb/' on GitHub Pages

let indexPromise: Promise<LibIndexEntry[]> | null = null;
/** Load the library index (library names + their symbol names) for search. */
export function loadIndex(): Promise<LibIndexEntry[]> {
  if (!indexPromise) indexPromise = fetch(`${BASE}symbols/index.json`).then((r) => r.json());
  return indexPromise;
}

const libCache = new Map<string, Promise<Map<string, LibSymbol>>>();
function loadLibrary(name: string): Promise<Map<string, LibSymbol>> {
  let p = libCache.get(name);
  if (!p) {
    p = fetch(`${BASE}symbols/${name}.kicad_sym`)
      .then((r) => r.text())
      .then((text) => {
        const map = new Map<string, LibSymbol>();
        for (const sym of readSymbolLib(parse(text))) {
          // Give it a KiCad-style Library:Name id.
          map.set(sym.libId, { ...sym, libId: `${name}:${sym.libId}` });
        }
        return map;
      });
    libCache.set(name, p);
  }
  return p;
}

/** Load one symbol by library and name (fetches+caches the library on demand). */
export async function loadSymbol(
  library: string,
  symbolName: string,
): Promise<LibSymbol | undefined> {
  return (await loadLibrary(library)).get(symbolName);
}
