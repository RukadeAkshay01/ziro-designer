/**
 * Core enums and constants for the Gerber viewer engine, mirroring
 * `gerbview/gerbview_settings.h`, `gerbview/dcode.h`, and
 * `gerbview/gerber_draw_item.h`.
 *
 * Coordinates are integer internal units. Following KiCad's board IU, 1 IU =
 * 1 nm, so IU_PER_MM = 1e6. GerbView reads Gerber/Excellon coordinates in the
 * file unit (mm or inch) and scales them here.
 */

/** Internal units per millimetre (1 IU = 1 nanometre). */
export const IU_PER_MM = 1e6;
/** Internal units per mil (0.001"). 1 mil = 0.0254 mm. */
export const IU_PER_MILS = 25400;

/** GerbView supports up to 32 Gerber layers (GERBER_DRAWLAYERS_COUNT). */
export const GERBER_DRAWLAYERS_COUNT = 32;

/**
 * Aperture shape kinds (APERTURE_T in dcode.h). APT_MACRO defers to an
 * APERTURE_MACRO for its geometry.
 */
export enum APERTURE_T {
  APT_CIRCLE = 'C',
  APT_RECT = 'R',
  APT_OVAL = 'O',
  APT_POLYGON = 'P',
  APT_MACRO = 'M',
}

/**
 * The concrete shape stored on a GERBER_DRAW_ITEM (GBR_BASIC_SHAPES /
 * GERBER_DRAW_ITEM::m_Shape). Spot shapes are single flashed apertures; the
 * segment/arc/circle shapes are drawn traces; GBR_POLYGON is a filled region
 * (G36/G37) or a macro/primitive outline.
 */
export enum GBR_BASIC_SHAPE {
  GBR_SEGMENT = 'segment',
  GBR_ARC = 'arc',
  GBR_CIRCLE = 'circle',
  GBR_POLYGON = 'polygon',
  GBR_SPOT_CIRCLE = 'spot_circle',
  GBR_SPOT_RECT = 'spot_rect',
  GBR_SPOT_OVAL = 'spot_oval',
  GBR_SPOT_POLY = 'spot_poly',
  GBR_SPOT_MACRO = 'spot_macro',
}

/** Interpolation mode set by G01/G02/G03 (GERB_INTERPOL_*). */
export enum GERB_INTERPOL {
  LINEAR_1X = 'linear',
  ARC_G02_CW = 'arc_cw',
  ARC_G03_CCW = 'arc_ccw',
}

/** Image justification (IJ command) — rarely used but part of RS-274X. */
export enum IMAGE_JUSTIFY {
  NO_JUSTIFY = 0,
  CENTER = 1,
  LEFT = 2,
  RIGHT = 3,
}

/** File-format family detected for a loaded layer. */
export enum GERBER_FORMAT {
  RS274X = 'RS274X',
  EXCELLON = 'EXCELLON',
}
