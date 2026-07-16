/**
 * Image Converter frame — the browser counterpart of KiCad's `bitmap2cmp`
 * (`bitmap2cmp_frame.cpp` + `bitmap2cmp_panel.cpp`). The layout mirrors
 * `bitmap2cmp_panel_base`: a left preview notebook (Original / Greyscale /
 * Black & White) and a right column of groups — Image Information, Load Source
 * Image, Output Size, Options (threshold + negative), Output Format (with the
 * footprint Layer choice), then Export to File / Export to Clipboard.
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
import {
  convertOutputSize,
  formatOutputSize,
  initialOutputSize,
  outputDpi,
  SIZE_UNITS,
  type SizeUnit,
} from './imageSize.js';
import './imageConverter.css';

type Tab = 'original' | 'greyscale' | 'bw';

const TABS: { id: Tab; label: string }[] = [
  { id: 'original', label: 'Original Picture' },
  { id: 'greyscale', label: 'Greyscale Picture' },
  { id: 'bw', label: 'Black & White Picture' },
];

// KiCad's Output Format radio group (bitmap2cmp_panel_base), with the file
// extensions it shows and the engine format id each maps to.
const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'symbol', label: 'Symbol (.kicad_sym file)' },
  { id: 'footprint', label: 'Footprint (.kicad_mod file)' },
  { id: 'postscript', label: 'Postscript (.ps file)' },
  { id: 'drawingsheet', label: 'Drawing Sheet (.kicad_wks file)' },
];

const DEFAULT_DPI = 300; // KiCad's DEFAULT_DPI when the image carries no resolution

interface Loaded {
  name: string;
  w: number;
  h: number;
  bpp: number;
  originalDPI: number;
  original: ImageData;
  gray: GrayImage;
}

export function ImageConverter({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('bw');
  const [unit, setUnit] = useState<SizeUnit>('mm');
  const [outX, setOutX] = useState('0');
  const [outY, setOutY] = useState('0');
  const [lock, setLock] = useState(true);
  const [threshold, setThreshold] = useState(50); // slider 0..100, KiCad default 50
  const [negative, setNegative] = useState(false);
  const [format, setFormat] = useState<OutputFormat>('symbol');
  const [layerIdx, setLayerIdx] = useState(0);
  const [status, setStatus] = useState('Load a source image to begin.');
  const [aboutOpen, setAboutOpen] = useState(false);

  // The 1-bit bitmap shared by the Black & White preview and every export.
  // KiCad binarizes at threshold/max of the greyscale (0..255).
  const mono = useMemo(
    () => (loaded ? grayToMono(loaded.gray, (threshold / 100) * 255, negative) : null),
    [loaded, threshold, negative],
  );

  // Paint the active preview tab. The Greyscale tab shows the negated image when
  // Negative is on, exactly as KiCad negates the greyscale before binarizing.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !loaded) return;
    cv.width = loaded.w;
    cv.height = loaded.h;
    const cx = cv.getContext('2d');
    if (!cx) return;
    if (tab === 'original') cx.putImageData(loaded.original, 0, 0);
    else if (tab === 'greyscale') cx.putImageData(grayToRGBA(loaded.gray, negative), 0, 0);
    else if (mono) cx.putImageData(monoToRGBA(mono), 0, 0);
  }, [tab, loaded, mono, negative]);

  const loadFile = useCallback(
    async (file: File) => {
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
        const dpi = /\.png$/i.test(file.name) ? pngDpi(bytes) : DEFAULT_DPI;
        setLoaded({
          name: file.name.replace(/\.[^.]+$/, '') || 'LOGO',
          w,
          h,
          bpp: 24,
          originalDPI: dpi,
          original,
          gray,
        });
        // Seed the output size from the image at its native PPI (current unit).
        setOutX(formatOutputSize(initialOutputSize(w, dpi, unit), unit));
        setOutY(formatOutputSize(initialOutputSize(h, dpi, unit), unit));
        setTab('bw');
        setStatus(`Loaded ${file.name} — ${w} × ${h} px @ ${dpi} PPI`);
      } catch (e) {
        setStatus(`Could not load image: ${(e as Error).message}`);
      }
    },
    [unit],
  );

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

  // ---- Output Size box (KiCad's IMAGE_SIZE behaviour) ----
  const numX = Number(outX) || 0;
  const numY = Number(outY) || 0;
  const aspect = loaded ? loaded.w / loaded.h : 1; // KiCad m_aspectRatio = w / h

  const changeUnit = (next: SizeUnit): void => {
    if (loaded) {
      setOutX(formatOutputSize(convertOutputSize(numX, loaded.w, unit, next), next));
      setOutY(formatOutputSize(convertOutputSize(numY, loaded.h, unit, next), next));
    }
    setUnit(next);
  };
  const changeX = (text: string): void => {
    setOutX(text);
    if (!lock) return;
    const v = Number(text) || 0;
    const y = unit === 'dpi' ? (numX ? (numY * v) / numX : v) : v / aspect;
    setOutY(formatOutputSize(y, unit));
  };
  const changeY = (text: string): void => {
    setOutY(text);
    if (!lock) return;
    const v = Number(text) || 0;
    const x = unit === 'dpi' ? (numY ? (numX * v) / numY : v) : v * aspect;
    setOutX(formatOutputSize(x, unit));
  };

  const dpiX = loaded ? outputDpi(numX, loaded.w, unit) : DEFAULT_DPI;
  const dpiY = loaded ? outputDpi(numY, loaded.h, unit) : DEFAULT_DPI;

  const buildOutput = useCallback(() => {
    if (!loaded || !mono) return null;
    return convert(mono, {
      format,
      layer: OUTLINE_LAYERS[layerIdx]!.id,
      dpiX: dpiX > 0 ? dpiX : DEFAULT_DPI,
      dpiY: dpiY > 0 ? dpiY : DEFAULT_DPI,
      name: loaded.name || 'LOGO',
    });
  }, [loaded, mono, format, layerIdx, dpiX, dpiY]);

  const exportToFile = (): void => {
    const out = buildOutput();
    if (!out) {
      setStatus('Load a source image before exporting.');
      return;
    }
    const url = URL.createObjectURL(new Blob([out.text], { type: out.mime }));
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
      setStatus('Load a source image before exporting.');
      return;
    }
    try {
      await navigator.clipboard.writeText(out.text);
      setStatus('Copied output to the clipboard.');
    } catch {
      setStatus('Clipboard unavailable in this browser; use Export to File instead.');
    }
  };

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Load Source Image…', action: () => fileInputRef.current?.click() },
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

  const footprint = format === 'footprint';

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
        {/* left: preview notebook (KiCad's wxNotebook) */}
        <div className="imgc-notebook">
          <div className="imgc-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
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
          <div className="imgc-view" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {loaded ? (
              <canvas ref={canvasRef} className="imgc-canvas" />
            ) : (
              <div className="imgc-drop">
                <div className="imgc-drop-title">No image loaded</div>
                <div>Click “Load Source Image”, or drop a bitmap here.</div>
              </div>
            )}
          </div>
        </div>

        {/* right: controls (KiCad's brightSizer, group by group) */}
        <div className="imgc-side">
          <fieldset className="imgc-group">
            <legend>Image Information</legend>
            <div className="imgc-info">
              <span className="k">Image size:</span>
              <span className="v">{loaded ? loaded.w : 0}</span>
              <span className="v">{loaded ? loaded.h : 0}</span>
              <span className="u">pixels</span>

              <span className="k">Image PPI:</span>
              <span className="v">{loaded ? loaded.originalDPI : 0}</span>
              <span className="v">{loaded ? loaded.originalDPI : 0}</span>
              <span className="u">PPI</span>

              <span className="k">BPP:</span>
              <span className="v">{loaded ? loaded.bpp : 0}</span>
              <span className="v" />
              <span className="u">bits</span>
            </div>
          </fieldset>

          <button
            type="button"
            className="imgc-btn block"
            onClick={() => fileInputRef.current?.click()}
          >
            Load Source Image
          </button>

          <fieldset className="imgc-group">
            <legend>Output Size</legend>
            <div className="imgc-sizerow">
              <span className="lbl">Size:</span>
              <input
                className="imgc-input"
                value={outX}
                disabled={!loaded}
                onChange={(e) => changeX(e.target.value)}
                spellCheck={false}
              />
              <input
                className="imgc-input"
                value={outY}
                disabled={!loaded}
                onChange={(e) => changeY(e.target.value)}
                spellCheck={false}
              />
              <select
                className="imgc-select"
                value={unit}
                disabled={!loaded}
                onChange={(e) => changeUnit(e.target.value as SizeUnit)}
              >
                {SIZE_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="imgc-check">
              <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              Lock height / width ratio
            </label>
          </fieldset>

          <fieldset className="imgc-group">
            <legend>Options</legend>
            <span className="imgc-thresh-label">Black / white threshold:</span>
            <div className="imgc-slider">
              <input
                type="range"
                min={0}
                max={100}
                value={threshold}
                disabled={!loaded}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span className="imgc-slider-val">{threshold}</span>
            </div>
            <label className="imgc-check">
              <input
                type="checkbox"
                checked={negative}
                onChange={(e) => setNegative(e.target.checked)}
              />
              Negative
            </label>
          </fieldset>

          <fieldset className="imgc-group">
            <legend>Output Format</legend>
            {FORMATS.map((f) => (
              <div key={f.id}>
                <label className="imgc-radio">
                  <input
                    type="radio"
                    name="imgc-format"
                    checked={format === f.id}
                    onChange={() => setFormat(f.id)}
                  />
                  {f.label}
                </label>
                {f.id === 'footprint' && (
                  <div className="imgc-layerrow">
                    <span className="lbl">Layer:</span>
                    <select
                      className="imgc-select grow"
                      value={layerIdx}
                      disabled={!footprint}
                      onChange={(e) => setLayerIdx(Number(e.target.value))}
                    >
                      {OUTLINE_LAYERS.map((l, i) => (
                        <option key={l.id} value={i}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </fieldset>

          <button
            type="button"
            className="imgc-btn block primary"
            onClick={exportToFile}
            disabled={!loaded}
          >
            Export to File…
          </button>
          <button
            type="button"
            className="imgc-btn block"
            onClick={() => void exportToClipboard()}
            disabled={!loaded}
          >
            Export to Clipboard
          </button>
        </div>
      </div>

      <div className="imgc-statusbar">
        <span className="cell grow">{status}</span>
        <span className="cell">
          {loaded ? `Output DPI: ${Math.round(dpiX)} × ${Math.round(dpiY)}` : 'No image'}
        </span>
      </div>

      {aboutOpen && (
        <div className="imgc-modal-backdrop" onMouseDown={() => setAboutOpen(false)}>
          <div className="imgc-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="imgc-modal-head">
              <span>About Image Converter</span>
              <button
                type="button"
                className="imgc-modal-x"
                onClick={() => setAboutOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="imgc-modal-body">
              <p style={{ marginTop: 0 }}>
                Convert a bitmap image into KiCad artwork, like KiCad's Image Converter
                (bitmap2component): the picture is reduced to greyscale, thresholded to black &
                white, then traced with potrace into filled polygons.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Symbol — a schematic library symbol (.kicad_sym)</li>
                <li>Footprint — a PCB footprint (.kicad_mod) on the chosen layer</li>
                <li>Postscript — an encapsulated PostScript drawing (.ps)</li>
                <li>Drawing Sheet — a worksheet graphic (.kicad_wks)</li>
              </ul>
            </div>
            <div className="imgc-modal-foot">
              <button
                type="button"
                className="imgc-btn primary"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
