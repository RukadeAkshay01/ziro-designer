/**
 * Footprint preview pane of the chooser dialogs. Mirrors
 * kicad/common/widgets/footprint_preview_widget.cpp
 * (FOOTPRINT_PREVIEW_WIDGET + FOOTPRINT_PREVIEW_PANEL): fetches the footprint
 * from the hosted libraries and paints it through the PCB paint pipeline,
 * with a status text replacing the canvas when there is nothing to draw
 * ("No footprint specified" / "Footprint not found").
 */
import { useEffect, useRef, useState } from 'react';
import type { PcbFootprint } from '@ziroeda/pcbnew';
import { buildScene, drawBoard, DEFAULT_DRAW_OPTIONS } from '../editors/pcb/renderBoard.js';
import { footprintToBoard, FOOTPRINT_LAYERS } from '../editors/footprint/footprintBoard.js';
import { loadFootprint } from './footprint_list.js';

const ALL_LAYERS: ReadonlySet<string> = new Set(FOOTPRINT_LAYERS.map((l) => l.name));

export interface FootprintPreviewWidgetProps {
  /** Footprint LIB_ID text to display, '' for none (SetStatusText branch). */
  footprint: string;
  /** Status label, e.g. "No footprint specified" (upstream SetStatusText). */
  statusText: string;
}

export function FootprintPreviewWidget({
  footprint,
  statusText,
}: FootprintPreviewWidgetProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fp, setFp] = useState<PcbFootprint | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'missing'>('idle');

  // DisplayFootprint: fetch the .kicad_mod on selection change.
  useEffect(() => {
    let cancelled = false;
    if (!footprint) {
      setFp(null);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    void loadFootprint(footprint).then((loaded) => {
      if (cancelled) return;
      setFp(loaded);
      setStatus(loaded ? 'idle' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [footprint]);

  // Paint the footprint fitted into the pane (FOOTPRINT_PREVIEW_PANEL's
  // fitToCurrentFootprint), re-painting on pane resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fp) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scene = buildScene(footprintToBoard(fp));
      const b = scene.bbox;
      const w = canvas.width;
      const h = canvas.height;
      if (!b) return;
      const bw = Math.max(1, b.maxX - b.minX);
      const bh = Math.max(1, b.maxY - b.minY);
      const scale = Math.min(w / (bw * 1.3), h / (bh * 1.3));
      const view = {
        scale,
        tx: w / 2 - ((b.minX + b.maxX) / 2) * scale,
        ty: h / 2 - ((b.minY + b.maxY) / 2) * scale,
      };
      drawBoard(ctx, scene, view, ALL_LAYERS, w, h, {
        ...DEFAULT_DRAW_OPTIONS,
        drawingSheet: false,
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fp]);

  return (
    <div className="ze-fp-preview">
      {fp && footprint ? (
        <canvas ref={canvasRef} className="ze-fp-canvas" />
      ) : (
        <div className="ze-muted">
          {!footprint ? statusText : status === 'loading' ? 'Loading…' : 'Footprint not found'}
        </div>
      )}
    </div>
  );
}
