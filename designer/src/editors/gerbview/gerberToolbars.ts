/**
 * Gerber Viewer toolbar layouts, following GerbView's toolbar configuration
 * (`gerbview/toolbars_gerber.cpp` GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig):
 *
 *  - TOP:    load group (Gerber / job / drill / zip) | clear-all | export to
 *            PCB | print | zoom group | measure | (layer / DCode / highlight
 *            selectors render as combos next to the buttons);
 *  - LEFT:   grid | units radio | polar coords | full crosshair | flashed /
 *            lines / polygons sketch-mode toggles | show DCodes | show negative
 *            objects | diff mode | high-contrast | flip view | layer manager.
 *  - RIGHT:  selection tool | measure tool.
 */

import type { ToolEntry } from '../../ui/Toolbar.js';

const sep: ToolEntry = 'sep';

/** TOP main toolbar (button portion; the combos render separately). */
export const GBR_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'gerbOpen', icon: 'gerbOpen', title: 'Open Gerber file(s)' },
  { id: 'gerbOpenJob', icon: 'gerbOpenJob', title: 'Open Gerber job file' },
  { id: 'gerbOpenDrill', icon: 'gerbOpenDrill', title: 'Open Excellon drill file(s)' },
  { id: 'gerbOpenZip', icon: 'gerbOpenZip', title: 'Open zip archive of Gerber/drill files' },
  sep,
  { id: 'gerbClear', icon: 'gerbClear', title: 'Clear all layers' },
  { id: 'gerbReload', icon: 'gerbReload', title: 'Reload all layers' },
  { id: 'gerbExportToPcb', icon: 'gerbExportToPcb', title: 'Export to Pcbnew' },
  sep,
  { id: 'print', icon: 'print', title: 'Print layers' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
];

/** LEFT display-options toolbar. */
export const GBR_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  sep,
  { id: 'unitsMm', icon: 'unitsMm', title: 'Display units in millimetres', toggle: true },
  { id: 'unitsInches', icon: 'unitsInches', title: 'Display units in inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Display units in mils', toggle: true },
  sep,
  { id: 'togglePolar', icon: 'gerbTogglePolar', title: 'Display polar coordinates', toggle: true },
  {
    id: 'crosshairFull',
    icon: 'crosshairFull',
    title: 'Show full-window crosshair',
    toggle: true,
  },
  sep,
  {
    id: 'flashedSketch',
    icon: 'gerbFlashedSketch',
    title: 'Show flashed items in outline (sketch) mode',
    toggle: true,
  },
  {
    id: 'linesSketch',
    icon: 'gerbLinesSketch',
    title: 'Show lines in outline (sketch) mode',
    toggle: true,
  },
  {
    id: 'polygonsSketch',
    icon: 'gerbPolygonsSketch',
    title: 'Show polygons in outline (sketch) mode',
    toggle: true,
  },
  sep,
  {
    id: 'showDcodes',
    icon: 'gerbShowDcodes',
    title: 'Show DCode numbers',
    toggle: true,
  },
  {
    id: 'showNegativeObjects',
    icon: 'gerbNegativeObjects',
    title: 'Show negative objects in a ghost colour',
    toggle: true,
  },
  sep,
  {
    id: 'diffMode',
    icon: 'gerbDiffMode',
    title: 'Show layers in differential mode',
    toggle: true,
  },
  {
    id: 'highContrast',
    icon: 'gerbHighContrast',
    title: 'Enable high-contrast mode (dim inactive layers)',
    toggle: true,
  },
  {
    id: 'flipView',
    icon: 'gerbFlipView',
    title: 'Flip view (mirror horizontally)',
    toggle: true,
  },
  sep,
  {
    id: 'showLayerManager',
    icon: 'gerbLayerManager',
    title: 'Show/hide the layers manager',
    toggle: true,
  },
];

/** RIGHT tool toolbar: selection and measure. */
export const GBR_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item' },
  sep,
  { id: 'measure', icon: 'gerbMeasure', title: 'Measure distance between two points' },
];
