/**
 * Resistor colour-code: value + tolerance → 4/5-band colours (and back).
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_color_code.cpp`.
 */

export interface BandColor {
  name: string;
  /** CSS colour for rendering the band. */
  css: string;
}

export const DIGIT_COLORS: readonly BandColor[] = [
  { name: 'Black', css: '#000000' },
  { name: 'Brown', css: '#8b4513' },
  { name: 'Red', css: '#d40000' },
  { name: 'Orange', css: '#ff7f00' },
  { name: 'Yellow', css: '#f2d500' },
  { name: 'Green', css: '#00a651' },
  { name: 'Blue', css: '#0072bc' },
  { name: 'Violet', css: '#92278f' },
  { name: 'Grey', css: '#808080' },
  { name: 'White', css: '#ffffff' },
];

/** Multiplier bands: 10^n for n = -2 … 9 (silver, gold, black … white). */
export const MULTIPLIER_COLORS: readonly (BandColor & { exp: number })[] = [
  { name: 'Silver', css: '#c0c0c0', exp: -2 },
  { name: 'Gold', css: '#cfa227', exp: -1 },
  ...DIGIT_COLORS.map((c, i) => ({ ...c, exp: i })),
];

export const TOLERANCE_COLORS: readonly (BandColor & { pct: number })[] = [
  { name: 'Brown', css: '#8b4513', pct: 1 },
  { name: 'Red', css: '#d40000', pct: 2 },
  { name: 'Green', css: '#00a651', pct: 0.5 },
  { name: 'Blue', css: '#0072bc', pct: 0.25 },
  { name: 'Violet', css: '#92278f', pct: 0.1 },
  { name: 'Grey', css: '#808080', pct: 0.05 },
  { name: 'Gold', css: '#cfa227', pct: 5 },
  { name: 'Silver', css: '#c0c0c0', pct: 10 },
];

/** Temperature-coefficient band (ppm/K) for 6-band resistors. */
export const TEMPCO_COLORS: readonly (BandColor & { ppm: number })[] = [
  { name: 'Black', css: '#000000', ppm: 250 },
  { name: 'Brown', css: '#8b4513', ppm: 100 },
  { name: 'Red', css: '#d40000', ppm: 50 },
  { name: 'Orange', css: '#ff7f00', ppm: 15 },
  { name: 'Yellow', css: '#f2d500', ppm: 25 },
  { name: 'Green', css: '#00a651', ppm: 20 },
  { name: 'Blue', css: '#0072bc', ppm: 10 },
  { name: 'Violet', css: '#92278f', ppm: 5 },
  { name: 'Grey', css: '#808080', ppm: 1 },
];

export interface ColorCodeResult {
  /** Digit bands (2 or 3 entries). */
  digits: BandColor[];
  multiplier: BandColor & { exp: number };
  tolerance: (BandColor & { pct: number }) | null;
  /** Temperature-coefficient band (6-band only), else null. */
  tempco: (BandColor & { ppm: number }) | null;
  /** The value actually encoded by the bands (after rounding), ohms. */
  encodedOhms: number;
  error?: string;
}

/**
 * Encode `ohms` into 4-band (2 digits), 5-band (3 digits) or 6-band (3 digits
 * + temperature coefficient) colours. `tolerancePct` picks the tolerance band;
 * `tempcoPpm` picks the 6th band (ignored for 4/5 bands).
 */
export function colorCode(
  ohms: number,
  tolerancePct: number,
  bands: 4 | 5 | 6,
  tempcoPpm = 100,
): ColorCodeResult {
  const nDigits = bands === 4 ? 2 : 3;
  const tolerance = TOLERANCE_COLORS.find((t) => t.pct === tolerancePct) ?? null;
  const tempco =
    bands === 6 ? (TEMPCO_COLORS.find((t) => t.ppm === tempcoPpm) ?? TEMPCO_COLORS[1]!) : null;
  const blackMult = MULTIPLIER_COLORS[2] as BandColor & { exp: number };
  if (!(ohms > 0) || !Number.isFinite(ohms)) {
    return {
      digits: [],
      multiplier: blackMult,
      tolerance,
      tempco,
      encodedOhms: NaN,
      error: 'Enter a positive resistance.',
    };
  }

  // Normalize to nDigits significant digits: ohms ≈ mantissa · 10^exp.
  let exp = Math.floor(Math.log10(ohms)) - (nDigits - 1);
  let mantissa = Math.round(ohms / 10 ** exp);
  if (mantissa >= 10 ** nDigits) {
    mantissa = Math.round(mantissa / 10);
    exp += 1;
  }
  const mult = MULTIPLIER_COLORS.find((m) => m.exp === exp);
  if (!mult) {
    return {
      digits: [],
      multiplier: blackMult,
      tolerance,
      tempco,
      encodedOhms: NaN,
      error: 'Value out of range for a colour code.',
    };
  }

  const digitStr = mantissa.toString().padStart(nDigits, '0');
  const digits = [...digitStr].map((ch) => DIGIT_COLORS[Number(ch)] ?? DIGIT_COLORS[0]!);
  return { digits, multiplier: mult, tolerance, tempco, encodedOhms: mantissa * 10 ** exp };
}
