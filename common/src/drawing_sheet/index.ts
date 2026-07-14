/**
 * Drawing sheet (page layout) — the web-native mirror of KiCad's `pl_editor` /
 * `common/drawing_sheet`. Model + `.kicad_wks` reader/writer + layout resolver
 * + editing geometry.
 */
export * from './types.js';
export { readDrawingSheet, parseDrawingSheet } from './read.js';
export { writeDrawingSheet, serializeDrawingSheet } from './write.js';
export { defaultDrawingSheet, emptyDrawingSheet } from './default-sheet.js';
export {
  layoutDrawingSheet,
  resolveDrawingSheetText,
  incrementLabel,
  type WksPage,
  type WksResolveContext,
  type DsDrawItem,
  type DsLineItem,
  type DsTextItem,
  type DsPolyItem,
  type DsBitmapItem,
} from './layout.js';
export {
  drawItemBBox,
  itemBBox,
  pickDrawItem,
  itemsInBox,
  translateItem,
  replaceItem,
  type WksBBox,
} from './edit.js';
