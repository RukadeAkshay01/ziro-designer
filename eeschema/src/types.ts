/**
 * Typed schematic document model.
 *
 * This is a *view* over the lossless S-expression AST, grounded in KiCad's own
 * data model (`SCH_*` / `LIB_SYMBOL` classes and the `kicad_sexpr` parser). Two
 * principles, both chosen to avoid corner-cutting that would bite later:
 *
 *  1. Coordinates are integer internal units (100 nm), never float millimetres —
 *     see units.ts. This keeps geometry/equality exact.
 *
 *  2. Every modelled item retains `source`, the `SList` it was read from. Items we
 *     do not modify can be re-serialized straight from `source`, so a save never
 *     reformats or drops fields ZiroEDA does not yet understand. The typed fields
 *     are for reading/rendering/editing; `source` is the lossless backing store.
 */

import type { SList } from '@ziroeda/sexpr/src/types.js';

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
export type { Vec2 };

/** Line style, matching KiCad's `(stroke (width ..) (type ..) (color ..))`. */
export interface Stroke {
  /** Width in IU. 0 means "default". */
  readonly width: number;
  /** default | solid | dash | dot | dash_dot | dash_dot_dot */
  readonly type: string;
  /** Optional explicit colour [r,g,b,a] (rgb 0-255, a 0-1); used by graphic lines. */
  readonly color?: readonly [number, number, number, number];
}

/** Fill, matching KiCad's `(fill (type ..) [(color ..)])`: none | outline | background | color. */
export interface Fill {
  readonly type: string;
  /** Explicit fill colour [r,g,b,a] when type is `color`. */
  readonly color?: readonly [number, number, number, number];
}

/** Text rendering attributes, matching KiCad's `(effects (font ..) (justify ..) hide)`. */
export interface TextEffects {
  /** Font size as [height, width] in IU. */
  readonly fontSize?: readonly [number, number];
  /** Horizontal/vertical justification tokens, e.g. ['left','bottom']. */
  readonly justify?: readonly string[];
  /** Bold face (KiCad `(font ... bold)`): drawn with a heavier pen (size/5). */
  readonly bold?: boolean;
  /** Italic face (KiCad `(font ... italic)`): glyphs sheared by ITALIC_TILT (1/8). */
  readonly italic?: boolean;
  /** Explicit text colour [r,g,b,a] from `(font ... (color ...))`, if any. */
  readonly color?: readonly [number, number, number, number];
  readonly hidden: boolean;
}

// ----- Library symbol (the reusable definition) -----------------------------

/** A pin in a symbol definition. Mirrors KiCad `SCH_PIN` as parsed in a lib symbol. */
export interface LibPin {
  /** Electrical type token: input | output | bidirectional | passive | power_in | … */
  readonly electricalType: string;
  /** Graphic shape token: line | inverted | clock | … */
  readonly shape: string;
  /** Pin connection point (the "active" end), in IU, relative to the symbol origin. */
  readonly at: Vec2;
  /** Orientation in degrees: 0 (right) | 90 (up) | 180 (left) | 270 (down). */
  readonly angle: number;
  /** Pin line length in IU. */
  readonly length: number;
  readonly name: string;
  readonly number: string;
  /** Name text height in IU; 0 hides the name (Altium imports use this), undefined = default. */
  readonly nameSize?: number;
  /** Number text height in IU; 0 hides the number, undefined = default. */
  readonly numberSize?: number;
  readonly hidden: boolean;
  readonly source: SList;
}

/** A graphic body element of a symbol unit. `kind` selects which fields apply. */
export type LibGraphic =
  | {
      readonly kind: 'rectangle';
      readonly start: Vec2;
      readonly end: Vec2;
      readonly stroke?: Stroke;
      readonly fill?: Fill;
      readonly source: SList;
    }
  | {
      readonly kind: 'circle';
      readonly center: Vec2;
      readonly radius: number;
      readonly stroke?: Stroke;
      readonly fill?: Fill;
      readonly source: SList;
    }
  | {
      readonly kind: 'arc';
      readonly start: Vec2;
      readonly mid: Vec2;
      readonly end: Vec2;
      readonly stroke?: Stroke;
      readonly fill?: Fill;
      readonly source: SList;
    }
  | {
      readonly kind: 'polyline';
      readonly points: readonly Vec2[];
      readonly stroke?: Stroke;
      readonly fill?: Fill;
      readonly source: SList;
    }
  | {
      readonly kind: 'bezier';
      /** Cubic Bézier control points: start, ctrl1, ctrl2, end. */
      readonly points: readonly Vec2[];
      readonly stroke?: Stroke;
      readonly fill?: Fill;
      readonly source: SList;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly at: Vec2;
      readonly angle: number;
      readonly effects?: TextEffects;
      readonly source: SList;
    };

/**
 * One unit/body-style of a symbol definition, e.g. `Conn_01x02_1_1`. The name
 * encodes `<symbol>_<unit>_<bodyStyle>`. Holds the drawable primitives and pins.
 */
export interface LibSymbolUnit {
  readonly name: string;
  readonly unit: number;
  readonly bodyStyle: number;
  readonly graphics: readonly LibGraphic[];
  readonly pins: readonly LibPin[];
  readonly source: SList;
}

/** A symbol definition from the schematic's `(lib_symbols ...)` cache. */
export interface LibSymbol {
  /** Library id as written, e.g. "Connector_Generic:Conn_01x02". */
  readonly libId: string;
  /** Parent symbol name if this is a derived symbol (`extends`); units come from it. */
  readonly extends?: string;
  readonly isPower: boolean;
  /** `(pin_numbers (hide yes))` — hide all pin numbers. */
  readonly pinNumbersHidden: boolean;
  /** `(pin_names (hide yes))` — hide all pin names. */
  readonly pinNamesHidden: boolean;
  /** `(pin_names (offset X))` — distance pin names sit inside the body, in IU. */
  readonly pinNameOffset: number;
  /** Visible/!hidden fields (Reference, Value, Footprint, …) keyed by name. */
  readonly properties: readonly SchField[];
  readonly units: readonly LibSymbolUnit[];
  readonly source: SList;
}

// ----- Schematic instance items ---------------------------------------------

/** A property/field on a symbol or lib symbol: `(property "Reference" "J1" (at ..) (effects ..))`. */
export interface SchField {
  readonly key: string;
  readonly value: string;
  readonly at?: Vec2;
  readonly angle: number;
  readonly effects?: TextEffects;
  /** `(show_name yes)` — render as "Name: Value" (SCH_FIELD::IsNameShown). */
  readonly nameShown?: boolean;
  readonly source: SList;
}

/** A placed symbol on the schematic. Mirrors KiCad `SCH_SYMBOL`. */
export interface SchSymbol {
  readonly libId: string;
  readonly at: Vec2;
  /** Orientation in degrees: 0 | 90 | 180 | 270. Combined with `mirror` to render. */
  readonly angle: number;
  /** Mirror axis, if any: 'x' or 'y'. */
  readonly mirror?: 'x' | 'y';
  readonly unit: number;
  readonly bodyStyle: number;
  readonly inBom: boolean;
  readonly onBoard: boolean;
  readonly dnp: boolean;
  /** `(locked yes)` — the symbol is protected from moves/edits (SCH_ITEM::IsLocked). */
  readonly locked?: boolean;
  /** `(exclude_from_sim yes)`; undefined when the token is absent (pre-7.0 files). */
  readonly excludedFromSim?: boolean;
  readonly uuid?: string;
  readonly fields: readonly SchField[];
  readonly source: SList;
}

/** Electrical layer of a SCH_LINE: wire (net) | bus | notes (graphic). */
export type LineKind = 'wire' | 'bus' | 'polyline';

/** A wire/bus/graphic line. Mirrors KiCad `SCH_LINE`. */
export interface SchLine {
  readonly kind: LineKind;
  readonly start: Vec2;
  readonly end: Vec2;
  /** All vertices for a multi-point graphic polyline (>2 pts); undefined for wires/buses. */
  readonly points?: readonly Vec2[];
  readonly stroke?: Stroke;
  readonly uuid?: string;
  readonly source: SList;
}

/** A wire junction dot. Mirrors KiCad `SCH_JUNCTION`. */
export interface SchJunction {
  readonly at: Vec2;
  /** Diameter in IU; 0 means "default". */
  readonly diameter: number;
  /** Optional explicit colour [r,g,b,a]; unset = the junction layer colour. */
  readonly color?: readonly [number, number, number, number];
  readonly uuid?: string;
  readonly source: SList;
}

/** A no-connect flag (the X on a deliberately unconnected pin). Mirrors KiCad `SCH_NO_CONNECT`. */
export interface SchNoConnect {
  readonly at: Vec2;
  readonly uuid?: string;
  readonly source: SList;
}

/** A wire-to-bus entry (the 45° stub). Mirrors KiCad `SCH_BUS_WIRE_ENTRY`. */
export interface SchBusEntry {
  readonly at: Vec2;
  /** Signed extent: the entry runs from `at` to `at + size`. */
  readonly size: Vec2;
  readonly stroke?: Stroke;
  readonly uuid?: string;
  readonly source: SList;
}

/** An embedded bitmap. Mirrors KiCad `SCH_BITMAP` (position is the image centre). */
export interface SchImage {
  readonly at: Vec2;
  readonly scale: number;
  /** Base64 PNG payload from `(data ...)`. */
  readonly data: string;
  readonly uuid?: string;
  readonly source: SList;
}

/** Margins around a text box's text, in IU (left/top/right/bottom). Mirrors SCH_TEXTBOX margins. */
export interface TextBoxMargins {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * A bordered, word-wrapped text box. Mirrors KiCad `SCH_TEXTBOX`
 * (`(text_box "content" (at x y angle) (size w h) (margins l t r b)
 *   (stroke ..) (fill ..) (effects ..) (uuid ..))`). `start`/`end` are the two
 * opposite corners in +Y-down sheet space; the text wraps inside them minus margins.
 */
export interface SchTextBox {
  readonly text: string;
  /** Top-left corner (KiCad GetStart / `(at ..)`). */
  readonly start: Vec2;
  /** Bottom-right corner (start + `(size ..)`). */
  readonly end: Vec2;
  readonly angle: number;
  readonly margins?: TextBoxMargins;
  readonly stroke?: Stroke;
  readonly fill?: Fill;
  readonly effects?: TextEffects;
  /** `(exclude_from_sim yes)`; undefined when absent. */
  readonly excludedFromSim?: boolean;
  readonly uuid?: string;
  readonly source: SList;
}

/**
 * One cell of a table (SCH_TABLECELL): a text box variant that also carries its
 * column/row span. `(table_cell "text" (at ..)(size ..)(margins ..)(span c r)
 * (fill ..)(effects ..)(uuid ..))`.
 */
export interface SchTableCell {
  readonly text: string;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly margins?: TextBoxMargins;
  readonly fill?: Fill;
  readonly effects?: TextEffects;
  readonly source: SList;
}

/**
 * A table (SCH_TABLE): a grid of table cells with configurable borders and
 * row/column separators. `(table (column_count N)(border ..)(separators ..)
 * (column_widths ..)(row_heights ..)(uuid ..)(cells (table_cell ..) ...))`.
 */
export interface SchTable {
  readonly columnCount: number;
  readonly colWidths: readonly number[];
  readonly rowHeights: readonly number[];
  /** `(border (external ..) (header ..) [stroke])`. */
  readonly borderExternal: boolean;
  readonly borderHeader: boolean;
  readonly borderStroke?: Stroke;
  /** `(separators (rows ..) (cols ..) [stroke])`. */
  readonly separatorRows: boolean;
  readonly separatorCols: boolean;
  readonly separatorsStroke?: Stroke;
  readonly cells: readonly SchTableCell[];
  readonly uuid?: string;
  readonly source: SList;
}

/** Kinds of text label, matching KiCad tokens. */
export type LabelKind = 'label' | 'global_label' | 'hierarchical_label' | 'text';

/** Flag shape of a global/hierarchical label: its electrical-direction outline. */
export type LabelShape = 'input' | 'output' | 'bidirectional' | 'tri_state' | 'passive';

/** A net label or free text. Mirrors KiCad `SCH_LABEL` / `SCH_TEXT`. */
export interface SchLabel {
  readonly kind: LabelKind;
  readonly text: string;
  readonly at: Vec2;
  readonly angle: number;
  /** `(shape …)` on global/hierarchical labels; selects the flag outline. */
  readonly shape?: LabelShape;
  readonly effects?: TextEffects;
  readonly uuid?: string;
  readonly source: SList;
}

/** A hierarchical sheet pin: the connection port on a sheet's edge. Mirrors KiCad `SCH_SHEET_PIN`. */
export interface SheetPin {
  readonly name: string;
  /** Flag shape: input | output | bidirectional | tri_state | passive. */
  readonly shape: LabelShape;
  /** Absolute position on the sheet border. */
  readonly at: Vec2;
  /** Side encoding from the file: 0 = right, 90 = top, 180 = left, 270 = bottom. */
  readonly angle: number;
  readonly effects?: TextEffects;
  readonly uuid?: string;
  readonly source: SList;
}

/** A hierarchical sub-sheet. Mirrors KiCad `SCH_SHEET`. */
/**
 * A per-instance record of a sheet (KiCad `SCH_SHEET_INSTANCE`): the same sheet
 * file placed at several points in the hierarchy gets one instance per
 * sheet-path, each with its own page number. On a `(sheet …)` object these live
 * under `(instances (project "name" (path "<ancestor-KIID-path>" (page "N"))))`;
 * the document-level `(sheet_instances (path "/" (page "1")))` records the root
 * sheet's own page (no project wrapper).
 */
export interface SheetInstance {
  /** `(project "…")` name; undefined for the root document's sheet_instances. */
  readonly project?: string;
  /** KIID path of the *containing* sheet-path (excludes this sheet's own uuid),
   *  e.g. "/" for a sheet directly under the root, or "/<rootUuid>/<ancestor>". */
  readonly path: string;
  /** `(page "…")` value; may be absent. */
  readonly page?: string;
  /** The `(path …)` node, kept so the page can be patched losslessly. */
  readonly source: SList;
}

export interface SchSheet {
  readonly at: Vec2;
  readonly size: { readonly w: number; readonly h: number };
  readonly stroke?: Stroke;
  /** `(fill (color r g b a))` — the sheet body colour; absent/alpha-0 = unfilled. */
  readonly fillColor?: readonly [number, number, number, number];
  /** Fields: at least "Sheetname" and "Sheetfile" (KiCad mandatory sheet fields). */
  readonly fields: readonly SchField[];
  readonly pins: readonly SheetPin[];
  /** Per-sheet-path instances (`(instances (project …(path …(page …))))`). */
  readonly instances: readonly SheetInstance[];
  readonly uuid?: string;
  readonly source: SList;
}

/**
 * An item group (`(group …)`). Mirrors KiCad `SCH_GROUP`: a named set of
 * member items referenced by uuid (groups themselves have uuids, so groups
 * can nest as members of other groups).
 */
export interface SchGroup {
  readonly name: string;
  readonly uuid?: string;
  readonly locked?: boolean;
  /** Design-block library link (`(lib_id "Lib:Name")`), when present. */
  readonly libId?: string;
  /** Member item uuids (serialized sorted; empty groups are never written). */
  readonly members: readonly string[];
  readonly source: SList;
}

/** Page/sheet metadata block. */
export interface TitleBlock {
  readonly title?: string;
  readonly date?: string;
  readonly rev?: string;
  readonly company?: string;
  readonly source: SList;
}

/** A whole schematic sheet (`.kicad_sch`). Mirrors KiCad `SCH_SCREEN` contents. */
export interface Schematic {
  readonly version: number;
  readonly generator?: string;
  readonly generatorVersion?: string;
  readonly uuid?: string;
  /** Paper size token, e.g. "A4". */
  readonly paper?: string;
  readonly titleBlock?: TitleBlock;
  readonly libSymbols: readonly LibSymbol[];
  readonly symbols: readonly SchSymbol[];
  readonly lines: readonly SchLine[];
  readonly junctions: readonly SchJunction[];
  readonly noConnects: readonly SchNoConnect[];
  readonly labels: readonly SchLabel[];
  readonly sheets: readonly SchSheet[];
  readonly busEntries: readonly SchBusEntry[];
  readonly images: readonly SchImage[];
  /** Sheet-level graphic shapes (rectangle/circle/arc) on the notes layer. */
  readonly graphics: readonly LibGraphic[];
  /** Bordered, word-wrapped text boxes (SCH_TEXTBOX). */
  readonly textBoxes: readonly SchTextBox[];
  /** Tables (SCH_TABLE): grids of table cells with borders/separators. */
  readonly tables: readonly SchTable[];
  /** Item groups (SCH_GROUP): named sets of member item uuids. */
  readonly groups: readonly SchGroup[];
  /** Document-level `(sheet_instances (path "/" (page "1")))` — the root sheet's
   *  own page number(s), one per project path (no project wrapper). */
  readonly sheetInstances: readonly SheetInstance[];
  /** The root AST node, retained as the lossless source of truth. */
  readonly source: SList;
  /** Display filename (app metadata set on load; not part of the file format). */
  readonly fileName?: string;
}
