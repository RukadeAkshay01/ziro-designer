/**
 * Buffered symbol-library manager — the web port of KiCad's
 * LIB_SYMBOL_LIBRARY_MANAGER (eeschema/symbol_editor/symbol_library_manager.*).
 *
 * Libraries come from two places, mirroring KiCad's global/project split:
 *   - the bundled global libraries under `public/symbols` (fetched lazily, with
 *     names known up front from index.json — like KiCad's on-demand lib loads),
 *   - the open project's `.kicad_sym` files.
 *
 * Every library buffers working copies of its symbols; edits mark the symbol
 * and library modified (SYMBOL_BUFFER/LIB_BUFFER's IsModified) until saved.
 * "Saving" serializes with the lossless writer and hands the bytes to the
 * caller (a browser download replaces writing to disk).
 */

import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, serializeSymbolLib, type LibSymbol } from '@ziroeda/eeschema';

export interface ManagedLibrary {
  /** Library nickname shown in the tree (file basename without extension). */
  name: string;
  /** Display path/filename (project-relative for project libs). */
  fileName: string;
  scope: 'global' | 'project';
  loaded: boolean;
  /** Names known before load (from index.json) so the tree can show them. */
  pendingNames: string[];
  /** Working (buffered) symbols by name, in file order. */
  symbols: Map<string, LibSymbol>;
  /** As-loaded copies for revert / modified checks. */
  original: Map<string, LibSymbol>;
  /** Symbol names with unsaved edits. */
  modified: Set<string>;
  /** Library-level structural change (added/deleted/renamed symbols). */
  libModified: boolean;
}

// Deployments point VITE_SYMBOLS_URL at the full hosted library set (Cloudflare
// R2 — same pattern as demos/3D models); the bundled subset is the fallback.
const SYMBOLS_BASE =
  (import.meta.env.VITE_SYMBOLS_URL as string | undefined) || `${import.meta.env.BASE_URL}symbols`;

export class SymbolLibraryManager {
  private libs = new Map<string, ManagedLibrary>();
  /** Bumped on every mutation so React can subscribe cheaply. */
  revision = 0;

  private touch(): void {
    this.revision++;
  }

  libraryNames(): string[] {
    return [...this.libs.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  library(name: string): ManagedLibrary | undefined {
    return this.libs.get(name);
  }
  libraryExists(name: string): boolean {
    return this.libs.has(name);
  }

  /** Register a bundled global library by name (content fetched on demand). */
  addGlobalLibrary(name: string, symbolNames: string[]): void {
    if (this.libs.has(name)) return;
    this.libs.set(name, {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'global',
      loaded: false,
      pendingNames: symbolNames,
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    });
    this.touch();
  }

  /** Add a project library from already-loaded file text. */
  addProjectLibrary(name: string, fileName: string, text: string): void {
    const lib: ManagedLibrary = {
      name,
      fileName,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /**
   * Add a global library from already-loaded file text — used for libraries
   * installed through the Plugin and Content Manager (their `.kicad_sym` text
   * lives in the PCM store rather than at a URL, so it is loaded eagerly).
   */
  addInstalledLibrary(name: string, text: string): void {
    if (this.libs.has(name)) return;
    const lib: ManagedLibrary = {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'global',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /** Create a new, empty library (ACTIONS::newLibrary). */
  createLibrary(name: string): ManagedLibrary {
    const lib: ManagedLibrary = {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: true,
    };
    this.libs.set(name, lib);
    this.touch();
    return lib;
  }

  /** Fetch + parse a lazy global library. */
  async ensureLoaded(name: string): Promise<ManagedLibrary | undefined> {
    const lib = this.libs.get(name);
    if (!lib || lib.loaded) return lib;
    const text = await fetch(`${SYMBOLS_BASE}/${name}.kicad_sym`).then((r) => r.text());
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    lib.loaded = true;
    lib.pendingNames = [];
    this.touch();
    return lib;
  }

  symbolNames(libName: string): string[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    return lib.loaded ? [...lib.symbols.keys()] : [...lib.pendingNames];
  }

  getSymbol(libName: string, symName: string): LibSymbol | undefined {
    return this.libs.get(libName)?.symbols.get(symName);
  }

  symbolExists(libName: string, symName: string): boolean {
    const lib = this.libs.get(libName);
    if (!lib) return false;
    return lib.loaded ? lib.symbols.has(symName) : lib.pendingNames.includes(symName);
  }

  /** Buffer an updated working copy (UpdateSymbol): marks it modified. */
  updateSymbol(libName: string, sym: LibSymbol): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    if (!lib.symbols.has(sym.libId)) lib.libModified = true;
    lib.symbols.set(sym.libId, sym);
    lib.modified.add(sym.libId);
    this.touch();
  }

  /** UpdateSymbolAfterRename: re-key the buffer and keep the modified mark. */
  renameSymbol(libName: string, oldName: string, sym: LibSymbol): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    // Preserve file order through the rename.
    const entries = [...lib.symbols.entries()].map(
      ([k, v]) => (k === oldName ? [sym.libId, sym] : [k, v]) as [string, LibSymbol],
    );
    lib.symbols = new Map(entries);
    lib.modified.delete(oldName);
    lib.modified.add(sym.libId);
    lib.libModified = true;
    this.touch();
  }

  /** RemoveSymbol: drop it from the buffer. */
  removeSymbol(libName: string, symName: string): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    lib.symbols.delete(symName);
    lib.modified.delete(symName);
    lib.libModified = true;
    this.touch();
  }

  /** RevertSymbol: back to the as-loaded copy (or drop a never-saved one). */
  revertSymbol(libName: string, symName: string): LibSymbol | undefined {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const orig = lib.original.get(symName);
    if (orig) lib.symbols.set(symName, orig);
    else lib.symbols.delete(symName);
    lib.modified.delete(symName);
    this.touch();
    return orig;
  }

  isSymbolModified(libName: string, symName: string): boolean {
    return this.libs.get(libName)?.modified.has(symName) ?? false;
  }

  isLibraryModified(libName: string): boolean {
    const lib = this.libs.get(libName);
    return !!lib && (lib.libModified || lib.modified.size > 0);
  }

  hasModifications(): boolean {
    for (const name of this.libs.keys()) {
      if (this.isLibraryModified(name)) return true;
    }
    return false;
  }

  /**
   * Serialize the library with the lossless writer (the buffered state becomes
   * the new baseline, clearing the modified marks) and return the file text.
   */
  saveLibraryText(libName: string): string | undefined {
    const lib = this.libs.get(libName);
    if (!lib?.loaded) return undefined;
    const text = serializeSymbolLib([...lib.symbols.values()]);
    lib.original = new Map(lib.symbols);
    lib.modified.clear();
    lib.libModified = false;
    this.touch();
    return text;
  }
}
