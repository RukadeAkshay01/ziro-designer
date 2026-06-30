/**
 * Schematic colour theme.
 *
 * Approximates KiCad's classic eeschema colours so the canvas reads as familiar
 * to KiCad users. These are close-but-not-yet-exact; the precise theme values
 * live in KiCad's colour-theme JSON and are a tracked follow-up for pixel parity.
 */
export interface Theme {
  background: string;
  grid: string;
  wire: string;
  bus: string;
  junction: string;
  symbolOutline: string;
  symbolFill: string;
  pin: string;
  pinName: string;
  pinNumber: string;
  reference: string;
  value: string;
  label: string;
  globalLabel: string;
  hierLabel: string;
  noText: string;
}

export const KICAD_CLASSIC: Theme = {
  background: '#ffffff',
  grid: '#c8c8c8',
  wire: '#008400', // green
  bus: '#000084', // blue
  junction: '#008400',
  symbolOutline: '#840000', // dark red
  symbolFill: '#ffffc2', // pale yellow (background fill)
  pin: '#840000',
  pinName: '#008484',
  pinNumber: '#840000',
  reference: '#008484', // cyan
  value: '#008484',
  label: '#000000', // local label: black
  globalLabel: '#840000', // dark red
  hierLabel: '#840084', // magenta
  noText: '#0000c4',
};
