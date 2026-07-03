/**
 * PCB Editor v1: a faithful pcbnew board viewer (read-only for now).
 *
 * Mirrors the pcbnew frame: canvas centre, Appearance/Layers panel on the
 * right with the exact KiCad Default layer colors, status bar with cursor
 * position and zoom. Rendering is the PCB_PAINTER port in renderBoard.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { parse, readBoard, iuToMM, type Board } from '@ziroeda/core';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import { buildScene, drawBoard, type BoardScene } from './renderBoard.js';
import { layerColor, PCB_PAINT_ORDER } from './pcbTheme.js';
import '../ui/shell.css';

const MM = 10000;

export function PcbEditor({ fileName, text, onExit }: {
  fileName: string;
  text: string;
  onExit: () => void;
}): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0 });
  const sceneRef = useRef<BoardScene | null>(null);
  const rafRef = useRef(0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Parse after the first paint so "Loading…" is visible for big boards.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      try {
        const b = { ...readBoard(parse(text)), fileName };
        if (cancelled) return;
        sceneRef.current = buildScene(b);
        setBoard(b);
        setVisible(new Set(b.layers.map((l) => l.name)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
    return () => { cancelled = true; clearTimeout(id); };
  }, [text, fileName]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawBoard(ctx, scene, viewRef.current, visible, canvas.width, canvas.height);
    setScale(viewRef.current.scale);
  }, [visible]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const zoomToFit = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene?.bbox) return;
    const { minX, minY, maxX, maxY } = scene.bbox;
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
        requestDraw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dpr, requestDraw, zoomToFit, board]);

  useEffect(() => { requestDraw(); }, [visible, requestDraw]);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit]);

  // Layers panel rows: copper in stackup order first, then the tech layers in
  // paint order — the same grouping as pcbnew's Appearance panel.
  const layerRows = useMemo(() => {
    if (!board) return [];
    const known = new Set(board.layers.map((l) => l.name));
    const copper = board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name);
    const tech = PCB_PAINT_ORDER.filter((n) => known.has(n) && !/\.Cu$/.test(n)).reverse();
    return [...copper, ...tech];
  }, [board]);

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setAll = (on: boolean): void => {
    setVisible(on && board ? new Set(board.layers.map((l) => l.name)) : new Set());
  };

  const saveCopy = (): void => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Save a Copy…', action: saveCopy },
        { sep: true },
        { label: 'Close (back to project)', action: onExit },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom to Fit', action: zoomToFit, shortcut: 'F' },
        { sep: true },
        { label: 'Show All Layers', action: () => setAll(true) },
        { label: 'Hide All Layers', action: () => setAll(false) },
      ],
    },
  ];

  return (
    <div className="ze-app">
      <MenuBar menus={menus} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={wrapRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {!board && !error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#ddd' }}>
              Loading board… (large boards can take a while)
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#ff8080' }}>
              Couldn’t open board: {error}
            </div>
          )}
        </div>

        <div className="ze-panel right" style={{ width: 220, overflow: 'auto' }}>
          <div className="ze-panel-header">Layers</div>
          <div className="ze-panel-body">
            {layerRows.map((name) => (
              <div
                key={name}
                className="ze-tree-item"
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                onClick={() => toggleLayer(name)}
              >
                <input type="checkbox" readOnly checked={visible.has(name)} />
                <span style={{
                  width: 14, height: 14, borderRadius: 2, flex: '0 0 auto',
                  background: layerColor(name), border: '1px solid #444',
                }} />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ze-statusbar">
        <span className="cell">Z {scale > 0 ? (scale * 1000).toFixed(2) : '—'}</span>
        <span className="cell">
          {cursor ? `X ${iuToMM(cursor.x).toFixed(4)} Y ${iuToMM(cursor.y).toFixed(4)} mm` : 'X — Y —'}
        </span>
        <span className="cell grow">{board ? `${board.footprints.length} footprints · ${board.tracks.length + board.arcs.length} tracks · ${board.vias.length} vias · ${board.nets.size} nets` : ''}</span>
        <span className="cell">{fileName}</span>
      </div>
    </div>
  );
}
