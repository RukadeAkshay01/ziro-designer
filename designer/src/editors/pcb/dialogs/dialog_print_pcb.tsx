/**
 * Print dialog for the board editor. Counterpart: DIALOG_PRINT_PCBNEW
 * (common/dialogs/dialog_print_generic.cpp + pcbnew/dialogs/
 * dialog_print_pcbnew.cpp) — the same controls in the same order, with
 * KiCad's behaviors translated exactly:
 *
 *  - Settings persist like PCBNEW_PRINTOUT_SETTINGS::Load/Save through the
 *    `printing.*` keys of the pcbnew settings (PCB_CONTROL::Print loads them
 *    before opening; every way of leaving the dialog — Print, Print Preview,
 *    Close, the X, the backdrop — runs saveSettings, mirroring
 *    onCancelButtonClick/onClose which both save).
 *  - The layer checklist is seeded from the saved `printing.layers` ordinals
 *    (KiCad's first run has nothing checked), listed in enabled-layer UI
 *    order; right-click gives the selection commands, where "Select Fab
 *    Layers" is (AllCuMask | AllTechMask) & ~courtyards — copper plus
 *    silk/mask/adhesive/paste/fab, no Edge.Cuts, no courtyards.
 *  - Output mode Black and white disables "Print background color" and the
 *    theme controls (onColorModeClicked); "Use a different color theme"
 *    gates the theme choice (onUseThemeClicked); the choice lists the
 *    COLOR_SETTINGS themes and pre-selects `use_theme ? printing.color_theme
 *    : appearance.color_theme` (TransferDataToWindow).
 *  - "Print one page per layer" gates "Print board edges on all pages",
 *    restoring the stored value when re-enabled (onPagePerLayerClicked).
 *  - Scale is stored as one double: 0.0 = fit, 1.0 = 1:1, else custom,
 *    clamped to [0.01, 100] with KiCad's warning messages (getScaleValue);
 *    typing in the custom box selects the Custom radio (onSetCustomScale).
 *  - Printing with no layers checked shows "Nothing to print".
 *
 * Printing renders each page to an offscreen canvas at 300 DPI through the
 * board painter (the schematic's printSheet mechanics), then opens the
 * browser's print flow on the composed pages.
 */
import { useState, type JSX } from 'react';
import type { Board } from '@ziroeda/pcbnew';
import { buildScene, drawBoard, type PcbDrawOptions } from '../renderBoard.js';
import { PCB_BW_PRINT_THEME, PCB_THEMES, themeByFilename } from '../pcbTheme.js';
import { settings } from '../../../prefs/settings.js';

const MM = 10000; // IU per mm
const DPI = 300;

// Print scale clamps (dialog_print_generic.cpp MIN_SCALE / MAX_SCALE).
const MIN_SCALE = 0.01;
const MAX_SCALE = 100.0;

const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};

const DRILL_MARKS = ['none', 'small', 'real'] as const;

interface Props {
  board: Board;
  /** The editor's visible layers (unused by KiCad's dialog — the checklist
   *  comes from the saved settings — kept for the caller's convenience). */
  visibleLayers?: ReadonlySet<string>;
  /** The editor's draw options ("Print according to objects tab"). */
  drawOpts: PcbDrawOptions;
  onClose: () => void;
}

export function DialogPcbPrint({ board, drawOpts, onClose }: Props): JSX.Element {
  const layerNames = board.layers.map((l) => l.name);
  const displayName = new Map(board.layers.map((l) => [l.name, l.userName ?? l.name]));
  const ordinalOf = new Map(board.layers.map((l) => [l.name, l.id]));

  // PCB_CONTROL::Print: settings.Load( cfg ) before the dialog opens.
  const cfg = settings.pcbnew.printing;
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(layerNames.filter((l) => cfg.layers.includes(ordinalOf.get(l) ?? -1))),
  );
  const [bw, setBw] = useState(cfg.monochrome);
  const [sheet, setSheet] = useState(cfg.title_block);
  const [useObjectsTab, setUseObjectsTab] = useState(cfg.as_item_checkboxes);
  const [background, setBackground] = useState(cfg.background);
  const [useTheme, setUseTheme] = useState(cfg.use_theme);
  // TransferDataToWindow: target = use_theme ? printing.color_theme : display theme.
  const [themeFile, setThemeFile] = useState(
    () =>
      themeByFilename(
        cfg.use_theme && cfg.color_theme ? cfg.color_theme : settings.pcbnew.appearance.color_theme,
      ).filename,
  );
  const [mirrored, setMirrored] = useState(cfg.mirror);
  const [onePerLayer, setOnePerLayer] = useState(cfg.pagination === 1);
  const [edgesAllPages, setEdgesAllPages] = useState(cfg.edge_cuts_on_all_pages);
  const [scaleMode, setScaleMode] = useState<'1:1' | 'fit' | 'custom'>(
    cfg.scale === 0 ? 'fit' : cfg.scale === 1 ? '1:1' : 'custom',
  );
  const [customScale, setCustomScale] = useState(() =>
    // setScaleValue: a custom value from the config is silently clamped.
    String(Math.min(MAX_SCALE, Math.max(MIN_SCALE, cfg.scale === 0 ? 1 : cfg.scale))),
  );
  const [drillMarks, setDrillMarks] = useState(() =>
    cfg.drill_marks >= 0 && cfg.drill_marks <= 2 ? cfg.drill_marks : 1,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const toggle = (name: string): void =>
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  // Right-click layer selection commands (onPopUpLayers). Fab layers =
  // (AllCuMask | AllTechMask) & ~{B.CrtYd, F.CrtYd}: copper + silk/mask/
  // adhesive/paste/fab on both sides.
  const isCu = (l: string): boolean => /\.Cu$/.test(l);
  const isFab = (l: string): boolean => isCu(l) || /\.(SilkS|Mask|Adhes|Paste|Fab)$/.test(l);
  const menuCmd = (cmd: string): void => {
    setChecked((p) => {
      const n = new Set(p);
      // ID_SELECT_FAB_LAYERS checks the fab set and unchecks everything else.
      if (cmd === 'fab') return new Set(layerNames.filter(isFab));
      if (cmd === 'allcu') for (const l of layerNames.filter(isCu)) n.add(l);
      if (cmd === 'nocu') for (const l of layerNames.filter(isCu)) n.delete(l);
      if (cmd === 'all') return new Set(layerNames);
      if (cmd === 'none') return new Set();
      return n;
    });
    setMenu(null);
  };

  // DIALOG_PRINT_GENERIC::getScaleValue: 1:1 -> 1.0, fit -> 0.0, custom
  // parsed + clamped with KiCad's messages (invalid input resets to 1.0).
  const getScaleValue = (): number => {
    if (scaleMode === '1:1') return 1.0;
    if (scaleMode === 'fit') return 0.0;
    let scale = Number(customScale);
    if (!Number.isFinite(scale)) {
      window.alert('Warning: custom scale is not a number.');
      setCustomScale('1');
      return 1.0;
    }
    if (scale > MAX_SCALE) {
      scale = MAX_SCALE;
      setCustomScale(String(scale));
      window.alert(`Warning: custom scale is too large.\nIt will be clamped to ${scale}.`);
    } else if (scale < MIN_SCALE) {
      scale = MIN_SCALE;
      setCustomScale(String(scale));
      window.alert(`Warning: custom scale is too small.\nIt will be clamped to ${scale}.`);
    }
    return scale;
  };

  // saveSettings (DIALOG_PRINT_PCBNEW + DIALOG_PRINT_GENERIC + Save-to-config):
  // every exit path persists, so the next open restores the dialog exactly.
  const saveSettings = (): void => {
    const scale = getScaleValue();
    settings.updatePcbnew((s) => {
      s.printing.layers = layerNames
        .filter((l) => checked.has(l))
        .map((l) => ordinalOf.get(l) ?? -1)
        .filter((o) => o >= 0);
      s.printing.as_item_checkboxes = useObjectsTab;
      s.printing.drill_marks = drillMarks;
      s.printing.pagination = onePerLayer ? 1 : 0;
      s.printing.edge_cuts_on_all_pages = onePerLayer
        ? edgesAllPages
        : s.printing.edge_cuts_on_all_pages;
      s.printing.mirror = mirrored;
      s.printing.background = background;
      s.printing.use_theme = useTheme;
      if (useTheme) s.printing.color_theme = themeFile;
      s.printing.scale = scale;
      s.printing.title_block = sheet;
      s.printing.monochrome = bw;
    });
  };

  // Both the Close button and the window X save settings before closing
  // (onCancelButtonClick / onClose both call saveSettings).
  const saveAndClose = (): void => {
    saveSettings();
    onClose();
  };

  // "Print" auto-opens the browser print flow on load; "Print Preview" (KiCad's
  // Apply / preview frame) just shows the composed pages so they can be reviewed.
  const doPrint = (preview: boolean): void => {
    saveSettings();
    if (checked.size === 0) {
      // DisplayError( this, _( "Nothing to print" ) )
      window.alert('Nothing to print');
      return;
    }

    const paperTok = board.paper?.split(/\s+/) ?? ['A4'];
    const portrait = paperTok.includes('portrait');
    let [pw, ph] = PAPER_MM[paperTok[0] ?? 'A4'] ?? PAPER_MM.A4!;
    if (paperTok[0] === 'User' && paperTok.length >= 3)
      [pw, ph] = [Number(paperTok[1]), Number(paperTok[2])];
    if (portrait) [pw, ph] = [ph, pw];
    const pxW = Math.round((pw / 25.4) * DPI);
    const pxH = Math.round((ph / 25.4) * DPI);

    // Page view transform: 1:1 maps board mm to paper mm at the sheet origin;
    // fit centres the board bbox; custom applies the user factor to 1:1.
    const scene = buildScene(board);
    const bbox = scene.bbox;
    const pxPerIU = DPI / 25.4 / MM;
    // BOARD_PRINTOUT::DrawPage: the view always looks at the centre of the
    // drawing area (gal->SetLookAtPoint(drawingAreaBBox.Centre())) — 1:1 and
    // Custom only change the scale, never the centring.
    const scaleValue = getScaleValue();
    const pageView = (): { scale: number; tx: number; ty: number; flipX: boolean } => {
      let s: number;
      if (scaleValue === 0 && bbox) {
        const margin = 10 * MM;
        s = Math.min(
          pxW / (bbox.maxX - bbox.minX + margin * 2),
          pxH / (bbox.maxY - bbox.minY + margin * 2),
        );
      } else {
        s = pxPerIU * (scaleValue || 1);
      }
      const cx = bbox ? (bbox.minX + bbox.maxX) / 2 : 0;
      const cy = bbox ? (bbox.minY + bbox.maxY) / 2 : 0;
      return {
        scale: s,
        flipX: mirrored,
        tx: pxW / 2 - cx * (mirrored ? -s : s),
        ty: pxH / 2 - cy * s,
      };
    };

    // Colors: B&W prints every item black on white (BOARD_PRINTOUT blackWhite);
    // otherwise the print theme is `use_theme ? chosen : the display theme`
    // (DIALOG_PRINT_PCBNEW::saveSettings -> m_colorSettings).
    const theme = bw
      ? PCB_BW_PRINT_THEME
      : themeByFilename(useTheme ? themeFile : settings.pcbnew.appearance.color_theme);

    const opts: PcbDrawOptions = {
      ...drawOpts,
      // Unless "Print according to objects tab" is set, every item class
      // prints, solid and at full opacity (PCBNEW_PRINTOUT honors the view
      // visibilities only when m_AsItemCheckboxes).
      ...(useObjectsTab
        ? {}
        : {
            tracks: true,
            vias: true,
            pads: true,
            zones: true,
            fpValues: true,
            fpReferences: true,
            fpText: true,
            trackOpacity: 1,
            viaOpacity: 1,
            padOpacity: 1,
            zoneOpacity: 1,
            filledShapeOpacity: 1,
            trackFill: true,
            viaFill: true,
            padFill: true,
            zoneOutline: false,
          }),
      drawingSheet: sheet,
      contrastMode: 'normal',
      drillMarks: DRILL_MARKS[drillMarks] ?? 'small',
      theme,
    };

    // One canvas per page: a single page, or one per checked layer.
    const pages: string[] = [];
    const layerSets: ReadonlySet<string>[] = onePerLayer
      ? [...checked].map((l) =>
          edgesAllPages && l !== 'Edge.Cuts' ? new Set([l, 'Edge.Cuts']) : new Set([l]),
        )
      : [checked];
    for (const layers of layerSets) {
      const canvas = document.createElement('canvas');
      canvas.width = pxW;
      canvas.height = pxH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      // "Print background color" uses the print theme's background; B&W and
      // plain prints go on paper white.
      ctx.fillStyle = background && !bw ? theme.background : '#ffffff';
      ctx.fillRect(0, 0, pxW, pxH);
      drawBoard(
        ctx,
        scene,
        pageView(),
        layers,
        pxW,
        pxH,
        opts,
        sheet
          ? { paper: board.paper, titleBlock: board.titleBlock, fileName: board.fileName }
          : undefined,
      );
      pages.push(canvas.toDataURL('image/png'));
    }

    const win = window.open('', '_blank');
    if (!win) return;
    const orient = pw >= ph ? 'landscape' : 'portrait';
    win.document.write(
      `<html><head><title>Print</title><style>@page{size:${orient};margin:0}body{margin:0}img{width:100%;page-break-after:always}</style></head><body>${pages
        .map((p) => `<img src="${p}"/>`)
        .join('')}</body></html>`,
    );
    win.document.close();
    const img = win.document.images[pages.length - 1];
    if (img)
      img.onload = () => {
        win.focus();
        if (!preview) win.print();
      };
  };

  const box: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
    margin: '0 0 10px',
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
  const check: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '5px 0',
    fontSize: 12.5,
  };
  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '5px 0',
    fontSize: 12.5,
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={saveAndClose}>
      <div
        className="ze-modal"
        style={{ width: 720, maxWidth: '96vw', height: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Print
          <span className="x" title="Close" onClick={saveAndClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'flex', gap: 12, padding: '10px 14px', alignItems: 'flex-start' }}
        >
          {/* Include Layers checklist */}
          <fieldset style={{ ...box, flex: '0 0 220px', display: 'flex', flexDirection: 'column' }}>
            <legend style={legend}>Include Layers</legend>
            <div
              className="ze-grid-pane"
              style={{ height: 300, padding: '4px 6px' }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {layerNames.map((l) => (
                <label key={l} style={{ ...check, margin: '3px 0' }}>
                  <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />
                  {displayName.get(l) ?? l}
                </label>
              ))}
            </div>
            <div className="ze-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Right-click for layer selection commands.
            </div>
          </fieldset>

          {/* Options + Scale */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <fieldset style={box}>
              <legend style={legend}>Options</legend>
              <div style={fieldRow}>
                <span>Output mode:</span>
                <select
                  className="ze-select"
                  value={bw ? 'bw' : 'color'}
                  onChange={(e) => setBw(e.target.value === 'bw')}
                >
                  <option value="color">Color</option>
                  <option value="bw">Black and white</option>
                </select>
              </div>
              <label style={check}>
                <input
                  type="checkbox"
                  checked={sheet}
                  onChange={(e) => setSheet(e.target.checked)}
                />
                Print drawing sheet
              </label>
              <label style={check}>
                <input
                  type="checkbox"
                  checked={useObjectsTab}
                  onChange={(e) => setUseObjectsTab(e.target.checked)}
                />
                Print according to objects tab of appearance manager
              </label>
              {/* onColorModeClicked: B&W disables the color-only options. */}
              <label style={{ ...check, opacity: bw ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  disabled={bw}
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                />
                Print background color
              </label>
              <label style={{ ...check, opacity: bw ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  disabled={bw}
                  checked={useTheme}
                  onChange={(e) => setUseTheme(e.target.checked)}
                />
                Use a different color theme for printing:
              </label>
              <div style={{ ...fieldRow, marginLeft: 22 }}>
                <select
                  className="ze-select"
                  style={{ minWidth: 200 }}
                  disabled={bw || !useTheme}
                  value={themeFile}
                  onChange={(e) => setThemeFile(e.target.value)}
                >
                  {PCB_THEMES.map((t) => (
                    <option key={t.filename} value={t.filename}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={fieldRow}>
                <span>Drill marks:</span>
                <select
                  className="ze-select"
                  value={drillMarks}
                  onChange={(e) => setDrillMarks(Number(e.target.value))}
                >
                  <option value={0}>No drill mark</option>
                  <option value={1}>Small mark</option>
                  <option value={2}>Real drill</option>
                </select>
              </div>
              <label style={check}>
                <input
                  type="checkbox"
                  checked={mirrored}
                  onChange={(e) => setMirrored(e.target.checked)}
                />
                Print mirrored
              </label>
              <label style={check}>
                <input
                  type="checkbox"
                  checked={onePerLayer}
                  onChange={(e) => setOnePerLayer(e.target.checked)}
                />
                Print one page per layer
              </label>
              {/* onPagePerLayerClicked: gated + restored from the stored value. */}
              <label style={{ ...check, marginLeft: 20, opacity: onePerLayer ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  disabled={!onePerLayer}
                  checked={onePerLayer && edgesAllPages}
                  onChange={(e) => setEdgesAllPages(e.target.checked)}
                />
                Print board edges on all pages
              </label>
            </fieldset>

            {/* Scale: vertical (bScaleSizer wxVERTICAL); Custom input fills width. */}
            <fieldset style={box}>
              <legend style={legend}>Scale</legend>
              <label style={{ ...check, margin: '4px 0' }}>
                <input
                  type="radio"
                  checked={scaleMode === '1:1'}
                  onChange={() => setScaleMode('1:1')}
                />
                1:1
              </label>
              <label style={{ ...check, margin: '4px 0' }}>
                <input
                  type="radio"
                  checked={scaleMode === 'fit'}
                  onChange={() => setScaleMode('fit')}
                />
                Fit to page
              </label>
              <div style={{ ...fieldRow, margin: '4px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                  <input
                    type="radio"
                    checked={scaleMode === 'custom'}
                    onChange={() => setScaleMode('custom')}
                  />
                  Custom:
                </label>
                <input
                  className="ze-search"
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
                  value={customScale}
                  onChange={(e) => {
                    // onSetCustomScale: typing selects the Custom radio.
                    setCustomScale(e.target.value);
                    setScaleMode('custom');
                  }}
                />
              </div>
            </fieldset>
          </div>
        </div>

        {/* KiCad std-button order (GTK): Print Preview (Apply), Close, Print (OK). */}
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={() => doPrint(true)}>
            Print Preview
          </button>
          <button className="ze-btn" onClick={saveAndClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={() => doPrint(false)}>
            Print
          </button>
        </div>

        {menu && (
          <div
            style={{
              position: 'fixed',
              left: menu.x,
              top: menu.y,
              zIndex: 100,
              background: 'var(--chrome-bg2)',
              border: '1px solid var(--chrome-border)',
              borderRadius: 3,
              fontSize: 12,
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            }}
            onMouseLeave={() => setMenu(null)}
          >
            {[
              ['Select Fab Layers', 'fab'],
              ['Select all Copper Layers', 'allcu'],
              ['Deselect all Copper Layers', 'nocu'],
              ['Select all Layers', 'all'],
              ['Deselect all Layers', 'none'],
            ].map(([label, cmd]) => (
              <div
                key={cmd}
                className="ze-menu-item"
                style={{ padding: '4px 12px', cursor: 'pointer' }}
                onClick={() => menuCmd(cmd!)}
              >
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
