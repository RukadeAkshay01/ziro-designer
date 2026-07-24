/**
 * Project-file persistence for the Board Setup dialog — the `.kicad_pro` side.
 * Counterparts: `pcbnew/board_design_settings.cpp` (BOARD_DESIGN_SETTINGS —
 * the `board.design_settings.*` NESTED_SETTINGS), `common/project/
 * net_settings.cpp` (NET_SETTINGS — `net_settings.*`), `common/project/
 * component_class_settings.cpp` (`component_class_settings.*`),
 * `common/project/tuning_profiles.cpp` (`tuning_profiles.*`) and
 * `common/project/project_file.cpp` (`text_variables`).
 *
 * `readBoardSetupPro` hydrates the `.kicad_pro`-owned slices of a
 * BoardSetupValues (missing keys fall back to KiCad's param defaults);
 * `writeBoardSetupProText` merges them back, preserving every key it does not
 * own — a KiCad-authored project round-trips with only the edited settings
 * changed. The `.kicad_pcb`-owned slices (stackup, enabled layers, board
 * finish, mask/paste clearances, dash ratios, embedded files) live in
 * board_file_settings.ts; custom rules live in `<project>.kicad_dru`.
 *
 * Units follow the file format (board_design_settings.cpp m_params):
 * PARAM_SCALED lengths are mm doubles; `defaults.dimensions.arrow_length` and
 * `.extension_offset` are RAW nanometre integers; teardrop and zone ratios are
 * raw ratios (the panels show percent); enums are plain ints. Every KiCad
 * write emits all params, but missing keys on read mean the param default —
 * clamping happens on read only.
 */

import type { RawFile } from '../drawingsheet/projectSheet.js';
import {
  LINE_STYLES,
  type NetClass,
  type NetClassAssignment,
} from '../schematic/schematic_settings.js';
import {
  DRC_CATEGORIES,
  defaultBoardSetup,
  type BoardConstraints,
  type BoardSetupValues,
  type ClassCondition,
  type ComponentClassAssignment,
  type ConditionType,
  type DrcSeverity,
  type FreqUnit,
  type TeardropShape,
  type TeardropsSetup,
  type TuningPattern,
  type TuningProfile,
  type TuningSetup,
} from './board_settings.js';

const PRO_RE = /\.kicad_pro$/i;

/** Path basename (project references store a bare file name). */
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The project's `.kicad_pro` (same pinning rule as the schematic side). */
export function findProjectPro(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const want = proBase ? `${proBase}.kicad_pro`.toLowerCase() : null;
  if (want) {
    const pinned = files.find(
      (f) => PRO_RE.test(f.name) && basename(f.name).toLowerCase() === want,
    );
    if (pinned) return pinned;
  }
  return files.find((f) => PRO_RE.test(f.name));
}

/** The custom-rules file KiCad pairs with a project:
 *  `<project>.kicad_dru` (FILEEXT::DesignRulesFileExtension). */
export function druFileName(proName: string): string {
  return proName.replace(/\.kicad_pro$/i, '.kicad_dru');
}

/** The project's `.kicad_dru`, resolved via its `.kicad_pro` sibling. */
export function findProjectDru(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const pro = findProjectPro(files, proBase);
  if (!pro) return undefined;
  const want = druFileName(pro.name).toLowerCase();
  return files.find((f) => f.name.toLowerCase() === want);
}

// ---------------------------------------------------------------------------
// JSON plumbing (same helpers as the schematic side).

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setPath(root: Json, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = root;
  for (const key of keys.slice(0, -1)) {
    if (!isObj(cur[key])) cur[key] = {};
    cur = cur[key] as Json;
  }
  cur[keys.at(-1)!] = value;
}

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}
function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}
function str(v: unknown, dflt: string): string {
  return typeof v === 'string' ? v : dflt;
}

// ---------------------------------------------------------------------------
// Value tables.

/** The numeric BoardConstraints fields (mm values + the spoke count). */
type NumericConstraintKey = {
  [K in keyof BoardConstraints]: BoardConstraints[K] extends number ? K : never;
}[keyof BoardConstraints];

/** `rules.*` keys that map 1:1 to BoardConstraints numbers, all stored as mm
 *  doubles (PARAM_SCALED, board_design_settings.cpp:264-332). */
const RULE_KEYS: readonly (readonly [string, NumericConstraintKey])[] = [
  ['rules.min_clearance', 'minClearanceMM'],
  ['rules.min_connection', 'minConnectionMM'],
  ['rules.min_track_width', 'minTrackMM'],
  ['rules.min_via_annular_width', 'minAnnularMM'],
  ['rules.min_via_diameter', 'minViaMM'],
  ['rules.min_through_hole_diameter', 'minThroughHoleMM'],
  ['rules.min_microvia_diameter', 'minUViaMM'],
  ['rules.min_microvia_drill', 'minUViaHoleMM'],
  ['rules.min_hole_to_hole', 'minHoleToHoleMM'],
  ['rules.min_hole_clearance', 'copperToHoleMM'],
  ['rules.min_copper_edge_clearance', 'copperToEdgeMM'],
  ['rules.min_silk_clearance', 'silkClearanceMM'],
  ['rules.min_text_height', 'minTextHeightMM'],
  ['rules.min_text_thickness', 'minTextThicknessMM'],
  ['rules.max_error', 'maxDeviationMM'],
];

/** Layer-class prefixes in TextGfxDefaults.rows order. Edge Cuts and
 *  Courtyards are graphics-only: their file keys are `board_outline_line_width`
 *  / `courtyard_line_width` and carry no text params. */
const LAYER_CLASS_PREFIX = ['silk', 'copper', null, null, 'fab', 'other'] as const;

/** Teardrop target canonical names (teardrop_parameters.cpp) in
 *  TeardropsSetup {round, rect, trackToTrack} order. */
const TEARDROP_TARGETS: readonly (readonly [string, keyof TeardropsSetup])[] = [
  ['td_round_shape', 'round'],
  ['td_rect_shape', 'rect'],
  ['td_track_end', 'trackToTrack'],
];

/** tuning_pattern_settings sub-objects in TuningSetup order. */
const TUNING_GROUPS: readonly (readonly [string, keyof TuningSetup])[] = [
  ['single_track_defaults', 'singleTrack'],
  ['diff_pair_defaults', 'diffPair'],
  ['diff_pair_skew_defaults', 'diffPairSkew'],
];

// Choice lists <-> file enum ints.
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'];
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'];
const DIM_PRECISION = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'];
const DIM_POSITION = ['Outside', 'Inline'];
// ZONE_CONNECTION: NONE=0, THERMAL=1, FULL=2, THT_THERMAL=3.
const PAD_CONNECTION_TO_INT: Record<string, number> = {
  Solid: 2,
  'Thermal reliefs': 1,
  'Reliefs for PTH': 3,
  None: 0,
};
const PAD_CONNECTION_FROM_INT = ['None', 'Thermal reliefs', 'Solid', 'Reliefs for PTH'];
// ZONE_BORDER_DISPLAY_STYLE: NO_HATCH=0, DIAGONAL_FULL=1, DIAGONAL_EDGE=2.
const BORDER_STYLE_TO_INT: Record<string, number> = {
  Line: 0,
  'Fully hatched': 1,
  Hatched: 2,
};
const BORDER_STYLE_FROM_INT = ['Line', 'Fully hatched', 'Hatched'];
const CORNER_SMOOTHING = ['None', 'Chamfer', 'Fillet'];
const REMOVE_ISLANDS = ['Always', 'Never', 'Below area limit'];
const CONDITION_TYPES: readonly ConditionType[] = ['Reference', 'Side', 'Rotation', 'Footprint'];
const FREQ_UNIT_HZ: Record<FreqUnit, number> = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 };

/** COLOR4D's unset marker (COLOR4D::UNSPECIFIED serialized). */
const KICAD_COLOR_UNSET = 'rgba(0, 0, 0, 0.000)';

function cssColorToKicad(css: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return KICAD_COLOR_UNSET;
  const n = parseInt(m[1]!, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function kicadColorToCss(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v.trim());
  if (!m) return /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '';
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
  const hex = (x: string): string => Math.min(255, Number(x)).toString(16).padStart(2, '0');
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}

/** Frequency in Hz -> the largest unit that displays cleanly. */
function hzToUnit(hz: number): { frequency: number; frequencyUnit: FreqUnit } {
  for (const unit of ['GHz', 'MHz', 'kHz'] as const) {
    if (hz >= FREQ_UNIT_HZ[unit])
      return { frequency: hz / FREQ_UNIT_HZ[unit], frequencyUnit: unit };
  }
  return { frequency: hz, frequencyUnit: 'Hz' };
}

// ---------------------------------------------------------------------------
// Read.

const DS = 'board.design_settings';

/** Hydrate the `.kicad_pro`-owned slices of a BoardSetupValues from the
 *  project text. Slices owned by the board file (stackup, layers, mask/paste,
 *  board finish, formatting dash ratios, embedded files) and the `.kicad_dru`
 *  (custom rules) keep their defaults here. */
export function readBoardSetupProText(proText: string): BoardSetupValues {
  const s = defaultBoardSetup();
  let j: unknown;
  try {
    j = JSON.parse(proText);
  } catch {
    return s;
  }
  if (!isObj(j)) return s;

  // rules.* — constraints.
  for (const [path, field] of RULE_KEYS)
    s.constraints[field] = num(getPath(j, `${DS}.${path}`), s.constraints[field] as number);
  s.constraints.minThermalSpokes = num(
    getPath(j, `${DS}.rules.min_resolved_spokes`),
    s.constraints.minThermalSpokes,
  );
  s.constraints.includeStackupHeight = bool(
    getPath(j, `${DS}.rules.use_height_for_length_calcs`),
    s.constraints.includeStackupHeight,
  );
  s.constraints.allowFilletsOutside = bool(
    getPath(j, `${DS}.zones_allow_external_fillets`),
    s.constraints.allowFilletsOutside,
  );
  // rules.solder_mask_to_copper_clearance is the one mask/paste value that
  // lives in the project file (the rest moved to the board in schema 2).
  s.maskPaste.maskToCopperMM = num(
    getPath(j, `${DS}.rules.solder_mask_to_copper_clearance`),
    s.maskPaste.maskToCopperMM,
  );

  // rule_severities — keys we surface; unknown keys stay untouched on write.
  const sev = getPath(j, `${DS}.rule_severities`);
  if (isObj(sev)) {
    for (const cat of DRC_CATEGORIES) {
      for (const item of cat.items) {
        const v = sev[item.code];
        if (v === 'error' || v === 'warning' || v === 'ignore')
          s.drcSeverities[item.code] = v as DrcSeverity;
      }
    }
  }

  // Pre-defined sizes. The stored lists' element [0] is the reserved
  // "use netclass" sentinel (m_TrackWidthList[0] etc. — its value is never a
  // real size): the panel grid owns entries from index 1 up
  // (panel_setup_tracks_and_vias.cpp `for ii = 1`). Entries missing a
  // required key are skipped, like upstream's JSON read.
  const widths = getPath(j, `${DS}.track_widths`);
  if (Array.isArray(widths))
    s.trackWidthsMM = widths.filter((w): w is number => typeof w === 'number').slice(1);
  const vias = getPath(j, `${DS}.via_dimensions`);
  if (Array.isArray(vias)) {
    s.viaSizesMM = vias
      .filter(
        (e): e is Json => isObj(e) && typeof e.diameter === 'number' && typeof e.drill === 'number',
      )
      .map((e) => ({ diameter: e.diameter as number, drill: e.drill as number }))
      .slice(1);
  }
  const pairs = getPath(j, `${DS}.diff_pair_dimensions`);
  if (Array.isArray(pairs)) {
    s.diffPairsMM = pairs
      .filter(
        (e): e is Json =>
          isObj(e) &&
          typeof e.width === 'number' &&
          typeof e.gap === 'number' &&
          typeof e.via_gap === 'number',
      )
      .map((e) => ({
        width: e.width as number,
        gap: e.gap as number,
        viaGap: e.via_gap as number,
      }))
      .slice(1);
  }

  // teardrop_parameters — matched by td_target_name, like upstream.
  const tds = getPath(j, `${DS}.teardrop_parameters`);
  if (Array.isArray(tds)) {
    for (const e of tds) {
      if (!isObj(e)) continue;
      const target = TEARDROP_TARGETS.find(([name]) => e.td_target_name === name);
      if (!target) continue;
      const t = s.teardrops[target[1]];
      t.maxLengthMM = num(e.td_maxlen, t.maxLengthMM);
      t.maxWidthMM = num(e.td_maxheight, t.maxWidthMM);
      t.bestLengthPct = num(e.td_length_ratio, t.bestLengthPct / 100) * 100;
      t.bestWidthPct = num(e.td_height_ratio, t.bestWidthPct / 100) * 100;
      t.trackWidthLimitPct = num(e.td_width_to_size_filter_ratio, t.trackWidthLimitPct / 100) * 100;
      t.curvedEdges = num(e.td_curve_segcount, t.curvedEdges ? 1 : 0) > 0;
      t.allowSpanTwoSegments = bool(e.td_allow_use_two_tracks, t.allowSpanTwoSegments);
      // The panel checkbox is the inverse of the stored flag
      // (panel_setup_teardrops.cpp: SetValue(!m_TdOnPadsInZones)).
      t.preferZoneConnection = !bool(e.td_on_pad_in_zone, !t.preferZoneConnection);
    }
  }

  // tuning_pattern_settings (PNS::MEANDER_SETTINGS).
  for (const [key, field] of TUNING_GROUPS) {
    const g = getPath(j, `${DS}.tuning_pattern_settings.${key}`);
    if (!isObj(g)) continue;
    const t = s.tuning[field];
    t.minAmplitudeMM = num(g.min_amplitude, t.minAmplitudeMM);
    t.maxAmplitudeMM = num(g.max_amplitude, t.maxAmplitudeMM);
    t.spacingMM = num(g.spacing, t.spacingMM);
    // MEANDER_STYLE corner_style: 0 = CHAMFER, 1 = ROUND (fillet).
    t.cornerStyle =
      num(g.corner_style, t.cornerStyle === 'Fillet' ? 1 : 0) === 1 ? 'Fillet' : 'Chamfer';
    t.radiusPct = num(g.corner_radius_percentage, t.radiusPct);
    t.singleSided = bool(g.single_sided, t.singleSided);
  }

  // defaults.* — text & graphics layer classes.
  s.textGraphics.rows.forEach((row, i) => {
    const prefix = LAYER_CLASS_PREFIX[i];
    if (prefix === null) {
      const key = i === 2 ? 'board_outline_line_width' : 'courtyard_line_width';
      row.lineThickness = num(getPath(j, `${DS}.defaults.${key}`), row.lineThickness);
      return;
    }
    row.lineThickness = num(getPath(j, `${DS}.defaults.${prefix}_line_width`), row.lineThickness);
    row.textWidth = num(getPath(j, `${DS}.defaults.${prefix}_text_size_h`), row.textWidth);
    row.textHeight = num(getPath(j, `${DS}.defaults.${prefix}_text_size_v`), row.textHeight);
    row.textThickness = num(
      getPath(j, `${DS}.defaults.${prefix}_text_thickness`),
      row.textThickness,
    );
    row.italic = bool(getPath(j, `${DS}.defaults.${prefix}_text_italic`), row.italic);
    row.keepUpright = bool(getPath(j, `${DS}.defaults.${prefix}_text_upright`), row.keepUpright);
  });

  // defaults.dimension* — dimensions.
  const dim = s.textGraphics.dimensions;
  dim.units = DIM_UNITS[num(getPath(j, `${DS}.defaults.dimension_units`), 3)] ?? 'Automatic';
  dim.precision =
    DIM_PRECISION[num(getPath(j, `${DS}.defaults.dimension_precision`), 4)] ?? '0.0000';
  dim.format = DIM_FORMATS[num(getPath(j, `${DS}.defaults.dimensions.units_format`), 0)] ?? '1234';
  dim.suppressTrailingZeroes = bool(
    getPath(j, `${DS}.defaults.dimensions.suppress_zeroes`),
    dim.suppressTrailingZeroes,
  );
  dim.textPosition =
    DIM_POSITION[num(getPath(j, `${DS}.defaults.dimensions.text_position`), 0)] ?? 'Outside';
  dim.keepTextAligned = bool(
    getPath(j, `${DS}.defaults.dimensions.keep_text_aligned`),
    dim.keepTextAligned,
  );
  // Raw internal-unit (nanometre) integers, unlike every other length here.
  dim.arrowLengthMM =
    num(getPath(j, `${DS}.defaults.dimensions.arrow_length`), dim.arrowLengthMM * 1e6) / 1e6;
  dim.extLineOffsetMM =
    num(getPath(j, `${DS}.defaults.dimensions.extension_offset`), dim.extLineOffsetMM * 1e6) / 1e6;

  // defaults.apply_defaults_to_fp_* — formatting flags (dash ratios are board-file data).
  s.formatting.applyFields = bool(
    getPath(j, `${DS}.defaults.apply_defaults_to_fp_fields`),
    s.formatting.applyFields,
  );
  s.formatting.applyText = bool(
    getPath(j, `${DS}.defaults.apply_defaults_to_fp_text`),
    s.formatting.applyText,
  );
  s.formatting.applyShapes = bool(
    getPath(j, `${DS}.defaults.apply_defaults_to_fp_shapes`),
    s.formatting.applyShapes,
  );
  s.formatting.applyDimensions = bool(
    getPath(j, `${DS}.defaults.apply_defaults_to_fp_dimensions`),
    s.formatting.applyDimensions,
  );
  s.formatting.applyBarcodes = bool(
    getPath(j, `${DS}.defaults.apply_defaults_to_fp_barcodes`),
    s.formatting.applyBarcodes,
  );

  // defaults.zones.* — new-zone defaults.
  const z = s.zones;
  z.clearanceMM = num(getPath(j, `${DS}.defaults.zones.min_clearance`), z.clearanceMM);
  z.minWidthMM = num(getPath(j, `${DS}.defaults.zones.min_thickness`), z.minWidthMM);
  z.thermalGapMM = num(getPath(j, `${DS}.defaults.zones.thermal_relief_gap`), z.thermalGapMM);
  z.thermalSpokeMM = num(
    getPath(j, `${DS}.defaults.zones.thermal_relief_spoke_width`),
    z.thermalSpokeMM,
  );
  z.padConnection =
    PAD_CONNECTION_FROM_INT[num(getPath(j, `${DS}.defaults.zones.pad_connection`), 1)] ??
    'Thermal reliefs';
  z.outlineDisplay =
    BORDER_STYLE_FROM_INT[num(getPath(j, `${DS}.defaults.zones.border_display_style`), 2)] ??
    'Hatched';
  z.outlineHatchPitchMM = num(
    getPath(j, `${DS}.defaults.zones.border_hatch_pitch`),
    z.outlineHatchPitchMM,
  );
  z.cornerSmoothing =
    CORNER_SMOOTHING[num(getPath(j, `${DS}.defaults.zones.corner_smoothing`), 0)] ?? 'None';
  z.smoothingRadiusMM = num(getPath(j, `${DS}.defaults.zones.corner_radius`), z.smoothingRadiusMM);
  z.removeIslands =
    REMOVE_ISLANDS[num(getPath(j, `${DS}.defaults.zones.remove_islands`), 0)] ?? 'Always';
  z.areaLimitMM2 = num(getPath(j, `${DS}.defaults.zones.min_island_area`), z.areaLimitMM2);

  // net_settings.* — netclasses (same file slice the schematic dialog edits).
  const classes = getPath(j, 'net_settings.classes');
  if (Array.isArray(classes)) {
    const numStr = (v: unknown): string =>
      typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    const read = classes
      .filter((e): e is Json => isObj(e) && typeof e.name === 'string')
      .map((e) => ({
        priority: num(e.priority, Number.MAX_SAFE_INTEGER),
        nc: {
          name: e.name as string,
          clearance: numStr(e.clearance),
          trackWidth: numStr(e.track_width),
          viaSize: numStr(e.via_diameter),
          viaHole: numStr(e.via_drill),
          uviaSize: numStr(e.microvia_diameter),
          uviaHole: numStr(e.microvia_drill),
          dpWidth: numStr(e.diff_pair_width),
          dpGap: numStr(e.diff_pair_gap),
          tuningProfile: str(e.tuning_profile, ''),
          pcbColor: kicadColorToCss(e.pcb_color),
          wireThickness: numStr(e.wire_width),
          busThickness: numStr(e.bus_width),
          color: kicadColorToCss(e.schematic_color),
          lineStyle: LINE_STYLES[num(e.line_style, 0)] ?? 'Solid',
        } satisfies NetClass,
      }));
    const dflt = read.find((r) => r.nc.name === 'Default');
    const rest = read.filter((r) => r !== dflt).sort((a, b) => a.priority - b.priority);
    if (dflt || rest.length)
      s.netClasses.classes = [dflt?.nc ?? s.netClasses.classes[0]!, ...rest.map((r) => r.nc)];
  }
  const patterns = getPath(j, 'net_settings.netclass_patterns');
  if (Array.isArray(patterns)) {
    s.netClasses.assignments = patterns
      .filter((e): e is Json => isObj(e))
      .map((e) => ({ pattern: str(e.pattern, ''), netClass: str(e.netclass, '') }))
      .filter((a): a is NetClassAssignment => Boolean(a.pattern || a.netClass));
  }

  // component_class_settings.* — assignments.
  s.componentClasses.assignPerSheet = bool(
    getPath(j, 'component_class_settings.sheet_component_classes.enabled'),
    s.componentClasses.assignPerSheet,
  );
  const ccAssignments = getPath(j, 'component_class_settings.assignments');
  if (Array.isArray(ccAssignments)) {
    const out: ComponentClassAssignment[] = [];
    for (const e of ccAssignments) {
      if (!isObj(e) || typeof e.component_class !== 'string') continue;
      const conditions: ClassCondition[] = [];
      if (isObj(e.conditions)) {
        for (const [key, val] of Object.entries(e.conditions)) {
          // Keys are UPPERCASE condition names, "-N"-suffixed on duplicates.
          const base = key.replace(/-\d+$/, '');
          const type = CONDITION_TYPES.find((t) => t.toUpperCase() === base);
          if (!type || !isObj(val)) continue;
          conditions.push({ type, value: str(val.primary, '') });
        }
      }
      out.push({
        componentClass: e.component_class,
        matchMode: str(e.conditions_operator, 'ALL') === 'ANY' ? 'any' : 'all',
        conditions,
      });
    }
    s.componentClasses.assignments = out;
  }

  // tuning_profiles.* — impedance/geometry profiles (frequency stored in Hz).
  const profiles = getPath(j, 'tuning_profiles.tuning_profiles_impedance_geometric');
  if (Array.isArray(profiles)) {
    const out: TuningProfile[] = [];
    for (const e of profiles) {
      if (!isObj(e) || typeof e.profile_name !== 'string') continue;
      out.push({
        name: e.profile_name,
        type: num(e.type, 0) === 1 ? 'Differential' : 'Single',
        targetImpedance: num(e.target_impedance, 50),
        ...hzToUnit(num(e.frequency, 1e9)),
        enableTimeDomain: bool(e.enable_time_domain_tuning, false),
        modelSolderMask: bool(e.model_solder_mask, true),
        globalUnitDelay: num(e.via_prop_delay, 0),
      });
    }
    s.tuningProfiles.profiles = out;
  }

  // text_variables (project-file top level).
  const vars = getPath(j, 'text_variables');
  if (isObj(vars)) {
    s.textVars = Object.entries(vars)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([name, value]) => ({ name, value }));
  }

  return s;
}

/** Read the board setup's `.kicad_pro` slices from the project's raw files. */
export function readBoardSetupPro(files: readonly RawFile[], proBase?: string): BoardSetupValues {
  const pro = findProjectPro(files, proBase);
  return pro ? readBoardSetupProText(pro.text) : defaultBoardSetup();
}

// ---------------------------------------------------------------------------
// Write.

/** Optional netclass keys the grid owns (blank cell -> key removed), same
 *  contract as the schematic side. */
const OPTIONAL_CLASS_KEYS: readonly (readonly [string, keyof NetClass])[] = [
  ['clearance', 'clearance'],
  ['track_width', 'trackWidth'],
  ['via_diameter', 'viaSize'],
  ['via_drill', 'viaHole'],
  ['microvia_diameter', 'uviaSize'],
  ['microvia_drill', 'uviaHole'],
  ['diff_pair_width', 'dpWidth'],
  ['diff_pair_gap', 'dpGap'],
  ['wire_width', 'wireThickness'],
  ['bus_width', 'busThickness'],
];

/** INT_MAX — NET_SETTINGS gives the Default class the lowest priority. */
const DEFAULT_CLASS_PRIORITY = 2147483647;

function teardropJson(name: string, t: TeardropShape): Json {
  return {
    td_target_name: name,
    td_maxlen: t.maxLengthMM,
    td_maxheight: t.maxWidthMM,
    td_length_ratio: t.bestLengthPct / 100,
    td_height_ratio: t.bestWidthPct / 100,
    // Written as 0/1 (curved edges on/off), read as >0, like upstream.
    td_curve_segcount: t.curvedEdges ? 1 : 0,
    td_width_to_size_filter_ratio: t.trackWidthLimitPct / 100,
    td_allow_use_two_tracks: t.allowSpanTwoSegments,
    td_on_pad_in_zone: !t.preferZoneConnection,
  };
}

function tuningJson(t: TuningPattern): Json {
  return {
    min_amplitude: t.minAmplitudeMM,
    max_amplitude: t.maxAmplitudeMM,
    spacing: t.spacingMM,
    corner_style: t.cornerStyle === 'Fillet' ? 1 : 0,
    corner_radius_percentage: t.radiusPct,
    single_sided: t.singleSided,
  };
}

/** Return `proText` with the `.kicad_pro`-owned Board Setup slices merged in
 *  (all unrelated keys preserved), or null when the JSON cannot be parsed. */
export function writeBoardSetupProText(proText: string, s: BoardSetupValues): string | null {
  let j: unknown;
  try {
    j = JSON.parse(proText);
  } catch {
    return null;
  }
  if (!isObj(j)) return null;

  // NESTED_SETTINGS refuses to load without its schema version
  // (nested_settings.cpp:79); bdsSchemaVersion = 2.
  setPath(j, `${DS}.meta.version`, 2);

  // rules.* — constraints (mm doubles; spokes is a raw int).
  for (const [path, field] of RULE_KEYS) setPath(j, `${DS}.${path}`, s.constraints[field]);
  setPath(j, `${DS}.rules.min_resolved_spokes`, s.constraints.minThermalSpokes);
  setPath(j, `${DS}.rules.use_height_for_length_calcs`, s.constraints.includeStackupHeight);
  setPath(j, `${DS}.zones_allow_external_fillets`, s.constraints.allowFilletsOutside);
  setPath(j, `${DS}.rules.solder_mask_to_copper_clearance`, s.maskPaste.maskToCopperMM);

  // rule_severities: overwrite our keys, keep unknown rules untouched.
  const oldSev = getPath(j, `${DS}.rule_severities`);
  const sevOut: Json = isObj(oldSev) ? { ...oldSev } : {};
  for (const cat of DRC_CATEGORIES)
    for (const item of cat.items)
      sevOut[item.code] = s.drcSeverities[item.code] ?? item.def ?? 'error';
  setPath(j, `${DS}.rule_severities`, sevOut);

  // Pre-defined sizes (mm doubles; all sub-keys required by the reader).
  // Element [0] of each list is the reserved "use netclass" sentinel, written
  // back like the panel's TransferDataFromWindow re-adds it.
  setPath(j, `${DS}.track_widths`, [0, ...s.trackWidthsMM]);
  setPath(j, `${DS}.via_dimensions`, [
    { diameter: 0, drill: 0 },
    ...s.viaSizesMM.map((v) => ({ diameter: v.diameter, drill: v.drill })),
  ]);
  setPath(j, `${DS}.diff_pair_dimensions`, [
    { gap: 0, via_gap: 0, width: 0 },
    ...s.diffPairsMM.map((p) => ({ gap: p.gap, via_gap: p.viaGap, width: p.width })),
  ]);

  // teardrop_parameters (teardrop_options carries the enable flags, which the
  // Board Setup panel does not own — preserved untouched).
  setPath(
    j,
    `${DS}.teardrop_parameters`,
    TEARDROP_TARGETS.map(([name, field]) => teardropJson(name, s.teardrops[field])),
  );

  // tuning_pattern_settings.
  for (const [key, field] of TUNING_GROUPS)
    setPath(j, `${DS}.tuning_pattern_settings.${key}`, tuningJson(s.tuning[field]));

  // defaults.* — text & graphics.
  s.textGraphics.rows.forEach((row, i) => {
    const prefix = LAYER_CLASS_PREFIX[i];
    if (prefix === null) {
      const key = i === 2 ? 'board_outline_line_width' : 'courtyard_line_width';
      setPath(j, `${DS}.defaults.${key}`, row.lineThickness);
      return;
    }
    setPath(j, `${DS}.defaults.${prefix}_line_width`, row.lineThickness);
    setPath(j, `${DS}.defaults.${prefix}_text_size_h`, row.textWidth);
    setPath(j, `${DS}.defaults.${prefix}_text_size_v`, row.textHeight);
    setPath(j, `${DS}.defaults.${prefix}_text_thickness`, row.textThickness);
    setPath(j, `${DS}.defaults.${prefix}_text_italic`, row.italic);
    setPath(j, `${DS}.defaults.${prefix}_text_upright`, row.keepUpright);
  });

  const dim = s.textGraphics.dimensions;
  setPath(j, `${DS}.defaults.dimension_units`, Math.max(0, DIM_UNITS.indexOf(dim.units)));
  setPath(
    j,
    `${DS}.defaults.dimension_precision`,
    Math.max(0, DIM_PRECISION.indexOf(dim.precision)),
  );
  setPath(
    j,
    `${DS}.defaults.dimensions.units_format`,
    Math.max(0, DIM_FORMATS.indexOf(dim.format)),
  );
  setPath(j, `${DS}.defaults.dimensions.suppress_zeroes`, dim.suppressTrailingZeroes);
  setPath(
    j,
    `${DS}.defaults.dimensions.text_position`,
    Math.max(0, DIM_POSITION.indexOf(dim.textPosition)),
  );
  setPath(j, `${DS}.defaults.dimensions.keep_text_aligned`, dim.keepTextAligned);
  // Raw internal-unit integers (nanometres), unlike the mm doubles elsewhere.
  setPath(j, `${DS}.defaults.dimensions.arrow_length`, Math.round(dim.arrowLengthMM * 1e6));
  setPath(j, `${DS}.defaults.dimensions.extension_offset`, Math.round(dim.extLineOffsetMM * 1e6));

  setPath(j, `${DS}.defaults.apply_defaults_to_fp_fields`, s.formatting.applyFields);
  setPath(j, `${DS}.defaults.apply_defaults_to_fp_text`, s.formatting.applyText);
  setPath(j, `${DS}.defaults.apply_defaults_to_fp_shapes`, s.formatting.applyShapes);
  setPath(j, `${DS}.defaults.apply_defaults_to_fp_dimensions`, s.formatting.applyDimensions);
  setPath(j, `${DS}.defaults.apply_defaults_to_fp_barcodes`, s.formatting.applyBarcodes);

  // defaults.zones.*.
  const z = s.zones;
  setPath(j, `${DS}.defaults.zones.min_clearance`, z.clearanceMM);
  setPath(j, `${DS}.defaults.zones.min_thickness`, z.minWidthMM);
  setPath(j, `${DS}.defaults.zones.thermal_relief_gap`, z.thermalGapMM);
  setPath(j, `${DS}.defaults.zones.thermal_relief_spoke_width`, z.thermalSpokeMM);
  setPath(j, `${DS}.defaults.zones.pad_connection`, PAD_CONNECTION_TO_INT[z.padConnection] ?? 1);
  setPath(
    j,
    `${DS}.defaults.zones.border_display_style`,
    BORDER_STYLE_TO_INT[z.outlineDisplay] ?? 2,
  );
  setPath(j, `${DS}.defaults.zones.border_hatch_pitch`, z.outlineHatchPitchMM);
  setPath(
    j,
    `${DS}.defaults.zones.corner_smoothing`,
    Math.max(0, CORNER_SMOOTHING.indexOf(z.cornerSmoothing)),
  );
  setPath(j, `${DS}.defaults.zones.corner_radius`, z.smoothingRadiusMM);
  setPath(
    j,
    `${DS}.defaults.zones.remove_islands`,
    Math.max(0, REMOVE_ISLANDS.indexOf(z.removeIslands)),
  );
  setPath(j, `${DS}.defaults.zones.min_island_area`, z.areaLimitMM2);

  // net_settings: Default first at INT_MAX priority, rest in panel order; a
  // class that existed before keeps its unowned keys (diff_pair_via_gap, ...).
  const oldClasses = getPath(j, 'net_settings.classes');
  const oldByName = new Map<string, Json>();
  if (Array.isArray(oldClasses)) {
    for (const e of oldClasses) {
      if (isObj(e) && typeof e.name === 'string') oldByName.set(e.name, e);
    }
  }
  const writeClass = (c: NetClass, priority: number): Json => {
    const out: Json = { ...(oldByName.get(c.name) ?? {}) };
    out.name = c.name;
    out.priority = priority;
    out.schematic_color = cssColorToKicad(c.color);
    out.pcb_color = cssColorToKicad(c.pcbColor);
    out.tuning_profile = c.tuningProfile;
    out.line_style = Math.max(0, LINE_STYLES.indexOf(c.lineStyle));
    for (const [key, field] of OPTIONAL_CLASS_KEYS) {
      const v = parseFloat(c[field]);
      if (c[field].trim() === '' || !Number.isFinite(v)) delete out[key];
      else out[key] = v;
    }
    return out;
  };
  setPath(
    j,
    'net_settings.classes',
    s.netClasses.classes.map((c, i) => writeClass(c, i === 0 ? DEFAULT_CLASS_PRIORITY : i - 1)),
  );
  setPath(
    j,
    'net_settings.netclass_patterns',
    s.netClasses.assignments.map((a) => ({ netclass: a.netClass, pattern: a.pattern })),
  );

  // component_class_settings (schemaVersion 0).
  setPath(j, 'component_class_settings.meta.version', 0);
  setPath(
    j,
    'component_class_settings.sheet_component_classes.enabled',
    s.componentClasses.assignPerSheet,
  );
  setPath(
    j,
    'component_class_settings.assignments',
    s.componentClasses.assignments.map((a) => {
      const conditions: Json = {};
      for (const c of a.conditions) {
        // Duplicate condition types get "-N" suffixes, like upstream.
        const name = c.type.toUpperCase();
        let unique = name;
        let suffix = 1;
        while (unique in conditions) unique = `${name}-${suffix++}`;
        const cond: Json = {};
        if (c.value) cond.primary = c.value;
        conditions[unique] = cond;
      }
      return {
        component_class: a.componentClass,
        conditions_operator: a.matchMode === 'any' ? 'ANY' : 'ALL',
        conditions,
      };
    }),
  );

  // tuning_profiles (schemaVersion 1; frequency stored in Hz). A profile whose
  // name existed before keeps its unowned keys (layer_entries, via_overrides).
  setPath(j, 'tuning_profiles.meta.version', 1);
  const oldProfiles = getPath(j, 'tuning_profiles.tuning_profiles_impedance_geometric');
  const oldProfileByName = new Map<string, Json>();
  if (Array.isArray(oldProfiles)) {
    for (const e of oldProfiles)
      if (isObj(e) && typeof e.profile_name === 'string') oldProfileByName.set(e.profile_name, e);
  }
  setPath(
    j,
    'tuning_profiles.tuning_profiles_impedance_geometric',
    s.tuningProfiles.profiles.map((p) => ({
      layer_entries: [],
      via_overrides: [],
      ...(oldProfileByName.get(p.name) ?? {}),
      profile_name: p.name,
      type: p.type === 'Differential' ? 1 : 0,
      target_impedance: p.targetImpedance,
      frequency: p.frequency * FREQ_UNIT_HZ[p.frequencyUnit],
      model_solder_mask: p.modelSolderMask,
      enable_time_domain_tuning: p.enableTimeDomain,
      via_prop_delay: p.globalUnitDelay,
    })),
  );

  // text_variables: fully owned by the panel — rebuild.
  const varsOut: Json = {};
  for (const v of s.textVars) if (v.name) varsOut[v.name] = v.value;
  setPath(j, 'text_variables', varsOut);

  return `${JSON.stringify(j, null, 2)}\n`;
}
