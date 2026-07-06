/**
 * Toolbar layouts, transcribed from KiCad eeschema's `toolbars_sch_editor.cpp`
 * (TOP_MAIN, LEFT, RIGHT). Separators ('|') mark KiCad's AppendSeparator groups.
 * Each tool has the icon name, a tooltip, and whether it is a toggle (for the
 * left-hand view-option buttons).
 */

export interface ToolButton {
  id: string;
  icon: string;
  title: string;
  toggle?: boolean;
}

export type ToolEntry = ToolButton | 'sep';

const sep: ToolEntry = 'sep';

/** Top horizontal toolbar. */
export const TOP_TOOLBAR: ToolEntry[] = [
  { id: 'new', icon: 'new', title: 'New schematic' },
  { id: 'open', icon: 'open', title: 'Open' },
  { id: 'save', icon: 'save', title: 'Save' },
  sep,
  { id: 'schematicSetup', icon: 'setup', title: 'Schematic setup' },
  sep,
  { id: 'pageSettings', icon: 'page', title: 'Page settings' },
  { id: 'print', icon: 'print', title: 'Print' },
  { id: 'plot', icon: 'plot', title: 'Plot' },
  sep,
  { id: 'paste', icon: 'paste', title: 'Paste' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'find', icon: 'find', title: 'Find' },
  { id: 'findReplace', icon: 'replace', title: 'Find and replace' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit schematic' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects', title: 'Zoom to fit objects' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom tool' },
  sep,
  { id: 'navBack', icon: 'navBack', title: 'Leave sheet' },
  { id: 'navUp', icon: 'navUp', title: 'Up' },
  { id: 'navFwd', icon: 'navFwd', title: 'Forward' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  { id: 'group', icon: 'group', title: 'Group items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup items' },
  sep,
  { id: 'symbolEditor', icon: 'symbolEditor', title: 'Symbol editor' },
  { id: 'symbolBrowser', icon: 'symbolBrowser', title: 'Symbol browser' },
  { id: 'footprintEditor', icon: 'footprintEditor', title: 'Footprint editor' },
  sep,
  { id: 'annotate', icon: 'annotate', title: 'Annotate' },
  { id: 'erc', icon: 'erc', title: 'Electrical rules check' },
  { id: 'simulator', icon: 'simulator', title: 'Simulator' },
  { id: 'assignFootprints', icon: 'assignFp', title: 'Assign footprints' },
  { id: 'editSymbolFields', icon: 'fields', title: 'Edit symbol fields' },
  { id: 'bom', icon: 'bom', title: 'Generate BOM' },
  sep,
  { id: 'showPcbNew', icon: 'showPcbNew', title: 'Open PCB in board editor' },
];

/** Left vertical toolbar (display / edit options — mostly toggles). */
export const LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'grid', title: 'Toggle grid', toggle: true },
  { id: 'toggleGridOverrides', icon: 'gridOverride', title: 'Toggle grid overrides', toggle: true },
  sep,
  { id: 'unitsInches', icon: 'unitIn', title: 'Inches', toggle: true },
  { id: 'unitsMils', icon: 'unitMils', title: 'Mils', toggle: true },
  { id: 'unitsMm', icon: 'unitMm', title: 'Millimeters', toggle: true },
  sep,
  { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshair', toggle: true },
  { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-window crosshair', toggle: true },
  sep,
  { id: 'toggleHiddenPins', icon: 'hiddenPins', title: 'Show hidden pins', toggle: true },
  sep,
  { id: 'lineModeFree', icon: 'lineFree', title: 'Line mode: free angle', toggle: true },
  { id: 'lineMode90', icon: 'line90', title: 'Line mode: H/V', toggle: true },
  { id: 'lineMode45', icon: 'line45', title: 'Line mode: 45°', toggle: true },
  sep,
  { id: 'annotateAuto', icon: 'annotateAuto', title: 'Annotate automatically', toggle: true },
  sep,
  { id: 'showHierarchy', icon: 'hierarchy', title: 'Show hierarchy navigator', toggle: true },
  { id: 'showProperties', icon: 'properties', title: 'Show properties manager', toggle: true },
];

/** Right vertical toolbar (drawing / placement tools — radio selection). */
export const RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'selectRect', title: 'Select' },
  { id: 'highlightNet', icon: 'highlightNet', title: 'Highlight net' },
  sep,
  { id: 'placeSymbol', icon: 'symbol', title: 'Place symbol' },
  { id: 'placePower', icon: 'power', title: 'Place power port' },
  { id: 'drawWire', icon: 'wire', title: 'Draw wire' },
  { id: 'drawBus', icon: 'bus', title: 'Draw bus' },
  { id: 'busEntry', icon: 'busEntry', title: 'Place bus-to-wire entry' },
  { id: 'noConnect', icon: 'noConnect', title: 'Place no-connect flag' },
  { id: 'junction', icon: 'junction', title: 'Place junction' },
  { id: 'placeLabel', icon: 'labelLocal', title: 'Place local label' },
  { id: 'placeGlobalLabel', icon: 'labelGlobal', title: 'Place global label' },
  { id: 'placeHierLabel', icon: 'labelHier', title: 'Place hierarchical label' },
  { id: 'drawSheet', icon: 'sheet', title: 'Draw hierarchical sheet' },
  { id: 'sheetPin', icon: 'sheetPin', title: 'Place sheet pin' },
  sep,
  { id: 'placeText', icon: 'text', title: 'Place text' },
  { id: 'textBox', icon: 'textBox', title: 'Draw text box' },
  { id: 'table', icon: 'table', title: 'Draw table' },
  { id: 'rectangle', icon: 'rectangle', title: 'Draw rectangle' },
  { id: 'circle', icon: 'circle', title: 'Draw circle' },
  { id: 'arc', icon: 'arc', title: 'Draw arc' },
  { id: 'bezier', icon: 'bezier', title: 'Draw bezier' },
  { id: 'lines', icon: 'lines', title: 'Draw lines' },
  { id: 'image', icon: 'image', title: 'Place image' },
  sep,
  { id: 'delete', icon: 'delete', title: 'Delete' },
];

export const MENUS = ['File', 'Edit', 'View', 'Place', 'Inspect', 'Tools', 'Preferences', 'Help'];
