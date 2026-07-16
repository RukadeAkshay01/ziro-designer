/**
 * Image Converter frame — the browser counterpart of KiCad's `bitmap2cmp`
 * (`bitmap2cmp_frame.cpp` + `bitmap2cmp_panel.cpp`). Load a bitmap, preview it
 * as original / greyscale / black&white, tune the DPI, threshold and negative,
 * then export the traced artwork as a symbol, footprint, PostScript drawing, or
 * drawing sheet — the same controls and workflow as the desktop tool.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { pngDpi } from '../drawingsheet/wksBitmap.js';
import {
  convert,
  grayToMono,
  grayToRGBA,
  imageToGray,
  monoToRGBA,
  OUTLINE_LAYERS,
  type GrayImage,
  type OutputFormat,
} from './bitmap2component.js';
import './imageConverter.css';

type Tab = 'original' | 'greyscale' | 'bw';

const TABS: { id: Tab; label: string }[] = [
  { id: 'original', label: 'Original Picture' },
  { id: 'greyscale', label: 'Greyscale Picture' },
  { id: 'bw', label: 'Black&White Picture' },
];

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'symbol', label: 'Symbol (KiCad)' },
  { id: 'footprint', label: 'Footprint (KiCad)' },
  { id: 'postscript', label: 'Postscript' },
  { id: 'drawingsheet', label: 'Drawing Sheet (KiCad)' },
];

interface Loaded {
  name: string;
  w: number;
  h: number;
  original: ImageData;
  gray: GrayImage;
}

const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

export function ImageConverter({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('original');
  const [dpiX, setDpiX] = useState(300);
  const [dpiY, setDpiY] = useState(300);
  const [lockDpi, setLockDpi] = useState(true);
  const [threshold, setThreshold] = useState(128);
  const [negative, setNegative] = useState(false);
  const [format, setFormat] = useState<OutputFormat>('symbol');
  const [layer, setLayer] = useState(OUTLINE_LAYERS[0]!.id);
  const [status, setStatus] = useState('Load a bitmap image to begin.');
  const [aboutOpen, setAboutOpen] = useState(false);

  // The black&white bitmap the previews and export share (threshold + negative).
  const mono = useMemo(
    () => (loaded ? grayToMono(loaded.gray, threshold, negative) : null),
    [loaded, threshold, negative],
  );

  // Paint the active preview tab onto the canvas.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !loaded) return;
    cv.width = loaded.w;
    cv.height = loaded.h;
    const cx = cv.getContext('2d');
    if (!cx) return;
    if (tab === 'original') cx.putImageData(loaded.original, 0, 0);
    else if (tab === 'greyscale') cx.putImageData(grayToRGBA(loaded.gray), 0, 0);
    else if (mono) cx.putImageData(monoToRGBA(mono), 0, 0);
  }, [tab, loaded, mono]);

  const loadFile = useCallback(async (file: File) => {
    setStatus(`Loading ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bmp = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/png' }));
      const w = bmp.width;
      const h = bmp.height;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const cx = cv.getContext('2d');
      if (!cx) throw new Error('Cannot get a 2D drawing context.');
      cx.drawImage(bmp, 0, 0);
      bmp.close();
      const original = cx.getImageData(0, 0, w, h);
      const gray = imageToGray(original.data, w, h);
      const dpi = /\.png$/i.test(file.name) ? pngDpi(bytes) : 300;
      setDpiX(dpi);
      setDpiY(dpi);
      setLoaded({ name: file.name.replace(/\.[^.]+$/, ''), w, h, original, gray });
      setTab('original');
      setStatus(`Loaded ${file.name} — ${w} × ${h} px`);
    } catch (e) {
      setStatus(`Could not load image: ${(e as Error).message}`);
    }
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) void loadFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && /^image\//.test(f.type || '')) void loadFile(f);
  };

  const setDpi = (axis: 'x' | 'y', value: number): void => {
    const v = Number.isFinite(value) && value > 0 ? value : 1;
    if (lockDpi) {
      setDpiX(v);
      setDpiY(v);
    } else if (axis === 'x') setDpiX(v);
    else setDpiY(v);
  };

  const buildOutput = useCallback(() => {
    if (!loaded || !mono) return null;
    return convert(mono, { format, layer, dpiX, dpiY, name: loaded.name || 'LOGO' });
  }, [loaded, mono, format, layer, dpiX, dpiY]);

  const exportToFile = (): void => {
    const out = buildOutput();
    if (!out) {
      setStatus('Load a bitmap image before exporting.');
      return;
    }
    const blob = new Blob([out.text], { type: out.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${out.filename}`);
  };

  const exportToClipboard = async (): Promise<void> => {
    const out = buildOutput();
    if (!out) {
      setStatus('Load a bitmap image before exporting.');
      return;
    }
    try {
      await navigator.clipboard.writeText(out.text);
      setStatus('Copied output to the clipboard — paste into an editor.');
    } catch {
      setStatus('Clipboard is unavailable in this browser; use Export to File instead.');
    }
  };

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Load Bitmap…', action: () => fileInputRef.current?.click() },
        { label: 'Export to File…', action: exportToFile, disabled: !loaded },
        { label: 'Export to Clipboard', action: () => void exportToClipboard(), disabled: !loaded },
        { sep: true },
        { label: 'Close', action: onExitToHome },
      ],
    },
    {
      label: 'Help',
      items: [{ label: 'About Image Converter', action: () => setAboutOpen(true) }],
    },
  ];

  const mmX = loaded ? (loaded.w * 25.4) / dpiX : 0;
  const mmY = loaded ? (loaded.h * 25.4) / dpiY : 0;

  return (
    <div className="imgc-frame ze-app">
      <MenuBar menus={menus} title="Image Converter" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/bmp,image/gif,image/webp,image/*"
        style={{ display: 'none' }}
        onChange={onPick}
      />
      <div className="imgc-body">
        {/* left: preview notebook */}
        <div className="imgc-preview">
          <div className="imgc-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`imgc-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
                disabled={!loaded}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="imgc-canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {loaded ? (
              <canvas ref={canvasRef} className="imgc-canvas" />
            ) : (
              <div className="imgc-empty">
                <p>No image loaded.</p>
                <p className="hint">Click “Load Bitmap…” or drop an image here.</p>
              </div>
            )}
          </div>
        </div>

        {/* right: controls */}
        <div className="imgc-controls">
          <fieldset className="imgc-group">
            <legend>Bitmap Info</legend>
            <div className="imgc-grid">
              <span className="lbl" />
              <span className="col-h">X</span>
              <span className="col-h">Y</span>

              <span className="lbl">Size (pixels):</span>
              <span className="val">{loaded ? loaded.w : '—'}</span>
              <span className="val">{loaded ? loaded.h : '—'}</span>

              <span className="lbl">Size (mm):</span>
              <span className="val">{loaded ? round2(mmX) : '—'}</span>
              <span className="val">{loaded ? round2(mmY) : '—'}</span>

              <span className="lbl">Bits/pixel:</span>
              <span className="val">{loaded ? 24 : '—'}</span>
              <span className="val" />

              <span className="lbl">Image DPI:</span>
              <input
                className="dpi"
                type="number"
                min={1}
                value={dpiX}
                disabled={!loaded}
                onChange={(e) => setDpi('x', Number(e.target.value))}
              />
              <input
                className="dpi"
                type="number"
                min={1}
                value={dpiY}
                disabled={!loaded || lockDpi}
                onChange={(e) => setDpi('y', Number(e.target.value))}
              />
            </div>
            <label className="imgc-check">
              <input
                type="checkbox"
                checked={lockDpi}
                onChange={(e) => {
                  setLockDpi(e.target.checked);
                  if (e.target.checked) setDpiY(dpiX);
                }}
              />
              Lock X/Y resolution
            </label>
          </fieldset>

          <div className="imgc-buttons">
            <button className="imgc-btn" onClick={() => fileInputRef.current?.click()}>
              Load Bitmap…
            </button>
            <button className="imgc-btn primary" onClick={exportToFile} disabled={!loaded}>
              Export to File…
            </button>
            <button
              className="imgc-btn"
              onClick={() => void exportToClipboard()}
              disabled={!loaded}
            >
              Export to Clipboard
            </button>
          </div>

          <fieldset className="imgc-group">
            <legend>Output Format</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className="imgc-radio">
                <input
                  type="radio"
                  name="imgc-format"
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                />
                {f.label}
              </label>
            ))}
          </fieldset>

          <fieldset className="imgc-group">
            <legend>Board Layer for Outline</legend>
            <select
              className="imgc-select"
              value={layer}
              disabled={format !== 'footprint'}
              onChange={(e) => setLayer(e.target.value)}
            >
              {OUTLINE_LAYERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="imgc-group">
            <legend>Options</legend>
            <label className="imgc-check">
              <input
                type="checkbox"
                checked={negative}
                onChange={(e) => setNegative(e.target.checked)}
              />
              Negative
            </label>
            <label className="imgc-slabel" htmlFor="imgc-threshold">
              Black / white threshold: <b>{threshold}</b>
            </label>
            <input
              id="imgc-threshold"
              className="imgc-slider"
              type="range"
              min={0}
              max={255}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </fieldset>
        </div>
      </div>

      <div className="imgc-statusbar">
        <span className="cell grow">{status}</span>
        <span className="cell">{loaded ? `${loaded.w} × ${loaded.h} px` : 'No image'}</span>
      </div>

      {aboutOpen && (
        <div className="imgc-modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="imgc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>About Image Converter</h3>
            <p>
              Convert a bitmap image into KiCad artwork, the way KiCad's Image Converter
              (bitmap2component) does: the picture is reduced to greyscale, thresholded to black &
              white, then traced with potrace into filled polygons.
            </p>
            <ul>
              <li>Symbol — a schematic library symbol (.kicad_sym)</li>
              <li>Footprint — a PCB footprint (.kicad_mod) on the chosen layer</li>
              <li>Postscript — an encapsulated PostScript drawing (.ps)</li>
              <li>Drawing Sheet — a worksheet graphic (.kicad_wks)</li>
            </ul>
            <div className="imgc-modal-foot">
              <button className="imgc-btn primary" onClick={() => setAboutOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
