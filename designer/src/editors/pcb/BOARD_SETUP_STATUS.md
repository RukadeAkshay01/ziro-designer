# Board Setup — working / persisted-only / pending map

Companion to `SCHEMATIC_SETUP_STATUS.md` on the schematic side. Ground truth
for all file formats is the KiCad source clone (see the serializer headers for
exact `.cpp` counterparts).

## Files & modules

| Concern | Module |
| --- | --- |
| Data model (all 20 pages) | `board_settings.ts` — plain TS, panels re-export their slices |
| `.kicad_pro` read/write | `project_settings.ts` (`readBoardSetupPro` / `writeBoardSetupProText`) |
| `.kicad_pcb` read/write | `board_file_settings.ts` (`applyBoardFileSetup` / `writeBoardFileSetup`) |
| `.kicad_dru` | raw text via `findProjectDru` / `druFileName` |
| Editor wiring | `PcbEditor.tsx` — hydrate effect + `commitBoardSetup` |
| Tests | `qa/unittests/designer/board_project_settings.test.ts`, `board_file_settings.test.ts` |

## What round-trips (Phase A — DONE)

**`.kicad_pro`** (merge-write, unowned keys preserved; all values mm doubles
unless noted): `board.design_settings.rules.*` (+ `meta.version: 2`),
`rule_severities` (exact v10 `GetSettingsKey()` strings; unknown keys kept),
`track_widths` / `via_dimensions` / `diff_pair_dimensions`,
`teardrop_parameters` (ratios stored raw, panel shows %; `td_on_pad_in_zone`
is the INVERSE of the Prefer-zone checkbox; `teardrop_options` enable flags
are not panel-owned — preserved), `tuning_pattern_settings` (corner_style
0=Chamfer 1=Fillet), `defaults.*` text&graphics (+ `dimension_*`;
`dimensions.arrow_length` / `extension_offset` are RAW nanometre ints),
`defaults.apply_defaults_to_fp_*`, `defaults.zones.*`,
`zones_allow_external_fillets` (root level, not under defaults),
`net_settings.classes` / `netclass_patterns` (same contract as the schematic
writer: Default first at INT_MAX, blank cells delete optional keys),
`component_class_settings` (UPPERCASE condition keys, `-N` dedup suffixes),
`tuning_profiles.tuning_profiles_impedance_geometric` (frequency in Hz;
`layer_entries`/`via_overrides` preserved by profile name), `text_variables`.

**`.kicad_pcb`** (AST patch, all other nodes byte-preserved):
`(general (thickness …))` = stackup sum; `(layers …)` rebuilt (copper stack
from stackup page's copper count, tech layers in LSET UI order with literal
`user` qualifier, user-name 4th token only when renamed); `(setup …)` —
`(stackup …)` (dielectric rows named `"dielectric N"`, bare `locked` token,
`copper_finish`/`dielectric_constraints`/`edge_connector`/`edge_plating yes`),
`pad_to_mask_clearance` (always), `solder_mask_min_width` /
`pad_to_paste_clearance` / `_ratio` (omitted when 0),
`allow_soldermask_bridges_in_footprints`, `(tenting (front …)(back …))`;
`dashed_line_dash_ratio` / `_gap_ratio` patched INSIDE `(pcbplotparams …)`
(rest of that block is Plot-dialog data, preserved verbatim);
`(embedded_fonts …)`; `(embedded_files …)` filtered to surviving names.

**`.kicad_dru`**: Custom Rules text ↔ `<project>.kicad_dru` (created on OK).

**Editor flow**: hydrate on project load (pro → board text → dru); on OK the
pro/dru persist via `onPersistFiles`, the board text is patched via the
*current* `serializeBoard` output, reloaded (`readBoard`) and saved via
`onSaveBoard` — so live edits and the new setup both survive.

## Not persisted (in-memory only)

- Zone defaults `name` / `locked` (not in KiCad's param set either).
- Stackup dielectric sublayers (`addsublayer`) — flattened on save.
- Zone fill_mode / hatch settings beyond the panel's fields (preserved keys).
- `drc_exclusions`, `defaults.pads`, layer presets, viewports, ipc2581 —
  never touched (preserved).

## Applied to the editor (Phase B, first slice — DONE)

- Pre-defined sizes feed the TOP_AUX track/via selectors (KiCad's
  `m_TrackWidthList`/`m_ViasDimensionsList`; the file lists carry the
  reserved `[0]` "use netclass" sentinel — reader slices it off, writer
  prepends it, the panel grid shows index 1 up like
  `panel_setup_tracks_and_vias.cpp`).
- Net classes: `netclassInfo` derives from `boardSetup.netClasses` (blank
  cells inherit Default, then the NETCLASS factory constants) — feeds routing
  dims, pattern matching, class colors, the Nets tab. The old standalone
  `.kicad_pro` parse is gone.
- New text/graphics use the Text & Graphics Defaults row of the target
  layer's class (`GetLayerClass`); new zones take border style + hatch pitch
  from the Zones page; enabled layers/stackup apply via the board-file
  reload on OK.
- Editor plumbing: project-side file edits ride a base-tracked overlay so a
  board save (which changes the `projectFiles` prop identity without
  refreshing its content) can no longer clobber freshly committed settings.

## Pending

- **Phase B remainder** — constraints + severities → DRC (no PCB DRC engine
  in this codebase yet), formatting dash ratios → board dashed-line
  rendering, teardrops/length-tuning → no engine features yet.
- **Phase C (done)** — "Import Settings from Another Board…"
  (`dialog_import_settings.tsx`, DIALOG_IMPORT_SETTINGS translation: 14
  groups, gated Import button, Select All toggle; merge semantics from
  `onAuxiliaryAction` incl. linked layers+stackup+finish and the
  copper-count shrink warning) and "Add User Defined Layer…" (User.1–45
  picker) now work.
- **Phase C stackup (done)** — dielectric sublayers round-trip
  (`addsublayer` groups in `board_file_settings.ts`; `DielectricSublayer` on
  the model) and all four stackup actions work: Add/Remove Dielectric
  (sublayer position pickers, Remove auto-disables), Adjust Dielectric
  Thickness (`setDefaultLayerWidths` — fixed 0.1 mm prepregs, cores share
  the remainder, alternating types, locked layers kept), Export to
  Clipboard (`buildStackupReport`), and the material "…" browser
  (DIALOG_DIELECTRIC_MATERIAL with the `dielectric_material.cpp` substrate
  tables).
- **Phase C remainder** — Component Classes "Highlight matching footprints"
  (needs editor canvas integration) and the shared schematic-panel buttons
  (netclass color import, embedded-files Embed — schematic-side files).
- Known UI/parity skews: stackup panel's generated FR4 stack uses all-Prepreg
  inner dielectrics (KiCad alternates core/prepreg and derives thickness from
  board thickness); dialog does not yet sync the Layers page rows when the
  stackup copper count changes (write path uses copper count as truth).
