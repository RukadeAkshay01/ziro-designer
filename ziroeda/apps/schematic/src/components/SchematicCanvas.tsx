import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import type { Schematic } from '@ziroeda/core';
import { renderSchematic, fitToContent, type Viewport } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

export interface CanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface Props {
  schematic: Schematic;
  /** Cursor position in world internal units, or null when off-canvas. */
  onCursorMove?: (world: { x: number; y: number } | null) => void;
  onScaleChange?: (scale: number) => void;
}

/** A pannable/zoomable canvas that renders a schematic. */
export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  { schematic, onCursorMove, onScaleChange },
  ref,
): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderSchematic(ctx, schematic, vp, KICAD_CLASSIC, canvas.width, canvas.height);
    onScaleChange?.(vp.scale);
  }, [schematic, onScaleChange]);

  const zoomAbout = useCallback((px: number, py: number, factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const worldX = (px - vp.offsetX) / vp.scale;
    const worldY = (py - vp.offsetY) / vp.scale;
    const scale = vp.scale * factor;
    viewportRef.current = { scale, offsetX: px - worldX * scale, offsetY: py - worldY * scale };
    draw();
  }, [draw]);

  useImperativeHandle(ref, (): CanvasController => ({
    zoomToFit: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      viewportRef.current = fitToContent(schematic, canvas.width, canvas.height);
      draw();
    },
    zoomIn: () => {
      const c = canvasRef.current;
      if (c) zoomAbout(c.width / 2, c.height / 2, 1.25);
    },
    zoomOut: () => {
      const c = canvasRef.current;
      if (c) zoomAbout(c.width / 2, c.height / 2, 0.8);
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
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    if (!viewportRef.current) viewportRef.current = fitToContent(schematic, canvas.width, canvas.height);
    draw();
  }, [size, schematic, draw]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    zoomAbout((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr, Math.exp(-e.deltaY * 0.001));
  }, [zoomAbout]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    const canvas = canvasRef.current;
    if (!vp || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const drag = dragRef.current;
    if (drag) {
      viewportRef.current = {
        ...vp,
        offsetX: vp.offsetX + (e.clientX - drag.x) * dpr,
        offsetY: vp.offsetY + (e.clientY - drag.y) * dpr,
      };
      dragRef.current = { x: e.clientX, y: e.clientY };
      draw();
    }
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
    onCursorMove?.({ x: (px - viewportRef.current!.offsetX) / viewportRef.current!.scale, y: (py - viewportRef.current!.offsetY) / viewportRef.current!.scale });
  }, [draw, onCursorMove]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => onCursorMove?.(null)}
      />
    </div>
  );
});
