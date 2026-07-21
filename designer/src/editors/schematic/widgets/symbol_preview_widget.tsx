/**
 * Symbol graphics preview with a status-text overlay ("No symbol selected",
 * "Loading…"). Mirrors kicad/eeschema/widgets/symbol_preview_widget.cpp
 * (SYMBOL_PREVIEW_WIDGET); the GAL canvas becomes a 2D <canvas>.
 */
import { useEffect, useRef } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { renderSymbolPreview } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

export interface SymbolPreviewWidgetProps {
  /** Symbol to display, or null to show the status text instead. */
  symbol: LibSymbol | null;
  /** Unit to display (0/undefined = first unit, as upstream DisplaySymbol). */
  unit?: number;
  /** Status label shown when no symbol is displayed, e.g. "No symbol selected". */
  statusText?: string;
  /** True while the symbol's library is being fetched. */
  loading?: boolean;
  loadingText?: string;
}

export function SymbolPreviewWidget({
  symbol,
  unit = 0,
  statusText = '',
  loading = false,
  loadingText = '',
}: SymbolPreviewWidgetProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !symbol) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) renderSymbolPreview(ctx, symbol, canvas.width, canvas.height, KICAD_CLASSIC, unit);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [symbol, unit]);

  return (
    <div className="ze-symbol-preview">
      {symbol ? (
        <canvas ref={canvasRef} className="ze-preview-canvas" />
      ) : (
        <div className="ze-preview-status">{statusText}</div>
      )}
      {loading && (
        <div className="ze-canvas-loading" style={{ color: '#555' }}>
          <span className="ze-spinner" />
          <span>{loadingText}</span>
        </div>
      )}
    </div>
  );
}
