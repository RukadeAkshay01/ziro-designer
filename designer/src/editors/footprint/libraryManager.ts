/**
 * Buffered footprint-library manager — the web port of KiCad's
 * FP_LIB_TABLE-backed editing model used by `FOOTPRINT_EDIT_FRAME`
 * (pcbnew/footprint_libraries_utils.cpp). A footprint library is a `.pretty`
 * directory whose members are one-footprint `.kicad_mod` files, so — unlike a
 * `.kicad_sym` symbol library — each footprint is its own file.
 *
 * Libraries come from two places, mirroring KiCad's global/project split:
 *   - bundled global libraries under `public/footprints` (footprint names known
 *     up front from index.json; each `.kicad_mod` fetched lazily on open),
 *   - the open project's `.pretty` folders (already in memory from the picker).
 *
 * Each library buffers working copies of its footprints; an edit marks the
 * footprint and library modified until saved. "Saving" serializes the footprint
 * with the lossless writer (serializeFootprint) and hands the bytes back — a
 * browser download per `.kicad_mod` file replaces writing to the `.pretty` dir.
 */

import { parse } from '@ziroeda/sexpr';
import { readFootprintFile, serializeFootprint, type PcbFootprint } from '@ziroeda/pcbnew';

export interface ManagedFpLibrary {
  /** Library nickname (the `.pretty` directory basename). */
  name: string;
  /** Display path (project-relative dir for project libs). */
  fileName: string;
  scope: 'global' | 'project';
  loaded: boolean;
  /** Footprint names known before their files are fetched (from index.json). */
  pendingNames: string[];
  /** Working (buffered) footprints by name. */
  footprints: Map<string, PcbFootprint>;
  /** As-loaded copies for revert / modified checks. */
  original: Map<string, PcbFootprint>;
  /** Footprint names with unsaved edits. */
  modified: Set<string>;
  /** Library-level structural change (added/deleted/renamed footprints). */
  libModified: boolean;
}

// Deployments point VITE_FOOTPRINTS_URL at the full hosted library set
// (Cloudflare R2 — same pattern as demos/3D models); bundled subset fallback.
export const FOOTPRINTS_BASE =
  (import.meta.env.VITE_FOOTPRINTS_URL as string | undefined) ||
  `${import.meta.env.BASE_URL}footprints`;

/** A footprint's name is the `.kicad_mod` basename (its FPID item name). */
export const fpNameOf = (path: string): string =>
  path
    .split('/')
    .pop()!
    .split('\\')
    .pop()!
    .replace(/\.kicad_mod$/i, '');

export class FootprintLibraryManager {
  private libs = new Map<string, ManagedFpLibrary>();
  /** Bumped on every mutation so React can subscribe cheaply. */
  revision = 0;

  private touch(): void {
    this.revision++;
  }

  libraryNames(): string[] {
    return [...this.libs.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  library(name: string): ManagedFpLibrary | undefined {
    return this.libs.get(name);
  }
  libraryExists(name: string): boolean {
    return this.libs.has(name);
  }

  /** Register a bundled global library by name (its `.kicad_mod`s fetched on demand). */
  addGlobalLibrary(name: string, footprintNames: string[]): void {
    if (this.libs.has(name)) return;
    this.libs.set(name, {
      name,
      fileName: `${name}.pretty`,
      scope: 'global',
      loaded: false,
      pendingNames: footprintNames,
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    });
    this.touch();
  }

  /**
   * Add a project library from its already-loaded `.kicad_mod` files (the
   * members of one `.pretty` directory of the open project).
   */
  addProjectLibrary(
    name: string,
    dirPath: string,
    entries: { fileName: string; text: string }[],
  ): void {
    const lib: ManagedFpLibrary = {
      name,
      fileName: dirPath,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const e of entries) {
      const fp = readFootprintFile(parse(e.text));
      if (!fp) continue;
      const fpName = fp.lib || fpNameOf(e.fileName);
      lib.footprints.set(fpName, fp);
      lib.original.set(fpName, fp);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /** Create a new, empty library (ACTIONS::newLibrary). */
  createLibrary(name: string): ManagedFpLibrary {
    const lib: ManagedFpLibrary = {
      name,
      fileName: `${name}.pretty`,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: true,
    };
    this.libs.set(name, lib);
    this.touch();
    return lib;
  }

  /**
   * Mark a global library "loaded" (its member list is already known). Individual
   * footprints are fetched by `loadFootprint`; this lets the tree expand it.
   */
  async ensureLoaded(name: string): Promise<ManagedFpLibrary | undefined> {
    const lib = this.libs.get(name);
    if (!lib) return undefined;
    lib.loaded = true;
    return lib;
  }

  /**
   * Load one footprint's working copy, fetching its `.kicad_mod` for a global
   * library (project footprints are already buffered). Mirrors FP_CACHE's
   * per-file load.
   */
  async loadFootprint(libName: string, fpName: string): Promise<PcbFootprint | undefined> {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const existing = lib.footprints.get(fpName);
    if (existing) return existing;
    if (lib.scope === 'global') {
      try {
        const text = await fetch(
          `${FOOTPRINTS_BASE}/${encodeURIComponent(lib.name)}.pretty/${encodeURIComponent(fpName)}.kicad_mod`,
        ).then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.text();
        });
        const fp = readFootprintFile(parse(text));
        if (!fp) return undefined;
        lib.footprints.set(fpName, fp);
        lib.original.set(fpName, fp);
        this.touch();
        return fp;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  footprintNames(libName: string): string[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    if (lib.pendingNames.length > 0 && lib.footprints.size === 0) return [...lib.pendingNames];
    // Merge buffered names with any still-pending (unfetched) ones.
    const set = new Set<string>([...lib.footprints.keys(), ...lib.pendingNames]);
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  getFootprint(libName: string, fpName: string): PcbFootprint | undefined {
    return this.libs.get(libName)?.footprints.get(fpName);
  }

  footprintExists(libName: string, fpName: string): boolean {
    const lib = this.libs.get(libName);
    if (!lib) return false;
    return lib.footprints.has(fpName) || lib.pendingNames.includes(fpName);
  }

  /** Buffer an updated working copy (marks it modified). */
  updateFootprint(libName: string, fpName: string, fp: PcbFootprint): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    if (!lib.footprints.has(fpName)) lib.libModified = true;
    lib.footprints.set(fpName, fp);
    lib.modified.add(fpName);
    this.touch();
  }

  /** Rename a footprint: re-key the buffer, keep the modified mark. */
  renameFootprint(libName: string, oldName: string, newName: string, fp: PcbFootprint): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    const entries = [...lib.footprints.entries()].map(
      ([k, v]) => (k === oldName ? [newName, fp] : [k, v]) as [string, PcbFootprint],
    );
    lib.footprints = new Map(entries);
    lib.modified.delete(oldName);
    lib.modified.add(newName);
    lib.libModified = true;
    this.touch();
  }

  /** Remove a footprint from the buffer. */
  removeFootprint(libName: string, fpName: string): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    lib.footprints.delete(fpName);
    lib.modified.delete(fpName);
    lib.libModified = true;
    this.touch();
  }

  /** Revert to the as-loaded copy (or drop a never-saved one). */
  revertFootprint(libName: string, fpName: string): PcbFootprint | undefined {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const orig = lib.original.get(fpName);
    if (orig) lib.footprints.set(fpName, orig);
    else lib.footprints.delete(fpName);
    lib.modified.delete(fpName);
    this.touch();
    return orig;
  }

  isFootprintModified(libName: string, fpName: string): boolean {
    return this.libs.get(libName)?.modified.has(fpName) ?? false;
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

  /** Serialize one footprint to its `.kicad_mod` text (clears its modified mark). */
  saveFootprintText(libName: string, fpName: string): string | undefined {
    const lib = this.libs.get(libName);
    const fp = lib?.footprints.get(fpName);
    if (!lib || !fp) return undefined;
    const text = serializeFootprint(fp);
    lib.original.set(fpName, fp);
    lib.modified.delete(fpName);
    if (lib.modified.size === 0) lib.libModified = false;
    this.touch();
    return text;
  }

  /** All modified footprints of a library as `{ fileName, text }` (one per `.kicad_mod`). */
  modifiedFiles(libName: string): { fileName: string; text: string }[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    const out: { fileName: string; text: string }[] = [];
    for (const fpName of lib.modified) {
      const text = this.saveFootprintText(libName, fpName);
      if (text !== undefined) out.push({ fileName: `${fpName}.kicad_mod`, text });
    }
    return out;
  }
}
