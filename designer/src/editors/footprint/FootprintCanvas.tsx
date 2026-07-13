/**
 * The Footprint Editor drawing canvas — the PCB_DRAW_PANEL_GAL of KiCad's
 * `FOOTPRINT_EDIT_FRAME`, ported to Canvas 2D. It reuses the board painter
 * (renderBoard.ts) unchanged by wrapping the edited footprint as a one-item
 * BOARD (footprintToBoard), exactly as pcbnew edits a footprint on an internal
 * board. Same crisp off-screen raster + delta-blit strategy as PcbEditor, and a
 * controller (zoomToFit/zoomIn/zoomOut/redraw) exposed via ref like SymbolCanvas.
 */

import type { Vec2 } from '@ziroeda/kimath';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { hitTestFootprint } from '@ziroeda/pcbnew';
import { itemsInBox, fpItemBBox, type PcbFootprint } from '@ziroeda/pcbnew';
import {
  buildScene,
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type PcbDrawOptions,
} from '../pcb/renderBoard.js';
import { PCB_BACKGROUND } from '../pcb/pcbTheme.js';
import { footprintToBoard } from './footprintBoard.js';

const MM = 10000;

export interface FootprintCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  redraw: () => void;
}

export interface FootprintCanvasProps {
  footprint: PcbFootprint | null;
  /** Visible board layers (Appearance panel). */
  visible: ReadonlySet<string>;
  drawOpts?: PcbDrawOptions;
  /** Currently selected item ids (PCB_SELECTION_TOOL). */
  selection?: ReadonlySet<string>;
  /** Active right-toolbar tool ('select' enables picking/box/move). */
  activeTool?: string;
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Click/box selection results (additive when Shift is held). */
  onSelect?: (id: string | null, additive: boolean) => void;
  onSelectBox?: (ids: string[], additive: boolean) => void;
  /** A committed drag-move of the current selection (world-unit delta). */
  onMoveItems?: (delta: Vec2) => void;
  /** A click while a placement tool is active (e.g. Add Pad), in world units. */
  onPlace?: (pos: Vec2) => void;
  /** Double-click an item (open its properties). */
  onEditItem?: (id: string) => void;
  /** Rubber-band preview for a 2-click graphic being drawn (from `start` to cursor). */
  preview?: { tool: string; start: Vec2 } | null;
}

const EMPTY_SEL: ReadonlySet<string> = new Set();

export const FootprintCanvas = forwardRef<FootprintCanvasController, FootprintCanvasProps>(
  function FootprintCanvas(
    {
      footprint,
      visible,
      drawOpts = DEFAULT_DRAW_OPTIONS,
      selection = EMPTY_SEL,
      activeTool = 'select',
      onCursorMove,
      onScaleChange,
      onSelect,
      onSelectBox,
      onMoveItems,
      onPlace,
      onEditItem,
      preview = null,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0 });
    const sceneRef = useRef<BoardScene | null>(null);
    const rafRef = useRef(0);
    const [, setScale] = useState(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Live-gesture state (mutable, read by draw()'s overlay pass; no re-render).
    const moveDeltaRef = useRef<Vec2 | null>(null);
    const boxRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    const fpForDrawRef = useRef<PcbFootprint | null>(footprint);
    fpForDrawRef.current = footprint;
    const selForDrawRef = useRef<ReadonlySet<string>>(selection);
    selForDrawRef.current = selection;
    const previewRef = useRef(preview);
    previewRef.current = preview;
    const cursorWorldRef = useRef<Vec2 | null>(null);

    // Compile the footprint (wrapped as a board) into retained per-layer paths.
    const scene = useMemo(() => buildScene(footprintToBoard(footprint)), [footprint]);
    sceneRef.current = scene;

    // ----- crisp off-screen raster, blitted with a delta transform each frame ---
    const cacheRef = useRef<{
      canvas: HTMLCanvasElement;
      view: { scale: number; tx: number; ty: number };
    } | null>(null);
    const renderingRef = useRef(false);
    const viewChangedRef = useRef(true);

    const viewMatchesCache = useCallback((): boolean => {
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
    }, []);

    const startCrispRender = useCallback(() => {
      if (renderingRef.current) return;
      const canvas = canvasRef.current;
      const scn = sceneRef.current;
      if (!canvas || !scn || canvas.width < 2) return;
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
      // No drawing sheet in the footprint editor (a library footprint has no page).
      const steps = buildDrawSteps(cctx, scn, jobView, visible, work.width, work.height, {
        ...drawOpts,
        drawingSheet: false,
      });
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
          if (viewChangedRef.current || !viewMatchesCache()) startCrispRender();
        }
      };
      run();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, drawOpts, viewMatchesCache]);

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
      ctx.fillStyle = PCB_BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const c = cacheRef.current;
      if (c) {
        const k = v.scale / c.view.scale;
        ctx.setTransform(k, 0, 0, k, v.tx - c.view.tx * k, v.ty - c.view.ty * k);
        ctx.imageSmoothingEnabled = k < 1;
        ctx.drawImage(c.canvas, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // ----- selection + gesture overlay (device-pixel space) -----------------
      const fp = fpForDrawRef.current;
      const sel = selForDrawRef.current;
      const md = moveDeltaRef.current;
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
      if (fp && sel.size > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        const ox = md ? md.x : 0,
          oy = md ? md.y : 0;
        for (const id of sel) {
          const b = fpItemBBox(fp, id);
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
      const box = boxRef.current;
      if (box) {
        const p0 = toPx(box.a),
          p1 = toPx(box.b);
        // KiCad tints the marquee blue (l→r) or green (r→l window select).
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
      // Rubber-band preview for a graphic being drawn (start → cursor).
      const pv = previewRef.current;
      const cur = cursorWorldRef.current;
      if (pv && cur) {
        const a = toPx(pv.start),
          b = toPx(cur);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        if (pv.tool === 'drawCircle') {
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        } else if (pv.tool === 'drawRectangle') {
          ctx.rect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        } else {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      setScale(v.scale);
      onScaleChange?.(v.scale);
    }, [startCrispRender, viewMatchesCache, onScaleChange, dpr]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    // Invalidate the raster when the compiled scene, layers or options change.
    useEffect(() => {
      cacheRef.current = null;
      requestDraw();
    }, [scene, visible, drawOpts, requestDraw]);

    // The selection only affects the overlay, not the raster — just repaint.
    useEffect(() => {
      requestDraw();
    }, [selection, requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      const scn = sceneRef.current;
      if (!canvas) return;
      // A footprint with no geometry (a brand-new one): centre on the origin.
      const bbox = scn?.bbox ?? { minX: -5 * MM, minY: -5 * MM, maxX: 5 * MM, maxY: 5 * MM };
      const { minX, minY, maxX, maxY } = bbox;
      const margin = 2 * MM;
      const s = Math.min(
        canvas.width / (maxX - minX + margin * 2),
        canvas.height / (maxY - minY + margin * 2),
      );
      viewRef.current = {
        scale: s > 0 && Number.isFinite(s) ? s : 0.02,
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

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit,
        zoomIn: () => zoomStep(1.3),
        zoomOut: () => zoomStep(1 / 1.3),
        redraw: () => {
          cacheRef.current = null;
          requestDraw();
        },
      }),
      [zoomToFit, zoomStep, requestDraw],
    );

    // Size the canvas to its container (device pixels); fit on first layout.
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
        } else {
          cacheRef.current = null;
          requestDraw();
        }
      });
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [dpr, requestDraw, zoomToFit]);

    // Re-fit when a different footprint is loaded.
    const fpRef = useRef(footprint);
    useEffect(() => {
      if (fpRef.current !== footprint) {
        fpRef.current = footprint;
        requestAnimationFrame(zoomToFit);
      }
    }, [footprint, zoomToFit]);

    // Wheel zoom about the cursor.
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

    // Pointer world position (IU) from a client event.
    const worldAt = (clientX: number, clientY: number): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / v.scale,
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    };

    // A gesture in flight: pan (middle button), or — with the select tool —
    // click-select + box-select on empty space, and drag-move over a selection.
    const gestureRef = useRef<
      | { mode: 'pan'; last: { x: number; y: number } }
      | { mode: 'box'; start: Vec2; additive: boolean }
      | { mode: 'move'; start: Vec2; moved: boolean }
      | { mode: 'place'; start: { x: number; y: number }; moved: boolean }
      | null
    >(null);

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // Middle button always pans (right button reserved for context menu later).
      if (e.button === 1) {
        gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
        return;
      }
      if (e.button !== 0) return;
      // A placement tool is active: a click drops the item (drag is ignored).
      if (activeTool !== 'select') {
        gestureRef.current = { mode: 'place', start: { x: e.clientX, y: e.clientY }, moved: false };
        return;
      }
      const world = worldAt(e.clientX, e.clientY);
      const fp = fpForDrawRef.current;
      const tol = (6 * dpr) / viewRef.current.scale;
      const hit = fp ? hitTestFootprint(fp, world, tol) : null;
      const additive = e.shiftKey;
      if (hit) {
        // Select the hit item (unless already selected) then start a move drag.
        if (!selForDrawRef.current.has(hit)) onSelect?.(hit, additive);
        gestureRef.current = { mode: 'move', start: world, moved: false };
      } else {
        if (!additive) onSelect?.(null, false);
        gestureRef.current = { mode: 'box', start: world, additive };
      }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
      if (canvasRef.current) {
        const w = worldAt(e.clientX, e.clientY);
        cursorWorldRef.current = w;
        onCursorMove?.(w);
        if (previewRef.current) requestDraw(); // animate the rubber-band
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
        boxRef.current = { a: g.start, b: worldAt(e.clientX, e.clientY) };
        requestDraw();
      } else if (g.mode === 'place') {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 3) g.moved = true;
      } else {
        const w = worldAt(e.clientX, e.clientY);
        moveDeltaRef.current = { x: w.x - g.start.x, y: w.y - g.start.y };
        g.moved = true;
        requestDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent): void => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.mode === 'place') {
        if (!g.moved) onPlace?.(worldAt(e.clientX, e.clientY));
        return;
      }
      if (g.mode === 'box') {
        const b = boxRef.current;
        boxRef.current = null;
        if (b) {
          const fp = fpForDrawRef.current;
          const ids = fp ? itemsInBox(fp, b.a.x, b.a.y, b.b.x, b.b.y) : [];
          if (ids.length > 0) onSelectBox?.(ids, g.additive);
        }
        requestDraw();
      } else if (g.mode === 'move') {
        const d = moveDeltaRef.current;
        moveDeltaRef.current = null;
        if (g.moved && d && (d.x !== 0 || d.y !== 0)) onMoveItems?.(d);
        else if (!g.moved) {
          // A plain click on an item: finalise the (non-additive) selection.
          const world = worldAt(e.clientX, e.clientY);
          const fp = fpForDrawRef.current;
          const tol = (6 * dpr) / viewRef.current.scale;
          const hit = fp ? hitTestFootprint(fp, world, tol) : null;
          if (hit && !e.shiftKey) onSelect?.(hit, false);
        }
        requestDraw();
      }
    };

    return (
      <div className="ze-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: activeTool === 'select' ? 'default' : 'crosshair',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={(e) => {
            const fp = fpForDrawRef.current;
            if (!fp || !onEditItem) return;
            const w = worldAt(e.clientX, e.clientY);
            const hit = hitTestFootprint(fp, w, (6 * dpr) / viewRef.current.scale);
            if (hit) onEditItem(hit);
          }}
          onPointerLeave={() => onCursorMove?.(null)}
        />
      </div>
    );
  },
);
