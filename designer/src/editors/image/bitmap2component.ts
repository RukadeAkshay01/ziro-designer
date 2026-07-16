/**
 * Image → KiCad geometry pipeline.
 *
 * The web counterpart of KiCad's `bitmap2component/bitmap2component.cpp`
 * (`BITMAPCONV_INFO`): take a bitmap, reduce it to greyscale, threshold it to a
 * 1-bit image, trace that with potrace, then emit the traced polygons as a
 * schematic symbol, a PCB footprint, an EPS/PostScript drawing, or a drawing
 * sheet — one filled polygon per traced outline, holes cut out.
 *
 * The scale/offset/sign for each output format matches `CreateOutputFile`
 * exactly: the emitted millimetre coordinate is `(pixel − centre) · 25.4 / DPI`,
 * with Y negated for the symbol (schematic libraries are Y-up) and flipped for
 * PostScript (PS is Y-up from the bottom-left).
 */

import { traceBitmap, Bitmap, Pt, DEFAULT_TRACE_PARAMS, type Path } from './potrace.js';
import { fractureWithHoles, signedArea, pointInPolygon } from './geometry.js';

/** File version tokens, matching the eeschema / pcbnew writers in this repo (KiCad 9.0). */
const SEXPR_SYMBOL_LIB_FILE_VERSION = 20241209;
const SEXPR_FOOTPRINT_FILE_VERSION = 20241229;
const SEXPR_WKS_FILE_VERSION = 20220228;
const GENERATOR_VERSION = '9.0';
/** KiCad's SCH_LINE_THICKNESS_MM used for symbol polyline strokes. */
const SCH_LINE_THICKNESS_MM = 0.01;

export type OutputFormat = 'symbol' | 'footprint' | 'postscript' | 'drawingsheet';

/** A selectable board layer for the footprint outline (bitmap2cmp's "Board Layer for Outline"). */
export interface LayerChoice {
  /** File layer name, e.g. `F.SilkS`. */
  id: string;
  /** Human label shown in the dropdown. */
  label: string;
}

/**
 * The "Layer:" choices offered by KiCad's Image Converter, in the exact order
 * and with the exact display labels of `bitmap2cmp_panel_base` — the label is
 * what the dropdown shows, the id is the file layer name it maps to
 * (`ExportToBuffer`'s switch). Index 0 (F.Cu) is the KiCad default.
 */
export const OUTLINE_LAYERS: LayerChoice[] = [
  { id: 'F.Cu', label: 'F.Cu' },
  { id: 'F.SilkS', label: 'F.Silkscreen' },
  { id: 'F.Mask', label: 'F.Mask' },
  { id: 'Dwgs.User', label: 'User.Drawings' },
  { id: 'Cmts.User', label: 'User.Comments' },
  { id: 'Eco1.User', label: 'User.Eco1' },
  { id: 'Eco2.User', label: 'User.Eco2' },
  { id: 'F.Fab', label: 'F.Fab' },
];

export interface ConvertOptions {
  format: OutputFormat;
  /** Footprint outline layer (ignored for other formats). */
  layer: string;
  dpiX: number;
  dpiY: number;
  /** Component / symbol / footprint name. */
  name: string;
}

// ----- image processing (greyscale + threshold) -------------------------------

export interface GrayImage {
  w: number;
  h: number;
  /** One luminance byte per pixel, 0 (black) … 255 (white); transparency flattened onto white. */
  gray: Uint8ClampedArray;
}

/**
 * Reduce RGBA image data to greyscale, KiCad's Rec. 601 luma
 * (`0.299 R + 0.587 G + 0.114 B`), compositing any alpha over a white
 * background so transparent pixels read as background.
 */
export function imageToGray(data: Uint8ClampedArray, w: number, h: number): GrayImage {
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const a = data[i * 4 + 3]! / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum * a + 255 * (1 - a);
  }
  return { w, h, gray };
}

/**
 * Threshold a greyscale image to a 1-bit bitmap for tracing. A pixel is
 * foreground (bit 1) when it is darker than the threshold; `negative` inverts
 * that, exactly like the panel's Negative checkbox.
 */
export function grayToMono(img: GrayImage, threshold: number, negative: boolean): Bitmap {
  const bm = new Bitmap(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    const dark = img.gray[i]! < threshold;
    bm.data[i] = dark !== negative ? 1 : 0;
  }
  return bm;
}

/** Render the 1-bit bitmap back to black/white RGBA for the "Black&White" preview tab. */
export function monoToRGBA(bm: Bitmap): ImageData {
  const out = new Uint8ClampedArray(bm.w * bm.h * 4);
  for (let i = 0; i < bm.w * bm.h; i++) {
    const v = bm.data[i] === 1 ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return new ImageData(out, bm.w, bm.h);
}

/**
 * Render greyscale bytes to RGBA for the "Greyscale" preview tab. With
 * `negative`, the levels are inverted — KiCad negates the greyscale image
 * itself when Negative is ticked, so the preview shows the negated version.
 */
export function grayToRGBA(img: GrayImage, negative = false): ImageData {
  const out = new Uint8ClampedArray(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const v = negative ? 255 - img.gray[i]! : img.gray[i]!;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return new ImageData(out, img.w, img.h);
}

// ----- curve tessellation -----------------------------------------------------

function isFlat(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number): boolean {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - p0.x - 2 * p3.x;
  const vy = 3 * p2.y - p0.y - 2 * p3.y;
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= 16 * tol * tol;
}

function flattenBezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[], depth = 0): void {
  if (depth >= 18 || isFlat(p0, p1, p2, p3, 0.1)) {
    out.push(p3);
    return;
  }
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const m = mid(p012, p123);
  flattenBezier(p0, p01, p012, m, out, depth + 1);
  flattenBezier(m, p123, p23, p3, out, depth + 1);
}
const mid = (a: Pt, b: Pt): Pt => new Pt((a.x + b.x) / 2, (a.y + b.y) / 2);

/**
 * Walk one traced path into a closed polygon, exactly as
 * `CreateOutputFile` walks potrace's curve: a CORNER contributes its two
 * straight legs, a CURVE is flattened from the running start point.
 */
export function tessellatePath(path: Path): Pt[] {
  const c = path.controls;
  const tags = path.tags;
  const n = path.n;
  const out: Pt[] = [];
  let start = c[(n - 1) * 3 + 2]!;
  for (let i = 0; i < n; i++) {
    if (tags[i] === 'CORNER') {
      out.push(c[i * 3 + 1]!);
      out.push(c[i * 3 + 2]!);
    } else {
      flattenBezier(start, c[i * 3 + 0]!, c[i * 3 + 1]!, c[i * 3 + 2]!, out);
    }
    start = c[i * 3 + 2]!;
  }
  return out;
}

// ----- grouping outlines with their holes -------------------------------------

interface Poly {
  pts: Pt[];
  area: number;
}

/** An outline polygon with the hole polygons cut out of it. */
export interface Region {
  outer: Pt[];
  holes: Pt[][];
}

/**
 * Trace the bitmap and group the result into filled regions using the even-odd
 * rule: a contour nested an even number of deep is a filled outline, an odd one
 * a hole cut from its immediate (smallest containing) outline. potrace's XOR
 * decomposition already emits every boundary once, so nesting parity — not the
 * raw path sign — is what tells outlines from holes, exactly as KiCad's
 * `SHAPE_POLY_SET` boolean does.
 */
export function traceRegions(bm: Bitmap): Region[] {
  const paths = traceBitmap(bm, DEFAULT_TRACE_PARAMS);
  const polys: Poly[] = [];
  for (const p of paths) {
    const pts = tessellatePath(p);
    if (pts.length >= 3) polys.push({ pts, area: Math.abs(signedArea(pts)) });
  }

  // For each polygon: its containment depth and its immediate parent (the
  // smallest-area polygon that strictly contains it).
  const parent = new Array<number>(polys.length).fill(-1);
  const depth = new Array<number>(polys.length).fill(0);
  for (let i = 0; i < polys.length; i++) {
    const probe = polys[i]!.pts[0]!;
    let bestArea = Infinity;
    for (let j = 0; j < polys.length; j++) {
      if (i === j) continue;
      const o = polys[j]!;
      if (o.area <= polys[i]!.area) continue;
      if (pointInPolygon(probe, o.pts)) {
        depth[i]!++;
        if (o.area < bestArea) {
          bestArea = o.area;
          parent[i] = j;
        }
      }
    }
  }

  // Even depth → outline (its own region); odd depth → hole of its parent.
  const regionOf = new Array<Region | null>(polys.length).fill(null);
  const regions: Region[] = [];
  for (let i = 0; i < polys.length; i++) {
    if (depth[i]! % 2 === 0) {
      const region: Region = { outer: polys[i]!.pts, holes: [] };
      regionOf[i] = region;
      regions.push(region);
    }
  }
  for (let i = 0; i < polys.length; i++) {
    if (depth[i]! % 2 === 1 && parent[i]! >= 0) {
      const region = regionOf[parent[i]!];
      if (region) region.holes.push(polys[i]!.pts);
    }
  }
  return regions;
}

// ----- coordinate transforms per output format --------------------------------

/** Number → trimmed decimal string (KiCad's formatInternalUnits, no trailing zeros). */
function fmt(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

type XForm = (p: Pt) => { x: number; y: number };

function makeXForm(fmtId: OutputFormat, w: number, h: number, dpiX: number, dpiY: number): XForm {
  const cx = w / 2;
  const cy = h / 2;
  const sx = 25.4 / dpiX;
  const sy = 25.4 / dpiY;
  switch (fmtId) {
    case 'symbol':
      // Schematic libraries are Y-up: negate Y so the image reads upright.
      return (p) => ({ x: (p.x - cx) * sx, y: -(p.y - cy) * sy });
    case 'footprint':
    case 'drawingsheet':
      return (p) => ({ x: (p.x - cx) * sx, y: (p.y - cy) * sy });
    case 'postscript':
      // PostScript is Y-up from the origin; flip within the page height (points).
      return (p) => ({ x: p.x, y: h - p.y });
  }
}

// ----- output writers ---------------------------------------------------------

let uuidSeq = 0;
/** A deterministic-ish UUID (crypto when available, else a counter) for emitted items. */
function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  uuidSeq++;
  const hex = (n: number, len: number): string => n.toString(16).padStart(len, '0');
  return `00000000-0000-0000-0000-${hex(uuidSeq, 12)}`;
}

/** One closed ring (outer with holes bridged in) as `(xy ..)` lines. */
function ringXY(region: Region, xf: XForm, indent: string): string {
  const ring = fractureWithHoles(region.outer, region.holes);
  let out = '';
  for (const p of ring) {
    const q = xf(p);
    out += `${indent}(xy ${fmt(q.x)} ${fmt(q.y)})\n`;
  }
  return out;
}

function writeFootprint(regions: Region[], o: ConvertOptions, w: number, h: number): string {
  const xf = makeXForm('footprint', w, h, o.dpiX, o.dpiY);
  const layer = o.layer;
  let s = '';
  s += `(footprint "${o.name}"\n`;
  s += `\t(version ${SEXPR_FOOTPRINT_FILE_VERSION})\n`;
  s += `\t(generator "bitmap2component")\n`;
  s += `\t(generator_version "${GENERATOR_VERSION}")\n`;
  s += `\t(layer "F.Cu")\n`;
  s += `\t(attr board_only exclude_from_pos_files exclude_from_bom)\n`;
  s += `\t(fp_text reference "G***"\n`;
  s += `\t\t(at 0 0 0)\n`;
  s += `\t\t(layer "${layer}")\n`;
  s += `\t\t(uuid "${uuid()}")\n`;
  s += `\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.5 1.5)\n\t\t\t\t(thickness 0.3)\n\t\t\t)\n\t\t)\n`;
  s += `\t)\n`;
  s += `\t(fp_text value "${o.name}"\n`;
  s += `\t\t(at 0.75 0 0)\n`;
  s += `\t\t(layer "${layer}")\n`;
  s += `\t\t(hide yes)\n`;
  s += `\t\t(uuid "${uuid()}")\n`;
  s += `\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.5 1.5)\n\t\t\t\t(thickness 0.3)\n\t\t\t)\n\t\t)\n`;
  s += `\t)\n`;
  for (const region of regions) {
    s += `\t(fp_poly\n\t\t(pts\n`;
    s += ringXY(region, xf, '\t\t\t');
    s += `\t\t)\n`;
    s += `\t\t(stroke\n\t\t\t(width 0)\n\t\t\t(type solid)\n\t\t)\n`;
    s += `\t\t(fill solid)\n`;
    s += `\t\t(layer "${layer}")\n`;
    s += `\t\t(uuid "${uuid()}")\n`;
    s += `\t)\n`;
  }
  s += `)\n`;
  return s;
}

function writeSymbol(regions: Region[], o: ConvertOptions, w: number, h: number): string {
  const xf = makeXForm('symbol', w, h, o.dpiX, o.dpiY);
  const fieldSize = 1.27;
  // Reference sits above the artwork, Value below it (KiCad places them at ±Ypos).
  const ypos = (h / 2) * (25.4 / o.dpiY) + fieldSize / 2;
  let s = '';
  s += `(kicad_symbol_lib\n`;
  s += `\t(version ${SEXPR_SYMBOL_LIB_FILE_VERSION})\n`;
  s += `\t(generator "bitmap2component")\n`;
  s += `\t(generator_version "${GENERATOR_VERSION}")\n`;
  s += `\t(symbol "${o.name}"\n`;
  s += `\t\t(pin_names\n\t\t\t(offset 1.016)\n\t\t)\n`;
  s += `\t\t(exclude_from_sim no)\n`;
  s += `\t\t(in_bom yes)\n`;
  s += `\t\t(on_board yes)\n`;
  s += `\t\t(property "Reference" "#G"\n\t\t\t(at 0 ${fmt(-ypos)} 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size ${fieldSize} ${fieldSize})\n\t\t\t\t)\n\t\t\t\t(hide yes)\n\t\t\t)\n\t\t)\n`;
  s += `\t\t(property "Value" "${o.name}"\n\t\t\t(at 0 ${fmt(ypos)} 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size ${fieldSize} ${fieldSize})\n\t\t\t\t)\n\t\t\t\t(hide yes)\n\t\t\t)\n\t\t)\n`;
  s += `\t\t(property "Footprint" ""\n\t\t\t(at 0 0 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size ${fieldSize} ${fieldSize})\n\t\t\t\t)\n\t\t\t\t(hide yes)\n\t\t\t)\n\t\t)\n`;
  s += `\t\t(property "Datasheet" ""\n\t\t\t(at 0 0 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size ${fieldSize} ${fieldSize})\n\t\t\t\t)\n\t\t\t\t(hide yes)\n\t\t\t)\n\t\t)\n`;
  s += `\t\t(symbol "${o.name}_0_0"\n`;
  for (const region of regions) {
    // Symbols cannot cut holes, so bridge them into the single filled outline.
    s += `\t\t\t(polyline\n\t\t\t\t(pts\n`;
    s += ringXY(region, xf, '\t\t\t\t\t');
    s += `\t\t\t\t)\n`;
    s += `\t\t\t\t(stroke\n\t\t\t\t\t(width ${SCH_LINE_THICKNESS_MM})\n\t\t\t\t\t(type default)\n\t\t\t\t)\n`;
    s += `\t\t\t\t(fill\n\t\t\t\t\t(type outline)\n\t\t\t\t)\n`;
    s += `\t\t\t)\n`;
  }
  s += `\t\t)\n`;
  s += `\t)\n`;
  s += `)\n`;
  return s;
}

function writeDrawingSheet(regions: Region[], o: ConvertOptions, w: number, h: number): string {
  const xf = makeXForm('drawingsheet', w, h, o.dpiX, o.dpiY);
  let s = '';
  s += `(kicad_wks\n`;
  s += `\t(version ${SEXPR_WKS_FILE_VERSION})\n`;
  s += `\t(generator "bitmap2component")\n`;
  s += `\t(generator_version "${GENERATOR_VERSION}")\n`;
  s += `\t(setup\n\t\t(textsize 1.5 1.5)\n\t\t(linewidth 0.15)\n\t\t(textlinewidth 0.15)\n`;
  s += `\t\t(left_margin 10)\n\t\t(right_margin 10)\n\t\t(top_margin 10)\n\t\t(bottom_margin 10)\n\t)\n`;
  for (const region of regions) {
    s += `\t(polygon\n\t\t(name "")\n\t\t(pos 0 0)\n\t\t(linewidth 0)\n\t\t(pts\n`;
    s += ringXY(region, xf, '\t\t\t');
    s += `\t\t)\n\t)\n`;
  }
  s += `)\n`;
  return s;
}

function writePostScript(regions: Region[], o: ConvertOptions, w: number, h: number): string {
  const xf = makeXForm('postscript', w, h, o.dpiX, o.dpiY);
  let s = '';
  s += `%!PS-Adobe-3.0 EPSF-3.0\n`;
  s += `%%BoundingBox: 0 0 ${w} ${h}\n`;
  s += `gsave\n`;
  for (const region of regions) {
    const ring = fractureWithHoles(region.outer, region.holes);
    ring.forEach((p, i) => {
      const q = xf(p);
      s += `${fmt(q.x)} ${fmt(q.y)} ${i === 0 ? 'moveto' : 'lineto'}\n`;
    });
    s += `closepath fill\n`;
  }
  s += `grestore\n`;
  s += `%%EOF\n`;
  return s;
}

// ----- entry point ------------------------------------------------------------

export interface ConvertResult {
  text: string;
  /** Suggested download file name (without directory). */
  filename: string;
  mime: string;
}

/** Convert a thresholded bitmap into the chosen output format's file text. */
export function convert(bm: Bitmap, o: ConvertOptions): ConvertResult {
  const regions = traceRegions(bm);
  const w = bm.w;
  const h = bm.h;
  switch (o.format) {
    case 'symbol':
      return {
        text: writeSymbol(regions, o, w, h),
        filename: `${o.name}.kicad_sym`,
        mime: 'text/plain',
      };
    case 'footprint':
      return {
        text: writeFootprint(regions, o, w, h),
        filename: `${o.name}.kicad_mod`,
        mime: 'text/plain',
      };
    case 'drawingsheet':
      return {
        text: writeDrawingSheet(regions, o, w, h),
        filename: `${o.name}.kicad_wks`,
        mime: 'text/plain',
      };
    case 'postscript':
      return {
        text: writePostScript(regions, o, w, h),
        filename: `${o.name}.ps`,
        mime: 'application/postscript',
      };
  }
}
