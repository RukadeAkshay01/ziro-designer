# Schematic Setup — implementation status

Exact state of the Schematic Setup dialog (KiCad `DIALOG_SCHEMATIC_SETUP`
counterpart) as of PR #134. "End to end" means: edited in the dialog →
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

- **Annotation** (PR #118) — the Annotate dialog seeds sort/method/start
  number from the project settings on open and writes changes back on every
  close (`DIALOG_ANNOTATE`), via the shared `commitSetup` flow.
- **Field Name Templates** (PR #119) — Symbol Properties appends template
  fieldnames not yet on the symbol (empty rows with the template's Visible
  flag; named-but-empty rows survive OK); Bulk Edit Symbol Fields offers
  template columns.
- **BOM Presets** (PR #120) — full `BOM_PRESET`/`BOM_FMT_PRESET` bodies; the
  Generate BOM dialog has view + format preset pickers (KiCad's exact
  built-ins plus saved ones), editable delimiters, and Save Preset. Exporter
  ports: `bomToDelimited` (delimiter wrapping/doubling, tab/newline
  stripping) and `refsShorthand` (`R1-R4` range collapsing). Built-ins never
  persist, like upstream.
- **Net Classes** (PR #121) — `resolveEffectiveNetClass`
  (`GetEffectiveNetClass` port: prefix + `*`/`?` pattern matching, grid-order
  priority merge, Default completion, composite `Effective for net: <net>`
  naming); wires/buses without their own stroke draw with the resolved
  color/width/style; junction dots clamp to ≥170% of the net's wire width;
  the message panel shows the real Resolved Netclass. Known deviation: the
  grid can't express an unset line style, so only non-Solid styles
  contribute to merges.
- **Text Variables** (PR #122) — `expandTextVars` +
  `schematicTextVarResolver` (`eeschema/src/tools/text_vars.ts`): recursive
  `${VAR}` expansion with the TITLE_BLOCK / SCHEMATIC / PROJECT token set,
  applied at the renderer's GetShownText choke points (labels, free text,
  text boxes, tables, fields) on screen, print and plot.
- **Bus Alias Definitions** (PR #123) — persist at `schematic.bus_aliases`
  in `.kicad_pro`, where current KiCad stores them (the schematic writer no
  longer emits `bus_alias` nodes; the parser only accepts legacy ones).
- **Bus connectivity** (PRs #124–#126) — `NET_SETTINGS` bus-label parsing +
  member expansion (`eeschema/src/connectivity/bus.ts`), bus subgraphs with
  member-net joins in the netlist (separate union-find; entries split
  bus-side/wire-side; aliases unfold), and the three bus ERC rules
  (`net_not_bus_member`, `bus_to_net_conflict`, `bus_to_bus_conflict`).
- **Annotation leftovers** (PR #127) — `SubReference` unit-notation display
  (`U1A`/`U1.1`/…) through fields/panels, `reuse_designators` honored via the
  `REFDES_TRACKER` port (serialize/deserialize in
  `schematic.used_designators`), and the dialog's Reset-to-Defaults +
  Import-Settings buttons (exact `DIALOG_SCH_IMPORT_SETTINGS` checkbox set).
- **Net Chains** (PR #134) — detection is live:
  `CONNECTION_GRAPH::RebuildNetChains` port
  (`eeschema/src/connectivity/net_chains.ts`) — nets bridged through 2-pin
  passives with collinear wires, power-edge drops, leaf/stub pruning,
  label-driven naming. The Setup page lists detected chains with their
  persisted chain-class assignments (`net_settings.net_chain_classes`).
- **Wire hop-overs** (PR #134) — Formatting's Hop-over size choice draws hop
  arcs where wires cross: `SCH_LINE::ShouldHopOver` +
  `BuildWireWithHopShape` ports (`eeschema/src/tools/hop_over.ts`, with
  `SEG::Intersect`'s integer parametric test and `CalcArcCenter` in
  `libs/kimath/src/trigo.ts`); arc radius = default line width ×
  `hopover_size_mult_list[choice]`; screen, print and plot.
- **Embedded Files, read side** (PR #123) — the page lists the document's
  real `embedded_files` section (names, types, `kicad-embed://` references)
  and the `embedded_fonts` flag via `listEmbeddedFiles`
  (`eeschema/src/tools/embedded.ts`), refreshed on every dialog open; the
  zstd blobs round-trip byte-exact through the lossless AST.

### 🟡 Persisted correctly, not consumed yet

- **Formatting leftovers blocked on missing features**: inter-sheet refs
  (needs multi-sheet reference tracking), operating-point overlay fields
  (needs simulator).

### 🔴 Not implemented (deliberate)

- **Embedded Files, write side** — add/remove/export need a browser zstd
  codec (KiCad compresses blobs with zstd + base64); the page is read-only
  until then, and in-session panel edits reset on reopen.

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

## Remaining work (phases A–H1 in PRs #113–#123; buses #124–#126; quick-wins
## #127; net chains + hop-overs #134)

1. Embedded-file **write side** — browser zstd codec, add/remove/export
   (awaiting a decision on adding a zstd WASM dependency).
2. Inter-sheet references — needs multi-sheet reference tracking in the
   renderer (multi-sheet printing infrastructure now exists).
3. Committed net chains — `.kicad_sch` `signal` nodes + `PASSTHROUGH_MODE`
   attribute (detection already live).
4. OPO fields — blocked on a simulator.
