/**
 * PCB Editor: the pcbnew frame replicated — menu bar (menubar_pcb_editor.cpp),
 * top/left/right toolbars (toolbars_pcb_editor.cpp), the docked Appearance
 * manager with Layers / Objects / Nets tabs and layer presets
 * (widgets/appearance_controls.cpp), the Selection Filter panel, and the
 * PCB_PAINTER canvas (renderBoard.ts). Board editing tools are staged; the
 * viewer pipeline, layer/object controls and presets are fully functional.
 */

import { iuToMM } from '@ziroeda/common';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  boardHitCandidates,
  boardItemsInBox,
  boardItemBBox,
  parseBoardItemId,
  moveBoardItems,
  dragBoardItems,
  connectedTrackEnds,
  boardItemId,
  subsetBoardItems,
  deleteBoardItems,
  rotateBoardItems,
  duplicateBoardItems,
  serializeBoard,
  type Board,
  type BoardItemKind,
} from '@ziroeda/pcbnew';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import {
  buildScene,
  buildDrawSteps,
  drawBoard,
  drawGrid,
  DEFAULT_GRID_OPTIONS,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type PcbDrawOptions,
  type SheetInfo,
} from './renderBoard.js';
import type { Viewer3D } from './pcb3d.js';
import { layerColor, PCB_PAINT_ORDER, PCB_CURSOR } from './pcbTheme.js';
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

// KiCad's own visibility (eye) icons, vendored under assets/.
const EYE_ICONS = import.meta.glob('../assets/toolbar/visibility*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const eyeUrl = (on: boolean): string | undefined =>
  EYE_ICONS[`../assets/toolbar/visibility${on ? '' : '_off'}.svg`];

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
  'showRatsnest',
  'ratsnestLineMode',
  'zoneDisplayFilled',
  'showLayersManager',
  'showProperties',
]);

// Objects tab rows, exactly appearance_controls.cpp s_objectSettings.
// [key, label, hasOpacitySlider]
const OBJECT_ROWS: [keyof ObjectState | string, string, boolean][] = [
  ['tracks', 'Tracks', true],
  ['vias', 'Vias', true],
  ['pads', 'Pads', true],
  ['zones', 'Zones', true],
  ['images', 'Images', true],
  ['footprintsFront', 'Footprints Front', false],
  ['footprintsBack', 'Footprints Back', false],
  ['fpValues', 'Values', false],
  ['fpReferences', 'References', false],
  ['fpText', 'Footprint Text', false],
  ['ratsnest', 'Ratsnest', false],
  ['drcWarnings', 'DRC Warnings', false],
  ['drcErrors', 'DRC Errors', false],
  ['drcExclusions', 'DRC Exclusions', false],
  ['anchors', 'Anchors', false],
  ['drawingSheet', 'Drawing Sheet', false],
  ['grid', 'Grid', false],
];

interface ObjectState {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
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
  drawingSheet: boolean;
  grid: boolean;
}
const DEFAULT_OBJECTS: ObjectState = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
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
  drawingSheet: true,
  grid: true,
};
// project_local_settings.cpp defaults.
const DEFAULT_OPACITY = { tracks: 1.0, vias: 1.0, pads: 1.0, zones: 0.6, images: 0.6 };

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
  const [preset, setPreset] = useState('All Layers');
  const [tab, setTab] = useState<'Layers' | 'Objects' | 'Nets'>('Layers');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(PCB_FILTER_CATS.map((c) => c[0])),
  );
  const [netQuery, setNetQuery] = useState('');
  const [activeTool, setActiveTool] = useState('select');
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
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0 });
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
    }),
    [objects, opacity, toggles],
  );

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
    cacheRef.current = null;
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
    view: { scale: number; tx: number; ty: number };
  } | null>(null);
  const renderingRef = useRef(false);
  const viewChangedRef = useRef(true);

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
      c.canvas.width === canvas.width &&
      c.canvas.height === canvas.height
    );
  };

  const startCrispRender = useCallback(() => {
    if (renderingRef.current) return; // in flight — it re-checks the view on completion
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene || canvas.width < 2) return;
    if (viewMatchesCache()) {
      viewChangedRef.current = false;
      return;
    }
    renderingRef.current = true;
    viewChangedRef.current = false;
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const cctx = work.getContext('2d');
    if (!cctx) {
      renderingRef.current = false;
      return;
    }
    const jobView = { ...viewRef.current };
    const sheet: SheetInfo | undefined = boardRef.current
      ? { paper: boardRef.current.paper, titleBlock: boardRef.current.titleBlock, fileName }
      : undefined;
    const steps = buildDrawSteps(
      cctx,
      scene,
      jobView,
      visible,
      work.width,
      work.height,
      drawOpts,
      sheet,
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
        // The view moved on while we were rendering: keep chasing it so the
        // image keeps sharpening throughout a continuous zoom.
        if (viewChangedRef.current || !viewMatchesCache()) startCrispRender();
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
    if (!viewMatchesCache()) {
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
    // Selection / move overlay: the selected items repainted brightened over the
    // raster — KiCad draws a selected item in its layer colour Brightened(0.8),
    // not a bounding box (pcb_painter.cpp getColor). While a move is in flight the
    // moving items are excluded from the raster and this overlay follows the
    // cursor at the drag offset (EDIT_TOOL::Move's GAL overlay); otherwise it
    // sits exactly over the raster so the selection just lights up in place.
    {
      const md = moveDeltaRef.current;
      const os = moveSceneRef.current ?? selSceneRef.current;
      if (os) {
        // A drag overlay is already at its stretched absolute coords; a move
        // overlay is the static subset translated by the drag delta.
        const off = dragModeRef.current ? { x: 0, y: 0 } : (md ?? { x: 0, y: 0 });
        const offView = {
          scale: v.scale,
          tx: v.tx + off.x * v.scale,
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
    const brd = boardRef.current;
    // Rubber-band marquee: KiCad tints it blue for a left→right window
    // (contained) select, green for a right→left crossing select.
    const box = boxRef.current;
    if (box) {
      const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x * v.scale + v.tx,
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
          x: p.x * v.scale + v.tx,
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
      const px = snapped.x * v.scale + v.tx;
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

  // Layer/object changes invalidate the raster.
  useEffect(() => {
    cacheRef.current = null;
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
      cacheRef.current = null;
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
  const deleteSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    commitBoard(deleteBoardItems(brd, sel));
    setSelection(new Set());
  }, [commitBoard]);

  // Rotate the selection ±90° about its centre (EDIT_TOOL::Rotate). Keeps the
  // selection so it can be rotated repeatedly.
  const rotateSel = useCallback(
    (ccw: boolean) => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      commitBoard(rotateBoardItems(brd, sel, ccw));
    },
    [commitBoard],
  );

  // Duplicate the selection 1 mm off (EDIT_TOOL::Duplicate) and select the copies.
  const duplicateSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const { board: next, ids } = duplicateBoardItems(brd, sel, { x: MM, y: MM });
    commitBoard(next);
    setSelection(new Set(ids));
  }, [commitBoard]);

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
    viewRef.current = {
      scale: s,
      tx: canvas.width / 2 - ((minX + maxX) / 2) * s,
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
      const wx = (px - v.tx) / v.scale;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * v.scale;
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
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (!fittedRef.current && sceneRef.current) {
        fittedRef.current = true;
        zoomToFit();
      } else {
        cacheRef.current = null;
        requestDraw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dpr, requestDraw, zoomToFit, board]);

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
      const wx = (px - v.tx) / v.scale;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * v.scale;
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
        x: ((clientX - rect.left) * dpr - v.tx) / v.scale,
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
          : kind === 'zone'
            ? 'zones'
            : kind === 'shape'
              ? 'graphics'
              : kind === 'text'
                ? 'text'
                : null;
  const passesFilter = (id: string): boolean => {
    const r = parseBoardItemId(id);
    if (!r) return false;
    const key = filterKeyOf(r.kind);
    return key ? selFilter.has(key) : true;
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
    const cands = boardHitCandidates(brd, w, tolOf()).filter(passesFilter);
    if (cands.length === 0) {
      applySelect(null, additive);
      return;
    }
    // guessSelectionCandidates: keep only the top-priority tier (a track over a
    // footprint resolves to the track, no menu); ambiguous only within a tier.
    const rankOf = (id: string): number => {
      const k = parseBoardItemId(id)?.kind;
      return k === 'zone' ? 2 : k === 'footprint' ? 1 : 0;
    };
    const tier = cands.filter((c) => rankOf(c) === rankOf(cands[0]!));
    if (tier.length <= 1) {
      applySelect(cands[0]!, additive);
      return;
    }
    setDisambig({ x: clientX, y: clientY, ids: cands, additive });
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
    sel: ReadonlySet<string>,
    kind: 'move' | 'drag',
    origin: { x: number; y: number },
  ): void => {
    const brd = boardRef.current;
    if (!brd || sel.size === 0) return;
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
    cacheRef.current = null;
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
      const hitId =
        w && brd ? (boardHitCandidates(brd, w, tolOf()).filter(passesFilter)[0] ?? null) : null;
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
      const wx = ((e.clientX - rect.left) * dpr - v.tx) / v.scale;
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
        clickSelect(e.clientX, e.clientY, d.shift);
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
      const mod = e.ctrlKey || e.metaKey;
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
  const layerRows = useMemo(() => {
    if (!board) return [];
    const known = new Set(board.layers.map((l) => l.name));
    const tech = PCB_PAINT_ORDER.filter((n) => known.has(n) && !/\.Cu$/.test(n)).reverse();
    return [...copperLayers, ...tech];
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
    setPreset(name);
    const p = PRESETS.find((x) => x.name === name);
    if (!p || !board) return;
    const all = board.layers.map((l) => l.name);
    setVisible(new Set(p.layers(all, copperLayers).filter((l) => all.includes(l))));
  };

  const nets = useMemo(() => {
    if (!board) return [];
    const q = netQuery.toLowerCase();
    return [...board.nets.entries()]
      .filter(([code, name]) => code !== 0 && name.toLowerCase().includes(q))
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [board, netQuery]);

  // ----- toolbar handlers -----------------------------------------------------

  const onLeftToggle = (id: string): void => {
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
      case 'zoomRedraw':
        cacheRef.current = null;
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
            cacheRef.current = null;
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
  const unitLabel = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';

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
        <Toolbar
          entries={PCB_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        {showProperties && (
          <div className="ze-leftdock" style={{ width: 220 }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Properties</div>
              <div className="ze-panel-body">
                {selection.size === 0 ? (
                  <div className="ze-muted">No objects selected</div>
                ) : (
                  <PcbSelectionInfo board={board} selection={selection} />
                )}
              </div>
            </div>
          </div>
        )}

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

        {showAppearance && (
          <div className="ze-leftdock" style={{ width: 250 }}>
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
                {tab === 'Layers' && (
                  <>
                    {layerRows.map((name) => {
                      const on = visible.has(name);
                      return (
                        <div
                          key={name}
                          className={`ze-tree-item ${name === activeLayer ? 'active' : ''}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            cursor: 'pointer',
                          }}
                          onClick={() => setActiveLayer(name)}
                          title="Click to make active; click the eye to show/hide"
                        >
                          {/* eye toggle, KiCad's APPEARANCE_CONTROLS visibility column */}
                          <img
                            src={eyeUrl(on)}
                            alt={on ? 'visible' : 'hidden'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLayer(name);
                            }}
                            style={{
                              width: 16,
                              height: 16,
                              opacity: on ? 0.9 : 0.35,
                              cursor: 'pointer',
                            }}
                            title={on ? 'Hide layer' : 'Show layer'}
                          />
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 2,
                              flex: '0 0 auto',
                              background: layerColor(name),
                              border: '1px solid #444',
                            }}
                          />
                          <span style={{ opacity: on ? 1 : 0.5 }}>{name}</span>
                        </div>
                      );
                    })}
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                      }}
                    >
                      <span>Presets (Ctrl+Tab):</span>
                      <select
                        value={preset}
                        onChange={(e) => applyPreset(e.target.value)}
                        style={{ flex: 1 }}
                      >
                        {preset === '(unsaved)' && <option value="(unsaved)">(unsaved)</option>}
                        {PRESETS.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {tab === 'Objects' &&
                  OBJECT_ROWS.map(([key, label, slider]) => (
                    <div
                      key={key}
                      className="ze-tree-item"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <input
                        type="checkbox"
                        checked={objects[key as keyof ObjectState]}
                        onChange={() =>
                          setObjects((p) => ({ ...p, [key]: !p[key as keyof ObjectState] }))
                        }
                      />
                      <span style={{ flex: 1 }}>{label}</span>
                      {slider && key in opacity && (
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(opacity[key as keyof typeof opacity] * 100)}
                          style={{ width: 70 }}
                          title={`${label} opacity`}
                          onChange={(e) =>
                            setOpacity((p) => ({ ...p, [key]: Number(e.target.value) / 100 }))
                          }
                        />
                      )}
                    </div>
                  ))}

                {tab === 'Nets' && (
                  <>
                    <input
                      type="search"
                      placeholder="Filter nets"
                      value={netQuery}
                      onChange={(e) => setNetQuery(e.target.value)}
                      style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
                    />
                    {nets.slice(0, 400).map(([code, name]) => (
                      <div key={code} className="ze-tree-item" title={`Net ${code}`}>
                        {name || `(unnamed ${code})`}
                      </div>
                    ))}
                    {nets.length > 400 && <div className="ze-muted">…{nets.length - 400} more</div>}
                  </>
                )}
              </div>
            </div>

            <div className="ze-panel">
              <div className="ze-panel-header">Selection Filter</div>
              <div className="ze-panel-body">
                <label>
                  <input
                    type="checkbox"
                    checked={selFilter.size === PCB_FILTER_CATS.length}
                    onChange={() =>
                      setSelFilter((p) =>
                        p.size === PCB_FILTER_CATS.length
                          ? new Set()
                          : new Set(PCB_FILTER_CATS.map((c) => c[0])),
                      )
                    }
                  />
                  All items
                </label>
                <div className="ze-selfilter">
                  {PCB_FILTER_CATS.map(([key, label]) => (
                    <label key={key}>
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

        <Toolbar
          entries={PCB_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={(id) => {
            if (id === 'delete') deleteSel();
            else setActiveTool(id);
          }}
        />
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

      {/* pcbnew's two-part status bar: item counts row, then position row. */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell">
          <b>Pads</b> {board?.footprints.reduce((n, f) => n + f.pads.length, 0) ?? 0}
        </span>
        <span className="cell">
          <b>Vias</b> {board?.vias.length ?? 0}
        </span>
        <span className="cell">
          <b>Track Segments</b> {board ? board.tracks.length + board.arcs.length : 0}
        </span>
        <span className="cell">
          <b>Nets</b> {board ? Math.max(0, board.nets.size - 1) : 0}
        </span>
        <span className="cell grow">
          <b>Unrouted</b> 0
        </span>
        <span className="cell">{fileName}</span>
      </div>
      <div className="ze-statusbar">
        <span className="cell">Z {scale > 0 ? (scale * 1000).toFixed(2) : '—'}</span>
        <span className="cell">
          {cursor ? `X ${fmtCoord(cursor.x)} Y ${fmtCoord(cursor.y)}` : 'X — Y —'}
        </span>
        <span className="cell">
          {cursor ? `dx ${fmtCoord(cursor.x)}  dy ${fmtCoord(cursor.y)}` : 'dx — dy —'}
        </span>
        <span className="cell grow">{activeLayer}</span>
        <span className="cell">{unitLabel}</span>
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
  }
}

/** Read-only summary of the current selection for the Properties panel — the
 *  first slice of pcbnew's PCB_PROPERTIES_PANEL (editable fields come later). */
function PcbSelectionInfo({
  board,
  selection,
}: {
  board: Board | null;
  selection: ReadonlySet<string>;
}): JSX.Element {
  const mm = (iu: number): string => iuToMM(iu).toFixed(4);
  const ids = [...selection];

  if (!board) return <div className="ze-muted">…</div>;

  if (ids.length === 1) {
    const ref = parseBoardItemId(ids[0]!);
    const netName = (code: number): string => board.nets.get(code) || `(net ${code})`;
    const row = (k: string, v: string): JSX.Element => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0' }}>
        <span className="ze-muted">{k}</span>
        <span>{v}</span>
      </div>
    );
    if (ref) {
      switch (ref.kind) {
        case 'track': {
          const t = board.tracks[ref.index];
          if (t)
            return (
              <div>
                <b>Track</b>
                {row('Layer', t.layer)}
                {row('Net', netName(t.net))}
                {row('Width', `${mm(t.width)} mm`)}
              </div>
            );
          break;
        }
        case 'arc': {
          const a = board.arcs[ref.index];
          if (a)
            return (
              <div>
                <b>Arc (track)</b>
                {row('Layer', a.layer)}
                {row('Net', netName(a.net))}
                {row('Width', `${mm(a.width)} mm`)}
              </div>
            );
          break;
        }
        case 'via': {
          const v = board.vias[ref.index];
          if (v)
            return (
              <div>
                <b>Via</b>
                {row('Net', netName(v.net))}
                {row('Size', `${mm(v.size)} mm`)}
                {row('Drill', `${mm(v.drill)} mm`)}
              </div>
            );
          break;
        }
        case 'footprint': {
          const f = board.footprints[ref.index];
          if (f)
            return (
              <div>
                <b>Footprint</b>
                {row('Reference', f.reference ?? '—')}
                {row('Value', f.value ?? '—')}
                {row('Layer', f.layer)}
              </div>
            );
          break;
        }
        case 'zone': {
          const z = board.zones[ref.index];
          if (z)
            return (
              <div>
                <b>Zone</b>
                {row('Net', z.netName ?? netName(z.net))}
                {row('Layers', z.layers.join(', '))}
              </div>
            );
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
