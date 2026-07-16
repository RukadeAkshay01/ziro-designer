/**
 * Drawing Sheet Editor toolbar layouts, following the layout that
 * `pl_editor` defines in `toolbars_pl_editor.cpp`
 * (PL_EDITOR_TOOLBAR_SETTINGS::DefaultToolbarConfig):
 *
 *  - TOP:    file group | print | undo/redo | zoom group | inspector +
 *            preview settings | title-block display-mode pair | origin and
 *            page choice controls (the combos render next to the buttons);
 *  - LEFT:   grid toggle, then the units radio group;
 *  - RIGHT:  selection tool | line / rect / text / image / append |
 *            interactive delete tool.
 */

import type { ToolEntry } from '../../ui/Toolbar.js';

const sep: ToolEntry = 'sep';

/** TOP main toolbar (button portion). */
export const DS_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'new', icon: 'new', title: 'Create new drawing sheet' },
  { id: 'open', icon: 'open', title: 'Open drawing sheet' },
  { id: 'save', icon: 'save', title: 'Save drawing sheet' },
  sep,
  { id: 'print', icon: 'print', title: 'Print' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo last edit' },
  { id: 'redo', icon: 'redo', title: 'Redo last edit' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  sep,
  { id: 'inspect', icon: 'inspect', title: 'Show design inspector' },
  {
    id: 'previewSettings',
    icon: 'previewSettings',
    title: 'Edit preview data for page size and title block',
  },
  sep,
  {
    id: 'layoutNormalMode',
    icon: 'layoutNormalMode',
    title: 'Text placeholders will be replaced with preview data',
    toggle: true,
  },
  {
    id: 'layoutEditMode',
    icon: 'layoutEditMode',
    title: 'Text placeholders are shown as ${keyword} tokens',
    toggle: true,
  },
];

/** LEFT options toolbar: grid, then the units radio group. */
export const DS_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  sep,
  { id: 'unitsMm', icon: 'unitsMm', title: 'Units in millimetres', toggle: true },
  { id: 'unitsInches', icon: 'unitsInches', title: 'Units in inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Units in mils', toggle: true },
];

/** RIGHT drawing/placement toolbar (radio selection). */
export const DS_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item(s)' },
  sep,
  { id: 'dsAddLine', icon: 'dsAddLine', title: 'Draw lines' },
  { id: 'dsAddRect', icon: 'dsAddRect', title: 'Draw rectangles' },
  { id: 'dsAddText', icon: 'dsAddText', title: 'Draw text' },
  { id: 'dsAddBitmap', icon: 'dsAddBitmap', title: 'Place bitmaps' },
  {
    id: 'appendSheet',
    icon: 'appendSheet',
    title: 'Append an existing drawing sheet file to the current file',
  },
  sep,
  { id: 'dsDelete', icon: 'dsDelete', title: 'Delete items' },
];
