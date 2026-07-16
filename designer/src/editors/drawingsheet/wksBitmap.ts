/**
 * Bitmap image support for the Drawing Sheet Editor, mirroring what
 * BITMAP_BASE does for `pl_editor`: the model stores the PNG payload
 * (base64, as the `(data …)` chunks in the file), the DPI comes from the
 * image itself (the PNG pHYs chunk — 300 when absent, as wxImage reports),
 * and the drawn size is `pixels / ppi` inches at the item's scale.
 *
 * The engine model can't decode images (no DOM), so this browser-side module
 * decodes base64 → ImageBitmap with a cache, extracts the pHYs DPI, and
 * converts a user-picked image file into the payload + its natural size.
 */

/** Base64 → bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Read the pHYs chunk of a PNG to get its DPI (pixels-per-metre → per-inch),
 * the way wxImage fills wxIMAGE_OPTION_RESOLUTION. Returns 300 (the
 * BITMAP_BASE fallback) when the chunk is missing or not in metres.
 */
export function pngDpi(bytes: Uint8Array): number {
  // PNG layout: 8-byte signature, then length(4) type(4) data chunks.
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len =
      (bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!;
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    );
    if (type === 'pHYs' && len >= 9) {
      const d = off + 8;
      const ppuX =
        ((bytes[d]! << 24) | (bytes[d + 1]! << 16) | (bytes[d + 2]! << 8) | bytes[d + 3]!) >>> 0;
      const unit = bytes[d + 8]!;
      if (unit === 1 && ppuX > 0) return Math.round(ppuX * 0.0254);
      return 300;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len; // length + type + data + CRC
  }
  return 300;
}

interface CacheEntry {
  img: ImageBitmap | null;
  w: number;
  h: number;
  failed: boolean;
}
const cache = new Map<string, CacheEntry>();
let invalidate: (() => void) | null = null;

/** Register a redraw callback fired when an async image decode finishes. */
export function setBitmapInvalidate(fn: (() => void) | null): void {
  invalidate = fn;
}

/**
 * Return the decoded image for a base64 PNG payload, or null while it decodes
 * (kicking off the decode on first sight and calling the invalidate callback
 * when it becomes available).
 */
export function getBitmapImage(b64: string): { img: ImageBitmap; w: number; h: number } | null {
  if (!b64) return null;
  const hit = cache.get(b64);
  if (hit) return hit.img ? { img: hit.img, w: hit.w, h: hit.h } : null;
  cache.set(b64, { img: null, w: 0, h: 0, failed: false });
  const blob = new Blob([base64ToBytes(b64) as BlobPart], { type: 'image/png' });
  createImageBitmap(blob)
    .then((bmp) => {
      cache.set(b64, { img: bmp, w: bmp.width, h: bmp.height, failed: false });
      invalidate?.();
    })
    .catch(() => {
      cache.set(b64, { img: null, w: 0, h: 0, failed: true });
    });
  return null;
}

/** Decode a base64 PNG payload to its natural pixel size + DPI (model backfill). */
export async function decodeImageMeta(b64: string): Promise<{ w: number; h: number; ppi: number }> {
  const bytes = base64ToBytes(b64);
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const meta = { w: bmp.width, h: bmp.height, ppi: pngDpi(bytes) };
  bmp.close?.();
  return meta;
}

/**
 * Convert a user-picked image File into the model payload: the image is
 * normalised to PNG (so any source format round-trips as valid `(data …)`)
 * and its natural pixel size + DPI are returned for sizing.
 */
export async function imageFileToPng(
  file: File,
): Promise<{ b64: string; pxW: number; pxH: number; ppi: number }> {
  // Keep the original bytes when the file is already a PNG, so the pHYs DPI
  // and exact payload survive; re-encode everything else.
  const orig = new Uint8Array(await file.arrayBuffer());
  const isPng =
    orig.length > 8 && orig[0] === 0x89 && orig[1] === 0x50 && orig[2] === 0x4e && orig[3] === 0x47;
  if (isPng) {
    const bmp = await createImageBitmap(file);
    const meta = { pxW: bmp.width, pxH: bmp.height, ppi: pngDpi(orig) };
    bmp.close?.();
    return { b64: bytesToBase64(orig), ...meta };
  }
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('Cannot get 2D context to encode bitmap');
  cx.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  if (!blob) throw new Error('Failed to encode image as PNG');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const size = { pxW: bmp.width, pxH: bmp.height, ppi: 300 };
  bmp.close?.();
  return { b64: bytesToBase64(bytes), ...size };
}
