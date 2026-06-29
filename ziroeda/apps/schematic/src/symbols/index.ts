/**
 * Bundled symbol library: a curated subset of KiCad's official symbol libraries
 * (Device, power), read natively with the same parser used for schematics. The
 * raw `.kicad_sym` files are vendored under this directory and glob-imported.
 */
import { parse, readSymbolLib, type LibSymbol } from '@ziroeda/core';

const raws = import.meta.glob('./*.kicad_sym', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const POWER = new Set(['GND', '+5V', '+3V3', 'VCC']);
const libraryFor = (name: string): string => (POWER.has(name) ? 'power' : 'Device');

/** All available library symbols, with KiCad-style `Library:Name` ids. */
export const SYMBOL_LIBRARY: LibSymbol[] = Object.entries(raws)
  .flatMap(([path, text]) => {
    const lib = libraryFor(path.split('/').pop()!.replace('.kicad_sym', ''));
    return readSymbolLib(parse(text)).map((s) => ({ ...s, libId: `${lib}:${s.libId}` }));
  })
  .sort((a, b) => a.libId.localeCompare(b.libId));
