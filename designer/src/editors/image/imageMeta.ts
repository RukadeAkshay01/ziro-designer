/**
 * Image-file metadata for the Image Converter — the browser stand-in for what
 * `BITMAP2CMP_PANEL::OpenProjectFiles` reads through wxImage: the embedded
 * resolution (`wxIMAGE_OPTION_RESOLUTIONX/Y`, converted from per-cm when
 * needed) and the bitmap depth shown as "BPP". Canvas decoding flattens both
 * away, so they are parsed from the file bytes: PNG `pHYs` / IHDR colour type,
 * JPEG JFIF density, BMP `biXPelsPerMeter`. Anything else falls back to
 * KiCad's DEFAULT_DPI (300) and 24 bpp.
 */

const DEFAULT_DPI = 300;

export interface ImageMeta {
  dpiX: number;
  dpiY: number;
  /** wxBitmap::GetDepth(): 32 when the image carries an alpha channel, else 24. */
  bpp: number;
}

const u32be = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32le = (b: Uint8Array, o: number): number =>
  ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;

const isPng = (b: Uint8Array): boolean =>
  b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
const isBmp = (b: Uint8Array): boolean => b.length > 46 && b[0] === 0x42 && b[1] === 0x4d;

function pngMeta(b: Uint8Array): ImageMeta {
  // IHDR colour type: 4 (grey+alpha) and 6 (RGBA) carry an alpha channel.
  const colorType = b[25]!;
  const bpp = colorType === 4 || colorType === 6 ? 32 : 24;
  let dpiX = 0;
  let dpiY = 0;
  let off = 8;
  while (off + 8 <= b.length) {
    const len = u32be(b, off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    if (type === 'pHYs' && len >= 9) {
      const d = off + 8;
      if (b[d + 8] === 1) {
        // pixels per metre → DPI
        dpiX = Math.round(u32be(b, d) * 0.0254);
        dpiY = Math.round(u32be(b, d + 4) * 0.0254);
      }
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len;
  }
  return { dpiX, dpiY, bpp };
}

function jpegMeta(b: Uint8Array): ImageMeta {
  // Walk the JFIF APP0 marker: units byte then X/Y density.
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff) {
    const marker = b[off + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = u16be(b, off + 2);
    if (marker === 0xe0 && len >= 16) {
      const d = off + 4;
      const jfif = String.fromCharCode(b[d]!, b[d + 1]!, b[d + 2]!, b[d + 3]!);
      if (jfif === 'JFIF') {
        const units = b[d + 7]!;
        const dx = u16be(b, d + 8);
        const dy = u16be(b, d + 10);
        if (units === 1) return { dpiX: dx, dpiY: dy, bpp: 24 };
        if (units === 2)
          return { dpiX: Math.round(dx * 2.54), dpiY: Math.round(dy * 2.54), bpp: 24 };
        return { dpiX: 0, dpiY: 0, bpp: 24 };
      }
    }
    off += 2 + len;
  }
  return { dpiX: 0, dpiY: 0, bpp: 24 };
}

function bmpMeta(b: Uint8Array): ImageMeta {
  // BITMAPINFOHEADER at offset 14: XPelsPerMeter/YPelsPerMeter at +24/+28.
  const ppmX = u32le(b, 14 + 24);
  const ppmY = u32le(b, 14 + 28);
  return { dpiX: Math.round(ppmX * 0.0254), dpiY: Math.round(ppmY * 0.0254), bpp: 24 };
}

/**
 * Read the resolution and depth of an image file. Mirrors KiCad's fallback:
 * a resolution is only trusted when both axes are > 1, otherwise DEFAULT_DPI.
 */
export function imageMeta(bytes: Uint8Array): ImageMeta {
  let m: ImageMeta = { dpiX: 0, dpiY: 0, bpp: 24 };
  if (isPng(bytes)) m = pngMeta(bytes);
  else if (isJpeg(bytes)) m = jpegMeta(bytes);
  else if (isBmp(bytes)) m = bmpMeta(bytes);
  if (!(m.dpiX > 1 && m.dpiY > 1)) {
    m.dpiX = DEFAULT_DPI;
    m.dpiY = DEFAULT_DPI;
  }
  return m;
}
