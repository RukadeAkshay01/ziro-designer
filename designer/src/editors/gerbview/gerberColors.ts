/**
 * Default per-layer colours for the Gerber viewer, following GerbView's default
 * colour set (`gerbview/gerbview_settings.cpp` and the "GerbView" default theme
 * in `common/settings/colors_settings`). GerbView cycles a fixed palette across
 * the 32 layers; the background is dark by default.
 */

/** The 12-colour cycle GerbView assigns to layers as they are loaded. */
export const GERBER_LAYER_COLORS: string[] = [
  '#D02020', // red
  '#20A020', // green
  '#2020D0', // blue
  '#C0C020', // yellow
  '#C020C0', // magenta
  '#20C0C0', // cyan
  '#E08020', // orange
  '#8060C0', // violet
  '#60A0E0', // light blue
  '#A0C060', // lime
  '#E060A0', // pink
  '#A0A0A0', // grey
  '#E0A040', // amber
  '#40C080', // teal
  '#C06060', // salmon
  '#8080E0', // periwinkle
];

/** Background and grid colours — GerbView's default theme uses a pure-black
 *  background with a mid-grey grid. */
export const GERBER_BG_COLOR = '#000000';
export const GERBER_GRID_COLOR = '#5A5A5A';
/** DCode-number annotation colour (GerbView draws them in white). */
export const GERBER_DCODE_COLOR = '#DDDDDD';
/** Negative-object placeholder colour when "show negative objects" is on. */
export const GERBER_NEGATIVE_COLOR = '#0F0F1A';

/** Per-layer opacity used when compositing, matching GerbView's translucent
 *  layers (default colour alpha ≈ 0.8) so overlapping layers visibly blend. */
export const GERBER_LAYER_ALPHA = 0.8;

/** Colour for the layer at index `i` (cycles the palette). */
export function defaultLayerColor(i: number): string {
  return GERBER_LAYER_COLORS[i % GERBER_LAYER_COLORS.length]!;
}
