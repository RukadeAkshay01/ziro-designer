import type { Vec2 } from '@ziroeda/kimath';
import { rotateOrientation, mirrorOrientation, type Orientation } from '@ziroeda/common';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  hitTest,
  planMove,
  moveItems,
  moveWithConnections,
  orthoMove,
  addItems,
  deleteByIds,
  placeSymbol,
  makeJunction,
  makeNoConnect,
  makeLabel,
  startSegments,
  computeBreakPoint,
  switchPosture90,
  isTerminalPoint,
  sheetPinSideAt,
  finishWires,
  segIsNull,
  type WireSeg,
  makeRectangle,
  makeCircle,
  makeArc,
  makePolyline,
  makeBusEntry,
  makeImage,
  DEFAULT_ENTRY_SIZE,
  collectAnchors,
  selectionAnchors,
  nearestAnchor,
  danglingPinPositions,
  boxSelect,
  lassoSelect,
  pasteItems,
  translatePayload,
  type MoveSpec,
  type EditCommand,
  type Schematic,
  type LibSymbol,
  type LibGraphic,
  type LabelKind,
  type LabelShape,
  type PastePayload,
  type ErcViolation,
  type ItemRef,
} from '@ziroeda/eeschema';
import {
  renderSchematic,
  drawErcMarkers,
  fitToContent,
  fitToBBox,
  setRenderInvalidator,
  DEFAULT_RENDER_OPTS,
  type RenderOpts,
  type Viewport,
} from '../render/renderer.js';
import { KICAD_DEFAULT, type Theme } from '../theme.js';

/** Mouse/input behaviour from the Preferences dialog (COMMON_SETTINGS m_Input + eeschema). */
export interface InputPrefs {
  zoomSpeed: number; // 1..10 (input.zoom_speed)
  zoomSpeedAuto: boolean;
  centerOnZoom: boolean;
  reverseZoom: boolean;
  scrollModZoom: 'none' | 'ctrl' | 'shift' | 'alt';
  scrollModPanH: 'none' | 'ctrl' | 'shift' | 'alt';
  scrollModPanV: 'none' | 'ctrl' | 'shift' | 'alt';
  reverseScrollPanH: boolean;
  horizontalPan: boolean;
  mouseLeft: 'select' | 'drag_selected' | 'drag_any';
  mouseMiddle: 'pan' | 'zoom' | 'none';
  mouseRight: 'pan' | 'zoom' | 'none';
  /** eeschema input.drag_is_move: the mouse-drag gesture performs a Move
   *  (leave wires behind) instead of a Drag (rubber-band them along). */
  dragIsMove: boolean;
  autoStartWires: boolean;
  crosshair: 'small' | 'full' | '45';
  alwaysShowCrosshair: boolean;
}

export const DEFAULT_INPUT_PREFS: InputPrefs = {
  zoomSpeed: 1,
  zoomSpeedAuto: true,
  centerOnZoom: true,
  reverseZoom: false,
  scrollModZoom: 'none',
  scrollModPanH: 'ctrl',
  scrollModPanV: 'shift',
  reverseScrollPanH: false,
  horizontalPan: false,
  mouseLeft: 'drag_selected',
  mouseMiddle: 'pan',
  mouseRight: 'pan',
  dragIsMove: false,
  autoStartWires: true,
  crosshair: 'full',
  alwaysShowCrosshair: false,
};

// KiCad's LINE_WIRE cursor (resources/.../cursor-line-wire.xpm): a black crosshair
// at the hotspot with a green diagonal "wire" running up-right from it. Rebuilt as
// an SVG cursor; hotspot at (5,26) as in KiCad.
const WIRE_CURSOR = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
    `<line x1="6" y1="25" x2="26" y2="5" stroke="#ffffff" stroke-width="5"/>` +
    `<line x1="6" y1="25" x2="26" y2="5" stroke="#008000" stroke-width="3"/>` +
    `<g stroke="#ffffff" stroke-width="3"><line x1="0" y1="26" x2="10" y2="26"/><line x1="5" y1="21" x2="5" y2="31"/></g>` +
    `<g stroke="#000000" stroke-width="1"><line x1="0" y1="26" x2="10" y2="26"/><line x1="5" y1="21" x2="5" y2="31"/></g>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 26, crosshair`;
})();

export type LineMode = 'free' | '90' | '45';

/** Right-toolbar tool ids that place a text label, mapped to the label kind. */
const LABEL_TOOLS: Record<string, LabelKind> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
  placeText: 'text',
};

/** Right-toolbar shape/sheet drawing tools and their in-progress shape kind. */
type ShapeKind = 'rectangle' | 'circle' | 'arc' | 'lines' | 'bezier' | 'sheet' | 'textbox';
const SHAPE_TOOL: Record<string, ShapeKind> = {
  rectangle: 'rectangle',
  circle: 'circle',
  arc: 'arc',
  lines: 'lines',
  bezier: 'bezier',
  drawSheet: 'sheet',
  textBox: 'textbox',
};

interface DrawState {
  tool: ShapeKind;
  start: Vec2;
  points: Vec2[];
  cursor: Vec2;
}

/** KiCad's 2-click arc (EDA_SHAPE::calcEdit state 1): quarter-circle through start/end. */
function arcFrom2(start: Vec2, end: Vec2): { start: Vec2; mid: Vec2; end: Vec2 } | null {
  const l = Math.hypot(end.x - start.x, end.y - start.y);
  if (l === 0) return null;
  const radius = l * Math.SQRT1_2;
  const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const f = Math.sqrt(Math.max(0, radius * radius - (l * l) / 4)) / l;
  const d = { x: f * (start.y - end.y), y: f * (end.x - start.x) };
  const c = { x: m.x + d.x, y: m.y + d.y };
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const am = a0 + sweep / 2;
  return { start, mid: { x: c.x + radius * Math.cos(am), y: c.y + radius * Math.sin(am) }, end };
}

/** Flatten a quadratic bezier (start, control, end) to a polyline (bezier tool). */
function quadPolyline(a: Vec2, ctrl: Vec2, b: Vec2, n = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    pts.push({
      x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
    });
  }
  return pts;
}

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Nearest sheet border to a world point (for placing sheet pins). */
function nearestSheetEdge(
  sch: Schematic,
  p: Vec2,
  tol: number,
  snap: (v: Vec2) => Vec2,
): { index: number; at: Vec2; side: 0 | 90 | 180 | 270 } | null {
  let best: { index: number; at: Vec2; side: 0 | 90 | 180 | 270 } | null = null;
  let bestD = tol;
  sch.sheets.forEach((sh, index) => {
    const x0 = sh.at.x,
      y0 = sh.at.y,
      x1 = x0 + sh.size.w,
      y1 = y0 + sh.size.h;
    if (p.x < x0 - tol || p.x > x1 + tol || p.y < y0 - tol || p.y > y1 + tol) return;
    const edges: { side: 0 | 90 | 180 | 270; at: Vec2; d: number }[] = [
      { side: 180, at: { x: x0, y: clampN(p.y, y0, y1) }, d: Math.abs(p.x - x0) },
      { side: 0, at: { x: x1, y: clampN(p.y, y0, y1) }, d: Math.abs(p.x - x1) },
      { side: 90, at: { x: clampN(p.x, x0, x1), y: y0 }, d: Math.abs(p.y - y0) },
      { side: 270, at: { x: clampN(p.x, x0, x1), y: y1 }, d: Math.abs(p.y - y1) },
    ];
    for (const ed of edges) {
      if (ed.d < bestD) {
        bestD = ed.d;
        best = { index, at: snap(ed.at), side: ed.side };
      }
    }
  });
  return best;
}

/** The in-progress shape as a graphic, for live preview (built through the model). */
function previewGraphic(ds: DrawState): LibGraphic | null {
  const c = ds.cursor;
  switch (ds.tool) {
    case 'rectangle':
    case 'sheet':
    case 'textbox':
      return makeRectangle(ds.start, c);
    case 'circle':
      return makeCircle(ds.start, Math.hypot(c.x - ds.start.x, c.y - ds.start.y));
    case 'arc': {
      const a = arcFrom2(ds.start, c);
      return a ? makeArc(a.start, a.mid, a.end) : null;
    }
    case 'lines':
      return makePolyline([...ds.points, c]);
    case 'bezier':
      return ds.points.length < 2
        ? makePolyline([ds.points[0]!, c])
        : makePolyline(quadPolyline(ds.points[0]!, c, ds.points[1]!));
  }
}

/** A label whose name/shape are chosen and which now follows the cursor for placement. */
export interface PendingLabel {
  kind: LabelKind;
  text: string;
  shape: LabelShape;
}

export interface CanvasController {
  zoomToFit: () => void;
  /** Fit the view to a world-space box (Zoom to Selected Objects). */
  zoomToBox: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Force a repaint without changing the view (Refresh / zoomRedraw). */
  redraw: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Centre the viewport on a world point (used by ERC click-to-locate). */
  centerOn: (p: Vec2) => void;
}

interface Props {
  schematic: Schematic;
  libById: Map<string, LibSymbol>;
  selection: ReadonlySet<string>;
  activeTool: string;
  lineMode: LineMode;
  placeLib: LibSymbol | null;
  /** Unit of `placeLib` attached to the cursor ("Place all units" stepping). */
  placeUnit?: number;
  /** A symbol was just placed — the editor steps units / reopens the chooser. */
  onSymbolPlaced?: () => void;
  /** A named label that follows the cursor until clicked to place (null = none yet). */
  pendingLabel: PendingLabel | null;
  /** Wire ids whose net is highlighted (KiCad's net-highlight overlay). */
  highlight?: ReadonlySet<string>;
  onSelect: (id: string | null, additive: boolean) => void;
  /** Highlight-Net tool: the clicked item whose net to brighten, or null to clear. */
  onHighlight?: (id: string | null) => void;
  /** Switch the active tool (used to auto-start a wire from a dangling pin). */
  onRequestTool?: (id: string) => void;
  /** Double-clicked item (KiCad's Properties action, sch_edit_tool.cpp). */
  onEditItem?: (
    id: string,
    kind:
      | 'symbol'
      | 'line'
      | 'junction'
      | 'noconnect'
      | 'label'
      | 'sheet'
      | 'busentry'
      | 'image'
      | 'graphic'
      | 'textbox'
      | 'table',
  ) => void;
  /** Box-selection result (KiCad SelectMultiple): replace/add/subtract the ids. */
  onSelectBox?: (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => void;
  /** Items being pasted: they follow the cursor until clicked to drop (KiCad's paste-then-move). */
  pastePending?: PastePayload | null;
  /** The paste was dropped: the command was submitted; `ids` are the pasted item ids. */
  onPasteDone?: (ids: ReadonlySet<string>) => void;
  /** ERC violations to draw as KiCad marker arrows (null = ERC not run). */
  ercMarkers?: readonly ErcViolation[] | null;
  onCommand: (cmd: EditCommand) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Active colour theme (Preferences > Colors). */
  theme?: Theme;
  /** Display options (Preferences > Display Options / Grids). */
  renderOpts?: RenderOpts;
  /** Mouse and editing behaviour (Preferences > Mouse and Touchpad / Editing Options). */
  inputPrefs?: InputPrefs;
  /** A hierarchical sheet rectangle was drawn: prompt for name/file and commit. */
  onSheetDrawn?: (at: Vec2, size: { w: number; h: number }) => void;
  /** A text-box rectangle was drawn: prompt for its text and commit (SCH_TEXTBOX). */
  onTextBoxDrawn?: (start: Vec2, end: Vec2) => void;
  /** A sheet-pin click landed on a sheet edge: prompt for the pin name and add it. */
  onSheetPinClick?: (sheetIndex: number, at: Vec2, side: 0 | 90 | 180 | 270) => void;
  /** An image chosen in the editor, following the cursor until clicked to place. */
  pendingImage?: { data: string } | null;
  /** The pending image was dropped at `at`. */
  onImagePlaced?: (at: Vec2) => void;
  /** Keyboard-initiated grabbed move (SCH_MOVE_TOOL): 'move' leaves connected
   *  wires behind, 'drag' keeps them attached. A fresh nonce starts a move of
   *  the current selection that follows the cursor until clicked to drop. */
  grabRequest?: { kind: 'move' | 'drag'; nonce: number } | null;
  /** Zoom to Selection Area (ACTIONS::zoomTool): the user dragged a rectangle;
   *  fit the view to it (and the parent returns the tool to select). */
  onZoomArea?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Plain right-click with the select tool idle (KiCad's selection-tool
   *  context menu): `hit` is the already-hit-tested item under the cursor.
   *  The editor updates the selection and pops the menu at the client point. */
  onContextMenuRequest?: (clientX: number, clientY: number, hit: ItemRef | null) => void;
}

type Mode = 'idle' | 'pan' | 'dragzoom' | 'move' | 'box' | 'lasso';

// KiCad's selection-rectangle colours for a bright background
// (common/preview_items/selection_area.cpp, selectionColorScheme[1]).
const BOX_FILL_NORMAL = 'rgba(128, 77, 255, 0.5)'; // COLOR4D(0.5,0.3,1.0,0.5)
const BOX_FILL_ADDITIVE = 'rgba(128, 255, 128, 0.5)'; // COLOR4D(0.5,1.0,0.5,0.5)
const BOX_FILL_SUBTRACT = 'rgba(255, 128, 128, 0.5)'; // COLOR4D(1.0,0.5,0.5,0.5)
const BOX_OUTLINE_L2R = 'rgb(179, 179, 0)'; // window select: dark yellow
const BOX_OUTLINE_R2L = 'rgb(26, 26, 255)'; // greedy select: blue

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  {
    schematic,
    libById,
    selection,
    activeTool,
    lineMode,
    placeLib,
    placeUnit = 1,
    onSymbolPlaced,
    pendingLabel,
    highlight,
    onSelect,
    onHighlight,
    onRequestTool,
    onEditItem,
    onSelectBox,
    pastePending,
    onPasteDone,
    ercMarkers,
    onCommand,
    onCursorMove,
    onScaleChange,
    theme = KICAD_DEFAULT,
    renderOpts = DEFAULT_RENDER_OPTS,
    inputPrefs = DEFAULT_INPUT_PREFS,
    onSheetDrawn,
    onTextBoxDrawn,
    onSheetPinClick,
    pendingImage,
    onImagePlaced,
    grabRequest,
    onZoomArea,
    onContextMenuRequest,
  },
  ref,
): JSX.Element {
  // The active snap grid (Preferences > Grids). With grid overrides enabled
  // (ACTIONS::toggleGridOverrides), the grid depends on what's being drawn:
  // wires, text, graphics and connectable items each get their own override.
  const o = renderOpts.grid.overrides;
  const GRID = (() => {
    const base = renderOpts.grid.sizeIU;
    if (!o?.enabled) return base;
    if (
      (activeTool === 'drawWire' || activeTool === 'drawBus' || activeTool === 'busEntry') &&
      o.wires
    )
      return o.wires;
    if ((activeTool === 'placeText' || activeTool === 'textBox') && o.text) return o.text;
    if (['rectangle', 'circle', 'arc', 'lines', 'bezier'].includes(activeTool) && o.graphics)
      return o.graphics;
    if (
      [
        'placeSymbol',
        'placePower',
        'junction',
        'noConnect',
        'placeLabel',
        'placeGlobalLabel',
        'placeHierLabel',
        'select',
      ].includes(activeTool) &&
      o.connected
    )
      return o.connected;
    return base;
  })();
  const snap = (p: Vec2): Vec2 => ({
    x: Math.round(p.x / GRID) * GRID,
    y: Math.round(p.y / GRID) * GRID,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const modeRef = useRef<Mode>('idle');
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const moveStartRef = useRef<Vec2 | null>(null);
  const moveDeltaRef = useRef<Vec2 | null>(null);
  const moveSpecRef = useRef<MoveSpec | null>(null);
  // 'move' leaves connected wires behind (moveItems), 'drag' rubber-bands them
  // (moveWithConnections/orthoMove) — SCH_MOVE_TOOL's two modes.
  const moveKindRef = useRef<'move' | 'drag'>('drag');
  // A keyboard-initiated grabbed move follows the cursor with no button held and
  // commits on the next left click (vs a button-drag, committed on pointer-up).
  const grabbedRef = useRef(false);
  const effSelRef = useRef<ReadonlySet<string>>(new Set());
  // Connectable snapping during a move: the moved items' own connection points and the
  // anchors of everything else, so a dragged pin/wire-end snaps onto a matching anchor.
  const movePointsRef = useRef<Vec2[]>([]);
  const moveAnchorsRef = useRef<Vec2[]>([]);

  // Box-selection drag (KiCad selectMultiple): origin/end in world coordinates.
  const boxHitRef = useRef<string | null>(null);
  const boxOriginRef = useRef<Vec2 | null>(null);
  const boxEndRef = useRef<Vec2 | null>(null);
  const boxModifiersRef = useRef({ additive: false, subtractive: false });
  // Zoom to Selection Area (zoomTool): the box drag zooms instead of selecting.
  const zoomAreaRef = useRef(false);
  // Lasso-selection trace (KiCad selectLasso): the freehand polygon in world coords.
  const lassoPointsRef = useRef<Vec2[]>([]);

  // Wire-drawing state (SCH_LINE_WIRE_BUS_TOOL): the chain of segments being
  // drawn (m_wires) — the last two are "live" and follow the cursor — plus the
  // 45°-mode posture flag (static bool posture) and the mode we last drew with
  // (lastMode, to adjust the chain when line mode changes mid-draw).
  const wiresRef = useRef<WireSeg[]>([]);
  const wirePostureRef = useRef(false);
  const wireLastModeRef = useRef<LineMode>(lineMode);
  // Current line mode, readable from effects/handlers without re-running them.
  const lineModeRef = useRef<LineMode>(lineMode);
  lineModeRef.current = lineMode;
  const cursorRef = useRef<Vec2 | null>(null);
  // A dangling pin the next drawWire activation should start from (auto-start wire).
  const pendingWireStartRef = useRef<Vec2 | null>(null);
  // Orientation applied to the symbol currently being placed (R/X/Y before dropping).
  const placeOrientRef = useRef<Orientation>({ angle: 0 });
  // In-progress shape/sheet drawing (rectangle/circle/arc/lines/bezier/sheet).
  const drawStateRef = useRef<DrawState | null>(null);
  // Bus-entry size vector (R rotates it through the four 45° orientations).
  const entrySizeRef = useRef<Vec2>({ x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE });

  const dpr = () => window.devicePixelRatio || 1;

  // Dangling (unconnected) pins — KiCad's clickable wire-start anchors.
  const danglingPins = useMemo(
    () => danglingPinPositions(schematic, libById),
    [schematic, libById],
  );
  /** The dangling pin at/near a world point (within ~8px), or null. */
  const danglingPinAt = useCallback(
    (world: Vec2): Vec2 | null => {
      const vp = viewportRef.current;
      const maxDist = vp && vp.scale > 0 ? 8 / vp.scale : GRID / 2;
      return nearestAnchor(world, danglingPins, maxDist);
    },
    [danglingPins],
  );

  // Connectable anchors (pins/wire-ends/junctions/labels) for cursor snapping, à la
  // KiCad's BestSnapAnchor with GRID_CONNECTABLE.
  const anchors = useMemo(() => collectAnchors(schematic, libById), [schematic, libById]);
  /** Snap a world point to the nearest connection anchor within ~10px, else to the grid. */
  const snapConn = useCallback(
    (world: Vec2): Vec2 => {
      const vp = viewportRef.current;
      const maxDist = vp && vp.scale > 0 ? 10 / vp.scale : GRID / 2;
      return nearestAnchor(world, anchors, maxDist) ?? snap(world);
    },
    [anchors],
  );
  /**
   * Track the cursor with the live segment(s) of the wire chain — the motion
   * handler of SCH_LINE_WIRE_BUS_TOOL::doDrawSegments, including the
   * adjustment when the H/V/45 mode is switched mid-draw. Returns the
   * possibly-adjusted cursor position (sheet-pin pushes).
   */
  const updateWireChain = useCallback(
    (cursorPos: Vec2): Vec2 => {
      const wires = wiresRef.current;
      if (wires.length === 0) return cursorPos;

      if (wireLastModeRef.current !== lineMode) {
        // Delete the extra segment / add one so we can move orthogonally.
        if (lineMode === 'free' && wires.length >= 2) {
          wires.pop();
        } else if (wireLastModeRef.current === 'free') {
          const last = wires[wires.length - 1]!;
          last.b = { ...cursorPos };
          wires.push({ a: { ...cursorPos }, b: { ...cursorPos } });
        }
        wireLastModeRef.current = lineMode;
      }

      if (lineMode !== 'free' && wires.length >= 2) {
        const segment = wires[wires.length - 2]!;
        const side = sheetPinSideAt(schematic, segment.a);
        return computeBreakPoint(
          segment,
          wires[wires.length - 1]!,
          cursorPos,
          lineMode,
          wirePostureRef.current,
          side,
          GRID,
        );
      }
      wires[wires.length - 1]!.b = { ...cursorPos };
      return cursorPos;
    },
    [lineMode, schematic, GRID],
  );

  /** finishSegments: commit the chain as wires/buses + automatic junctions. */
  const finishWireChain = useCallback(() => {
    const kind = activeTool === 'drawBus' ? 'bus' : 'wire';
    const cmd = finishWires(schematic, libById, wiresRef.current, kind);
    wiresRef.current = [];
    if (cmd) onCommand(cmd);
  }, [activeTool, schematic, libById, onCommand]);

  // 'move' (M) translates only the selected items, leaving connected wires
  // behind. 'drag' (G) keeps them attached: in H/V line mode it adds 90° bends
  // (orthoMove); in free/45 mode the connected wire simply stretches.
  const buildMove = useCallback(
    (spec: MoveSpec, delta: Vec2): EditCommand => {
      if (moveKindRef.current === 'move') return moveItems(effSelRef.current, delta);
      return lineMode === '90'
        ? orthoMove(schematic, spec, delta)
        : moveWithConnections(spec, delta);
    },
    [schematic, lineMode],
  );

  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL Move/Drag): the selection
  // follows the cursor from the current position until a left click drops it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce-driven, like placeRequest
  useEffect(() => {
    if (!grabRequest || selection.size === 0) return;
    const anchors = selectionAnchors(schematic, libById, selection);
    const origin = cursorRef.current ? snap(cursorRef.current) : (anchors[0] ?? null);
    if (!origin) return;
    moveKindRef.current = grabRequest.kind;
    effSelRef.current = selection;
    const spec = planMove(schematic, libById, selection);
    moveSpecRef.current = spec;
    movePointsRef.current = anchors;
    const moving = new Set([...selection, ...spec.wireStart, ...spec.wireEnd]);
    moveAnchorsRef.current = collectAnchors(schematic, libById, moving);
    moveStartRef.current = origin;
    moveDeltaRef.current = { x: 0, y: 0 };
    modeRef.current = 'move';
    grabbedRef.current = true;
    draw();

    // Escape cancels the grabbed move (nothing was committed, so just drop the
    // ghost). Capture phase + stopPropagation so the editor's Escape doesn't
    // also clear the selection.
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && grabbedRef.current) {
        ev.stopPropagation();
        grabbedRef.current = false;
        modeRef.current = 'idle';
        moveSpecRef.current = null;
        moveDeltaRef.current = null;
        moveStartRef.current = null;
        draw();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [grabRequest?.nonce]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const md = moveDeltaRef.current;
    const spec = moveSpecRef.current;
    let doc = schematic;
    if (modeRef.current === 'move' && md && spec) {
      doc = buildMove(spec, md).apply(schematic);
    } else if (
      (activeTool === 'placeSymbol' || activeTool === 'placePower') &&
      placeLib &&
      cursorRef.current
    ) {
      // Ghost: show the symbol attached to the cursor (with its current orientation).
      doc = placeSymbol(placeLib, snap(cursorRef.current), placeOrientRef.current, placeUnit).apply(
        schematic,
      );
    }
    // Ghost: the named label follows the cursor (with its flag) until clicked to place.
    if (pendingLabel && cursorRef.current) {
      doc = addItems({
        labels: [
          makeLabel(pendingLabel.kind, pendingLabel.text, snap(cursorRef.current), {
            shape: pendingLabel.shape,
          }),
        ],
      }).apply(doc);
    }
    // Ghost: pasted items follow the cursor until dropped (KiCad's paste-then-move).
    if (pastePending && cursorRef.current) {
      const c = snap(cursorRef.current);
      const delta = { x: c.x - pastePending.refPoint.x, y: c.y - pastePending.refPoint.y };
      doc = pasteItems(translatePayload(pastePending, delta)).apply(doc);
    }
    // Ghost: an image chosen in the editor follows the cursor until clicked.
    if (pendingImage && cursorRef.current) {
      doc = addItems({ images: [makeImage(snap(cursorRef.current), pendingImage.data)] }).apply(
        doc,
      );
    }
    // Ghost: the bus-entry stub follows the cursor (R rotates its size vector).
    if (activeTool === 'busEntry' && cursorRef.current) {
      doc = addItems({
        busEntries: [makeBusEntry(snap(cursorRef.current), entrySizeRef.current)],
      }).apply(doc);
    }
    // Preview: the shape/sheet being drawn (rendered through the model so it
    // matches the final item exactly).
    const ds = drawStateRef.current;
    if (ds) {
      const g = previewGraphic(ds);
      if (g) doc = addItems({ graphics: [g] }).apply(doc);
    }
    renderSchematic(
      ctx,
      doc,
      vp,
      theme,
      canvas.width,
      canvas.height,
      selection,
      highlight,
      renderOpts,
    );

    // ERC markers (KiCad's bent-arrow fault indicators).
    if (ercMarkers && ercMarkers.length > 0) drawErcMarkers(ctx, ercMarkers, vp, theme);

    // Box-selection rubber band, in KiCad's colours: the fill shows the mode
    // (normal/additive/subtractive) and the outline shows the direction —
    // dark yellow for a left-to-right "window", blue for right-to-left greedy.
    const bo = boxOriginRef.current;
    const be = boxEndRef.current;
    if (modeRef.current === 'box' && bo && be) {
      const greedy = be.x < bo.x;
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.fillStyle = subtractive
        ? BOX_FILL_SUBTRACT
        : additive
          ? BOX_FILL_ADDITIVE
          : BOX_FILL_NORMAL;
      ctx.strokeStyle = greedy ? BOX_OUTLINE_R2L : BOX_OUTLINE_L2R;
      ctx.lineWidth = 1 / vp.scale;
      const x = Math.min(bo.x, be.x),
        y = Math.min(bo.y, be.y);
      const w = Math.abs(be.x - bo.x),
        h = Math.abs(be.y - bo.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Lasso freehand polygon (KiCad selectLasso): closed, in the box colours.
    const lasso = lassoPointsRef.current;
    if (modeRef.current === 'lasso' && lasso.length >= 2) {
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.fillStyle = subtractive
        ? BOX_FILL_SUBTRACT
        : additive
          ? BOX_FILL_ADDITIVE
          : BOX_FILL_NORMAL;
      ctx.strokeStyle = BOX_OUTLINE_R2L; // lasso: greedy/touching, blue
      ctx.lineWidth = 1 / vp.scale;
      ctx.beginPath();
      lasso.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Wire / bus chain preview: every non-null segment of m_wires, with the
    // live pair coerced to the cursor by computeBreakPoint.
    const cur = cursorRef.current;
    if ((activeTool === 'drawWire' || activeTool === 'drawBus') && wiresRef.current.length && cur) {
      updateWireChain(snapConn(cur));
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = activeTool === 'drawBus' ? theme.bus : theme.wire;
      ctx.lineWidth = (activeTool === 'drawBus' ? 0.3048 : 0.1524) * 10000; // bus 12 mil, wire 6 mil
      ctx.beginPath();
      for (const seg of wiresRef.current) {
        if (segIsNull(seg)) continue;
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.b.x, seg.b.y);
      }
      ctx.stroke();
    }

    // Crosshair cursor (GAL options): full-window lines or a small cross at
    // the snapped cursor position, in the LAYER_SCHEMATIC_CURSOR colour.
    if (cur) {
      const c = snap(cur);
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = theme.cursor;
      ctx.lineWidth = 1 / vp.scale;
      ctx.setLineDash([]);
      const left = -vp.offsetX / vp.scale;
      const top = -vp.offsetY / vp.scale;
      const rightW = (canvas.width - vp.offsetX) / vp.scale;
      const bottomW = (canvas.height - vp.offsetY) / vp.scale;
      // Clip to the visible rect so the full-window / 45° lines never overrun.
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, rightW - left, bottomW - top);
      ctx.clip();
      ctx.beginPath();
      if (inputPrefs.crosshair === 'full') {
        ctx.moveTo(left, c.y);
        ctx.lineTo(rightW, c.y);
        ctx.moveTo(c.x, top);
        ctx.lineTo(c.x, bottomW);
      } else if (inputPrefs.crosshair === '45') {
        // 45° full-window crosshair (cursor45Crosshairs): two diagonals through
        // the cursor spanning the whole visible rect.
        const span = Math.max(rightW - left, bottomW - top);
        ctx.moveTo(c.x - span, c.y - span);
        ctx.lineTo(c.x + span, c.y + span);
        ctx.moveTo(c.x - span, c.y + span);
        ctx.lineTo(c.x + span, c.y - span);
      } else {
        const arm = 8 / vp.scale;
        ctx.moveTo(c.x - arm, c.y);
        ctx.lineTo(c.x + arm, c.y);
        ctx.moveTo(c.x, c.y - arm);
        ctx.lineTo(c.x, c.y + arm);
      }
      ctx.stroke();
      ctx.restore();
    }
    onScaleChange?.(vp.scale);
  }, [
    schematic,
    selection,
    activeTool,
    lineMode,
    placeLib,
    placeUnit,
    pendingLabel,
    pastePending,
    pendingImage,
    highlight,
    ercMarkers,
    updateWireChain,
    snapConn,
    buildMove,
    onScaleChange,
    theme,
    renderOpts,
    inputPrefs,
  ]);

  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const wx = (px - vp.offsetX) / vp.scale;
      const wy = (py - vp.offsetY) / vp.scale;
      const scale = vp.scale * factor;
      viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
      draw();
    },
    [draw],
  );

  // A fit requested before the canvas has been laid out (ResizeObserver hasn't
  // fired yet, so the canvas still has its default 300x150 size) is deferred
  // and honoured by the size effect below.
  const fitPendingRef = useRef(false);
  const sizedRef = useRef(false);

  useImperativeHandle(
    ref,
    (): CanvasController => ({
      zoomToFit: () => {
        const c = canvasRef.current;
        if (!c || !sizedRef.current) {
          fitPendingRef.current = true;
          return;
        }
        viewportRef.current = fitToContent(schematic, c.width, c.height);
        draw();
      },
      zoomToBox: (box) => {
        const c = canvasRef.current;
        if (!c || !sizedRef.current) return;
        viewportRef.current = fitToBBox(box, c.width, c.height);
        draw();
      },
      redraw: () => draw(),
      zoomIn: () => {
        const c = canvasRef.current;
        if (c) zoomAbout(c.width / 2, c.height / 2, 1.25);
      },
      zoomOut: () => {
        const c = canvasRef.current;
        if (c) zoomAbout(c.width / 2, c.height / 2, 0.8);
      },
      centerOn: (p: Vec2) => {
        const c = canvasRef.current;
        const vp = viewportRef.current;
        if (!c || !vp) return;
        // Keep the zoom, but make sure the fault is legible (~ 0.02 px/IU minimum).
        const scale = Math.max(vp.scale, 0.002);
        viewportRef.current = {
          scale,
          offsetX: c.width / 2 - p.x * scale,
          offsetY: c.height / 2 - p.y * scale,
        };
        draw();
      },
    }),
    [schematic, draw, zoomAbout],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const r = dpr();
    canvas.width = Math.floor(size.w * r);
    canvas.height = Math.floor(size.h * r);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    sizedRef.current = true;
    if (!viewportRef.current || fitPendingRef.current) {
      viewportRef.current = fitToContent(schematic, canvas.width, canvas.height);
      fitPendingRef.current = false;
    }
    draw();
  }, [size, schematic, draw]);

  useEffect(() => {
    draw();
  }, [selection, draw]);
  // Embedded bitmaps decode asynchronously; repaint when one becomes ready.
  useEffect(() => {
    setRenderInvalidator(draw);
    return () => setRenderInvalidator(null);
  }, [draw]);
  // Cancel an in-progress wire and reset the placement orientation only when the
  // tool actually changes (not on every schematic update, which would break the
  // multi-segment wire chain). When drawWire was just auto-started from a dangling
  // pin, seed the wire's first anchor with that pin instead of clearing it.
  useEffect(() => {
    if (activeTool === 'drawWire' && pendingWireStartRef.current) {
      // Auto-start from the dangling pin (startSegments primes the chain).
      wiresRef.current = startSegments(pendingWireStartRef.current, lineModeRef.current);
      pendingWireStartRef.current = null;
    } else {
      wiresRef.current = [];
    }
    wirePostureRef.current = false;
    wireLastModeRef.current = lineModeRef.current;
    placeOrientRef.current = { angle: 0 };
    // Switching tools abandons any in-progress shape and resets the entry stub.
    drawStateRef.current = null;
    entrySizeRef.current = { x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE };
    // The wire/bus tools use KiCad's green wire cursor; everything else resets.
    const canvas = canvasRef.current;
    if (canvas)
      canvas.style.cursor =
        activeTool === 'drawWire' || activeTool === 'drawBus' ? WIRE_CURSOR : 'default';
  }, [activeTool]);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current!;
    const vp = viewportRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * dpr();
    const py = (clientY - rect.top) * dpr();
    return { x: (px - vp.offsetX) / vp.scale, y: (py - vp.offsetY) / vp.scale };
  };

  // Scroll gestures (PANEL_MOUSE_SETTINGS): the modifier held selects zoom /
  // pan up-down / pan left-right; zoom speed and reverse flags apply.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const canvas = canvasRef.current;
      const vp = viewportRef.current;
      if (!canvas || !vp) return;
      const rect = canvas.getBoundingClientRect();
      const mod: 'none' | 'ctrl' | 'shift' | 'alt' =
        e.ctrlKey || e.metaKey ? 'ctrl' : e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none';
      const delta = e.deltaY;

      if (
        mod === inputPrefs.scrollModPanV &&
        inputPrefs.scrollModPanV !== inputPrefs.scrollModZoom
      ) {
        viewportRef.current = { ...vp, offsetY: vp.offsetY - delta * dpr() };
        draw();
        return;
      }
      if (
        mod === inputPrefs.scrollModPanH &&
        inputPrefs.scrollModPanH !== inputPrefs.scrollModZoom
      ) {
        const d = inputPrefs.reverseScrollPanH ? -delta : delta;
        viewportRef.current = { ...vp, offsetX: vp.offsetX - d * dpr() };
        draw();
        return;
      }
      if (mod !== inputPrefs.scrollModZoom) return;
      // Horizontal touchpad movement pans when enabled.
      if (inputPrefs.horizontalPan && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        viewportRef.current = { ...vp, offsetX: vp.offsetX - e.deltaX * dpr() };
        draw();
        return;
      }
      const speed = inputPrefs.zoomSpeedAuto ? 1 : inputPrefs.zoomSpeed / 5;
      const dir = inputPrefs.reverseZoom ? 1 : -1;
      zoomAbout(
        (e.clientX - rect.left) * dpr(),
        (e.clientY - rect.top) * dpr(),
        Math.exp(dir * delta * 0.001 * speed),
      );
    },
    [zoomAbout, draw, inputPrefs],
  );

  // Finish a rectangle/circle/arc (2nd click), a bezier (control click), or a
  // sheet rectangle (which hands off to the editor for its name/file dialog).
  const finalizeShape = useCallback(
    (ds: DrawState, p: Vec2) => {
      drawStateRef.current = null;
      let g: LibGraphic | null = null;
      if (ds.tool === 'rectangle') g = makeRectangle(ds.start, p);
      else if (ds.tool === 'circle')
        g = makeCircle(ds.start, Math.hypot(p.x - ds.start.x, p.y - ds.start.y));
      else if (ds.tool === 'arc') {
        const a = arcFrom2(ds.start, p);
        if (a) g = makeArc(a.start, a.mid, a.end);
      } else if (ds.tool === 'bezier')
        g = makePolyline(quadPolyline(ds.points[0]!, p, ds.points[1]!));
      else if (ds.tool === 'sheet') {
        const at = { x: Math.min(ds.start.x, p.x), y: Math.min(ds.start.y, p.y) };
        const size = { w: Math.abs(p.x - ds.start.x), h: Math.abs(p.y - ds.start.y) };
        if (size.w > 0 && size.h > 0) onSheetDrawn?.(at, size);
        draw();
        return;
      } else if (ds.tool === 'textbox') {
        const start = { x: Math.min(ds.start.x, p.x), y: Math.min(ds.start.y, p.y) };
        const end = { x: Math.max(ds.start.x, p.x), y: Math.max(ds.start.y, p.y) };
        if (end.x > start.x && end.y > start.y) onTextBoxDrawn?.(start, end);
        draw();
        return;
      }
      if (g) onCommand(addItems({ graphics: [g] }));
      draw();
    },
    [onCommand, onSheetDrawn, onTextBoxDrawn, draw],
  );

  // Finish an open polyline (lines tool): double-click / Enter / right-click.
  const finishPoly = useCallback(() => {
    const ds = drawStateRef.current;
    if (ds?.tool !== 'lines') return;
    drawStateRef.current = null;
    if (ds.points.length >= 2) onCommand(addItems({ graphics: [makePolyline(ds.points)] }));
    draw();
  }, [onCommand, draw]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);

      // A keyboard grabbed move (M/G) commits on the next left click.
      if (grabbedRef.current) {
        if (e.button !== 0) return;
        const d = moveDeltaRef.current;
        const spec = moveSpecRef.current;
        if (d && spec && (d.x !== 0 || d.y !== 0)) onCommand(buildMove(spec, d));
        grabbedRef.current = false;
        modeRef.current = 'idle';
        moveSpecRef.current = null;
        moveDeltaRef.current = null;
        moveStartRef.current = null;
        draw();
        return;
      }

      // Middle/right-button drag pans or zooms per the Drag Gestures settings.
      if (e.button === 1 || e.button === 2) {
        const action = e.button === 1 ? inputPrefs.mouseMiddle : inputPrefs.mouseRight;
        if (action === 'none') return;
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = action === 'zoom' ? 'dragzoom' : 'pan';
        panLastRef.current = { x: e.clientX, y: e.clientY };
        panMovedRef.current = false;
        e.preventDefault();
        return;
      }

      // A pending image follows the cursor; a left click drops it.
      if (pendingImage) {
        if (e.button !== 0) return;
        onImagePlaced?.(snap(world));
        return;
      }

      // Zoom to Selection Area: a left drag draws the zoom rectangle.
      if (activeTool === 'zoomTool' && e.button === 0) {
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'box';
        zoomAreaRef.current = true;
        boxOriginRef.current = world;
        boxEndRef.current = world;
        return;
      }

      // A pending paste follows the cursor; a left click drops it (KiCad's paste-then-move).
      if (pastePending) {
        if (e.button !== 0) return;
        const c = snap(world);
        const delta = { x: c.x - pastePending.refPoint.x, y: c.y - pastePending.refPoint.y };
        const placed = translatePayload(pastePending, delta);
        onCommand(pasteItems(placed));
        const ids = new Set<string>();
        placed.batch.symbols.forEach((s) => ids.add(s.uuid!));
        placed.batch.lines.forEach((l) => ids.add(l.uuid!));
        placed.batch.junctions.forEach((j) => ids.add(j.uuid!));
        placed.batch.labels.forEach((l) => ids.add(l.uuid!));
        onPasteDone?.(ids);
        return;
      }

      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        const kind = activeTool === 'drawBus' ? 'bus' : 'wire';
        const wires = wiresRef.current;
        const cursorPos = snapConn(world);
        if (wires.length === 0) {
          wiresRef.current = startSegments(cursorPos, lineMode);
          wireLastModeRef.current = lineMode;
        } else {
          const pos = updateWireChain(cursorPos);
          const twoSegments = lineMode !== 'free';
          const last = wires[wires.length - 1]!;
          // Only place once something has actually been drawn.
          if (
            !segIsNull(last) ||
            (twoSegments && wires.length >= 2 && !segIsNull(wires[wires.length - 2]!))
          ) {
            // Terminate the run if the end point is on a pin, junction,
            // label, or another wire or bus (IsTerminalPoint).
            if (isTerminalPoint(schematic, libById, pos, kind)) {
              finishWireChain();
            } else {
              // Fix the segment and chain new live segment(s) after it. With
              // the 45° end the user targets the endpoint with the angled
              // portion, so both segments place at once.
              const placedSegments = lineMode === '45' ? 2 : 1;
              for (let i = 0; i < placedSegments; i++) wires.push({ a: { ...pos }, b: { ...pos } });
            }
          }
        }
        draw();
        return;
      }

      if (activeTool === 'junction') {
        onCommand(addItems({ junctions: [makeJunction(snapConn(world))] }));
        return;
      }

      // No-connect flags snap to the nearest pin/anchor, as KiCad's placement does.
      if (activeTool === 'noConnect') {
        onCommand(addItems({ noConnects: [makeNoConnect(snapConn(world))] }));
        return;
      }

      // Label tools: once the name/shape are chosen (pendingLabel), a click drops the
      // label at the snapped point. It stays attached so the same label can be placed on
      // several wires; Escape (handled in App) ends the run.
      if (LABEL_TOOLS[activeTool]) {
        if (pendingLabel) {
          onCommand(
            addItems({
              labels: [
                makeLabel(pendingLabel.kind, pendingLabel.text, snap(world), {
                  shape: pendingLabel.shape,
                }),
              ],
            }),
          );
        }
        return;
      }

      // Wire-to-bus entry: click drops a 45° stub (R rotates it; stays active).
      if (activeTool === 'busEntry') {
        onCommand(addItems({ busEntries: [makeBusEntry(snap(world), entrySizeRef.current)] }));
        return;
      }

      // Sheet-pin: click a sheet border to add a pin there (editor prompts for the name).
      if (activeTool === 'sheetPin') {
        const found = nearestSheetEdge(schematic, world, (10 * dpr()) / vp.scale, snap);
        if (found) onSheetPinClick?.(found.index, found.at, found.side);
        return;
      }

      // Shape / sheet drawing tools (SCH_ACTIONS::draw*): 2-click for rectangle /
      // circle / arc / sheet, multi-click for lines, 3-click for bezier.
      const shapeKind = SHAPE_TOOL[activeTool];
      if (shapeKind) {
        const p = snap(world);
        const ds = drawStateRef.current;
        if (!ds) {
          drawStateRef.current = { tool: shapeKind, start: p, points: [p], cursor: p };
        } else if (shapeKind === 'lines') {
          const last = ds.points[ds.points.length - 1]!;
          if (last.x !== p.x || last.y !== p.y) ds.points.push(p);
        } else if (shapeKind === 'bezier') {
          if (ds.points.length < 2) ds.points.push(p);
          else finalizeShape(ds, p);
        } else {
          finalizeShape(ds, p);
        }
        draw();
        return;
      }

      if (activeTool === 'delete') {
        const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
        if (hit) onCommand(deleteByIds(new Set([hit.id])));
        return;
      }

      // Highlight-Net tool (KiCad SCH_EDITOR_CONTROL::HighlightNet): click an item to
      // brighten its net; click empty space to clear the highlight.
      if (activeTool === 'highlightNet') {
        const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
        onHighlight?.(hit ? hit.id : null);
        return;
      }

      if (activeTool === 'placeSymbol' || activeTool === 'placePower') {
        if (placeLib) {
          onCommand(placeSymbol(placeLib, snap(world), placeOrientRef.current, placeUnit));
          // The editor steps to the next unit, keeps placing copies, or
          // reopens the chooser (sch_drawing_tools.cpp after commit.Push).
          onSymbolPlaced?.();
        }
        return;
      }

      // Lasso selection tool (KiCad selectLasso): a left-press starts a freehand
      // polygon trace; a plain click (no drag) selects the pressed item or clears.
      if (activeTool === 'selectLasso') {
        (e.target as Element).setPointerCapture(e.pointerId);
        const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
        modeRef.current = 'lasso';
        boxHitRef.current = hit ? hit.id : null;
        lassoPointsRef.current = [world];
        boxModifiersRef.current = {
          additive: (e.ctrlKey || e.shiftKey) && !e.altKey,
          subtractive: e.ctrlKey && e.shiftKey && !e.altKey,
        };
        return;
      }

      if (activeTool !== 'select') return; // other tools not yet implemented

      // Auto-start a wire when clicking a dangling pin (KiCad's autostartEvent),
      // gated by the "Automatically start wires on unconnected pins" preference.
      const pin = inputPrefs.autoStartWires ? danglingPinAt(world) : null;
      if (pin && !e.shiftKey) {
        pendingWireStartRef.current = pin;
        onRequestTool?.('drawWire');
        return;
      }

      // select / move — the left-drag semantics follow the "Left button drag"
      // preference: SELECT always rubber-bands; DRAG_SELECTED moves only an
      // already-selected item; DRAG_ANY moves whatever is under the cursor.
      (e.target as Element).setPointerCapture(e.pointerId);
      const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
      const additive = e.shiftKey;
      const canDrag =
        hit !== null &&
        inputPrefs.mouseLeft !== 'select' &&
        (inputPrefs.mouseLeft === 'drag_any' || selection.has(hit.id));
      if (hit && canDrag) {
        const effSel: ReadonlySet<string> = additive
          ? new Set([...selection, hit.id])
          : selection.has(hit.id)
            ? selection
            : new Set([hit.id]);
        onSelect(hit.id, additive);
        modeRef.current = 'move';
        // The drag gesture rubber-bands connected wires along unless the
        // "drag is move" preference turns it into a plain Move (SCH_MOVE_TOOL).
        moveKindRef.current = inputPrefs.dragIsMove ? 'move' : 'drag';
        effSelRef.current = effSel;
        moveStartRef.current = world;
        moveDeltaRef.current = { x: 0, y: 0 };
        const spec = planMove(schematic, libById, effSel);
        moveSpecRef.current = spec;
        movePointsRef.current = selectionAnchors(schematic, libById, effSel);
        // Snap targets are the fixed anchors: exclude the selection AND the wires that
        // rubber-band with it (spec.wireStart/wireEnd), so a moved point never snaps
        // back onto a wire that is moving with it.
        const moving = new Set([...effSel, ...spec.wireStart, ...spec.wireEnd]);
        moveAnchorsRef.current = collectAnchors(schematic, libById, moving);
      } else {
        // Empty canvas (or SELECT-mode drag): start a KiCad drag-box selection
        // (left-to-right = window select, right-to-left = greedy). A no-drag
        // click selects the pressed item, or clears the selection.
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'box';
        boxHitRef.current = hit ? hit.id : null;
        boxOriginRef.current = world;
        boxEndRef.current = world;
        boxModifiersRef.current = {
          additive: (e.ctrlKey || e.shiftKey) && !e.altKey, // m_drag_additive
          subtractive: e.ctrlKey && e.shiftKey && !e.altKey, // m_drag_subtractive
        };
      }
    },
    [
      activeTool,
      lineMode,
      placeLib,
      placeUnit,
      onSymbolPlaced,
      pendingLabel,
      pastePending,
      pendingImage,
      schematic,
      libById,
      selection,
      onSelect,
      onHighlight,
      onRequestTool,
      onPasteDone,
      onImagePlaced,
      onSheetPinClick,
      danglingPinAt,
      onCommand,
      snapConn,
      updateWireChain,
      finishWireChain,
      finalizeShape,
      draw,
      inputPrefs,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);
      cursorRef.current = world;
      onCursorMove?.(world);

      // Over a dangling pin with the select tool: show the wire cursor (KiCad switches
      // the cursor to LINE_WIRE to signal that clicking will start a wire).
      const canvas = canvasRef.current;
      if (canvas && activeTool === 'select' && modeRef.current === 'idle')
        canvas.style.cursor = danglingPinAt(world) ? WIRE_CURSOR : 'default';

      // Shape/sheet drawing preview + bus-entry / image ghosts track the cursor.
      if (drawStateRef.current) {
        drawStateRef.current.cursor = snap(world);
        draw();
        return;
      }
      if (activeTool === 'busEntry' || pendingImage) {
        draw();
        return;
      }

      if (pendingLabel) {
        draw();
        return;
      } // update the attached label ghost
      if (pastePending && modeRef.current !== 'pan') {
        draw();
        return;
      } // pasted items track the cursor

      if (modeRef.current === 'box') {
        boxEndRef.current = world;
        draw();
        return;
      }

      if (modeRef.current === 'lasso') {
        // Append a point once the pointer has travelled a few screen pixels, so the
        // trace stays a manageable polygon rather than one vertex per mouse event.
        const pts = lassoPointsRef.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(world.x - last.x, world.y - last.y) * vp.scale > 4) pts.push(world);
        draw();
        return;
      }

      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        if (wiresRef.current.length) draw();
        return;
      }
      if (activeTool === 'placeSymbol' || activeTool === 'placePower') {
        if (placeLib) draw(); // update the attached ghost
        return;
      }
      if (modeRef.current === 'move' && moveStartRef.current) {
        const raw = { x: world.x - moveStartRef.current.x, y: world.y - moveStartRef.current.y };
        let delta = { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID };
        // Connectable snap: if a moved connection point lands near a fixed anchor, snap
        // the whole move so it coincides exactly (KiCad drags snap to connection points).
        const maxDist = vp.scale > 0 ? 10 / vp.scale : GRID / 2;
        let bestD = maxDist * maxDist;
        let bestDelta: Vec2 | null = null;
        for (const mp of movePointsRef.current) {
          const cand = { x: mp.x + delta.x, y: mp.y + delta.y };
          const a = nearestAnchor(cand, moveAnchorsRef.current, maxDist);
          if (!a) continue;
          const dx = a.x - cand.x,
            dy = a.y - cand.y,
            d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            bestDelta = { x: delta.x + dx, y: delta.y + dy };
          }
        }
        if (bestDelta) delta = bestDelta;
        moveDeltaRef.current = delta;
        draw();
      } else if (modeRef.current === 'pan' && panLastRef.current) {
        panMovedRef.current = true;
        viewportRef.current = {
          ...vp,
          offsetX: vp.offsetX + (e.clientX - panLastRef.current.x) * dpr(),
          offsetY: vp.offsetY + (e.clientY - panLastRef.current.y) * dpr(),
        };
        panLastRef.current = { x: e.clientX, y: e.clientY };
        draw();
      } else if (modeRef.current === 'dragzoom' && panLastRef.current) {
        // Drag-zoom gesture: vertical travel zooms about the canvas centre.
        panMovedRef.current = true;
        const canvas = canvasRef.current;
        if (canvas)
          zoomAbout(
            canvas.width / 2,
            canvas.height / 2,
            Math.exp((panLastRef.current.y - e.clientY) * 0.005),
          );
        panLastRef.current = { x: e.clientX, y: e.clientY };
      } else if (cursorRef.current) {
        draw(); // keep the crosshair tracking the cursor
      }
    },
    [
      activeTool,
      placeLib,
      pendingLabel,
      pastePending,
      pendingImage,
      danglingPinAt,
      draw,
      onCursorMove,
      zoomAbout,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Middle/right-button pan or drag-zoom ends regardless of the active tool.
      if (
        (modeRef.current === 'pan' || modeRef.current === 'dragzoom') &&
        (e.button === 1 || e.button === 2)
      ) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        modeRef.current = 'idle';
        panLastRef.current = null;
        return;
      }
      // Zoom to Selection Area: release fits the view to the drawn rectangle.
      if (zoomAreaRef.current && modeRef.current === 'box') {
        (e.target as Element).releasePointerCapture(e.pointerId);
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        const vp = viewportRef.current;
        const movedPx = bo && be && vp ? Math.hypot(be.x - bo.x, be.y - bo.y) * vp.scale : 0;
        if (bo && be && movedPx > 4) {
          onZoomArea?.({
            minX: Math.min(bo.x, be.x),
            minY: Math.min(bo.y, be.y),
            maxX: Math.max(bo.x, be.x),
            maxY: Math.max(bo.y, be.y),
          });
        }
        zoomAreaRef.current = false;
        boxOriginRef.current = null;
        boxEndRef.current = null;
        modeRef.current = 'idle';
        draw();
        return;
      }
      if (activeTool !== 'select' && activeTool !== 'selectLasso') return;
      (e.target as Element).releasePointerCapture(e.pointerId);
      let committedMove = false;
      if (modeRef.current === 'lasso') {
        const pts = lassoPointsRef.current;
        const vp = viewportRef.current;
        // A trace with real extent is a lasso; a near-stationary press is a click.
        let span = 0;
        for (const p of pts) span = Math.max(span, Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y));
        const movedPx = vp ? span * vp.scale : 0;
        if (pts.length >= 3 && movedPx > 4) {
          const { additive, subtractive } = boxModifiersRef.current;
          onSelectBox?.(lassoSelect(schematic, libById, pts), additive, subtractive);
        } else {
          onSelect(boxHitRef.current, e.shiftKey);
        }
        boxHitRef.current = null;
        lassoPointsRef.current = [];
        modeRef.current = 'idle';
        draw();
        return;
      }
      if (modeRef.current === 'move' && grabbedRef.current) {
        // A keyboard grabbed move ignores button-up; it commits on the next
        // left click (handled in onPointerDown). Nothing to do here.
        return;
      } else if (modeRef.current === 'move') {
        const d = moveDeltaRef.current;
        const spec = moveSpecRef.current;
        if (d && spec && (d.x !== 0 || d.y !== 0)) {
          onCommand(buildMove(spec, d));
          committedMove = true;
        }
      } else if (modeRef.current === 'box') {
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        const vp = viewportRef.current;
        // Under ~4 screen px of travel it's a click, which clears the selection.
        const movedPx = bo && be && vp ? Math.hypot(be.x - bo.x, be.y - bo.y) * vp.scale : 0;
        if (bo && be && movedPx > 4) {
          const { additive, subtractive } = boxModifiersRef.current;
          onSelectBox?.(boxSelect(schematic, libById, bo, be), additive, subtractive);
        } else {
          // A plain click in SELECT mode selects the pressed item, else clears.
          onSelect(boxHitRef.current, e.shiftKey);
        }
        boxHitRef.current = null;
        boxOriginRef.current = null;
        boxEndRef.current = null;
      } else if (modeRef.current === 'pan' && !panMovedRef.current) {
        onSelect(null, e.shiftKey);
      }
      modeRef.current = 'idle';
      moveStartRef.current = null;
      moveDeltaRef.current = null;
      moveSpecRef.current = null;
      panLastRef.current = null;
      if (!committedMove) draw();
    },
    [activeTool, schematic, libById, onCommand, buildMove, onSelect, onSelectBox, onZoomArea, draw],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Double-click ends the wire run at the point (the two plain clicks it
      // contains already fixed the segments; the extras are null and merge away).
      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        if (wiresRef.current.length) {
          updateWireChain(snapConn(toWorld(e.clientX, e.clientY)));
          finishWireChain();
        }
        draw();
        return;
      }
      // Lines tool: a double-click ends the open polyline.
      if (drawStateRef.current?.tool === 'lines') {
        finishPoly();
        return;
      }
      // Select tool: double-click opens the item's properties (KiCad binds mouse
      // double-click to SCH_ACTIONS::properties -> SCH_EDIT_TOOL::EditProperties).
      if (activeTool === 'select') {
        const vp = viewportRef.current;
        if (!vp) return;
        const hit = hitTest(
          schematic,
          libById,
          toWorld(e.clientX, e.clientY),
          (6 * dpr()) / vp.scale,
        );
        if (hit) onEditItem?.(hit.id, hit.kind);
      }
    },
    [
      activeTool,
      draw,
      schematic,
      libById,
      onEditItem,
      finishPoly,
      updateWireChain,
      finishWireChain,
      snapConn,
    ],
  );

  // Escape ends an in-progress wire; '/' switches the segment posture and
  // Backspace undoes the last segment while drawing; R/X/Y rotate/mirror
  // (KiCad hotkeys): the attached symbol while placing, else the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'schematic') !== 'schematic') return;
      if (e.key === 'Escape' && wiresRef.current.length) {
        wiresRef.current = [];
        draw();
        return;
      }
      // SCH_ACTIONS::switchSegmentPosture ('/') while drawing a wire/bus.
      if (e.key === '/' && wiresRef.current.length >= 2) {
        const wires = wiresRef.current;
        wirePostureRef.current = !wirePostureRef.current;
        if (lineModeRef.current === '90') {
          // 90° has no forced posture; just swap the live pair's directions.
          switchPosture90(wires[wires.length - 2]!, wires[wires.length - 1]!);
        }
        e.preventDefault();
        draw(); // 45° recomputes the break point from the flipped posture
        return;
      }
      // SCH_ACTIONS::undoLastSegment (Backspace/Delete) while drawing.
      if ((e.key === 'Backspace' || e.key === 'Delete') && wiresRef.current.length) {
        const wires = wiresRef.current;
        const free = lineModeRef.current === 'free';
        if ((free && wires.length > 1) || (!free && wires.length > 2)) {
          wires.pop();
          e.preventDefault();
          draw();
        }
        return;
      }
      if (e.key === 'Escape' && drawStateRef.current) {
        drawStateRef.current = null;
        draw();
        return;
      }
      if (e.key === 'Enter' && drawStateRef.current?.tool === 'lines') {
        finishPoly();
        return;
      }

      // Skip while typing — a focused checkbox/radio (Selection Filter panel)
      // isn't typing and must not eat the R/X/Y hotkeys.
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' ||
          tgt.isContentEditable ||
          (tgt.tagName === 'INPUT' &&
            !/^(checkbox|radio|button|range)$/.test((tgt as HTMLInputElement).type)))
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // R/X/Y here only steer the item attached to the cursor while placing;
      // selection transforms live in the editor's hotkey handler (a second
      // window listener — handling them in both applied every transform twice).
      const k = e.key.toLowerCase();
      if (k !== 'r' && k !== 'x' && k !== 'y') return;

      // Bus-entry tool: R cycles the stub through its four 45° orientations.
      if (activeTool === 'busEntry' && k === 'r') {
        const sz = entrySizeRef.current;
        entrySizeRef.current = e.shiftKey
          ? { x: -sz.y, y: sz.x } // Shift+R = rotate CW
          : { x: sz.y, y: -sz.x };
        e.preventDefault();
        draw();
        return;
      }

      if ((activeTool === 'placeSymbol' || activeTool === 'placePower') && placeLib) {
        // Advance the attached symbol's orientation in place. Serialized mirror
        // axis 'y' is KiCad's MirrorHorizontally (hotkey X), 'x' its
        // MirrorVertically (hotkey Y) — see common/transform.ts.
        const o = placeOrientRef.current;
        placeOrientRef.current =
          k === 'r'
            ? rotateOrientation(o, e.shiftKey)
            : k === 'x'
              ? mirrorOrientation(o, 'y')
              : mirrorOrientation(o, 'x');
        e.preventDefault();
        draw();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw, activeTool, placeLib, finishPoly]);

  const cursor = activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor, touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (activeTool === 'drawWire' || activeTool === 'drawBus') {
            wiresRef.current = [];
            draw();
          } else if (drawStateRef.current?.tool === 'lines') finishPoly();
          else if (drawStateRef.current) {
            drawStateRef.current = null;
            draw();
          } else if (
            (activeTool === 'select' || activeTool === 'selectLasso') &&
            !panMovedRef.current
          ) {
            // KiCad's selection-tool context menu: a plain right-click (not the
            // end of a right-drag pan) hit-tests the point and asks the editor
            // to select the item and pop the menu.
            const vp = viewportRef.current;
            if (!vp) return;
            const hit = hitTest(
              schematic,
              libById,
              toWorld(e.clientX, e.clientY),
              (6 * dpr()) / vp.scale,
            );
            onContextMenuRequest?.(e.clientX, e.clientY, hit);
          }
        }}
        onPointerLeave={() => {
          cursorRef.current = null;
          onCursorMove?.(null);
        }}
      />
      {/* Label placement uses a properties dialog (in App) and a cursor-attached ghost. */}
    </div>
  );
});
