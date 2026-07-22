/**
 * pcbnew default color theme and layer stacking order.
 *
 * Colors are the exact "KiCad Default" theme from
 * common/settings/builtin_color_themes.h (s_defaultTheme). The paint order is
 * GAL_LAYER_ORDER from pcbnew/pcb_draw_panel_gal.cpp reversed (that array is
 * top-first; canvas painting goes bottom-up): back tech layers, back copper,
 * inner coppers (In30→In1), front tech layers, front copper, then holes, then
 * footprint text, then the user/edge layers.
 */

export const PCB_BACKGROUND = 'rgb(0,16,35)';
// LAYER_GRID / LAYER_GRID_AXES / LAYER_CURSOR, KiCad Default theme.
export const PCB_GRID = 'rgb(132,132,132)';
export const PCB_GRID_AXES = 'rgb(194,194,194)';
export const PCB_CURSOR = 'rgb(255,255,255)';

const rgba = (r: number, g: number, b: number, a = 1): string =>
  a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

/** Copper + technical layer colors (s_defaultTheme). */
export const PCB_LAYER_COLORS: Record<string, string> = {
  'F.Cu': rgba(200, 52, 52),
  'In1.Cu': rgba(127, 200, 127),
  'In2.Cu': rgba(206, 125, 44),
  'In3.Cu': rgba(79, 203, 203),
  'In4.Cu': rgba(219, 98, 139),
  'In5.Cu': rgba(167, 165, 198),
  'In6.Cu': rgba(40, 204, 217),
  'In7.Cu': rgba(232, 178, 167),
  'In8.Cu': rgba(242, 237, 161),
  'In9.Cu': rgba(141, 203, 129),
  'In10.Cu': rgba(237, 124, 51),
  'In11.Cu': rgba(91, 195, 235),
  'In12.Cu': rgba(247, 111, 142),
  'In13.Cu': rgba(167, 165, 198),
  'In14.Cu': rgba(40, 204, 217),
  'In15.Cu': rgba(232, 178, 167),
  'In16.Cu': rgba(242, 237, 161),
  'In17.Cu': rgba(237, 124, 51),
  'In18.Cu': rgba(91, 195, 235),
  'In19.Cu': rgba(247, 111, 142),
  'In20.Cu': rgba(167, 165, 198),
  'In21.Cu': rgba(40, 204, 217),
  'In22.Cu': rgba(232, 178, 167),
  'In23.Cu': rgba(242, 237, 161),
  'In24.Cu': rgba(237, 124, 51),
  'In25.Cu': rgba(91, 195, 235),
  'In26.Cu': rgba(247, 111, 142),
  'In27.Cu': rgba(167, 165, 198),
  'In28.Cu': rgba(40, 204, 217),
  'In29.Cu': rgba(232, 178, 167),
  'In30.Cu': rgba(242, 237, 161),
  'B.Cu': rgba(77, 127, 196),
  'B.Adhes': rgba(0, 0, 132),
  'F.Adhes': rgba(132, 0, 132),
  'B.Paste': rgba(0, 194, 194, 0.9),
  'F.Paste': rgba(180, 160, 154, 0.9),
  'B.SilkS': rgba(232, 178, 167),
  'F.SilkS': rgba(242, 237, 161),
  'B.Mask': rgba(2, 255, 238, 0.4),
  'F.Mask': rgba(216, 100, 255, 0.4),
  'Dwgs.User': rgba(194, 194, 194),
  'Cmts.User': rgba(89, 148, 220),
  'Eco1.User': rgba(180, 219, 210),
  'Eco2.User': rgba(216, 200, 82),
  'Edge.Cuts': rgba(208, 210, 205),
  Margin: rgba(255, 38, 226),
  'B.CrtYd': rgba(38, 233, 255),
  'F.CrtYd': rgba(255, 38, 226),
  'B.Fab': rgba(88, 93, 132),
  'F.Fab': rgba(175, 175, 175),
  'User.1': rgba(194, 194, 194),
  'User.2': rgba(89, 148, 220),
  'User.3': rgba(180, 219, 210),
  'User.4': rgba(216, 200, 82),
  'User.5': rgba(194, 194, 194),
  'User.6': rgba(89, 148, 220),
  'User.7': rgba(180, 219, 210),
  'User.8': rgba(216, 200, 82),
  'User.9': rgba(232, 178, 167),
};

/** Special (virtual) layer colors used by the painter. */
export const PCB_SPECIAL = {
  // pcb_painter.cpp:158 forces LAYER_PAD_PLATEDHOLES to the background color at
  // render time (it isn't theme-able), so a plated drill reads as a real empty
  // hole — not the theme's 194,194,0. Only via holes / NPTH keep their colors.
  padPlatedHole: PCB_BACKGROUND,
  nonPlatedHole: rgba(26, 196, 210),
  viaHole: rgba(227, 183, 46),
  viaHoleWall: rgba(236, 236, 236),
  // pcb_painter.cpp:293 draws pad hole walls in the via "golden copper" hole
  // color (LAYER_VIA_HOLES) for contrast — an amber plating ring, not gray.
  padHoleWall: rgba(227, 183, 46),
  ratsnest: rgba(0, 248, 255, 0.35),
  anchor: rgba(255, 38, 226),
  drawingSheet: rgba(200, 114, 171),
};

/**
 * Objects-tab swatch colors, keyed by the Objects row key, from KiCad's
 * builtin dark theme (common/settings/builtin_color_themes.h). Rows without
 * an entry have no theme color and show a blank spacer, like upstream.
 */
export const PCB_OBJECT_COLORS: Record<string, string> = {
  ratsnest: rgba(0, 248, 255, 0.35),
  drcWarnings: rgba(255, 208, 66, 0.8),
  drcErrors: rgba(215, 91, 107, 0.8),
  drcExclusions: rgba(255, 255, 255, 0.8),
  anchors: rgba(255, 38, 226),
  points: rgba(255, 38, 226),
  lockedShadow: rgba(255, 38, 226, 0.5),
  collidingCourtyards: rgba(255, 0, 5, 0.5),
  constrainedShadow: rgba(80, 160, 240, 0.5),
  boardAreaShadow: rgba(100, 100, 100, 0.35),
  drawingSheet: rgba(200, 114, 171),
  grid: rgba(132, 132, 132),
};

const INNER = Array.from({ length: 30 }, (_, i) => `In${30 - i}.Cu`);

/**
 * Bottom-to-top paint order for real board layers (GAL_LAYER_ORDER reversed).
 * Holes and footprint text are separate passes injected between 'F.Cu' and
 * 'User.9' by the renderer, exactly where the GAL array puts them.
 */
export const PCB_PAINT_ORDER: string[] = [
  'B.Fab',
  'B.CrtYd',
  'B.Adhes',
  'B.Paste',
  'B.SilkS',
  'B.Mask',
  'B.Cu',
  ...INNER,
  'F.Fab',
  'F.CrtYd',
  'F.Adhes',
  'F.Paste',
  'F.SilkS',
  'F.Mask',
  'F.Cu',
  // renderer: holes pass, then footprint-text pass
  'User.9',
  'User.8',
  'User.7',
  'User.6',
  'User.5',
  'User.4',
  'User.3',
  'User.2',
  'User.1',
  'Margin',
  'Edge.Cuts',
  'Eco2.User',
  'Eco1.User',
  'Cmts.User',
  'Dwgs.User',
];

export const layerColor = (name: string): string => PCB_LAYER_COLORS[name] ?? 'rgb(132,132,132)';
