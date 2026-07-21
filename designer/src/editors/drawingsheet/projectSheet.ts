/**
 * Project drawing-sheet resolution.
 *
 * KiCad keeps the schematic's drawing sheet as a *project* setting, not part of
 * the `.kicad_sch`: `.kicad_pro` -> `schematic.page_layout_descr_file`
 * (PROJECT_FILE / SCHEMATIC_SETTINGS::m_SchDrawingSheetFileName). The `.kicad_wks`
 * itself lives in the project folder next to the `.kicad_sch` / `.kicad_pcb`.
 *
 * These helpers read/write that reference and resolve the active sheet from a
 * project's raw files, so the schematic renderer draws the chosen sheet and the
 * choice survives a reload / cloud sync like any other project file.
 */

import { parseDrawingSheet, type WksSheet } from '@ziroeda/common';

/** A raw project file (name + text), matching the schematic editor's PickedFile. */
export interface RawFile {
  name: string;
  text: string;
}

const PRO_RE = /\.kicad_pro$/i;
const WKS_RE = /\.kicad_wks$/i;

/** Path basename (project references store a bare file name). */
export function sheetBasename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The project's `.kicad_pro`, if present. */
function findPro(files: readonly RawFile[]): RawFile | undefined {
  return files.find((f) => PRO_RE.test(f.name));
}

/** The `.kicad_wks` file basenames in the project (Page Settings choices),
 *  de-duplicated so a file present at two paths lists once. */
export function listProjectSheetFiles(files: readonly RawFile[]): string[] {
  const seen = new Set<string>();
  for (const f of files) if (WKS_RE.test(f.name)) seen.add(sheetBasename(f.name));
  return [...seen];
}

/** The referenced sheet file name (`schematic.page_layout_descr_file`), or ''. */
export function readSheetRef(files: readonly RawFile[]): string {
  const pro = findPro(files);
  if (!pro) return '';
  try {
    const j = JSON.parse(pro.text) as { schematic?: { page_layout_descr_file?: string } };
    return j.schematic?.page_layout_descr_file ?? '';
  } catch {
    return '';
  }
}

/** Return `proText` with `schematic.page_layout_descr_file` set to `name`
 *  (preserving the rest), or null when the JSON can't be parsed. */
export function writeSheetRefText(proText: string, name: string): string | null {
  try {
    const j = JSON.parse(proText) as Record<string, unknown>;
    const schematic =
      j.schematic && typeof j.schematic === 'object'
        ? (j.schematic as Record<string, unknown>)
        : {};
    schematic.page_layout_descr_file = name;
    j.schematic = schematic;
    return `${JSON.stringify(j, null, 2)}\n`;
  } catch {
    return null;
  }
}

/** Parse the named `.kicad_wks` from the project, or null if missing/invalid. */
export function parseProjectSheet(files: readonly RawFile[], name: string): WksSheet | null {
  if (!name) return null;
  const want = sheetBasename(name);
  const f = files.find((x) => WKS_RE.test(x.name) && sheetBasename(x.name) === want);
  if (!f) return null;
  try {
    return parseDrawingSheet(f.text);
  } catch {
    return null;
  }
}

/** The active sheet for a project: the referenced `.kicad_wks` parsed, or null
 *  (renderer falls back to the built-in default). */
export function resolveActiveSheet(files: readonly RawFile[]): WksSheet | null {
  return parseProjectSheet(files, readSheetRef(files));
}
