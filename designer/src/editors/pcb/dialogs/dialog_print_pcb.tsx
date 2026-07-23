/**
 * Print dialog for the board editor. Counterpart: DIALOG_PRINT_PCBNEW
 * (common/dialogs/dialog_print_generic_base.cpp + pcbnew/dialogs/
 * dialog_print_pcbnew.cpp) — the same controls in the same order: the
 * "Include Layers" checklist (right-click for the layer selection commands),
 * Output mode Color / Black and white, Print drawing sheet, Print according
 * to objects tab, Print background color, drill marks (staged), Print
 * mirrored, Print one page per layer (+ board edges on all pages), the Scale
 * radios (1:1 / Fit to page / Custom), and the Print button.
 *
 * Printing renders each page to an offscreen canvas at 300 DPI through the
 * board painter (the schematic's printSheet mechanics), then opens the
 * browser's print flow on the composed pages.
 */
import { useState, type JSX } from 'react';
import type { Board } from '@ziroeda/pcbnew';
import { buildScene, drawBoard, type PcbDrawOptions } from '../renderBoard.js';

const MM = 10000; // IU per mm
const DPI = 300;

const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};

interface Props {
  board: Board;
  /** The editor's visible layers — seeds the checklist. */
  visibleLayers: ReadonlySet<string>;
  /** The editor's draw options ("Print according to objects tab"). */
  drawOpts: PcbDrawOptions;
  onClose: () => void;
}

export function DialogPcbPrint({ board, visibleLayers, drawOpts, onClose }: Props): JSX.Element {
  const layerNames = board.layers.map((l) => l.name);
  const displayName = new Map(board.layers.map((l) => [l.name, l.userName ?? l.name]));
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(layerNames.filter((l) => visibleLayers.has(l))),
  );
  const [bw, setBw] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [useObjectsTab, setUseObjectsTab] = useState(false);
  const [background, setBackground] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const [onePerLayer, setOnePerLayer] = useState(false);
  const [edgesAllPages, setEdgesAllPages] = useState(true);
  const [scaleMode, setScaleMode] = useState<'1:1' | 'fit' | 'custom'>('1:1');
  const [customScale, setCustomScale] = useState('1.0');
  const [drillMarks, setDrillMarks] = useState<'none' | 'small' | 'real'>('real');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const toggle = (name: string): void =>
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  // Right-click layer selection commands (createExtraOptions' context menu).
  const menuCmd = (cmd: string): void => {
    setChecked((p) => {
      const n = new Set(p);
      const isCu = (l: string): boolean => /\.Cu$/.test(l);
      if (cmd === 'fab')
        return new Set(layerNames.filter((l) => /\.(Fab|SilkS)$|Edge\.Cuts/.test(l)));
      if (cmd === 'allcu') for (const l of layerNames.filter(isCu)) n.add(l);
      if (cmd === 'nocu') for (const l of layerNames.filter(isCu)) n.delete(l);
      if (cmd === 'all') return new Set(layerNames);
      if (cmd === 'none') return new Set();
      return n;
    });
    setMenu(null);
  };

  const print = (): void => {
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
    const pageView = (): { scale: number; tx: number; ty: number; flipX: boolean } => {
      if (scaleMode === 'fit' && bbox) {
        const margin = 10 * MM;
        const s = Math.min(
          pxW / (bbox.maxX - bbox.minX + margin * 2),
          pxH / (bbox.maxY - bbox.minY + margin * 2),
        );
        return {
          scale: s,
          flipX: mirrored,
          tx: pxW / 2 - ((bbox.minX + bbox.maxX) / 2) * (mirrored ? -s : s),
          ty: pxH / 2 - ((bbox.minY + bbox.maxY) / 2) * s,
        };
      }
      const k = scaleMode === 'custom' ? Number(customScale) || 1 : 1;
      const s = pxPerIU * k;
      return { scale: s, flipX: mirrored, tx: mirrored ? pxW : 0, ty: 0 };
    };

    const opts: PcbDrawOptions = {
      ...drawOpts,
      ...(useObjectsTab ? {} : { tracks: true, vias: true, pads: true, zones: true }),
      drawingSheet: sheet,
      contrastMode: 'normal',
      drillMarks,
      ...(bw ? { colorOverride: 'rgb(0,0,0)' } : {}),
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
      ctx.fillStyle = background ? 'rgb(0,16,35)' : '#ffffff';
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
        win.print();
      };
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" style={{ width: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Print
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: 12 }}>
          <fieldset style={{ minWidth: 200 }}>
            <legend>Include Layers</legend>
            <div
              style={{ maxHeight: 260, overflowY: 'auto' }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {layerNames.map((l) => (
                <label key={l} style={{ display: 'block' }}>
                  <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />{' '}
                  {displayName.get(l) ?? l}
                </label>
              ))}
            </div>
            <div className="ze-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Right-click for layer selection commands.
            </div>
          </fieldset>
          <div>
            <fieldset>
              <legend>Options</legend>
              <label style={{ display: 'block' }}>
                Output mode:{' '}
                <select
                  value={bw ? 'bw' : 'color'}
                  onChange={(e) => setBw(e.target.value === 'bw')}
                >
                  <option value="color">Color</option>
                  <option value="bw">Black and white</option>
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={sheet}
                  onChange={(e) => setSheet(e.target.checked)}
                />{' '}
                Print drawing sheet
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={useObjectsTab}
                  onChange={(e) => setUseObjectsTab(e.target.checked)}
                />{' '}
                Print according to objects tab of appearance manager
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                />{' '}
                Print background color
              </label>
              <label style={{ display: 'block', opacity: 0.5 }} title="Print themes are staged">
                <input type="checkbox" disabled /> Use a different color theme for printing:{' '}
                <select disabled>
                  <option>KiCad Default</option>
                </select>
              </label>
              <label style={{ display: 'block' }}>
                Drill marks:{' '}
                <select
                  value={drillMarks}
                  onChange={(e) => setDrillMarks(e.target.value as 'none' | 'small' | 'real')}
                >
                  <option value="none">No drill mark</option>
                  <option value="small">Small mark</option>
                  <option value="real">Real drill</option>
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={mirrored}
                  onChange={(e) => setMirrored(e.target.checked)}
                />{' '}
                Print mirrored
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={onePerLayer}
                  onChange={(e) => setOnePerLayer(e.target.checked)}
                />{' '}
                Print one page per layer
              </label>
              <label style={{ display: 'block', marginLeft: 18 }}>
                <input
                  type="checkbox"
                  disabled={!onePerLayer}
                  checked={edgesAllPages}
                  onChange={(e) => setEdgesAllPages(e.target.checked)}
                />{' '}
                Print board edges on all pages
              </label>
            </fieldset>
            <fieldset>
              <legend>Scale</legend>
              <label style={{ marginRight: 10 }}>
                <input
                  type="radio"
                  checked={scaleMode === '1:1'}
                  onChange={() => setScaleMode('1:1')}
                />{' '}
                1:1
              </label>
              <label style={{ marginRight: 10 }}>
                <input
                  type="radio"
                  checked={scaleMode === 'fit'}
                  onChange={() => setScaleMode('fit')}
                />{' '}
                Fit to page
              </label>
              <label>
                <input
                  type="radio"
                  checked={scaleMode === 'custom'}
                  onChange={() => setScaleMode('custom')}
                />{' '}
                Custom:{' '}
                <input
                  style={{ width: 50 }}
                  value={customScale}
                  onChange={(e) => setCustomScale(e.target.value)}
                />
              </label>
            </fieldset>
          </div>
        </div>
        {/* DIALOG_PRINT_GENERIC's button row: Page Setup… on the left, then
            Print / Cancel (Print Preview is staged). */}
        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={print}>
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
              background: '#2a2c30',
              border: '1px solid #444',
              borderRadius: 3,
              fontSize: 12,
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
