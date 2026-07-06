import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback, useMemo } from 'react';
import {
  hitTest, planMove, moveWithConnections, orthoMove, addItems, deleteByIds, placeSymbol,
  makeWire, makeBus, makeJunction, makeNoConnect, makeLabel, needsJunction, rotateOrientation, mirrorOrientation, transformItems,
  collectAnchors, selectionAnchors, nearestAnchor, danglingPinPositions, boxSelect, pasteItems, translatePayload,
  type MoveSpec, type EditCommand, type Schematic, type LibSymbol, type Vec2, type Orientation, type TransformOp, type LabelKind, type LabelShape,
  type PastePayload, type ErcViolation,
} from '@ziroeda/core';
import { renderSchematic, drawErcMarkers, fitToContent, setRenderInvalidator, type Viewport } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

const GRID = 12700; // 1.27 mm (50 mil)
const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID });

// KiCad's LINE_WIRE cursor (resources/.../cursor-line-wire.xpm): a black crosshair
// at the hotspot with a green diagonal "wire" running up-right from it. Rebuilt as
// an SVG cursor; hotspot at (5,26) as in KiCad.
const WIRE_CURSOR = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">`
    + `<line x1="6" y1="25" x2="26" y2="5" stroke="#ffffff" stroke-width="5"/>`
    + `<line x1="6" y1="25" x2="26" y2="5" stroke="#008000" stroke-width="3"/>`
    + `<g stroke="#ffffff" stroke-width="3"><line x1="0" y1="26" x2="10" y2="26"/><line x1="5" y1="21" x2="5" y2="31"/></g>`
    + `<g stroke="#000000" stroke-width="1"><line x1="0" y1="26" x2="10" y2="26"/><line x1="5" y1="21" x2="5" y2="31"/></g>`
    + `</svg>`;
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

/** A label whose name/shape are chosen and which now follows the cursor for placement. */
export interface PendingLabel {
  kind: LabelKind;
  text: string;
  shape: LabelShape;
}

/** Constrain `pt` relative to `anchor` per the active line-posture mode. */
function constrain(anchor: Vec2, pt: Vec2, mode: LineMode): Vec2 {
  if (mode === 'free') return pt;
  const dx = pt.x - anchor.x;
  const dy = pt.y - anchor.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (mode === '90') return adx >= ady ? { x: pt.x, y: anchor.y } : { x: anchor.x, y: pt.y };
  // 45: horizontal, vertical, or pure diagonal — whichever is closest.
  if (adx > ady * 2.414) return { x: pt.x, y: anchor.y };
  if (ady > adx * 2.414) return { x: anchor.x, y: pt.y };
  const d = Math.max(adx, ady);
  return { x: anchor.x + Math.sign(dx) * d, y: anchor.y + Math.sign(dy) * d };
}

export interface CanvasController {
  zoomToFit: () => void;
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
  onEditItem?: (id: string, kind: 'symbol' | 'line' | 'junction' | 'noconnect' | 'label' | 'sheet') => void;
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
}

type Mode = 'idle' | 'pan' | 'move' | 'box';

// KiCad's selection-rectangle colours for a bright background
// (common/preview_items/selection_area.cpp, selectionColorScheme[1]).
const BOX_FILL_NORMAL = 'rgba(128, 77, 255, 0.5)'; // COLOR4D(0.5,0.3,1.0,0.5)
const BOX_FILL_ADDITIVE = 'rgba(128, 255, 128, 0.5)'; // COLOR4D(0.5,1.0,0.5,0.5)
const BOX_FILL_SUBTRACT = 'rgba(255, 128, 128, 0.5)'; // COLOR4D(1.0,0.5,0.5,0.5)
const BOX_OUTLINE_L2R = 'rgb(179, 179, 0)'; // window select: dark yellow
const BOX_OUTLINE_R2L = 'rgb(26, 26, 255)'; // greedy select: blue

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  { schematic, libById, selection, activeTool, lineMode, placeLib, pendingLabel, highlight, onSelect, onHighlight, onRequestTool, onEditItem, onSelectBox, pastePending, onPasteDone, ercMarkers, onCommand, onCursorMove, onScaleChange },
  ref,
): JSX.Element {
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
  // Connectable snapping during a move: the moved items' own connection points and the
  // anchors of everything else, so a dragged pin/wire-end snaps onto a matching anchor.
  const movePointsRef = useRef<Vec2[]>([]);
  const moveAnchorsRef = useRef<Vec2[]>([]);

  // Box-selection drag (KiCad selectMultiple): origin/end in world coordinates.
  const boxOriginRef = useRef<Vec2 | null>(null);
  const boxEndRef = useRef<Vec2 | null>(null);
  const boxModifiersRef = useRef({ additive: false, subtractive: false });

  // Wire-drawing state.
  const wireAnchorRef = useRef<Vec2 | null>(null);
  const cursorRef = useRef<Vec2 | null>(null);
  // A dangling pin the next drawWire activation should start from (auto-start wire).
  const pendingWireStartRef = useRef<Vec2 | null>(null);
  // Orientation applied to the symbol currently being placed (R/X/Y before dropping).
  const placeOrientRef = useRef<Orientation>({ angle: 0 });

  const dpr = () => window.devicePixelRatio || 1;

  // Dangling (unconnected) pins — KiCad's clickable wire-start anchors.
  const danglingPins = useMemo(() => danglingPinPositions(schematic, libById), [schematic, libById]);
  /** The dangling pin at/near a world point (within ~8px), or null. */
  const danglingPinAt = useCallback((world: Vec2): Vec2 | null => {
    const vp = viewportRef.current;
    const maxDist = vp && vp.scale > 0 ? 8 / vp.scale : GRID / 2;
    return nearestAnchor(world, danglingPins, maxDist);
  }, [danglingPins]);

  // Connectable anchors (pins/wire-ends/junctions/labels) for cursor snapping, à la
  // KiCad's BestSnapAnchor with GRID_CONNECTABLE.
  const anchors = useMemo(() => collectAnchors(schematic, libById), [schematic, libById]);
  /** Snap a world point to the nearest connection anchor within ~10px, else to the grid. */
  const snapConn = useCallback((world: Vec2): Vec2 => {
    const vp = viewportRef.current;
    const maxDist = vp && vp.scale > 0 ? 10 / vp.scale : GRID / 2;
    return nearestAnchor(world, anchors, maxDist) ?? snap(world);
  }, [anchors]);
  /** Wire endpoint: a nearby connectable anchor if any, else the line-mode-constrained grid point. */
  const wireEndPoint = useCallback((start: Vec2 | null, cur: Vec2): Vec2 => {
    const vp = viewportRef.current;
    const maxDist = vp && vp.scale > 0 ? 10 / vp.scale : GRID / 2;
    const a = nearestAnchor(cur, anchors, maxDist);
    if (a) return a;
    return start ? constrain(start, snap(cur), lineMode) : snap(cur);
  }, [anchors, lineMode]);

  // In H/V line mode, moves keep connected wires orthogonal (adding 90° bends);
  // in free/45 mode the connected wire simply stretches.
  const buildMove = useCallback(
    (spec: MoveSpec, delta: Vec2): EditCommand =>
      lineMode === '90' ? orthoMove(schematic, spec, delta) : moveWithConnections(spec, delta),
    [schematic, lineMode],
  );

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
    } else if ((activeTool === 'placeSymbol' || activeTool === 'placePower') && placeLib && cursorRef.current) {
      // Ghost: show the symbol attached to the cursor (with its current orientation).
      doc = placeSymbol(placeLib, snap(cursorRef.current), placeOrientRef.current).apply(schematic);
    }
    // Ghost: the named label follows the cursor (with its flag) until clicked to place.
    if (pendingLabel && cursorRef.current) {
      doc = addItems({ labels: [makeLabel(pendingLabel.kind, pendingLabel.text, snap(cursorRef.current), { shape: pendingLabel.shape })] }).apply(doc);
    }
    // Ghost: pasted items follow the cursor until dropped (KiCad's paste-then-move).
    if (pastePending && cursorRef.current) {
      const c = snap(cursorRef.current);
      const delta = { x: c.x - pastePending.refPoint.x, y: c.y - pastePending.refPoint.y };
      doc = pasteItems(translatePayload(pastePending, delta)).apply(doc);
    }
    renderSchematic(ctx, doc, vp, KICAD_CLASSIC, canvas.width, canvas.height, selection, highlight);

    // ERC markers (KiCad's bent-arrow fault indicators).
    if (ercMarkers && ercMarkers.length > 0) drawErcMarkers(ctx, ercMarkers, vp, KICAD_CLASSIC);

    // Box-selection rubber band, in KiCad's colours: the fill shows the mode
    // (normal/additive/subtractive) and the outline shows the direction —
    // dark yellow for a left-to-right "window", blue for right-to-left greedy.
    const bo = boxOriginRef.current;
    const be = boxEndRef.current;
    if (modeRef.current === 'box' && bo && be) {
      const greedy = be.x < bo.x;
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.fillStyle = subtractive ? BOX_FILL_SUBTRACT : additive ? BOX_FILL_ADDITIVE : BOX_FILL_NORMAL;
      ctx.strokeStyle = greedy ? BOX_OUTLINE_R2L : BOX_OUTLINE_L2R;
      ctx.lineWidth = 1 / vp.scale;
      const x = Math.min(bo.x, be.x), y = Math.min(bo.y, be.y);
      const w = Math.abs(be.x - bo.x), h = Math.abs(be.y - bo.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Wire / bus preview segment.
    const anchor = wireAnchorRef.current;
    const cur = cursorRef.current;
    if ((activeTool === 'drawWire' || activeTool === 'drawBus') && anchor && cur) {
      const end = wireEndPoint(anchor, cur);
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = activeTool === 'drawBus' ? KICAD_CLASSIC.bus : KICAD_CLASSIC.wire;
      ctx.lineWidth = (activeTool === 'drawBus' ? 0.3048 : 0.1524) * GRID / 1.27; // bus ~12 mil, wire ~6 mil
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    onScaleChange?.(vp.scale);
  }, [schematic, selection, activeTool, lineMode, placeLib, pendingLabel, pastePending, highlight, ercMarkers, wireEndPoint, buildMove, onScaleChange]);

  const zoomAbout = useCallback((px: number, py: number, factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const wx = (px - vp.offsetX) / vp.scale;
    const wy = (py - vp.offsetY) / vp.scale;
    const scale = vp.scale * factor;
    viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
    draw();
  }, [draw]);

  // A fit requested before the canvas has been laid out (ResizeObserver hasn't
  // fired yet, so the canvas still has its default 300x150 size) is deferred
  // and honoured by the size effect below.
  const fitPendingRef = useRef(false);
  const sizedRef = useRef(false);

  useImperativeHandle(ref, (): CanvasController => ({
    zoomToFit: () => {
      const c = canvasRef.current;
      if (!c || !sizedRef.current) { fitPendingRef.current = true; return; }
      viewportRef.current = fitToContent(schematic, c.width, c.height);
      draw();
    },
    zoomIn: () => { const c = canvasRef.current; if (c) zoomAbout(c.width / 2, c.height / 2, 1.25); },
    zoomOut: () => { const c = canvasRef.current; if (c) zoomAbout(c.width / 2, c.height / 2, 0.8); },
    centerOn: (p: Vec2) => {
      const c = canvasRef.current;
      const vp = viewportRef.current;
      if (!c || !vp) return;
      // Keep the zoom, but make sure the fault is legible (~ 0.02 px/IU minimum).
      const scale = Math.max(vp.scale, 0.002);
      viewportRef.current = { scale, offsetX: c.width / 2 - p.x * scale, offsetY: c.height / 2 - p.y * scale };
      draw();
    },
  }), [schematic, draw, zoomAbout]);

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

  useEffect(() => { draw(); }, [selection, draw]);
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
      wireAnchorRef.current = pendingWireStartRef.current;
      pendingWireStartRef.current = null;
    } else {
      wireAnchorRef.current = null;
    }
    placeOrientRef.current = { angle: 0 };
    // The wire/bus tools use KiCad's green wire cursor; everything else resets.
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = (activeTool === 'drawWire' || activeTool === 'drawBus') ? WIRE_CURSOR : 'default';
  }, [activeTool]);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current!;
    const vp = viewportRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * dpr();
    const py = (clientY - rect.top) * dpr();
    return { x: (px - vp.offsetX) / vp.scale, y: (py - vp.offsetY) / vp.scale };
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomAbout((e.clientX - rect.left) * dpr(), (e.clientY - rect.top) * dpr(), Math.exp(-e.deltaY * 0.001));
  }, [zoomAbout]);

  const commitWireSegment = useCallback((anchor: Vec2, end: Vec2, bus: boolean) => {
    const line = bus ? makeBus(anchor, end) : makeWire(anchor, end);
    const withLine = addItems({ lines: [line] }).apply(schematic);
    // Buses don't auto-junction (junctions are a wire/net concept in KiCad).
    const junctions = bus ? [] : [anchor, end]
      .filter((p) => needsJunction(withLine, p))
      .map((p) => makeJunction(p));
    onCommand(addItems({ lines: [line], junctions }));
  }, [schematic, onCommand]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const world = toWorld(e.clientX, e.clientY);

    // Middle-button drag pans, whatever the active tool (KiCad's pan button).
    if (e.button === 1) {
      (e.target as Element).setPointerCapture(e.pointerId);
      modeRef.current = 'pan';
      panLastRef.current = { x: e.clientX, y: e.clientY };
      panMovedRef.current = false;
      e.preventDefault();
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
      const bus = activeTool === 'drawBus';
      const anchor = wireAnchorRef.current;
      if (!anchor) { wireAnchorRef.current = wireEndPoint(null, world); } // start snaps to a pin/anchor
      else {
        const end = wireEndPoint(anchor, world);
        if (end.x !== anchor.x || end.y !== anchor.y) {
          commitWireSegment(anchor, end, bus);
          wireAnchorRef.current = end; // continue the chain
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
        onCommand(addItems({ labels: [makeLabel(pendingLabel.kind, pendingLabel.text, snap(world), { shape: pendingLabel.shape })] }));
      }
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
      if (placeLib) onCommand(placeSymbol(placeLib, snap(world), placeOrientRef.current)); // stays active to place more
      return;
    }

    if (activeTool !== 'select') return; // other tools not yet implemented

    // Auto-start a wire when clicking a dangling pin (KiCad's autostartEvent /
    // auto_start_wires): switch to the wire tool with this pin as the first anchor.
    const pin = danglingPinAt(world);
    if (pin && !e.shiftKey) {
      pendingWireStartRef.current = pin;
      onRequestTool?.('drawWire');
      return;
    }

    // select / move
    (e.target as Element).setPointerCapture(e.pointerId);
    const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
    const additive = e.shiftKey;
    if (hit) {
      const effSel: ReadonlySet<string> = additive
        ? new Set([...selection, hit.id])
        : selection.has(hit.id) ? selection : new Set([hit.id]);
      onSelect(hit.id, additive);
      modeRef.current = 'move';
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
      // Empty canvas: start a KiCad drag-box selection (left-to-right = window
      // select, right-to-left = greedy). A no-drag click clears the selection.
      (e.target as Element).setPointerCapture(e.pointerId);
      modeRef.current = 'box';
      boxOriginRef.current = world;
      boxEndRef.current = world;
      boxModifiersRef.current = {
        additive: (e.ctrlKey || e.shiftKey) && !e.altKey, // m_drag_additive
        subtractive: e.ctrlKey && e.shiftKey && !e.altKey, // m_drag_subtractive
      };
    }
  }, [activeTool, lineMode, placeLib, pendingLabel, pastePending, schematic, libById, selection, onSelect, onHighlight, onRequestTool, onPasteDone, danglingPinAt, onCommand, commitWireSegment, wireEndPoint, snapConn, draw]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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

    if (pendingLabel) { draw(); return; } // update the attached label ghost
    if (pastePending && modeRef.current !== 'pan') { draw(); return; } // pasted items track the cursor

    if (modeRef.current === 'box') {
      boxEndRef.current = world;
      draw();
      return;
    }

    if (activeTool === 'drawWire' || activeTool === 'drawBus') {
      if (wireAnchorRef.current) draw();
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
        const dx = a.x - cand.x, dy = a.y - cand.y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestDelta = { x: delta.x + dx, y: delta.y + dy }; }
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
    }
  }, [activeTool, placeLib, pendingLabel, pastePending, danglingPinAt, draw, onCursorMove]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // Middle-button pan ends regardless of the active tool.
    if (modeRef.current === 'pan' && e.button === 1) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      modeRef.current = 'idle';
      panLastRef.current = null;
      return;
    }
    if (activeTool !== 'select') return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    let committedMove = false;
    if (modeRef.current === 'move') {
      const d = moveDeltaRef.current;
      const spec = moveSpecRef.current;
      if (d && spec && (d.x !== 0 || d.y !== 0)) { onCommand(buildMove(spec, d)); committedMove = true; }
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
        onSelect(null, e.shiftKey);
      }
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
  }, [activeTool, schematic, libById, onCommand, buildMove, onSelect, onSelectBox, draw]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'drawWire' || activeTool === 'drawBus') { wireAnchorRef.current = null; draw(); return; }
    // Select tool: double-click opens the item's properties (KiCad binds mouse
    // double-click to SCH_ACTIONS::properties -> SCH_EDIT_TOOL::EditProperties).
    if (activeTool === 'select') {
      const vp = viewportRef.current;
      if (!vp) return;
      const hit = hitTest(schematic, libById, toWorld(e.clientX, e.clientY), (6 * dpr()) / vp.scale);
      if (hit) onEditItem?.(hit.id, hit.kind);
    }
  }, [activeTool, draw, schematic, libById, onEditItem]);

  // Escape ends an in-progress wire; R/X/Y rotate/mirror (KiCad hotkeys): the
  // attached symbol while placing, otherwise the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && wireAnchorRef.current) { wireAnchorRef.current = null; draw(); return; }

      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key.toLowerCase();
      const op: TransformOp | null = k === 'r' ? 'rotateCCW' : k === 'x' ? 'mirrorX' : k === 'y' ? 'mirrorY' : null;
      if (!op) return;

      if ((activeTool === 'placeSymbol' || activeTool === 'placePower') && placeLib) {
        // Advance the attached symbol's orientation in place.
        const o = placeOrientRef.current;
        placeOrientRef.current = op === 'rotateCCW' ? rotateOrientation(o)
          : op === 'mirrorX' ? mirrorOrientation(o, 'x') : mirrorOrientation(o, 'y');
        e.preventDefault();
        draw();
      } else if (selection.size > 0) {
        e.preventDefault();
        onCommand(transformItems(selection, op));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw, activeTool, placeLib, selection, onCommand]);

  const cursor = activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor, touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); if (activeTool === 'drawWire' || activeTool === 'drawBus') { wireAnchorRef.current = null; draw(); } }}
        onPointerLeave={() => { cursorRef.current = null; onCursorMove?.(null); }}
      />
      {/* Label placement uses a properties dialog (in App) and a cursor-attached ghost. */}
    </div>
  );
});
