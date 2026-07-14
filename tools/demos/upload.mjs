/**
 * Upload the FULL upstream demo corpus (no stripping — every file of every
 * project) straight from kicad-src/demos to R2, plus a generated manifest.
 * Dependency-free SigV4 (S3-compatible) so the repo carries no SDK weight.
 *
 * Usage:
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *   R2_BUCKET=ziro-3dmodels R2_PREFIX=demos node tools/demos/upload.mjs
 *
 * Skips only: python_scripts_examples (not a project), dotfiles, CMakeLists.
 * After upload set VITE_DEMOS_URL=https://<public-r2-host>/<prefix>.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'kicad-src/demos');

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? 'ziro-3dmodels';
const PREFIX = (process.env.R2_PREFIX ?? 'demos').replace(/\/+$/, '');
if (!ACCOUNT || !KEY || !SECRET) {
  console.error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;

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
  'jetson-agx-thor-baseboard': 'Jetson AGX Thor Baseboard',
  'vme-wren': 'VME Wren',
};

const TYPES = {
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.step': 'model/step',
  '.stp': 'model/step',
  '.wrl': 'model/vrml',
  '.glb': 'model/gltf-binary',
};
const typeOf = (name) => TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';

// --- minimal SigV4 for S3-compatible PUT -------------------------------------
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const encPath = (p) =>
  p
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

async function putObject(key, body, contentType) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const headers = {
    host: HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'PUT',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: auth,
      'content-type': contentType,
      'content-length': String(body.length),
    },
    body,
  });
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`);
}

// --- walk the full corpus ------------------------------------------------------
const SKIP_TOP = new Set(['python_scripts_examples']);
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'CMakeLists.txt') continue;
    const p = join(dir, e.name);
    const rel = relative(SRC, p).replaceAll('\\', '/');
    if (SKIP_TOP.has(rel.split('/')[0])) continue;
    if (e.isDirectory()) walk(p);
    else files.push(rel);
  }
};
walk(SRC);

// manifest: one entry per top-most project directory
const proDirs = [...new Set(files.filter((f) => f.endsWith('.kicad_pro')).map((f) => f.slice(0, f.lastIndexOf('/'))))];
const tops = proDirs.filter((d) => !proDirs.some((o) => o !== d && d.startsWith(`${o}/`))).sort();
const demos = tops
  .map((d) => {
    const inDir = files.filter((f) => f.startsWith(`${d}/`)).map((f) => f.slice(d.length + 1)).sort();
    const base = d.split('/').pop();
    return {
      id: d,
      base,
      title:
        TITLES[d] ??
        base.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Upstream demo project (${inDir.find((f) => f.endsWith('.kicad_pro')).split('/').pop()}).`,
      files: inDir,
    };
  })
  .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

const totalBytes = files.reduce((n, f) => n + statSync(join(SRC, f)).size, 0);
console.log(`${demos.length} demos, ${files.length} files, ${(totalBytes / 1e6).toFixed(1)} MB`);

// --- upload with limited concurrency + retries ---------------------------------
let done = 0;
let sent = 0;
const queue = [...files];
async function worker() {
  for (;;) {
    const rel = queue.shift();
    if (!rel) return;
    const body = readFileSync(join(SRC, rel));
    for (let attempt = 1; ; attempt++) {
      try {
        await putObject(`${PREFIX}/${rel}`, body, typeOf(rel));
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    done++;
    sent += body.length;
    if (done % 50 === 0 || done === files.length)
      console.log(`${done}/${files.length} files, ${(sent / 1e6).toFixed(0)} MB`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const manifest = Buffer.from(`${JSON.stringify({ demos }, null, 2)}\n`);
await putObject(`${PREFIX}/index.json`, manifest, 'application/json');
console.log(`uploaded manifest -> ${PREFIX}/index.json`);
console.log('DONE');
