import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import {
  hitTest, planMove, moveWithConnections, orthoMove, addItems, deleteByIds, placeSymbol,
  makeWire, makeJunction, needsJunction,
  type MoveSpec, type EditCommand, type Schematic, type LibSymbol, type Vec2,
} from '@ziroeda/core';
import { renderSchematic, fitToContent, type Viewport } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

const GRID = 12700; // 1.27 mm (50 mil)
const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID });

export type LineMode = 'free' | '90' | '45';

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
  onSelect: (id: string | null, additive: boolean) => void;
  onCommand: (cmd: EditCommand) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
}

type Mode = 'idle' | 'pan' | 'move';

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  { schematic, libById, selection, activeTool, lineMode, placeLib, onSelect, onCommand, onCursorMove, onScaleChange },
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

  // Wire-drawing state.
  const wireAnchorRef = useRef<Vec2 | null>(null);
  const cursorRef = useRef<Vec2 | null>(null);

  const dpr = () => window.devicePixelRatio || 1;

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
    } else if (activeTool === 'placeSymbol' && placeLib && cursorRef.current) {
      // Ghost: show the symbol attached to the cursor before it is placed.
      doc = placeSymbol(placeLib, snap(cursorRef.current)).apply(schematic);
    }
    renderSchematic(ctx, doc, vp, KICAD_CLASSIC, canvas.width, canvas.height, selection);

    // Wire preview segment.
    const anchor = wireAnchorRef.current;
    const cur = cursorRef.current;
    if (activeTool === 'drawWire' && anchor && cur) {
      const end = constrain(anchor, snap(cur), lineMode);
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = KICAD_CLASSIC.wire;
      ctx.lineWidth = 0.1524 * GRID / 1.27; // ~6 mil
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    onScaleChange?.(vp.scale);
  }, [schematic, selection, activeTool, lineMode, placeLib, buildMove, onScaleChange]);

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
  // Cancel an in-progress wire only when the tool actually changes (not on every
  // schematic update, which would break the multi-segment chain).
  useEffect(() => { wireAnchorRef.current = null; }, [activeTool]);

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

  const commitWireSegment = useCallback((anchor: Vec2, end: Vec2) => {
    const wire = makeWire(anchor, end);
    const withWire = addItems({ lines: [wire] }).apply(schematic);
    const junctions = [anchor, end]
      .filter((p) => needsJunction(withWire, p))
      .map((p) => makeJunction(p));
    onCommand(addItems({ lines: [wire], junctions }));
  }, [schematic, onCommand]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const world = toWorld(e.clientX, e.clientY);

    if (activeTool === 'drawWire') {
      const pt = snap(world);
      const anchor = wireAnchorRef.current;
      if (!anchor) { wireAnchorRef.current = pt; }
      else {
        const end = constrain(anchor, pt, lineMode);
        if (end.x !== anchor.x || end.y !== anchor.y) {
          commitWireSegment(anchor, end);
          wireAnchorRef.current = end; // continue the chain
        }
      }
      draw();
      return;
    }

    if (activeTool === 'delete') {
      const hit = hitTest(schematic, libById, world, (6 * dpr()) / vp.scale);
      if (hit) onCommand(deleteByIds(new Set([hit.id])));
      return;
    }

    if (activeTool === 'placeSymbol') {
      if (placeLib) onCommand(placeSymbol(placeLib, snap(world))); // stays active to place more
      return;
    }

    if (activeTool !== 'select') return; // other tools not yet implemented

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
    } else {
      modeRef.current = 'pan';
      panLastRef.current = { x: e.clientX, y: e.clientY };
      panMovedRef.current = false;
    }
  }, [activeTool, lineMode, placeLib, schematic, libById, selection, onSelect, onCommand, commitWireSegment, draw]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const world = toWorld(e.clientX, e.clientY);
    cursorRef.current = world;
    onCursorMove?.(world);

    if (activeTool === 'drawWire') {
      if (wireAnchorRef.current) draw();
      return;
    }
    if (activeTool === 'placeSymbol') {
      if (placeLib) draw(); // update the attached ghost
      return;
    }
    if (modeRef.current === 'move' && moveStartRef.current) {
      const raw = { x: world.x - moveStartRef.current.x, y: world.y - moveStartRef.current.y };
      moveDeltaRef.current = { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID };
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
  }, [activeTool, placeLib, draw, onCursorMove]);

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
    if (activeTool === 'drawWire') { wireAnchorRef.current = null; draw(); }
  }, [activeTool, draw]);

  // Escape ends an in-progress wire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && wireAnchorRef.current) { wireAnchorRef.current = null; draw(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw]);

  const cursor = activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor, touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); if (activeTool === 'drawWire') { wireAnchorRef.current = null; draw(); } }}
        onPointerLeave={() => { cursorRef.current = null; onCursorMove?.(null); }}
      />
    </div>
  );
});
