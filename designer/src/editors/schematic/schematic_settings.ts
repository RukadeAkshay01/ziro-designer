/**
 * Project-scoped schematic settings: the data model edited by the Schematic
 * Setup dialog. Counterpart: `eeschema/schematic_settings.h`
 * (SCHEMATIC_SETTINGS) plus the NET_SETTINGS / project-file slices the dialog's
 * pages edit — kept apart from the panel components (KiCad's data/UI split, and
 * a plain .ts module so the engine, the .kicad_pro serializer and tests can
 * import it without pulling in React panels).
 *
 * Each panel re-exports its slice from here, so panel modules remain the
 * conventional import site for panel-specific types.
 */

import { defaultErcSettings, type ErcSettings } from '@ziroeda/eeschema';

// ---------------------------------------------------------------------------
// Formatting (PANEL_SETUP_FORMATTING / SCHEMATIC_SETTINGS drawing defaults).

/** Junction-dot size choices (m_JunctionSizeChoice). */
export const JUNCTION_DOT_SIZES = ['None', 'Smallest', 'Small', 'Default', 'Large', 'Largest'];
/** Hop-over size choices (m_HopOverSizeChoice). */
export const HOP_OVER_SIZES = ['None', 'Smallest', 'Small', 'Medium', 'Large', 'Largest'];
/** Operating-point overlay voltage-range choices (m_OPO_VRange). */
export const OPO_V_RANGES = [
  'Auto',
  'fV',
  'pV',
  'nV',
  'uV',
  'mV',
  'V',
  'KV',
  'MV',
  'GV',
  'TV',
  'PV',
];
/** Operating-point overlay current-range choices (m_OPO_IRange). */
export const OPO_I_RANGES = [
  'Auto',
  'fA',
  'pA',
  'nA',
  'uA',
  'mA',
  'A',
  'KA',
  'MA',
  'GA',
  'TA',
  'PA',
];

/** SCHEMATIC_SETTINGS formatting subset edited by the Formatting panel. */
export interface FormattingSettings {
  /** Default text size (mils) for new text/labels (m_DefaultTextSize). */
  defaultTextSizeMils: number;
  /** Overbar vertical offset as a % of text size (m_FontMetrics.m_OverbarHeight). */
  overbarOffsetRatio: number;
  /** Label offset above a wire/pin as a % of text size (m_TextOffsetRatio). */
  labelOffsetRatio: number;
  /** Global-label box margin as a % of text size (m_LabelSizeRatio). */
  labelSizeRatio: number;
  /** Default graphic line width (mils) for new items (m_DefaultLineWidth). */
  defaultLineWidthMils: number;
  /** Pin symbol size (mils) for decorations like clocks (m_PinSymbolSize). */
  pinSymbolSizeMils: number;
  /** Junction dot size choice index (m_JunctionSizeChoice). */
  junctionDotChoice: number;
  /** Hop-over size choice index (m_HopOverSizeChoice). */
  hopOverChoice: number;
  /** Connection grid (mils) (m_ConnectionGridSize). */
  connectionGridMils: number;
  /** Show inter-sheet references (m_IntersheetRefsShow). */
  intersheetRefsShow: boolean;
  /** Show own page in the reference list (m_IntersheetRefsListOwnPage). */
  intersheetRefsOwnPage: boolean;
  /** Abbreviated (1..3) vs standard (1,2,3) format (m_IntersheetRefsFormatShort). */
  intersheetRefsAbbreviated: boolean;
  /** Reference list prefix / suffix (m_IntersheetRefsPrefix / Suffix). */
  intersheetRefsPrefix: string;
  intersheetRefsSuffix: string;
  /** Dashed-line dash / gap lengths as ratios of the line width. */
  dashLengthRatio: number;
  gapLengthRatio: number;
  /** Operating-point overlay significant digits, voltages (m_OPO_VPrecision). */
  opoVPrecision: number;
  /** Operating-point overlay voltage range label (m_OPO_VRange); 'Auto' = ~V. */
  opoVRange: string;
  /** Operating-point overlay significant digits, currents (m_OPO_IPrecision). */
  opoIPrecision: number;
  /** Operating-point overlay current range label (m_OPO_IRange); 'Auto' = ~A. */
  opoIRange: string;
}

/** SCHEMATIC_SETTINGS defaults (schematic_settings.cpp). */
export function defaultFormatting(): FormattingSettings {
  return {
    defaultTextSizeMils: 50,
    overbarOffsetRatio: 1.23,
    labelOffsetRatio: 15,
    labelSizeRatio: 37.5,
    defaultLineWidthMils: 6,
    pinSymbolSizeMils: 25,
    junctionDotChoice: 3, // "Default"
    hopOverChoice: 0, // "None"
    connectionGridMils: 50,
    intersheetRefsShow: false,
    intersheetRefsOwnPage: true,
    intersheetRefsAbbreviated: false,
    intersheetRefsPrefix: '[', // DEFAULT_IREF_PREFIX
    intersheetRefsSuffix: ']', // DEFAULT_IREF_SUFFIX
    dashLengthRatio: 12,
    gapLengthRatio: 3,
    opoVPrecision: 3,
    opoVRange: 'Auto',
    opoIPrecision: 3,
    opoIRange: 'Auto',
  };
}

// ---------------------------------------------------------------------------
// Annotation (PANEL_EESCHEMA_ANNOTATION_OPTIONS).

/** Symbol unit notation choices (m_choiceSeparatorRefId). */
export const SYMBOL_UNIT_NOTATIONS = ['A', '.A', '-A', '_A', '.1', '-1', '_1'];

export type AnnotateSortOrder = 'x' | 'y';
export type AnnotateNumbering = 'firstFree' | 'sheetX100' | 'sheetX1000';

/** Annotation defaults edited by the Annotation panel. */
export interface AnnotationSettings {
  /** Symbol unit notation choice index (m_choiceSeparatorRefId). */
  symbolUnitNotation: number;
  /** Sort symbols by X (down-then-right) or Y (right-then-down) position. */
  sortOrder: AnnotateSortOrder;
  /** How the first assigned number is chosen. */
  numbering: AnnotateNumbering;
  /** "Use first free number after:" starting value (m_textNumberAfter). */
  firstFreeAfter: number;
  /** Allow reference reuse (m_checkReuseRefdes). */
  allowReuse: boolean;
}

/** Annotation defaults (eeschema settings). */
export function defaultAnnotation(): AnnotationSettings {
  return {
    symbolUnitNotation: 0, // "A"
    sortOrder: 'x',
    numbering: 'firstFree',
    firstFreeAfter: 0,
    allowReuse: true, // reuse_designators PARAM default
  };
}

// ---------------------------------------------------------------------------
// Field name templates (TEMPLATES / PANEL_TEMPLATE_FIELDNAMES).

export interface FieldTemplate {
  name: string;
  visible: boolean;
  url: boolean;
}

// ---------------------------------------------------------------------------
// Text variables (PANEL_TEXT_VARIABLES / project text_variables).

export interface TextVar {
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// BOM presets (PANEL_BOM_PRESETS).

export interface BomPresets {
  presets: string[];
  fmtPresets: string[];
}

export function defaultBomPresets(): BomPresets {
  return { presets: [], fmtPresets: [] };
}

// ---------------------------------------------------------------------------
// Bus aliases (PANEL_SETUP_BUSES).

export interface BusAlias {
  name: string;
  members: string[];
}

export function defaultBusAliases(): BusAlias[] {
  return [];
}

// ---------------------------------------------------------------------------
// Net chains (PANEL_SETUP_NET_CHAINS).

export interface NetChain {
  name: string;
  members: string[];
  chainClass: string;
  netClass: string;
  color: string;
}
export interface NetChainClass {
  name: string;
  members: number;
}
export interface NetChainsData {
  chains: NetChain[];
  classes: NetChainClass[];
}

export function defaultNetChains(): NetChainsData {
  return { chains: [], classes: [] };
}

// ---------------------------------------------------------------------------
// Net classes (NET_SETTINGS / PANEL_SETUP_NETCLASSES).

export interface NetClass {
  name: string;
  clearance: string;
  trackWidth: string;
  viaSize: string;
  viaHole: string;
  uviaSize: string;
  uviaHole: string;
  dpWidth: string;
  dpGap: string;
  tuningProfile: string;
  pcbColor: string;
  wireThickness: string;
  busThickness: string;
  color: string;
  lineStyle: string;
}
export interface NetClassAssignment {
  pattern: string;
  netClass: string;
}
export interface NetClassesData {
  classes: NetClass[];
  assignments: NetClassAssignment[];
}

/** Wire line styles in file order (stroke_params.h LINE_STYLE: line_style 0-4). */
export const LINE_STYLES = ['Solid', 'Dashed', 'Dotted', 'Dash-Dot', 'Dash-Dot-Dot'];

export function blankNetClass(name: string): NetClass {
  return {
    name,
    clearance: '',
    trackWidth: '',
    viaSize: '',
    viaHole: '',
    uviaSize: '',
    uviaHole: '',
    dpWidth: '',
    dpGap: '',
    tuningProfile: '',
    pcbColor: '',
    wireThickness: '',
    busThickness: '',
    color: '',
    lineStyle: 'Solid',
  };
}

export function defaultNetClasses(): NetClassesData {
  return { classes: [blankNetClass('Default')], assignments: [] };
}

// ---------------------------------------------------------------------------
// Embedded files (PANEL_EMBEDDED_FILES).

export interface EmbeddedFile {
  name: string;
  reference: string;
}
export interface EmbeddedFilesData {
  files: EmbeddedFile[];
  embedFonts: boolean;
}

export function defaultEmbeddedFiles(): EmbeddedFilesData {
  return { files: [], embedFonts: false };
}

// ---------------------------------------------------------------------------
// Derived drawing defaults (SCHEMATIC_SETTINGS helpers).

/** Internal units per mil (schIUScale: 12700 IU = 1.27 mm = 50 mils). */
export const IU_PER_MILS = 254;
/** DEFAULT_WIRE_WIDTH_MILS (eeschema/default_values.h). */
export const DEFAULT_WIRE_WIDTH_MILS = 6;
/** junction_size_mult_list (schematic_settings.cpp): junction-dot diameter as a
 *  multiple of the Default netclass wire width, indexed by junctionDotChoice
 *  (None, Smallest, Small, Default, Large, Largest). */
export const JUNCTION_SIZE_MULT = [0, 1.7, 4, 6, 9, 12] as const;

/** SCHEMATIC_SETTINGS::GetJunctionSize — the effective dot diameter (IU) for
 *  junctions without an explicit diameter: Default-netclass wire width × the
 *  choice multiplier, floored at 1 IU ("None" → 1 = draw no dot). */
export function junctionDotDiameterIU(s: SchematicSetup): number {
  const wireMils =
    parseFloat(s.netClasses.classes[0]?.wireThickness ?? '') || DEFAULT_WIRE_WIDTH_MILS;
  const mult = JUNCTION_SIZE_MULT[s.formatting.junctionDotChoice] ?? 6;
  return Math.max(Math.round(wireMils * IU_PER_MILS * mult), 1);
}

// ---------------------------------------------------------------------------
// The dialog's full working set.

/** Project-scoped schematic settings edited by the dialog (SCHEMATIC_SETTINGS subset). */
export interface SchematicSetup {
  erc: ErcSettings;
  textVars: TextVar[];
  fieldTemplates: FieldTemplate[];
  /** Formatting defaults (PANEL_SETUP_FORMATTING). */
  formatting: FormattingSettings;
  /** Annotation defaults (PANEL_EESCHEMA_ANNOTATION_OPTIONS). */
  annotation: AnnotationSettings;
  /** BOM + BOM-formatting presets (PANEL_BOM_PRESETS). */
  bomPresets: BomPresets;
  /** Bus alias definitions (PANEL_SETUP_BUSES). */
  busAliases: BusAlias[];
  /** Net chains + net-chain classes (PANEL_SETUP_NET_CHAINS). */
  netChains: NetChainsData;
  /** Net classes + assignments (PANEL_SETUP_NETCLASSES). */
  netClasses: NetClassesData;
  /** Embedded files + embed-fonts flag (PANEL_EMBEDDED_FILES). */
  embeddedFiles: EmbeddedFilesData;
  /** ERC exclusion signatures (SCHEMATIC::m_ercExclusions), persisted like the
   *  project file's stored exclusions so an excluded marker stays excluded. */
  ercExclusions: string[];
}

export function defaultSchematicSetup(): SchematicSetup {
  return {
    erc: defaultErcSettings(),
    textVars: [],
    fieldTemplates: [],
    formatting: defaultFormatting(),
    annotation: defaultAnnotation(),
    bomPresets: defaultBomPresets(),
    busAliases: defaultBusAliases(),
    netChains: defaultNetChains(),
    netClasses: defaultNetClasses(),
    embeddedFiles: defaultEmbeddedFiles(),
    ercExclusions: [],
  };
}
