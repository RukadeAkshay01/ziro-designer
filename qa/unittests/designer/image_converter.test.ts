/**
 * Image Converter (bitmap2component): trace a 1-bit bitmap and emit KiCad
 * artwork. The traced polygons must round-trip — the footprint parses into a
 * PcbFootprint with an fp_poly, the symbol into a LibSymbol with a filled
 * polyline — and the geometry must sit centred on the origin at the requested
 * DPI, with holes cut out of the fill.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readFootprintFile } from '@ziroeda/pcbnew';
import { readSymbolLib } from '@ziroeda/eeschema';
import { Bitmap } from '@ziroeda/designer/src/editors/image/potrace.js';
import {
  convert,
  grayToMono,
  imageToGray,
  traceRegions,
  OUTLINE_LAYERS,
} from '@ziroeda/designer/src/editors/image/bitmap2component.js';

/** A bitmap with a filled rectangle [x0,x1) × [y0,y1). */
function filledRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Bitmap {
  const bm = new Bitmap(w, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) bm.data[y * w + x] = 1;
  return bm;
}

const NAME = 'LOGO';

describe('tracing', () => {
  it('traces a solid square into one outline with no holes', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(0);
    // An axis-aligned square: 4 corner segments, each emitting a vertex + an
    // edge midpoint (potrace's corner tessellation), so ~8 points.
    expect(regions[0]!.outer.length).toBeLessThanOrEqual(12);
    expect(regions[0]!.outer.length).toBeGreaterThanOrEqual(4);
  });

  it('detects a hole inside a filled ring', () => {
    const bm = filledRect(30, 30, 4, 4, 26, 26);
    // punch an 8×8 hole in the centre
    for (let y = 11; y < 19; y++) for (let x = 11; x < 19; x++) bm.data[y * 30 + x] = 0;
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
  });

  it('traces a filled circle (exercises the Bézier / opticurve path)', () => {
    const w = 60;
    const bm = new Bitmap(w, w);
    const cx = 30;
    const cy = 30;
    const r = 22;
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) bm.data[y * w + x] = 1;
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(0);
    // A circle smooths into many curve points, not a handful of corners.
    expect(regions[0]!.outer.length).toBeGreaterThan(12);
  });

  it('finds two separate blobs as two regions', () => {
    const bm = new Bitmap(40, 20);
    for (let y = 5; y < 15; y++) {
      for (let x = 4; x < 12; x++) bm.data[y * 40 + x] = 1;
      for (let x = 28; x < 36; x++) bm.data[y * 40 + x] = 1;
    }
    expect(traceRegions(bm)).toHaveLength(2);
  });
});

describe('footprint output', () => {
  const bm = filledRect(24, 24, 6, 6, 18, 18);

  it('parses into a footprint with a filled polygon on the chosen layer', () => {
    const layer = OUTLINE_LAYERS[0]!.id; // F.SilkS
    const { text, filename } = convert(bm, {
      format: 'footprint',
      layer,
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_mod');
    const fp = readFootprintFile(parse(text));
    expect(fp).not.toBeNull();
    const polys = fp!.shapes.filter((s) => s.kind === 'poly');
    expect(polys.length).toBe(1);
    expect(polys[0]!.fill).toBe(true);
    expect(polys[0]!.layer).toBe(layer);
    expect(text).toContain('(generator "bitmap2component")');
    expect(text).toContain('(attr board_only exclude_from_pos_files exclude_from_bom)');
  });

  it('cuts a hole into the footprint fill by bridging (single fractured ring)', () => {
    const ring = filledRect(30, 30, 4, 4, 26, 26);
    for (let y = 11; y < 19; y++) for (let x = 11; x < 19; x++) ring.data[y * 30 + x] = 0;
    const regions = traceRegions(ring);
    const { text } = convert(ring, {
      format: 'footprint',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const fp = readFootprintFile(parse(text))!;
    const poly = fp.shapes.filter((s) => s.kind === 'poly');
    // Still one fp_poly, but with the hole bridged in: more points than the
    // outline alone (outer + hole + the two bridge vertices).
    expect(poly).toHaveLength(1);
    const outerPts = regions[0]!.outer.length;
    expect(poly[0]!.pts!.length).toBeGreaterThan(outerPts);
  });

  it('honours the selected outline layer', () => {
    const layer = 'Dwgs.User';
    const { text } = convert(bm, { format: 'footprint', layer, dpiX: 300, dpiY: 300, name: NAME });
    const fp = readFootprintFile(parse(text))!;
    expect(fp.shapes.find((s) => s.kind === 'poly')!.layer).toBe(layer);
  });

  it('centres the artwork on the origin', () => {
    const { text } = convert(bm, {
      format: 'footprint',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const fp = readFootprintFile(parse(text))!;
    const pts = fp.shapes.find((s) => s.kind === 'poly')!.pts!;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // symmetric square → bounds centred on 0 (internal units)
    expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeLessThan(2000);
    expect(Math.abs(Math.max(...ys) + Math.min(...ys))).toBeLessThan(2000);
  });

  it('scales with DPI: half the DPI ≈ twice the size', () => {
    const base = readFootprintFile(
      parse(
        convert(bm, { format: 'footprint', layer: 'F.SilkS', dpiX: 300, dpiY: 300, name: NAME })
          .text,
      ),
    )!;
    const big = readFootprintFile(
      parse(
        convert(bm, { format: 'footprint', layer: 'F.SilkS', dpiX: 150, dpiY: 150, name: NAME })
          .text,
      ),
    )!;
    const span = (fp: typeof base): number => {
      const xs = fp.shapes.find((s) => s.kind === 'poly')!.pts!.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(big) / span(base)).toBeGreaterThan(1.8);
    expect(span(big) / span(base)).toBeLessThan(2.2);
  });
});

describe('symbol output', () => {
  it('parses into a symbol with an outline-filled polyline', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text, filename } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_sym');
    const syms = readSymbolLib(parse(text));
    expect(syms).toHaveLength(1);
    expect(syms[0]!.libId).toBe(NAME);
    const polylines = syms[0]!.units
      .flatMap((u) => u.graphics)
      .filter((g) => g.kind === 'polyline');
    expect(polylines.length).toBe(1);
    expect(polylines[0]!.fill?.type).toBe('outline');
  });
});

describe('postscript & drawing-sheet output', () => {
  const bm = filledRect(24, 24, 6, 6, 18, 18);

  it('emits valid EPS with a fill path', () => {
    const { text, filename } = convert(bm, {
      format: 'postscript',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.ps');
    expect(text.startsWith('%!PS-Adobe-3.0 EPSF-3.0')).toBe(true);
    expect(text).toContain('%%BoundingBox: 0 0 24 24');
    expect(text).toContain('moveto');
    expect(text).toContain('closepath fill');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('emits a parseable drawing sheet with a polygon', () => {
    const { text, filename } = convert(bm, {
      format: 'drawingsheet',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_wks');
    const root = parse(text);
    expect(root.items[0]).toMatchObject({ kind: 'atom', value: 'kicad_wks' });
    expect(text).toContain('(polygon');
  });
});

describe('threshold & negative', () => {
  it('negative inverts foreground/background', () => {
    // Grey ramp image: left half dark, right half light.
    const w = 20;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const v = x < w / 2 ? 40 : 220;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const gray = imageToGray(rgba, w, h);
    const normal = grayToMono(gray, 128, false);
    const inverted = grayToMono(gray, 128, true);
    // dark pixel (x=0): foreground when normal, background when negative
    expect(normal.data[0]).toBe(1);
    expect(inverted.data[0]).toBe(0);
    // light pixel (x=w-1): opposite
    expect(normal.data[w - 1]).toBe(0);
    expect(inverted.data[w - 1]).toBe(1);
  });

  it('a blank bitmap yields an empty but valid footprint', () => {
    const bm = new Bitmap(10, 10);
    const { text } = convert(bm, {
      format: 'footprint',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const fp = readFootprintFile(parse(text));
    expect(fp).not.toBeNull();
    expect(fp!.shapes.filter((s) => s.kind === 'poly')).toHaveLength(0);
  });
});
