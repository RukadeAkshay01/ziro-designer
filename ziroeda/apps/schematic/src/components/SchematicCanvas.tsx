import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback, useMemo } from 'react';
import {
  hitTest, planMove, moveWithConnections, orthoMove, addItems, deleteByIds, placeSymbol,
  makeWire, makeBus, makeJunction, makeLabel, needsJunction, rotateOrientation, mirrorOrientation, transformItems,
  collectAnchors, selectionAnchors, nearestAnchor, danglingPinPositions,
  type MoveSpec, type EditCommand, type Schematic, type LibSymbol, type Vec2, type Orientation, type TransformOp, type LabelKind, type LabelShape,
} from '@ziroeda/core';
import { renderSchematic, fitToContent, type Viewport } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

const GRID = 12700; // 1.27 mm (50 mil)
const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID });

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
  onCommand: (cmd: EditCommand) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
}

type Mode = 'idle' | 'pan' | 'move';

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  { schematic, libById, selection, activeTool, lineMode, placeLib, pendingLabel, highlight, onSelect, onHighlight, onRequestTool, onCommand, onCursorMove, onScaleChange },
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
    renderSchematic(ctx, doc, vp, KICAD_CLASSIC, canvas.width, canvas.height, selection, highlight);

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
  }, [schematic, selection, activeTool, lineMode, placeLib, pendingLabel, highlight, wireEndPoint, buildMove, onScaleChange]);

  const zoomAbout = useCallback((px: number, py: number, factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const wx = (px - vp.offsetX) / vp.scale;
    const wy = (py - vp.offsetY) / vp.scale;
    const scale = vp.scale * factor;
    viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
    draw();
  }, [draw]);

  useImperativeHandle(ref, (): CanvasController => ({
    zoomToFit: () => { const c = canvasRef.current; if (c) { viewportRef.current = fitToContent(schematic, c.width, c.height); draw(); } },
    zoomIn: () => { const c = canvasRef.current; if (c) zoomAbout(c.width / 2, c.height / 2, 1.25); },
    zoomOut: () => { const c = canvasRef.current; if (c) zoomAbout(c.width / 2, c.height / 2, 0.8); },
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
    if (!viewportRef.current) viewportRef.current = fitToContent(schematic, canvas.width, canvas.height);
    draw();
  }, [size, schematic, draw]);

  useEffect(() => { draw(); }, [selection, draw]);
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
      moveSpecRef.current = planMove(schematic, libById, effSel);
      movePointsRef.current = selectionAnchors(schematic, libById, effSel);
      moveAnchorsRef.current = collectAnchors(schematic, libById, effSel);
    } else {
      modeRef.current = 'pan';
      panLastRef.current = { x: e.clientX, y: e.clientY };
      panMovedRef.current = false;
    }
  }, [activeTool, lineMode, placeLib, pendingLabel, schematic, libById, selection, onSelect, onHighlight, onRequestTool, danglingPinAt, onCommand, commitWireSegment, wireEndPoint, snapConn, draw]);

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
      canvas.style.cursor = danglingPinAt(world) ? 'crosshair' : 'default';

    if (pendingLabel) { draw(); return; } // update the attached label ghost

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
  }, [activeTool, placeLib, pendingLabel, danglingPinAt, draw, onCursorMove]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (activeTool !== 'select') return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    let committedMove = false;
    if (modeRef.current === 'move') {
      const d = moveDeltaRef.current;
      const spec = moveSpecRef.current;
      if (d && spec && (d.x !== 0 || d.y !== 0)) { onCommand(buildMove(spec, d)); committedMove = true; }
    } else if (modeRef.current === 'pan' && !panMovedRef.current) {
      onSelect(null, e.shiftKey);
    }
    modeRef.current = 'idle';
    moveStartRef.current = null;
    moveDeltaRef.current = null;
    moveSpecRef.current = null;
    panLastRef.current = null;
    if (!committedMove) draw();
  }, [activeTool, onCommand, buildMove, onSelect, draw]);

  const onDoubleClick = useCallback(() => {
    if (activeTool === 'drawWire' || activeTool === 'drawBus') { wireAnchorRef.current = null; draw(); }
  }, [activeTool, draw]);

  // Escape ends an in-progress wire; R/X/Y rotate/mirror (KiCad hotkeys): the
  // attached symbol while placing, otherwise the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && wireAnchorRef.current) { wireAnchorRef.current = null; draw(); return; }

      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
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
