/**
 * Schematic colour themes, transcribed exactly from KiCad's builtin themes
 * (common/settings/builtin_color_themes.h): `s_defaultTheme` ("KiCad Default")
 * and `s_classicTheme` ("KiCad Classic", legacy-palette colours resolved via
 * common/gal/color4d.cpp's colorRefs table).
 */
export interface Theme {
  background: string;
  grid: string;
  wire: string;
  bus: string;
  busJunction: string;
  junction: string;
  symbolOutline: string;
  symbolFill: string;
  pin: string;
  pinName: string;
  pinNumber: string;
  reference: string;
  value: string;
  /** User fields (LAYER_FIELDS). */
  fields: string;
  label: string;
  globalLabel: string;
  hierLabel: string;
  netHighlight: string;
  selectionShadow: string;
  noteLine: string;
  noText: string;
  privateNote: string;
  noConnect: string;
  ercError: string;
  ercWarning: string;
  sheetBorder: string;
  sheetBackground: string;
  sheetName: string;
  sheetFile: string;
  sheetLabel: string;
  sheetFields: string;
  pageFrame: string;
  /** LAYER_SCHEMATIC_PAGE_LIMITS: the paper-edge lines when "Show page limits" is on. */
  pageLimits: string;
  /** LAYER_SCHEMATIC_ANCHOR: text/origin anchor crosses. */
  anchor: string;
  /** LAYER_HIDDEN: hidden pins/fields when shown. */
  hidden: string;
  /** LAYER_SCHEMATIC_CURSOR: the crosshair cursor. */
  cursor: string;
}

/** "KiCad Default" — s_defaultTheme (the beige theme KiCad 9 ships as default). */
export const KICAD_DEFAULT: Theme = {
  background: 'rgb(245, 244, 239)',
  grid: 'rgb(181, 181, 181)',
  wire: 'rgb(0, 150, 0)',
  bus: 'rgb(0, 0, 132)',
  busJunction: 'rgb(0, 0, 132)',
  junction: 'rgb(0, 150, 0)',
  symbolOutline: 'rgb(132, 0, 0)',
  symbolFill: 'rgb(255, 255, 194)',
  pin: 'rgb(132, 0, 0)',
  pinName: 'rgb(0, 100, 100)',
  pinNumber: 'rgb(169, 0, 0)',
  reference: 'rgb(0, 100, 100)',
  value: 'rgb(0, 100, 100)',
  fields: 'rgb(132, 0, 132)',
  label: 'rgb(15, 15, 15)',
  globalLabel: 'rgb(132, 0, 0)',
  hierLabel: 'rgb(114, 86, 0)',
  netHighlight: 'rgb(255, 0, 255)', // LAYER_BRIGHTENED
  selectionShadow: 'rgba(102, 178, 255, 0.8)', // COLOR4D(.4,.7,1.0,0.8)
  noteLine: 'rgb(0, 0, 194)',
  noText: 'rgb(0, 0, 194)',
  privateNote: 'rgb(72, 72, 255)',
  noConnect: 'rgb(0, 0, 132)',
  ercError: 'rgba(230, 9, 13, 0.8)',
  ercWarning: 'rgba(209, 146, 0, 0.8)',
  sheetBorder: 'rgb(132, 0, 0)',
  sheetBackground: 'rgba(255, 255, 255, 0)',
  sheetName: 'rgb(0, 100, 100)',
  sheetFile: 'rgb(114, 86, 0)',
  sheetLabel: 'rgb(0, 100, 100)',
  sheetFields: 'rgb(132, 0, 132)',
  pageFrame: 'rgb(132, 0, 0)',
  pageLimits: 'rgb(181, 181, 181)',
  anchor: 'rgb(0, 0, 255)',
  hidden: 'rgb(194, 194, 194)',
  cursor: 'rgb(15, 15, 15)',
};

/** "KiCad Classic" — s_classicTheme (the white legacy theme; legacy palette values). */
export const KICAD_CLASSIC: Theme = {
  background: 'rgb(255, 255, 255)', // WHITE
  grid: 'rgb(132, 132, 132)', // DARKGRAY
  wire: 'rgb(0, 132, 0)', // GREEN
  bus: 'rgb(0, 0, 132)', // BLUE
  busJunction: 'rgb(0, 0, 132)',
  junction: 'rgb(0, 132, 0)',
  symbolOutline: 'rgb(132, 0, 0)', // RED (legacy)
  symbolFill: 'rgb(255, 255, 194)', // LIGHTYELLOW
  pin: 'rgb(132, 0, 0)',
  pinName: 'rgb(0, 132, 132)', // CYAN (legacy)
  pinNumber: 'rgb(132, 0, 0)',
  reference: 'rgb(0, 132, 132)',
  value: 'rgb(0, 132, 132)',
  fields: 'rgb(132, 0, 132)', // MAGENTA (legacy)
  label: 'rgb(0, 0, 0)', // BLACK
  globalLabel: 'rgb(132, 0, 0)',
  hierLabel: 'rgb(132, 132, 0)', // BROWN (legacy)
  netHighlight: 'rgb(255, 0, 255)', // PUREMAGENTA
  selectionShadow: 'rgba(102, 178, 255, 0.8)',
  noteLine: 'rgb(0, 0, 194)', // LIGHTBLUE (legacy)
  noText: 'rgb(0, 0, 194)',
  privateNote: 'rgb(0, 0, 194)',
  noConnect: 'rgb(0, 0, 132)',
  ercError: 'rgba(255, 0, 0, 0.8)', // PURERED
  ercWarning: 'rgba(0, 255, 0, 0.8)', // PUREGREEN
  sheetBorder: 'rgb(132, 0, 132)', // MAGENTA
  sheetBackground: 'rgba(255, 255, 255, 0)',
  sheetName: 'rgb(0, 132, 132)',
  sheetFile: 'rgb(132, 132, 0)',
  sheetLabel: 'rgb(0, 132, 132)',
  sheetFields: 'rgb(132, 0, 132)',
  pageFrame: 'rgb(132, 0, 0)', // RED
  pageLimits: 'rgb(181, 181, 181)', // falls back to the default theme's value
  anchor: 'rgb(0, 0, 255)',
  hidden: 'rgb(194, 194, 194)', // LIGHTGRAY
  cursor: 'rgb(0, 0, 0)', // BLACK
};

/** Builtin themes by their KiCad settings ids. */
export const BUILTIN_THEMES: Record<string, { name: string; theme: Theme }> = {
  _builtin_default: { name: 'KiCad Default', theme: KICAD_DEFAULT },
  _builtin_classic: { name: 'KiCad Classic', theme: KICAD_CLASSIC },
};
