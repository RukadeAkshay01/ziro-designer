/**
 * Schematic editor toolbar layouts. Counterpart: `eeschema/
 * toolbars_sch_editor.cpp` (SCH_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig),
 * transcribed exactly for the project-manager case (our editors always live
 * under the launcher, like KiCad frames under the project manager — so no
 * New/Open on the top toolbar). Separators mark AppendSeparator groups; a
 * TOOLBAR_GROUP_CONFIG palette renders flat, in group order, for now.
 *
 * Titles are the upstream action FriendlyNames with the default hotkey in
 * parentheses, matching KiCad's tooltips. Buttons whose feature is not
 * implemented yet are `disabled` (greyed in place, like the menu bar).
 */

import type { ToolEntry } from '../../ui/Toolbar.js';

const sep: ToolEntry = 'sep';

/** Top horizontal toolbar (TOOLBAR_LOC::TOP_MAIN). */
export const TOP_TOOLBAR: ToolEntry[] = [
  { id: 'save', icon: 'save', title: 'Save (Ctrl+S)' },
  sep,
  { id: 'schematicSetup', icon: 'setup', title: 'Schematic Setup...', disabled: true },
  sep,
  { id: 'pageSettings', icon: 'page', title: 'Page Settings...' },
  { id: 'print', icon: 'print', title: 'Print... (Ctrl+P)' },
  { id: 'plot', icon: 'plot', title: 'Plot...' },
  sep,
  { id: 'paste', icon: 'paste', title: 'Paste (Ctrl+V)' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo (Ctrl+Z)' },
  { id: 'redo', icon: 'redo', title: 'Redo (Ctrl+Shift+Z)' },
  sep,
  { id: 'find', icon: 'find', title: 'Find (Ctrl+F)' },
  { id: 'findReplace', icon: 'replace', title: 'Find and Replace (Ctrl+Alt+F)' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh (Ctrl+R)' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom Out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to Fit (Ctrl+0)' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects', title: 'Zoom to All Objects (Ctrl+Home)' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to Selection Area (Ctrl+F5)' },
  sep,
  { id: 'navBack', icon: 'navBack', title: 'Navigate Back (Alt+Left)' },
  { id: 'navUp', icon: 'navUp', title: 'Navigate Up (Alt+Up)' },
  { id: 'navFwd', icon: 'navFwd', title: 'Navigate Forward (Alt+Right)' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate Counterclockwise (R)' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate Clockwise (Shift+R)' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror Vertically (Y)' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror Horizontally (X)' },
  { id: 'group', icon: 'group', title: 'Group Items', disabled: true },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup Items', disabled: true },
  sep,
  { id: 'symbolEditor', icon: 'symbolEditor', title: 'Symbol Editor' },
  { id: 'symbolBrowser', icon: 'symbolBrowser', title: 'Symbol Library Browser', disabled: true },
  { id: 'footprintEditor', icon: 'footprintEditor', title: 'Footprint Editor', disabled: true },
  sep,
  { id: 'annotate', icon: 'annotate', title: 'Annotate Schematic...' },
  { id: 'erc', icon: 'erc', title: 'Electrical Rules Checker' },
  { id: 'simulator', icon: 'simulator', title: 'Simulator', disabled: true },
  { id: 'assignFootprints', icon: 'assignFp', title: 'Assign Footprints...', disabled: true },
  { id: 'editSymbolFields', icon: 'fields', title: 'Bulk Edit Symbol Fields...', disabled: true },
  { id: 'bom', icon: 'bom', title: 'Generate Bill of Materials...', disabled: true },
  sep,
  { id: 'showPcbNew', icon: 'showPcbNew', title: 'Switch to PCB Editor' },
];

/** Left vertical toolbar (TOOLBAR_LOC::LEFT — display/edit option toggles). */
export const LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'grid', title: 'Show Grid', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'gridOverride',
    title: 'Grid Overrides (Ctrl+Shift+G)',
    toggle: true,
  },
  { id: 'unitsInches', icon: 'unitIn', title: 'Inches', toggle: true },
  { id: 'unitsMils', icon: 'unitMils', title: 'Mils', toggle: true },
  { id: 'unitsMm', icon: 'unitMm', title: 'Millimeters', toggle: true },
  { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshairs', toggle: true },
  { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-Window Crosshairs', toggle: true },
  { id: 'crosshair45', icon: 'crosshair45', title: '45 Degree Crosshairs', toggle: true },
  sep,
  { id: 'toggleHiddenPins', icon: 'hiddenPins', title: 'Show Hidden Pins', toggle: true },
  sep,
  {
    id: 'lineModeFree',
    icon: 'lineFree',
    title: 'Line Mode for Wires and Buses: free angle',
    toggle: true,
  },
  {
    id: 'lineMode90',
    icon: 'line90',
    title: 'Line Mode for Wires and Buses: 90°',
    toggle: true,
  },
  {
    id: 'lineMode45',
    icon: 'line45',
    title: 'Line Mode for Wires and Buses: 45°',
    toggle: true,
  },
  sep,
  { id: 'annotateAuto', icon: 'annotateAuto', title: 'Annotate Automatically', toggle: true },
  sep,
  { id: 'showHierarchy', icon: 'hierarchy', title: 'Hierarchy Navigator (Ctrl+H)', toggle: true },
  { id: 'showProperties', icon: 'properties', title: 'Properties', toggle: true },
];

/** Right vertical toolbar (TOOLBAR_LOC::RIGHT — drawing/placement tools). */
export const RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'selectRect', title: 'Select item(s): Rectangle' },
  { id: 'selectLasso', icon: 'selectLasso', title: 'Select item(s): Lasso' },
  { id: 'highlightNet', icon: 'highlightNet', title: 'Highlight Nets' },
  sep,
  { id: 'placeSymbol', icon: 'symbol', title: 'Place Symbols (A)' },
  { id: 'placePower', icon: 'power', title: 'Place Power Symbols (P)' },
  { id: 'drawWire', icon: 'wire', title: 'Draw Wires (W)' },
  { id: 'drawBus', icon: 'bus', title: 'Draw Buses (B)' },
  { id: 'busEntry', icon: 'busEntry', title: 'Place Wire to Bus Entries (Z)' },
  { id: 'noConnect', icon: 'noConnect', title: 'Place No Connect Flags (Q)' },
  { id: 'junction', icon: 'junction', title: 'Place Junctions (J)' },
  { id: 'placeLabel', icon: 'labelLocal', title: 'Place Net Labels (L)' },
  {
    id: 'placeClassLabel',
    icon: 'labelClass',
    title: 'Place Directive Labels',
    disabled: true,
  },
  { id: 'placeGlobalLabel', icon: 'labelGlobal', title: 'Place Global Labels (Ctrl+L)' },
  { id: 'placeHierLabel', icon: 'labelHier', title: 'Place Hierarchical Labels (H)' },
  { id: 'drawRuleArea', icon: 'ruleArea', title: 'Draw Rule Areas', disabled: true },
  { id: 'drawSheet', icon: 'sheet', title: 'Draw Hierarchical Sheets (S)' },
  { id: 'sheetPin', icon: 'sheetPin', title: 'Place Pins from Sheet' },
  {
    id: 'syncAllSheetsPins',
    icon: 'syncSheetPins',
    title: 'Sync All Sheet Pins...',
    disabled: true,
  },
  sep,
  { id: 'placeText', icon: 'text', title: 'Draw Text (T)' },
  { id: 'textBox', icon: 'textBox', title: 'Draw Text Boxes' },
  { id: 'table', icon: 'table', title: 'Draw Tables' },
  { id: 'rectangle', icon: 'rectangle', title: 'Draw Rectangles' },
  { id: 'circle', icon: 'circle', title: 'Draw Circles' },
  { id: 'arc', icon: 'arc', title: 'Draw Arcs' },
  { id: 'bezier', icon: 'bezier', title: 'Draw Bezier Curve' },
  { id: 'lines', icon: 'lines', title: 'Draw Lines (I)' },
  { id: 'image', icon: 'image', title: 'Place Images' },
  { id: 'delete', icon: 'delete', title: 'Interactive Delete Tool' },
];
