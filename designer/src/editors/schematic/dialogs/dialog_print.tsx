/**
 * Print dialog. Counterpart: `eeschema/printing/dialog_print.cpp` (DIALOG_PRINT
 * for eeschema, dialog_print_base.cpp) — the same control order: "Print
 * drawing sheet", "Output mode:" choice, "Print background color", the
 * different-print-theme option. KiCad's behaviors translated exactly:
 *
 *  - Options persist in the eeschema settings' `printing.*` slice.
 *    TransferDataToWindow seeds every control from it (first run is KiCad's
 *    defaults: B&W, no drawing sheet), and SavePrintOptions runs from the
 *    DESTRUCTOR — i.e. on every way of leaving the dialog (Print, Preview,
 *    Close, the X, the backdrop).
 *  - The theme choice pre-selects `use_theme ? printing.color_theme : the
 *    editor's display theme` and is enabled only while the checkbox is
 *    checked (OnUseColorThemeChecked). Unlike pcbnew, B&W does not disable
 *    the theme controls here.
 *  - OnOutputChoice: switching to Black and white disables AND unchecks
 *    "Print background color"; switching back to Color re-enables it and
 *    restores the SAVED config value (not the transient checkbox state).
 *  - SavePrintOptions stores background as false while its checkbox is
 *    disabled, and only rewrites `color_theme` when the use-theme box is
 *    checked.
 *
 * "Print" renders the current sheet into the browser's print flow.
 */

import { useState, type JSX } from 'react';
import type { PlotOpts } from '../render/plot.js';
import { BUILTIN_THEMES } from '../theme.js';
import { settings } from '../../../prefs/settings.js';

interface Props {
  onPrint: (opts: PlotOpts, themeId?: string) => void;
  /** Print Preview (upstream Apply / OnPrintPreview): show the render without printing. */
  onPreview?: (opts: PlotOpts, themeId?: string) => void;
  /** The editor's active theme id (used when a different print theme is off). */
  themeId?: string;
  onClose: () => void;
}

// Note: KiCad's "Page Setup..." button (m_buttonPageSetup -> wxPageSetupDialog)
// is intentionally omitted. On the web the browser's native print dialog already
// controls paper size, orientation and margins for the print job.
export function DialogPrint({ onPrint, onPreview, themeId, onClose }: Props): JSX.Element {
  // TransferDataToWindow: seed from the saved printing.* options.
  const cfg = settings.eeschema.printing;
  const [color, setColor] = useState(!cfg.monochrome);
  const [drawingSheet, setDrawingSheet] = useState(cfg.title_block);
  // If monochrome, the background checkbox starts unchecked + disabled.
  const [background, setBackground] = useState(cfg.monochrome ? false : cfg.background);
  // "Use a different color theme for printing" (m_checkUseColorTheme + choice).
  const [useTheme, setUseTheme] = useState(cfg.use_theme);
  const [themeSel, setThemeSel] = useState(() => {
    const target = cfg.use_theme && cfg.color_theme ? cfg.color_theme : themeId;
    return target && BUILTIN_THEMES[target] ? target : '_builtin_default';
  });

  // OnOutputChoice: B&W unchecks + disables background; Color restores the
  // saved config value.
  const onOutputChoice = (toColor: boolean): void => {
    setColor(toColor);
    setBackground(toColor ? settings.eeschema.printing.background : false);
  };

  // SavePrintOptions (run by the destructor upstream, so from every exit).
  const savePrintOptions = (): void => {
    settings.updateEeschema((s) => {
      s.printing.monochrome = !color;
      s.printing.title_block = drawingSheet;
      // A disabled background checkbox saves as false, like upstream.
      s.printing.background = color ? background : false;
      s.printing.use_theme = useTheme;
      if (useTheme) s.printing.color_theme = themeSel;
    });
  };

  const saveAndClose = (): void => {
    savePrintOptions();
    onClose();
  };

  const run = (fn?: (opts: PlotOpts, themeId?: string) => void): void => {
    savePrintOptions();
    fn?.({ color, drawingSheet, background: color && background }, useTheme ? themeSel : undefined);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={saveAndClose}>
      <div
        className="ze-modal"
        style={{ width: 430, maxWidth: '92vw', height: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Print
          <span className="x" title="Cancel" onClick={saveAndClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
          <label
            style={{ display: 'block', margin: '4px 0' }}
            title="Print (or not) the Frame references."
          >
            <input
              type="checkbox"
              checked={drawingSheet}
              onChange={(e) => setDrawingSheet(e.target.checked)}
            />{' '}
            Print drawing sheet
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
            <span style={{ fontSize: 12 }}>Output mode:</span>
            <select
              className="ze-select"
              value={color ? 'color' : 'bw'}
              onChange={(e) => onOutputChoice(e.target.value === 'color')}
            >
              <option value="color">Color</option>
              <option value="bw">Black and White</option>
            </select>
          </div>
          <label style={{ display: 'block', margin: '4px 0', paddingLeft: 20 }}>
            <input
              type="checkbox"
              checked={background}
              disabled={!color}
              onChange={(e) => setBackground(e.target.checked)}
            />{' '}
            Print background color
          </label>
          <div style={{ height: 6 }} />
          <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={useTheme}
              onChange={(e) => setUseTheme(e.target.checked)}
            />{' '}
            Use a different color theme for printing:
          </label>
          <select
            className="ze-select"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginLeft: 20,
              maxWidth: 'calc(100% - 20px)',
            }}
            value={themeSel}
            disabled={!useTheme}
            onChange={(e) => setThemeSel(e.target.value)}
          >
            {Object.entries(BUILTIN_THEMES).map(([id, t]) => (
              <option key={id} value={id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ze-modal-footer">
          {/* Right-aligned by the footer's justify-content:flex-end.
              KiCad std-button order (GTK): Print Preview (Apply), Close, Print (OK). */}
          {onPreview && (
            <button className="ze-btn" onClick={() => run(onPreview)}>
              Print Preview
            </button>
          )}
          <button className="ze-btn" onClick={saveAndClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={() => run(onPrint)}>
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
