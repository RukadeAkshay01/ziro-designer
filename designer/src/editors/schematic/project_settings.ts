/**
 * Project-file persistence for the Schematic Setup dialog. Counterparts:
 * `eeschema/schematic_settings.cpp` (SCHEMATIC_SETTINGS — the `schematic.*`
 * namespace of `.kicad_pro`), `eeschema/erc/erc_settings.cpp` (ERC_SETTINGS —
 * `erc.*`), `common/project/net_settings.cpp` (NET_SETTINGS — `net_settings.*`)
 * and `common/project/project_file.cpp` (`text_variables`).
 *
 * `readSchematicSetup` hydrates a SchematicSetup from the project's raw
 * `.kicad_pro` (missing keys fall back to KiCad's defaults);
 * `writeSchematicSetupText` merges a SchematicSetup back into the `.kicad_pro`
 * JSON, preserving every key it does not own — so a KiCad-authored project
 * round-trips with only the edited settings changed. `page_layout_descr_file`
 * in particular belongs to projectSheet.ts and is never touched here.
 *
 * Bus aliases persist at `schematic.bus_aliases` (an alias -> members object;
 * current KiCad stores them here — the schematic writer no longer emits
 * `bus_alias` nodes, only the parser still accepts legacy ones). Embedded
 * files stay `.kicad_sch` data (the `embedded_files` section, zstd-compressed
 * blobs preserved losslessly through the AST) — listed read-only for now.
 *
 * Units follow the file format: PARAM_SCALED sizes are stored in mils
 * (scale `1 / schIUScale.IU_PER_MILS`), net-class PCB fields in mm and
 * wire/bus widths in mils — the panel grids type file units directly.
 */

import type { ErcCode, ErcSeverityLevel, PinError } from '@ziroeda/eeschema';
import { PIN_TYPES } from '@ziroeda/eeschema';
import type { RawFile } from '../drawingsheet/projectSheet.js';
import {
  LINE_STYLES,
  defaultSchematicSetup,
  type BomFmtPreset,
  type BomPreset,
  type FieldTemplate,
  type NetClass,
  type NetClassAssignment,
  type SchematicSetup,
  type TextVar,
} from './schematic_settings.js';

const PRO_RE = /\.kicad_pro$/i;

/** Path basename (project references store a bare file name). */
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The project's `.kicad_pro`: prefer `proBase + '.kicad_pro'` when a folder
 *  holds several projects (same pinning rule as SchematicEditor's loadProject),
 *  else the first one found. */
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

// ---------------------------------------------------------------------------
// JSON plumbing.

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Dotted-path lookup (`'schematic.drawing.default_text_size'`). */
function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Dotted-path set, creating intermediate objects but never clobbering
 *  sibling keys (the merge behind "preserve everything we don't own"). */
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

/** ErcCode -> `erc.rule_severities` key (ERC_ITEM settings keys, erc_item.cpp).
 *  `pin_to_pin_error` is absent: upstream both pin-to-pin items share the
 *  `pin_to_pin` key and only the warning row is serialized (the error row sits
 *  in the internal group past `heading_internal`), so it stays in-memory. */
const SEVERITY_KEYS: readonly (readonly [ErcCode, string])[] = [
  ['pin_not_connected', 'pin_not_connected'],
  ['pin_not_driven', 'pin_not_driven'],
  ['power_pin_not_driven', 'power_pin_not_driven'],
  ['pin_to_pin_warning', 'pin_to_pin'],
  ['no_connect_connected', 'no_connect_connected'],
  ['no_connect_dangling', 'no_connect_dangling'],
  ['label_not_connected', 'label_dangling'],
  ['label_single_pin', 'isolated_pin_label'],
  ['endpoint_off_grid', 'endpoint_off_grid'],
];

/** Symbol-unit-notation index -> (subpart_id_separator, subpart_first_id).
 *  Order matches SYMBOL_UNIT_NOTATIONS: A, .A, -A, _A, .1, -1, _1. */
const UNIT_NOTATIONS: readonly (readonly [number, number])[] = [
  [0, 65],
  [46, 65],
  [45, 65],
  [95, 65],
  [46, 49],
  [45, 49],
  [95, 49],
];

/** KiCad's "auto" operating-point range sentinels ('~V' / '~A'); the panel
 *  shows them as 'Auto'. */
function opoRangeToFile(ui: string, auto: string): string {
  return ui === 'Auto' ? auto : ui;
}
function opoRangeFromFile(file: unknown, auto: string): string {
  const v = str(file, auto);
  return v === auto ? 'Auto' : v;
}

/** COLOR4D's unset marker — what GetSchematicColor/GetPcbColor( true ) emit
 *  for COLOR4D::UNSPECIFIED. */
const KICAD_COLOR_UNSET = 'rgba(0, 0, 0, 0.000)';

/** Panel color ('' or '#rrggbb') -> KiCad COLOR4D string. */
function cssColorToKicad(css: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return KICAD_COLOR_UNSET;
  const n = parseInt(m[1]!, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** KiCad COLOR4D string -> panel color ('' = unset / transparent). */
function kicadColorToCss(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v.trim());
  if (!m) return /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '';
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
  const hex = (x: string): string => Math.min(255, Number(x)).toString(16).padStart(2, '0');
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}

// ---------------------------------------------------------------------------
// Read.

/** Read the SchematicSetup from a project's `.kicad_pro` text. Missing or
 *  malformed keys fall back to KiCad's defaults (defaultSchematicSetup). */
export function readSchematicSetupText(proText: string): SchematicSetup {
  const s = defaultSchematicSetup();
  let j: unknown;
  try {
    j = JSON.parse(proText);
  } catch {
    return s;
  }
  if (!isObj(j)) return s;

  // schematic.drawing.* + schematic.* — SCHEMATIC_SETTINGS.
  const f = s.formatting;
  f.defaultLineWidthMils = num(
    getPath(j, 'schematic.drawing.default_line_thickness'),
    f.defaultLineWidthMils,
  );
  f.defaultTextSizeMils = num(
    getPath(j, 'schematic.drawing.default_text_size'),
    f.defaultTextSizeMils,
  );
  // The file stores raw ratios (0.15); the panel shows percent (15).
  f.labelOffsetRatio =
    num(getPath(j, 'schematic.drawing.text_offset_ratio'), f.labelOffsetRatio / 100) * 100;
  f.labelSizeRatio =
    num(getPath(j, 'schematic.drawing.label_size_ratio'), f.labelSizeRatio / 100) * 100;
  f.overbarOffsetRatio = num(
    getPath(j, 'schematic.drawing.overbar_offset_ratio'),
    f.overbarOffsetRatio,
  );
  f.pinSymbolSizeMils = num(getPath(j, 'schematic.drawing.pin_symbol_size'), f.pinSymbolSizeMils);
  f.junctionDotChoice = num(
    getPath(j, 'schematic.drawing.junction_size_choice'),
    f.junctionDotChoice,
  );
  f.hopOverChoice = num(getPath(j, 'schematic.drawing.hop_over_size_choice'), f.hopOverChoice);
  f.connectionGridMils = num(getPath(j, 'schematic.connection_grid_size'), f.connectionGridMils);
  f.intersheetRefsShow = bool(
    getPath(j, 'schematic.drawing.intersheets_ref_show'),
    f.intersheetRefsShow,
  );
  f.intersheetRefsOwnPage = bool(
    getPath(j, 'schematic.drawing.intersheets_ref_own_page'),
    f.intersheetRefsOwnPage,
  );
  f.intersheetRefsAbbreviated = bool(
    getPath(j, 'schematic.drawing.intersheets_ref_short'),
    f.intersheetRefsAbbreviated,
  );
  f.intersheetRefsPrefix = str(
    getPath(j, 'schematic.drawing.intersheets_ref_prefix'),
    f.intersheetRefsPrefix,
  );
  f.intersheetRefsSuffix = str(
    getPath(j, 'schematic.drawing.intersheets_ref_suffix'),
    f.intersheetRefsSuffix,
  );
  f.dashLengthRatio = num(
    getPath(j, 'schematic.drawing.dashed_lines_dash_length_ratio'),
    f.dashLengthRatio,
  );
  f.gapLengthRatio = num(
    getPath(j, 'schematic.drawing.dashed_lines_gap_length_ratio'),
    f.gapLengthRatio,
  );
  f.opoVPrecision = num(
    getPath(j, 'schematic.drawing.operating_point_overlay_v_precision'),
    f.opoVPrecision,
  );
  f.opoVRange = opoRangeFromFile(
    getPath(j, 'schematic.drawing.operating_point_overlay_v_range'),
    '~V',
  );
  f.opoIPrecision = num(
    getPath(j, 'schematic.drawing.operating_point_overlay_i_precision'),
    f.opoIPrecision,
  );
  f.opoIRange = opoRangeFromFile(
    getPath(j, 'schematic.drawing.operating_point_overlay_i_range'),
    '~A',
  );

  // Annotation (subpart notation + annotation.* + annotate_start_num).
  const sep = num(getPath(j, 'schematic.subpart_id_separator'), 0);
  const first = num(getPath(j, 'schematic.subpart_first_id'), 65);
  const notation = UNIT_NOTATIONS.findIndex(([a, b]) => a === sep && b === first);
  s.annotation.symbolUnitNotation = notation === -1 ? 0 : notation;
  s.annotation.sortOrder = num(getPath(j, 'schematic.annotation.sort_order'), 0) === 1 ? 'y' : 'x';
  const method = num(getPath(j, 'schematic.annotation.method'), 0);
  s.annotation.numbering = method === 1 ? 'sheetX100' : method === 2 ? 'sheetX1000' : 'firstFree';
  s.annotation.firstFreeAfter = num(
    getPath(j, 'schematic.annotate_start_num'),
    s.annotation.firstFreeAfter,
  );
  s.annotation.allowReuse = bool(
    getPath(j, 'schematic.reuse_designators'),
    s.annotation.allowReuse,
  );

  // Field name templates (schematic.drawing.field_names).
  const fieldNames = getPath(j, 'schematic.drawing.field_names');
  if (Array.isArray(fieldNames)) {
    const templates: FieldTemplate[] = [];
    for (const e of fieldNames) {
      // Upstream skips entries missing any of the three keys.
      if (
        isObj(e) &&
        typeof e.name === 'string' &&
        typeof e.visible === 'boolean' &&
        typeof e.url === 'boolean'
      )
        templates.push({ name: e.name, visible: e.visible, url: e.url });
    }
    s.fieldTemplates = templates;
  }

  // schematic.bom_presets / bom_fmt_presets (bom_settings.cpp from_json):
  // entries missing a required key are skipped, like upstream's per-item
  // parse; include_excluded_from_bom defaults false (absent before 8.0).
  const bomArr = getPath(j, 'schematic.bom_presets');
  if (Array.isArray(bomArr)) {
    const presets: BomPreset[] = [];
    for (const e of bomArr) {
      if (!isObj(e) || typeof e.name !== 'string' || !Array.isArray(e.fields_ordered)) continue;
      presets.push({
        name: e.name,
        fieldsOrdered: e.fields_ordered
          .filter((f): f is Json => isObj(f))
          .map((f) => ({
            name: str(f.name, ''),
            label: str(f.label, ''),
            show: bool(f.show, false),
            groupBy: bool(f.group_by, false),
          })),
        sortField: str(e.sort_field, 'Reference'),
        sortAsc: bool(e.sort_asc, true),
        filterString: str(e.filter_string, ''),
        groupSymbols: bool(e.group_symbols, false),
        excludeDnp: bool(e.exclude_dnp, false),
        includeExcludedFromBom: bool(e.include_excluded_from_bom, false),
      });
    }
    s.bomPresets.presets = presets;
  }
  const fmtArr = getPath(j, 'schematic.bom_fmt_presets');
  if (Array.isArray(fmtArr)) {
    const fmt: BomFmtPreset[] = [];
    for (const e of fmtArr) {
      if (!isObj(e) || typeof e.name !== 'string') continue;
      fmt.push({
        name: e.name,
        fieldDelimiter: str(e.field_delimiter, ','),
        stringDelimiter: str(e.string_delimiter, '"'),
        refDelimiter: str(e.ref_delimiter, ','),
        refRangeDelimiter: str(e.ref_range_delimiter, ''),
        keepTabs: bool(e.keep_tabs, false),
        keepLineBreaks: bool(e.keep_line_breaks, false),
      });
    }
    s.bomPresets.fmtPresets = fmt;
  }

  // erc.* — ERC_SETTINGS.
  const sev = getPath(j, 'erc.rule_severities');
  if (isObj(sev)) {
    for (const [code, key] of SEVERITY_KEYS) {
      const v = sev[key];
      if (v === 'error' || v === 'warning' || v === 'ignore')
        s.erc.severities[code] = v as ErcSeverityLevel;
    }
  }
  const pinMap = getPath(j, 'erc.pin_map');
  if (
    Array.isArray(pinMap) &&
    pinMap.length === PIN_TYPES.length &&
    pinMap.every((row) => Array.isArray(row) && row.length === PIN_TYPES.length)
  ) {
    s.erc.pinMap = (pinMap as unknown[][]).map((row) =>
      row.map((v) => (v === 1 || v === 2 ? v : 0) as PinError),
    );
  }
  const excl = getPath(j, 'erc.erc_exclusions');
  if (Array.isArray(excl)) {
    s.ercExclusions = excl
      .map((e) => (Array.isArray(e) ? str(e[0], '') : str(e, '')))
      .filter(Boolean);
  }

  // net_settings.* — NET_SETTINGS.
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
    // Default pinned first (the panel keeps it at row 0), rest by priority.
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

  // net_settings.net_chain_classes: the only persisted net-chain state is the
  // chain -> class map; the chains themselves are engine data. Rebuild the
  // class list (name + member count) so the panel shows what the file holds.
  const chainClasses = getPath(j, 'net_settings.net_chain_classes');
  if (isObj(chainClasses)) {
    const counts = new Map<string, number>();
    for (const v of Object.values(chainClasses)) {
      if (typeof v === 'string' && v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    s.netChains.classes = [...counts].map(([name, members]) => ({ name, members }));
  }

  // text_variables (project-file top level).
  const vars = getPath(j, 'text_variables');
  if (isObj(vars)) {
    s.textVars = Object.entries(vars)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([name, value]): TextVar => ({ name, value }));
  }

  // schematic.bus_aliases (project_file.cpp): alias -> member list.
  const aliases = getPath(j, 'schematic.bus_aliases');
  if (isObj(aliases)) {
    s.busAliases = Object.entries(aliases)
      .filter((e): e is [string, unknown[]] => Array.isArray(e[1]))
      .map(([name, members]) => ({
        name,
        members: members.filter((m): m is string => typeof m === 'string'),
      }));
  }

  return s;
}

/** Read the SchematicSetup from the project's raw files (missing/corrupt
 *  `.kicad_pro` -> defaults). */
export function readSchematicSetup(files: readonly RawFile[], proBase?: string): SchematicSetup {
  const pro = findProjectPro(files, proBase);
  return pro ? readSchematicSetupText(pro.text) : defaultSchematicSetup();
}

// ---------------------------------------------------------------------------
// Write.

/** Net-class keys owned by the panel grid: cleared when the cell is blank,
 *  rewritten otherwise. Anything else on a class object (e.g.
 *  `diff_pair_via_gap`, which our grid does not surface) is preserved. */
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

/** Return `proText` with the SchematicSetup merged in (all unrelated keys
 *  preserved), or null when the JSON cannot be parsed. */
export function writeSchematicSetupText(proText: string, s: SchematicSetup): string | null {
  let j: unknown;
  try {
    j = JSON.parse(proText);
  } catch {
    return null;
  }
  if (!isObj(j)) return null;

  // schematic.drawing.* + schematic.* — SCHEMATIC_SETTINGS.
  const f = s.formatting;
  setPath(j, 'schematic.drawing.default_line_thickness', f.defaultLineWidthMils);
  setPath(j, 'schematic.drawing.default_text_size', f.defaultTextSizeMils);
  setPath(j, 'schematic.drawing.text_offset_ratio', f.labelOffsetRatio / 100);
  setPath(j, 'schematic.drawing.label_size_ratio', f.labelSizeRatio / 100);
  setPath(j, 'schematic.drawing.overbar_offset_ratio', f.overbarOffsetRatio);
  setPath(j, 'schematic.drawing.pin_symbol_size', f.pinSymbolSizeMils);
  setPath(j, 'schematic.drawing.junction_size_choice', f.junctionDotChoice);
  setPath(j, 'schematic.drawing.hop_over_size_choice', f.hopOverChoice);
  setPath(j, 'schematic.connection_grid_size', f.connectionGridMils);
  setPath(j, 'schematic.drawing.intersheets_ref_show', f.intersheetRefsShow);
  setPath(j, 'schematic.drawing.intersheets_ref_own_page', f.intersheetRefsOwnPage);
  setPath(j, 'schematic.drawing.intersheets_ref_short', f.intersheetRefsAbbreviated);
  setPath(j, 'schematic.drawing.intersheets_ref_prefix', f.intersheetRefsPrefix);
  setPath(j, 'schematic.drawing.intersheets_ref_suffix', f.intersheetRefsSuffix);
  setPath(j, 'schematic.drawing.dashed_lines_dash_length_ratio', f.dashLengthRatio);
  setPath(j, 'schematic.drawing.dashed_lines_gap_length_ratio', f.gapLengthRatio);
  setPath(j, 'schematic.drawing.operating_point_overlay_v_precision', f.opoVPrecision);
  setPath(
    j,
    'schematic.drawing.operating_point_overlay_v_range',
    opoRangeToFile(f.opoVRange, '~V'),
  );
  setPath(j, 'schematic.drawing.operating_point_overlay_i_precision', f.opoIPrecision);
  setPath(
    j,
    'schematic.drawing.operating_point_overlay_i_range',
    opoRangeToFile(f.opoIRange, '~A'),
  );

  // Annotation.
  const [sep, first] = UNIT_NOTATIONS[s.annotation.symbolUnitNotation] ?? UNIT_NOTATIONS[0]!;
  setPath(j, 'schematic.subpart_id_separator', sep);
  setPath(j, 'schematic.subpart_first_id', first);
  setPath(j, 'schematic.annotation.sort_order', s.annotation.sortOrder === 'y' ? 1 : 0);
  setPath(
    j,
    'schematic.annotation.method',
    s.annotation.numbering === 'sheetX100' ? 1 : s.annotation.numbering === 'sheetX1000' ? 2 : 0,
  );
  setPath(j, 'schematic.annotate_start_num', s.annotation.firstFreeAfter);
  setPath(j, 'schematic.reuse_designators', s.annotation.allowReuse);

  // Field name templates.
  setPath(
    j,
    'schematic.drawing.field_names',
    s.fieldTemplates.map((t) => ({ name: t.name, visible: t.visible, url: t.url })),
  );

  // schematic.bom_presets / bom_fmt_presets (bom_settings.cpp to_json).
  // Read-only built-ins are never persisted, like upstream; a preset whose
  // name existed before keeps any unowned keys via the old-object merge.
  const oldPresetByName = (path: string): Map<string, Json> => {
    const arr = getPath(j, path);
    const map = new Map<string, Json>();
    if (Array.isArray(arr)) {
      for (const e of arr) if (isObj(e) && typeof e.name === 'string') map.set(e.name, e);
    }
    return map;
  };
  const oldBom = oldPresetByName('schematic.bom_presets');
  setPath(
    j,
    'schematic.bom_presets',
    s.bomPresets.presets
      .filter((p) => !p.readOnly)
      .map((p) => {
        const out: Json = { ...(oldBom.get(p.name) ?? {}) };
        out.name = p.name;
        out.sort_field = p.sortField;
        out.sort_asc = p.sortAsc;
        out.filter_string = p.filterString;
        out.group_symbols = p.groupSymbols;
        out.exclude_dnp = p.excludeDnp;
        out.include_excluded_from_bom = p.includeExcludedFromBom;
        // Upstream only writes fields_ordered when non-empty.
        if (p.fieldsOrdered.length > 0)
          out.fields_ordered = p.fieldsOrdered.map((f) => ({
            name: f.name,
            label: f.label,
            show: f.show,
            group_by: f.groupBy,
          }));
        else delete out.fields_ordered;
        return out;
      }),
  );
  const oldFmt = oldPresetByName('schematic.bom_fmt_presets');
  setPath(
    j,
    'schematic.bom_fmt_presets',
    s.bomPresets.fmtPresets
      .filter((p) => !p.readOnly)
      .map((p) => ({
        ...(oldFmt.get(p.name) ?? {}),
        name: p.name,
        field_delimiter: p.fieldDelimiter,
        string_delimiter: p.stringDelimiter,
        ref_delimiter: p.refDelimiter,
        ref_range_delimiter: p.refRangeDelimiter,
        keep_tabs: p.keepTabs,
        keep_line_breaks: p.keepLineBreaks,
      })),
  );

  // erc.rule_severities: overwrite our keys, keep unknown rules untouched.
  const oldSev = getPath(j, 'erc.rule_severities');
  const sevOut: Json = isObj(oldSev) ? { ...oldSev } : {};
  for (const [code, key] of SEVERITY_KEYS) sevOut[key] = s.erc.severities[code];
  setPath(j, 'erc.rule_severities', sevOut);

  // erc.pin_map (12x12) and erc.erc_exclusions ([signature, comment] pairs;
  // comments of surviving exclusions are preserved).
  setPath(
    j,
    'erc.pin_map',
    s.erc.pinMap.map((row) => [...row]),
  );
  const oldExcl = getPath(j, 'erc.erc_exclusions');
  const comments = new Map<string, string>();
  if (Array.isArray(oldExcl)) {
    for (const e of oldExcl) {
      if (Array.isArray(e) && typeof e[0] === 'string') comments.set(e[0], str(e[1], ''));
    }
  }
  setPath(
    j,
    'erc.erc_exclusions',
    s.ercExclusions.map((sig) => [sig, comments.get(sig) ?? '']),
  );

  // net_settings.classes: Default first at INT_MAX priority, the rest in panel
  // order. A class that existed before keeps its unowned keys.
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

  // net_settings.net_chain_classes: merge — chains aren't persisted here (they
  // are engine data), so keep existing chain -> class entries except those
  // whose class the panel deleted, then apply the in-memory chain assignments.
  const oldChains = getPath(j, 'net_settings.net_chain_classes');
  const chainOut: Json = {};
  const liveClasses = new Set(s.netChains.classes.map((c) => c.name));
  if (isObj(oldChains)) {
    for (const [chain, cls] of Object.entries(oldChains)) {
      if (typeof cls === 'string' && cls && liveClasses.has(cls)) chainOut[chain] = cls;
    }
  }
  for (const chain of s.netChains.chains) {
    if (chain.chainClass) chainOut[chain.name] = chain.chainClass;
    else delete chainOut[chain.name];
  }
  setPath(j, 'net_settings.net_chain_classes', chainOut);

  // text_variables: fully owned by the panel — rebuild (a deleted row must
  // leave the file).
  const varsOut: Json = {};
  for (const v of s.textVars) if (v.name) varsOut[v.name] = v.value;
  setPath(j, 'text_variables', varsOut);

  // schematic.bus_aliases: fully owned by the panel — rebuild.
  const aliasesOut: Json = {};
  for (const a of s.busAliases) if (a.name) aliasesOut[a.name] = [...a.members];
  setPath(j, 'schematic.bus_aliases', aliasesOut);

  return `${JSON.stringify(j, null, 2)}\n`;
}
