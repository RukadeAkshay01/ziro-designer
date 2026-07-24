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

/** Notation index -> (subpart_id_separator, subpart_first_id) char codes, in
 *  SYMBOL_UNIT_NOTATIONS order (dialog_annotate/panel handling upstream). */
export const UNIT_NOTATION_IDS: readonly (readonly [number, number])[] = [
  [0, 65],
  [46, 65],
  [45, 65],
  [95, 65],
  [46, 49],
  [45, 49],
  [95, 49],
];

/** The SubReference inputs for the chosen unit notation. */
export function subpartSettings(a: AnnotationSettings): { separator: number; firstId: number } {
  const [separator, firstId] = UNIT_NOTATION_IDS[a.symbolUnitNotation] ?? UNIT_NOTATION_IDS[0]!;
  return { separator, firstId };
}

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
// BOM presets (bom_settings.h BOM_PRESET / BOM_FMT_PRESET; PANEL_BOM_PRESETS
// lists them, the Generate BOM dialog applies and saves them).

/** One BOM column (BOM_FIELD): a symbol field or a `${...}` virtual field. */
export interface BomField {
  name: string;
  label: string;
  show: boolean;
  groupBy: boolean;
}

/** A named view of the BOM table (BOM_PRESET). */
export interface BomPreset {
  name: string;
  /** Built-ins only; read-only presets are never persisted, like upstream. */
  readOnly?: boolean;
  fieldsOrdered: BomField[];
  sortField: string;
  sortAsc: boolean;
  filterString: string;
  groupSymbols: boolean;
  excludeDnp: boolean;
  includeExcludedFromBom: boolean;
}

/** A named output format (BOM_FMT_PRESET). */
export interface BomFmtPreset {
  name: string;
  readOnly?: boolean;
  fieldDelimiter: string;
  stringDelimiter: string;
  refDelimiter: string;
  refRangeDelimiter: string;
  keepTabs: boolean;
  keepLineBreaks: boolean;
}

export interface BomPresets {
  presets: BomPreset[];
  fmtPresets: BomFmtPreset[];
}

export function defaultBomPresets(): BomPresets {
  return { presets: [], fmtPresets: [] };
}

const bomField = (name: string, label: string, show: boolean, groupBy: boolean): BomField => ({
  name,
  label,
  show,
  groupBy,
});

/** BOM_PRESET::BuiltInPresets() — Default Editing, Grouped By Value,
 *  Grouped By Value and Footprint, Attributes (bom_settings.cpp). */
export function bomBuiltInPresets(): BomPreset[] {
  const base = {
    readOnly: true,
    sortField: 'Reference',
    sortAsc: true,
    filterString: '',
    groupSymbols: true,
    excludeDnp: false,
  };
  return [
    {
      ...base,
      name: 'Default Editing',
      includeExcludedFromBom: true,
      fieldsOrdered: [
        bomField('Reference', 'Reference', true, false),
        bomField('${QUANTITY}', 'Qty', true, false),
        bomField('Value', 'Value', true, true),
        bomField('${DNP}', 'DNP', true, true),
        bomField('${EXCLUDE_FROM_BOM}', 'Exclude from BOM', true, true),
        bomField('${EXCLUDE_FROM_BOARD}', 'Exclude from Board', true, true),
        bomField('${EXCLUDE_FROM_SIM}', 'Exclude from Simulation', true, true),
        bomField('${EXCLUDE_FROM_POS_FILES}', 'Exclude from Position Files', true, true),
        bomField('Footprint', 'Footprint', true, true),
        bomField('Datasheet', 'Datasheet', true, false),
      ],
    },
    {
      ...base,
      name: 'Grouped By Value',
      includeExcludedFromBom: false,
      fieldsOrdered: [
        bomField('Reference', 'Reference', true, false),
        bomField('Value', 'Value', true, true),
        bomField('Datasheet', 'Datasheet', true, false),
        bomField('Footprint', 'Footprint', true, false),
        bomField('${QUANTITY}', 'Qty', true, false),
        bomField('${DNP}', 'DNP', true, true),
      ],
    },
    {
      ...base,
      name: 'Grouped By Value and Footprint',
      includeExcludedFromBom: false,
      fieldsOrdered: [
        bomField('Reference', 'Reference', true, false),
        bomField('Value', 'Value', true, true),
        bomField('Datasheet', 'Datasheet', true, false),
        bomField('Footprint', 'Footprint', true, true),
        bomField('${QUANTITY}', 'Qty', true, false),
        bomField('${DNP}', 'DNP', true, true),
      ],
    },
    {
      ...base,
      name: 'Attributes',
      includeExcludedFromBom: true,
      fieldsOrdered: [
        bomField('Reference', 'Reference', true, false),
        bomField('Value', 'Value', true, true),
        bomField('Datasheet', 'Datasheet', false, false),
        bomField('Footprint', 'Footprint', false, true),
        bomField('${DNP}', 'Do Not Place', true, false),
        bomField('${EXCLUDE_FROM_BOM}', 'Exclude from BOM', true, false),
        bomField('${EXCLUDE_FROM_BOARD}', 'Exclude from Board', true, false),
        bomField('${EXCLUDE_FROM_SIM}', 'Exclude from Simulation', true, false),
        bomField('${EXCLUDE_FROM_POS_FILES}', 'Exclude from Position Files', true, false),
      ],
    },
  ];
}

/** BOM_FMT_PRESET::BuiltInPresets() — CSV, TSV, Semicolons. */
export function bomFmtBuiltInPresets(): BomFmtPreset[] {
  const base = { readOnly: true, refRangeDelimiter: '', keepTabs: false, keepLineBreaks: false };
  return [
    { ...base, name: 'CSV', fieldDelimiter: ',', stringDelimiter: '"', refDelimiter: ',' },
    { ...base, name: 'TSV', fieldDelimiter: '\t', stringDelimiter: '', refDelimiter: ',' },
    { ...base, name: 'Semicolons', fieldDelimiter: ';', stringDelimiter: "'", refDelimiter: ',' },
  ];
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
  /** The persisted chain -> class map (net_settings.net_chain_classes); the
   *  chains themselves are engine-detected and not stored in the project. */
  classByChain: Record<string, string>;
}

export function defaultNetChains(): NetChainsData {
  return { chains: [], classes: [], classByChain: {} };
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
  // The Default netclass carries KiCad's factory dimensions (NETCLASS defaults,
  // mm); user-added classes start blank (inherit Default).
  return {
    classes: [
      {
        ...blankNetClass('Default'),
        clearance: '0.2',
        trackWidth: '0.25',
        viaSize: '0.8',
        viaHole: '0.4',
        uviaSize: '0.3',
        uviaHole: '0.1',
        dpWidth: '0.2',
        dpGap: '0.25',
      },
    ],
    assignments: [],
  };
}

// ---------------------------------------------------------------------------
// Effective netclass resolution (NET_SETTINGS::GetEffectiveNetClass).

/** The schematic-relevant parameters of a resolved netclass. Unset fields are
 *  undefined ('' colors and blank widths never made it in). */
export interface EffectiveNetClass {
  /** The class name; a multi-class merge is named `Effective for net: <net>`
   *  like upstream's composite netclass. */
  name: string;
  /** `#rrggbb`, when any constituent sets a schematic color. */
  color?: string;
  wireWidthMils?: number;
  busWidthMils?: number;
  /** A LINE_STYLES name; always present (Default's style completes the set). */
  lineStyle: string;
}

/** EDA_COMBINED_MATCHER::StartsWith with CTX_NETCLASS: a plain pattern is a
 *  prefix match; `*` / `?` wildcards match per EDA_PATTERN_MATCH_WILDCARD. */
export function netClassPatternMatches(pattern: string, netName: string): boolean {
  if (!pattern) return false;
  if (!/[*?]/.test(pattern)) return netName.startsWith(pattern);
  const rx = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}`,
  );
  return rx.test(netName);
}

/**
 * NET_SETTINGS::GetEffectiveNetClass, over the dialog's netclass grid: collect
 * every class whose pattern assignment matches the net, sort by priority
 * (grid order; Default = lowest), then fill parameters from the lowest
 * priority up so higher-priority classes win (makeEffectiveNetclass). The
 * Default class completes any missing parameters; an empty net name resolves
 * straight to Default.
 */
export function resolveEffectiveNetClass(netName: string, data: NetClassesData): EffectiveNetClass {
  const dflt = data.classes[0] ?? blankNetClass('Default');
  // Priority = grid position (the serializer writes it that way); Default last.
  const priorityOf = (c: NetClass): number =>
    c === dflt ? Number.MAX_SAFE_INTEGER : data.classes.indexOf(c) - 1;
  const matched: NetClass[] = [];
  if (netName) {
    for (const a of data.assignments) {
      if (!a.netClass) continue;
      const cls = data.classes.find((c) => c.name === a.netClass);
      if (!cls || matched.includes(cls)) continue;
      if (netClassPatternMatches(a.pattern, netName)) matched.push(cls);
    }
  }
  const constituents = matched.length > 0 ? [...matched] : [dflt];
  if (!constituents.includes(dflt)) constituents.push(dflt); // complete params
  constituents.sort((a, b) => priorityOf(a) - priorityOf(b) || a.name.localeCompare(b.name));
  const eff: EffectiveNetClass = {
    name:
      matched.length === 0
        ? dflt.name
        : matched.length === 1
          ? matched[0]!.name
          : `Effective for net: ${netName}`,
    lineStyle: 'Solid',
  };
  const num = (s: string): number | undefined => {
    const v = Number.parseFloat(s);
    return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
  };
  // Lowest priority first, so higher-priority values overwrite.
  for (let i = constituents.length - 1; i >= 0; i--) {
    const c = constituents[i]!;
    const wire = num(c.wireThickness);
    const bus = num(c.busThickness);
    if (wire !== undefined) eff.wireWidthMils = wire;
    if (bus !== undefined) eff.busWidthMils = bus;
    if (c.color) eff.color = c.color;
    // The grid can't express an unset style (rows default to Solid), so only
    // a non-Solid choice contributes — KiCad's HasLineStyle() equivalent.
    if (c.lineStyle && c.lineStyle !== 'Solid') eff.lineStyle = c.lineStyle;
  }
  return eff;
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

/** hopover_size_mult_list (schematic_settings.cpp): wire hop-over arc radius as
 *  a multiple of the default line width, indexed by hopOverChoice
 *  (None, Smallest, Small, Medium, Large, Largest). */
export const HOP_OVER_SIZE_MULT = [0, 1.7, 4, 6, 9, 12] as const;

/** SCHEMATIC_SETTINGS::GetHopOverScale × m_DefaultLineWidth — the painter's
 *  hop-over arc radius in IU (sch_painter.cpp draw(SCH_LINE): arcRadius =
 *  defaultLineWidth × hopOverScale). 0 = hop-overs off ("None"). */
export function hopOverArcRadiusIU(s: SchematicSetup): number {
  const mult = HOP_OVER_SIZE_MULT[s.formatting.hopOverChoice] ?? 0;
  return s.formatting.defaultLineWidthMils * IU_PER_MILS * mult;
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
  /** REFDES_TRACKER state (schematic.used_designators): every designator ever
   *  assigned, so reuse_designators=false never re-issues a freed number. */
  usedDesignators: string;
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
    usedDesignators: '',
  };
}
