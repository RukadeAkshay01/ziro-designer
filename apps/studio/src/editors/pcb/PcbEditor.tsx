/**
 * PCB Editor: the pcbnew frame replicated — menu bar (menubar_pcb_editor.cpp),
 * top/left/right toolbars (toolbars_pcb_editor.cpp), the docked Appearance
 * manager with Layers / Objects / Nets tabs and layer presets
 * (widgets/appearance_controls.cpp), the Selection Filter panel, and the
 * PCB_PAINTER canvas (renderBoard.ts). Board editing tools are staged; the
 * viewer pipeline, layer/object controls and presets are fully functional.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { parse, readBoard, iuToMM, type Board } from '@ziroeda/core';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { buildScene, buildDrawSteps, DEFAULT_DRAW_OPTIONS, type BoardScene, type PcbDrawOptions, type SheetInfo } from './renderBoard.js';
import type { Viewer3D } from './pcb3d.js';
import { layerColor, PCB_PAINT_ORDER } from './pcbTheme.js';
import { PCB_TOP_TOOLBAR, PCB_LEFT_TOOLBAR, PCB_RIGHT_TOOLBAR, PCB_FILTER_CATS } from './pcbToolbars.js';
import '../../ui/shell.css';

const MM = 10000;

// KiCad's own visibility (eye) icons, vendored under assets/.
const EYE_ICONS = import.meta.glob('../assets/toolbar/visibility*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const eyeUrl = (on: boolean): string | undefined => EYE_ICONS[`../assets/toolbar/visibility${on ? '' : '_off'}.svg`];

// Left-toolbar radio groups (same convention as the schematic editor).
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];
const DEFAULT_TOGGLES = new Set([
  'toggleGrid', 'unitsMm', 'crosshairSmall', 'lineMode90',
  'showRatsnest', 'ratsnestLineMode', 'zoneDisplayFilled', 'showLayersManager', 'showProperties',
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
  tracks: boolean; vias: boolean; pads: boolean; zones: boolean; images: boolean;
  footprintsFront: boolean; footprintsBack: boolean;
  fpValues: boolean; fpReferences: boolean; fpText: boolean;
  ratsnest: boolean; drcWarnings: boolean; drcErrors: boolean; drcExclusions: boolean;
  anchors: boolean; drawingSheet: boolean; grid: boolean;
}
const DEFAULT_OBJECTS: ObjectState = {
  tracks: true, vias: true, pads: true, zones: true, images: true,
  footprintsFront: true, footprintsBack: true,
  fpValues: true, fpReferences: true, fpText: true,
  ratsnest: true, drcWarnings: true, drcErrors: true, drcExclusions: true,
  anchors: true, drawingSheet: true, grid: true,
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
  { name: 'Inner Copper Layers', layers: (_a, cu) => [...cu.filter((c) => /^In/.test(c)), 'Edge.Cuts'] },
  { name: 'Front Layers', layers: () => ['F.Cu', ...FRONT_TECH, 'Edge.Cuts'] },
  { name: 'Front Assembly View', layers: () => ['F.SilkS', 'F.Mask', 'F.Fab', 'F.CrtYd', 'Edge.Cuts'] },
  { name: 'Back Layers', layers: () => ['B.Cu', ...BACK_TECH, 'Edge.Cuts'] },
  { name: 'Back Assembly View', layers: () => ['B.SilkS', 'B.Mask', 'B.Fab', 'B.CrtYd', 'Edge.Cuts'] },
];

export function PcbEditor({ fileName, text, onExit, onShowSchematic }: {
  fileName: string;
  text: string;
  onExit: () => void;
  onShowSchematic?: () => void;
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
  const [selFilter, setSelFilter] = useState<Set<string>>(new Set(PCB_FILTER_CATS.map((c) => c[0])));
  const [netQuery, setNetQuery] = useState('');
  const [activeTool, setActiveTool] = useState('select');
  const [show3D, setShow3D] = useState(false);
  const viewer3dRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0 });
  const boardRef = useRef<Board | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const rafRef = useRef(0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const showAppearance = toggles.has('showLayersManager');
  const showProperties = toggles.has('showProperties');

  // Draw options derived from the Objects tab + zone display mode.
  const drawOpts = useMemo<PcbDrawOptions>(() => ({
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
  }), [objects, opacity, toggles]);

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
    return () => { cancelled = true; clearTimeout(id); };
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
  const cacheRef = useRef<{ canvas: HTMLCanvasElement; view: { scale: number; tx: number; ty: number } } | null>(null);
  const renderingRef = useRef(false);
  const viewChangedRef = useRef(true);

  const viewMatchesCache = (): boolean => {
    const c = cacheRef.current;
    const v = viewRef.current;
    const canvas = canvasRef.current;
    return !!c && !!canvas && c.view.scale === v.scale && c.view.tx === v.tx && c.view.ty === v.ty
      && c.canvas.width === canvas.width && c.canvas.height === canvas.height;
  };

  const startCrispRender = useCallback(() => {
    if (renderingRef.current) return; // in flight — it re-checks the view on completion
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene || canvas.width < 2) return;
    if (viewMatchesCache()) { viewChangedRef.current = false; return; }
    renderingRef.current = true;
    viewChangedRef.current = false;
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const cctx = work.getContext('2d');
    if (!cctx) { renderingRef.current = false; return; }
    const jobView = { ...viewRef.current };
    const sheet: SheetInfo | undefined = boardRef.current
      ? { paper: boardRef.current.paper, titleBlock: boardRef.current.titleBlock, fileName }
      : undefined;
    const steps = buildDrawSteps(cctx, scene, jobView, visible, work.width, work.height, drawOpts, sheet);
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

  const zoomToFit = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene?.bbox) return;
    let { minX, minY, maxX, maxY } = scene.bbox;
    // Include the drawing sheet (page origin at 0,0) so the frame fits on screen.
    const paper = boardRef.current?.paper?.split(/\s+/)[0];
    const PAGE: Record<string, [number, number]> = { A5: [210, 148], A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
    if (paper && PAGE[paper] && objects.drawingSheet) {
      const [pw, ph] = PAGE[paper]!;
      minX = Math.min(minX, 0); minY = Math.min(minY, 0);
      maxX = Math.max(maxX, pw * MM); maxY = Math.max(maxY, ph * MM);
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

  const zoomStep = useCallback((factor: number) => {
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
  }, [requestDraw]);

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

  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 0 || e.button === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY };
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
    }
    if (dragRef.current) {
      const v = viewRef.current;
      v.tx += (e.clientX - dragRef.current.x) * dpr;
      v.ty += (e.clientY - dragRef.current.y) * dpr;
      dragRef.current = { x: e.clientX, y: e.clientY };
      requestDraw();
    }
  };
  const onPointerUp = (): void => { dragRef.current = null; };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'f' || e.key === 'F') zoomToFit();
      if (e.key === 'Escape') setShow3D(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit]);

  // Mount the three.js 3D viewer while the overlay is open. Lazy-imported so
  // three.js only downloads when the user actually opens the 3D view.
  useEffect(() => {
    if (!show3D || !viewer3dRef.current || !boardRef.current) return;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    const el = viewer3dRef.current, brd = boardRef.current;
    void import('./pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try { viewer = mount3DViewer(el, brd); } catch { viewer = null; }
    });
    return () => { cancelled = true; viewer?.dispose(); };
  }, [show3D]);

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
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [text, fileName]);

  const onTopAction = (id: string): void => {
    switch (id) {
      case 'save': saveCopy(); break;
      case 'zoomRedraw': cacheRef.current = null; requestDraw(); break;
      case 'zoomIn': zoomStep(1.3); break;
      case 'zoomOut': zoomStep(1 / 1.3); break;
      case 'zoomFit': case 'zoomFitObjects': zoomToFit(); break;
      case 'showEeschema': onShowSchematic?.(); break;
      case 'threeDViewer': setShow3D(true); break;
      default: break; // editing actions are staged
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
        { label: 'Undo', disabled: dis, shortcut: 'Ctrl+Z' },
        { label: 'Redo', disabled: dis, shortcut: 'Ctrl+Y' },
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
        { label: 'Redraw', action: () => { cacheRef.current = null; requestDraw(); }, shortcut: 'F5' },
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
        leftSlot={<div className="ze-home-link" onClick={onExit} title="Back to project manager">⌂ ZiroEDA</div>}
      />
      <Toolbar entries={PCB_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      {/* TOP_AUX bar: track width / via size / active layer / grid / zoom */}
      <div className="ze-auxbar" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 8px', borderBottom: '1px solid #333', fontSize: 12 }}>
        <select disabled title="Track width (routing is staged)"><option>Track: use netclass width</option></select>
        <select disabled title="Via size (routing is staged)"><option>Via: use netclass sizes</option></select>
        <span style={{ width: 8 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, background: layerColor(activeLayer), borderRadius: 2, border: '1px solid #444' }} />
          <select value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)} title="Active layer">
            {(board?.layers ?? []).map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </span>
        <span style={{ width: 8 }} />
        <select disabled title="Grid"><option>Grid: 0.635 mm (25 mils)</option></select>
        <select disabled title="Zoom presets"><option>Zoom Auto</option></select>
      </div>

      <div className="ze-body">
        <Toolbar entries={PCB_LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        {showProperties && (
          <div className="ze-leftdock" style={{ width: 220 }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Properties</div>
              <div className="ze-panel-body">
                <div className="ze-muted">No objects selected</div>
              </div>
            </div>
          </div>
        )}

        <div className="ze-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {!board && !error && (
            <div className="ze-canvas-loading">
              <span className="ze-spinner" />
              <span>Loading board… (large boards can take a while)</span>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#ff8080' }}>
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
                      flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer',
                      background: tab === t ? '#2a2a2e' : 'transparent',
                      color: 'inherit', border: 'none',
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
                          style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
                          onClick={() => setActiveLayer(name)}
                          title="Click to make active; click the eye to show/hide"
                        >
                          {/* eye toggle, KiCad's APPEARANCE_CONTROLS visibility column */}
                          <img
                            src={eyeUrl(on)}
                            alt={on ? 'visible' : 'hidden'}
                            onClick={(e) => { e.stopPropagation(); toggleLayer(name); }}
                            style={{ width: 16, height: 16, opacity: on ? 0.9 : 0.35, cursor: 'pointer' }}
                            title={on ? 'Hide layer' : 'Show layer'}
                          />
                          <span style={{
                            width: 14, height: 14, borderRadius: 2, flex: '0 0 auto',
                            background: layerColor(name), border: '1px solid #444',
                          }} />
                          <span style={{ opacity: on ? 1 : 0.5 }}>{name}</span>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span>Presets (Ctrl+Tab):</span>
                      <select
                        value={preset}
                        onChange={(e) => applyPreset(e.target.value)}
                        style={{ flex: 1 }}
                      >
                        {preset === '(unsaved)' && <option value="(unsaved)">(unsaved)</option>}
                        {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {tab === 'Objects' && OBJECT_ROWS.map(([key, label, slider]) => (
                  <div key={key} className="ze-tree-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={objects[key as keyof ObjectState]}
                      onChange={() => setObjects((p) => ({ ...p, [key]: !p[key as keyof ObjectState] }))}
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
                        onChange={(e) => setOpacity((p) => ({ ...p, [key]: Number(e.target.value) / 100 }))}
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
                    onChange={() => setSelFilter((p) => (p.size === PCB_FILTER_CATS.length ? new Set() : new Set(PCB_FILTER_CATS.map((c) => c[0]))))}
                  />
                  All items
                </label>
                <div className="ze-selfilter">
                  {PCB_FILTER_CATS.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={selFilter.has(key)}
                        onChange={() => setSelFilter((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
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
          onActivate={(id) => setActiveTool(id)}
        />
      </div>

      {show3D && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgb(13,15,23)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #333', fontSize: 13 }}>
            <b>3D Viewer</b>
            <span style={{ opacity: 0.6 }}>drag to orbit · wheel to zoom · Esc to close</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setShow3D(false)}>Close ✕</button>
          </div>
          <div ref={viewer3dRef} style={{ flex: 1, minHeight: 0, position: 'relative' }} />
        </div>
      )}

      {/* pcbnew's two-part status bar: item counts row, then position row. */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell"><b>Pads</b> {board?.footprints.reduce((n, f) => n + f.pads.length, 0) ?? 0}</span>
        <span className="cell"><b>Vias</b> {board?.vias.length ?? 0}</span>
        <span className="cell"><b>Track Segments</b> {board ? board.tracks.length + board.arcs.length : 0}</span>
        <span className="cell"><b>Nets</b> {board ? Math.max(0, board.nets.size - 1) : 0}</span>
        <span className="cell grow"><b>Unrouted</b> 0</span>
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
