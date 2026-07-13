/**
 * STEP -> GLB converter for the KiCad 10 packages3D library.
 *
 * Tessellates each .step with OpenCascade (occt-import-js WASM) — the same
 * kernel KiCad's own 3D viewer uses — preserving per-face STEP colors, then
 * writes a compact .glb via @gltf-transform.
 *
 * Geometry stays in the STEP file's native millimetres; the app-side loader
 * applies the mm scale (VRML models instead used 1 unit = 2.54 mm).
 *
 * Usage: node convert.mjs <in.step> <out.glb>
 *        node convert.mjs --batch <stepRoot> <glbRoot> [shardIndex shardCount]
 */
import fs from 'node:fs';
import path from 'node:path';
import occtimportjs from 'occt-import-js';
import { Document, NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld } from '@gltf-transform/functions';

const occt = await occtimportjs();

async function convertOne(inFile, outFile) {
  const buf = fs.readFileSync(inFile);
  const result = occt.ReadStepFile(new Uint8Array(buf), null);
  if (!result.success || result.meshes.length === 0) {
    throw new Error(`STEP read failed: ${inFile}`);
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const matCache = new Map();

  const materialFor = (color) => {
    const key = color ? color.join(',') : 'default';
    let m = matCache.get(key);
    if (!m) {
      m = doc
        .createMaterial(key)
        .setBaseColorFactor(color ? [...color, 1] : [0.8, 0.8, 0.8, 1])
        .setMetallicFactor(0.1)
        .setRoughnessFactor(0.6);
      matCache.set(key, m);
    }
    return m;
  };

  for (const mesh of result.meshes) {
    // STEP colors are per-BREP-face; group face triangle ranges by color and
    // emit one primitive per color, all sharing the same vertex accessors.
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(mesh.attributes.position.array))
      .setBuffer(buffer);
    const normal = mesh.attributes.normal
      ? doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(mesh.attributes.normal.array))
          .setBuffer(buffer)
      : null;
    const allIdx = Uint32Array.from(mesh.index.array); // occt returns plain arrays

    const groups = new Map(); // colorKey -> { color, ranges: [[firstTri,lastTri]] }
    const faces =
      mesh.brep_faces && mesh.brep_faces.length > 0
        ? mesh.brep_faces
        : [{ first: 0, last: allIdx.length / 3 - 1, color: mesh.color ?? null }];
    for (const f of faces) {
      const color = f.color ?? mesh.color ?? null;
      const key = color ? color.join(',') : 'default';
      let g = groups.get(key);
      if (!g) {
        g = { color, ranges: [] };
        groups.set(key, g);
      }
      g.ranges.push([f.first, f.last]);
    }

    const gMesh = doc.createMesh(mesh.name || 'mesh');
    for (const { color, ranges } of groups.values()) {
      let n = 0;
      for (const [a, b] of ranges) n += (b - a + 1) * 3;
      const idx = new Uint32Array(n);
      let o = 0;
      for (const [a, b] of ranges) {
        idx.set(allIdx.subarray(a * 3, (b + 1) * 3), o);
        o += (b - a + 1) * 3;
      }
      const prim = doc
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
        .setMaterial(materialFor(color));
      if (normal) prim.setAttribute('NORMAL', normal);
      gMesh.addPrimitive(prim);
    }
    scene.addChild(doc.createNode(mesh.name || 'node').setMesh(gMesh));
  }

  await doc.transform(weld(), dedup(), prune());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const io = new NodeIO();
  fs.writeFileSync(outFile, await io.writeBinary(doc));
}

const args = process.argv.slice(2);
if (args[0] === '--batch') {
  const [stepRoot, glbRoot] = [args[1], args[2]];
  const shardIdx = Number(args[3] ?? 0);
  const shardCnt = Number(args[4] ?? 1);
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.step$/i.test(e.name)) files.push(p);
    }
  };
  walk(stepRoot);
  files.sort();
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < files.length; i++) {
    if (i % shardCnt !== shardIdx) continue;
    const rel = path.relative(stepRoot, files[i]).replace(/\.step$/i, '.glb');
    const out = path.join(glbRoot, rel);
    if (fs.existsSync(out)) {
      ok++;
      continue;
    } // resumable
    try {
      await convertOne(files[i], out);
      ok++;
    } catch (e) {
      fail++;
      fs.appendFileSync(path.join(glbRoot, `failed-${shardIdx}.log`), `${rel}\t${e.message}\n`);
    }
    if ((ok + fail) % 200 === 0)
      console.log(`[shard ${shardIdx}] ${ok + fail} done (${fail} failed)`);
  }
  console.log(`[shard ${shardIdx}] FINISHED ok=${ok} fail=${fail}`);
} else {
  await convertOne(args[0], args[1]);
  console.log(`wrote ${args[1]} (${(fs.statSync(args[1]).size / 1024).toFixed(1)} KB)`);
}
