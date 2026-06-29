# ZiroEDA

A browser-native, open-source electronics design suite — a faithful, web-native
reimplementation of the [KiCad](https://www.kicad.org/) workflow that runs in the
browser and reads/writes KiCad's native file formats.

> ZiroEDA is an independent project. It is **not** affiliated with or endorsed by
> the KiCad project, and "KiCad" is a trademark of its respective owners.

## Goals

- **Familiar.** Look and behave like KiCad so existing users feel at home —
  same conventions, same hotkeys, same visual style.
- **Interoperable.** Use KiCad's native formats (`.kicad_sch`, `.kicad_sym`, …)
  as the source of truth, so existing projects open directly with no import step.
- **Web-native.** TypeScript + Canvas/WebGL in the browser. Heavy batch compute
  (simulation, 3D kernel ops, autorouting) is offloaded to a server when needed.
- **Expandable.** A shared core underpins each tool (schematic editor first, then
  the others), so capabilities compound rather than being rebuilt per tool.

## Why a reimplementation (not a port)

KiCad is C++ built on wxWidgets, a custom OpenGL/Cairo rendering layer, and
OpenCASCADE — none of which port cleanly to the browser. ZiroEDA is a
ground-up reimplementation in web-native technology that stays format-compatible
with KiCad rather than attempting to compile its source to WebAssembly.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

## Tech stack

| Concern                | Choice                                             |
| ---------------------- | -------------------------------------------------- |
| Core language          | TypeScript (Rust/WASM reserved for measured hot paths) |
| UI                     | React + Tailwind CSS                               |
| Docking panels         | Dockview                                           |
| 2D rendering           | Canvas2D → WebGL (PixiJS/regl) behind an interface |
| Geometry / boolean ops | custom geometry + clipper2-wasm                    |
| Spatial index          | RBush (R-tree)                                      |
| State / undo / actions | Zustand + a custom command bus                     |
| File access            | File System Access API + OPFS                      |
| Build / monorepo       | Vite + pnpm workspaces                             |
| Tests                  | Vitest (unit) + Playwright (e2e / visual diff)     |

## Repository layout

```
ziroeda/
  packages/
    core/        # framework-agnostic foundations: sexpr, model, geometry
  apps/
    schematic/   # React + Canvas2D schematic viewer/editor
```

### `@ziroeda/schematic`

A React + Canvas2D app that renders a real `.kicad_sch` faithfully: symbols (via
their library graphics + the placement transform), pins, wires, junctions, labels
and fields, on a pannable/zoomable canvas with a KiCad-style theme.

It is wrapped in eeschema's window chrome — menu bar, top toolbar, a left
display-options toolbar, a right drawing-tools toolbar, hierarchy and properties
panels, and a live status bar (cursor position, grid, units, zoom) — with toolbar
contents transcribed from KiCad's `toolbars_sch_editor.cpp`. Run it with:

```bash
pnpm -C apps/schematic dev      # http://localhost:5173
pnpm -C apps/schematic build    # typecheck + production build
```

### `@ziroeda/core`

Two layers, both grounded in KiCad's own implementation:

- **Lossless S-expression layer** — the parser/serializer for KiCad-format files.
  "Lossless" is a hard requirement: it preserves every node (including fields
  ZiroEDA does not yet model) and the exact source text of numeric atoms, so
  saving a file never silently corrupts data the user cares about. Correctness is
  enforced by a round-trip test against a real KiCad schematic
  (`parse ∘ serialize ∘ parse` is identity over the AST).

- **Typed schematic model** — a typed view over that AST (symbols, pins, wires,
  labels, junctions, library symbols), mirroring KiCad's `SCH_*` / `LIB_SYMBOL`
  classes and the fields its `kicad_sexpr` parser reads. Coordinates are integer
  internal units (100 nm), exactly as KiCad stores them — not float millimetres —
  so geometry and equality stay exact. Every modelled item keeps its source AST
  node, so unmodified items still round-trip byte-for-byte.

```bash
pnpm install
pnpm -C packages/core test       # run the parser/round-trip tests
pnpm -C packages/core typecheck
```

## Roadmap (schematic capture first)

1. **Lossless file I/O** — S-expression parser/serializer. ✅
2. **Typed document model** — symbols, pins, wires, labels, junctions. ✅
3. **Read-only viewer** — render a real `.kicad_sch` faithfully on a canvas. ✅
4. **Selection + move** — introduces the command bus and undo/redo. ← _next_
5. **Place + wire** — symbol placement from a library; wiring with junctions.
6. **Save** — byte-faithful write-back, verified against KiCad's own output.

Connectivity (the net-building "connection graph"), ERC, netlist export, and the
other tools (pcbnew, gerbview, …) follow once the schematic editor is solid.
