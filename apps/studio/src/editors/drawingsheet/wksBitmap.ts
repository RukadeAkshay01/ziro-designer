/**
 * Bitmap image support for the Drawing Sheet Editor. KiCad's DS_DATA_ITEM_BITMAP
 * stores a PNG (as hex `(pngdata (data …))`) and draws it centred on its anchor
 * point at `pixels / ppi · scale`. The core model keeps the hex payload but can't
 * decode it (no DOM), so this browser-side module decodes hex → ImageBitmap and
 * caches it, and converts a user-picked image file into the hex payload plus its
 * natural pixel size.
 */

/** Hex string → bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const n = clean.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Bytes → hex string. */
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

interface CacheEntry { img: ImageBitmap | null; w: number; h: number; failed: boolean }
const cache = new Map<string, CacheEntry>();
let invalidate: (() => void) | null = null;

/** Register a redraw callback fired when an async image decode finishes. */
export function setBitmapInvalidate(fn: (() => void) | null): void {
  invalidate = fn;
}

/**
 * Return the decoded image for a hex PNG payload, or null while it decodes
 * (kicking off the decode on first sight and calling the invalidate callback
 * when it becomes available).
 */
export function getBitmapImage(hex: string): { img: ImageBitmap; w: number; h: number } | null {
  if (!hex) return null;
  const hit = cache.get(hex);
  if (hit) return hit.img ? { img: hit.img, w: hit.w, h: hit.h } : null;
  cache.set(hex, { img: null, w: 0, h: 0, failed: false });
  const blob = new Blob([hexToBytes(hex) as BlobPart], { type: 'image/png' });
  createImageBitmap(blob).then((bmp) => {
    cache.set(hex, { img: bmp, w: bmp.width, h: bmp.height, failed: false });
    invalidate?.();
  }).catch(() => {
    cache.set(hex, { img: null, w: 0, h: 0, failed: true });
  });
  return null;
}

/** Decode a hex PNG payload to just its natural pixel size (for model backfill). */
export async function decodeHexImageSize(hex: string): Promise<{ w: number; h: number }> {
  const blob = new Blob([hexToBytes(hex) as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close?.();
  return size;
}

/**
 * Convert a user-picked image File into a KiCad-compatible bitmap payload: the
 * image is normalised to PNG (so any source format round-trips as valid pngdata)
 * and its natural pixel size is returned for sizing.
 */
export async function imageFileToPng(file: File): Promise<{ hex: string; pxW: number; pxH: number }> {
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
  const size = { pxW: bmp.width, pxH: bmp.height };
  bmp.close?.();
  return { hex: bytesToHex(bytes), ...size };
}
