/**
 * Schematic print/plot output. Counterparts: `eeschema/sch_plotter.cpp`
 * (SCH_PLOTTER — the Plot dialog's file writers) and `eeschema/printing/
 * sch_printout.cpp` (SCH_PRINTOUT — the Print dialog's page rendering).
 *
 * Both reuse the on-screen schematic renderer: a sheet is drawn at page size
 * with the grid/cursor off and the drawing sheet + colours chosen by the
 * dialog. Raster outputs (PNG, and the PDF's embedded image, and Print) go
 * through a real `<canvas>`; the SVG output goes through a tiny Canvas2D-shaped
 * adapter that records the same draw calls as vector `<path>`/`<image>` markup.
 */

import type { Schematic } from '@ziroeda/eeschema';
import type { WksSheet } from '@ziroeda/common';
import type { Theme } from '../theme.js';
import { KICAD_CLASSIC } from '../theme.js';
import { renderSchematic, paperSizeIU, setVectorText, type RenderOpts } from './renderer.js';

const MM = 10000; // IU per mm (matches the renderer)

/** Print/Plot options shared by the dialogs (SCH_PLOT_OPTS subset). */
export interface PlotOpts {
  /** Colour output (false = black and white, KiCad's m_blackAndWhite). */
  color: boolean;
  /** Draw the page border + title block (m_plotDrawingSheet). */
  drawingSheet: boolean;
  /** Custom drawing sheet to plot (a loaded `.kicad_wks`); unset = default. */
  sheet?: WksSheet;
  /** Fill the page with the theme background colour (m_useBackgroundColor). */
  background: boolean;
  /** Raster resolution for PNG/PDF output (the PNG Options DPI; default 300). */
  dpi?: number;
  /** Pen width (IU) for zero-width strokes ("Minimum line width"). */
  defaultPenIU?: number;
  /** Effective junction-dot diameter (IU) from the schematic settings
   *  (SCHEMATIC_SETTINGS::GetJunctionSize()), so plots match the screen. */
  junctionDiameterIU?: number;
  /** Dashed-line dash / gap ratios and the label/pin text lift ratio from the
   *  schematic settings (m_DashedLine*Ratio, m_TextOffsetRatio). */
  dashLengthRatio?: number;
  gapLengthRatio?: number;
  textOffsetRatio?: number;
  /** Global-label box margin + overbar offset ratios (m_LabelSizeRatio,
   *  FONT_METRICS m_OverbarHeight), so plots match the screen. */
  labelSizeRatio?: number;
  overbarHeightRatio?: number;
  /** Pin decoration size in IU (m_PinSymbolSize; 0 = per-pin fallback). */
  pinSymbolSizeIU?: number;
  /** Per-item netclass fallbacks for the plotted sheet (RenderOpts shape). */
  netOverrides?: RenderOpts['netOverrides'];
  /** Text-variable resolver, so `${VAR}` plots expanded like the screen. */
  resolveTextVar?: RenderOpts['resolveTextVar'];
  /** Unit-notation inputs for multi-unit references (SubReference). */
  subpart?: RenderOpts['subpart'];
}

/** An all-black-on-white theme for monochrome output (KiCad's B&W plot). */
function monochromeTheme(): Theme {
  const black = 'rgb(0, 0, 0)';
  const none = 'rgba(0, 0, 0, 0)';
  return {
    background: 'rgb(255, 255, 255)',
    grid: black,
    wire: black,
    bus: black,
    busJunction: black,
    junction: black,
    symbolOutline: black,
    symbolFill: none,
    pin: black,
    pinName: black,
    pinNumber: black,
    reference: black,
    value: black,
    fields: black,
    label: black,
    globalLabel: black,
    hierLabel: black,
    netHighlight: black,
    selectionShadow: none,
    noteLine: black,
    noText: black,
    privateNote: black,
    noConnect: black,
    ercError: black,
    ercWarning: black,
    sheetBorder: black,
    sheetBackground: none,
    sheetName: black,
    sheetFile: black,
    sheetLabel: black,
    sheetFields: black,
    pageFrame: black,
    pageLimits: black,
    anchor: black,
    hidden: black,
    cursor: black,
  };
}

/** The theme to plot/print with, given the base editor theme and options. */
function outputTheme(base: Theme, opts: PlotOpts): Theme {
  if (!opts.color) return monochromeTheme();
  // Colour output on a white page unless "background colour" is requested.
  const bg = opts.background ? base.background : 'rgb(255, 255, 255)';
  return { ...base, background: bg };
}

/** Render options for output: no grid, no page-limit outline, drawing sheet per option. */
function outputRenderOpts(opts: PlotOpts): RenderOpts {
  return {
    showHiddenPins: false,
    showHiddenFields: false,
    showPageLimits: false,
    showDrawingSheet: opts.drawingSheet,
    ...(opts.sheet ? { drawingSheet: opts.sheet } : {}),
    defaultPenIU: opts.defaultPenIU,
    junctionDiameterIU: opts.junctionDiameterIU,
    dashLengthRatio: opts.dashLengthRatio,
    gapLengthRatio: opts.gapLengthRatio,
    textOffsetRatio: opts.textOffsetRatio,
    labelSizeRatio: opts.labelSizeRatio,
    overbarHeightRatio: opts.overbarHeightRatio,
    pinSymbolSizeIU: opts.pinSymbolSizeIU,
    netOverrides: opts.netOverrides,
    resolveTextVar: opts.resolveTextVar,
    subpart: opts.subpart,
    selectionThicknessMils: 0,
    highlightThicknessMils: 0,
    grid: { show: false, sizeIU: 12700, style: 'dots', lineWidthPx: 1, minSpacingPx: 10 },
  };
}

/** Page size in IU for a sheet (falls back to A4 landscape if unknown). */
export function pageIU(sch: Schematic): { w: number; h: number } {
  return paperSizeIU(sch.paper) ?? { w: 297 * MM, h: 210 * MM };
}

/**
 * Render a sheet to a fresh canvas at `dpi`, fit to the page rectangle
 * (0,0)-(pageW,pageH). Returns the canvas so callers can print, download a
 * PNG, or embed it in a PDF.
 */
export function renderSheetToCanvas(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  dpi = 300,
): HTMLCanvasElement {
  const page = pageIU(sch);
  const pxPerIU = dpi / 25.4 / MM; // dpi → px per mm → px per IU
  const cw = Math.max(1, Math.round(page.w * pxPerIU));
  const ch = Math.max(1, Math.round(page.h * pxPerIU));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const theme = outputTheme(base, opts);
  renderSchematic(
    ctx,
    sch,
    { scale: pxPerIU, offsetX: 0, offsetY: 0 },
    theme,
    cw,
    ch,
    undefined,
    undefined,
    outputRenderOpts(opts),
  );
  return canvas;
}

/** Trigger a browser download of a Blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Plot to PNG (raster) and download at the requested DPI (default 300). */
export async function plotPng(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
): Promise<void> {
  const canvas = renderSheetToCanvas(sch, base, opts, opts.dpi ?? 300);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) downloadBlob(blob, `${name}.png`);
}

/** Plot to a single-page PDF with the rendered sheet embedded (JPEG/DCTDecode). */
export async function plotPdf(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
): Promise<void> {
  const canvas = renderSheetToCanvas(sch, base, opts, opts.dpi ?? 300);
  const page = pageIU(sch);
  // PDF user space is 72 pt/inch; page size in points from the mm page size.
  const ptW = (page.w / MM / 25.4) * 72;
  const ptH = (page.h / MM / 25.4) * 72;
  const jpeg = dataUriToBytes(canvas.toDataURL('image/jpeg', 0.92));
  const blob = buildImagePdf(jpeg, canvas.width, canvas.height, ptW, ptH);
  downloadBlob(blob, `${name}.pdf`);
}

/** Plot to a true-vector SVG and download. */
export function plotSvg(sch: Schematic, base: Theme, opts: PlotOpts, name: string): void {
  const svg = sheetToSvg(sch, base, opts);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
}

// ----- SVG output (vector) ---------------------------------------------------

/** Render a sheet to an SVG document string, at 1 user unit = 1 mm. */
export function sheetToSvg(sch: Schematic, base: Theme, opts: PlotOpts): string {
  const page = pageIU(sch);
  const wMM = page.w / MM;
  const hMM = page.h / MM;
  // Draw in IU, then a viewBox in IU with an mm-sized viewport keeps line
  // widths (which the renderer sets in IU) correct.
  const svg = new SvgContext(page.w, page.h);
  const theme = outputTheme(base, opts);
  // Stroke glyph text as line segments so the adapter records it as vector paths.
  setVectorText(true);
  try {
    renderSchematic(
      svg as unknown as CanvasRenderingContext2D,
      sch,
      { scale: 1, offsetX: 0, offsetY: 0 },
      theme,
      page.w,
      page.h,
      undefined,
      undefined,
      outputRenderOpts(opts),
    );
  } finally {
    setVectorText(false);
  }
  return svg.toString(wMM, hMM);
}

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, t: Mat): Mat {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

/**
 * The minimal subset of CanvasRenderingContext2D the schematic renderer uses,
 * recording each draw as SVG markup. Transforms are emitted as a `matrix(...)`
 * attribute so stroke widths and dashes stay in local (pre-transform) units,
 * exactly as canvas treats them.
 */
class SvgContext {
  private out: string[] = [];
  private ctm: Mat = IDENT;
  private stack: { ctm: Mat; fill: string; stroke: string; lw: number; dash: number[] }[] = [];
  private path: string[] = [];
  private curX = NaN;
  private curY = NaN;
  private startX = NaN;
  private startY = NaN;

  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '';
  textAlign = '';
  private dash: number[] = [];

  constructor(
    private pw: number,
    private ph: number,
  ) {}

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.ctm = mul(this.ctm, [1, 0, 0, 1, x, y]);
  }
  rotate(t: number): void {
    this.ctm = mul(this.ctm, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
  }
  save(): void {
    this.stack.push({
      ctm: this.ctm,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      lw: this.lineWidth,
      dash: this.dash,
    });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.ctm = s.ctm;
    this.fillStyle = s.fill;
    this.strokeStyle = s.stroke;
    this.lineWidth = s.lw;
    this.dash = s.dash;
  }
  setLineDash(d: number[]): void {
    this.dash = d;
  }

  beginPath(): void {
    this.path = [];
    this.curX = this.curY = this.startX = this.startY = NaN;
  }
  moveTo(x: number, y: number): void {
    this.path.push(`M${n(x)} ${n(y)}`);
    this.curX = this.startX = x;
    this.curY = this.startY = y;
  }
  lineTo(x: number, y: number): void {
    this.path.push(`L${n(x)} ${n(y)}`);
    this.curX = x;
    this.curY = y;
  }
  closePath(): void {
    this.path.push('Z');
    this.curX = this.startX;
    this.curY = this.startY;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`);
    this.curX = this.startX = x;
    this.curY = this.startY = y;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    const sx = cx + r * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    this.path.push(Number.isNaN(this.curX) ? `M${n(sx)} ${n(sy)}` : `L${n(sx)} ${n(sy)}`);
    let span = a1 - a0;
    if (ccw) {
      if (span > 0) span -= 2 * Math.PI;
    } else if (span < 0) span += 2 * Math.PI;
    const sweep = ccw ? 0 : 1;
    if (Math.abs(span) >= 2 * Math.PI - 1e-6) {
      // Full circle: two half-arcs (SVG can't draw a 360° arc in one command).
      const mx = cx - r * Math.cos(a0);
      const my = cy - r * Math.sin(a0);
      this.path.push(`A${n(r)} ${n(r)} 0 1 ${sweep} ${n(mx)} ${n(my)}`);
      this.path.push(`A${n(r)} ${n(r)} 0 1 ${sweep} ${n(sx)} ${n(sy)}`);
      this.curX = sx;
      this.curY = sy;
      return;
    }
    const ex = cx + r * Math.cos(a1);
    const ey = cy + r * Math.sin(a1);
    const large = Math.abs(span) > Math.PI ? 1 : 0;
    this.path.push(`A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(ex)} ${n(ey)}`);
    this.curX = ex;
    this.curY = ey;
  }

  stroke(): void {
    if (!this.path.length) return;
    this.out.push(
      `<path d="${this.path.join(' ')}" fill="none" stroke="${esc(this.strokeStyle)}" ` +
        `stroke-width="${n(this.lineWidth)}" stroke-linecap="${this.lineCap === 'round' ? 'round' : 'butt'}" ` +
        `stroke-linejoin="${this.lineJoin === 'round' ? 'round' : 'miter'}"` +
        this.dashAttr() +
        this.tf() +
        '/>',
    );
  }
  fill(): void {
    if (!this.path.length) return;
    this.out.push(
      `<path d="${this.path.join(' ')}" fill="${esc(this.fillStyle)}" stroke="none"${this.tf()}/>`,
    );
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ` +
        `stroke="${esc(this.strokeStyle)}" stroke-width="${n(this.lineWidth)}"` +
        this.dashAttr() +
        this.tf() +
        '/>',
    );
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(this.fillStyle)}"${this.tf()}/>`,
    );
  }
  fillText(text: string, x: number, y: number): void {
    this.out.push(
      `<text x="${n(x)}" y="${n(y)}" fill="${esc(this.fillStyle)}" text-anchor="middle"${this.tf()}>${escText(text)}</text>`,
    );
  }
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    const src = (img as HTMLImageElement).src ?? '';
    if (!src) return;
    this.out.push(
      `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${esc(src)}"${this.tf()}/>`,
    );
  }

  private dashAttr(): string {
    return this.dash.length ? ` stroke-dasharray="${this.dash.map(n).join(',')}"` : '';
  }
  private tf(): string {
    const m = this.ctm;
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return '';
    return ` transform="matrix(${m.map(n).join(' ')})"`;
  }

  toString(wMM: number, hMM: number): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(wMM)}mm" height="${n(hMM)}mm" ` +
      `viewBox="0 0 ${n(this.pw)} ${n(this.ph)}">\n` +
      this.out.join('\n') +
      `\n</svg>\n`
    );
  }
}

function n(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0';
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- minimal single-image PDF ---------------------------------------------

function dataUriToBytes(uri: string): Uint8Array {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Build a one-page PDF that shows `jpeg` (DCTDecode) filling a ptW×ptH page. */
function buildImagePdf(jpeg: Uint8Array, pxW: number, pxH: number, ptW: number, ptH: number): Blob {
  const enc = new TextEncoder();
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (chunk: string | Uint8Array): void => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    pos += bytes.length;
  };
  const obj = (i: number, body: string): void => {
    offsets[i] = pos;
    push(`${i} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xff\xff\xff\xff\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(ptW)} ${round(ptH)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  // Image XObject (JPEG stream).
  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  // Content stream: place the image to fill the page.
  const content = `q ${round(ptW)} 0 0 ${round(ptH)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xrefPos = pos;
  const count = 6;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

// ----- Print (browser) -------------------------------------------------------

/** Open the browser print flow for the rendered sheet (SCH_PRINTOUT). */
export function printSheet(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  title: string,
  preview = false,
): void {
  // Colour output prints as-is; B&W forces the monochrome theme. The print
  // window sizes the image to the page. "Print" auto-opens the browser print
  // flow on load; "Print Preview" (KiCad's Apply) just shows the rendered page
  // so the user can review it and print from the browser when ready.
  const canvas = renderSheetToCanvas(sch, opts.color ? base : KICAD_CLASSIC, opts, 300);
  const dataUrl = canvas.toDataURL('image/png');
  const page = pageIU(sch);
  const landscape = page.w >= page.h;
  const win = window.open('', '_blank');
  if (!win) return;
  const onload = preview ? 'window.focus();' : 'window.focus();window.print();';
  win.document.write(
    `<!doctype html><html><head><title>${escText(title)}</title>` +
      `<style>@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0; }` +
      `html,body { margin: 0; padding: 0; }` +
      `img { display: block; width: 100%; height: auto; }</style></head>` +
      `<body><img src="${dataUrl}" onload="${onload}"/></body></html>`,
  );
  win.document.close();
}
