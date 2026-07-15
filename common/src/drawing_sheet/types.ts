/**
 * Drawing-sheet (page-layout) model, ported from KiCad's `pl_editor` /
 * `common/drawing_sheet`.
 *
 * A drawing sheet is the "stationery" drawn behind every schematic sheet and PCB
 * layout: the page border, the coordinate reference band, and the title block.
 * KiCad stores it as a `.kicad_wks` S-expression and models it in memory as a
 * `DS_DATA_MODEL` holding `DS_DATA_ITEM`s (segment / rect / text / bitmap /
 * poly-polygon). This is the web-native mirror of that model.
 *
 * Coordinates here are millimetres (doubles), exactly as `DS_DATA_ITEM` keeps
 * them — the drawing sheet is authored in page millimetres, not schematic IU.
 * Each point carries the page **corner** it is anchored to, so one layout adapts
 * across page sizes (A4/A3/US Letter, portrait/landscape) without breaking. The
 * layout resolver (`layout.ts`) turns anchored millimetres into concrete IU page
 * coordinates for a given page.
 */

/** Page corner an item coordinate is measured from (DS_DATA_ITEM::CORNER_ANCHOR). */
export type WksCorner = 'ltcorner' | 'rtcorner' | 'lbcorner' | 'rbcorner';

/**
 * On which pages an item is drawn (DS_DATA_ITEM::m_Page1Option):
 *  - `normal`      : every page
 *  - `page1only`   : only the first page
 *  - `notonpage1`  : every page except the first
 */
export type WksOption = 'normal' | 'page1only' | 'notonpage1';

export type WksHJustify = 'left' | 'center' | 'right';
export type WksVJustify = 'top' | 'center' | 'bottom';

/** A corner-anchored coordinate in millimetres. */
export interface WksPoint {
  x: number;
  y: number;
  corner: WksCorner;
}

/** A plain (un-anchored) millimetre point, used for polygon contour vertices. */
export interface WksXY {
  x: number;
  y: number;
}

export type WksItemType = 'line' | 'rect' | 'text' | 'bitmap' | 'polygon';

/** Fields shared by every drawing-sheet item (DS_DATA_ITEM base). */
export interface WksItemBase {
  /** Item type discriminant. */
  type: WksItemType;
  /** User-facing name shown in the Design Tree (DS_DATA_ITEM::m_Name). */
  name: string;
  /** Which pages this item appears on. */
  option: WksOption;
  /** Repeat count including the original (DS_DATA_ITEM::m_RepeatCount). 1 = no repeat. */
  repeat: number;
  /** Per-repeat step in millimetres (DS_DATA_ITEM::m_IncrementVector). */
  incrx: number;
  incry: number;
  /** Per-repeat label increment for text (DS_DATA_ITEM_TEXT::m_IncrementLabel). */
  incrlabel: number;
  /** Free-form comment (DS_DATA_ITEM::m_Info). */
  comment: string;
}

export interface WksLine extends WksItemBase {
  type: 'line';
  start: WksPoint;
  end: WksPoint;
  /** Pen width in mm; 0 means "use the setup default". */
  lineWidth: number;
}

export interface WksRect extends WksItemBase {
  type: 'rect';
  start: WksPoint;
  end: WksPoint;
  lineWidth: number;
}

/** RGBA text colour (file `(color R G B A)`, RGB 0-255, A 0..1). */
export interface WksColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface WksText extends WksItemBase {
  type: 'text';
  /** Raw text, which may contain `${...}` variables resolved at layout time. */
  text: string;
  pos: WksPoint;
  /** Glyph size in mm (width, height); 0 means "use the setup default". */
  fontW: number;
  fontH: number;
  bold: boolean;
  italic: boolean;
  /** Font face name (file `(font (face NAME))`); empty = stroke font. */
  face?: string;
  /** Text colour override (DS_DATA_ITEM_TEXT::m_TextColor); unset = layer colour. */
  color?: WksColor;
  /** Stroke pen width in mm; 0 means "derive from size/bold". */
  lineWidth: number;
  hjustify: WksHJustify;
  vjustify: WksVJustify;
  /** Rotation in degrees (counter-clockwise). */
  rotate: number;
  /** Clamp box in mm; 0 = unconstrained (DS_DATA_ITEM_TEXT::m_BoundingBoxSize). */
  maxlen: number;
  maxheight: number;
}

export interface WksBitmap extends WksItemBase {
  type: 'bitmap';
  pos: WksPoint;
  /** Uniform scale factor (DS_DATA_ITEM_BITMAP::m_ImageBitmap scale). */
  scale: number;
  /**
   * PNG bytes, base64-encoded — the payload of the `(data "…" "…")` chunks the
   * current format stores (files ≥ 20230607). Legacy hex `(pngdata (data …))`
   * payloads are converted to base64 on read. Empty = no image (not saved).
   */
  pngB64: string;
  /**
   * Pixels-per-inch used to size the image (default 300). Not written to the
   * file: upstream derives it from the PNG itself (pHYs chunk), so this is a
   * decoded cache the browser side fills in.
   */
  ppi: number;
  /**
   * Natural pixel dimensions of the decoded image, when known. Not part of the
   * `.kicad_wks` format (KiCad derives them by decoding the PNG); ZiroEDA caches
   * them on the model so DOM-free code (bbox, hit-testing) can size the image.
   */
  pxW?: number;
  pxH?: number;
}

export interface WksPoly extends WksItemBase {
  type: 'polygon';
  pos: WksPoint;
  /** Rotation in degrees about `pos`. */
  rotate: number;
  lineWidth: number;
  /** One or more closed contours, vertices in mm relative to `pos`. */
  contours: WksXY[][];
}

export type WksItem = WksLine | WksRect | WksText | WksBitmap | WksPoly;

/** Page defaults (DS_DATA_MODEL setup section). */
export interface WksSetup {
  /** Default text size in mm (width, height). */
  textW: number;
  textH: number;
  /** Default graphic line width in mm. */
  lineWidth: number;
  /** Default text stroke width in mm. */
  textLineWidth: number;
  /** Page margins in mm. */
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
}

/** A full drawing sheet (DS_DATA_MODEL). */
export interface WksSheet {
  version: number;
  generator: string;
  setup: WksSetup;
  items: WksItem[];
}

/** KiCad's built-in setup defaults (drawing_sheet_default_description.cpp). */
export const DEFAULT_SETUP: WksSetup = {
  textW: 1.5,
  textH: 1.5,
  lineWidth: 0.15,
  textLineWidth: 0.15,
  leftMargin: 10,
  rightMargin: 10,
  topMargin: 10,
  bottomMargin: 10,
};

/**
 * `.kicad_wks` format version ZiroEDA writes (ds_file_versions.h,
 * SEXPR_WORKSHEET_FILE_VERSION: 20231118 = generator_version + V8 cleanup).
 */
export const WKS_FILE_VERSION = 20231118;

/** `(generator_version …)` string written alongside the generator token. */
export const WKS_GENERATOR_VERSION = '10.0';
