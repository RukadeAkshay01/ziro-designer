import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { hitTest, planMove, moveWithConnections, type MoveSpec, type Schematic, type LibSymbol, type Vec2 } from '@ziroeda/core';
import { renderSchematic, fitToContent, type Viewport } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

const GRID = 12700; // 1.27 mm (50 mil): selection moves snap to this, like KiCad.

export interface CanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface Props {
  schematic: Schematic;
  libById: Map<string, LibSymbol>;
  selection: ReadonlySet<string>;
  onSelect: (id: string | null, additive: boolean) => void;
  onMove: (spec: MoveSpec, delta: Vec2) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
}

type Mode = 'idle' | 'pan' | 'move';

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  { schematic, libById, selection, onSelect, onMove, onCursorMove, onScaleChange },
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

  const dpr = () => window.devicePixelRatio || 1;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const md = moveDeltaRef.current;
    const spec = moveSpecRef.current;
    const doc = modeRef.current === 'move' && md && spec ? moveWithConnections(spec, md).apply(schematic) : schematic;
    renderSchematic(ctx, doc, vp, KICAD_CLASSIC, canvas.width, canvas.height, selection);
    onScaleChange?.(vp.scale);
  }, [schematic, selection, onScaleChange]);

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
    zoomToFit: () => {
      const c = canvasRef.current;
      if (!c) return;
      viewportRef.current = fitToContent(schematic, c.width, c.height);
      draw();
    },
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

  // Redraw when selection changes (highlight) even without other interaction.
  useEffect(() => { draw(); }, [selection, draw]);

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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const world = toWorld(e.clientX, e.clientY);
    const acc = (6 * dpr()) / vp.scale;
    const hit = hitTest(schematic, libById, world, acc);
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
  }, [schematic, libById, selection, onSelect]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const world = toWorld(e.clientX, e.clientY);
    onCursorMove?.(world);

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
  }, [draw, onCursorMove]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    let committedMove = false;
    if (modeRef.current === 'move') {
      const d = moveDeltaRef.current;
      const spec = moveSpecRef.current;
      if (d && spec && (d.x !== 0 || d.y !== 0)) {
        onMove(spec, d);
        committedMove = true; // keep the last preview frame; the new doc redraws in place
      }
    } else if (modeRef.current === 'pan' && !panMovedRef.current) {
      onSelect(null, e.shiftKey); // click on empty space clears selection
    }
    modeRef.current = 'idle';
    moveStartRef.current = null;
    moveDeltaRef.current = null;
    moveSpecRef.current = null;
    panLastRef.current = null;
    if (!committedMove) draw();
  }, [onMove, onSelect, draw]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'default', touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => onCursorMove?.(null)}
      />
    </div>
  );
});
