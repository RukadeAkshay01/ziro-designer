/**
 * Multi-sheet project helpers, mirroring KiCad's SCH_SHEET_LIST hierarchy walk:
 * the root schematic references sub-sheets through their "Sheetfile" field, each
 * of which is another .kicad_sch document. Files are keyed by basename — KiCad
 * projects normally keep all sheets beside the .kicad_pro, and relative paths
 * resolve to the same basename.
 */

import type { Schematic, SchSheet } from './types.js';

/** The "Sheetname" field value (KiCad's mandatory sheet-name field). */
export function sheetName(sheet: SchSheet): string {
  return sheet.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
}

/** The "Sheetfile" field as a basename ("sub/dir/amp.kicad_sch" -> "amp.kicad_sch"). */
export function sheetFile(sheet: SchSheet): string {
  const raw = sheet.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return idx === -1 ? raw : raw.slice(idx + 1);
}

export interface SheetTreeNode {
  /** Document basename, e.g. "power.kicad_sch". */
  file: string;
  /** Display name: the Sheetname field, or the file for the root. */
  name: string;
  /**
   * Unique instance path — KiCad's SCH_SHEET_PATH (KIID_PATH): the chain of
   * sheet-symbol UUIDs from the root ("/", then "/<uuid>/", "/<uuid>/<uuid>/"…).
   * A file used by several sheet instances (a *complex* hierarchy) appears once
   * per instance with a distinct path, so navigation/highlight can tell them
   * apart even though they share one document.
   */
  path: string;
  children: SheetTreeNode[];
}

/**
 * Build the hierarchy tree from the root document, following each sheet's
 * Sheetfile into `docs`. A missing document still appears (as a leaf) so broken
 * links are visible; recursion guards against self-referencing cycles.
 */
export function buildSheetTree(
  docs: ReadonlyMap<string, Schematic>,
  rootFile: string,
): SheetTreeNode {
  const build = (file: string, name: string, path: string, stack: readonly string[]): SheetTreeNode => {
    const node: SheetTreeNode = { file, name, path, children: [] };
    if (stack.includes(file)) return node; // recursion guard (KiCad TestForRecursion)
    const doc = docs.get(file);
    if (!doc) return node;
    doc.sheets.forEach((sh, i) => {
      const child = sheetFile(sh);
      if (child === '') return;
      // Append this sheet symbol's uuid (falling back to its index) so each
      // instance of a shared file gets its own path.
      const childPath = `${path}${sh.uuid || `i${i}`}/`;
      node.children.push(build(child, sheetName(sh) || child, childPath, [...stack, file]));
    });
    return node;
  };
  return build(rootFile, rootFile.replace(/\.kicad_sch$/i, ''), '/', []);
}

/**
 * Pick the project's root schematic from a set of parsed documents: the
 * basename matching the .kicad_pro if given, else the document no other
 * document references as a sub-sheet, else the first file.
 */
export function findRootFile(
  docs: ReadonlyMap<string, Schematic>,
  proName?: string,
): string {
  if (proName) {
    const want = proName.replace(/\.kicad_pro$/i, '.kicad_sch');
    if (docs.has(want)) return want;
  }
  const referenced = new Set<string>();
  for (const doc of docs.values()) {
    for (const sh of doc.sheets) referenced.add(sheetFile(sh));
  }
  for (const file of docs.keys()) {
    if (!referenced.has(file)) return file;
  }
  return docs.keys().next().value ?? '';
}
