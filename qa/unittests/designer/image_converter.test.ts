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
import {
  convertOutputSize,
  formatOutputSize,
  initialOutputSize,
  outputDpi,
} from '@ziroeda/designer/src/editors/image/imageSize.js';

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

describe('output size (KiCad IMAGE_SIZE)', () => {
  it('reproduces the native size and round-trips to the original DPI', () => {
    // 300 px @ 300 PPI → 25.4 mm; that size exports back at 300 DPI.
    expect(initialOutputSize(300, 300, 'mm')).toBeCloseTo(25.4, 6);
    expect(initialOutputSize(300, 300, 'inch')).toBeCloseTo(1, 6);
    expect(initialOutputSize(300, 300, 'dpi')).toBe(300);
    expect(outputDpi(25.4, 300, 'mm')).toBeCloseTo(300, 6);
    expect(outputDpi(1, 300, 'inch')).toBeCloseTo(300, 6);
    expect(outputDpi(300, 300, 'dpi')).toBe(300);
  });

  it('doubling the physical size halves the export DPI (bigger artwork)', () => {
    expect(outputDpi(50.8, 300, 'mm')).toBeCloseTo(150, 6);
  });

  it('converts between units keeping the physical size', () => {
    expect(convertOutputSize(25.4, 300, 'mm', 'inch')).toBeCloseTo(1, 6);
    expect(convertOutputSize(1, 300, 'inch', 'mm')).toBeCloseTo(25.4, 6);
    // 25.4 mm of 300 px is 300 DPI
    expect(convertOutputSize(25.4, 300, 'mm', 'dpi')).toBeCloseTo(300, 6);
    expect(convertOutputSize(300, 300, 'dpi', 'mm')).toBeCloseTo(25.4, 6);
  });

  it('formats with KiCad precision: mm %.1f, inch %.2f, DPI integer', () => {
    expect(formatOutputSize(25.4, 'mm')).toBe('25.4');
    expect(formatOutputSize(84.66667, 'mm')).toBe('84.7');
    expect(formatOutputSize(0, 'mm')).toBe('0.0');
    expect(formatOutputSize(1, 'inch')).toBe('1.00');
    expect(formatOutputSize(299.6, 'dpi')).toBe('300');
  });
});

describe('layer choices', () => {
  it('matches KiCad bitmap2cmp order and mapping', () => {
    expect(OUTLINE_LAYERS.map((l) => l.id)).toEqual([
      'F.Cu',
      'F.SilkS',
      'F.Mask',
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'F.Fab',
    ]);
    expect(OUTLINE_LAYERS[1]!.label).toBe('F.Silkscreen');
  });
});

describe('footprint output', () => {
  const bm = filledRect(24, 24, 6, 6, 18, 18);

  it('parses into a footprint with a filled polygon on the chosen layer', () => {
    const layer = OUTLINE_LAYERS[1]!.id; // F.SilkS
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
    // outputDataHeader keeps the reference/value texts on F.SilkS regardless.
    expect(text.match(/\(layer "F\.SilkS"\)/g)).toHaveLength(2);
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

  it('places Reference above and Value below the artwork (KiCad outputDataHeader)', () => {
    // 24 px @ 300 DPI → half-height 1.016 mm; ±(1.016 − fieldSize/2) = ±0.381.
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(text).toMatch(/\(property "Reference" "#G"\s*\(at 0 0\.381 0\)/);
    expect(text).toMatch(/\(property "Value" "LOGO"\s*\(at 0 -0\.381 0\)/);
    expect(text).not.toContain('exclude_from_sim');
  });

  it('clipboard paste variant emits the bare symbol fragment (SYMBOL_PASTE_FMT)', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
      paste: true,
    });
    expect(text).not.toContain('kicad_symbol_lib');
    expect(text.trimStart().startsWith('(symbol "LOGO"')).toBe(true);
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
    // DS_DATA_ITEM_POLYGONS gets m_LineWidth = 0.01 in createDrawingSheetData.
    expect(text).toContain('(linewidth 0.01)');
  });

  it('EPS uses newpath/moveto with integer pixel coordinates', () => {
    const { text } = convert(bm, {
      format: 'postscript',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(text).toContain('newpath');
    expect(text).toMatch(/newpath\n-?\d+ -?\d+ moveto\n/);
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

  it('negates the greyscale before thresholding, as KiCad does', () => {
    // binarize(negated): fg iff (255 − gray) < th. gray 240, th 50 → 15 < 50.
    const rgba = new Uint8ClampedArray([240, 240, 240, 255]);
    const gray = imageToGray(rgba, 1, 1);
    expect(grayToMono(gray, 50, false).data[0]).toBe(0);
    expect(grayToMono(gray, 50, true).data[0]).toBe(1);
  });

  it('drops pixels that are too transparent (alpha ≤ 0.7·threshold)', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 30]); // black but nearly invisible
    const gray = imageToGray(rgba, 1, 1);
    expect(grayToMono(gray, 128, false).data[0]).toBe(0); // 30 ≤ 89.6 → background
    const opaque = imageToGray(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    expect(grayToMono(opaque, 128, false).data[0]).toBe(1);
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
