/**
 * PCB editor toolbar layouts, transcribed from KiCad pcbnew's
 * `toolbars_pcb_editor.cpp` (PCB_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig,
 * TOOLBAR_LOC::LEFT / RIGHT / TOP_MAIN). Separators mirror AppendSeparator;
 * AppendGroup entries become ToolGroup palette buttons (ACTION_TOOLBAR
 * groups: one button showing the selected action, long-press for the rest).
 */

import type { ToolEntry } from '../../ui/Toolbar.js';

const sep: ToolEntry = 'sep';

/**
 * Not yet implemented in the web canvas — shown greyed in its upstream
 * position (repo convention) until each tool is ported end-to-end.
 */
const todo = { disabled: true } as const;

/** TOP_MAIN toolbar. */
export const PCB_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'new', icon: 'new', title: 'New board' },
  { id: 'open', icon: 'open', title: 'Open' },
  { id: 'save', icon: 'save', title: 'Save' },
  sep,
  { id: 'boardSetup', icon: 'boardSetup', title: 'Board setup' },
  sep,
  { id: 'pageSettings', icon: 'pageSettings', title: 'Page settings' },
  { id: 'print', icon: 'print', title: 'Print' },
  { id: 'plot', icon: 'plot', title: 'Plot' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'find', icon: 'find', title: 'Find' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit board' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects', title: 'Zoom to fit objects' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  { id: 'group', icon: 'group', title: 'Group items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup items' },
  { id: 'lock', icon: 'lock', title: 'Lock' },
  { id: 'unlock', icon: 'unlock', title: 'Unlock' },
  sep,
  { id: 'footprintEditor', icon: 'footprintEditor', title: 'Footprint Editor' },
  { id: 'footprintBrowser', icon: 'footprintBrowser', title: 'Footprint Library Browser' },
  { id: 'threeDViewer', icon: 'threeDViewer', title: '3D Viewer' },
  sep,
  { id: 'updatePcbFromSch', icon: 'updatePcbFromSch', title: 'Update PCB from schematic' },
  { id: 'runDRC', icon: 'runDRC', title: 'Design Rules Checker' },
  sep,
  { id: 'showEeschema', icon: 'showEeschema', title: 'Open schematic in Schematic Editor' },
];

/** LEFT (view options) toolbar. */
export const PCB_LEFT_TOOLBAR: ToolEntry[] = [
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
  { id: 'showRatsnest', icon: 'showRatsnest', title: 'Show ratsnest', toggle: true },
  {
    id: 'ratsnestLineMode',
    icon: 'ratsnestLineMode',
    title: 'Curved ratsnest lines',
    toggle: true,
  },
  sep,
  { id: 'highContrast', icon: 'highContrast', title: 'High-contrast display mode', toggle: true },
  {
    id: 'toggleNetHighlight',
    icon: 'toggleNetHighlight',
    title: 'Toggle net highlighting',
    toggle: true,
  },
  sep,
  {
    id: 'zoneDisplayFilled',
    icon: 'zoneDisplayFilled',
    title: 'Show filled areas of zones',
    toggle: true,
  },
  {
    id: 'zoneDisplayOutline',
    icon: 'zoneDisplayOutline',
    title: 'Show only zone boundaries',
    toggle: true,
  },
  sep,
  { id: 'padDisplayMode', icon: 'padDisplayMode', title: 'Sketch pads', toggle: true },
  { id: 'viaDisplayMode', icon: 'viaDisplayMode', title: 'Sketch vias', toggle: true },
  { id: 'trackDisplayMode', icon: 'trackDisplayMode', title: 'Sketch tracks', toggle: true },
  sep,
  {
    id: 'showLayersManager',
    icon: 'showLayersManager',
    title: 'Show Appearance manager',
    toggle: true,
  },
  { id: 'showProperties', icon: 'showProperties', title: 'Show Properties panel', toggle: true },
];

/**
 * RIGHT (tools) toolbar. Entries and grouping transcribed 1:1 from
 * PCB_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig, TOOLBAR_LOC::RIGHT.
 * Titles are TOOL_ACTION::GetButtonTooltip(): friendly name, default
 * hotkey in parentheses, then the tooltip line.
 */
export const PCB_RIGHT_TOOLBAR: ToolEntry[] = [
  {
    group: 'Selection modes',
    actions: [
      {
        id: 'selectSetRect',
        icon: 'selectSetRect',
        title: 'Rectangle\nSet selection mode to use rectangle',
      },
      {
        id: 'selectSetLasso',
        icon: 'selectSetLasso',
        title: 'Lasso\nSet selection mode to use polygon lasso',
        ...todo,
      },
    ],
  },
  {
    id: 'localRatsnestTool',
    icon: 'localRatsnestTool',
    title: 'Local Ratsnest\nToggle ratsnest display of selected item(s)',
  },
  sep,
  { id: 'placeFootprint', icon: 'placeFootprint', title: 'Place Footprints (A)', ...todo },
  {
    group: 'Track routing tools',
    actions: [
      {
        id: 'routeSingleTrack',
        icon: 'routeSingleTrack',
        title: 'Route Single Track (X)\nRoute tracks',
      },
      {
        id: 'routeDiffPair',
        icon: 'routeDiffPair',
        title: 'Route Differential Pair (6)\nRoute differential pairs',
        ...todo,
      },
    ],
  },
  {
    group: 'Track tuning tools',
    actions: [
      {
        id: 'tuneSingleTrack',
        icon: 'tuneSingleTrack',
        title: 'Tune Length of a Single Track (7)',
        ...todo,
      },
      {
        id: 'tuneDiffPair',
        icon: 'tuneDiffPair',
        title: 'Tune Length of a Differential Pair (8)',
        ...todo,
      },
      { id: 'tuneSkew', icon: 'tuneSkew', title: 'Tune Skew of a Differential Pair (9)', ...todo },
    ],
  },
  {
    id: 'showDiffPhaseSkew',
    icon: 'showDiffPhaseSkew',
    title: 'Show relative skew of diff pair tracks',
    ...todo,
  },
  {
    id: 'drawVia',
    icon: 'drawVia',
    title: 'Place Vias (Ctrl+Shift+X)\nPlace free-standing vias',
  },
  { id: 'drawZone', icon: 'drawZone', title: 'Draw Filled Zones (Ctrl+Shift+Z)' },
  { id: 'drawRuleArea', icon: 'drawRuleArea', title: 'Draw Rule Areas (Ctrl+Shift+K)', ...todo },
  sep,
  { id: 'drawLine', icon: 'drawLine', title: 'Draw Lines (Ctrl+Shift+L)' },
  {
    group: 'Arc',
    actions: [
      { id: 'drawArc', icon: 'drawArc', title: 'Draw Arcs (Ctrl+Shift+A)' },
      {
        id: 'drawEllipseArc',
        icon: 'drawEllipseArc',
        title: 'Draw Elliptical Arcs\nDraw an elliptical arc',
        ...todo,
      },
    ],
  },
  { id: 'drawRectangle', icon: 'drawRectangle', title: 'Draw Rectangles' },
  {
    group: 'Circle',
    actions: [
      { id: 'drawCircle', icon: 'drawCircle', title: 'Draw Circles (Ctrl+Shift+C)' },
      { id: 'drawEllipse', icon: 'drawEllipse', title: 'Draw Ellipse\nDraw an ellipse', ...todo },
    ],
  },
  {
    group: 'Constraints',
    actions: [
      {
        id: 'addConstraintCoincident',
        icon: 'addConstraintCoincident',
        title: 'Coincident...\nClick two shape endpoints to make them coincide',
        ...todo,
      },
      {
        id: 'addConstraintPointOnLine',
        icon: 'addConstraintPointOnLine',
        title:
          'Point on Line...\nClick an endpoint, then a segment or circle, to put the point on it',
        ...todo,
      },
      {
        id: 'addConstraintMidpoint',
        icon: 'addConstraintMidpoint',
        title: 'Midpoint...\nClick an endpoint, then a segment, to put the point at its midpoint',
        ...todo,
      },
      {
        id: 'addConstraintSymmetric',
        icon: 'addConstraintSymmetric',
        title: 'Symmetric...\nClick two endpoints, then a segment axis, to mirror them across it',
        ...todo,
      },
      {
        id: 'addConstraintParallel',
        icon: 'addConstraintParallel',
        title: 'Parallel\nConstrain the two selected segments to be parallel',
        ...todo,
      },
      {
        id: 'addConstraintPerpendicular',
        icon: 'addConstraintPerpendicular',
        title: 'Perpendicular\nConstrain the two selected segments to be perpendicular',
        ...todo,
      },
      {
        id: 'addConstraintCollinear',
        icon: 'addConstraintCollinear',
        title: 'Collinear\nConstrain the two selected segments to be collinear',
        ...todo,
      },
      {
        id: 'addConstraintHorizontal',
        icon: 'addConstraintHorizontal',
        title: 'Horizontal\nConstrain the selected segment to be horizontal',
        ...todo,
      },
      {
        id: 'addConstraintVertical',
        icon: 'addConstraintVertical',
        title: 'Vertical\nConstrain the selected segment to be vertical',
        ...todo,
      },
      {
        id: 'addConstraintTangent',
        icon: 'addConstraintTangent',
        title:
          'Tangent\nConstrain the selected line and curve, or two curves, to touch tangentially',
        ...todo,
      },
      {
        id: 'addConstraintEqualLength',
        icon: 'addConstraintEqualLength',
        title: 'Equal Length\nConstrain the two selected segments to be of equal length',
        ...todo,
      },
      {
        id: 'addConstraintEqualRadius',
        icon: 'addConstraintEqualRadius',
        title: 'Equal Radius\nConstrain the two selected circles or arcs to be of equal radius',
        ...todo,
      },
      {
        id: 'addConstraintConcentric',
        icon: 'addConstraintConcentric',
        title: 'Concentric\nConstrain the two selected circles, arcs or ellipses to share a center',
        ...todo,
      },
      {
        id: 'addConstraintFixedLength',
        icon: 'addConstraintFixedLength',
        title: 'Fixed Length\nLock the selected segment to its current length',
        ...todo,
      },
      {
        id: 'addConstraintFixedRadius',
        icon: 'addConstraintFixedRadius',
        title: 'Fixed Radius\nLock the selected circle or arc to its current radius',
        ...todo,
      },
      {
        id: 'addConstraintArcAngle',
        icon: 'addConstraintArcAngle',
        title: "Arc Angle\nDrive the selected arc's swept angle",
        ...todo,
      },
      {
        id: 'addConstraintAngular',
        icon: 'addConstraintAngular',
        title: 'Angular Dimension\nConstrain the angle between the two selected segments',
        ...todo,
      },
    ],
  },
  { id: 'drawPolygon', icon: 'drawPolygon', title: 'Draw Polygons (Ctrl+Shift+P)' },
  { id: 'drawBezier', icon: 'drawBezier', title: 'Draw Bezier Curve (Ctrl+Shift+B)', ...todo },
  {
    id: 'placeReferenceImage',
    icon: 'placeReferenceImage',
    title:
      'Place Reference Images\nAdd bitmap images to be used as reference (images will not be included in any output)',
    ...todo,
  },
  {
    group: 'Text objects',
    actions: [
      { id: 'placeText', icon: 'placeText', title: 'Draw Text (Ctrl+Shift+T)' },
      { id: 'drawTextBox', icon: 'drawTextBox', title: 'Draw Text Boxes', ...todo },
    ],
  },
  { id: 'drawTable', icon: 'drawTable', title: 'Draw Tables', ...todo },
  {
    group: 'Dimension objects',
    actions: [
      {
        id: 'drawOrthogonalDimension',
        icon: 'drawOrthogonalDimension',
        title: 'Draw Orthogonal Dimensions (Ctrl+Shift+H)',
        ...todo,
      },
      {
        id: 'drawAlignedDimension',
        icon: 'drawAlignedDimension',
        title: 'Draw Aligned Dimensions',
        ...todo,
      },
      {
        id: 'drawCenterDimension',
        icon: 'drawCenterDimension',
        title: 'Draw Center Dimensions',
        ...todo,
      },
      {
        id: 'drawRadialDimension',
        icon: 'drawRadialDimension',
        title: 'Draw Radial Dimensions',
        ...todo,
      },
      { id: 'drawLeader', icon: 'drawLeader', title: 'Draw Leaders', ...todo },
    ],
  },
  { id: 'placeBarcode', icon: 'placeBarcode', title: 'Add Barcode\nAdd a barcode', ...todo },
  { id: 'deleteTool', icon: 'deleteTool', title: 'Interactive Delete Tool\nDelete clicked items' },
  sep,
  {
    group: 'PCB origins and points',
    actions: [
      {
        id: 'gridSetOrigin',
        icon: 'gridSetOrigin',
        title: 'Grid Origin\nPlace the grid origin point',
        ...todo,
      },
      {
        id: 'drillOrigin',
        icon: 'drillOrigin',
        title:
          'Drill/Place File Origin\nPlace origin point for drill files and component placement files',
        ...todo,
      },
    ],
  },
  {
    id: 'placePoint',
    icon: 'placePoint',
    title: 'Place Point\nAdd reference/snap points',
    ...todo,
  },
  {
    id: 'measureTool',
    icon: 'measureTool',
    title: 'Measure Tool (Ctrl+Shift+M)\nInteractively measure distance between points',
  },
];

/**
 * Selection Filter categories, transcribed from pcbnew
 * panel_selection_filter_base.cpp. Rendered two columns row-major with the
 * "All items" checkbox occupying cell (0,0), which reproduces the exact
 * wxGridBagSizer positions: Locked items (0,1), Footprints (1,0), Text (1,1),
 * Tracks (2,0), Vias (2,1), Pads (3,0), Graphics (3,1), Zones (4,0),
 * Rule Areas (4,1), Dimensions (5,0), Other items (5,1), Points (6,0).
 * Keys follow PCB_SELECTION_FILTER_OPTIONS member names.
 */
export const PCB_FILTER_CATS: { key: string; label: string; tooltip?: string }[] = [
  { key: 'lockedItems', label: 'Locked items', tooltip: 'Allow selection of locked items' },
  { key: 'footprints', label: 'Footprints' },
  { key: 'text', label: 'Text' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'vias', label: 'Vias' },
  { key: 'pads', label: 'Pads' },
  { key: 'graphics', label: 'Graphics' },
  { key: 'zones', label: 'Zones' },
  { key: 'keepouts', label: 'Rule Areas' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'otherItems', label: 'Other items' },
  { key: 'points', label: 'Points' },
];
