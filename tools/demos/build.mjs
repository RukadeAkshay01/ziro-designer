/**
 * Assemble the full upstream demo corpus for the hosted CDN (Cloudflare R2).
 *
 * Reads the gitignored upstream clone (kicad-src/demos, branch 10.0), applies
 * the same stripping rules the bundled ecc83 uses (design files verbatim;
 * large 3D models, PDFs, archives, backups omitted; the jetson and vme-wren
 * showcase boards skipped — their board files alone are 81/67 MB), and writes
 * a ready-to-upload tree + manifest to tools/demos/out/.
 *
 * Usage:
 *   node tools/demos/build.mjs
 *   rclone copy tools/demos/out r2:<bucket>/demos   # or wrangler r2 object put
 * Then set VITE_DEMOS_URL=https://<public-r2-host>/demos in the deploy env.
 * The bucket needs CORS for the app origin (same as the models3d bucket).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'kicad-src/demos');
const OUT = fileURLToPath(new URL('out', import.meta.url));

const SKIP_DIRS = new Set(['jetson-agx-thor-baseboard', 'vme-wren', 'python_scripts_examples']);
const HEAVY = new Set([
  '.step',
  '.stp',
  '.wrl',
  '.wings',
  '.zip',
  '.wbk',
  '.db',
  '.pdf',
  '.gltf',
  '.glb',
  '.lck',
]);
const IMG = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.bmp']);
const TITLES = {
  ecc83: 'ECC83 Tube Push-Pull Amplifier',
  pic_programmer: 'PIC Programmer',
  complex_hierarchy: 'Complex Hierarchy',
  interf_u: 'Interface USB (interf_u)',
  microwave: 'Microwave (RF board)',
  'sonde xilinx': 'Sonde Xilinx',
  stickhub: 'StickHub USB Hub',
  video: 'Video Board',
  multichannel: 'Multichannel Mixer',
  'kit-dev-coldfire-xilinx_5213': 'ColdFire + Xilinx Dev Kit',
  cm5_minima: 'CM5 Minima Carrier',
  'openair-max': 'OpenAir Max (ESP32-C6)',
  royalblue54L_feather: 'RoyalBlue54L Feather',
  tiny_tapeout: 'Tiny Tapeout Demo Board',
};

if (!existsSync(SRC)) {
  console.error(
    'kicad-src/demos not found — clone the upstream 10.0 branch first (see .gitignore note).',
  );
  process.exit(1);
}

const keep = (path, name) => {
  if (name.startsWith('.') || name === 'CMakeLists.txt') return false;
  const size = statSync(path).size;
  const ext = extname(name).toLowerCase();
  if (HEAVY.has(ext) && !(['.wrl', '.step', '.stp'].includes(ext) && size < 300 * 1024))
    return false;
  if (IMG.has(ext) && size > 512 * 1024) return false;
  if (size > 8 * 1024 * 1024 && !ext.startsWith('.kicad')) return false;
  return true;
};

rmSync(OUT, { recursive: true, force: true });
let total = 0;
const walkCopy = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(SRC, p);
    if (e.isDirectory()) {
      if (
        !SKIP_DIRS.has(rel.split('/')[0]) &&
        !e.name.startsWith('.') &&
        !e.name.endsWith('-backups')
      )
        walkCopy(p);
    } else if (!SKIP_DIRS.has(rel.split('/')[0]) && keep(p, e.name)) {
      mkdirSync(dirname(join(OUT, rel)), { recursive: true });
      cpSync(p, join(OUT, rel));
      total += statSync(p).size;
    }
  }
};
walkCopy(SRC);

// manifest: one entry per top-most project directory
const proDirs = new Set();
const walkPro = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walkPro(join(dir, e.name));
    else if (e.name.endsWith('.kicad_pro')) proDirs.add(relative(OUT, dir).replaceAll('\\', '/'));
  }
};
walkPro(OUT);
const tops = [...proDirs]
  .filter((d) => ![...proDirs].some((o) => o !== d && d.startsWith(`${o}/`)))
  .sort();

const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
const demos = tops.map((d) => {
  const files = listFiles(join(OUT, d))
    .map((f) => relative(join(OUT, d), f).replaceAll('\\', '/'))
    .sort();
  const pros = files.filter((f) => f.endsWith('.kicad_pro'));
  const base = d.split('/').pop();
  return {
    id: d,
    base,
    title:
      TITLES[d] ??
      base
        .replaceAll('_', ' ')
        .replaceAll('-', ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    description: `Upstream demo project (${pros[0].split('/').pop()}).`,
    files,
  };
});
demos.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify({ demos }, null, 2)}\n`);
console.log(`${demos.length} demos, ${(total / 1e6).toFixed(1)} MB -> ${OUT}`);
