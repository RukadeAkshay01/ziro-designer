/**
 * Upload the complete official symbol + footprint libraries to R2.
 *
 * Sources (gitignored): kicad-symbols-src/ and kicad-footprints-src/ (upstream
 * library repos, master). Upstream symbols moved to the one-symbol-per-file
 * layout (<Lib>.kicad_symdir/*.kicad_sym); the app — like released KiCad —
 * loads one .kicad_sym per library, so each dir is merged into a single
 * library file. The merge is lossless: every top-level `(symbol …)` block is
 * copied byte-for-byte via a balanced-paren scan, never reformatted.
 *
 * Uploads:
 *   symbols/<Lib>.kicad_sym + symbols/index.json   [{name,count,symbols}]
 *   footprints/<Lib>.pretty/<FP>.kicad_mod + footprints/index.json
 *                                                  [{name,footprints}]
 *
 * Usage: R2_* env vars (see tools/r2.mjs), then `node tools/libraries/upload.mjs`.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { putObject, uploadAll } from '../r2.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SYM_SRC = join(ROOT, 'kicad-symbols-src');
const FP_SRC = join(ROOT, 'kicad-footprints-src');

/** Extract top-level `(symbol "Name" …)` blocks byte-exactly. */
function topLevelSymbols(text) {
  const out = [];
  let i = text.indexOf('(');
  if (i < 0) return out;
  // walk children of the root list
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '(') {
      depth++;
      if (depth === 2) start = i;
    } else if (c === ')') {
      if (depth === 2 && start >= 0) {
        const block = text.slice(start, i + 1);
        if (/^\(\s*symbol\s/.test(block)) {
          const name = block.match(/^\(\s*symbol\s+"((?:[^"\\]|\\.)*)"/)?.[1];
          out.push({ name: name ?? '?', block });
        }
        start = -1;
      }
      depth--;
    }
  }
  return out;
}

// --- symbols: merge each .kicad_symdir into one library file ------------------
const symEntries = [];
const symIndex = [];
const symDirs = readdirSync(SYM_SRC).filter((d) => d.endsWith('.kicad_symdir'));
for (const dir of symDirs.sort()) {
  const lib = dir.replace(/\.kicad_symdir$/, '');
  const parts = [];
  for (const f of readdirSync(join(SYM_SRC, dir)).sort()) {
    if (!f.endsWith('.kicad_sym')) continue;
    for (const s of topLevelSymbols(readFileSync(join(SYM_SRC, dir, f), 'utf8'))) parts.push(s);
  }
  // Derived symbols (`extends`) must appear after their parent; upstream keeps
  // parents and derivatives in one file, and file order preserves that.
  const names = parts.map((p) => p.name);
  const body = parts.map((p) => `\t${p.block}`).join('\n');
  const merged = `(kicad_symbol_lib\n\t(version 20241209)\n\t(generator "ziro_library_merge")\n\t(generator_version "1.0")\n${body}\n)\n`;
  symEntries.push([`symbols/${lib}.kicad_sym`, Buffer.from(merged), 'text/plain']);
  symIndex.push({ name: lib, count: names.length, symbols: names });
  // stage the merged lib so the qa sweep can validate it with our engines
  mkdirSync(join(ROOT, 'tools/libraries/out/symbols'), { recursive: true });
  writeFileSync(join(ROOT, 'tools/libraries/out/symbols', `${lib}.kicad_sym`), merged);
}
console.log(
  `symbols: ${symIndex.length} libraries, ${symIndex.reduce((n, l) => n + l.count, 0)} symbols`,
);

// --- footprints: verbatim files ------------------------------------------------
const fpEntries = [];
const fpIndex = [];
const pretties = readdirSync(FP_SRC).filter((d) => d.endsWith('.pretty'));
for (const dir of pretties.sort()) {
  const lib = dir.replace(/\.pretty$/, '');
  const mods = readdirSync(join(FP_SRC, dir))
    .filter((f) => f.endsWith('.kicad_mod'))
    .sort();
  for (const f of mods)
    fpEntries.push([`footprints/${dir}/${f}`, readFileSync(join(FP_SRC, dir, f)), 'text/plain']);
  fpIndex.push({ name: lib, footprints: mods.map((f) => f.replace(/\.kicad_mod$/, '')) });
}
console.log(`footprints: ${fpIndex.length} libraries, ${fpEntries.length} footprints`);

if (process.env.STAGE_ONLY) {
  console.log('STAGE_ONLY set — merged libraries staged, skipping upload.');
  process.exit(0);
}

// --- upload ---------------------------------------------------------------------
const all = [...symEntries, ...fpEntries];
const totalMB = all.reduce((n, [, b]) => n + b.length, 0) / 1e6;
console.log(`uploading ${all.length} objects, ${totalMB.toFixed(0)} MB…`);
await uploadAll(all, {
  onProgress: (d, t) => {
    if (d % 500 === 0 || d === t) console.log(`${d}/${t}`);
  },
});
await putObject(
  'symbols/index.json',
  Buffer.from(`${JSON.stringify(symIndex)}\n`),
  'application/json',
);
await putObject(
  'footprints/index.json',
  Buffer.from(`${JSON.stringify(fpIndex)}\n`),
  'application/json',
);
console.log('uploaded manifests');
console.log('DONE');
