/**
 * The Drawing Sheet Editor canvas — KiCad `pl_editor`'s PL_DRAW_PANEL_GAL in
 * Canvas 2D. It shows the page as white stationery on a grey desk, paints the
 * resolved drawing-sheet primitives (wksRender), and drives the interactive
 * tools: pan (middle drag / space), wheel zoom, click + box selection, drag to
 * move the selection, and the placement tools (line / rectangle need two clicks;
 * text / bitmap / append place at one click). A controller (zoomToFit / zoomIn /
 * zoomOut / redraw) is exposed via ref, like the other editors' canvases.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import { pickDrawItem, wksItemsInBox, wksItemBBox, type DsDrawItem } from '@ziroeda/common';
import { drawDrawingSheetItems, DS_BG_COLOR, DS_PAGE_COLOR } from './wksRender.js';
import { setBitmapInvalidate } from './wksBitmap.js';

const MM = 10000;

// KiCad shows a full crosshair as the editing cursor and a pencil while a draw
// tool is active (see the GAL cursor in pl_editor). A plain `crosshair` gives the
// "+"; this small pencil SVG gives the drawing cursor, hot-spot at its tip.
const PENCIL_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<path d='M3.5 20.5l3.2-1 11-11-2.2-2.2-11 11z' fill='#ffd54a' stroke='#1b1b1b' stroke-width='1'/>" +
  "<path d='M14.8 5.1l2.2 2.2 1.9-1.9a1.3 1.3 0 0 0 0-1.9l-.3-.3a1.3 1.3 0 0 0-1.9 0z' fill='#c8322d' stroke='#1b1b1b' stroke-width='1'/>" +
  "<path d='M3.5 20.5l1.1-2.9 1.8 1.1z' fill='#1b1b1b'/></svg>";
const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}") 3 21, crosshair`;

export interface DrawingSheetCanvasController {
  zoomToFit: () => void;
  zoomToSelection: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  redraw: () => void;
}

export interface DrawingSheetCanvasProps {
  draws: DsDrawItem[];
  /** Page size in IU. */
  pageW: number;
  pageH: number;
  selection: ReadonlySet<number>;
  activeTool: string;
  showGrid: boolean;
  /** Grid step in IU. */
  gridIU: number;
  /** Draw a full-window crosshair at the cursor (pl_editor's "Full window crosshair"). */
  fullCrosshair?: boolean;
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  onSelect?: (src: number | null, additive: boolean) => void;
  onSelectBox?: (srcs: number[], additive: boolean) => void;
  onMoveItems?: (deltaIU: Vec2) => void;
  /** A single-click placement (text / bitmap / append). */
  onPlacePoint?: (tool: string, atIU: Vec2) => void;
  /** A two-click placement (line / rectangle). */
  onPlaceSegment?: (tool: string, aIU: Vec2, bIU: Vec2) => void;
}

const TWO_CLICK = new Set(['dsAddLine', 'dsAddRect']);
const ONE_CLICK = new Set(['dsAddText', 'dsAddBitmap', 'appendSheet']);

export const DrawingSheetCanvas = forwardRef<DrawingSheetCanvasController, DrawingSheetCanvasProps>(
  function DrawingSheetCanvas(props, ref) {
    const {
      draws,
      pageW,
      pageH,
      selection,
      activeTool,
      showGrid,
      gridIU,
      fullCrosshair,
      onCursorMove,
      onScaleChange,
      onSelect,
      onSelectBox,
      onMoveItems,
      onPlacePoint,
      onPlaceSegment,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef({ scale: 0.02, tx: 0, ty: 0 });
    const rafRef = useRef(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const [, setScaleState] = useState(0);

    // Mutable state read by draw() without a re-render.
    const drawsRef = useRef(draws);
    drawsRef.current = draws;
    const selRef = useRef(selection);
    selRef.current = selection;
    const moveDeltaRef = useRef<Vec2 | null>(null);
    const boxRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    const firstPtRef = useRef<Vec2 | null>(null);
    const hoverRef = useRef<Vec2 | null>(null);
    const cursorPxRef = useRef<{ x: number; y: number } | null>(null);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = DS_BG_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // World transform (IU → device px).
      ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);

      // Page with a soft drop shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(3 * MM, 3 * MM, pageW, pageH);
      ctx.fillStyle = DS_PAGE_COLOR;
      ctx.fillRect(0, 0, pageW, pageH);

      const worldPen = 1 / v.scale; // 1 device px in world units

      // KiCad's GAL draws the grid as dots (a "grained" look), not lines.
      if (showGrid && gridIU > 0 && gridIU * v.scale >= 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        const r = Math.max(worldPen * 0.9, gridIU * 0.02); // ~1.8 device-px dot
        const d = r * 2;
        for (let x = 0; x <= pageW + 1; x += gridIU) {
          for (let y = 0; y <= pageH + 1; y += gridIU) ctx.fillRect(x - r, y - r, d, d);
        }
      }

      // Clip page content to the page rectangle, like KiCad.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pageW, pageH);
      ctx.clip();
      drawDrawingSheetItems(ctx, drawsRef.current, selRef.current, { minWidth: worldPen });
      ctx.restore();

      // ---- overlays (device space) ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

      // Selection outlines (dashed), offset by an in-flight move delta.
      const md = moveDeltaRef.current;
      if (selRef.current.size > 0) {
        ctx.strokeStyle = '#4aa3ff';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([5 * dpr, 3 * dpr]);
        const ox = md ? md.x : 0,
          oy = md ? md.y : 0;
        for (const src of selRef.current) {
          const b = wksItemBBox(drawsRef.current, src);
          if (!b) continue;
          const p0 = toPx({ x: b.minX + ox, y: b.minY + oy });
          const p1 = toPx({ x: b.maxX + ox, y: b.maxY + oy });
          const pad = 2 * dpr;
          ctx.strokeRect(
            Math.min(p0.x, p1.x) - pad,
            Math.min(p0.y, p1.y) - pad,
            Math.abs(p1.x - p0.x) + 2 * pad,
            Math.abs(p1.y - p0.y) + 2 * pad,
          );
        }
        ctx.setLineDash([]);
      }

      // Box-select marquee.
      const box = boxRef.current;
      if (box) {
        const p0 = toPx(box.a),
          p1 = toPx(box.b);
        const rightward = box.b.x >= box.a.x;
        ctx.strokeStyle = rightward ? 'rgba(120,170,255,0.9)' : 'rgba(120,255,150,0.9)';
        ctx.fillStyle = rightward ? 'rgba(120,170,255,0.12)' : 'rgba(120,255,150,0.12)';
        ctx.lineWidth = dpr;
        const x = Math.min(p0.x, p1.x),
          y = Math.min(p0.y, p1.y);
        ctx.fillRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        ctx.strokeRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      }

      // Two-click placement rubber band.
      const fp = firstPtRef.current;
      const hv = hoverRef.current;
      if (fp && hv) {
        const p0 = toPx(fp),
          p1 = toPx(hv);
        ctx.strokeStyle = '#c8322d';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        if (activeTool === 'dsAddRect') {
          ctx.strokeRect(
            Math.min(p0.x, p1.x),
            Math.min(p0.y, p1.y),
            Math.abs(p1.x - p0.x),
            Math.abs(p1.y - p0.y),
          );
        } else {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Full-window crosshair at the cursor (pl_editor "Full window crosshair").
      const cp = cursorPxRef.current;
      if (fullCrosshair && cp) {
        ctx.strokeStyle = 'rgba(90,160,255,0.55)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(cp.x, 0);
        ctx.lineTo(cp.x, canvas.height);
        ctx.moveTo(0, cp.y);
        ctx.lineTo(canvas.width, cp.y);
        ctx.stroke();
      }

      setScaleState(v.scale);
      onScaleChange?.(v.scale);
    }, [pageW, pageH, showGrid, gridIU, activeTool, dpr, fullCrosshair, onScaleChange]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    useEffect(() => {
      requestDraw();
    }, [draws, selection, requestDraw]);

    // Redraw when an async bitmap decode finishes.
    useEffect(() => {
      setBitmapInvalidate(requestDraw);
      return () => setBitmapInvalidate(null);
    }, [requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const margin = 12 * MM;
      const s = Math.min(canvas.width / (pageW + margin * 2), canvas.height / (pageH + margin * 2));
      viewRef.current = {
        scale: s > 0 && Number.isFinite(s) ? s : 0.02,
        tx: canvas.width / 2 - (pageW / 2) * s,
        ty: canvas.height / 2 - (pageH / 2) * s,
      };
      requestDraw();
    }, [pageW, pageH, requestDraw]);

    // Zoom to fit the current selection (pl_editor "Zoom to Selection").
    const zoomToSelection = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
      for (const src of selRef.current) {
        const b = wksItemBBox(drawsRef.current, src);
        if (!b) continue;
        box = box
          ? {
              minX: Math.min(box.minX, b.minX),
              minY: Math.min(box.minY, b.minY),
              maxX: Math.max(box.maxX, b.maxX),
              maxY: Math.max(box.maxY, b.maxY),
            }
          : b;
      }
      if (!box) return;
      const margin = 6 * MM;
      const bw = box.maxX - box.minX + margin * 2;
      const bh = box.maxY - box.minY + margin * 2;
      const s = Math.min(canvas.width / Math.max(bw, 1), canvas.height / Math.max(bh, 1));
      const cx = (box.minX + box.maxX) / 2,
        cy = (box.minY + box.maxY) / 2;
      viewRef.current = {
        scale: s > 0 && Number.isFinite(s) ? s : viewRef.current.scale,
        tx: canvas.width / 2 - cx * s,
        ty: canvas.height / 2 - cy * s,
      };
      requestDraw();
    }, [requestDraw]);

    const zoomStep = useCallback(
      (factor: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const px = canvas.width / 2,
          py = canvas.height / 2;
        const wx = (px - v.tx) / v.scale,
          wy = (py - v.ty) / v.scale;
        v.scale *= factor;
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      },
      [requestDraw],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit,
        zoomToSelection,
        zoomIn: () => zoomStep(1.3),
        zoomOut: () => zoomStep(1 / 1.3),
        redraw: () => requestDraw(),
      }),
      [zoomToFit, zoomToSelection, zoomStep, requestDraw],
    );

    // Size to container; fit on first layout.
    const fittedRef = useRef(false);
    useEffect(() => {
      const wrap = wrapRef.current,
        canvas = canvasRef.current;
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

    // Wheel zoom about the cursor.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const v = viewRef.current;
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * dpr,
          py = (e.clientY - rect.top) * dpr;
        const wx = (px - v.tx) / v.scale,
          wy = (py - v.ty) / v.scale;
        v.scale *= factor;
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [dpr, requestDraw]);

    const worldAt = (clientX: number, clientY: number): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / v.scale,
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    };

    const gestureRef = useRef<
      | { mode: 'pan'; last: { x: number; y: number } }
      | { mode: 'box'; start: Vec2; additive: boolean }
      | { mode: 'move'; start: Vec2; moved: boolean }
      | null
    >(null);

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = worldAt(e.clientX, e.clientY);

      // Middle button always pans.
      if (e.button === 1) {
        gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
        return;
      }
      if (e.button !== 0) return;

      // Placement tools.
      if (TWO_CLICK.has(activeTool)) {
        if (!firstPtRef.current) {
          firstPtRef.current = world;
          hoverRef.current = world;
        } else {
          onPlaceSegment?.(activeTool, firstPtRef.current, world);
          firstPtRef.current = null;
          hoverRef.current = null;
        }
        requestDraw();
        return;
      }
      if (ONE_CLICK.has(activeTool)) {
        onPlacePoint?.(activeTool, world);
        return;
      }

      // Select tool: pick / move / box.
      const tol = (6 * dpr) / viewRef.current.scale;
      const hit = pickDrawItem(drawsRef.current, world, tol);
      const additive = e.shiftKey;
      if (hit !== null) {
        if (!selRef.current.has(hit)) onSelect?.(hit, additive);
        gestureRef.current = { mode: 'move', start: world, moved: false };
      } else {
        if (!additive) onSelect?.(null, false);
        gestureRef.current = { mode: 'box', start: world, additive };
      }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
      const world = worldAt(e.clientX, e.clientY);
      onCursorMove?.(world);
      const rect = canvasRef.current!.getBoundingClientRect();
      cursorPxRef.current = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
      if (fullCrosshair) requestDraw();
      if (firstPtRef.current) {
        hoverRef.current = world;
        requestDraw();
      }
      const g = gestureRef.current;
      if (!g) return;
      if (g.mode === 'pan') {
        const v = viewRef.current;
        v.tx += (e.clientX - g.last.x) * dpr;
        v.ty += (e.clientY - g.last.y) * dpr;
        g.last = { x: e.clientX, y: e.clientY };
        requestDraw();
      } else if (g.mode === 'box') {
        boxRef.current = { a: g.start, b: world };
        requestDraw();
      } else {
        moveDeltaRef.current = { x: world.x - g.start.x, y: world.y - g.start.y };
        g.moved = true;
        requestDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent): void => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.mode === 'box') {
        const b = boxRef.current;
        boxRef.current = null;
        if (b) {
          const srcs = wksItemsInBox(drawsRef.current, b.a.x, b.a.y, b.b.x, b.b.y);
          if (srcs.length > 0) onSelectBox?.(srcs, g.additive);
        }
        requestDraw();
      } else if (g.mode === 'move') {
        const d = moveDeltaRef.current;
        moveDeltaRef.current = null;
        if (g.moved && d && (d.x !== 0 || d.y !== 0)) onMoveItems?.(d);
        else if (!g.moved) {
          const world = worldAt(e.clientX, e.clientY);
          const tol = (6 * dpr) / viewRef.current.scale;
          const hit = pickDrawItem(drawsRef.current, world, tol);
          if (hit !== null && !e.shiftKey) onSelect?.(hit, false);
        }
        requestDraw();
      }
    };

    // Cancel an in-progress two-click placement on Escape (handled by the frame,
    // but clear our local rubber band when the tool changes).
    useEffect(() => {
      firstPtRef.current = null;
      hoverRef.current = null;
      requestDraw();
    }, [activeTool, requestDraw]);

    // Pencil while a draw tool is active; a "+" crosshair otherwise (KiCad's cursor).
    const placing = TWO_CLICK.has(activeTool) || ONE_CLICK.has(activeTool);
    const cursor = placing ? PENCIL_CURSOR : 'crosshair';
    return (
      <div
        className="ze-canvas-wrap"
        ref={wrapRef}
        style={{ position: 'relative', flex: 1, minWidth: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            onCursorMove?.(null);
            cursorPxRef.current = null;
            if (fullCrosshair) requestDraw();
          }}
        />
      </div>
    );
  },
);
