/**
 * Footprint editor toolbar layouts, transcribed from KiCad pcbnew's
 * `toolbars_footprint_editor.cpp`
 * (FOOTPRINT_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig, TOOLBAR_LOC::LEFT /
 * RIGHT / TOP_MAIN). Separators mirror AppendSeparator; AppendGroup members are
 * listed consecutively as radio buttons, the same convention pcbToolbars.ts uses.
 * The three TOP_MAIN combo controls (grid / zoom / layer selectors) are rendered
 * by the frame, not as buttons here.
 */

import type { ToolEntry } from '../../ui/toolbars.js';

const sep: ToolEntry = 'sep';

/** TOP_MAIN toolbar (button portion; the grid/zoom/layer combos follow it). */
export const FP_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'newFootprint', icon: 'newFootprint', title: 'New footprint' },
  {
    id: 'createFootprint',
    icon: 'createFootprint',
    title: 'Create new footprint using the footprint wizard',
  },
  { id: 'save', icon: 'save', title: 'Save changes' },
  sep,
  { id: 'print', icon: 'print', title: 'Print footprint' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit footprint' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  { id: 'group', icon: 'group', title: 'Group items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup items' },
  sep,
  { id: 'footprintProperties', icon: 'footprintProperties', title: 'Edit footprint properties' },
  { id: 'padTable', icon: 'padTable', title: 'Show pad list' },
  {
    id: 'defaultPadProperties',
    icon: 'defaultPadProperties',
    title: 'Edit default pad properties',
  },
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show datasheet' },
  { id: 'checkFootprint', icon: 'checkFootprint', title: 'Run footprint checker' },
  sep,
  { id: 'loadFpFromBoard', icon: 'loadFpFromBoard', title: 'Load footprint from current board' },
  { id: 'saveFpToBoard', icon: 'saveFpToBoard', title: 'Insert footprint into current board' },
];

/** LEFT (view options) toolbar. */
export const FP_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'toggleGridOverrides',
    title: 'Toggle grid overrides',
    toggle: true,
  },
  {
    id: 'togglePolarCoords',
    icon: 'togglePolarCoords',
    title: 'Display polar coordinates',
    toggle: true,
  },
  { id: 'unitsMm', icon: 'unitsMm', title: 'Units in millimetres', toggle: true },
  { id: 'unitsInches', icon: 'unitsInches', title: 'Units in inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Units in mils', toggle: true },
  { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshairs', toggle: true },
  { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-window crosshairs', toggle: true },
  { id: 'crosshair45', icon: 'crosshair45', title: '45° crosshairs', toggle: true },
  sep,
  { id: 'lineModeFree', icon: 'lineModeFree', title: 'Line mode: free angle', toggle: true },
  { id: 'lineMode90', icon: 'lineMode90', title: 'Line mode: 90°', toggle: true },
  { id: 'lineMode45', icon: 'lineMode45', title: 'Line mode: 45°', toggle: true },
  sep,
  { id: 'padDisplayMode', icon: 'padDisplayMode', title: 'Sketch pads', toggle: true },
  {
    id: 'graphicsOutlines',
    icon: 'graphicsOutlines',
    title: 'Show graphic items in outline mode',
    toggle: true,
  },
  {
    id: 'textOutlines',
    icon: 'textOutlines',
    title: 'Show text items in outline mode',
    toggle: true,
  },
  { id: 'highContrast', icon: 'highContrast', title: 'High-contrast display mode', toggle: true },
  sep,
  { id: 'showLibraryTree', icon: 'showLibraryTree', title: 'Show footprint tree', toggle: true },
  {
    id: 'showLayersManager',
    icon: 'showLayersManager',
    title: 'Show Appearance manager',
    toggle: true,
  },
  { id: 'showProperties', icon: 'showProperties', title: 'Show Properties panel', toggle: true },
];

/** RIGHT (tools) toolbar. */
export const FP_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select items' },
  { id: 'selectLasso', icon: 'selectLasso', title: 'Select with lasso' },
  sep,
  { id: 'placePad', icon: 'placePad', title: 'Add pad' },
  { id: 'drawRuleArea', icon: 'drawRuleArea', title: 'Add a rule area (keepout)' },
  sep,
  { id: 'drawLine', icon: 'drawLine', title: 'Draw lines' },
  { id: 'drawArc', icon: 'drawArc', title: 'Draw arcs' },
  { id: 'drawRectangle', icon: 'drawRectangle', title: 'Draw rectangles' },
  { id: 'drawCircle', icon: 'drawCircle', title: 'Draw circles' },
  { id: 'drawPolygon', icon: 'drawPolygon', title: 'Draw graphic polygons' },
  { id: 'drawBezier', icon: 'drawBezier', title: 'Draw beziers' },
  { id: 'placeImage', icon: 'placeImage', title: 'Place reference images' },
  { id: 'placeText', icon: 'placeText', title: 'Add text' },
  { id: 'drawTextBox', icon: 'drawTextBox', title: 'Add text boxes' },
  { id: 'drawTable', icon: 'drawTable', title: 'Add tables' },
  { id: 'dimOrthogonal', icon: 'dimOrthogonal', title: 'Add orthogonal dimensions' },
  { id: 'dimAligned', icon: 'dimAligned', title: 'Add aligned dimensions' },
  { id: 'dimCenter', icon: 'dimCenter', title: 'Add center dimensions' },
  { id: 'dimRadial', icon: 'dimRadial', title: 'Add radial dimensions' },
  { id: 'dimLeader', icon: 'dimLeader', title: 'Add leaders' },
  { id: 'deleteTool', icon: 'deleteTool', title: 'Interactive delete tool' },
  sep,
  { id: 'placePoint', icon: 'placePoint', title: 'Place points' },
  { id: 'setAnchor', icon: 'setAnchor', title: 'Set the footprint anchor' },
  { id: 'gridOrigin', icon: 'gridOrigin', title: 'Set the grid origin point' },
  { id: 'measure', icon: 'measure', title: 'Measure distance' },
];
