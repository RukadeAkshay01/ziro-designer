/**
 * Symbol Editor toolbar layouts, transcribed from KiCad 9.0's
 * `eeschema/symbol_editor/toolbars_symbol_editor.cpp` (ReCreateHToolbar /
 * ReCreateOptToolbar / ReCreateVToolbar). Separators mark KiCad's
 * AddScaledSeparator groups. The unit selector combo box sits between its own
 * separators in the top toolbar (rendered by the frame, not this table).
 *
 * Two vertical-toolbar tools are deliberately absent for now — drawSymbolTextBox
 * and drawBezier — because the document model does not yet represent text boxes
 * or bezier body items; adding a button that draws nothing would be worse than
 * mirroring the rest faithfully.
 */

import type { ToolEntry } from '../../ui/Toolbar.js';

const sep: ToolEntry = 'sep';

/** Top horizontal toolbar (ReCreateHToolbar). */
export const SYM_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'newSymbol', icon: 'newSymbol', title: 'New symbol' },
  { id: 'saveAll', icon: 'save', title: 'Save all changes' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit symbol' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  sep,
  { id: 'symbolProperties', icon: 'symbolProperties', title: 'Edit symbol properties' },
  { id: 'pinTable', icon: 'pinTable', title: 'Edit pins in a table' },
  sep,
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show associated datasheet or document' },
  { id: 'checkSymbol', icon: 'checkSymbol', title: 'Check duplicate and off-grid pins' },
  sep,
  {
    id: 'showDeMorganStandard',
    icon: 'morganStd',
    title: 'Show as "De Morgan" standard symbol',
    toggle: true,
  },
  {
    id: 'showDeMorganAlternate',
    icon: 'morganAlt',
    title: 'Show as "De Morgan" alternate symbol',
    toggle: true,
  },
  // (unit selector combo box is rendered here by the frame)
  sep,
  { id: 'toggleSyncedPinsMode', icon: 'syncedPins', title: 'Synchronized pins mode', toggle: true },
  sep,
  { id: 'addSymbolToSchematic', icon: 'addSymbolToSchematic', title: 'Add symbol to schematic' },
];

/** Left vertical options toolbar (ReCreateOptToolbar). */
export const SYM_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Toggle grid display', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'toggleGridOverrides',
    title: 'Toggle grid overrides',
    toggle: true,
  },
  { id: 'unitsInches', icon: 'unitsInches', title: 'Inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Mils', toggle: true },
  { id: 'unitsMm', icon: 'unitsMm', title: 'Millimeters', toggle: true },
  {
    id: 'toggleCursorStyle',
    icon: 'crosshairSmall',
    title: 'Toggle display of full-window crosshairs',
    toggle: true,
  },
  sep,
  {
    id: 'showElectricalTypes',
    icon: 'showElectricalTypes',
    title: 'Show pin electrical types',
    toggle: true,
  },
  { id: 'showHiddenPins', icon: 'toggleHiddenPins', title: 'Show hidden pins', toggle: true },
  { id: 'showHiddenFields', icon: 'showHiddenFields', title: 'Show hidden fields', toggle: true },
  sep,
  { id: 'showLibraryTree', icon: 'showLibraryTree', title: 'Show library tree', toggle: true },
  { id: 'showProperties', icon: 'showProperties', title: 'Show properties manager', toggle: true },
];

/** Right vertical drawing toolbar (ReCreateVToolbar). */
export const SYM_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item(s)' },
  sep,
  { id: 'placePin', icon: 'placePin', title: 'Add a pin' },
  { id: 'placeText', icon: 'placeText', title: 'Add a text item' },
  { id: 'drawRectangle', icon: 'rectangle', title: 'Add a rectangle' },
  { id: 'drawCircle', icon: 'circle', title: 'Add a circle' },
  { id: 'drawArc', icon: 'arc', title: 'Add an arc' },
  { id: 'drawLines', icon: 'lines', title: 'Add lines and polylines' },
  { id: 'drawPolygon', icon: 'polygon', title: 'Add a polygon' },
  { id: 'placeAnchor', icon: 'placeAnchor', title: 'Move the symbol anchor' },
  { id: 'deleteTool', icon: 'delete', title: 'Interactive delete' },
];
