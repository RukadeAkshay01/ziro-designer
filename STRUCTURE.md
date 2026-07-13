# Repository structure

Ziro Designer is organised as a pnpm monorepo: one app package (`designer/`)
on top of framework-agnostic engine packages. The engine tree follows the
source-layout conventions of the upstream KiCad codebase — the one place in
the project where we deliberately keep that vocabulary — so ported logic has
an obvious home next to its C++ origin and stays easy to audit for
format-compatibility.

| Directory        | Upstream counterpart | Contents                                                                 |
| ---------------- | -------------------- | ------------------------------------------------------------------------ |
| `designer/`      | *(ours)*             | The Ziro Designer app (Vite + React): launcher/home, menus/toolbars, editor frames, auth + cloud sync, served libraries under `designer/public/` |
| `eeschema/`      | `eeschema/`          | Schematic engine: document model, `sch_io/sexpr` reader/writer, `connectivity/` (nets, ERC), `tools/` (interactive editing) |
| `pcbnew/`        | `pcbnew/`            | Board engine: board/footprint/pad/zone object model, `pcb_io/sexpr` parser + formatter, board and footprint editing |
| `common/`        | `common/`            | Shared EDA classes: shapes, text, units, placement transforms, stroke `font/` |
| `libs/kimath/`   | `libs/kimath/`       | Math: `math/vector2`, `geometry/eda_angle`, `trigo`                       |
| `libs/core/`     | `libs/core/`         | Small shared utilities (`mirror`, flip directions)                        |
| `libs/sexpr/`    | `libs/sexpr/`        | Lossless S-expression tokenizer/parser/serializer                         |
| `qa/`            | `qa/`                | Unit tests (`qa/unittests/<module>/`) and test fixtures (`qa/data/`)      |
| `tools/`         | *(ours)*             | Offline build pipelines (not workspace packages): `models3d/` converts the upstream STEP 3D library to the hosted `.glb` set |

Each directory is a workspace package (`@ziroeda/<dir>`); `qa/` holds the
Vitest suites for all of them, arranged by the module under test.

## Conventions

- **Modules are named after their upstream counterpart files** (snake_case,
  as upstream): `home/project_tree.ts` ↔ `kicad/project_tree.cpp`,
  `home/project_archiver.ts` ↔ `common/project/project_archiver.cpp`,
  `home/dialogs/dialog_template_selector.tsx` ↔
  `kicad/dialogs/dialog_template_selector.cpp`. New modules should name their
  counterpart in the header comment.
- **Product names, not tool names, for our own code.** The app lives in
  `designer/` and file/folder names avoid third-party product names; data
  fixtures keep their native file extensions (`.kicad_sch`, `.kicad_pcb`, …)
  because that is the on-disk format itself.
- **Editor UI frames currently live in `designer/src/editors/`** (schematic,
  pcb, symbol, footprint). Migrating each frame into its engine package is
  planned once the shared-widget layer is extracted.
- **The 3D viewer** (`designer/src/editors/pcb/pcb3d.ts`, `model3d.ts`,
  `component3d.ts`) stays in the app for now because it shares geometry/theme
  modules with the 2D board painter; it becomes its own package when split.
- **`designer/public/templates/`** holds project templates;
  symbol/footprint/3D-model libraries under `designer/public/` are served as
  static assets.
- **Future tools get their own engine dirs** following the same upstream
  conventions (gerber viewer → `gerbview/`, drawing-sheet editor →
  `pagelayout_editor/`, …), with their UI frames in the app.
