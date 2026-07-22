/**
 * The Drawing Sheet Editor canvas — `pl_editor`'s PL_DRAW_PANEL_GAL plus its
 * interactive tools in Canvas 2D. It shows the page as white stationery on the
 * desk, paints the resolved drawing-sheet primitives (wksRender), and drives
 * the tool interactions the way the upstream tools do:
 *
 *  - selection tool: click select / shift-click add, drag-move the selection,
 *    box select, all with grid snapping of the tool cursor;
 *  - drawing tools (line / rect): first click creates the real item at the
 *    cursor, motion drags its end point live, the second click finishes it and
 *    hands the item to the point editor; Escape cancels the in-flight item but
 *    keeps the tool; the tool stays active for repeated placements;
 *  - one-click tools (text / bitmap): place at the click and stay active;
 *  - point editor: a single selected line/rect exposes draggable end/corner
 *    handles;
 *  - move mode (M): the selection travels with the cursor, click drops it;
 *  - interactive delete: the hovered item is brightened green, click deletes.
 *
 * A controller (zoom / redraw) is exposed via ref, like the other editors.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import { pickDrawItem, wksItemsInBox, wksItemBBox, type DsDrawItem } from '@ziroeda/common';
import {
  drawDrawingSheetItems,
  DS_BG_COLOR,
  DS_BG_COLOR_DARK,
  DS_PAGE_COLOR,
  DS_HILITE_COLOR,
} from './wksRender.js';
import { setBitmapInvalidate } from './wksBitmap.js';

const MM = 10000;

// A pencil cursor for the drawing tools (KICURSOR::PENCIL) and a "remove"
// cursor for the interactive delete picker (KICURSOR::REMOVE).
const PENCIL_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<path d='M3.5 20.5l3.2-1 11-11-2.2-2.2-11 11z' fill='#ffd54a' stroke='#1b1b1b' stroke-width='1'/>" +
  "<path d='M14.8 5.1l2.2 2.2 1.9-1.9a1.3 1.3 0 0 0 0-1.9l-.3-.3a1.3 1.3 0 0 0-1.9 0z' fill='#c8322d' stroke='#1b1b1b' stroke-width='1'/>" +
  "<path d='M3.5 20.5l1.1-2.9 1.8 1.1z' fill='#1b1b1b'/></svg>";
const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}") 3 21, crosshair`;
const REMOVE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<path d='M5 5l14 14M19 5L5 19' stroke='#e33' stroke-width='3' stroke-linecap='round'/></svg>";
const REMOVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(REMOVE_SVG)}") 12 12, not-allowed`;

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
  /** Grid step in IU (also the snap step while the grid is shown). */
  gridIU: number;
  /** Draw a full-window crosshair at the cursor. */
  fullCrosshair?: boolean;
  /** Dark canvas background (display option `black_background`). */
  blackBackground?: boolean;
  /** Endpoint/corner handles of the point editor (page IU), or empty. */
  editPoints?: Vec2[];
  /** Move mode (M): selection travels with the cursor until dropped. */
  moveMode?: boolean;
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  onSelect?: (src: number | null, additive: boolean) => void;
  onSelectBox?: (srcs: number[], additive: boolean) => void;
  onMoveItems?: (deltaIU: Vec2) => void;
  /** One-click placement (text / bitmap). */
  onPlacePoint?: (tool: string, atIU: Vec2) => void;
  /** Two-click drawing: create the item, drag its end live, finish it. */
  onDrawFirst?: (tool: string, atIU: Vec2) => void;
  onDrawMove?: (atIU: Vec2) => void;
  onDrawSecond?: (atIU: Vec2) => void;
  /** Interactive delete picker. */
  onDeleteHover?: (src: number | null) => void;
  onDeleteClick?: (src: number) => void;
  /** Point editor: drag handle `index` to a new page position. */
  onPointDrag?: (index: number, atIU: Vec2) => void;
  onPointDragEnd?: () => void;
  /** Space bar: set the dx/dy local origin to the cursor. */
  onSetLocalOrigin?: (atIU: Vec2) => void;
  /** Move mode drop: commit the delta and leave move mode. */
  onMoveDrop?: (deltaIU: Vec2) => void;
}

const TWO_CLICK = new Set(['dsAddLine', 'dsAddRect']);
const ONE_CLICK = new Set(['dsAddText', 'dsAddBitmap']);

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
      blackBackground,
      editPoints,
      moveMode,
      onCursorMove,
      onScaleChange,
      onSelect,
      onSelectBox,
      onMoveItems,
      onPlacePoint,
      onDrawFirst,
      onDrawMove,
      onDrawSecond,
      onDeleteHover,
      onDeleteClick,
      onPointDrag,
      onPointDragEnd,
      onSetLocalOrigin,
      onMoveDrop,
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
    const editPointsRef = useRef(editPoints);
    editPointsRef.current = editPoints;
    const moveDeltaRef = useRef<Vec2 | null>(null);
    const boxRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    const drawingRef = useRef(false); // a two-click item is in flight
    const brightenedRef = useRef<number | null>(null);
    const cursorPxRef = useRef<{ x: number; y: number } | null>(null);
    const cursorWorldRef = useRef<Vec2 | null>(null);
    const moveModeStartRef = useRef<Vec2 | null>(null);

    /** Snap a world point to the grid when the grid is visible. */
    const snap = useCallback(
      (p: Vec2): Vec2 =>
        showGrid && gridIU > 0
          ? { x: Math.round(p.x / gridIU) * gridIU, y: Math.round(p.y / gridIU) * gridIU }
          : p,
      [showGrid, gridIU],
    );

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = blackBackground ? DS_BG_COLOR_DARK : DS_BG_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // World transform (IU → device px).
      ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);

      // Page with a soft drop shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(3 * MM, 3 * MM, pageW, pageH);
      ctx.fillStyle = DS_PAGE_COLOR;
      ctx.fillRect(0, 0, pageW, pageH);

      const worldPen = 1 / v.scale; // 1 device px in world units

      // Grid dots (a GAL-style grained grid).
      if (showGrid && gridIU > 0 && gridIU * v.scale >= 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        const r = Math.max(worldPen * 0.9, gridIU * 0.02);
        const d = r * 2;
        for (let x = 0; x <= pageW + 1; x += gridIU) {
          for (let y = 0; y <= pageH + 1; y += gridIU) ctx.fillRect(x - r, y - r, d, d);
        }
      }

      // Clip page content to the page rectangle.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pageW, pageH);
      ctx.clip();
      // An in-flight move-mode / drag offset shifts the selected items live.
      const md = moveDeltaRef.current;
      if (md && selRef.current.size > 0) {
        const still = drawsRef.current.filter((d) => !selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, still, new Set(), {
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
        ctx.save();
        ctx.translate(md.x, md.y);
        const moving = drawsRef.current.filter((d) => selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, moving, selRef.current, { minWidth: worldPen });
        ctx.restore();
      } else {
        drawDrawingSheetItems(ctx, drawsRef.current, selRef.current, {
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
      }
      ctx.restore();

      // ---- overlays (device space) ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

      // Selection outlines (dashed), offset by an in-flight move delta.
      if (selRef.current.size > 0) {
        ctx.strokeStyle = DS_HILITE_COLOR;
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

      // Point-editor handles (filled squares, EDIT_POINTS style).
      const pts = editPointsRef.current;
      if (pts && pts.length > 0 && !md) {
        const r = 4 * dpr;
        for (const p of pts) {
          const c = toPx(p);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = DS_HILITE_COLOR;
          ctx.lineWidth = Math.max(1, dpr);
          ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
          ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2);
        }
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

      // Full-window crosshair at the cursor.
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
    }, [pageW, pageH, showGrid, gridIU, dpr, fullCrosshair, blackBackground, onScaleChange]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    useEffect(() => {
      requestDraw();
    }, [draws, selection, editPoints, requestDraw]);

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

    // Space bar: set the relative-coordinate local origin at the cursor.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        // Hidden frames must not act on global hotkeys (editors stay mounted
        // behind display:none; no stamp = standalone build, always active).
        if ((document.body.dataset.activeView ?? 'drawingsheet') !== 'drawingsheet') return;
        if (e.key !== ' ' || e.repeat) return;
        const tgt = e.target as HTMLElement | null;
        if (
          tgt &&
          (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')
        )
          return;
        const w = cursorWorldRef.current;
        if (w) {
          e.preventDefault();
          onSetLocalOrigin?.(w);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onSetLocalOrigin]);

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
      | { mode: 'point'; index: number }
      | null
    >(null);

    // Entering/leaving move mode (M): anchor at current cursor.
    useEffect(() => {
      if (moveMode) {
        moveModeStartRef.current = cursorWorldRef.current ?? { x: 0, y: 0 };
      } else {
        moveModeStartRef.current = null;
        moveDeltaRef.current = null;
        requestDraw();
      }
    }, [moveMode, requestDraw]);

    const hitEditPoint = (world: Vec2): number | null => {
      const pts = editPointsRef.current;
      if (!pts) return null;
      const tol = (6 * dpr) / viewRef.current.scale;
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(pts[i]!.x - world.x) <= tol && Math.abs(pts[i]!.y - world.y) <= tol) return i;
      }
      return null;
    };

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = worldAt(e.clientX, e.clientY);

      // Middle button always pans.
      if (e.button === 1) {
        gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
        return;
      }
      if (e.button !== 0) return;

      // Move mode: the click drops the selection.
      if (moveMode) {
        const start = moveModeStartRef.current;
        const d = start ? { x: snap(world).x - start.x, y: snap(world).y - start.y } : null;
        if (d) onMoveDrop?.(d);
        return;
      }

      // Interactive delete: click deletes the hovered item.
      if (activeTool === 'dsDelete') {
        const tol = (6 * dpr) / viewRef.current.scale;
        const hit = pickDrawItem(drawsRef.current, world, tol);
        if (hit !== null) onDeleteClick?.(hit);
        return;
      }

      // Drawing tools.
      if (TWO_CLICK.has(activeTool)) {
        const at = snap(world);
        if (!drawingRef.current) {
          drawingRef.current = true;
          onDrawFirst?.(activeTool, at);
        } else {
          drawingRef.current = false;
          onDrawSecond?.(at);
        }
        return;
      }
      if (ONE_CLICK.has(activeTool)) {
        onPlacePoint?.(activeTool, snap(world));
        return;
      }

      // Point-editor handle?
      const handle = hitEditPoint(world);
      if (handle !== null) {
        gestureRef.current = { mode: 'point', index: handle };
        return;
      }

      // Select tool: pick / move / box.
      const tol = (6 * dpr) / viewRef.current.scale;
      const hit = pickDrawItem(drawsRef.current, world, tol);
      const additive = e.shiftKey;
      if (hit !== null) {
        if (!selRef.current.has(hit)) onSelect?.(hit, additive);
        gestureRef.current = { mode: 'move', start: snap(world), moved: false };
      } else {
        if (!additive) onSelect?.(null, false);
        gestureRef.current = { mode: 'box', start: world, additive };
      }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
      const world = worldAt(e.clientX, e.clientY);
      cursorWorldRef.current = world;
      const snapped = snap(world);
      onCursorMove?.(snapped);
      const rect = canvasRef.current!.getBoundingClientRect();
      cursorPxRef.current = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
      if (fullCrosshair) requestDraw();

      // Live end point of an in-flight drawing.
      if (drawingRef.current) onDrawMove?.(snapped);

      // Move mode: live offset.
      if (moveMode && moveModeStartRef.current) {
        moveDeltaRef.current = {
          x: snapped.x - moveModeStartRef.current.x,
          y: snapped.y - moveModeStartRef.current.y,
        };
        requestDraw();
      }

      // Delete picker: brighten the hovered item.
      if (activeTool === 'dsDelete') {
        const tol = (6 * dpr) / viewRef.current.scale;
        const hit = pickDrawItem(drawsRef.current, world, tol);
        if (brightenedRef.current !== hit) {
          brightenedRef.current = hit;
          onDeleteHover?.(hit);
          requestDraw();
        }
      } else if (brightenedRef.current !== null) {
        brightenedRef.current = null;
        onDeleteHover?.(null);
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
      } else if (g.mode === 'point') {
        onPointDrag?.(g.index, snapped);
      } else {
        moveDeltaRef.current = { x: snapped.x - g.start.x, y: snapped.y - g.start.y };
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
      } else if (g.mode === 'point') {
        onPointDragEnd?.();
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

    // Clear the in-flight drawing marker when the tool changes.
    useEffect(() => {
      drawingRef.current = false;
      requestDraw();
    }, [activeTool, requestDraw]);

    const placing = TWO_CLICK.has(activeTool) || ONE_CLICK.has(activeTool);
    const cursor =
      activeTool === 'dsDelete'
        ? REMOVE_CURSOR
        : placing
          ? PENCIL_CURSOR
          : moveMode
            ? 'move'
            : 'crosshair';
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
            cursorWorldRef.current = null;
            cursorPxRef.current = null;
            if (fullCrosshair) requestDraw();
          }}
        />
      </div>
    );
  },
);
