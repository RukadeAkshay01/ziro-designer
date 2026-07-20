/**
 * @ziroeda/gerbview — the Gerber/Excellon viewer engine, ported from KiCad's
 * `gerbview/`. Parses RS-274X Gerber and Excellon drill files into a typed
 * item model (GERBER_DRAW_ITEM) grouped into images (GERBER_FILE_IMAGE) and a
 * layout (GBR_LAYOUT), ready for a Canvas 2D renderer in the app.
 */

export * from './types.js';
export * from './aperture_macro.js';
export { D_CODE, APERTURE_DEF_HOLE } from './dcode.js';
export * from './gerber_draw_item.js';
export { GERBER_FILE_IMAGE, type CoordFormat } from './gerber_file_image.js';
export { parseGerber } from './gerber_file_image_parse.js';
export { parseExcellon } from './excellon.js';
export { GBR_LAYOUT } from './gbr_layout.js';
export {
  readGerberOrDrill,
  isExcellonFile,
  parseJobFile,
  type JobFileEntry,
} from './read_gerber.js';
