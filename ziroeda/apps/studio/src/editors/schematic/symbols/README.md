# Symbols

Symbol access for the schematic editor.

- `index.ts` — loads the library index for search and fetches/parses a library's
  symbols on demand when one is placed.
- The actual symbol data lives under `apps/schematic/public/symbols/` as static
  assets: `index.json` (library + symbol names, loaded up front for search) and
  one `<Library>.kicad_sym` per library (fetched on demand).

The `<Library>.kicad_sym` files are a broad subset of the official
[KiCad symbol libraries](https://gitlab.com/kicad/libraries/kicad-symbols),
combined one-file-per-library (each library directory's symbols concatenated
unmodified). They are licensed under **CC-BY-SA-4.0 with the KiCad Library
Exception** (which permits use in designs without attribution); see the upstream
repository's `LICENSE.md`. Attribution goes to the KiCad Libraries team and
contributors. To add more libraries, drop additional `<Library>.kicad_sym` files
in `public/symbols/` and list them in `index.json`.
