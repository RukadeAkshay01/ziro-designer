/**
 * Sheet instance page numbers (counterpart sch_sheet_path.cpp /
 * sch_sheet.cpp): parse the (instances (project (path (page)))) records and the
 * document-level (sheet_instances (path (page))), read/set page numbers keyed
 * by the KIID instance path, and round-trip losslessly through the writer.
 *
 * Verified against KiCad's own complex_hierarchy demo, whose two sub-sheets
 * share one file at pages 2 and 3 under the root sheet 5b9623a5-….
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  instanceKey,
  getSheetPageNumber,
  getRootPageNumber,
  setSheetPageNumberCommand,
  setRootPageNumberCommand,
} from '@ziroeda/eeschema/src/tools/sch_sheet_path.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../data/complex_hierarchy.kicad_sch', import.meta.url)),
  'utf8',
);
const load = () => readSchematic(parse(fixture));
const ROOT = '5b9623a5-6d01-41fc-9865-e1bc779418c8';

describe('instances survive a read → write → read round-trip', () => {
  it('preserves every sheet instance (project, path, page) and the root page', () => {
    const doc = load();
    const re = readSchematic(parse(serializeSchematic(doc)));
    const flat = (d: typeof doc) =>
      d.sheets.flatMap((s) => s.instances.map((i) => `${i.project}|${i.path}|${i.page}`)).sort();
    expect(flat(re)).toEqual(flat(doc));
    expect(re.sheetInstances.map((i) => `${i.path}|${i.page}`).sort()).toEqual(
      doc.sheetInstances.map((i) => `${i.path}|${i.page}`).sort(),
    );
  });
});

describe('instanceKey (SCH_SHEET_PATH::Path then pop_back)', () => {
  it('drops the target sheet uuid, keeping ancestors under the root', () => {
    expect(instanceKey(ROOT, ['aaaa'])).toBe(`/${ROOT}`); // sheet directly under root
    expect(instanceKey(ROOT, ['aaaa', 'bbbb'])).toBe(`/${ROOT}/aaaa`); // one level deeper
  });
});

describe('reading page numbers', () => {
  const doc = load();

  it('parses each sub-sheet instance and its page', () => {
    // Both sub-sheets are placed under the root; their instance path is /<root>.
    const pages = doc.sheets.map((s) => getSheetPageNumber(s, `/${ROOT}`, 'complex_hierarchy'));
    expect(pages.sort()).toEqual(['2', '3']);
  });

  it('parses the root sheet page from sheet_instances', () => {
    expect(getRootPageNumber(doc)).toBe('1');
  });
});

describe('setting page numbers round-trips', () => {
  it('changes a sub-sheet page and writes it back', () => {
    const doc = load();
    // The sheet currently on page 2.
    const idx = doc.sheets.findIndex(
      (s) => getSheetPageNumber(s, `/${ROOT}`, 'complex_hierarchy') === '2',
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    const after = setSheetPageNumberCommand(idx, `/${ROOT}`, '7', 'complex_hierarchy').apply(doc);
    expect(getSheetPageNumber(after.sheets[idx]!, `/${ROOT}`, 'complex_hierarchy')).toBe('7');
    const text = serializeSchematic(after);
    expect(text).toContain('(page "7")');
    expect(text).toContain('(page "3")'); // the other sub-sheet is untouched
  });

  it('changes the root page via sheet_instances and is undoable', () => {
    const doc = load();
    const cmd = setRootPageNumberCommand('5');
    const after = cmd.apply(doc);
    expect(getRootPageNumber(after)).toBe('5');
    expect(serializeSchematic(after)).toContain('(page "5")');
    expect(getRootPageNumber(cmd.invert(doc).apply(after))).toBe('1');
  });
});
