/**
 * Project-scoped board settings: the data model edited by the Board Setup
 * dialog. Counterpart: `pcbnew/board_design_settings.h`
 * (BOARD_DESIGN_SETTINGS) plus the stackup / net-settings / component-class
 * slices the dialog's pages edit — kept apart from the panel components
 * (KiCad's data/UI split, and a plain .ts module so the engine, the
 * `.kicad_pro`/`.kicad_pcb` serializers and tests can import it without
 * pulling in React panels).
 *
 * Each panel re-exports its slice from here, so panel modules remain the
 * conventional import site for panel-specific types.
 *
 * Units follow the panels: lengths are mm (the file stores mm too), ratios
 * that KiCad shows as percentages are held as percent numbers.
 */

import {
  defaultEmbeddedFiles,
  defaultNetClasses,
  type EmbeddedFilesData,
  type NetClassesData,
  type TextVar,
} from '../schematic/schematic_settings.js';

// ---------------------------------------------------------------------------
// Constraints (PANEL_SETUP_CONSTRAINTS / BOARD_DESIGN_SETTINGS minimums), mm.

export interface BoardConstraints {
  // Copper
  minClearanceMM: number;
  minTrackMM: number;
  minConnectionMM: number;
  minAnnularMM: number;
  minViaMM: number;
  minUViaMM: number;
  minUViaHoleMM: number;
  copperToHoleMM: number;
  copperToEdgeMM: number;
  // Holes
  minThroughHoleMM: number;
  minHoleToHoleMM: number;
  // Silk
  silkClearanceMM: number;
  minTextHeightMM: number;
  minTextThicknessMM: number;
  // Arc/Circle approximation
  maxDeviationMM: number;
  // Zone fill strategy
  allowFilletsOutside: boolean;
  minThermalSpokes: number;
  // Length tuning
  includeStackupHeight: boolean;
}

/** The `rules.*` param defaults (board_design_settings.cpp:264-332) — what a
 *  missing key means on read, and what KiCad seeds a new project with. */
export function defaultConstraints(): BoardConstraints {
  return {
    minClearanceMM: 0,
    minTrackMM: 0.2,
    minConnectionMM: 0,
    minAnnularMM: 0.1,
    minViaMM: 0.5,
    minUViaMM: 0.2,
    minUViaHoleMM: 0.1,
    copperToHoleMM: 0.25,
    copperToEdgeMM: 0.5,
    minThroughHoleMM: 0.3,
    minHoleToHoleMM: 0.25,
    silkClearanceMM: 0,
    minTextHeightMM: 0.8,
    minTextThicknessMM: 0.08,
    maxDeviationMM: 0.005, // rules.max_error (ARC_HIGH_DEF)
    allowFilletsOutside: false, // zones_allow_external_fillets
    minThermalSpokes: 2,
    includeStackupHeight: true, // rules.use_height_for_length_calcs
  };
}

// ---------------------------------------------------------------------------
// Pre-defined routing sizes (PANEL_SETUP_TRACKS_AND_VIAS), mm.

export interface ViaSize {
  diameter: number;
  drill: number;
}
export interface DiffPairSize {
  width: number;
  gap: number;
  viaGap: number;
}

// ---------------------------------------------------------------------------
// Board Editor Layers (PANEL_SETUP_LAYERS).

export type CopperLayerType = 'signal' | 'power' | 'mixed' | 'jumper';

export interface BoardLayer {
  id: string;
  name: string;
  enabled: boolean;
  kind: 'copper' | 'tech';
  /** Copper layers only. */
  copperType?: CopperLayerType;
  /** Non-copper layers: descriptive label shown in the type column. */
  desc?: string;
}

export interface LayersSetup {
  layers: BoardLayer[];
}

// KiCad's default layer set in physical stack order (id, name, desc, default-on).
const DEFAULT_LAYERS: BoardLayer[] = [
  { id: 'F.CrtYd', name: 'F.Courtyard', kind: 'tech', desc: 'Off-board, testing', enabled: true },
  { id: 'F.Fab', name: 'F.Fab', kind: 'tech', desc: 'Off-board, manufacturing', enabled: true },
  { id: 'F.Adhes', name: 'F.Adhesive', kind: 'tech', desc: 'On-board, non-copper', enabled: false },
  { id: 'F.Paste', name: 'F.Paste', kind: 'tech', desc: 'On-board, non-copper', enabled: true },
  {
    id: 'F.SilkS',
    name: 'F.Silkscreen',
    kind: 'tech',
    desc: 'On-board, non-copper',
    enabled: true,
  },
  { id: 'F.Mask', name: 'F.Mask', kind: 'tech', desc: 'On-board, non-copper', enabled: true },
  { id: 'F.Cu', name: 'F.Cu', kind: 'copper', copperType: 'signal', enabled: true },
  { id: 'B.Cu', name: 'B.Cu', kind: 'copper', copperType: 'signal', enabled: true },
  { id: 'B.Mask', name: 'B.Mask', kind: 'tech', desc: 'On-board, non-copper', enabled: true },
  {
    id: 'B.SilkS',
    name: 'B.Silkscreen',
    kind: 'tech',
    desc: 'On-board, non-copper',
    enabled: true,
  },
  { id: 'B.Paste', name: 'B.Paste', kind: 'tech', desc: 'On-board, non-copper', enabled: true },
  { id: 'B.Adhes', name: 'B.Adhesive', kind: 'tech', desc: 'On-board, non-copper', enabled: false },
  { id: 'B.Fab', name: 'B.Fab', kind: 'tech', desc: 'Off-board, manufacturing', enabled: true },
  { id: 'B.CrtYd', name: 'B.Courtyard', kind: 'tech', desc: 'Off-board, testing', enabled: true },
  { id: 'Edge.Cuts', name: 'Edge.Cuts', kind: 'tech', desc: 'Board contour', enabled: true },
  { id: 'Margin', name: 'Margin', kind: 'tech', desc: 'Board contour setback', enabled: false },
  { id: 'Dwgs.User', name: 'User.Drawings', kind: 'tech', desc: 'Auxiliary', enabled: true },
  { id: 'Cmts.User', name: 'User.Comments', kind: 'tech', desc: 'Auxiliary', enabled: true },
  { id: 'Eco1.User', name: 'User.Eco1', kind: 'tech', desc: 'Auxiliary', enabled: false },
  { id: 'Eco2.User', name: 'User.Eco2', kind: 'tech', desc: 'Auxiliary', enabled: false },
];

export function defaultLayers(): LayersSetup {
  return { layers: DEFAULT_LAYERS.map((l) => ({ ...l })) };
}

// ---------------------------------------------------------------------------
// Physical Stackup (PANEL_SETUP_BOARD_STACKUP / BOARD_STACKUP).

/** An additional dielectric sublayer (BOARD_STACKUP_ITEM's DIELECTRIC_PRMS
 *  entries past index 0 — the `addsublayer` groups of the file format). */
export interface DielectricSublayer {
  material: string;
  thicknessMM: number;
  epsilonR?: number;
  lossTan?: number;
  locked?: boolean;
}

export interface StackupLayer {
  name: string;
  type: string;
  material: string;
  thicknessMM: number;
  color: string;
  locked?: boolean;
  epsilonR?: number;
  lossTan?: number;
  specFreq?: string;
  dielectricModel?: string;
  /** Dielectric layers only: sublayers beyond the main one (sublayer 1). A
   *  new sublayer starts as DIELECTRIC_PRMS(): thickness 0, epsilon 1, loss 0. */
  sublayers?: DielectricSublayer[];
}

export interface PhysicalStackup {
  copperCount: number;
  impedanceControlled: boolean;
  layers: StackupLayer[];
}

function copperNames(count: number): string[] {
  const inner = Array.from({ length: Math.max(0, count - 2) }, (_, i) => `In${i + 1}.Cu`);
  return ['F.Cu', ...inner, 'B.Cu'];
}

/** A standard FR4 stack for the given copper count (dielectric between each pair). */
export function buildStackup(count: number): StackupLayer[] {
  const silk = (name: string, type: string): StackupLayer => ({
    name,
    type,
    material: 'Not specified',
    thicknessMM: 0.01,
    color: 'White',
  });
  const paste = (name: string, type: string): StackupLayer => ({
    name,
    type,
    material: '',
    thicknessMM: 0,
    color: '',
  });
  const mask = (name: string, type: string): StackupLayer => ({
    name,
    type,
    material: 'Not specified',
    thicknessMM: 0.01,
    color: 'Green',
    epsilonR: 3.3,
    lossTan: 0,
  });
  const cu = (name: string): StackupLayer => ({
    name,
    type: 'Copper',
    material: 'Copper',
    thicknessMM: 0.035,
    color: '',
  });
  const dielectric = (name: string): StackupLayer => ({
    name,
    type: count > 2 ? 'Prepreg' : 'Core',
    material: 'FR4',
    thicknessMM: count > 2 ? 0.1 : 1.51,
    color: '',
    locked: false,
    epsilonR: 4.5,
    lossTan: 0.02,
    specFreq: '',
    dielectricModel: 'Wideband',
  });

  const copper = copperNames(count);
  const rows: StackupLayer[] = [
    silk('F.Silkscreen', 'Top Silk Screen'),
    paste('F.Paste', 'Top Solder Paste'),
    mask('F.Mask', 'Top Solder Mask'),
  ];
  copper.forEach((name, i) => {
    rows.push(cu(name));
    if (i < copper.length - 1) rows.push(dielectric(`Dielectric ${i + 1}`));
  });
  rows.push(
    mask('B.Mask', 'Bottom Solder Mask'),
    paste('B.Paste', 'Bottom Solder Paste'),
    silk('B.Silkscreen', 'Bottom Silk Screen'),
  );
  return rows;
}

export function defaultPhysicalStackup(): PhysicalStackup {
  return { copperCount: 2, impedanceControlled: false, layers: buildStackup(2) };
}

// ---------------------------------------------------------------------------
// Board Finish (PANEL_SETUP_BOARD_FINISH / BOARD_STACKUP fab options).

export interface BoardFinish {
  platedBoardEdge: boolean;
  copperFinish: string;
  edgeCardConnectors: string;
}

// Predefined copper finishes (stackup_predefined_prms.cpp copperFinishType[]).
export const COPPER_FINISHES = [
  'Not specified',
  'ENIG',
  'ENEPIG',
  'HAL SnPb',
  'HAL lead-free',
  'Hard gold',
  'Immersion tin',
  'Immersion nickel',
  'Immersion silver',
  'Immersion gold',
  'HT_OSP',
  'OSP',
  'None',
  'User defined',
];

export function defaultBoardFinish(): BoardFinish {
  // board_stackup.cpp: m_FinishType defaults to "None".
  return { platedBoardEdge: false, copperFinish: 'None', edgeCardConnectors: 'None' };
}

// ---------------------------------------------------------------------------
// Solder Mask/Paste (PANEL_SETUP_MASK_AND_PASTE), mm.

export interface MaskPaste {
  maskExpansionMM: number;
  maskMinWebMM: number;
  maskToCopperMM: number;
  allowBridged: boolean;
  tentFront: boolean;
  tentBack: boolean;
  pasteClearanceMM: number;
  pasteRelativePct: number;
}

export function defaultMaskPaste(): MaskPaste {
  return {
    maskExpansionMM: 0,
    maskMinWebMM: 0,
    maskToCopperMM: 0,
    allowBridged: false,
    tentFront: true,
    tentBack: true,
    pasteClearanceMM: 0,
    pasteRelativePct: 0,
  };
}

// ---------------------------------------------------------------------------
// Text & Graphics Defaults (PANEL_SETUP_TEXT_AND_GRAPHICS + dimensions), mm.

export interface TextGfxRow {
  lineThickness: number;
  textWidth: number;
  textHeight: number;
  textThickness: number;
  italic: boolean;
  keepUpright: boolean;
}

export interface DimensionDefaults {
  units: string;
  format: string;
  precision: string;
  suppressTrailingZeroes: boolean;
  textPosition: string;
  keepTextAligned: boolean;
  arrowLengthMM: number;
  extLineOffsetMM: number;
}

export interface TextGfxDefaults {
  rows: TextGfxRow[];
  dimensions: DimensionDefaults;
}

/** Layer-class order of TextGfxDefaults.rows (LAYER_CLASS_* indices). */
export const TEXT_GFX_CLASSES = ['silk', 'copper', 'edges', 'courtyard', 'fab', 'other'] as const;

/** BOARD_DESIGN_SETTINGS default layer-class properties (mm) + dimension defaults. */
export function defaultTextGraphics(): TextGfxDefaults {
  const r = (
    lineThickness: number,
    textWidth: number,
    textHeight: number,
    textThickness: number,
  ): TextGfxRow => ({
    lineThickness,
    textWidth,
    textHeight,
    textThickness,
    italic: false,
    keepUpright: true,
  });
  // defaults.* param defaults (board_design_settings.cpp:735-859).
  return {
    rows: [
      r(0.1, 1.0, 1.0, 0.1), // Silk
      r(0.2, 1.5, 1.5, 0.3), // Copper
      r(0.05, 1.0, 1.0, 0.15), // Edge Cuts (line width only)
      r(0.05, 1.0, 1.0, 0.15), // Courtyards (line width only)
      r(0.1, 1.0, 1.0, 0.15), // Fab
      r(0.1, 1.0, 1.0, 0.15), // Other
    ],
    dimensions: {
      units: 'Automatic', // DIM_UNITS_MODE::AUTOMATIC
      format: '1234', // DIM_UNITS_FORMAT::NO_SUFFIX
      precision: '0.0000', // DIM_PRECISION::X_XXXX
      suppressTrailingZeroes: true,
      textPosition: 'Outside', // DIM_TEXT_POSITION::OUTSIDE
      keepTextAligned: true,
      arrowLengthMM: 1.27, // MilsToIU(50)
      extLineOffsetMM: 0.5,
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting (PANEL_SETUP_FORMATTING pcbnew flavour).

export interface PcbFormatting {
  dashLengthRatio: number;
  gapLengthRatio: number;
  applyFields: boolean;
  applyText: boolean;
  applyShapes: boolean;
  applyDimensions: boolean;
  applyBarcodes: boolean;
}

export function defaultPcbFormatting(): PcbFormatting {
  return {
    dashLengthRatio: 12,
    gapLengthRatio: 3,
    applyFields: false,
    applyText: false,
    applyShapes: false,
    applyDimensions: false,
    applyBarcodes: false,
  };
}

// ---------------------------------------------------------------------------
// Zones (PANEL_SETUP_ZONES — default properties for new zones).

export interface ZoneDefaults {
  name: string;
  clearanceMM: number;
  minWidthMM: number;
  padConnection: string;
  thermalGapMM: number;
  thermalSpokeMM: number;
  outlineDisplay: string;
  outlineHatchPitchMM: number;
  cornerSmoothing: string;
  smoothingRadiusMM: number;
  removeIslands: string;
  areaLimitMM2: number;
  locked: boolean;
}

/** defaults.zones.* param defaults (board_design_settings.cpp:872-994). */
export function defaultZones(): ZoneDefaults {
  return {
    name: '',
    clearanceMM: 0.5,
    minWidthMM: 0.25,
    padConnection: 'Thermal reliefs', // ZONE_CONNECTION::THERMAL
    thermalGapMM: 0.5,
    thermalSpokeMM: 0.5,
    outlineDisplay: 'Hatched', // ZONE_BORDER_DISPLAY_STYLE::DIAGONAL_EDGE
    outlineHatchPitchMM: 0.5,
    cornerSmoothing: 'None', // ZONE_SETTINGS::SMOOTHING_NONE
    smoothingRadiusMM: 0,
    removeIslands: 'Always', // ISLAND_REMOVAL_MODE::ALWAYS
    areaLimitMM2: 10,
    locked: false,
  };
}

// ---------------------------------------------------------------------------
// Teardrops (PANEL_SETUP_TEARDROPS / TEARDROP_PARAMETERS).

export interface TeardropShape {
  bestLengthPct: number;
  maxLengthMM: number;
  bestWidthPct: number;
  maxWidthMM: number;
  preferZoneConnection: boolean;
  trackWidthLimitPct: number;
  allowSpanTwoSegments: boolean;
  curvedEdges: boolean;
}

export interface TeardropsSetup {
  round: TeardropShape;
  rect: TeardropShape;
  trackToTrack: TeardropShape;
}

function teardropShape(): TeardropShape {
  return {
    bestLengthPct: 50,
    maxLengthMM: 1.0,
    bestWidthPct: 100,
    maxWidthMM: 2.0,
    preferZoneConnection: true,
    trackWidthLimitPct: 90,
    allowSpanTwoSegments: true,
    curvedEdges: false,
  };
}

export function defaultTeardrops(): TeardropsSetup {
  return { round: teardropShape(), rect: teardropShape(), trackToTrack: teardropShape() };
}

// ---------------------------------------------------------------------------
// Length-tuning Patterns (PANEL_SETUP_TUNING_PATTERNS / PNS::MEANDER_SETTINGS).

export type CornerStyle = 'Chamfer' | 'Fillet';

export interface TuningPattern {
  minAmplitudeMM: number;
  maxAmplitudeMM: number;
  spacingMM: number;
  cornerStyle: CornerStyle;
  radiusPct: number;
  singleSided: boolean;
}

export interface TuningSetup {
  singleTrack: TuningPattern;
  diffPair: TuningPattern;
  diffPairSkew: TuningPattern;
}

// PNS::MEANDER_SETTINGS defaults (pns_meander.cpp): 0.2 / 1.0 / 0.6 mm, ROUND, 80%.
function tuningPattern(): TuningPattern {
  return {
    minAmplitudeMM: 0.2,
    maxAmplitudeMM: 1.0,
    spacingMM: 0.6,
    cornerStyle: 'Fillet',
    radiusPct: 80,
    singleSided: false,
  };
}

export function defaultTuning(): TuningSetup {
  return { singleTrack: tuningPattern(), diffPair: tuningPattern(), diffPairSkew: tuningPattern() };
}

// ---------------------------------------------------------------------------
// Tuning Profiles (PANEL_SETUP_TUNING_PROFILES / DELAY_PROFILE).

export type ProfileType = 'Single' | 'Differential';
export type FreqUnit = 'Hz' | 'kHz' | 'MHz' | 'GHz';

export interface TuningProfile {
  name: string;
  type: ProfileType;
  targetImpedance: number;
  frequency: number;
  frequencyUnit: FreqUnit;
  enableTimeDomain: boolean;
  modelSolderMask: boolean;
  globalUnitDelay: number;
}

export interface TuningProfilesData {
  profiles: TuningProfile[];
}

export function defaultTuningProfiles(): TuningProfilesData {
  return { profiles: [] };
}

// ---------------------------------------------------------------------------
// Component Classes (PANEL_ASSIGN_COMPONENT_CLASSES / COMPONENT_CLASS_SETTINGS).

export type ConditionType = 'Reference' | 'Side' | 'Rotation' | 'Footprint';

export interface ClassCondition {
  type: ConditionType;
  value: string;
}
export interface ComponentClassAssignment {
  componentClass: string;
  matchMode: 'all' | 'any';
  conditions: ClassCondition[];
}
export interface ComponentClassesData {
  assignPerSheet: boolean;
  assignments: ComponentClassAssignment[];
}

export function defaultComponentClasses(): ComponentClassesData {
  return { assignPerSheet: false, assignments: [] };
}

// ---------------------------------------------------------------------------
// Custom Rules (PANEL_SETUP_RULES — the project's .kicad_dru text).

export interface CustomRules {
  text: string;
}

export function defaultCustomRules(): CustomRules {
  return { text: '(version 1)\n' };
}

// ---------------------------------------------------------------------------
// Violation Severity (PANEL_SETUP_SEVERITIES over DRC_ITEM).

export type DrcSeverity = 'error' | 'warning' | 'ignore';
export type DrcSeverities = Record<string, DrcSeverity>;

interface DrcItem {
  code: string;
  title: string;
  /** KiCad default severity (most are error). */
  def?: DrcSeverity;
}
interface DrcCategory {
  heading: string;
  items: DrcItem[];
}

// DRC items in KiCad's category order (drc_item.cpp allItemTypes, v10) —
// codes are the exact GetSettingsKey() strings used in
// board.design_settings.rule_severities; the internal group (padstack_invalid,
// generic_warning/error) has no user-editable severity and is omitted, like
// upstream (heading_internal). Non-error defaults per the BDS constructor
// (board_design_settings.cpp:165-211).
export const DRC_CATEGORIES: DrcCategory[] = [
  {
    heading: 'Electrical',
    items: [
      { code: 'shorting_items', title: 'Items shorting two nets' },
      { code: 'tracks_crossing', title: 'Tracks crossing' },
      { code: 'clearance', title: 'Clearance violation' },
      { code: 'creepage', title: 'Creepage violation' },
      {
        code: 'via_dangling',
        title: 'Via is not connected or connected on only one layer',
        def: 'warning',
      },
      { code: 'track_dangling', title: 'Track has unconnected end', def: 'warning' },
      { code: 'starved_thermal', title: 'Thermal relief connection to zone incomplete' },
    ],
  },
  {
    heading: 'Design for Manufacturing',
    items: [
      { code: 'copper_edge_clearance', title: 'Board edge clearance violation' },
      { code: 'hole_clearance', title: 'Hole clearance violation' },
      { code: 'hole_to_hole', title: 'Drilled hole too close to other hole', def: 'warning' },
      { code: 'holes_co_located', title: 'Drilled holes co-located', def: 'warning' },
      { code: 'track_width', title: 'Track width' },
      { code: 'track_angle', title: 'Track angle' },
      { code: 'track_segment_length', title: 'Track segment length' },
      { code: 'annular_width', title: 'Annular width' },
      { code: 'drill_out_of_range', title: 'Hole size out of range' },
      { code: 'microvia_drill_out_of_range', title: 'Micro via hole size out of range' },
      { code: 'via_diameter', title: 'Via diameter' },
      { code: 'courtyards_overlap', title: 'Courtyards overlap' },
      { code: 'missing_courtyard', title: 'Footprint has no courtyard defined', def: 'ignore' },
      { code: 'malformed_courtyard', title: 'Footprint has malformed courtyard' },
      { code: 'invalid_outline', title: 'Board has malformed outline' },
      { code: 'copper_sliver', title: 'Copper sliver', def: 'warning' },
      {
        code: 'solder_mask_bridge',
        title: 'Solder mask aperture bridges items with different nets',
      },
      { code: 'connection_width', title: 'Copper connection too narrow', def: 'warning' },
      {
        code: 'track_on_post_machined_layer',
        title: 'Track connected to post-machined or backdrilled layer',
      },
      {
        code: 'track_not_centered_on_via',
        title: 'Track endpoint not centered on via',
        def: 'ignore',
      },
      {
        code: 'tuning_profile_track_geometries',
        title: 'Tuning profile track geometries',
        def: 'ignore',
      },
    ],
  },
  {
    heading: 'Schematic Parity',
    items: [
      { code: 'duplicate_footprints', title: 'Duplicate footprints', def: 'warning' },
      { code: 'missing_footprint', title: 'Missing footprint', def: 'warning' },
      { code: 'extra_footprint', title: 'Extra footprint', def: 'warning' },
      {
        code: 'footprint_symbol_mismatch',
        title: "Footprint attributes don't match symbol",
        def: 'warning',
      },
      {
        code: 'footprint_symbol_field_mismatch',
        title: 'Footprint field does not match symbol field',
        def: 'warning',
      },
      {
        code: 'footprint_filters_mismatch',
        title: "Footprint doesn't match symbol's footprint filters",
        def: 'ignore',
      },
      { code: 'net_conflict', title: "Pad net doesn't match schematic", def: 'warning' },
      { code: 'unconnected_items', title: 'Missing connection between items' },
    ],
  },
  {
    heading: 'Signal Integrity',
    items: [
      { code: 'length_out_of_range', title: 'Track length out of range' },
      { code: 'net_chain_stub_length', title: 'Net chain stub length out of range' },
      {
        code: 'net_chain_return_path',
        title: 'Net chain routed without continuous copper on the required reference layer',
      },
      { code: 'skew_out_of_range', title: 'Skew between tracks out of range' },
      { code: 'too_many_vias', title: 'Too many or too few vias on a connection' },
      { code: 'diff_pair_gap_out_of_range', title: 'Differential pair gap out of range' },
      {
        code: 'diff_pair_uncoupled_length_too_long',
        title: 'Differential uncoupled length too long',
      },
    ],
  },
  {
    heading: 'Readability',
    items: [
      { code: 'silk_overlap', title: 'Silkscreen clearance', def: 'warning' },
      { code: 'silk_over_copper', title: 'Silkscreen clipped by solder mask', def: 'warning' },
      { code: 'silk_edge_clearance', title: 'Silkscreen clipped by board edge', def: 'warning' },
      { code: 'text_height', title: 'Text height out of range', def: 'warning' },
      { code: 'text_thickness', title: 'Text thickness out of range', def: 'warning' },
      {
        code: 'mirrored_text_on_front_layer',
        title: 'Mirrored text on front layer',
        def: 'warning',
      },
      {
        code: 'nonmirrored_text_on_back_layer',
        title: 'Non-Mirrored text on back layer',
        def: 'warning',
      },
    ],
  },
  {
    heading: 'Miscellaneous',
    items: [
      { code: 'items_not_allowed', title: 'Items not allowed' },
      { code: 'text_on_edge_cuts', title: 'Text or graphic on Edge.Cuts layer' },
      { code: 'zones_intersect', title: 'Copper zones intersect' },
      { code: 'isolated_copper', title: 'Isolated copper fill', def: 'warning' },
      { code: 'footprint', title: 'Footprint is not valid' },
      { code: 'padstack', title: 'Padstack is questionable', def: 'warning' },
      { code: 'pth_inside_courtyard', title: 'PTH inside courtyard' },
      { code: 'npth_inside_courtyard', title: 'NPTH inside courtyard' },
      { code: 'item_on_disabled_layer', title: 'Item on a disabled copper layer' },
      { code: 'unresolved_variable', title: 'Unresolved text variable' },
      { code: 'assertion_failure', title: 'Assertion failure' },
      {
        code: 'footprint_type_mismatch',
        title: "Footprint component type doesn't match footprint pads",
        def: 'ignore',
      },
      { code: 'lib_footprint_issues', title: 'Footprint not found in libraries', def: 'warning' },
      {
        code: 'lib_footprint_mismatch',
        title: "Footprint doesn't match copy in library",
        def: 'warning',
      },
      { code: 'through_hole_pad_without_hole', title: 'Through hole pad has no hole' },
      {
        code: 'footprint_scaled_with_pads',
        title: 'Footprint with pads is scaled (physical part size unchanged)',
        def: 'warning',
      },
      { code: 'missing_tuning_profile', title: 'Missing tuning profile', def: 'warning' },
    ],
  },
];

/** DRC severity defaults (per-item `def`, else error). */
export function defaultDrcSeverities(): DrcSeverities {
  const out: DrcSeverities = {};
  for (const cat of DRC_CATEGORIES) for (const it of cat.items) out[it.code] = it.def ?? 'error';
  return out;
}

// ---------------------------------------------------------------------------
// The aggregate the Board Setup dialog edits.

export interface BoardSetupValues {
  constraints: BoardConstraints;
  /** Pre-defined routing sizes, mm (PANEL_SETUP_TRACKS_AND_VIAS). */
  trackWidthsMM: number[];
  viaSizesMM: ViaSize[];
  diffPairsMM: DiffPairSize[];
  /** Net classes + assignments (shared PANEL_SETUP_NETCLASSES). */
  netClasses: NetClassesData;
  /** Project text variables (shared PANEL_TEXT_VARIABLES). */
  textVars: TextVar[];
  /** Embedded files + embed-fonts flag (shared PANEL_EMBEDDED_FILES). */
  embeddedFiles: EmbeddedFilesData;
  /** DRC violation severities (PANEL_SETUP_SEVERITIES). */
  drcSeverities: DrcSeverities;
  /** Text & Graphics defaults per layer class (PANEL_SETUP_TEXT_AND_GRAPHICS). */
  textGraphics: TextGfxDefaults;
  /** PCB formatting: dashed lines + apply-defaults flags (PANEL_SETUP_FORMATTING). */
  formatting: PcbFormatting;
  /** Solder mask / paste settings (PANEL_SETUP_MASK_AND_PASTE). */
  maskPaste: MaskPaste;
  /** Custom DRC rules text (PANEL_SETUP_RULES). */
  customRules: CustomRules;
  /** Default properties for new zones (PANEL_SETUP_ZONES). */
  zones: ZoneDefaults;
  /** Enabled board layers + copper count/types (PANEL_SETUP_LAYERS). */
  layers: LayersSetup;
  /** Default teardrop properties (PANEL_SETUP_TEARDROPS). */
  teardrops: TeardropsSetup;
  /** Default length-tuning pattern properties (PANEL_SETUP_TUNING_PATTERNS). */
  tuning: TuningSetup;
  /** Time-domain tuning profiles (PANEL_SETUP_TUNING_PROFILES). */
  tuningProfiles: TuningProfilesData;
  /** Board finish: copper finish + edge connectors (PANEL_SETUP_BOARD_FINISH). */
  boardFinish: BoardFinish;
  /** Physical layer stackup (PANEL_SETUP_BOARD_STACKUP). */
  physicalStackup: PhysicalStackup;
  /** Component-class assignments (PANEL_ASSIGN_COMPONENT_CLASSES). */
  componentClasses: ComponentClassesData;
}

/** KiCad's defaults (board_design_settings.h) for a fresh board/project. */
export function defaultBoardSetup(): BoardSetupValues {
  return {
    constraints: defaultConstraints(),
    trackWidthsMM: [],
    viaSizesMM: [],
    diffPairsMM: [],
    netClasses: defaultNetClasses(),
    textVars: [],
    embeddedFiles: defaultEmbeddedFiles(),
    drcSeverities: defaultDrcSeverities(),
    textGraphics: defaultTextGraphics(),
    formatting: defaultPcbFormatting(),
    maskPaste: defaultMaskPaste(),
    customRules: defaultCustomRules(),
    zones: defaultZones(),
    layers: defaultLayers(),
    teardrops: defaultTeardrops(),
    tuning: defaultTuning(),
    tuningProfiles: defaultTuningProfiles(),
    boardFinish: defaultBoardFinish(),
    physicalStackup: defaultPhysicalStackup(),
    componentClasses: defaultComponentClasses(),
  };
}
