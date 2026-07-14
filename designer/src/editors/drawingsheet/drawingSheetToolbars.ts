/**
 * Drawing Sheet Editor toolbar layouts, transcribed from KiCad `pl_editor`'s
 * `toolbars_pl_editor.cpp` (PL_EDITOR_FRAME::ReCreateHToolbar / ReCreateVToolbar
 * / ReCreateOptToolbar). Separators mirror AppendSeparator; the grid / zoom /
 * coordinate-origin / page-number combos in the top toolbar are rendered by the
 * frame next to the button portion, not as buttons here.
 */

import type { ToolEntry } from '../../ui/toolbars.js';

const sep: ToolEntry = 'sep';

/** TOP main toolbar (button portion). */
export const DS_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'new', icon: 'new', title: 'New drawing sheet' },
  { id: 'open', icon: 'open', title: 'Open drawing sheet' },
  { id: 'save', icon: 'save', title: 'Save drawing sheet' },
  sep,
  { id: 'pageSettings', icon: 'pageSettings', title: 'Page settings' },
  { id: 'print', icon: 'print', title: 'Print drawing sheet' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit page' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
];

/** LEFT options toolbar (view toggles / units — all radio or toggle). */
export const DS_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  sep,
  { id: 'unitsInches', icon: 'unitsInches', title: 'Units in inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Units in mils', toggle: true },
  { id: 'unitsMm', icon: 'unitsMm', title: 'Units in millimetres', toggle: true },
  sep,
  { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-window crosshair', toggle: true },
];

/** RIGHT drawing/placement toolbar (radio selection). */
export const DS_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select items' },
  sep,
  { id: 'dsAddLine', icon: 'dsAddLine', title: 'Add line' },
  { id: 'dsAddRect', icon: 'dsAddRect', title: 'Add rectangle' },
  { id: 'dsAddText', icon: 'dsAddText', title: 'Add text' },
  { id: 'dsAddBitmap', icon: 'dsAddBitmap', title: 'Add bitmap' },
  { id: 'appendSheet', icon: 'appendSheet', title: 'Append existing drawing sheet' },
  sep,
  { id: 'dsDelete', icon: 'dsDelete', title: 'Delete' },
];
