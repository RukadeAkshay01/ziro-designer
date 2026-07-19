/**
 * The Gerber Viewer canvas — GerbView's GERBVIEW_DRAW_PANEL_GAL plus its
 * interactive tools in Canvas 2D. It renders the composited layers
 * (gerberRender), tracks the cursor for the coordinate readout, supports
 * pan (middle/right drag or space-drag), wheel zoom about the cursor, the
 * measure tool (two clicks → distance + dx/dy overlay, matching
 * GERBVIEW_CONTROL::MeasureTool), and click-to-inspect item picking. A
 * controller (zoom / redraw) is exposed via ref like the other editors.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import type { GERBER_DRAW_ITEM } from '@ziroeda/gerbview';
import {
  renderGerberLayers,
  worldToDevice,
  deviceToWorld,
  type GerberLayerView,
  type GerberRenderOptions,
  type ViewTransform,
} from './gerberRender.js';
import { GERBER_GRID_COLOR } from './gerberColors.js';

export interface GerberCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  redraw: () => void;
}

export interface GerberCanvasProps {
  /** Layers bottom-to-top; active layer last (drawn on top). */
  layers: GerberLayerView[];
  options: GerberRenderOptions;
  /** Bounding box of visible content (IU) for zoom-to-fit. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  showGrid: boolean;
  gridIU: number;
  fullCrosshair: boolean;
  activeTool: 'select' | 'measure';
  /** Report the cursor world position (IU) for the status bar. */
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Report the measured segment (IU) live while measuring. */
  onMeasure?: (m: { a: Vec2; b: Vec2 } | null) => void;
  /** Report the picked item under a select-click (or null). */
  onPick?: (item: GERBER_DRAW_ITEM | null, at: Vec2) => void;
}

export const GerberCanvas = forwardRef<GerberCanvasController, GerberCanvasProps>(
  function GerberCanvas(props, ref) {
    const {
      layers,
      options,
      bbox,
      showGrid,
      gridIU,
      fullCrosshair,
      activeTool,
      onCursorMove,
      onScaleChange,
      onMeasure,
      onPick,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewTransform>({ scale: 0.0005, tx: 0, ty: 0 });
    const rafRef = useRef(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const layersRef = useRef(layers);
    layersRef.current = layers;
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const gridRef = useRef({ showGrid, gridIU });
    gridRef.current = { showGrid, gridIU };
    const crosshairRef = useRef(fullCrosshair);
    crosshairRef.current = fullCrosshair;

    const cursorPxRef = useRef<{ x: number; y: number } | null>(null);
    const measureRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    const measuringRef = useRef(false);

    /** Device px → world IU (accounting for flip). */
    const toWorld = useCallback(
      (px: number, py: number): Vec2 =>
        deviceToWorld(viewRef.current, optionsRef.current.flipView, px, py),
      [],
    );

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;
      const opts = optionsRef.current;

      renderGerberLayers(ctx, canvas.width, canvas.height, v, layersRef.current, opts);

      const flip = opts.flipView;
      const worldToPx = (p: Vec2): { x: number; y: number } => worldToDevice(v, flip, p.x, p.y);

      // Grid dots.
      const { showGrid: sg, gridIU: g } = gridRef.current;
      if (sg && g > 0 && g * v.scale >= 6) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = GERBER_GRID_COLOR;
        const originPx = worldToPx({ x: 0, y: 0 });
        const stepPx = g * v.scale;
        const startX = originPx.x - Math.ceil(originPx.x / stepPx) * stepPx;
        const startY = originPx.y - Math.ceil(originPx.y / stepPx) * stepPx;
        for (let x = startX; x <= canvas.width; x += stepPx) {
          for (let y = startY; y <= canvas.height; y += stepPx) {
            ctx.fillRect(x - dpr * 0.5, y - dpr * 0.5, dpr, dpr);
          }
        }
      }

      // Measure overlay.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const m = measureRef.current;
      if (m) {
        const p0 = worldToPx(m.a);
        const p1 = worldToPx(m.b);
        ctx.strokeStyle = '#ffd54a';
        ctx.fillStyle = '#ffd54a';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of [p0, p1]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Full-window crosshair.
      const cp = cursorPxRef.current;
      if (crosshairRef.current && cp) {
        ctx.strokeStyle = 'rgba(120,180,255,0.5)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(cp.x, 0);
        ctx.lineTo(cp.x, canvas.height);
        ctx.moveTo(0, cp.y);
        ctx.lineTo(canvas.width, cp.y);
        ctx.stroke();
      }

      onScaleChange?.(v.scale);
    }, [dpr, onScaleChange]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    useEffect(() => {
      requestDraw();
    }, [layers, options, showGrid, gridIU, fullCrosshair, requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = bbox.maxX - bbox.minX;
      const h = bbox.maxY - bbox.minY;
      if (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h)) {
        viewRef.current = { scale: 0.0005, tx: canvas.width / 2, ty: canvas.height / 2 };
        requestDraw();
        return;
      }
      const margin = 1.1;
      const s = Math.min(canvas.width / (w * margin), canvas.height / (h * margin));
      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      const flip = optionsRef.current.flipView;
      const sx = flip ? -s : s;
      viewRef.current = {
        scale: s,
        tx: canvas.width / 2 - sx * cx,
        ty: canvas.height / 2 + s * cy, // sy = -s
      };
      requestDraw();
    }, [bbox, requestDraw]);

    const zoomStep = useCallback(
      (factor: number, aboutPx?: { x: number; y: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const px = aboutPx?.x ?? canvas.width / 2;
        const py = aboutPx?.y ?? canvas.height / 2;
        const flip = optionsRef.current.flipView;
        // Keep the world point under (px,py) fixed across the zoom.
        const w = deviceToWorld(v, flip, px, py);
        v.scale *= factor;
        const sx = flip ? -v.scale : v.scale;
        v.tx = px - sx * w.x;
        v.ty = py + v.scale * w.y; // sy = -scale
        requestDraw();
      },
      [requestDraw],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit,
        zoomIn: () => zoomStep(1.3),
        zoomOut: () => zoomStep(1 / 1.3),
        redraw: () => requestDraw(),
      }),
      [zoomToFit, zoomStep, requestDraw],
    );

    // Size to container; fit on first layout.
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
        if (!fittedRef.current) {
          fittedRef.current = true;
          zoomToFit();
        } else requestDraw();
      });
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [dpr, requestDraw, zoomToFit]);

    // When "flip view" toggles, mirror the pan about the canvas centre so the
    // content stays put instead of sliding off-screen (GerbView keeps the board
    // centred across a flip). tx' = canvasW - tx makes the world point at the
    // canvas centre invariant under the x-scale sign change.
    const prevFlipRef = useRef(options.flipView);
    useEffect(() => {
      if (prevFlipRef.current !== options.flipView) {
        prevFlipRef.current = options.flipView;
        const canvas = canvasRef.current;
        if (canvas) {
          viewRef.current.tx = canvas.width - viewRef.current.tx;
          requestDraw();
        }
      }
    }, [options.flipView, requestDraw]);

    // Re-fit when the first content arrives.
    const hadContentRef = useRef(false);
    useEffect(() => {
      const has = layers.some((l) => l.image.items.length > 0);
      if (has && !hadContentRef.current) {
        hadContentRef.current = true;
        zoomToFit();
      }
      if (!has) hadContentRef.current = false;
    }, [layers, zoomToFit]);

    // Wheel zoom about the cursor.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * dpr;
        const py = (e.clientY - rect.top) * dpr;
        zoomStep(e.deltaY < 0 ? 1.2 : 1 / 1.2, { x: px, y: py });
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [dpr, zoomStep]);

    // Pointer interactions: pan, measure, pick.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const pxOf = (e: PointerEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
      };

      const onDown = (e: PointerEvent): void => {
        canvas.setPointerCapture(e.pointerId);
        const p = pxOf(e);
        // Middle / right button, or space-drag → pan.
        if (e.button === 1 || e.button === 2) {
          panRef.current = { x: p.x, y: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty };
          return;
        }
        if (e.button !== 0) return;
        const world = toWorld(p.x, p.y);
        if (activeTool === 'measure') {
          if (!measuringRef.current) {
            measuringRef.current = true;
            measureRef.current = { a: world, b: world };
          } else {
            measuringRef.current = false;
            measureRef.current = { a: measureRef.current!.a, b: world };
            onMeasure?.(measureRef.current);
          }
          requestDraw();
        } else {
          // Select: pick the topmost item under the cursor.
          const tol = 3 / viewRef.current.scale;
          let picked: GERBER_DRAW_ITEM | null = null;
          outer: for (let li = layersRef.current.length - 1; li >= 0; li--) {
            const layer = layersRef.current[li]!;
            if (!layer.visible) continue;
            const items = layer.image.items;
            for (let k = items.length - 1; k >= 0; k--) {
              if (items[k]!.hitTest(world, tol)) {
                picked = items[k]!;
                break outer;
              }
            }
          }
          onPick?.(picked, world);
        }
      };

      const onMove = (e: PointerEvent): void => {
        const p = pxOf(e);
        cursorPxRef.current = p;
        const world = toWorld(p.x, p.y);
        onCursorMove?.(world);
        if (panRef.current) {
          viewRef.current.tx = panRef.current.tx + (p.x - panRef.current.x);
          viewRef.current.ty = panRef.current.ty + (p.y - panRef.current.y);
          requestDraw();
          return;
        }
        if (measuringRef.current && measureRef.current) {
          measureRef.current = { a: measureRef.current.a, b: world };
          onMeasure?.(measureRef.current);
          requestDraw();
        } else if (crosshairRef.current) {
          requestDraw();
        }
      };

      const onUp = (e: PointerEvent): void => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        panRef.current = null;
      };

      const onLeave = (): void => {
        cursorPxRef.current = null;
        onCursorMove?.(null);
        requestDraw();
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      return () => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointerleave', onLeave);
      };
    }, [activeTool, dpr, requestDraw, toWorld, onCursorMove, onMeasure, onPick]);

    // Escape cancels an in-flight measurement.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && measuringRef.current) {
          measuringRef.current = false;
          measureRef.current = null;
          onMeasure?.(null);
          requestDraw();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onMeasure, requestDraw]);

    // Reset measurement when the tool changes away from measure.
    useEffect(() => {
      if (activeTool !== 'measure') {
        measuringRef.current = false;
        measureRef.current = null;
        onMeasure?.(null);
        requestDraw();
      }
    }, [activeTool, onMeasure, requestDraw]);

    return (
      <div
        ref={wrapRef}
        className="ze-canvas-wrap"
        style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            cursor: activeTool === 'measure' ? 'crosshair' : 'default',
          }}
        />
      </div>
    );
  },
);
