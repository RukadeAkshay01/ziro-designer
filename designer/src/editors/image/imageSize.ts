/**
 * Output-size model — the counterpart of KiCad's `IMAGE_SIZE`
 * (`bitmap2cmp_frame.cpp`). The source image has a pixel count and a native PPI;
 * the "Output Size" box lets you express the exported size either physically
 * (mm / inch) or directly as a DPI. Whatever the unit, the exporter ultimately
 * needs a DPI per axis (`GetOutputDPI`), which is what drives the millimetre
 * scale in `bitmap2component`.
 *
 * The three arithmetic helpers reproduce `IMAGE_SIZE` exactly:
 *  - initialOutputSize ↔ SetOutputSizeFromInitialImageSize
 *  - outputDpi         ↔ GetOutputDPI
 *  - convertOutputSize ↔ SetUnit (preserve the physical size across a unit swap)
 */

export type SizeUnit = 'mm' | 'inch' | 'dpi';

/** The unit dropdown, in KiCad's order (mm, Inch, DPI); index 0 is the default. */
export const SIZE_UNITS: { id: SizeUnit; label: string }[] = [
  { id: 'mm', label: 'mm' },
  { id: 'inch', label: 'Inch' },
  { id: 'dpi', label: 'DPI' },
];

/** The output size that reproduces the image at its native PPI, in the given unit. */
export function initialOutputSize(pixels: number, dpi: number, unit: SizeUnit): number {
  const d = Math.max(1, dpi);
  if (unit === 'mm') return (pixels / d) * 25.4;
  if (unit === 'inch') return pixels / d;
  return d; // 'dpi': the output size *is* the DPI
}

/** The effective DPI this axis exports at (KiCad's GetOutputDPI). */
export function outputDpi(size: number, pixels: number, unit: SizeUnit): number {
  if (unit === 'mm') return size > 0 ? pixels / (size / 25.4) : 0;
  if (unit === 'inch') return size > 0 ? pixels / size : 0;
  return Math.round(size);
}

/** Re-express an output size in a different unit, keeping the physical size fixed. */
export function convertOutputSize(
  size: number,
  pixels: number,
  from: SizeUnit,
  to: SizeUnit,
): number {
  // to millimetres
  let mm: number;
  if (from === 'mm') mm = size;
  else if (from === 'inch') mm = size * 25.4;
  else mm = size ? (pixels / size) * 25.4 : 0;
  // millimetres to target
  if (to === 'mm') return mm;
  if (to === 'inch') return mm / 25.4;
  return mm ? (pixels / mm) * 25.4 : 0;
}

/**
 * Format an output-size value for a text field, with KiCad's exact precision
 * (`formatOutputSize`): mm `%.1f`, inch `%.2f`, DPI a rounded integer.
 */
export function formatOutputSize(size: number, unit: SizeUnit): string {
  if (!Number.isFinite(size)) size = 0;
  if (unit === 'dpi') return String(Math.round(size));
  return unit === 'mm' ? size.toFixed(1) : size.toFixed(2);
}
