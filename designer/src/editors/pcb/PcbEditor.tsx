/**
 * PCB Editor: the pcbnew frame replicated — menu bar (menubar_pcb_editor.cpp),
 * top/left/right toolbars (toolbars_pcb_editor.cpp), the docked Appearance
 * manager with Layers / Objects / Nets tabs and layer presets
 * (widgets/appearance_controls.cpp), the Selection Filter panel, and the
 * PCB_PAINTER canvas (renderBoard.ts). Board editing tools are staged; the
 * viewer pipeline, layer/object controls and presets are fully functional.
 */

import { iuToMM } from '@ziroeda/common';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  boardHitCandidates,
  boardItemsInBox,
  boardItemBBox,
  parseBoardItemId,
  moveBoardItems,
  dragBoardItems,
  setFootprintField,
  setFootprintLocked,
  setFootprintOrientation,
  connectedTrackEnds,
  boardItemId,
  subsetBoardItems,
  deleteBoardItems,
  rotateBoardItems,
  duplicateBoardItems,
  mirrorBoardItems,
  groupBoardItems,
  ungroupBoardItems,
  expandGroupIds,
  groupContaining,
  setBoardItemsLocked,
  isBoardItemLocked,
  serializeBoard,
  buildRatsnest,
  addBoardShape,
  addBoardTrack,
  addBoardVia,
  addBoardText,
  addBoardZone,
  type RatsnestEdge,
  type Board,
  type BoardBBox,
  type BoardItemKind,
  type PcbFootprint,
  type PcbShape,
  type PcbPad,
  type PcbTrack,
  type PcbArcTrack,
  type PcbVia,
  type PcbZone,
} from '@ziroeda/pcbnew';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { DialogPcbFind, DEFAULT_PCB_FIND, type PcbFindOptions } from './dialogs/dialog_find.js';
import {
  buildScene,
  buildDrawSteps,
  drawBoard,
  drawGrid,
  drawDrawingSheet,
  DEFAULT_GRID_OPTIONS,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type PcbDrawOptions,
} from './renderBoard.js';
import type { Viewer3D } from './pcb3d.js';
import { layerColor, PCB_CURSOR, PCB_OBJECT_COLORS, PCB_SPECIAL } from './pcbTheme.js';
import {
  PCB_TOP_TOOLBAR,
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
  PCB_FILTER_CATS,
} from './pcbToolbars.js';
import '../../ui/shell.css';

const MM = 10000;

// pcb_painter.cpp getColor: a selected item is drawn in its layer colour
// Brightened(0.8) (per channel c·0.2 + 0.8), i.e. pushed 80% toward white.
const SELECT_BRIGHTEN = 0.8;

// Snap a world point to the active grid (GAL GetGridPoint). Shared by the
// crosshair and the move so a dragged item follows the snapped crosshair and
// lands on grid nodes, like KiCad (edit_tool_move_fct.cpp: m_cursor =
// grid.BestSnapAnchor(mousePos); movement = m_cursor - prevPos).
const snapToGrid = (p: { x: number; y: number }): { x: number; y: number } => {
  const { size, origin } = DEFAULT_GRID_OPTIONS;
  return {
    x: Math.round((p.x - origin.x) / size) * size + origin.x,
    y: Math.round((p.y - origin.y) / size) * size + origin.y,
  };
};

// Visibility (eye) toggle, drawn inline so it always renders (no asset-URL
// resolution) and reads as KiCad's light-grey eye on the dark panel. `on`
// draws the open eye; off draws it struck through and dimmed
// (APPEARANCE_CONTROLS' BITMAP_TOGGLE visible/not-visible bitmaps).
function EyeIcon({ on }: { on: boolean }): JSX.Element {
  return (
    <svg
      className="ze-eye"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      style={{ opacity: on ? 1 : 0.4 }}
    >
      <path
        d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      {!on && <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

// The graphic-shape drawing tools (DRAWING_TOOL) and the PcbShape kind each
// one creates.
const DRAW_SHAPE_TOOLS: Record<string, PcbShape['kind']> = {
  drawLine: 'line',
  drawArc: 'arc',
  drawRectangle: 'rect',
  drawCircle: 'circle',
  drawPolygon: 'poly',
};

// Friendly names for the "Current Tool" status-bar field (field 6), shown while
// a right-toolbar tool is active (EDA_DRAW_FRAME::DisplayToolMsg). The selection
// tool leaves the field blank, exactly like KiCad.
const PCB_TOOL_MSGS: Record<string, string> = {
  // The selection tool shows "Select item(s)" (PCB_SELECTION_TOOL's tool message).
  selectSetRect: 'Select item(s)',
  selectSetLasso: 'Select item(s)',
  routeSingleTrack: 'Route Single Track',
  drawVia: 'Add Via',
  drawZone: 'Add Filled Zone',
  drawLine: 'Draw Line',
  drawArc: 'Draw Arc',
  drawRectangle: 'Draw Rectangle',
  drawCircle: 'Draw Circle',
  drawPolygon: 'Draw Polygon',
  placeText: 'Add Text',
  measureTool: 'Measure Tool',
  deleteTool: 'Delete Items',
  localRatsnestTool: 'Local Ratsnest',
};

// Tools that act on plain clicks and take no drag/box-select gestures.
const isClickTool = (t: string): boolean =>
  t === 'deleteTool' ||
  t === 'localRatsnestTool' ||
  t === 'routeSingleTrack' ||
  t === 'drawVia' ||
  t === 'placeText' ||
  t === 'drawZone' ||
  t === 'measureTool' ||
  !!DRAW_SHAPE_TOOLS[t];

// Default graphic line widths per layer class, in IU
// (board_design_settings.h DEFAULT_*_WIDTH, in mm).
const defaultShapeWidth = (layer: string): number => {
  if (/\.SilkS$/.test(layer)) return 0.1 * MM;
  if (/\.Cu$/.test(layer)) return 0.2 * MM;
  if (layer === 'Edge.Cuts' || /\.CrtYd$/.test(layer)) return 0.05 * MM;
  return 0.1 * MM;
};

type AlignAction = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
type MsgPanelItem = { upper: string; lower: string };

const bboxCenter = (b: BoardBBox): { x: number; y: number } => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

const bboxContainsPoint = (b: BoardBBox, p: { x: number; y: number }): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

// Circumcenter of three points, or null when they are (nearly) collinear.
const circumcenter = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number } | null => {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-3) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
};

// Trace the arc through start→mid→end on the 2D context (world coords).
const traceArc3 = (
  ctx: CanvasRenderingContext2D,
  s: { x: number; y: number },
  m: { x: number; y: number },
  e: { x: number; y: number },
): void => {
  const o = circumcenter(s, m, e);
  if (!o) {
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    return;
  }
  const r = Math.hypot(s.x - o.x, s.y - o.y);
  const a0 = Math.atan2(s.y - o.y, s.x - o.x);
  const a1 = Math.atan2(m.y - o.y, m.x - o.x);
  const a2 = Math.atan2(e.y - o.y, e.x - o.x);
  // Pick the sweep direction that passes through the mid point.
  const ccwSpan = (from: number, to: number): number => {
    let d = from - to;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const ccw = ccwSpan(a0, a1) <= ccwSpan(a0, a2);
  ctx.moveTo(s.x, s.y);
  ctx.arc(o.x, o.y, r, a0, a2, ccw);
};

// Left-toolbar radio groups (same convention as the schematic editor).
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];
const DEFAULT_TOGGLES = new Set([
  'toggleGrid',
  'unitsMm',
  'crosshairSmall',
  'lineMode90',
  'ratsnestLineMode',
  'zoneDisplayFilled',
  'showLayersManager',
  'showProperties',
]);

// Objects tab rows, exactly appearance_controls.cpp s_objectSettings
// (label / tooltip / opacity slider / visibility checkbox). Rows whose
// rendering isn't ported yet are greyed in their upstream position.
type ObjectRow =
  | 'sep'
  | {
      key: keyof ObjectState;
      label: string;
      tooltip: string;
      slider?: boolean;
      noVisibility?: boolean;
      disabled?: boolean;
    };
const OBJECT_ROWS: ObjectRow[] = [
  { key: 'tracks', label: 'Tracks', tooltip: 'Show tracks', slider: true },
  { key: 'vias', label: 'Vias', tooltip: 'Show all vias', slider: true },
  { key: 'pads', label: 'Pads', tooltip: 'Show all pads', slider: true },
  { key: 'zones', label: 'Zones', tooltip: 'Show copper zones', slider: true },
  {
    key: 'filledShapes',
    label: 'Filled Shapes',
    tooltip: 'Opacity of filled shapes',
    slider: true,
    noVisibility: true,
  },
  { key: 'images', label: 'Images', tooltip: 'Show user images', slider: true, disabled: true },
  'sep',
  {
    key: 'footprintsFront',
    label: 'Footprints Front',
    tooltip: "Show footprints that are on board's front",
  },
  {
    key: 'footprintsBack',
    label: 'Footprints Back',
    tooltip: "Show footprints that are on board's back",
  },
  { key: 'fpValues', label: 'Values', tooltip: 'Show footprint values' },
  { key: 'fpReferences', label: 'References', tooltip: 'Show footprint references' },
  { key: 'fpText', label: 'Footprint Text', tooltip: 'Show all footprint text' },
  'sep',
  'sep',
  {
    key: 'ratsnest',
    label: 'Ratsnest',
    tooltip: 'Show unconnected nets as a ratsnest',
  },
  {
    key: 'drcWarnings',
    label: 'DRC Warnings',
    tooltip: 'DRC violations with a Warning severity',
    disabled: true,
  },
  {
    key: 'drcErrors',
    label: 'DRC Errors',
    tooltip: 'DRC violations with an Error severity',
    disabled: true,
  },
  {
    key: 'drcExclusions',
    label: 'DRC Exclusions',
    tooltip: 'DRC violations which have been individually excluded',
    disabled: true,
  },
  {
    key: 'anchors',
    label: 'Anchors',
    tooltip: 'Show footprint and text origins as a cross',
    disabled: true,
  },
  {
    key: 'points',
    label: 'Points',
    tooltip: 'Show explicit snap points as crosses',
    disabled: true,
  },
  {
    key: 'lockedShadow',
    label: 'Locked Item Shadow',
    tooltip: 'Show a shadow on locked items',
    disabled: true,
  },
  {
    key: 'collidingCourtyards',
    label: 'Colliding Courtyards',
    tooltip: 'Show colliding footprint courtyards',
    disabled: true,
  },
  {
    key: 'constrainedShadow',
    label: 'Constrained Item Shadow',
    tooltip: 'Show a shadow on constrained items',
    disabled: true,
  },
  {
    key: 'boardAreaShadow',
    label: 'Board Area Shadow',
    tooltip: 'Show board area shadow',
    disabled: true,
  },
  {
    key: 'drawingSheet',
    label: 'Drawing Sheet',
    tooltip: 'Show drawing sheet borders and title block',
  },
  { key: 'grid', label: 'Grid', tooltip: 'Show the (x,y) grid dots' },
];

interface ObjectState {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
  filledShapes: boolean;
  images: boolean;
  footprintsFront: boolean;
  footprintsBack: boolean;
  fpValues: boolean;
  fpReferences: boolean;
  fpText: boolean;
  ratsnest: boolean;
  drcWarnings: boolean;
  drcErrors: boolean;
  drcExclusions: boolean;
  anchors: boolean;
  points: boolean;
  lockedShadow: boolean;
  collidingCourtyards: boolean;
  constrainedShadow: boolean;
  boardAreaShadow: boolean;
  drawingSheet: boolean;
  grid: boolean;
}
const DEFAULT_OBJECTS: ObjectState = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  filledShapes: true,
  images: true,
  footprintsFront: true,
  footprintsBack: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  ratsnest: true,
  drcWarnings: true,
  drcErrors: true,
  drcExclusions: true,
  anchors: true,
  points: true,
  lockedShadow: true,
  collidingCourtyards: true,
  constrainedShadow: true,
  boardAreaShadow: true,
  drawingSheet: true,
  grid: true,
};
// project_local_settings.cpp defaults.
const DEFAULT_OPACITY = {
  tracks: 1.0,
  vias: 1.0,
  pads: 1.0,
  zones: 0.6,
  filledShapes: 1.0,
  images: 0.6,
};

// Technical layers in the Layers tab, exactly rebuildLayers()'s non_cu_seq
// order with its tooltips (appearance_controls.cpp).
const NON_CU_SEQ: [string, string][] = [
  ['F.Adhes', "Adhesive on board's front"],
  ['B.Adhes', "Adhesive on board's back"],
  ['F.Paste', "Solder paste on board's front"],
  ['B.Paste', "Solder paste on board's back"],
  ['F.SilkS', "Silkscreen on board's front"],
  ['B.SilkS', "Silkscreen on board's back"],
  ['F.Mask', "Solder mask on board's front"],
  ['B.Mask', "Solder mask on board's back"],
  ['Dwgs.User', 'Explanatory drawings'],
  ['Cmts.User', 'Explanatory comments'],
  ['Eco1.User', 'User defined meaning'],
  ['Eco2.User', 'User defined meaning'],
  ['Edge.Cuts', "Board's perimeter definition"],
  ['Margin', "Board's edge setback outline"],
  ['F.CrtYd', "Footprint courtyards on board's front"],
  ['B.CrtYd', "Footprint courtyards on board's back"],
  ['F.Fab', "Footprint assembly on board's front"],
  ['B.Fab', "Footprint assembly on board's back"],
];
const layerTooltip = (name: string): string => {
  const t = NON_CU_SEQ.find(([n]) => n === name);
  if (t) return t[1];
  if (name === 'F.Cu') return 'Front copper layer';
  if (name === 'B.Cu') return 'Back copper layer';
  if (/\.Cu$/.test(name)) return 'Inner copper layer';
  if (/^User\.(\d+)$/.test(name)) return `User defined layer ${name.slice(5)}`;
  return '';
};

// User-facing layer names, as the Appearance panel shows them (LayerName() in
// layer_id.cpp: F.Adhesive, User.Drawings… — not the file's canonical tokens).
const LAYER_DISPLAY_NAMES: Record<string, string> = {
  'F.Adhes': 'F.Adhesive',
  'B.Adhes': 'B.Adhesive',
  'F.SilkS': 'F.Silkscreen',
  'B.SilkS': 'B.Silkscreen',
  'Dwgs.User': 'User.Drawings',
  'Cmts.User': 'User.Comments',
  'Eco1.User': 'User.Eco1',
  'Eco2.User': 'User.Eco2',
  'F.CrtYd': 'F.Courtyard',
  'B.CrtYd': 'B.Courtyard',
};

// Wildcard match for netclass_patterns ('*' and '?', like EDA_COMBINED_MATCHER).
const wildcardMatch = (pattern: string, s: string): boolean => {
  const rx = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );
  return rx.test(s);
};

// Routing dimensions of a net class (netclass.cpp defaults, in IU).
interface ClassDims {
  trackWidth: number;
  viaDiameter: number;
  viaDrill: number;
}
const DEFAULT_CLASS_DIMS: ClassDims = {
  trackWidth: 0.2 * MM,
  viaDiameter: 0.6 * MM,
  viaDrill: 0.3 * MM,
};

/** Net classes from the project file (net_settings in .kicad_pro). */
function parseNetclasses(files?: { name: string; text: string }[]): {
  classes: string[];
  classColors: Map<string, string>;
  classDims: Map<string, ClassDims>;
  patterns: { netclass: string; pattern: string }[];
} {
  const out = {
    classes: ['Default'],
    classColors: new Map<string, string>(),
    classDims: new Map<string, ClassDims>(),
    patterns: [] as { netclass: string; pattern: string }[],
  };
  const pro = files?.find((f) => f.name.endsWith('.kicad_pro'));
  if (!pro) return out;
  try {
    const json = JSON.parse(pro.text) as {
      net_settings?: {
        classes?: {
          name?: string;
          pcb_color?: string;
          track_width?: number;
          via_diameter?: number;
          via_drill?: number;
        }[];
        netclass_patterns?: { netclass?: string; pattern?: string }[];
      };
    };
    const ns = json.net_settings;
    for (const c of ns?.classes ?? []) {
      if (!c.name) continue;
      if (!out.classes.includes(c.name)) out.classes.push(c.name);
      // "rgb(0, 0, 0)"/alpha 0 means unset in the project file.
      if (c.pcb_color && !/rgba?\(\s*0,\s*0,\s*0,?\s*0(\.0+)?\s*\)/.test(c.pcb_color))
        out.classColors.set(c.name, c.pcb_color);
      // Project-file dimensions are in mm.
      out.classDims.set(c.name, {
        trackWidth: c.track_width ? c.track_width * MM : DEFAULT_CLASS_DIMS.trackWidth,
        viaDiameter: c.via_diameter ? c.via_diameter * MM : DEFAULT_CLASS_DIMS.viaDiameter,
        viaDrill: c.via_drill ? c.via_drill * MM : DEFAULT_CLASS_DIMS.viaDrill,
      });
    }
    for (const p of ns?.netclass_patterns ?? []) {
      if (p.netclass && p.pattern) out.patterns.push({ netclass: p.netclass, pattern: p.pattern });
    }
  } catch {
    // Malformed project file: fall back to Default only.
  }
  return out;
}

// Builtin layer presets (appearance_controls.cpp preset* + common/lset.cpp masks).
const FRONT_TECH = ['F.SilkS', 'F.Mask', 'F.Adhes', 'F.Paste', 'F.CrtYd', 'F.Fab'];
const BACK_TECH = ['B.SilkS', 'B.Mask', 'B.Adhes', 'B.Paste', 'B.CrtYd', 'B.Fab'];
const PRESETS: { name: string; layers: (all: string[], copper: string[]) => string[] }[] = [
  { name: 'All Layers', layers: (all) => all },
  { name: 'No Layers', layers: () => [] },
  { name: 'All Copper Layers', layers: (_a, cu) => [...cu, 'Edge.Cuts'] },
  {
    name: 'Inner Copper Layers',
    layers: (_a, cu) => [...cu.filter((c) => /^In/.test(c)), 'Edge.Cuts'],
  },
  { name: 'Front Layers', layers: () => ['F.Cu', ...FRONT_TECH, 'Edge.Cuts'] },
  {
    name: 'Front Assembly View',
    layers: () => ['F.SilkS', 'F.Mask', 'F.Fab', 'F.CrtYd', 'Edge.Cuts'],
  },
  { name: 'Back Layers', layers: () => ['B.Cu', ...BACK_TECH, 'Edge.Cuts'] },
  {
    name: 'Back Assembly View',
    layers: () => ['B.SilkS', 'B.Mask', 'B.Fab', 'B.CrtYd', 'Edge.Cuts'],
  },
];

export function PcbEditor({
  fileName,
  text,
  onExit,
  onShowSchematic,
  projectName,
  projectFiles,
}: {
  fileName: string;
  text: string;
  onExit: () => void;
  onShowSchematic?: () => void;
  /** Project name shown as "<project> — PCB Editor" in the menu bar. */
  projectName?: string;
  /** The open project's files (name + text) — lets the 3D viewer resolve
   *  ${KIPRJMOD}/relative model references to project-bundled files. */
  projectFiles?: { name: string; text: string }[];
}): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  // Selected layer preset; '---' is the separator row, the default selection
  // like rebuildLayerPresetsWidget.
  const [preset, setPreset] = useState('---');
  const [tab, setTab] = useState<'Layers' | 'Objects' | 'Nets'>('Layers');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  // Properties pane width. KiCad's PCB_PROPERTIES_PANEL docks at BestSize 300,
  // MinSize 240 (pcb_edit_frame.cpp), and the pane is user-resizable.
  const [propWidth, setPropWidth] = useState(300);
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  // Appearance pane width: KiCad's LayersManager AUI pane (BestSize ~220, but
  // our rows carry a swatch + eye + label + slider, so start a little wider so
  // the opacity sliders and the net-display radios fit on one line).
  const [appWidth, setAppWidth] = useState(255);
  // High-contrast (inactive layer) mode: HIGH_CONTRAST_MODE Normal/Dim/Hide.
  const [contrast, setContrast] = useState<'normal' | 'dim' | 'hide'>('normal');
  // "Flip board view" (PCB_ACTIONS::flipBoard): mirror the view horizontally.
  const [flipView, setFlipView] = useState(false);
  // "Layer Display Options" collapsible pane state (collapsed by default).
  const [layerOptsOpen, setLayerOptsOpen] = useState(false);
  // Layer right-click context menu position (rightClickHandler).
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number } | null>(null);
  // User layer presets (saved from "Save preset...").
  const [userPresets, setUserPresets] = useState<{ name: string; layers: string[] }[]>([]);
  // Viewports (APPEARANCE_CONTROLS::m_viewports): named view transforms.
  const [viewports, setViewports] = useState<
    { name: string; view: { tx: number; ty: number; scale: number } }[]
  >([]);
  const [viewportSel, setViewportSel] = useState('---');
  // "Delete preset/viewport..." chooser popup.
  const [deleteChooser, setDeleteChooser] = useState<'presets' | 'viewports' | null>(null);
  // Nets tab state: per-net / per-class colors, ratsnest visibility, and the
  // Net Display Options modes (appearance_controls.cpp net display pane).
  const [netColors, setNetColors] = useState<ReadonlyMap<number, string>>(new Map());
  const [hiddenNets, setHiddenNets] = useState<ReadonlySet<number>>(new Set());
  const [classColors, setClassColors] = useState<ReadonlyMap<string, string>>(new Map());
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set());
  const [netColorMode, setNetColorMode] = useState<'all' | 'ratsnest' | 'off'>('ratsnest');
  const [ratsnestMode, setRatsnestMode] = useState<'all' | 'visible' | 'off'>('all');
  const [netOptsOpen, setNetOptsOpen] = useState(false);
  // Footprints whose local ratsnest is forced on (PCB_ACTIONS::localRatsnestTool).
  const [localRats, setLocalRats] = useState<ReadonlySet<number>>(new Set());
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(PCB_FILTER_CATS.map((c) => c.key)),
  );
  // Right-click "Only <category>" popup of the Selection Filter panel
  // (PANEL_SELECTION_FILTER::onRightClick).
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    key: string;
    label: string;
  } | null>(null);
  const [netQuery, setNetQuery] = useState('');
  // Net highlight (BOARD_INSPECTION_TOOL): the set of net codes currently
  // highlighted. When non-empty the whole board dims and these nets' copper
  // pops (pcb_painter.cpp getColor: highlighted → Brightened, else Darkened).
  // Picked with the backtick hotkey / cleared with '~'; the left-toolbar
  // "Toggle Net Highlight" button shows/hides the last highlight set.
  const [highlightNets, setHighlightNets] = useState<ReadonlySet<number>>(new Set());
  const highlightNetsRef = useRef<ReadonlySet<number>>(highlightNets);
  highlightNetsRef.current = highlightNets;
  // The previously-shown highlight set, restored by the toggle button/Alt+`
  // (BOARD_INSPECTION_TOOL::m_lastHighlighted).
  const lastHighlightRef = useRef<ReadonlySet<number>>(new Set());
  const [activeTool, setActiveTool] = useState('selectSetRect');
  // Selected board items (PCB_SELECTION_TOOL's selection), by `${kind}:${index}` id.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Disambiguation menu (PCB_SELECTION_TOOL::doSelectionMenu): shown at a click
  // that hits several equally-plausible items so the user can pick one.
  const [disambig, setDisambig] = useState<{
    x: number;
    y: number;
    ids: string[];
    additive: boolean;
  } | null>(null);
  const [show3D, setShow3D] = useState(false);
  const viewer3dRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // Live (world) cursor position read by draw()'s crosshair pass without
  // re-creating the callback; null when the pointer is off the canvas.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0, flipX: false });
  const boardRef = useRef<Board | null>(null);
  // Live selection read by draw()'s overlay pass without re-creating the callback.
  const selForDrawRef = useRef<ReadonlySet<string>>(selection);
  selForDrawRef.current = selection;
  // The in-progress rubber-band marquee (world coords), read by the overlay pass.
  const boxRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  // Live drag-move offset (world units) applied to the selection highlight while
  // a move gesture is in flight; committed on pointer-up (PCB_MOVE_TOOL preview).
  const moveDeltaRef = useRef<{ x: number; y: number } | null>(null);
  const movingRef = useRef(false);
  // Move (M / left-drag) leaves the routing behind; Drag (G) stretches the
  // traces attached to the moving footprints (EDIT_TOOL Move vs Drag). Drag mode
  // is on only while a 'drag' gesture actually has footprints to carry traces.
  const moveKindRef = useRef<'move' | 'drag'>('move');
  const dragModeRef = useRef(false);
  // The exact selection captured at gesture start (applySelect is async) plus,
  // for a drag, the ids excluded from the backdrop raster (part + its traces),
  // and the world grab origin the delta is measured from.
  const movingSelRef = useRef<ReadonlySet<string>>(new Set());
  const dragAffectedRef = useRef<ReadonlySet<string>>(new Set());
  const moveOriginRef = useRef<{ x: number; y: number } | null>(null);
  // Keyboard grab (M/G): the selection follows the cursor until a click commits
  // or Esc cancels — SCH/PCB move tool. Distinct from a left-button drag.
  const grabbingRef = useRef(false);
  // While a move is in flight the base raster is the board with the moving items
  // removed; this scene holds just those items, painted live at the drag offset
  // so the real geometry follows the cursor (not merely its bounding box).
  const moveSceneRef = useRef<BoardScene | null>(null);
  // Selected items, compiled on their own so they can be repainted brightened
  // over the raster — KiCad's selection is the item's colour Brightened(0.8),
  // not a bounding box (pcb_painter.cpp getColor).
  const selSceneRef = useRef<BoardScene | null>(null);
  // Whole-board snapshot undo/redo (EDIT_TOOL's SaveCopyInUndoList).
  const undoRef = useRef<Board[]>([]);
  const redoRef = useRef<Board[]>([]);
  // Item the disambiguation menu is hovering — brightened in the overlay pass.
  const hoverRef = useRef<string | null>(null);
  // Mirror of `disambig` open-state for the global Escape handler (no re-subscribe).
  const disambigRef = useRef(false);
  disambigRef.current = !!disambig;
  // Mirror of the active right-toolbar tool for the pointer/Escape handlers.
  const activeToolRef = useRef('selectSetRect');
  activeToolRef.current = activeTool;
  // Leaving the local ratsnest tool clears the forced-on set, like upstream.
  useEffect(() => {
    if (activeTool !== 'localRatsnestTool') setLocalRats(new Set());
  }, [activeTool]);
  // In-flight graphic shape (DRAWING_TOOL): the points clicked so far.
  const drawingRef = useRef<{ x: number; y: number }[]>([]);
  // In-flight route (ROUTER_TOOL): net, copper layer, last committed point,
  // and the net class routing dimensions picked up at start.
  const routeRef = useRef<{
    net: number;
    layer: string;
    last: { x: number; y: number };
    dims: ClassDims;
  } | null>(null);
  // Pending "Add Text" dialog: where the text will be placed.
  // Find dialog (DIALOG_FIND): query, options, hit cursor + status line.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findOpts, setFindOpts] = useState<PcbFindOptions>(DEFAULT_PCB_FIND);
  const [findStatus, setFindStatus] = useState('');
  const findHitsRef = useRef<{ id: string; pos: { x: number; y: number } }[]>([]);
  const findCursorRef = useRef(-1);
  // A query/options change restarts the search (DIALOG_FIND::search(true)).
  const findDirtyRef = useRef(true);
  const [textDialog, setTextDialog] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  // Pending "Copper Zone Properties" dialog: the zone's first corner.
  const [zoneDialog, setZoneDialog] = useState<{ x: number; y: number } | null>(null);
  const [zoneNet, setZoneNet] = useState(0);
  const [zoneLayer, setZoneLayer] = useState('F.Cu');
  // In-flight zone outline (DRAWING_TOOL::DrawZone after the dialog).
  const zoneRef = useRef<{ net: number; layer: string; pts: { x: number; y: number }[] } | null>(
    null,
  );
  // Measure tool ruler: first point, and the frozen second point once clicked.
  const measureRef = useRef<{
    a: { x: number; y: number };
    b: { x: number; y: number } | null;
  } | null>(null);
  // Switching tools abandons the in-flight shape/route/zone/ruler.
  useEffect(() => {
    drawingRef.current = [];
    routeRef.current = null;
    zoneRef.current = null;
    measureRef.current = null;
  }, [activeTool]);
  const sceneRef = useRef<BoardScene | null>(null);
  const rafRef = useRef(0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const showAppearance = toggles.has('showLayersManager');
  const showProperties = toggles.has('showProperties');

  // Draw options derived from the Objects tab + zone display mode.
  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      tracks: objects.tracks,
      vias: objects.vias,
      pads: objects.pads,
      zones: objects.zones,
      fpValues: objects.fpValues,
      fpReferences: objects.fpReferences,
      fpText: objects.fpText,
      drawingSheet: objects.drawingSheet,
      trackOpacity: opacity.tracks,
      viaOpacity: opacity.vias,
      padOpacity: opacity.pads,
      zoneOpacity: opacity.zones,
      zoneOutline: toggles.has('zoneDisplayOutline'),
      // Display-mode toggles: on = sketch (outline) = fill off (m_Display*Fill).
      trackFill: !toggles.has('trackDisplayMode'),
      viaFill: !toggles.has('viaDisplayMode'),
      padFill: !toggles.has('padDisplayMode'),
      filledShapeOpacity: opacity.filledShapes,
      contrastMode: contrast,
      activeLayer,
    }),
    [objects, opacity, toggles, contrast, activeLayer],
  );

  // The left-toolbar high-contrast button reflects the Layer Display mode.
  const leftToggles = useMemo(() => {
    const s = new Set(toggles);
    if (contrast !== 'normal') s.add('highContrast');
    else s.delete('highContrast');
    if (objects.ratsnest) s.add('showRatsnest');
    else s.delete('showRatsnest');
    // The button is checked whenever a net highlight is active (netHighlightCond
    // = IsNetHighlightSet()).
    if (highlightNets.size > 0) s.add('toggleNetHighlight');
    else s.delete('toggleNetHighlight');
    return s;
  }, [toggles, contrast, objects.ratsnest, highlightNets]);

  // Parse after the first paint so "Loading…" is visible for big boards.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      try {
        const b = { ...readBoard(parse(text)), fileName };
        if (cancelled) return;
        boardRef.current = b;
        sceneRef.current = buildScene(b);
        setBoard(b);
        setVisible(new Set(b.layers.map((l) => l.name)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [text, fileName]);

  // "Footprints Front/Back" hide whole footprints: rebuild the scene.
  useEffect(() => {
    if (!boardRef.current) return;
    sceneRef.current = buildScene(boardRef.current, {
      hideFrontFootprints: !objects.footprintsFront,
      hideBackFootprints: !objects.footprintsBack,
    });
    sceneDirtyRef.current = true;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects.footprintsFront, objects.footprintsBack]);

  // pcbnew rasterises into a backing store; the same here. A crisp raster is
  // built off-screen (time-sliced so a 20k-track board never blocks the UI),
  // and every frame the current view blits that raster with a delta transform.
  // Crucially the crisp render is NOT cancelled or debounced while the user is
  // interacting: it runs to completion, promotes itself, and — if the view has
  // moved on — immediately starts another. So the picture continuously
  // re-sharpens *during* a zoom/pan instead of only after it stops.
  const cacheRef = useRef<{
    canvas: HTMLCanvasElement;
    view: { scale: number; tx: number; ty: number; flipX?: boolean };
  } | null>(null);
  const renderingRef = useRef(false);
  const viewChangedRef = useRef(true);
  // The scene/board changed since the cached raster was built, so it needs a
  // fresh render even though the view matches. We keep the (stale) raster on
  // screen and re-render into a new canvas in the background, swapping when
  // ready — so an edit/undo/toggle never blanks the board for a frame.
  const sceneDirtyRef = useRef(true);

  const viewMatchesCache = (): boolean => {
    const c = cacheRef.current;
    const v = viewRef.current;
    const canvas = canvasRef.current;
    return (
      !!c &&
      !!canvas &&
      c.view.scale === v.scale &&
      c.view.tx === v.tx &&
      c.view.ty === v.ty &&
      c.view.flipX === v.flipX &&
      c.canvas.width === canvas.width &&
      c.canvas.height === canvas.height
    );
  };

  const startCrispRender = useCallback(() => {
    if (renderingRef.current) return; // in flight — it re-checks the view on completion
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene || canvas.width < 2) return;
    if (viewMatchesCache() && !sceneDirtyRef.current) {
      viewChangedRef.current = false;
      return;
    }
    renderingRef.current = true;
    viewChangedRef.current = false;
    // Capture the current scene into this render; further edits re-dirty it.
    sceneDirtyRef.current = false;
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const cctx = work.getContext('2d');
    if (!cctx) {
      renderingRef.current = false;
      return;
    }
    const jobView = { ...viewRef.current };
    // The drawing sheet is drawn separately (unflipped) in draw(), like KiCad's
    // DS_PROXY_VIEW_ITEM which un-mirrors itself, so it stays readable and the
    // title block keeps its corner under a flipped view. So the raster omits it.
    const steps = buildDrawSteps(
      cctx,
      scene,
      jobView,
      visible,
      work.width,
      work.height,
      drawOpts,
      undefined,
    );
    let i = 0;
    const run = (): void => {
      const t0 = performance.now();
      while (i < steps.length && performance.now() - t0 < 12) steps[i++]!();
      if (i < steps.length) {
        requestAnimationFrame(run);
      } else {
        cacheRef.current = { canvas: work, view: jobView };
        renderingRef.current = false;
        requestDraw();
        // The view moved or the scene changed while we were rendering: keep
        // chasing it so the image keeps sharpening / catches the latest edit.
        if (viewChangedRef.current || sceneDirtyRef.current || !viewMatchesCache())
          startCrispRender();
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, drawOpts]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sceneRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = viewRef.current;
    // Signed X scale for the flipped (mirrored) view; world→screen X uses this.
    const sx = v.flipX ? -v.scale : v.scale;
    if (!viewMatchesCache() || sceneDirtyRef.current) {
      viewChangedRef.current = true;
      startCrispRender();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgb(0,16,35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Grid sits behind the board (GAL GRID_DEPTH), painted crisply at the live
    // view every frame so it stays sharp during pan/zoom. The raster is drawn on
    // top with a transparent background so the grid shows through empty areas.
    if (objects.grid && toggles.has('toggleGrid')) {
      drawGrid(ctx, v, canvas.width, canvas.height, dpr, DEFAULT_GRID_OPTIONS);
    }
    // Drawing sheet, drawn behind the board with the UN-flipped transform so the
    // page frame and title block stay in place and readable when the board is
    // flipped (KiCad's DS_PROXY_VIEW_ITEM un-mirrors itself). tx is recovered by
    // mirroring back about the viewport centre.
    if (drawOpts.drawingSheet && boardRef.current) {
      const sheetTx = v.flipX ? canvas.width - v.tx : v.tx;
      ctx.setTransform(v.scale, 0, 0, v.scale, sheetTx, v.ty);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawDrawingSheet(ctx, {
        paper: boardRef.current.paper,
        titleBlock: boardRef.current.titleBlock,
        fileName,
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const c = cacheRef.current;
    if (c) {
      const k = v.scale / c.view.scale;
      ctx.setTransform(k, 0, 0, k, v.tx - c.view.tx * k, v.ty - c.view.ty * k);
      // While the crisp cache catches up: keep upscale (zoom-in) sharp with
      // nearest-neighbour, but let downscale (zoom-out) stay smooth to avoid
      // aliasing shimmer on thin traces.
      ctx.imageSmoothingEnabled = k < 1;
      ctx.drawImage(c.canvas, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Net-color overlay (net colors mode "All"): copper items of colored nets
    // repainted in their net color over the raster.
    for (const cs of coloredScenesRef.current) {
      ctx.save();
      drawBoard(
        ctx,
        cs.scene,
        v,
        visible,
        canvas.width,
        canvas.height,
        { ...drawOpts, colorOverride: cs.color },
        undefined,
        true,
      );
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Ratsnest airwires (RATSNEST_VIEW_ITEM): thin lines over the copper,
    // curved when the left toolbar's curved-ratsnest mode is on.
    {
      const rats = ratsDrawRef.current;
      if (rats.length > 0) {
        const curved = toggles.has('ratsnestLineMode');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineWidth = Math.max(1, dpr);
        for (const { e, color } of rats) {
          const x1 = e.ax * sx + v.tx;
          const y1 = e.ay * v.scale + v.ty;
          const x2 = e.bx * sx + v.tx;
          const y2 = e.by * v.scale + v.ty;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          if (curved) {
            // Bow the line ~15% of its length to the side, like the curved
            // ratsnest render.
            const mx = (x1 + x2) / 2 - (y2 - y1) * 0.15;
            const my = (y1 + y2) / 2 + (x2 - x1) * 0.15;
            ctx.quadraticCurveTo(mx, my, x2, y2);
          } else {
            ctx.lineTo(x2, y2);
          }
          ctx.stroke();
        }
      }
    }
    // Umbilical lines (pcb_painter.cpp draw(PCB_TEXT): "Draw the umbilical
    // line for texts in footprints"): every SELECTED footprint text draws a
    // solid line in the LAYER_ANCHOR color (the theme's pink) back to its
    // parent footprint's position. Selecting a footprint selects its child
    // texts too, so clicking a footprint shows the umbilicals to its
    // reference/value/other texts. Follows an in-flight drag.
    {
      const sel = selForDrawRef.current;
      const brd = boardRef.current;
      if (brd) {
        const md = moveDeltaRef.current;
        const off = !dragModeRef.current && md ? md : { x: 0, y: 0 };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = PCB_SPECIAL.anchor;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        const umbilical = (fp: PcbFootprint, t: PcbFootprint['texts'][number]): void => {
          if (t.hide) return;
          ctx.moveTo((t.at.x + off.x) * sx + v.tx, (t.at.y + off.y) * v.scale + v.ty);
          ctx.lineTo((fp.at.x + off.x) * sx + v.tx, (fp.at.y + off.y) * v.scale + v.ty);
        };
        for (const id of sel) {
          const r = parseBoardItemId(id);
          if (r?.kind === 'fptext') {
            const fp = brd.footprints[r.index];
            const t = fp?.texts[r.sub ?? 0];
            // An individually selected text keeps its own anchor: only the text
            // end follows the drag, not the footprint position.
            if (fp && t && !t.hide) {
              ctx.moveTo((t.at.x + off.x) * sx + v.tx, (t.at.y + off.y) * v.scale + v.ty);
              ctx.lineTo(fp.at.x * sx + v.tx, fp.at.y * v.scale + v.ty);
            }
          } else if (r?.kind === 'footprint') {
            const fp = brd.footprints[r.index];
            if (fp) for (const t of fp.texts) umbilical(fp, t);
          }
        }
        ctx.stroke();
      }
    }
    // Selection / move overlay: the selected items repainted brightened over the
    // raster — KiCad draws a selected item in its layer colour Brightened(0.8),
    // not a bounding box (pcb_painter.cpp getColor). While a move is in flight the
    // moving items are excluded from the raster and this overlay follows the
    // cursor at the drag offset (EDIT_TOOL::Move's GAL overlay); otherwise it
    // sits exactly over the raster so the selection just lights up in place.
    // Net highlight (BOARD_INSPECTION_TOOL::HighlightNet): the whole board dims
    // and the highlighted net's copper pops. pcb_painter.cpp getColor darkens
    // every non-highlighted item by (1−highlightFactor)=0.5 and brightens the
    // highlighted ones by highlightFactor=0.5. We reproduce the darken with a
    // 50%-black wash over the raster (source-over: dst·0.5, exactly Darkened
    // (0.5)), then repaint the highlighted net Brightened(0.5) on top. Skipped
    // while dragging (the move overlay owns the frame).
    {
      const hs = highlightSceneRef.current;
      if (hs && !moveDeltaRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        drawBoard(ctx, hs, v, visible, canvas.width, canvas.height, drawOpts, undefined, true, 0.5);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    {
      const md = moveDeltaRef.current;
      const os = moveSceneRef.current ?? selSceneRef.current;
      if (os) {
        // A drag overlay is already at its stretched absolute coords; a move
        // overlay is the static subset translated by the drag delta.
        const off = dragModeRef.current ? { x: 0, y: 0 } : (md ?? { x: 0, y: 0 });
        const offView = {
          scale: v.scale,
          flipX: v.flipX,
          tx: v.tx + off.x * sx,
          ty: v.ty + off.y * v.scale,
        };
        ctx.save();
        drawBoard(
          ctx,
          os,
          offView,
          visible,
          canvas.width,
          canvas.height,
          drawOpts,
          undefined,
          true,
          SELECT_BRIGHTEN,
        );
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // In-flight route preview (ROUTER_TOOL): the 45° two-segment path from the
    // last committed point to the snapped cursor, at the net class track width.
    {
      const r = routeRef.current;
      const cur0 = cursorRef.current;
      if (r && cur0) {
        const end = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(r.layer);
        ctx.lineWidth = r.dims.trackWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(r.last.x, r.last.y);
        for (const p of routePath(r.last, end)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Zone outline preview (DRAWING_TOOL::DrawZone): a thin polyline in the
    // zone layer's color, plus the closing hint back to the first corner.
    {
      const z = zoneRef.current;
      const cur0 = cursorRef.current;
      if (z && z.pts.length > 0 && cur0) {
        const p = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(z.layer);
        ctx.lineWidth = Math.max(1, dpr) / v.scale;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(z.pts[0]!.x, z.pts[0]!.y);
        for (let i = 1; i < z.pts.length; i++) ctx.lineTo(z.pts[i]!.x, z.pts[i]!.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (z.pts.length >= 2) {
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(z.pts[0]!.x, z.pts[0]!.y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Measure ruler (ACTIONS::measureTool): line with end ticks and the
    // distance / dx / dy readout in the current units.
    {
      const m = measureRef.current;
      const cur0 = cursorRef.current;
      if (m && (m.b || cur0)) {
        const b = m.b ?? snapToGrid(cur0!);
        const ax = m.a.x * sx + v.tx;
        const ay = m.a.y * v.scale + v.ty;
        const bx = b.x * sx + v.tx;
        const by = b.y * v.scale + v.ty;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(120,230,255,0.95)';
        ctx.fillStyle = 'rgba(120,230,255,0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        // End ticks perpendicular to the ruler.
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * 6 * dpr;
        const ny = ((bx - ax) / len) * 6 * dpr;
        ctx.moveTo(ax - nx, ay - ny);
        ctx.lineTo(ax + nx, ay + ny);
        ctx.moveTo(bx - nx, by - ny);
        ctx.lineTo(bx + nx, by + ny);
        ctx.stroke();
        const dist = Math.hypot(b.x - m.a.x, b.y - m.a.y);
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        ctx.fillText(
          `${fmtCoord(dist)} ${unitLabel}  (dx ${fmtCoord(b.x - m.a.x)}  dy ${fmtCoord(b.y - m.a.y)})`,
          (ax + bx) / 2 + 10 * dpr,
          (ay + by) / 2 - 8 * dpr,
        );
      }
    }
    // In-flight drawing preview (DRAWING_TOOL's live outline): the committed
    // points plus the snapped cursor, stroked in the active layer's color at
    // the layer's default line width.
    {
      const kind = DRAW_SHAPE_TOOLS[activeToolRef.current];
      const pts = drawingRef.current;
      const cur0 = cursorRef.current;
      if (kind && pts.length > 0 && cur0) {
        const p = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(activeLayer);
        ctx.lineWidth = defaultShapeWidth(activeLayer);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        switch (kind) {
          case 'line': {
            const end = constrainLineEnd(pts[0]!, p);
            ctx.moveTo(pts[0]!.x, pts[0]!.y);
            ctx.lineTo(end.x, end.y);
            break;
          }
          case 'rect': {
            const a = pts[0]!;
            ctx.rect(
              Math.min(a.x, p.x),
              Math.min(a.y, p.y),
              Math.abs(p.x - a.x),
              Math.abs(p.y - a.y),
            );
            break;
          }
          case 'circle': {
            const a = pts[0]!;
            const r = Math.hypot(p.x - a.x, p.y - a.y);
            ctx.moveTo(a.x + r, a.y);
            ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
            break;
          }
          case 'arc': {
            if (pts.length === 1) {
              ctx.moveTo(pts[0]!.x, pts[0]!.y);
              ctx.lineTo(p.x, p.y);
            } else {
              traceArc3(ctx, pts[0]!, p, pts[1]!);
            }
            break;
          }
          case 'poly': {
            ctx.moveTo(pts[0]!.x, pts[0]!.y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
            ctx.lineTo(p.x, p.y);
            break;
          }
          default:
            break;
        }
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    const brd = boardRef.current;
    // Rubber-band marquee: KiCad tints it blue for a left→right window
    // (contained) select, green for a right→left crossing select.
    const box = boxRef.current;
    if (box) {
      const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x * sx + v.tx,
        y: p.y * v.scale + v.ty,
      });
      const p0 = toPx(box.a),
        p1 = toPx(box.b);
      const rightward = box.b.x >= box.a.x;
      ctx.strokeStyle = rightward ? 'rgba(120,170,255,0.9)' : 'rgba(120,255,150,0.9)';
      ctx.fillStyle = rightward ? 'rgba(120,170,255,0.12)' : 'rgba(120,255,150,0.12)';
      ctx.lineWidth = dpr;
      const x = Math.min(p0.x, p1.x),
        y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x),
        h = Math.abs(p1.y - p0.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    // Disambiguation hover: brighten the item the menu is pointing at.
    const hover = hoverRef.current;
    if (brd && hover) {
      const hb = boardItemBBox(brd, hover);
      if (hb) {
        const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
          x: p.x * sx + v.tx,
          y: p.y * v.scale + v.ty,
        });
        const q0 = toPx({ x: hb.minX, y: hb.minY }),
          q1 = toPx({ x: hb.maxX, y: hb.maxY });
        const pad = 2 * dpr;
        ctx.strokeStyle = 'rgba(120,230,255,1)';
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
        ctx.strokeRect(
          Math.min(q0.x, q1.x) - pad,
          Math.min(q0.y, q1.y) - pad,
          Math.abs(q1.x - q0.x) + 2 * pad,
          Math.abs(q1.y - q0.y) + 2 * pad,
        );
      }
    }
    // Crosshair cursor (GAL blitCursor): a white cross at the grid-snapped
    // cursor. crosshairSmall = an 80px cross (default), crosshairFull = full
    // screen lines, crosshair45 = a big diagonal X. Drawn topmost.
    const cur = cursorRef.current;
    if (cur) {
      const snapped = snapToGrid(cur);
      const px = snapped.x * sx + v.tx;
      const py = snapped.y * v.scale + v.ty;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = PCB_CURSOR;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      if (toggles.has('crosshairFull')) {
        ctx.moveTo(0, py);
        ctx.lineTo(canvas.width, py);
        ctx.moveTo(px, 0);
        ctx.lineTo(px, canvas.height);
      } else if (toggles.has('crosshair45')) {
        const d = canvas.width + canvas.height;
        ctx.moveTo(px - d, py - d);
        ctx.lineTo(px + d, py + d);
        ctx.moveTo(px - d, py + d);
        ctx.lineTo(px + d, py - d);
      } else {
        const s = 40 * dpr; // 80px cross, ±40
        ctx.moveTo(px - s, py);
        ctx.lineTo(px + s, py);
        ctx.moveTo(px, py - s);
        ctx.lineTo(px, py + s);
      }
      ctx.stroke();
    }
    setScale(v.scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCrispRender]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Ref mirror so long-lived handlers (global keydown) never call a stale draw.
  const requestDrawRef = useRef(requestDraw);
  requestDrawRef.current = requestDraw;

  // Layer/object changes invalidate the raster.
  useEffect(() => {
    sceneDirtyRef.current = true;
    requestDraw();
  }, [visible, drawOpts, requestDraw]);

  // Recompile the selected items into their own scene, so the overlay can paint
  // them brightened over the raster (KiCad's selection look).
  const rebuildSelScene = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    selSceneRef.current =
      brd && sel.size > 0
        ? buildScene(subsetBoardItems(brd, sel), {
            hideFrontFootprints: !objects.footprintsFront,
            hideBackFootprints: !objects.footprintsBack,
          })
        : null;
  }, [objects.footprintsFront, objects.footprintsBack]);

  // The selection / disambiguation hover live only in the overlay — recompile the
  // selection scene and repaint.
  useEffect(() => {
    rebuildSelScene();
    requestDraw();
  }, [selection, disambig, requestDraw, rebuildSelScene]);

  // ----- board model mutation (edits + undo/redo) -----------------------------

  // Recompile the render scene for a new board and repaint (edits change geometry).
  const rebuildScene = useCallback(
    (b: Board) => {
      sceneRef.current = buildScene(b, {
        hideFrontFootprints: !objects.footprintsFront,
        hideBackFootprints: !objects.footprintsBack,
      });
      rebuildSelScene();
      sceneDirtyRef.current = true;
      requestDraw();
    },
    [objects.footprintsFront, objects.footprintsBack, requestDraw, rebuildSelScene],
  );

  const setBoardModel = useCallback(
    (b: Board) => {
      boardRef.current = b;
      setBoard(b);
      rebuildScene(b);
    },
    [rebuildScene],
  );

  // Commit an edit: snapshot the current board for undo, then swap in the next.
  const commitBoard = useCallback(
    (next: Board) => {
      const prev = boardRef.current;
      if (prev) undoRef.current.push(prev);
      redoRef.current = [];
      setBoardModel(next);
    },
    [setBoardModel],
  );

  // Apply a footprint edit from the Properties grid, committing to the board
  // (children + undo follow). Mirrors the PCB_PROPERTIES_PANEL edits.
  const editFootprint = useCallback(
    (index: number, e: FpEdit): void => {
      const brd = boardRef.current;
      const fp = brd?.footprints[index];
      if (!brd || !fp) return;
      if (e.kind === 'pos') {
        if (!Number.isFinite(e.valueMM)) return;
        const target = Math.round(e.valueMM * MM);
        const delta =
          e.axis === 'x' ? { x: target - fp.at.x, y: 0 } : { x: 0, y: target - fp.at.y };
        if (delta.x === 0 && delta.y === 0) return;
        commitBoard(moveBoardItems(brd, new Set([boardItemId('footprint', index)]), delta));
      } else if (e.kind === 'orient') {
        if (!Number.isFinite(e.deg)) return;
        commitBoard(setFootprintOrientation(brd, index, e.deg));
      } else if (e.kind === 'field') {
        commitBoard(setFootprintField(brd, index, e.field, e.value));
      } else if (e.kind === 'locked') {
        commitBoard(setFootprintLocked(brd, index, e.locked));
      }
    },
    [commitBoard],
  );

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev || !boardRef.current) return;
    redoRef.current.push(boardRef.current);
    setBoardModel(prev);
    setSelection(new Set());
  }, [setBoardModel]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next || !boardRef.current) return;
    undoRef.current.push(boardRef.current);
    setBoardModel(next);
    setSelection(new Set());
  }, [setBoardModel]);

  // Delete the selected items (EDIT_TOOL::Remove). Reads the live selection ref
  // so the keyboard shortcut and menu both act on the current selection.
  // Deleting a group deletes its members too (the id set keeps the group id so
  // the group node itself is dropped as well).
  const deleteSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    commitBoard(deleteBoardItems(brd, new Set([...sel, ...expandGroupIds(brd, sel)])));
    setSelection(new Set());
  }, [commitBoard]);

  // Rotate the selection ±90° about its centre (EDIT_TOOL::Rotate). Keeps the
  // selection so it can be rotated repeatedly. Groups rotate as their members.
  const rotateSel = useCallback(
    (ccw: boolean) => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      commitBoard(rotateBoardItems(brd, expandGroupIds(brd, sel), ccw));
    },
    [commitBoard],
  );

  // Mirror the selection about its centre (EDIT_TOOL::Mirror; mirrorV = flip
  // top/bottom, mirrorH = left/right). Footprints are skipped, like KiCad.
  const mirrorSel = useCallback(
    (direction: 'v' | 'h') => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      commitBoard(mirrorBoardItems(brd, expandGroupIds(brd, sel), direction));
    },
    [commitBoard],
  );

  // Group / ungroup the selection (ACTIONS::group / ungroup).
  const groupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const { board: next, id } = groupBoardItems(brd, sel);
    if (!id) return;
    commitBoard(next);
    setSelection(new Set([id]));
  }, [commitBoard]);
  const ungroupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    // The members stay selected after dissolving their group, like KiCad.
    const members = expandGroupIds(brd, sel);
    commitBoard(ungroupBoardItems(brd, sel));
    setSelection(members);
  }, [commitBoard]);

  // Lock / unlock the selection (PCB_ACTIONS::lock / unlock).
  const lockSel = useCallback(
    (locked: boolean) => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      commitBoard(setBoardItemsLocked(brd, sel, locked));
    },
    [commitBoard],
  );

  // Duplicate the selection 1 mm off (EDIT_TOOL::Duplicate) and select the copies.
  const duplicateSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const { board: next, ids } = duplicateBoardItems(brd, expandGroupIds(brd, sel), {
      x: MM,
      y: MM,
    });
    commitBoard(next);
    setSelection(new Set(ids));
  }, [commitBoard]);

  // Align selected items like ALIGN_DISTRIBUTE_TOOL: choose the target item
  // under the cursor when there is one, otherwise the first selected item in
  // KiCad's sorted order, then move each item's own bounding box to that target.
  const alignSelection = useCallback(
    (action: AlignAction) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length < 2) return;

      const entries = sel
        .map((id) => {
          const bbox = boardItemBBox(brd, id);
          return bbox ? { id, bbox } : null;
        })
        .filter((entry): entry is { id: string; bbox: BoardBBox } => !!entry);
      if (entries.length < 2) return;

      const effective =
        flipView && action === 'left' ? 'right' : flipView && action === 'right' ? 'left' : action;
      const sorted = [...entries].sort((a, b) => {
        switch (effective) {
          case 'left':
            return a.bbox.minX - b.bbox.minX;
          case 'right':
            return b.bbox.maxX - a.bbox.maxX;
          case 'top':
            return a.bbox.minY - b.bbox.minY;
          case 'bottom':
            return b.bbox.maxY - a.bbox.maxY;
          case 'centerX':
            return bboxCenter(a.bbox).x - bboxCenter(b.bbox).x;
          case 'centerY':
            return bboxCenter(a.bbox).y - bboxCenter(b.bbox).y;
        }
        return 0;
      });
      const cursorHit = cursorRef.current
        ? sorted.find((entry) => bboxContainsPoint(entry.bbox, cursorRef.current!))
        : undefined;
      const target = cursorHit ?? sorted[0];
      if (!target) return;

      const targetCenter = bboxCenter(target.bbox);
      let next = brd;
      let changed = false;
      for (const entry of entries) {
        const center = bboxCenter(entry.bbox);
        let delta = { x: 0, y: 0 };
        switch (effective) {
          case 'left':
            delta = { x: target.bbox.minX - entry.bbox.minX, y: 0 };
            break;
          case 'right':
            delta = { x: target.bbox.maxX - entry.bbox.maxX, y: 0 };
            break;
          case 'top':
            delta = { x: 0, y: target.bbox.minY - entry.bbox.minY };
            break;
          case 'bottom':
            delta = { x: 0, y: target.bbox.maxY - entry.bbox.maxY };
            break;
          case 'centerX':
            delta = { x: targetCenter.x - center.x, y: 0 };
            break;
          case 'centerY':
            delta = { x: 0, y: targetCenter.y - center.y };
            break;
        }
        if (delta.x !== 0 || delta.y !== 0) {
          next = moveBoardItems(next, new Set([entry.id]), delta);
          changed = true;
        }
      }
      if (changed) commitBoard(next);
    },
    [commitBoard, flipView],
  );

  const zoomToFit = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene?.bbox) return;
    let { minX, minY, maxX, maxY } = scene.bbox;
    // Include the drawing sheet (page origin at 0,0) so the frame fits on screen.
    const paper = boardRef.current?.paper?.split(/\s+/)[0];
    const PAGE: Record<string, [number, number]> = {
      A5: [210, 148],
      A4: [297, 210],
      A3: [420, 297],
      A2: [594, 420],
      A1: [841, 594],
      A0: [1189, 841],
    };
    if (paper && PAGE[paper] && objects.drawingSheet) {
      const [pw, ph] = PAGE[paper]!;
      minX = Math.min(minX, 0);
      minY = Math.min(minY, 0);
      maxX = Math.max(maxX, pw * MM);
      maxY = Math.max(maxY, ph * MM);
    }
    const margin = 5 * MM;
    const s = Math.min(
      canvas.width / (maxX - minX + margin * 2),
      canvas.height / (maxY - minY + margin * 2),
    );
    const flipX = viewRef.current.flipX;
    viewRef.current = {
      scale: s,
      flipX,
      tx: canvas.width / 2 - ((minX + maxX) / 2) * (flipX ? -s : s),
      ty: canvas.height / 2 - ((minY + maxY) / 2) * s,
    };
    requestDraw();
  }, [requestDraw]);

  const zoomStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const px = canvas.width / 2;
      const py = canvas.height / 2;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = py - wy * v.scale;
      requestDraw();
    },
    [requestDraw],
  );

  // Size the canvas to its container (device pixels) and fit on first layout.
  const fittedRef = useRef(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      // Assigning canvas.width clears the canvas even when the value is
      // unchanged, blanking the board for a frame. This effect re-runs (and
      // re-observes, firing an initial callback) whenever the draw options
      // change, so only touch the canvas on a REAL size change — otherwise a
      // left-toolbar toggle flickers the whole view.
      const changed = canvas.width !== w || canvas.height !== h;
      if (changed) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${r.width}px`;
        canvas.style.height = `${r.height}px`;
      }
      if (!fittedRef.current && sceneRef.current) {
        fittedRef.current = true;
        zoomToFit();
      } else if (changed) {
        sceneDirtyRef.current = true;
        requestDraw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dpr, requestDraw, zoomToFit, board]);

  // Flip board view (PCB_ACTIONS::flipBoard → VIEW::SetMirror on X): toggle the
  // view's horizontal mirror, re-centring so the board stays put, and rebuild
  // the raster (which bakes in the mirror).
  const toggleFlip = useCallback(() => {
    const v = viewRef.current;
    const canvas = canvasRef.current;
    v.flipX = !v.flipX;
    // Mirror tx about the viewport centre so the visible board doesn't jump.
    if (canvas) v.tx = canvas.width - v.tx;
    setFlipView(v.flipX);
    sceneDirtyRef.current = true;
    requestDraw();
  }, [requestDraw]);

  // Wheel zoom about the cursor; drag to pan (left or middle button).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = py - wy * v.scale;
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [dpr, requestDraw]);

  // World coordinate under a pointer event (device pixels → board units).
  const worldAt = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale),
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    },
    [dpr],
  );

  // Middle-button pan (KiCad reserves the left button for select/move).
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // The left press in progress: origin, world origin, the item it landed on (if
  // any), and whether it has moved. Still = click; moved on an item = drag-move;
  // moved on empty = box-select.
  const downRef = useRef<{
    x: number;
    y: number;
    world: { x: number; y: number } | null;
    hitId: string | null;
    onItem: boolean;
    moved: boolean;
    shift: boolean;
  } | null>(null);

  // Does an item of this kind pass the Selection Filter panel? (KiCad's
  // SELECTION_FILTER_OPTIONS — track/arc→Tracks, shape→Graphics, etc.)
  const filterKeyOf = (kind: BoardItemKind): string | null =>
    kind === 'track' || kind === 'arc'
      ? 'tracks'
      : kind === 'via'
        ? 'vias'
        : kind === 'footprint'
          ? 'footprints'
          : kind === 'pad'
            ? 'pads'
            : kind === 'zone'
              ? 'zones'
              : kind === 'shape'
                ? 'graphics'
                : kind === 'text' || kind === 'fptext'
                  ? 'text'
                  : null;
  const passesFilter = (id: string): boolean => {
    const r = parseBoardItemId(id);
    if (!r) return false;
    // Locked items are selectable only with the "Locked items" filter checked
    // (PCB_SELECTION_FILTER_OPTIONS::lockedItems; KiCad defaults it off).
    const brd = boardRef.current;
    if (brd && !selFilter.has('lockedItems') && isBoardItemLocked(brd, id)) return false;
    const key = filterKeyOf(r.kind);
    return key ? selFilter.has(key) : true;
  };

  // Hit candidates at a board point — KiCad's selectPoint pipeline: collect
  // with exact hit distances, Selection Filter, then GuessSelectionCandidates
  // (slop pruning, the 1.5× coverage-area heuristic, active-layer preference),
  // all transcribed in boardHitCandidates. One id = unambiguous click; several
  // = KiCad would pop the disambiguation menu. Finally, a hit on a group
  // member resolves to its top-level group (PCB_GROUP::TopLevelGroup).
  const hitCandidates = (w: { x: number; y: number }): string[] => {
    const brd = boardRef.current;
    if (!brd) return [];
    const canvas = canvasRef.current;
    const v = viewRef.current;
    const cands = boardHitCandidates(brd, w, tolOf(), {
      filter: passesFilter,
      activeLayer,
      visibleLayers: visible,
      viewportIU: canvas ? { w: canvas.width / v.scale, h: canvas.height / v.scale } : undefined,
    });
    const out: string[] = [];
    for (const id of cands) {
      const resolved = groupContaining(brd, id) ?? id;
      if (!out.includes(resolved)) out.push(resolved);
    }
    return out;
  };

  const tolOf = (): number => (5 * dpr) / viewRef.current.scale; // ~5px, like COLLECTORS_GUIDE

  // Set the selection to (or toggle) a single item id (null clears).
  const applySelect = (id: string | null, additive: boolean): void => {
    setSelection((prev) => {
      const next = new Set(additive ? prev : []);
      if (id) {
        if (additive && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  // PCB_SELECTION_TOOL::selectPoint: pick the best filtered candidate under the
  // cursor. When several items are equally plausible (same priority tier after
  // guessSelectionCandidates drops the obvious container), pop the
  // disambiguation menu instead of guessing. Shift adds/toggles.
  const clickSelect = (clientX: number, clientY: number, additive: boolean): void => {
    const w = worldAt(clientX, clientY);
    const brd = boardRef.current;
    if (!w || !brd) return;
    const cands = hitCandidates(w);
    if (cands.length === 0) {
      applySelect(null, additive);
      return;
    }
    // GuessSelectionCandidates already pruned the list; a single survivor is
    // selected outright, several raise the disambiguation menu (selectPoint:
    // "If still more than one item we're going to have to ask the user").
    if (cands.length === 1) {
      applySelect(cands[0]!, additive);
      return;
    }
    setDisambig({ x: clientX, y: clientY, ids: cands, additive });
  };

  // ----- graphic shape drawing (DRAWING_TOOL) ---------------------------------

  // Constrain a line segment's end per the left-toolbar line mode: 90 snaps to
  // the nearer axis, 45 to the nearest 45° multiple, free leaves it alone.
  const constrainLineEnd = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number } => {
    if (toggles.has('lineModeFree')) return to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (toggles.has('lineMode90'))
      return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    // 45°: project onto the nearest multiple of 45°.
    const ang = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
    const len = Math.abs(Math.cos(ang)) > 0.5 ? dx / Math.cos(ang) : dy / Math.sin(ang);
    return snapToGrid({ x: from.x + len * Math.cos(ang), y: from.y + len * Math.sin(ang) });
  };

  // One left click of an active drawing tool (DRAWING_TOOL::drawShape's click
  // sequence). Returns having updated the in-flight point list or committed a
  // finished shape to the board.
  const handleDrawClick = (world: { x: number; y: number }): void => {
    const kind = DRAW_SHAPE_TOOLS[activeToolRef.current];
    const brd = boardRef.current;
    if (!kind || !brd) return;
    const pts = drawingRef.current;
    const p = snapToGrid(world);
    const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      a.x === b.x && a.y === b.y;
    // Commit leaves the new shape unselected and the tool active, like
    // DRAWING_TOOL (draw the next shape right away).
    const commit = (shape: Omit<PcbShape, 'source'>): void => {
      commitBoard(addBoardShape(brd, shape).board);
    };
    const width = defaultShapeWidth(activeLayer);
    const base = { width, fill: false, layer: activeLayer } as const;

    switch (kind) {
      case 'line': {
        if (pts.length === 0) {
          drawingRef.current = [p];
        } else {
          const start = pts[0]!;
          const end = constrainLineEnd(start, p);
          if (same(start, end)) {
            // Clicking in place ends the chain.
            drawingRef.current = [];
          } else {
            commit({ kind: 'line', start, end, ...base });
            // Chain: the next segment starts where this one ended.
            drawingRef.current = [end];
          }
        }
        break;
      }
      case 'rect': {
        if (pts.length === 0) drawingRef.current = [p];
        else if (!same(pts[0]!, p)) {
          commit({ kind: 'rect', start: pts[0]!, end: p, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'circle': {
        if (pts.length === 0) drawingRef.current = [p];
        else if (!same(pts[0]!, p)) {
          commit({ kind: 'circle', center: pts[0]!, end: p, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'arc': {
        // Clicks: start, end, then the curvature point (the arc's mid).
        if (pts.length < 2) {
          if (pts.length === 0 || !same(pts[pts.length - 1]!, p)) drawingRef.current = [...pts, p];
        } else {
          commit({ kind: 'arc', start: pts[0]!, mid: p, end: pts[1]!, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'poly': {
        const tol = tolOf();
        const closeToFirst = pts.length >= 3 && Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= tol;
        if (closeToFirst || (pts.length >= 3 && same(pts[pts.length - 1]!, p))) {
          commit({ kind: 'poly', pts: [...pts], ...base });
          drawingRef.current = [];
        } else if (pts.length === 0 || !same(pts[pts.length - 1]!, p)) {
          drawingRef.current = [...pts, p];
        }
        break;
      }
      default:
        break;
    }
    requestDraw();
  };

  // ----- interactive routing (ROUTER_TOOL, highlight mode) --------------------

  // The pad under a board point (board-absolute centres), for net pickup and
  // snapping route ends onto pads.
  const padAt = (w: { x: number; y: number }): PcbPad | null => {
    const brd = boardRef.current;
    if (!brd) return null;
    for (const fp of brd.footprints) {
      for (const pad of fp.pads) {
        if (Math.hypot(w.x - pad.at.x, w.y - pad.at.y) <= Math.max(pad.size.x, pad.size.y) / 2)
          return pad;
      }
    }
    return null;
  };

  // Net + snap point of the copper item under the cursor (pads first, then
  // vias and tracks via the hit-tester).
  const copperAt = (w: {
    x: number;
    y: number;
  }): { net: number; snap: { x: number; y: number } } | null => {
    const brd = boardRef.current;
    if (!brd) return null;
    const pad = padAt(w);
    if (pad) return { net: pad.net ?? 0, snap: { ...pad.at } };
    for (const id of boardHitCandidates(brd, w, tolOf())) {
      const r = parseBoardItemId(id);
      if (r?.kind === 'via') {
        const v = brd.vias[r.index];
        if (v) return { net: v.net, snap: { ...v.at } };
      } else if (r?.kind === 'track' || r?.kind === 'arc') {
        const t = r.kind === 'track' ? brd.tracks[r.index] : brd.arcs[r.index];
        if (t) {
          // Snap to a nearby endpoint, else stay on the grid point.
          const ends = [t.start, t.end];
          const near = ends.find((p) => Math.hypot(w.x - p.x, w.y - p.y) <= tolOf());
          return { net: t.net, snap: near ? { ...near } : snapToGrid(w) };
        }
      }
    }
    return null;
  };

  // The 45°-constrained two-segment route path (ROUTER_TOOL's posture):
  // a straight run along the dominant axis, then the diagonal to the cursor.
  const routePath = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number }[] => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return [to];
    if (Math.abs(dx) > Math.abs(dy)) {
      return [{ x: from.x + Math.sign(dx) * (Math.abs(dx) - Math.abs(dy)), y: from.y }, to];
    }
    return [{ x: from.x, y: from.y + Math.sign(dy) * (Math.abs(dy) - Math.abs(dx)) }, to];
  };

  const routeDims = (net: number): ClassDims =>
    netclassInfo.classDims.get(netClassOf.get(net) ?? 'Default') ?? DEFAULT_CLASS_DIMS;

  // One left click of the Route Single Track tool.
  const handleRouteClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const r = routeRef.current;
    if (!r) {
      // Start: pick the net (and snap) from the copper item under the cursor;
      // route on the active copper layer.
      const c = copperAt(world);
      const layer = /\.Cu$/.test(activeLayer) ? activeLayer : 'F.Cu';
      if (layer !== activeLayer) setActiveLayer(layer);
      routeRef.current = {
        net: c?.net ?? 0,
        layer,
        last: c?.snap ?? snapToGrid(world),
        dims: routeDims(c?.net ?? 0),
      };
    } else {
      const target = copperAt(world);
      const landed = target !== null && target.net === r.net && r.net > 0;
      const end = landed ? target.snap : snapToGrid(world);
      let b = brd;
      let prev = r.last;
      for (const p of routePath(r.last, end)) {
        if (p.x !== prev.x || p.y !== prev.y) {
          b = addBoardTrack(b, {
            start: prev,
            end: p,
            width: r.dims.trackWidth,
            layer: r.layer,
            net: r.net,
          }).board;
          prev = p;
        }
      }
      if (b !== brd) commitBoard(b);
      // Landing on a same-net item finishes the route; otherwise keep going.
      routeRef.current = landed ? null : { ...r, last: end };
    }
    requestDraw();
  };

  // 'V' while routing: commit up to the cursor, drop a via there, and continue
  // on the other copper layer (ROUTER_TOOL::onViaCommand).
  const routeViaSwitch = (): void => {
    const r = routeRef.current;
    const brd = boardRef.current;
    const cur = cursorRef.current;
    if (!r || !brd || !cur) return;
    const end = snapToGrid(cur);
    let b = brd;
    let prev = r.last;
    for (const p of routePath(r.last, end)) {
      if (p.x !== prev.x || p.y !== prev.y) {
        b = addBoardTrack(b, {
          start: prev,
          end: p,
          width: r.dims.trackWidth,
          layer: r.layer,
          net: r.net,
        }).board;
        prev = p;
      }
    }
    b = addBoardVia(b, {
      at: end,
      size: r.dims.viaDiameter,
      drill: r.dims.viaDrill,
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: r.net,
    }).board;
    commitBoard(b);
    const other = r.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    setActiveLayer(other);
    routeRef.current = { ...r, layer: other, last: end };
    requestDraw();
  };
  const routeViaSwitchRef = useRef(routeViaSwitch);
  routeViaSwitchRef.current = routeViaSwitch;

  // Commit the "Add Text" dialog: a user gr_text at the clicked point on the
  // active layer, at the layer class's default size/thickness.
  const commitPlacedText = (): void => {
    const brd = boardRef.current;
    const at = textDialog;
    const content = textDraft.trim();
    setTextDialog(null);
    setTextDraft('');
    if (!brd || !at || !content) return;
    const silk = /\.SilkS$/.test(activeLayer);
    commitBoard(
      addBoardText(brd, {
        kind: 'user',
        text: content,
        at,
        angle: 0,
        layer: activeLayer,
        size: { x: 1 * MM, y: 1 * MM },
        thickness: (silk ? 0.1 : 0.15) * MM,
      }).board,
    );
  };

  // One left click of the Draw Filled Zones tool: the first click opens the
  // Copper Zone Properties dialog; afterwards clicks collect the outline,
  // closing back on the first corner commits the (unfilled) zone.
  const handleZoneClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const p = snapToGrid(world);
    const z = zoneRef.current;
    if (!z) {
      setZoneNet(copperAt(world)?.net ?? 0);
      setZoneLayer(/\.Cu$/.test(activeLayer) ? activeLayer : 'F.Cu');
      setZoneDialog(p);
      return;
    }
    const closeToFirst =
      z.pts.length >= 3 && Math.hypot(p.x - z.pts[0]!.x, p.y - z.pts[0]!.y) <= tolOf();
    const sameAsLast =
      z.pts.length >= 3 && p.x === z.pts[z.pts.length - 1]!.x && p.y === z.pts[z.pts.length - 1]!.y;
    if (closeToFirst || sameAsLast) {
      commitBoard(
        addBoardZone(brd, {
          net: z.net,
          netName: brd.nets.get(z.net) ?? '',
          layers: [z.layer],
          outline: [...z.pts],
          hatchStyle: 'edge',
          hatchPitch: 0.5 * MM,
        }).board,
      );
      zoneRef.current = null;
    } else if (
      z.pts.length === 0 ||
      p.x !== z.pts[z.pts.length - 1]!.x ||
      p.y !== z.pts[z.pts.length - 1]!.y
    ) {
      zoneRef.current = { ...z, pts: [...z.pts, p] };
    }
    requestDraw();
  };

  // Measure tool (ACTIONS::measureTool): two clicks pin the ruler; the next
  // click starts a new measurement.
  const handleMeasureClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const m = measureRef.current;
    if (!m || m.b) measureRef.current = { a: p, b: null };
    else measureRef.current = { a: m.a, b: p };
    requestDraw();
  };

  // Free-standing via placement (PCB_ACTIONS::drawVia): each click drops a via,
  // picking up the net of the copper item underneath.
  const handleViaClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const c = copperAt(world);
    const at = c?.snap ?? snapToGrid(world);
    const dims = routeDims(c?.net ?? 0);
    commitBoard(
      addBoardVia(brd, {
        at,
        size: dims.viaDiameter,
        drill: dims.viaDrill,
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: c?.net ?? 0,
      }).board,
    );
  };

  // ----- interactive move / drag (EDIT_TOOL Move vs Drag) ---------------------

  const sceneFilter = (): { hideFrontFootprints: boolean; hideBackFootprints: boolean } => ({
    hideFrontFootprints: !objects.footprintsFront,
    hideBackFootprints: !objects.footprintsBack,
  });

  // Start a move/drag of `sel` from world grab point `origin`. 'move' leaves the
  // routing behind; 'drag' stretches the traces attached to moving footprints.
  // Splits the scene into a backdrop (everything else) + a live moving overlay.
  const beginMove = (
    sel0: ReadonlySet<string>,
    kind: 'move' | 'drag',
    origin: { x: number; y: number },
  ): void => {
    const brd = boardRef.current;
    if (!brd || sel0.size === 0) return;
    // A grabbed group moves as its members (the move commands know items only).
    const sel = expandGroupIds(brd, sel0);
    movingSelRef.current = sel;
    moveKindRef.current = kind;
    moveOriginRef.current = origin;
    const fpIdx = new Set<number>();
    for (const id of sel) {
      const r = parseBoardItemId(id);
      if (r?.kind === 'footprint') fpIdx.add(r.index);
    }
    dragModeRef.current = kind === 'drag' && fpIdx.size > 0;
    const affected = new Set<string>(sel);
    if (dragModeRef.current) {
      for (const e of connectedTrackEnds(brd, fpIdx)) affected.add(boardItemId(e.kind, e.index));
    }
    dragAffectedRef.current = affected;
    sceneRef.current = buildScene(deleteBoardItems(brd, affected), sceneFilter());
    moveSceneRef.current = dragModeRef.current
      ? null
      : buildScene(subsetBoardItems(brd, sel), sceneFilter());
    moveDeltaRef.current = { x: 0, y: 0 };
    sceneDirtyRef.current = true;
  };

  // Track the in-flight gesture to the grid-snapped cursor. A drag rebuilds the
  // stretched geometry each frame (traces don't translate uniformly).
  const updateMove = (cur: { x: number; y: number }): void => {
    const brd = boardRef.current;
    const origin = moveOriginRef.current;
    if (!brd || !origin) return;
    const from = snapToGrid(origin);
    const to = snapToGrid(cur);
    const delta = { x: to.x - from.x, y: to.y - from.y };
    moveDeltaRef.current = delta;
    if (dragModeRef.current) {
      const dragged = dragBoardItems(brd, movingSelRef.current, delta);
      moveSceneRef.current = buildScene(
        subsetBoardItems(dragged, dragAffectedRef.current),
        sceneFilter(),
      );
    }
    // Live ratsnest (KiCad recomputes airwires while dragging): recompute from
    // the moved geometry so the airwires follow the part. Skipped on very large
    // boards where a per-frame recompute would stall.
    if (liveRatsRef.current) {
      const preview = dragModeRef.current
        ? dragBoardItems(brd, movingSelRef.current, delta)
        : moveBoardItems(brd, movingSelRef.current, delta);
      ratsDrawRef.current = filterRatsRef.current(buildRatsnest(preview), selectedNetsRef.current);
    }
    requestDraw();
  };

  // Commit the gesture (drop). A zero net delta just restores the full scene.
  const commitMove = (): void => {
    const brd = boardRef.current;
    const delta = moveDeltaRef.current;
    const kind = moveKindRef.current;
    const sel = movingSelRef.current;
    const hadOverlay = moveSceneRef.current !== null || dragModeRef.current;
    dragModeRef.current = false;
    moveDeltaRef.current = null;
    moveSceneRef.current = null;
    moveOriginRef.current = null;
    if (brd && delta && (delta.x !== 0 || delta.y !== 0)) {
      commitBoard(
        kind === 'drag' ? dragBoardItems(brd, sel, delta) : moveBoardItems(brd, sel, delta),
      );
    } else if (hadOverlay && brd) {
      rebuildScene(brd);
    }
  };

  // Abandon the gesture without committing (Esc), restoring the full scene.
  const cancelMove = (): void => {
    const brd = boardRef.current;
    dragModeRef.current = false;
    moveDeltaRef.current = null;
    moveSceneRef.current = null;
    moveOriginRef.current = null;
    // Undo the live-ratsnest preview (the board didn't change).
    if (liveRatsRef.current)
      ratsDrawRef.current = filterRatsRef.current(
        ratsnestEdgesRef.current,
        selectedNetsRef.current,
      );
    if (brd) rebuildScene(brd);
  };

  // Keyboard grab (M = Move, G = Drag): grab the selection at the cursor and
  // follow it until a click commits or Esc cancels. Routed through refs so the
  // stable global key handler always calls the latest closures.
  const grabStartRef = useRef<(kind: 'move' | 'drag') => void>(() => {});
  grabStartRef.current = (kind) => {
    const sel = selForDrawRef.current;
    const cur = cursorRef.current;
    if (sel.size === 0 || !cur || movingRef.current || grabbingRef.current) return;
    beginMove(sel, kind, cur);
    grabbingRef.current = true;
    requestDraw();
  };
  const grabCancelRef = useRef<() => void>(() => {});
  grabCancelRef.current = () => {
    if (!grabbingRef.current) return;
    grabbingRef.current = false;
    cancelMove();
    requestDraw();
  };

  // Net highlight actions (BOARD_INSPECTION_TOOL). Held in refs so the global
  // keydown handler stays subscribed without re-binding every render.
  // `highlightNet` (backtick): highlight the net of the copper item under the
  // cursor; re-invoking on the same (sole) net toggles it off, like KiCad.
  const highlightNetRef = useRef<() => void>(() => {});
  highlightNetRef.current = () => {
    const cur = cursorRef.current;
    if (!cur) return;
    const net = copperAt(cur)?.net ?? 0;
    setHighlightNets((prev) => {
      if (prev.size > 0) lastHighlightRef.current = prev;
      // Empty spot, or clicking the already-highlighted sole net: clear.
      if (net <= 0 || (prev.size === 1 && prev.has(net))) return new Set();
      return new Set([net]);
    });
  };
  // `~` (Clear Net Highlighting).
  const clearHighlightRef = useRef<() => void>(() => {});
  clearHighlightRef.current = () => {
    setHighlightNets((prev) => {
      if (prev.size === 0) return prev;
      lastHighlightRef.current = prev;
      return new Set();
    });
  };
  // Toggle Net Highlight (the left-toolbar button / Alt+`). If a highlight is
  // showing, hide it (KiCad's `turnOn = highlighted.empty() && …`). Otherwise
  // highlight the net(s) of the current selection — PCB_ACTIONS::
  // highlightNetSelection, "highlight all copper items on the selected net(s)"
  // — falling back to the last highlighted set when nothing carries a net.
  const toggleHighlightRef = useRef<() => void>(() => {});
  toggleHighlightRef.current = () => {
    setHighlightNets((prev) => {
      if (prev.size > 0) {
        lastHighlightRef.current = prev;
        return new Set();
      }
      const sel = selectedNetsRef.current;
      const next = sel.size > 0 ? new Set(sel) : new Set(lastHighlightRef.current);
      if (next.size > 0) lastHighlightRef.current = next;
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) {
      // A left click during a keyboard grab (M/G) drops the selection there.
      if (grabbingRef.current) {
        grabbingRef.current = false;
        commitMove();
        requestDraw();
        return;
      }
      const w = worldAt(e.clientX, e.clientY);
      const brd = boardRef.current;
      const hitId = w && brd ? (hitCandidates(w)[0] ?? null) : null;
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        world: w,
        hitId,
        onItem: !!hitId,
        moved: false,
        shift: e.shiftKey,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      // Signed X so the crosshair tracks the physical cursor under a flipped view.
      const wx = ((e.clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale);
      const wy = ((e.clientY - rect.top) * dpr - v.ty) / v.scale;
      setCursor({ x: wx, y: wy });
      cursorRef.current = { x: wx, y: wy };
      // Repaint so the crosshair follows even on a plain hover (no pan/drag).
      requestDraw();
    }
    if (panRef.current) {
      const v = viewRef.current;
      v.tx += (e.clientX - panRef.current.x) * dpr;
      v.ty += (e.clientY - panRef.current.y) * dpr;
      panRef.current = { x: e.clientX, y: e.clientY };
      requestDraw();
      return;
    }
    // Keyboard grab (M/G) in flight: the selection follows the cursor freely
    // until a click commits it (no button held).
    if (grabbingRef.current) {
      const cur = worldAt(e.clientX, e.clientY);
      if (cur) updateMove(cur);
      return;
    }
    const d = downRef.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3 * dpr) d.moved = true;
      // Click-driven tools (delete, local ratsnest, drawing, routing, vias,
      // text) take no drag-move or box-select gestures.
      if (isClickTool(activeToolRef.current)) return;
      if (d.moved && d.world) {
        const cur = worldAt(e.clientX, e.clientY);
        if (!cur) return;
        if (d.onItem) {
          // Left-drag on a footprint = Move (pcb_selection_tool.cpp: a non-track
          // selection runs PCB_ACTIONS::move — the routing is left behind). On
          // the first move, ensure the grabbed item is selected, then start the
          // move gesture so the real geometry tracks the cursor.
          if (!movingRef.current) {
            movingRef.current = true;
            let movingSel: ReadonlySet<string> = selForDrawRef.current;
            if (d.hitId && !movingSel.has(d.hitId)) {
              movingSel = new Set([d.hitId]);
              applySelect(d.hitId, false);
            }
            beginMove(movingSel, 'move', d.world);
          }
          updateMove(cur);
        } else {
          // Drag from empty space rubber-bands a selection box.
          boxRef.current = { a: d.world, b: cur };
          requestDraw();
        }
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = downRef.current;
    const box = boxRef.current;
    const moved = movingRef.current;
    panRef.current = null;
    downRef.current = null;
    boxRef.current = null;
    movingRef.current = false;
    if (d) {
      if (!d.moved) {
        // Interactive Delete Tool (PCB_CONTROL::DeleteItemCursor): each click
        // deletes the item under the cursor, honouring the selection filter.
        if (activeToolRef.current === 'deleteTool') {
          const w = worldAt(e.clientX, e.clientY);
          const brd = boardRef.current;
          if (w && brd) {
            const hit = hitCandidates(w)[0];
            if (hit) {
              commitBoard(deleteBoardItems(brd, new Set([hit])));
              setSelection(new Set());
            }
          }
        } else if (activeToolRef.current === 'localRatsnestTool') {
          // PCB_ACTIONS::localRatsnestTool: clicking a footprint toggles its
          // ratsnest on while the global ratsnest is hidden.
          const w = worldAt(e.clientX, e.clientY);
          const brd = boardRef.current;
          if (w && brd) {
            // A footprint hit, or any of its children (pad / text) — the
            // heuristics prefer the pad, but the tool acts on the footprint.
            const fpHit = boardHitCandidates(brd, w, tolOf())
              .map((id) => parseBoardItemId(id))
              .find((r) => r?.kind === 'footprint' || r?.kind === 'pad' || r?.kind === 'fptext');
            if (fpHit) {
              setLocalRats((prev) => {
                const next = new Set(prev);
                if (next.has(fpHit.index)) next.delete(fpHit.index);
                else next.add(fpHit.index);
                return next;
              });
            }
          }
        } else if (DRAW_SHAPE_TOOLS[activeToolRef.current]) {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleDrawClick(w);
        } else if (activeToolRef.current === 'routeSingleTrack') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleRouteClick(w);
        } else if (activeToolRef.current === 'drawVia') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleViaClick(w);
        } else if (activeToolRef.current === 'placeText') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) setTextDialog(snapToGrid(w));
        } else if (activeToolRef.current === 'drawZone') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleZoneClick(w);
        } else if (activeToolRef.current === 'measureTool') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleMeasureClick(w);
        } else {
          clickSelect(e.clientX, e.clientY, d.shift);
        }
      } else if (moved) {
        // Drop the left-drag move (EDIT_TOOL Move); a zero net delta restores.
        commitMove();
      } else if (box && boardRef.current) {
        // Left→right = window (contained); right→left = crossing (touching).
        const contained = box.b.x >= box.a.x;
        const ids = boardItemsInBox(
          boardRef.current,
          box.a.x,
          box.a.y,
          box.b.x,
          box.b.y,
          contained,
        ).filter(passesFilter);
        setSelection((prev) => {
          const next = new Set(d.shift ? prev : []);
          for (const id of ids) next.add(id);
          return next;
        });
      }
    }
    requestDraw();
  };
  // Pointer left the canvas — drop the crosshair.
  const onPointerLeave = (): void => {
    cursorRef.current = null;
    setCursor(null);
    requestDraw();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'pcb') !== 'pcb') return;
      // Don't steal keys from text fields (net filter, property editors…).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))
        return;
      const mod = e.ctrlKey || e.metaKey;
      // ACTIONS::highContrastModeCycle (H): Normal -> Dim -> Hide -> Normal.
      if (!mod && (e.key === 'h' || e.key === 'H')) {
        setContrast((c) => (c === 'normal' ? 'dim' : c === 'dim' ? 'hide' : 'normal'));
        return;
      }
      // V while routing: place a via and switch copper layer (ROUTER_TOOL).
      if (!mod && (e.key === 'v' || e.key === 'V') && routeRef.current) {
        e.preventDefault();
        routeViaSwitchRef.current();
        return;
      }
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSel();
        return;
      }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSel();
        return;
      }
      if (!mod && (e.key === 'r' || e.key === 'R')) {
        rotateSel(!e.shiftKey);
        return;
      } // R = CCW, Shift+R = CW
      // M = Move (routing left behind), G = Drag (attached traces follow) — a
      // keyboard grab that follows the cursor and commits on click (EDIT_TOOL).
      if (!mod && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        grabStartRef.current('move');
        return;
      }
      if (!mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        grabStartRef.current('drag');
        return;
      }
      if (!mod && (e.key === 'f' || e.key === 'F')) zoomToFit();
      // Net highlight (BOARD_INSPECTION_TOOL). `~` clears; Alt+` toggles the last
      // highlight on/off; a bare ` highlights the net under the cursor.
      if (!mod && e.key === '~') {
        e.preventDefault();
        clearHighlightRef.current();
        return;
      }
      if (e.key === '`') {
        e.preventDefault();
        if (e.altKey) toggleHighlightRef.current();
        else highlightNetRef.current();
        return;
      }
      if (e.key === 'Escape') {
        // Escape cancels an in-flight grab first, then the disambiguation menu,
        // then clears the selection.
        if (grabbingRef.current) {
          grabCancelRef.current();
          return;
        }
        if (disambigRef.current) {
          hoverRef.current = null;
          setDisambig(null);
        } else if (routeRef.current) {
          // Esc ends the route in progress; committed segments stay.
          routeRef.current = null;
          requestDrawRef.current();
        } else if (zoneRef.current) {
          zoneRef.current = null;
          requestDrawRef.current();
        } else if (measureRef.current) {
          measureRef.current = null;
          requestDrawRef.current();
        } else if (drawingRef.current.length > 0) {
          // First Esc abandons the in-flight shape; the tool stays active.
          drawingRef.current = [];
          requestDrawRef.current();
        } else if (activeToolRef.current !== 'selectSetRect') {
          // Esc in a tool returns to the selection tool (TOOL_MANAGER).
          setActiveTool('selectSetRect');
        } else {
          setShow3D(false);
          setSelection(new Set());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, undo, redo, deleteSel, rotateSel, duplicateSel]);

  const [viewer3dReady, setViewer3dReady] = useState(false);
  // Mount the three.js 3D viewer while the overlay is open. Lazy-imported so
  // three.js only downloads when the user actually opens the 3D view.
  useEffect(() => {
    if (!show3D || !viewer3dRef.current || !boardRef.current) return;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    setViewer3dReady(false);
    const el = viewer3dRef.current,
      brd = boardRef.current;
    void import('./pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try {
        viewer = mount3DViewer(el, brd, projectFiles);
      } catch {
        viewer = null;
      }
      setViewer3dReady(true);
    });
    return () => {
      cancelled = true;
      viewer?.dispose();
    };
  }, [show3D, projectFiles]);

  // ----- appearance data ------------------------------------------------------

  const copperLayers = useMemo(
    () => (board ? board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name) : []),
    [board],
  );
  // Copper layers first, then the technical layers in rebuildLayers()'s
  // non_cu_seq order (appearance_controls.cpp), then any remaining (User.*).
  const layerRows = useMemo(() => {
    if (!board) return [];
    const known = new Set(board.layers.map((l) => l.name));
    const seq = NON_CU_SEQ.map(([n]) => n).filter((n) => known.has(n));
    const seen = new Set([...copperLayers, ...seq]);
    const rest = board.layers.map((l) => l.name).filter((n) => !seen.has(n));
    return [...copperLayers, ...seq, ...rest];
  }, [board, copperLayers]);

  const toggleLayer = (name: string): void => {
    setPreset('(unsaved)');
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const applyPreset = (name: string): void => {
    const user = userPresets.find((x) => x.name === name);
    if (user) {
      setPreset(name);
      setVisible(new Set(user.layers));
      return;
    }
    setPreset(name);
    const p = PRESETS.find((x) => x.name === name);
    if (!p || !board) return;
    const all = board.layers.map((l) => l.name);
    setVisible(new Set(p.layers(all, copperLayers).filter((l) => all.includes(l))));
  };

  // Layer right-click context menu ops (APPEARANCE_CONTROLS::onLayerContextMenu).
  const nonCopperLayers = useMemo(
    () => (board ? board.layers.map((l) => l.name).filter((n) => !/\.Cu$/.test(n)) : []),
    [board],
  );
  const setVisibleUnsaved = (names: Iterable<string>): void => {
    setPreset('(unsaved)');
    setVisible(new Set(names));
  };
  const layerMenuItems = (): { label: string; run: () => void }[][] => {
    if (!board) return [];
    const all = board.layers.map((l) => l.name);
    const has = (n: string): boolean => all.includes(n);
    const applyNamed = (name: string, active?: string): void => {
      const p = PRESETS.find((x) => x.name === name);
      if (!p) return;
      setVisibleUnsaved(p.layers(all, copperLayers).filter(has));
      if (active && has(active)) setActiveLayer(active);
    };
    const groups: { label: string; run: () => void }[][] = [
      [
        {
          label: 'Show All Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...copperLayers]),
        },
        {
          label: 'Hide All Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => !/\.Cu$/.test(n))),
        },
      ],
      [{ label: 'Hide All Layers But Active', run: () => setVisibleUnsaved([activeLayer]) }],
      [
        {
          label: 'Show All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...nonCopperLayers]),
        },
        {
          label: 'Hide All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => /\.Cu$/.test(n))),
        },
      ],
      [
        { label: 'Show All Layers', run: () => setVisibleUnsaved(all) },
        { label: 'Hide All Layers', run: () => setVisibleUnsaved([]) },
      ],
      [
        {
          label: 'Show Only Front Assembly Layers',
          run: () => applyNamed('Front Assembly View', 'F.SilkS'),
        },
        { label: 'Show Only Front Layers', run: () => applyNamed('Front Layers', 'F.Cu') },
        ...(copperLayers.length > 2
          ? [
              {
                label: 'Show Only Inner Layers',
                run: () => applyNamed('Inner Copper Layers', copperLayers[1]),
              },
            ]
          : []),
        { label: 'Show Only Back Layers', run: () => applyNamed('Back Layers', 'B.Cu') },
        {
          label: 'Show Only Back Assembly Layers',
          run: () => applyNamed('Back Assembly View', 'B.SilkS'),
        },
      ],
    ];
    return groups;
  };

  // Presets combo (rebuildLayerPresetsWidget): builtins, user presets,
  // "(unsaved)", then --- / Save preset... / Delete preset...
  const onPresetChoice = (value: string): void => {
    if (value === '---') return;
    if (value === 'Save preset...') {
      const name = window.prompt('Layer preset name:')?.trim();
      if (!name) return;
      setUserPresets((p) => [...p.filter((x) => x.name !== name), { name, layers: [...visible] }]);
      setPreset(name);
      return;
    }
    if (value === 'Delete preset...') {
      setDeleteChooser('presets');
      return;
    }
    applyPreset(value);
  };

  // Viewports combo (rebuildViewportsWidget): saved viewports, then
  // --- / Save viewport... / Delete viewport...
  const onViewportChoice = (value: string): void => {
    if (value === '---') return;
    if (value === 'Save viewport...') {
      const name = window.prompt('Viewport name:')?.trim();
      if (!name) return;
      const v = { ...viewRef.current };
      setViewports((p) => [...p.filter((x) => x.name !== name), { name, view: v }]);
      setViewportSel(name);
      return;
    }
    if (value === 'Delete viewport...') {
      setDeleteChooser('viewports');
      return;
    }
    const vp = viewports.find((x) => x.name === value);
    if (!vp) return;
    viewRef.current.tx = vp.view.tx;
    viewRef.current.ty = vp.view.ty;
    viewRef.current.scale = vp.view.scale;
    setViewportSel(value);
    requestDraw();
  };

  const nets = useMemo(() => {
    if (!board) return [];
    const q = netQuery.toLowerCase();
    return [...board.nets.entries()]
      .filter(([code, name]) => code !== 0 && name.toLowerCase().includes(q))
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [board, netQuery]);

  // ----- ratsnest + net classes ----------------------------------------------

  const netclassInfo = useMemo(() => parseNetclasses(projectFiles), [projectFiles]);
  // net code -> net class name, via the project's netclass_patterns.
  const netClassOf = useMemo(() => {
    const m = new Map<number, string>();
    if (board) {
      for (const [code, name] of board.nets) {
        const hit = netclassInfo.patterns.find((p) => wildcardMatch(p.pattern, name));
        m.set(code, hit?.netclass ?? 'Default');
      }
    }
    return m;
  }, [board, netclassInfo]);
  const classColorOf = useCallback(
    (cls: string): string | undefined => classColors.get(cls) ?? netclassInfo.classColors.get(cls),
    [classColors, netclassInfo],
  );

  // The airwires (CONNECTIVITY_DATA::GetRatsnest), recomputed on every edit.
  const ratsnestEdges = useMemo(() => (board ? buildRatsnest(board) : []), [board]);
  const ratsnestEdgesRef = useRef<RatsnestEdge[]>(ratsnestEdges);
  ratsnestEdgesRef.current = ratsnestEdges;

  // Nets of the current selection — their airwires are always shown (even when
  // the global ratsnest is off), so clicking a pad/footprint/track reveals the
  // thin airwires to what it connects to (PCB_SELECTION_TOOL local ratsnest).
  const selectedNets = useMemo(() => {
    const nets = new Set<number>();
    if (!board) return nets;
    for (const id of selection) {
      const r = parseBoardItemId(id);
      if (!r) continue;
      if (r.kind === 'footprint' || r.kind === 'fptext') {
        const fp = board.footprints[r.index];
        if (fp) for (const p of fp.pads) if (p.net && p.net > 0) nets.add(p.net);
      } else if (r.kind === 'pad') {
        const p = board.footprints[r.index]?.pads[r.sub ?? 0];
        if (p?.net && p.net > 0) nets.add(p.net);
      } else if (r.kind === 'track') {
        const t = board.tracks[r.index];
        if (t && t.net > 0) nets.add(t.net);
      } else if (r.kind === 'arc') {
        const a = board.arcs[r.index];
        if (a && a.net > 0) nets.add(a.net);
      } else if (r.kind === 'via') {
        const v = board.vias[r.index];
        if (v && v.net > 0) nets.add(v.net);
      }
    }
    return nets;
  }, [selection, board]);
  const selectedNetsRef = useRef<ReadonlySet<number>>(selectedNets);
  selectedNetsRef.current = selectedNets;

  // "Toggle Net Highlight" is greyed unless a net is designated for highlight
  // (KiCad's enableNetHighlightCond = IsNetHighlightSet). We enable it whenever
  // the selection carries a net (so a click highlights that net) or a highlight
  // is already active (so a click can toggle it off).
  const leftDisabled = useMemo(() => {
    const s = new Set<string>();
    if (selectedNets.size === 0 && highlightNets.size === 0) s.add('toggleNetHighlight');
    return s;
  }, [selectedNets, highlightNets]);

  // Highlight scene: all copper (tracks/arcs/vias/zones) on the highlighted
  // nets, painted Brightened(0.5) over the dimmed board — BOARD_INSPECTION_TOOL
  // net highlight (pcb_painter.cpp: highlighted items brighten, the rest darken).
  const highlightSceneRef = useRef<BoardScene | null>(null);
  useEffect(() => {
    const brd = boardRef.current;
    if (!brd || highlightNets.size === 0) {
      highlightSceneRef.current = null;
      requestDraw();
      return;
    }
    const ids = new Set<string>();
    brd.tracks.forEach((t, i) => {
      if (highlightNets.has(t.net)) ids.add(boardItemId('track', i));
    });
    brd.arcs.forEach((a, i) => {
      if (highlightNets.has(a.net)) ids.add(boardItemId('arc', i));
    });
    brd.vias.forEach((vv, i) => {
      if (highlightNets.has(vv.net)) ids.add(boardItemId('via', i));
    });
    brd.zones.forEach((z, i) => {
      if (highlightNets.has(z.net)) ids.add(boardItemId('zone', i));
    });
    highlightSceneRef.current = ids.size > 0 ? buildScene(subsetBoardItems(brd, ids)) : null;
    requestDraw();
  }, [highlightNets, requestDraw]);

  // Only recompute the ratsnest live during a drag on boards small enough that
  // a per-frame buildRatsnest stays smooth (bigger boards update on drop).
  const liveRatsRef = useRef(false);
  liveRatsRef.current = board
    ? board.footprints.reduce((n, f) => n + f.pads.length, 0) + board.vias.length <= 1500
    : false;

  // Filter + color a raw airwire list for display (the Nets-tab visibility, the
  // Net Display Options modes, and the Local Ratsnest set). Shared by the
  // steady-state effect and the live recompute during a move.
  const filterRats = useCallback(
    (
      edges: RatsnestEdge[],
      forcedLocalNets?: ReadonlySet<number>,
    ): { e: RatsnestEdge; color: string }[] => {
      const brd = boardRef.current;
      if (!brd) return [];
      const anyCuVisible = [...visible].some((l) => /\.Cu$/.test(l));
      const layerOn = (l: string): boolean => (l === 'through' ? anyCuVisible : visible.has(l));
      const localNets = new Set<number>(forcedLocalNets);
      for (const fi of localRats) {
        const fp = brd.footprints[fi];
        if (fp) for (const pad of fp.pads) if (pad.net && pad.net > 0) localNets.add(pad.net);
      }
      const globalOn = objects.ratsnest && ratsnestMode !== 'off';
      const list: { e: RatsnestEdge; color: string }[] = [];
      for (const e of edges) {
        const isLocal = localNets.has(e.net);
        if (!globalOn && !isLocal) continue;
        const cls = netClassOf.get(e.net) ?? 'Default';
        if (!isLocal) {
          if (hiddenNets.has(e.net) || hiddenClasses.has(cls)) continue;
          if (ratsnestMode === 'visible' && !layerOn(e.aLayer) && !layerOn(e.bLayer)) continue;
        }
        let color: string = PCB_SPECIAL.ratsnest;
        if (netColorMode !== 'off') color = netColors.get(e.net) ?? classColorOf(cls) ?? color;
        list.push({ e, color });
      }
      return list;
    },
    [
      objects.ratsnest,
      ratsnestMode,
      hiddenNets,
      hiddenClasses,
      netColors,
      netColorMode,
      classColorOf,
      netClassOf,
      visible,
      localRats,
    ],
  );
  const filterRatsRef = useRef(filterRats);
  filterRatsRef.current = filterRats;

  // Airwires filtered/colored for display, kept in a ref for the draw pass.
  const ratsDrawRef = useRef<{ e: RatsnestEdge; color: string }[]>([]);
  useEffect(() => {
    ratsDrawRef.current = filterRats(ratsnestEdges, selectedNets);
    requestDraw();
  }, [ratsnestEdges, selectedNets, filterRats, requestDraw]);

  // Net colors mode "All": copper items of explicitly-colored nets get an
  // overlay tint (tracks/arcs/vias/zones; pads keep their layer color for now).
  const coloredScenesRef = useRef<{ color: string; scene: BoardScene }[]>([]);
  useEffect(() => {
    const brd = boardRef.current;
    const list: { color: string; scene: BoardScene }[] = [];
    if (brd && netColorMode === 'all') {
      const colorFor = new Map<number, string>();
      for (const [code] of brd.nets) {
        if (code === 0) continue;
        const c = netColors.get(code) ?? classColorOf(netClassOf.get(code) ?? 'Default');
        if (c) colorFor.set(code, c);
      }
      for (const [net, color] of colorFor) {
        const ids = new Set<string>();
        brd.tracks.forEach((t, i) => {
          if (t.net === net) ids.add(boardItemId('track', i));
        });
        brd.arcs.forEach((a, i) => {
          if (a.net === net) ids.add(boardItemId('arc', i));
        });
        brd.vias.forEach((vv, i) => {
          if (vv.net === net) ids.add(boardItemId('via', i));
        });
        brd.zones.forEach((z, i) => {
          if (z.net === net) ids.add(boardItemId('zone', i));
        });
        if (ids.size > 0) list.push({ color, scene: buildScene(subsetBoardItems(brd, ids)) });
      }
    }
    coloredScenesRef.current = list;
    requestDraw();
  }, [board, netColorMode, netColors, classColorOf, netClassOf, requestDraw]);

  // ----- toolbar handlers -----------------------------------------------------

  // Drag the splitter on the Properties pane's right edge (KiCad's resizable
  // AUI pane), clamped to KiCad's MinSize width of 240.
  const startPropResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = propWidth;
    const onMove = (ev: PointerEvent): void =>
      setPropWidth(Math.max(240, Math.min(600, startW + (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag the Appearance pane's left edge (the AUI dock splitter). KiCad's
  // pane MinSize is the panel min width; clamp like the Properties pane.
  const startAppResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = appWidth;
    const onMove = (ev: PointerEvent): void =>
      setAppWidth(Math.max(200, Math.min(500, startW - (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onLeftToggle = (id: string): void => {
    // The high-contrast button maps onto the Layer Display Options mode
    // (ACTIONS::highContrastMode toggles Normal <-> Dim).
    if (id === 'highContrast') {
      setContrast((c) => (c === 'normal' ? 'dim' : 'normal'));
      return;
    }
    // Ratsnest visibility is the Objects tab's LAYER_RATSNEST, single source.
    if (id === 'showRatsnest') {
      setObjects((p) => ({ ...p, ratsnest: !p.ratsnest }));
      return;
    }
    // Toggle Net Highlight: show/hide the last-highlighted net set.
    if (id === 'toggleNetHighlight') {
      toggleHighlightRef.current();
      return;
    }
    setToggles((prev) => {
      const next = new Set(prev);
      const group = RADIO_GROUPS.find((g) => g.includes(id));
      if (group) {
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const saveCopy = useCallback((): void => {
    // Serialize the (possibly edited) board; fall back to the original text if
    // it never parsed. serializeBoard is lossless for unedited boards.
    const out = boardRef.current ? serializeBoard(boardRef.current) : text;
    const blob = new Blob([out], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [text, fileName]);

  const onTopAction = (id: string): void => {
    switch (id) {
      case 'save':
        saveCopy();
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'rotateCCW':
        rotateSel(true);
        break;
      case 'rotateCW':
        rotateSel(false);
        break;
      case 'mirrorV':
        mirrorSel('v');
        break;
      case 'mirrorH':
        mirrorSel('h');
        break;
      case 'group':
        groupSel();
        break;
      case 'ungroup':
        ungroupSel();
        break;
      case 'lock':
        lockSel(true);
        break;
      case 'unlock':
        lockSel(false);
        break;
      case 'find':
        setFindOpen(true);
        break;
      case 'zoomRedraw':
        sceneDirtyRef.current = true;
        requestDraw();
        break;
      case 'zoomIn':
        zoomStep(1.3);
        break;
      case 'zoomOut':
        zoomStep(1 / 1.3);
        break;
      case 'zoomFit':
      case 'zoomFitObjects':
        zoomToFit();
        break;
      case 'showEeschema':
        onShowSchematic?.();
        break;
      case 'threeDViewer':
        setShow3D(true);
        break;
      default:
        break; // other editing actions are staged
    }
  };

  // ----- menus (menubar_pcb_editor.cpp structure, working subset active) ------

  const dis = true;
  const alignDisabled = selection.size < 2;
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New Board', disabled: dis },
        { label: 'Open…', disabled: dis },
        { sep: true },
        { label: 'Save', action: saveCopy, shortcut: 'Ctrl+S' },
        { label: 'Save a Copy…', action: saveCopy },
        { sep: true },
        { label: 'Import', disabled: dis },
        { label: 'Export', disabled: dis },
        { label: 'Fabrication Outputs', disabled: dis },
        { sep: true },
        { label: 'Close (back to project)', action: onExit, shortcut: 'Ctrl+W' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: undo, shortcut: 'Ctrl+Z' },
        { label: 'Redo', action: redo, shortcut: 'Ctrl+Y' },
        { sep: true },
        { label: 'Duplicate', action: duplicateSel, shortcut: 'Ctrl+D' },
        { label: 'Delete', action: deleteSel, shortcut: 'Del' },
        { sep: true },
        {
          label: 'Align/Distribute',
          submenu: [
            {
              label: 'Align to Left',
              action: () => alignSelection('left'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Horizontal Center',
              action: () => alignSelection('centerX'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Right',
              action: () => alignSelection('right'),
              disabled: alignDisabled,
            },
            { sep: true },
            {
              label: 'Align to Top',
              action: () => alignSelection('top'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Vertical Center',
              action: () => alignSelection('centerY'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Bottom',
              action: () => alignSelection('bottom'),
              disabled: alignDisabled,
            },
          ],
        },
        { sep: true },
        { label: 'Find', disabled: dis, shortcut: 'Ctrl+F' },
        { sep: true },
        { label: 'Global Deletions…', disabled: dis },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', action: () => zoomStep(1.3), shortcut: 'Ctrl++' },
        { label: 'Zoom Out', action: () => zoomStep(1 / 1.3), shortcut: 'Ctrl+-' },
        { label: 'Zoom to Fit', action: zoomToFit, shortcut: 'F' },
        {
          label: 'Redraw',
          action: () => {
            sceneDirtyRef.current = true;
            requestDraw();
          },
          shortcut: 'F5',
        },
        { sep: true },
        { label: 'Show Appearance Manager', action: () => onLeftToggle('showLayersManager') },
        { sep: true },
        { label: 'Flip Board View', disabled: dis },
        { label: '3D Viewer', disabled: dis },
      ],
    },
    {
      label: 'Place',
      items: [
        { label: 'Footprint…', disabled: dis },
        { label: 'Via', disabled: dis },
        { label: 'Zone', disabled: dis },
        { label: 'Text', disabled: dis },
        { label: 'Dimension', disabled: dis },
        { sep: true },
        { label: 'Drill/Place File Origin', disabled: dis },
        { label: 'Grid Origin', disabled: dis },
      ],
    },
    {
      label: 'Route',
      items: [
        { label: 'Single Track', disabled: dis, shortcut: 'X' },
        { label: 'Differential Pair', disabled: dis },
        { sep: true },
        { label: 'Tune Length of a Single Track', disabled: dis },
        { label: 'Tune Length of a Differential Pair', disabled: dis },
        { label: 'Tune Skew of a Differential Pair', disabled: dis },
        { sep: true },
        { label: 'Interactive Router Settings…', disabled: dis },
      ],
    },
    {
      label: 'Inspect',
      items: [
        { label: 'Measure Tool', disabled: dis, shortcut: 'Ctrl+Shift+M' },
        { label: 'Board Statistics', disabled: dis },
        { sep: true },
        { label: 'Design Rules Checker', disabled: dis },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Update PCB from Schematic…', disabled: dis, shortcut: 'F8' },
        { label: 'Update Footprints from Library…', disabled: dis },
        { sep: true },
        { label: 'Remove Unused Pads…', disabled: dis },
        { label: 'Cleanup Tracks & Vias…', disabled: dis },
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Preferences…', disabled: dis, shortcut: 'Ctrl+,' }],
    },
    { label: 'Help', items: [{ label: 'About ZiroEDA', action: () => {} }] },
  ];

  // ----- unit display ---------------------------------------------------------

  const fmtCoord = (iu: number): string => {
    const mm = iuToMM(iu);
    if (toggles.has('unitsInches')) return (mm / 25.4).toFixed(4);
    if (toggles.has('unitsMils')) return ((mm / 25.4) * 1000).toFixed(2);
    return mm.toFixed(4);
  };
  const fmtAngle = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(3)}`;
  const unitLabel = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const statusCoordText = cursor ? `X ${fmtCoord(cursor.x)}  Y ${fmtCoord(cursor.y)}` : 'X —  Y —';
  const statusDeltaText = cursor
    ? toggles.has('togglePolarCoords')
      ? `r ${fmtCoord(Math.hypot(cursor.x, cursor.y))}  theta ${fmtAngle(Math.atan2(-cursor.y, cursor.x))}`
      : `dx ${fmtCoord(cursor.x)}  dy ${fmtCoord(cursor.y)}  dist ${fmtCoord(Math.hypot(cursor.x, cursor.y))}`
    : toggles.has('togglePolarCoords')
      ? 'r —  theta —'
      : 'dx —  dy —  dist —';
  const gridText = `grid ${fmtCoord(DEFAULT_GRID_OPTIONS.size)}`;
  // Field 6 (EDA_DRAW_FRAME::DisplayToolMsg, the "Current Tool" panel): the
  // friendly name of the active right-toolbar tool, blank in the selection tool.
  const toolMsg = PCB_TOOL_MSGS[activeTool] ?? '';
  // Field 7 (DisplayConstraintsMsg): the line-constraint hint shown while a
  // line/track drawing tool is active (COMMON_TOOLS line mode).
  const constraintMsg =
    routeRef.current || DRAW_SHAPE_TOOLS[activeTool]
      ? toggles.has('lineMode45')
        ? 'Constrain to H, V, 45'
        : toggles.has('lineMode90')
          ? 'Constrain to H, V'
          : ''
      : '';
  const messagePanelItems: MsgPanelItem[] = useMemo(() => {
    if (!board)
      return [
        { upper: 'Pads', lower: '0' },
        { upper: 'Vias', lower: '0' },
        { upper: 'Track Segments', lower: '0' },
        { upper: 'Nets', lower: '0' },
        { upper: 'Unrouted', lower: '0' },
      ];

    const net = (code: number): string =>
      board.nets.get(code) || (code === 0 ? '<no net>' : `net ${code}`);
    const itemPos = (bbox: BoardBBox | null): string =>
      bbox ? `X ${fmtCoord(bboxCenter(bbox).x)}  Y ${fmtCoord(bboxCenter(bbox).y)}` : '';
    const selectedIds = [...selection];

    if (selectedIds.length === 0) {
      const padCount = board.footprints.reduce((sum, fp) => sum + fp.pads.length, 0);
      return [
        { upper: 'Pads', lower: String(padCount) },
        { upper: 'Vias', lower: String(board.vias.length) },
        { upper: 'Track Segments', lower: String(board.tracks.length + board.arcs.length) },
        { upper: 'Nets', lower: String(Math.max(0, board.nets.size - 1)) },
        { upper: 'Unrouted', lower: String(ratsnestEdges.length) },
      ];
    }

    if (selectedIds.length === 1) {
      const id = selectedIds[0]!;
      const r = parseBoardItemId(id);
      const bbox = boardItemBBox(board, id);
      const common = [
        { upper: 'Item', lower: describeBoardItem(board, id) },
        { upper: 'Position', lower: itemPos(bbox) },
      ];
      if (!r) return common;

      switch (r.kind) {
        case 'footprint': {
          const fp = board.footprints[r.index];
          if (!fp) return common;
          // FOOTPRINT::GetMsgPanelInfo (board editor): reference→value, board
          // side, rotation, then status/attributes — matching pcbnew exactly.
          const attrLabel: Record<string, string> = {
            board_only: 'not in schematic',
            exclude_from_pos_files: 'exclude from pos files',
            exclude_from_bom: 'exclude from BOM',
            dnp: 'DNP',
          };
          const attrs = (fp.attributes ?? []).map((a) => attrLabel[a] ?? a).join(', ');
          const status = fp.locked ? 'Locked' : '';
          return [
            { upper: fp.reference || '', lower: fp.value || '' },
            { upper: 'Board Side', lower: fp.layer === 'B.Cu' ? 'Back (Flipped)' : 'Front' },
            { upper: 'Rotation', lower: String(Number(fp.angle.toPrecision(4))) },
            { upper: `Status: ${status}`, lower: `Attributes: ${attrs}` },
          ];
        }
        case 'track': {
          const t = board.tracks[r.index];
          return t
            ? [
                { upper: 'Track', lower: t.layer },
                { upper: 'Net', lower: net(t.net) },
                { upper: 'Width', lower: fmtCoord(t.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'arc': {
          const a = board.arcs[r.index];
          return a
            ? [
                { upper: 'Arc', lower: a.layer },
                { upper: 'Net', lower: net(a.net) },
                { upper: 'Width', lower: fmtCoord(a.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'via': {
          const v = board.vias[r.index];
          return v
            ? [
                { upper: 'Via', lower: v.kind },
                { upper: 'Net', lower: net(v.net) },
                { upper: 'Size', lower: fmtCoord(v.size) },
                { upper: 'Drill', lower: fmtCoord(v.drill) },
                { upper: 'Position', lower: `X ${fmtCoord(v.at.x)}  Y ${fmtCoord(v.at.y)}` },
              ]
            : common;
        }
        case 'zone': {
          const z = board.zones[r.index];
          return z
            ? [
                { upper: 'Zone', lower: z.netName ?? net(z.net) },
                { upper: 'Layers', lower: z.layers.join(', ') },
                ...common.slice(1),
              ]
            : common;
        }
        case 'shape': {
          const s = board.shapes[r.index];
          return s
            ? [
                { upper: 'Graphic', lower: s.kind },
                { upper: 'Layer', lower: s.layer },
                { upper: 'Width', lower: fmtCoord(s.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'text': {
          const t = board.texts[r.index];
          return t
            ? [
                { upper: 'Text', lower: t.text },
                { upper: 'Layer', lower: t.layer },
                { upper: 'Position', lower: `X ${fmtCoord(t.at.x)}  Y ${fmtCoord(t.at.y)}` },
              ]
            : common;
        }
        case 'fptext': {
          const fp = board.footprints[r.index];
          const t = fp?.texts[r.sub ?? 0];
          return t
            ? [
                { upper: 'Footprint Text', lower: t.text },
                { upper: 'Footprint', lower: fp?.reference || fp?.lib || '' },
                { upper: 'Layer', lower: t.layer },
                { upper: 'Position', lower: `X ${fmtCoord(t.at.x)}  Y ${fmtCoord(t.at.y)}` },
              ]
            : common;
        }
        case 'pad': {
          const fp = board.footprints[r.index];
          const p = fp?.pads[r.sub ?? 0];
          if (!p) return common;
          // PAD::GetMsgPanelInfo (board editor): Footprint, Pad, Net, Layer,
          // shape/type, size + rotation, then hole — matching pcbnew's order.
          const dim = (iu: number): string => `${fmtCoord(iu)} ${unitLabel}`;
          const shapeLabel = p.shape.charAt(0).toUpperCase() + p.shape.slice(1);
          // Pad type abbreviations (ShowPadAttr): plated/non-plated through hole,
          // SMD, connector.
          const padType =
            p.type === 'thru_hole'
              ? 'PTH'
              : p.type === 'np_thru_hole'
                ? 'NPTH'
                : p.type === 'smd'
                  ? 'SMD'
                  : p.type === 'connect'
                    ? 'Connector'
                    : p.type;
          const sizeItems =
            p.shape === 'circle'
              ? [{ upper: 'Diameter', lower: dim(p.size.x) }]
              : [
                  { upper: 'Width', lower: dim(p.size.x) },
                  { upper: 'Height', lower: dim(p.size.y) },
                ];
          const holeItems = p.drill
            ? [
                {
                  upper: p.drill.oblong ? 'Hole X / Y' : 'Hole',
                  lower: p.drill.oblong
                    ? `${fmtCoord(p.drill.w)} / ${fmtCoord(p.drill.h)} ${unitLabel}`
                    : dim(p.drill.w),
                },
              ]
            : [];
          const pinItems = [
            ...(p.pinFunction ? [{ upper: 'Pin Name', lower: p.pinFunction }] : []),
            ...(p.pinType ? [{ upper: 'Pin Type', lower: p.pinType }] : []),
          ];
          return [
            { upper: 'Footprint', lower: fp?.reference || fp?.lib || '' },
            { upper: 'Pad', lower: p.number },
            ...pinItems,
            { upper: 'Net', lower: net(p.net ?? 0) },
            { upper: 'Resolved Netclass', lower: netClassOf.get(p.net ?? 0) ?? 'Default' },
            { upper: 'Layer', lower: p.layers.join(', ') },
            { upper: shapeLabel, lower: padType },
            ...sizeItems,
            { upper: 'Rotation', lower: String(Number((p.angle ?? 0).toPrecision(4))) },
            ...holeItems,
          ];
        }
      }
    }

    const labels: Partial<Record<BoardItemKind, string>> = {
      footprint: 'Footprints',
      fptext: 'Footprint Text',
      pad: 'Pads',
      track: 'Tracks',
      arc: 'Arcs',
      via: 'Vias',
      zone: 'Zones',
      shape: 'Graphics',
      text: 'Text',
    };
    const counts = new Map<string, number>();
    for (const id of selectedIds) {
      const r = parseBoardItemId(id);
      const label = r ? (labels[r.kind] ?? r.kind) : 'Items';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [
      { upper: 'Selection', lower: `${selectedIds.length} items` },
      ...[...counts.entries()].map(([upper, count]) => ({ upper, lower: String(count) })),
    ];
  }, [board, fmtCoord, ratsnestEdges.length, selection, netClassOf, unitLabel]);

  return (
    <div className="ze-app">
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExit} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={
          <>
            <b>{projectName || fileName.replace(/\.kicad_pcb$/i, '') || 'No project'}</b>
            &nbsp;—&nbsp;PCB Editor
          </>
        }
      />
      <Toolbar entries={PCB_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      {/* TOP_AUX bar: track width / via size / active layer / grid / zoom */}
      <div
        className="ze-auxbar"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '2px 8px',
          borderBottom: '1px solid #333',
          fontSize: 12,
        }}
      >
        <select disabled title="Track width (routing is staged)">
          <option>Track: use netclass width</option>
        </select>
        <select disabled title="Via size (routing is staged)">
          <option>Via: use netclass sizes</option>
        </select>
        <span style={{ width: 8 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: layerColor(activeLayer),
              borderRadius: 2,
              border: '1px solid #444',
            }}
          />
          <select
            value={activeLayer}
            onChange={(e) => setActiveLayer(e.target.value)}
            title="Active layer"
          >
            {(board?.layers ?? []).map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </span>
        <span style={{ width: 8 }} />
        <select disabled title="Grid">
          <option>Grid: 0.635 mm (25 mils)</option>
        </select>
        <select disabled title="Zoom presets">
          <option>Zoom Auto</option>
        </select>
      </div>

      <div className="ze-body">
        {/* KiCad docks the Properties pane outermost-left (Layer 5), then the
            left options toolbar (Layer 3), then the canvas. */}
        {showProperties && (
          <div
            className="ze-leftdock"
            style={{ width: propWidth, minWidth: 240, position: 'relative' }}
          >
            <div className="ze-panel grow">
              <div className="ze-panel-header">Properties</div>
              <div className="ze-panel-body">
                {selection.size === 0 ? (
                  <div className="ze-muted">No objects selected</div>
                ) : (
                  <PcbSelectionInfo
                    board={board}
                    selection={selection}
                    onEditFootprint={editFootprint}
                  />
                )}
              </div>
            </div>
            <div
              onPointerDown={startPropResize}
              title="Resize"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 5,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
          </div>
        )}

        <Toolbar
          entries={PCB_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={leftToggles}
          disabledIds={leftDisabled}
          onActivate={onLeftToggle}
        />

        <div className="ze-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            // Hide the native pointer; KiCad draws its own crosshair on the canvas.
            style={{ position: 'absolute', inset: 0, cursor: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
          />
          {!board && !error && (
            <div className="ze-canvas-loading">
              <span className="ze-spinner" />
              <span>Loading board… (large boards can take a while)</span>
            </div>
          )}
          {error && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: '#ff8080',
              }}
            >
              Couldn’t open board: {error}
            </div>
          )}
        </div>

        <Toolbar
          entries={PCB_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={setActiveTool}
        />

        {/* LayersManager + SelectionFilter dock: Right().Layer(4), outside the
            Right().Layer(3) toolbar (pcb_edit_frame.cpp AUI setup), i.e. at the
            window edge with the toolbar between it and the canvas. */}
        {showAppearance && (
          <div className="ze-rightdock" style={{ width: appWidth, position: 'relative' }}>
            <div
              onPointerDown={startAppResize}
              title="Resize"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 5,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              {/* tabs, like APPEARANCE_CONTROLS' notebook */}
              <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
                {(['Layers', 'Objects', 'Nets'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: tab === t ? '#2a2a2e' : 'transparent',
                      color: 'inherit',
                      border: 'none',
                      borderBottom: tab === t ? '2px solid #4d7fc4' : '2px solid transparent',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="ze-panel-body" style={{ overflow: 'auto' }}>
                {tab === 'Layers' &&
                  layerRows.map((name) => {
                    const on = visible.has(name);
                    return (
                      // appendLayer row: [indicator][color swatch][eye][name]
                      <div
                        key={name}
                        className={`ze-layer-row${name === activeLayer ? ' active' : ''}`}
                        onClick={() => setActiveLayer(name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setLayerMenu({ x: e.clientX, y: e.clientY });
                        }}
                        title={layerTooltip(name)}
                      >
                        <span
                          className={`ze-layer-indicator${name === activeLayer ? ' on' : ''}`}
                        />
                        <span
                          className="ze-layer-swatch"
                          style={{ background: layerColor(name) }}
                        />
                        <button
                          type="button"
                          className="ze-eye-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLayer(name);
                          }}
                          title="Show or hide this layer"
                        >
                          <EyeIcon on={on} />
                        </button>
                        <span className="ze-ellipsis">{LAYER_DISPLAY_NAMES[name] ?? name}</span>
                      </div>
                    );
                  })}

                {tab === 'Objects' &&
                  OBJECT_ROWS.map((row, i) => {
                    if (row === 'sep') return <div key={`sep${i}`} style={{ height: 8 }} />;
                    const { key, label, tooltip, slider, noVisibility, disabled } = row;
                    const on = objects[key];
                    const swatchColor = PCB_OBJECT_COLORS[key];
                    return (
                      // appendObject row: [swatch|spacer][eye|spacer][label][slider]
                      <div
                        key={key}
                        className="ze-object-row"
                        title={tooltip}
                        style={disabled ? { opacity: 0.4 } : undefined}
                      >
                        <span
                          className={`ze-layer-swatch${swatchColor ? '' : ' blank'}`}
                          style={swatchColor ? { background: swatchColor } : undefined}
                        />
                        {noVisibility ? (
                          <span style={{ width: 16, flex: '0 0 auto' }} />
                        ) : (
                          <button
                            type="button"
                            className="ze-eye-btn"
                            onClick={() => {
                              if (!disabled) setObjects((p) => ({ ...p, [key]: !p[key] }));
                            }}
                            title={`Show or hide ${label.toLowerCase()}`}
                          >
                            <EyeIcon on={on} />
                          </button>
                        )}
                        {/* Opacity rows fix the label width so all sliders line
                            up (KiCad's label->SetMinSize(labelWidth)); other
                            rows let the label fill the row. */}
                        <span className={`ze-obj-label${slider ? ' fixed' : ''}`}>{label}</span>
                        {slider &&
                          key in opacity &&
                          (() => {
                            const pct = Math.round(opacity[key as keyof typeof opacity] * 100);
                            return (
                              <input
                                type="range"
                                className="ze-opacity"
                                min={0}
                                max={100}
                                value={pct}
                                // Fill the track left of the thumb (KiCad's slider
                                // shows the set portion), the rest neutral grey.
                                style={{
                                  background: `linear-gradient(to right, var(--slider-fill) 0 ${pct}%, #55585d ${pct}% 100%)`,
                                }}
                                title={`Set opacity of ${label.toLowerCase()}`}
                                disabled={disabled}
                                onChange={(e) =>
                                  setOpacity((p) => ({
                                    ...p,
                                    [key]: Number(e.target.value) / 100,
                                  }))
                                }
                              />
                            );
                          })()}
                      </div>
                    );
                  })}

                {tab === 'Nets' && (
                  <>
                    {/* Nets box: header + filter + the scrollable net list, its
                        own panel like KiCad's nets/netclasses splitter. */}
                    <div className="ze-nets-box">
                      <div className="ze-nets-header">
                        <span>Nets</span>
                        <input
                          type="search"
                          placeholder="Filter nets"
                          value={netQuery}
                          onChange={(e) => setNetQuery(e.target.value)}
                        />
                      </div>
                      <div className="ze-nets-list">
                        {/* Net rows: [color swatch][visibility][name]; the swatch
                            opens a color picker, the eye hides the net's ratsnest. */}
                        {nets.slice(0, 400).map(([code, name]) => {
                          const color = netColors.get(code);
                          const on = !hiddenNets.has(code);
                          return (
                            <div key={code} className="ze-object-row" title={`Net ${code}`}>
                              <label
                                className={`ze-layer-swatch picker${color ? '' : ' unset'}`}
                                style={color ? { background: color } : undefined}
                                title="Set net color"
                              >
                                <input
                                  type="color"
                                  value={color ?? '#000000'}
                                  onChange={(e) =>
                                    setNetColors((p) => new Map(p).set(code, e.target.value))
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="ze-eye-btn"
                                title={`Show or hide ratsnest for ${name}`}
                                onClick={() =>
                                  setHiddenNets((p) => {
                                    const next = new Set(p);
                                    if (next.has(code)) next.delete(code);
                                    else next.add(code);
                                    return next;
                                  })
                                }
                              >
                                <EyeIcon on={on} />
                              </button>
                              <span className="ze-ellipsis">{name || `(unnamed ${code})`}</span>
                            </div>
                          );
                        })}
                        {nets.length > 400 && (
                          <div className="ze-muted">…{nets.length - 400} more</div>
                        )}
                      </div>
                    </div>

                    {/* Net Classes box: the lower panel of KiCad's nets splitter. */}
                    <div className="ze-nets-box">
                      <div className="ze-nets-header">
                        <span>Net Classes</span>
                      </div>
                      {netclassInfo.classes.map((cls) => {
                        const color = classColorOf(cls);
                        const on = !hiddenClasses.has(cls);
                        return (
                          <div key={cls} className="ze-object-row">
                            <label
                              className={`ze-layer-swatch picker${color ? '' : ' unset'}`}
                              style={color ? { background: color } : undefined}
                              title="Set netclass color"
                            >
                              <input
                                type="color"
                                value={color?.startsWith('#') ? color : '#000000'}
                                onChange={(e) =>
                                  setClassColors((p) => new Map(p).set(cls, e.target.value))
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="ze-eye-btn"
                              title={`Show or hide ratsnest for the ${cls} class`}
                              onClick={() =>
                                setHiddenClasses((p) => {
                                  const next = new Set(p);
                                  if (next.has(cls)) next.delete(cls);
                                  else next.add(cls);
                                  return next;
                                })
                              }
                            >
                              <EyeIcon on={on} />
                            </button>
                            <span className="ze-ellipsis">{cls}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* "Net Display Options" collapsible pane on the Nets tab. */}
              {tab === 'Nets' && (
                <div className="ze-collapsepane">
                  <button className="ze-collapse-toggle" onClick={() => setNetOptsOpen((o) => !o)}>
                    <span className={`ze-collapse-arrow${netOptsOpen ? ' open' : ''}`} />
                    Net Display Options
                  </button>
                  {netOptsOpen && (
                    <div className="ze-collapse-body">
                      <div className="ze-info" title="Choose when to show net and netclass colors">
                        Net colors:
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Net and netclass colors are shown on all copper items">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'all'}
                            onChange={() => setNetColorMode('all')}
                          />
                          All
                        </label>
                        <label title="Net and netclass colors are shown on the ratsnest only">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'ratsnest'}
                            onChange={() => setNetColorMode('ratsnest')}
                          />
                          Ratsnest
                        </label>
                        <label title="Net and netclass colors are not shown">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'off'}
                            onChange={() => setNetColorMode('off')}
                          />
                          None
                        </label>
                      </div>
                      <div className="ze-info" style={{ marginTop: 6 }}>
                        Ratsnest display:
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Show ratsnest lines to items on all layers">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'all'}
                            onChange={() => setRatsnestMode('all')}
                          />
                          All
                        </label>
                        <label title="Show ratsnest lines to items on visible layers">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'visible'}
                            onChange={() => setRatsnestMode('visible')}
                          />
                          Visible layers
                        </label>
                        <label title="Hide all ratsnest lines">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'off'}
                            onChange={() => setRatsnestMode('off')}
                          />
                          None
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* "Layer Display Options" collapsible pane at the bottom of the
                  Layers tab (createControls). */}
              {tab === 'Layers' && (
                <div className="ze-collapsepane">
                  <button
                    className="ze-collapse-toggle"
                    onClick={() => setLayerOptsOpen((o) => !o)}
                  >
                    <span className={`ze-collapse-arrow${layerOptsOpen ? ' open' : ''}`} />
                    Layer Display Options
                  </button>
                  {layerOptsOpen && (
                    <div className="ze-collapse-body">
                      <div className="ze-info">Inactive layers (H):</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Inactive layers will be shown in full color">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'normal'}
                            onChange={() => setContrast('normal')}
                          />
                          Normal
                        </label>
                        <label title="Inactive layers will be dimmed">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'dim'}
                            onChange={() => setContrast('dim')}
                          />
                          Dim
                        </label>
                        <label title="Inactive layers will be hidden">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'hide'}
                            onChange={() => setContrast('hide')}
                          />
                          Hide
                        </label>
                      </div>
                      <hr className="ze-hr" />
                      <label>
                        <input type="checkbox" checked={flipView} onChange={toggleFlip} />
                        Flip board view
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Presets / Viewports below the notebook (appearance_controls_base). */}
              <div className="ze-appearance-bottom">
                <div className="ze-info">Presets (Ctrl+Tab):</div>
                <select value={preset} onChange={(e) => onPresetChoice(e.target.value)}>
                  {preset === '(unsaved)' && <option value="(unsaved)">(unsaved)</option>}
                  {PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  {userPresets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  <option value="---">---</option>
                  <option>Save preset...</option>
                  <option disabled={userPresets.length === 0}>Delete preset...</option>
                </select>
                <div className="ze-info" style={{ marginTop: 4 }}>
                  Viewports (Shift+Tab):
                </div>
                <select value={viewportSel} onChange={(e) => onViewportChoice(e.target.value)}>
                  {viewports.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                  <option value="---">---</option>
                  <option>Save viewport...</option>
                  <option disabled={viewports.length === 0}>Delete viewport...</option>
                </select>
              </div>
            </div>

            <div className="ze-panel">
              <div className="ze-panel-header">Selection Filter</div>
              <div className="ze-panel-body">
                {/* PANEL_SELECTION_FILTER_BASE's wxGridBagSizer: "All items"
                    at (0,0), then the categories two per row in upstream
                    order. Right-clicking a category pops "Only <label>". */}
                <div className="ze-selfilter">
                  <label>
                    <input
                      type="checkbox"
                      checked={selFilter.size === PCB_FILTER_CATS.length}
                      onChange={() =>
                        // OnFilterChanged on m_cbAllItems: drive every
                        // category to the new state.
                        setSelFilter((p) =>
                          p.size === PCB_FILTER_CATS.length
                            ? new Set()
                            : new Set(PCB_FILTER_CATS.map((c) => c.key)),
                        )
                      }
                    />
                    All items
                  </label>
                  {PCB_FILTER_CATS.map(({ key, label, tooltip }) => (
                    <label
                      key={key}
                      title={tooltip}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFilterMenu({ x: e.clientX, y: e.clientY, key, label });
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selFilter.has(key)}
                        onChange={() =>
                          setSelFilter((p) => {
                            const n = new Set(p);
                            if (n.has(key)) n.delete(key);
                            else n.add(key);
                            return n;
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {show3D && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgb(13,15,23)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 12px',
              borderBottom: '1px solid #333',
              fontSize: 13,
            }}
          >
            <b>3D Viewer</b>
            <span style={{ opacity: 0.6 }}>drag to orbit · wheel to zoom · Esc to close</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setShow3D(false)}>Close ✕</button>
          </div>
          <div
            ref={viewer3dRef}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              background: 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)',
            }}
          >
            {!viewer3dReady && (
              <div className="ze-canvas-loading">
                <span className="ze-spinner" />
                <span>Loading 3D viewer…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disambiguation menu (PCB_SELECTION_TOOL::doSelectionMenu): pick which of
          several overlapping items to select; hovering a row previews it. */}
      {disambig && board && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => {
              hoverRef.current = null;
              setDisambig(null);
              requestDraw();
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(disambig.x, window.innerWidth - 220),
              top: disambig.y,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 190,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '2px 12px 4px', opacity: 0.6 }}>Clarify Selection</div>
            {disambig.ids.map((id) => (
              <div
                key={id}
                className="ze-tree-item"
                style={{ padding: '3px 12px', cursor: 'pointer' }}
                onMouseEnter={() => {
                  hoverRef.current = id;
                  requestDraw();
                }}
                onMouseLeave={() => {
                  if (hoverRef.current === id) {
                    hoverRef.current = null;
                    requestDraw();
                  }
                }}
                onClick={() => {
                  hoverRef.current = null;
                  applySelect(id, disambig.additive);
                  setDisambig(null);
                }}
              >
                {describeBoardItem(board, id)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Selection Filter right-click menu (PANEL_SELECTION_FILTER::onRightClick):
          a single "Only <category>" entry that unchecks everything else. */}
      {filterMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setFilterMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFilterMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(filterMenu.x, window.innerWidth - 200),
              top: filterMenu.y,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 160,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="ze-tree-item"
              style={{ padding: '3px 12px', cursor: 'pointer' }}
              onClick={() => {
                setSelFilter(new Set([filterMenu.key]));
                setFilterMenu(null);
              }}
            >
              Only {filterMenu.label.toLowerCase()}
            </div>
          </div>
        </>
      )}

      {/* Layer right-click menu (APPEARANCE_CONTROLS::rightClickHandler /
          onLayerContextMenu), acting on the active layer like upstream. */}
      {layerMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setLayerMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setLayerMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(layerMenu.x, window.innerWidth - 260),
              top: Math.min(layerMenu.y, window.innerHeight - 320),
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 230,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {layerMenuItems().map((group, gi, arr) => (
              <div key={`g${gi}`}>
                {group.map((item) => (
                  <div
                    key={item.label}
                    className="ze-tree-item"
                    style={{ padding: '3px 12px', cursor: 'pointer' }}
                    onClick={() => {
                      item.run();
                      setLayerMenu(null);
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                {gi < arr.length - 1 && (
                  <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '4px 0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* "Delete preset/viewport..." chooser (EDA_LIST_DIALOG stand-in). */}
      {deleteChooser && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setDeleteChooser(null)}
          />
          <div
            style={{
              position: 'fixed',
              right: 24,
              bottom: 120,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 180,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '2px 12px 4px', opacity: 0.6 }}>
              Delete {deleteChooser === 'presets' ? 'preset' : 'viewport'}
            </div>
            {(deleteChooser === 'presets' ? userPresets : viewports).map((p) => (
              <div
                key={p.name}
                className="ze-tree-item"
                style={{ padding: '3px 12px', cursor: 'pointer' }}
                onClick={() => {
                  if (deleteChooser === 'presets') {
                    setUserPresets((u) => u.filter((x) => x.name !== p.name));
                    if (preset === p.name) setPreset('(unsaved)');
                  } else {
                    setViewports((v) => v.filter((x) => x.name !== p.name));
                    if (viewportSel === p.name) setViewportSel('---');
                  }
                  setDeleteChooser(null);
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        </>
      )}

      {/* "Add Text" properties dialog (DRAWING_TOOL::PlaceText opens the text
          properties dialog before placing). */}
      {textDialog && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
            onMouseDown={() => {
              setTextDialog(null);
              setTextDraft('');
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '40%',
              transform: 'translate(-50%, -50%)',
              zIndex: 61,
              background: '#2a2c30',
              border: '1px solid #444',
              borderRadius: 4,
              width: 360,
              padding: 12,
              fontSize: 13,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Text Properties</div>
            <textarea
              // biome-ignore lint/a11y/noAutofocus: focus the just-opened dialog's input
              autoFocus
              rows={3}
              value={textDraft}
              placeholder="Text"
              style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTextDialog(null);
                  setTextDraft('');
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  commitPlacedText();
                }
              }}
            />
            <div style={{ marginTop: 4 }} className="ze-muted">
              Layer: {LAYER_DISPLAY_NAMES[activeLayer] ?? activeLayer}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => {
                  setTextDialog(null);
                  setTextDraft('');
                }}
              >
                Cancel
              </button>
              <button onClick={commitPlacedText}>OK</button>
            </div>
          </div>
        </>
      )}

      {/* "Copper Zone Properties" dialog: the zone tool opens it on the first
          click (DRAWING_TOOL::DrawZone), then the outline is drawn. */}
      {zoneDialog && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
            onMouseDown={() => setZoneDialog(null)}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '40%',
              transform: 'translate(-50%, -50%)',
              zIndex: 61,
              background: '#2a2c30',
              border: '1px solid #444',
              borderRadius: 4,
              width: 340,
              padding: 12,
              fontSize: 13,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Copper Zone Properties</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8 }}>
              <label htmlFor="ze-zone-layer">Layer:</label>
              <select
                id="ze-zone-layer"
                value={zoneLayer}
                onChange={(e) => setZoneLayer(e.target.value)}
              >
                {copperLayers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <label htmlFor="ze-zone-net">Net:</label>
              <select
                id="ze-zone-net"
                value={zoneNet}
                onChange={(e) => setZoneNet(Number(e.target.value))}
              >
                <option value={0}>&lt;no net&gt;</option>
                {nets.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name || `(unnamed ${code})`}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setZoneDialog(null)}>Cancel</button>
              <button
                onClick={() => {
                  if (zoneDialog) {
                    zoneRef.current = { net: zoneNet, layer: zoneLayer, pts: [zoneDialog] };
                    if (zoneLayer !== activeLayer) setActiveLayer(zoneLayer);
                  }
                  setZoneDialog(null);
                  requestDraw();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* EDA_DRAW_FRAME hosts a message panel above pcbnew's 8-field status bar. */}
      <div className="ze-msgpanel" data-testid="pcb-message-panel">
        {messagePanelItems.map((item) => (
          <div className="ze-msgpanel-item" key={`${item.upper}:${item.lower}`}>
            <div className="ze-msgpanel-upper">{item.upper}</div>
            <div className="ze-msgpanel-lower">{item.lower || '\u00a0'}</div>
          </div>
        ))}
      </div>

      {/* pcbnew's 8-field KISTATUSBAR (eda_draw_frame.cpp updateStatusBarWidths):
          message (grows) | Z zoom | absolute X/Y | relative dx/dy/dist or polar
          r/theta | grid | units | current-tool (grows) | constraint mode. */}
      <div className="ze-statusbar">
        <span className="cell msg" data-testid="pcb-status-msg" />
        <span className="cell">Z {scale > 0 ? (scale * 1000).toFixed(2) : '—'}</span>
        <span className="cell" data-testid="pcb-absolute-coords">
          {statusCoordText}
        </span>
        <span className="cell" data-testid="pcb-relative-coords">
          {statusDeltaText}
        </span>
        <span className="cell">{gridText}</span>
        <span className="cell">{unitLabel === 'in' ? 'inches' : unitLabel}</span>
        <span className="cell tool" data-testid="pcb-tool-msg">
          {toolMsg}
        </span>
        <span className="cell constraint" data-testid="pcb-constraint-msg">
          {constraintMsg}
        </span>
      </div>
    </div>
  );
}

/** One-line label for a board item — the disambiguation menu row text
 *  (KiCad's EDA_ITEM::GetItemDescription). */
function describeBoardItem(board: Board, id: string): string {
  const r = parseBoardItemId(id);
  if (!r) return id;
  const net = (c: number): string => board.nets.get(c) || `net ${c}`;
  switch (r.kind) {
    case 'track': {
      const t = board.tracks[r.index];
      return t ? `Track ${t.layer} · ${net(t.net)}` : 'Track';
    }
    case 'arc': {
      const a = board.arcs[r.index];
      return a ? `Arc ${a.layer} · ${net(a.net)}` : 'Arc';
    }
    case 'via': {
      const v = board.vias[r.index];
      return v ? `Via · ${net(v.net)}` : 'Via';
    }
    case 'footprint': {
      const f = board.footprints[r.index];
      return f ? `Footprint ${f.reference || f.lib}` : 'Footprint';
    }
    case 'zone': {
      const z = board.zones[r.index];
      return z ? `Zone · ${z.netName ?? net(z.net)}` : 'Zone';
    }
    case 'shape': {
      const s = board.shapes[r.index];
      return s ? `Graphic (${s.kind}) · ${s.layer}` : 'Graphic';
    }
    case 'text': {
      const t = board.texts[r.index];
      return t ? `Text "${t.text}"` : 'Text';
    }
    case 'fptext': {
      const f = board.footprints[r.index];
      const t = f?.texts[r.sub ?? 0];
      if (!t) return 'Text';
      const label = t.kind === 'reference' ? 'Reference' : t.kind === 'value' ? 'Value' : 'Text';
      return `${label} "${t.text}"${f?.reference ? ` of ${f.reference}` : ''}`;
    }
    case 'pad': {
      const f = board.footprints[r.index];
      const p = f?.pads[r.sub ?? 0];
      if (!p) return 'Pad';
      return `Pad ${p.number}${f?.reference ? ` of ${f.reference}` : ''} · ${net(p.net ?? 0)}`;
    }
    case 'group': {
      const g = board.groups[r.index];
      // EDA_GROUP::GetItemDescription: 'Group "<name>" with N members' /
      // "Anonymous Group with N members".
      if (!g) return 'Group';
      return g.name
        ? `Group "${g.name}" with ${g.members.length} members`
        : `Anonymous Group with ${g.members.length} members`;
    }
  }
}

// ---- KiCad property-grid components (PCB_PROPERTIES_PANEL wxPropertyGrid) -----
// White name/value text, grey read-only, category bars with the GTK disclosure
// chevron reused from the project tree — styled by .ze-pg* in shell.css.

/** A collapsible category header (wxPropertyCategory). */
const PgCat = ({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element => (
  <div className="ze-pg-cat" onClick={onToggle}>
    <span className={`twisty expandable${open ? ' open' : ''}`} />
    <span>{label}</span>
  </div>
);
/** Name | value row. */
const PgRow = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div className="ze-pg-row">
    <div className="k" title={label}>
      {label}
    </div>
    <div className="v">{children}</div>
  </div>
);
/** Read-only value (greyed). */
const PgRO = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div className="ze-pg-row">
    <div className="k" title={label}>
      {label}
    </div>
    <div className="v ro" title={value}>
      {value}
    </div>
  </div>
);
/** A checkbox value; editable when `onChange` is supplied. */
const PgCheck = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
}): JSX.Element => (
  <PgRow label={label}>
    <input
      type="checkbox"
      checked={checked}
      readOnly={!onChange}
      onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      style={{ margin: 0 }}
    />
  </PgRow>
);
/** A layer value: color swatch + name. */
const PgLayer = ({
  label,
  layer,
  color,
}: {
  label: string;
  layer: string;
  color: string;
}): JSX.Element => (
  <PgRow label={label}>
    <span className="ze-pg-swatch" style={{ background: color }} />
    <span>{layer}</span>
  </PgRow>
);
/** An editable value cell: shows text; click to edit; Enter/blur commits. */
function PgEdit({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: string;
  suffix?: string;
  onCommit?: (v: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    setEditing(false);
    if (onCommit && draft !== value) onCommit(draft);
  };
  return (
    <PgRow label={label}>
      {editing && onCommit ? (
        <input
          className="pg-edit"
          value={draft}
          // biome-ignore lint/a11y/noAutofocus: focus the just-opened cell editor
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span
          style={{ cursor: onCommit ? 'text' : 'default', width: '100%' }}
          onClick={() => {
            if (onCommit) {
              setDraft(value);
              setEditing(true);
            }
          }}
        >
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
      )}
    </PgRow>
  );
}

/** Footprint orientation the KiCad way: normalized to (-180°, 180°], trimmed. */
const fmtOrient = (deg: number): string => {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return String(Number.parseFloat(a.toFixed(4)));
};

/** A footprint edit from the Properties grid (PCB_PROPERTIES_PANEL fields). */
type FpEdit =
  | { kind: 'pos'; axis: 'x' | 'y'; valueMM: number }
  | { kind: 'orient'; deg: number }
  | { kind: 'field'; field: 'reference' | 'value'; value: string }
  | { kind: 'locked'; locked: boolean };

/** The FOOTPRINT property grid (collapsible categories; editable fields). */
function FootprintProps({
  fp,
  index,
  onEdit,
}: {
  fp: PcbFootprint;
  index: number;
  onEdit?: (index: number, e: FpEdit) => void;
}): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Basic: true,
    Fields: true,
    Attributes: true,
    Overrides: true,
  });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const mm = (iu: number): string => iuToMM(iu).toFixed(4);
  const attrs = fp.attributes ?? [];
  const has = (a: string): boolean => attrs.includes(a);
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Footprint</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgEdit
            label="Position X"
            value={mm(fp.at.x)}
            suffix="mm"
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'pos', axis: 'x', valueMM: Number(v) })
                : undefined
            }
          />
          <PgEdit
            label="Position Y"
            value={mm(fp.at.y)}
            suffix="mm"
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'pos', axis: 'y', valueMM: Number(v) })
                : undefined
            }
          />
          <PgCheck
            label="Locked"
            checked={!!fp.locked}
            onChange={onEdit ? (c) => onEdit(index, { kind: 'locked', locked: c }) : undefined}
          />
          <PgLayer label="Layer" layer={fp.layer} color={layerColor(fp.layer)} />
          <PgEdit
            label="Orientation"
            value={fmtOrient(fp.angle)}
            suffix="°"
            onCommit={onEdit ? (v) => onEdit(index, { kind: 'orient', deg: Number(v) }) : undefined}
          />
        </>
      )}
      <PgCat label="Fields" open={open.Fields ?? true} onToggle={() => toggle('Fields')} />
      {(open.Fields ?? true) && (
        <>
          <PgEdit
            label="Reference"
            value={fp.reference ?? ''}
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'field', field: 'reference', value: v })
                : undefined
            }
          />
          <PgEdit
            label="Value"
            value={fp.value ?? ''}
            onCommit={
              onEdit ? (v) => onEdit(index, { kind: 'field', field: 'value', value: v }) : undefined
            }
          />
          <PgRO label="Library Link" value={fp.lib} />
          <PgRO label="Library Description" value={fp.descr ?? ''} />
          <PgRO label="Keywords" value={fp.tags ?? ''} />
          <PgRO label="Component Class" value="" />
        </>
      )}
      <PgCat
        label="Attributes"
        open={open.Attributes ?? true}
        onToggle={() => toggle('Attributes')}
      />
      {(open.Attributes ?? true) && (
        <>
          <PgCheck label="Not in Schematic" checked={has('board_only')} />
          <PgCheck label="Exclude From Position Files" checked={has('exclude_from_pos_files')} />
          <PgCheck label="Exclude From Bill of Materials" checked={has('exclude_from_bom')} />
          <PgCheck label="Do not Populate" checked={has('dnp')} />
        </>
      )}
      <PgCat label="Overrides" open={open.Overrides ?? true} onToggle={() => toggle('Overrides')} />
      {(open.Overrides ?? true) && (
        <>
          <PgCheck
            label="Exempt From Courtyard Requirement"
            checked={has('allow_missing_courtyard')}
          />
          <PgRO label="Clearance Override" value="" />
          <PgRO label="Solderpaste Margin Override" value="" />
          <PgRO label="Solderpaste Margin Ratio Override" value="" />
          <PgRO label="Zone Connection Style" value="Inherited" />
        </>
      )}
    </div>
  );
}

/** Read-only summary of the current selection for the Properties panel — the
 *  first slice of pcbnew's PCB_PROPERTIES_PANEL (editable fields come later). */
// Property-grid mm formatter (KiCad's PCB_PROPERTIES_PANEL shows 2 decimals).
const pgMM = (iu: number): string => `${iuToMM(iu).toFixed(2)} mm`;

/** The PAD property grid (PCB_PROPERTIES_PANEL: PAD reflected properties). */
function PadProps({ pad, netName }: { pad: PcbPad; netName: (c: number) => string }): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Basic: true,
    Pad: true,
    Overrides: true,
  });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const padType =
    {
      thru_hole: 'Through-hole',
      np_thru_hole: 'NPTH, mechanical',
      smd: 'SMD',
      connect: 'Edge connector',
    }[pad.type] ?? pad.type;
  const padShape =
    {
      circle: 'Circle',
      rect: 'Rectangle',
      roundrect: 'Rounded rectangle',
      oval: 'Oval',
      trapezoid: 'Trapezoidal',
      custom: 'Custom',
    }[pad.shape] ?? pad.shape;
  // Copper layers: a through pad spans all copper (KiCad "All copper layers");
  // an SMD pad names its single copper layer.
  const copperLayers = pad.layers.some((l) => l === '*.Cu')
    ? 'All copper layers'
    : pad.layers.filter((l) => /\.Cu$/.test(l)).join(', ') || pad.layers.join(', ');
  const holeRound = !pad.drill?.oblong;
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Pad</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgRO label="Position X" value={pgMM(pad.at.x)} />
          <PgRO label="Position Y" value={pgMM(pad.at.y)} />
          <PgRO label="Net" value={netName(pad.net ?? 0)} />
          <PgRO label="Orientation" value={`${fmtOrient(pad.angle ?? 0)}°`} />
        </>
      )}
      <PgCat label="Pad Properties" open={open.Pad ?? true} onToggle={() => toggle('Pad')} />
      {(open.Pad ?? true) && (
        <>
          <PgRO label="Pad Type" value={padType} />
          <PgRO label="Pad Shape" value={padShape} />
          <PgRO label="Pad Number" value={pad.number} />
          <PgRO label="Pin Name" value={pad.pinFunction ?? ''} />
          <PgRO label="Pin Type" value={pad.pinType ?? ''} />
          <PgRO label="Size X" value={pgMM(pad.size.x)} />
          {pad.shape !== 'circle' && <PgRO label="Size Y" value={pgMM(pad.size.y)} />}
          {pad.drill && <PgRO label="Hole Shape" value={holeRound ? 'Round' : 'Oval'} />}
          {pad.drill && <PgRO label="Hole Size X" value={pgMM(pad.drill.w)} />}
          {pad.drill && !holeRound && <PgRO label="Hole Size Y" value={pgMM(pad.drill.h)} />}
          <PgRO label="Fabrication Property" value="None" />
          <PgRO label="Copper Layers" value={copperLayers} />
          <PgRO label="Pad To Die Length" value="0 mm" />
        </>
      )}
      <PgCat label="Overrides" open={open.Overrides ?? true} onToggle={() => toggle('Overrides')} />
      {(open.Overrides ?? true) && (
        <>
          <PgRO label="Clearance Override" value="" />
          <PgRO label="Soldermask Margin Override" value="" />
          <PgRO label="Solderpaste Margin Override" value="" />
          <PgRO label="Solderpaste Margin Ratio Override" value="" />
          <PgRO label="Zone Connection Style" value="Inherited" />
          <PgRO label="Thermal Relief Spoke Angle" value="45°" />
        </>
      )}
    </div>
  );
}

/** The TRACK / ARC property grid (PCB_TRACK reflected properties). */
function TrackProps({
  track,
  arc,
  netName,
}: {
  track?: PcbTrack;
  arc?: PcbArcTrack;
  netName: (c: number) => string;
}): JSX.Element {
  const t = track ?? arc!;
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Track: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">{arc ? 'Track (Arc)' : 'Track'}</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgRO label="Start X" value={pgMM(t.start.x)} />
          <PgRO label="Start Y" value={pgMM(t.start.y)} />
          <PgRO label="End X" value={pgMM(t.end.x)} />
          <PgRO label="End Y" value={pgMM(t.end.y)} />
          <PgRO label="Net" value={netName(t.net)} />
        </>
      )}
      <PgCat label="Track Properties" open={open.Track ?? true} onToggle={() => toggle('Track')} />
      {(open.Track ?? true) && (
        <>
          <PgLayer label="Layer" layer={t.layer} color={layerColor(t.layer)} />
          <PgRO label="Width" value={pgMM(t.width)} />
        </>
      )}
    </div>
  );
}

/** The VIA property grid (PCB_VIA reflected properties). */
function ViaProps({ via, netName }: { via: PcbVia; netName: (c: number) => string }): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Via: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const viaType =
    { through: 'Through', blind: 'Blind/buried', micro: 'Microvia' }[via.kind] ?? via.kind;
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Via</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgRO label="Position X" value={pgMM(via.at.x)} />
          <PgRO label="Position Y" value={pgMM(via.at.y)} />
          <PgRO label="Net" value={netName(via.net)} />
        </>
      )}
      <PgCat label="Via Properties" open={open.Via ?? true} onToggle={() => toggle('Via')} />
      {(open.Via ?? true) && (
        <>
          <PgRO label="Via Type" value={viaType} />
          <PgRO label="Diameter" value={pgMM(via.size)} />
          <PgRO label="Hole" value={pgMM(via.drill)} />
          <PgLayer label="Layer Top" layer={via.layers[0]} color={layerColor(via.layers[0])} />
          <PgLayer label="Layer Bottom" layer={via.layers[1]} color={layerColor(via.layers[1])} />
        </>
      )}
    </div>
  );
}

/** The ZONE property grid (ZONE reflected properties; from parsed fields). */
function ZoneProps({
  zone,
  netName,
}: {
  zone: PcbZone;
  netName: (c: number) => string;
}): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Fill: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const border =
    zone.hatchStyle === 'full'
      ? 'Hatched'
      : zone.hatchStyle === 'edge'
        ? 'Hatched border'
        : 'Solid';
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Copper Zone</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgRO label="Net" value={zone.netName ?? netName(zone.net)} />
          <PgRO label="Layers" value={zone.layers.join(', ')} />
        </>
      )}
      <PgCat label="Fill Style" open={open.Fill ?? true} onToggle={() => toggle('Fill')} />
      {(open.Fill ?? true) && (
        <>
          <PgRO label="Border Display" value={border} />
          <PgRO label="Filled" value={zone.fills.length > 0 ? 'Yes' : 'No'} />
        </>
      )}
    </div>
  );
}

function PcbSelectionInfo({
  board,
  selection,
  onEditFootprint,
}: {
  board: Board | null;
  selection: ReadonlySet<string>;
  onEditFootprint?: (index: number, e: FpEdit) => void;
}): JSX.Element {
  const mm = (iu: number): string => iuToMM(iu).toFixed(4);
  const ids = [...selection];

  if (!board) return <div className="ze-muted">…</div>;

  if (ids.length === 1) {
    const ref = parseBoardItemId(ids[0]!);
    const netName = (code: number): string => board.nets.get(code) || `(net ${code})`;
    const row = (k: string, v: string): JSX.Element => (
      <div
        key={k}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          padding: '2px 4px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span className="ze-muted">{k}</span>
        <span style={{ textAlign: 'right' }}>{v}</span>
      </div>
    );
    // Collapsible-style group header, like KiCad's property-grid categories.
    if (ref) {
      switch (ref.kind) {
        case 'track': {
          const t = board.tracks[ref.index];
          if (t) return <TrackProps track={t} netName={netName} />;
          break;
        }
        case 'arc': {
          const a = board.arcs[ref.index];
          if (a) return <TrackProps arc={a} netName={netName} />;
          break;
        }
        case 'via': {
          const v = board.vias[ref.index];
          if (v) return <ViaProps via={v} netName={netName} />;
          break;
        }
        case 'pad': {
          const p = board.footprints[ref.index]?.pads[ref.sub ?? 0];
          if (p) return <PadProps pad={p} netName={netName} />;
          break;
        }
        case 'footprint': {
          const f = board.footprints[ref.index];
          if (f) return <FootprintProps fp={f} index={ref.index} onEdit={onEditFootprint} />;
          break;
        }
        case 'zone': {
          const z = board.zones[ref.index];
          if (z) return <ZoneProps zone={z} netName={netName} />;
          break;
        }
        case 'shape': {
          const s = board.shapes[ref.index];
          if (s)
            return (
              <div>
                <b>Graphic ({s.kind})</b>
                {row('Layer', s.layer)}
                {row('Width', `${mm(s.width)} mm`)}
              </div>
            );
          break;
        }
        case 'text': {
          const t = board.texts[ref.index];
          if (t)
            return (
              <div>
                <b>Text</b>
                {row('Text', t.text)}
                {row('Layer', t.layer)}
              </div>
            );
          break;
        }
      }
    }
  }

  // Multiple items: a per-kind tally (pcbnew's status "N items selected").
  const counts = new Map<string, number>();
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  }
  return (
    <div>
      <b>{ids.length} items selected</b>
      {[...counts].map(([k, n]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
          <span className="ze-muted">{k}</span>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}
