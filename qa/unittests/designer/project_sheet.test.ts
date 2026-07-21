/**
 * Project drawing-sheet reference: read/write schematic.page_layout_descr_file
 * in the .kicad_pro and resolve the referenced .kicad_wks from project files.
 */
import { describe, it, expect } from 'vitest';
import {
  readSheetRef,
  writeSheetRefText,
  listProjectSheetFiles,
  parseProjectSheet,
  resolveActiveSheet,
} from '@ziroeda/designer/src/editors/drawingsheet/projectSheet.js';

const PRO = JSON.stringify({ meta: { version: 3 }, schematic: { meta: { version: 1 } } }, null, 2);
const WKS = `(kicad_wks (version 20231118) (generator "pl_editor")
  (setup (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15)
    (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10))
  (rect (name "") (start 0 0 ltcorner) (end 0 0) (repeat 2) (incrx 2) (incry 2)))`;

describe('project drawing-sheet reference', () => {
  it('defaults to empty, round-trips through writeSheetRefText/readSheetRef', () => {
    const files = [
      { name: 'proj.kicad_pro', text: PRO },
      { name: 'frame.kicad_wks', text: WKS },
    ];
    expect(readSheetRef(files)).toBe('');
    expect(listProjectSheetFiles(files)).toEqual(['frame.kicad_wks']);
    // A file present at two paths (a stray root copy + the project-folder copy)
    // lists once by basename.
    expect(
      listProjectSheetFiles([
        { name: 'frame.kicad_wks', text: WKS },
        { name: 'proj/frame.kicad_wks', text: WKS },
      ]),
    ).toEqual(['frame.kicad_wks']);

    const updated = writeSheetRefText(PRO, 'frame.kicad_wks');
    expect(updated).not.toBeNull();
    const files2 = [
      { name: 'proj.kicad_pro', text: updated! },
      { name: 'frame.kicad_wks', text: WKS },
    ];
    expect(readSheetRef(files2)).toBe('frame.kicad_wks');
    // Preserves the rest of the settings.
    expect(JSON.parse(updated!).schematic.meta.version).toBe(1);
  });

  it('resolves the referenced sheet, and null when unset or missing', () => {
    const unset = [{ name: 'p.kicad_pro', text: PRO }, { name: 'frame.kicad_wks', text: WKS }];
    expect(resolveActiveSheet(unset)).toBeNull();

    const set = [
      { name: 'p.kicad_pro', text: writeSheetRefText(PRO, 'frame.kicad_wks')! },
      { name: 'frame.kicad_wks', text: WKS },
    ];
    const sheet = resolveActiveSheet(set);
    expect(sheet).not.toBeNull();
    expect(sheet!.items.length).toBeGreaterThan(0);

    // A dangling reference (file not in the project) resolves to null.
    const missing = [{ name: 'p.kicad_pro', text: writeSheetRefText(PRO, 'gone.kicad_wks')! }];
    expect(resolveActiveSheet(missing)).toBeNull();
    expect(parseProjectSheet(missing, 'gone.kicad_wks')).toBeNull();
  });
});
