import type { JSX } from 'react';

/**
 * Blocking progress overlay — the web equivalent of KiCad's WX_PROGRESS_REPORTER
 * dialog plus busy cursor (eeschema/pcbnew files-io). Render it while a heavy
 * load/save runs so the UI never looks frozen; a null label hides it. The
 * spinner animates via `transform`, so it keeps moving on the compositor thread
 * even while the main thread is busy parsing/compressing.
 */
export function LoadingOverlay({ label }: { label: string | null }): JSX.Element | null {
  if (!label) return null;
  return (
    <div className="ze-modal-backdrop ze-loading-backdrop">
      <div className="ze-loading-card">
        <span className="ze-spinner" />
        <span>{label}</span>
      </div>
    </div>
  );
}

/** Yield so the browser paints the overlay before the main thread gets busy. */
export const nextPaint = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
