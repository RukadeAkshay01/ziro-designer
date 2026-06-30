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

import type { SList } from '../sexpr/types.js';

/** 2D point/vector in integer internal units (100 nm). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Line style, matching KiCad's `(stroke (width ..) (type ..))`. */
export interface Stroke {
  /** Width in IU. 0 means "default". */
  readonly width: number;
  /** default | solid | dash | dot | dash_dot | dash_dot_dot */
  readonly type: string;
}

/** Fill, matching KiCad's `(fill (type ..))`: none | outline | background | color. */
export interface Fill {
  readonly type: string;
}

/** Text rendering attributes, matching KiCad's `(effects (font ..) (justify ..) hide)`. */
export interface TextEffects {
  /** Font size as [height, width] in IU. */
  readonly fontSize?: readonly [number, number];
  /** Horizontal/vertical justification tokens, e.g. ['left','bottom']. */
  readonly justify?: readonly string[];
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
  readonly hidden: boolean;
  readonly source: SList;
}

/** A graphic body element of a symbol unit. `kind` selects which fields apply. */
export type LibGraphic =
  | { readonly kind: 'rectangle'; readonly start: Vec2; readonly end: Vec2; readonly stroke?: Stroke; readonly fill?: Fill; readonly source: SList }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number; readonly stroke?: Stroke; readonly fill?: Fill; readonly source: SList }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly mid: Vec2; readonly end: Vec2; readonly stroke?: Stroke; readonly fill?: Fill; readonly source: SList }
  | { readonly kind: 'polyline'; readonly points: readonly Vec2[]; readonly stroke?: Stroke; readonly fill?: Fill; readonly source: SList }
  | { readonly kind: 'text'; readonly text: string; readonly at: Vec2; readonly angle: number; readonly effects?: TextEffects; readonly source: SList };

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
  readonly stroke?: Stroke;
  readonly uuid?: string;
  readonly source: SList;
}

/** A wire junction dot. Mirrors KiCad `SCH_JUNCTION`. */
export interface SchJunction {
  readonly at: Vec2;
  /** Diameter in IU; 0 means "default". */
  readonly diameter: number;
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
  readonly labels: readonly SchLabel[];
  /** The root AST node, retained as the lossless source of truth. */
  readonly source: SList;
}
