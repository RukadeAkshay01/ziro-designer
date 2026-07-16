/**
 * Sheet-path page numbers. Counterpart: `eeschema/sch_sheet_path.cpp`
 * (SCH_SHEET_PATH::GetPageNumber / SetPageNumber) + `sch_sheet.cpp`
 * (SCH_SHEET::getInstance / AddInstance).
 *
 * A sheet instance is keyed by the KIID path of its *containing* sheet-path —
 * the chain of sheet UUIDs from the root document down to, but excluding, the
 * sheet itself (SCH_SHEET_PATH::Path() then pop_back). We build that key from
 * the root document's uuid and the chain of sheet-symbol uuids that identify
 * the instance, exactly as KiCad serializes it: "/" joined by the ancestor
 * uuids, e.g. "/<rootUuid>" for a sheet directly under the root or
 * "/<rootUuid>/<ancestor>" one level deeper. The root sheet itself has no such
 * key; its page lives in the document-level (sheet_instances (path "/" …)).
 */

import type { SchSheet, SheetInstance, Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { str } from '@ziroeda/sexpr';
import type { SList } from '@ziroeda/sexpr';

/**
 * The instance key for the sheet identified by `chain` (the sheet-symbol uuids
 * from the root down to and including the target sheet). Drops the target's own
 * uuid, so the result addresses the sheet's instance the way KiCad stores it.
 */
export function instanceKey(rootUuid: string, chain: readonly string[]): string {
  const ancestors = chain.slice(0, -1); // KIID Path() then pop_back()
  return `/${[rootUuid, ...ancestors].join('/')}`;
}

/** The instance on `sheet` for `path` (SCH_SHEET::getInstance). */
export function getInstance(
  sheet: SchSheet,
  path: string,
  project?: string,
): SheetInstance | undefined {
  return sheet.instances.find(
    (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
  );
}

/** Page number of the sheet at `path` (SCH_SHEET_PATH::GetPageNumber); '' if unset. */
export function getSheetPageNumber(sheet: SchSheet, path: string, project?: string): string {
  return getInstance(sheet, path, project)?.page ?? '';
}

/** Page number of the root sheet (document-level sheet_instances). */
export function getRootPageNumber(doc: Schematic, path = '/'): string {
  return doc.sheetInstances.find((i) => i.path === path)?.page ?? '';
}

const setPageOnSource = (pathNode: SList, page: string): SList => {
  const hasPage = pathNode.items.some(
    (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'page',
  );
  if (hasPage) {
    return {
      kind: 'list',
      items: pathNode.items.map((it) =>
        it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'page'
          ? { kind: 'list', items: [it.items[0], str(page)] }
          : it,
      ),
    };
  }
  // No (page …) yet: append one (SCH_SHEET::AddInstance on a fresh instance).
  return {
    kind: 'list',
    items: [
      ...pathNode.items,
      { kind: 'list', items: [{ kind: 'atom', value: 'page' }, str(page)] },
    ],
  };
};

function withPage(inst: SheetInstance, page: string): SheetInstance {
  return { ...inst, page, source: setPageOnSource(inst.source, page) };
}

/** Set the page number of a sub-sheet instance (SCH_SHEET_PATH::SetPageNumber),
 *  as an undoable command over the parent document that holds `sheetIndex`. */
export function setSheetPageNumberCommand(
  sheetIndex: number,
  path: string,
  page: string,
  project?: string,
): EditCommand {
  return {
    label: 'Edit Sheet Page Number',
    apply(doc: Schematic): Schematic {
      const sheet = doc.sheets[sheetIndex];
      if (!sheet) return doc;
      const idx = sheet.instances.findIndex(
        (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
      );
      if (idx === -1) return doc; // no matching instance to edit
      const instances = sheet.instances.map((i, n) => (n === idx ? withPage(i, page) : i));
      const sheets = doc.sheets.map((s, n) => (n === sheetIndex ? { ...s, instances } : s));
      return { ...doc, sheets };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.sheets[sheetIndex]?.instances.find(
        (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
      );
      return setSheetPageNumberCommand(sheetIndex, path, prev?.page ?? '', project);
    },
  };
}

/** Set the root sheet's page number (document-level sheet_instances). */
export function setRootPageNumberCommand(page: string, path = '/'): EditCommand {
  return {
    label: 'Edit Sheet Page Number',
    apply(doc: Schematic): Schematic {
      const idx = doc.sheetInstances.findIndex((i) => i.path === path);
      if (idx === -1) return doc;
      const sheetInstances = doc.sheetInstances.map((i, n) => (n === idx ? withPage(i, page) : i));
      return { ...doc, sheetInstances };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.sheetInstances.find((i) => i.path === path);
      return setRootPageNumberCommand(prev?.page ?? '', path);
    },
  };
}
