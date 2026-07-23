# Schematic Setup — implementation status

Exact state of the Schematic Setup dialog (KiCad `DIALOG_SCHEMATIC_SETUP`
counterpart) as of PRs #113–#117. "End to end" means: edited in the dialog →
persisted to `.kicad_pro` exactly like KiCad → actually changes app behavior.
This file is the hand-off point for continuing the work; update it per phase.

Ground truth for every mapping below is the KiCad source
(`eeschema/schematic_settings.cpp`, `eeschema/erc/erc_settings.cpp`,
`common/project/net_settings.cpp`, `common/project/project_file.cpp`).

## Architecture

| Piece | File |
|---|---|
| Settings data model (types + defaults, KiCad's `SCHEMATIC_SETTINGS` split) | `designer/src/editors/schematic/schematic_settings.ts` |
| `.kicad_pro` serializer (merge-style: unknown keys preserved) | `designer/src/editors/schematic/project_settings.ts` |
| Dialog shell (PAGED_DIALOG counterpart) | `designer/src/ui/PagedDialog.tsx` |
| Dialog + page tree | `designer/src/editors/schematic/dialogs/dialog_schematic_setup.tsx` |
| Panels (UI only; re-export their data slices from schematic_settings.ts) | `designer/src/editors/schematic/dialogs/panels/panel_*.tsx` |
| Hydrate on project load / persist on OK | `SchematicEditor.tsx` (project-load effect + dialog `onOk`; same flow as the drawing-sheet ref in `projectSheet.ts`) |
| Render-time consumers | `render/renderer.ts` (`RenderOpts` + module globals), threaded to print/plot via `PlotOpts` (`render/plot.ts`); editor builds them once in the `drawingDefaults` memo |
| ERC consumers | `eeschema/src/connectivity/erc.ts` (`runErc(sch, libById, settings, { connectionGridIU })`) |
| Tests | `qa/unittests/designer/project_settings.test.ts`, `qa/unittests/designer/schematic_settings.test.ts`, `qa/unittests/eeschema/erc_settings.test.ts` |

## Page-by-page status

### ✅ Working end to end

- **Violation Severity** — every rule's error/warning/ignore drives `runErc`;
  persisted under `erc.rule_severities`. File keys differ from our codes:
  `label_not_connected`→`label_dangling`, `label_single_pin`→`isolated_pin_label`,
  `pin_to_pin_warning`→`pin_to_pin`; `pin_to_pin_error` is intentionally
  file-less (upstream shares the `pin_to_pin` key and only serializes the
  warning row).
- **Pin Conflicts Map** — 12×12 matrix drives pin-to-pin ERC; persisted as
  `erc.pin_map` (wrong-sized matrices rejected on read, like upstream).
- **ERC exclusions** — persisted as `[signature, comment]` pairs under
  `erc.erc_exclusions`; comments of surviving signatures preserved.
- **Formatting** — all consumable fields live, on screen *and* print/plot:
  - *Default line width* → pen for zero-width strokes (`defaultPenIU`).
  - *Default text size* → new label/text dialogs seed from it
    (`DIALOG_LABEL_PROPERTIES` behavior).
  - *Junction dot size* → `GetJunctionSize()` port: Default-netclass wire
    width × `{0, 1.7, 4, 6, 9, 12}[choice]`, ≤1 IU ("None") draws no dot;
    explicit per-junction diameters win.
  - *Dash/Gap ratios* → `GetDashLength/GetGapLength/GetDotLength` with the
    ISO 128-2 correction 1.0: dash `(r−1)w`, gap `(r+1)w`, dot `0.2w`.
  - *Label offset* → label lift (`GetSchematicTextOffset`) + pin name/number
    offset (`round(24 × ratio)` mils).
  - *Label size ratio* → global-label flag margin (`GetLabelBoxExpansion`).
  - *Overbar offset* → `~{...}` overbar height; the renderer seeds the shared
    stroke font per render (`setOverbarHeightRatio` in
    `common/src/font/stroke_font.ts`).
  - *Pin symbol size* → negation bubble / polarity slopes / clock notch, with
    KiCad's 0-fallback (number-size/2 external, name-size/2 else number/2 clock).
  - *Connection grid* → the `endpoint_off_grid` ERC rule (see below). This is
    the setting's ONLY real KiCad consumer — editor snapping uses the user
    grid preferences, not `m_ConnectionGridSize`.
- **`endpoint_off_grid` ERC rule** (`ERC_TESTER::TestOffGridEndpoints` port) —
  wire/bus endpoints (marker at start, else end; one per line), bus-entry
  points, first off-grid pin per symbol (NC-type pins exempt). Default
  severity: warning.

### 🟡 Persisted correctly, not consumed yet

Edits survive reload and round-trip with real KiCad `.kicad_pro` files, but
change nothing in the editor yet:

- **Annotation** — persists (`subpart_id_separator`/`subpart_first_id`,
  `annotation.sort_order`/`.method`, `annotate_start_num`,
  `reuse_designators`). NEXT PHASE: `DialogAnnotate` should seed from
  `setup.annotation` and write back, the way `SCH_EDIT_FRAME` uses
  `SCHEMATIC_SETTINGS`; the annotate engine is
  `eeschema/src/tools/annotate.ts` (own `AnnotateOptions`, not yet linked).
- **Field Name Templates** — persists (`schematic.drawing.field_names`).
  Consumer to build: new symbols / symbol-properties dialogs auto-add
  template fields (KiCad `TEMPLATES`).
- **BOM Presets** — names list/delete persists (`schematic.bom_presets` /
  `bom_fmt_presets`; write filters existing preset bodies by surviving name,
  never regenerates them). Consumer to build: BOM export dialog
  (`dialog_export_bom.tsx` + `eeschema/src/exporters/bom.ts` has its own
  `BomOptions`).
- **Net Classes** — classes + pattern assignments persist
  (`net_settings.classes` / `netclass_patterns`; wire/bus widths in mils, PCB
  fields in mm, Default priority INT_MAX, colors as KiCad `rgb()/rgba()`
  strings, unknown per-class keys like `diff_pair_via_gap` preserved).
  Consumer to build: engine netclass resolution (pattern match → per-net
  class), message panel "Resolved Netclass" (hardcoded 'Default' in
  `eeschema/src/tools/msg_panel.ts`), wire color/width/style from class, and
  the junction 170%-of-connected-wire clamp from `sch_junction.cpp`.
- **Net Chains** — only the chain→class map persists
  (`net_settings.net_chain_classes`, merge-style); chains themselves are
  engine data that does not exist yet.
- **Text Variables** — persists (top-level `text_variables`). Consumer to
  build: `ExpandTextVars` resolver in the engine (none exists), applied to
  text/fields/drawing-sheet rendering.
- **Formatting leftovers blocked on missing features**: inter-sheet refs
  (needs multi-sheet reference tracking), hop-over choice (needs wire
  hop-over rendering), operating-point overlay fields (needs simulator).

### 🔴 UI only, in-memory (deliberate)

- **Bus Alias Definitions**, **Embedded Files** — KiCad stores these in
  `.kicad_sch` (per-sheet `bus_alias` nodes / `embedded_files` section;
  current KiCad master also mirrors bus aliases at `schematic.bus_aliases`).
  Blocked on the `.kicad_sch` reader/writer side
  (`eeschema/src/sch_io/sexpr/`). Edits work in-session, reset on reload.
- **Dialog chrome**: "Reset to Defaults" and "Import Settings from Another
  Project…" buttons are stubs.

## Gotchas encoded in the serializer (don't rediscover these)

- Ratio fields are stored raw in the file but shown ×100 in the panel
  (`text_offset_ratio` 0.15 ↔ 15) — except overbar, which is raw everywhere.
- `PARAM_SCALED` sizes are stored in **mils** (scale `1/IU_PER_MILS`); 1 mil
  = 254 IU.
- The writer merges: it must never touch keys it doesn't own
  (`page_layout_descr_file` belongs to `projectSheet.ts`;
  `netclass_assignments`, `net_colors`, BOM preset bodies, board section,
  unknown ERC rules all pass through).
- KiCad defaults that differ from naive guesses: intersheet prefix/suffix are
  `[` / `]`, `reuse_designators` defaults **true**.

## Remaining phases (agreed order)

1. **C — Annotation**: Annotate dialog ⇄ `setup.annotation`.
2. **D — Field name templates** → symbol fields.
3. **E — BOM presets** → export dialog.
4. **F — Net classes**: engine resolution, msg panel, wire visuals, junction clamp.
5. **G — Text variables**: `ExpandTextVars` in the engine.
6. **H — Bus aliases / net chains / embedded files**: `.kicad_sch` storage +
   engine features (bus expansion, chains).
7. Dialog Reset / Import buttons.
