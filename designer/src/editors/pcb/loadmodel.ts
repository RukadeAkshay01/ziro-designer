/**
 * Load a STEP/IGES model into a three.js object, in the browser. Counterpart:
 * `plugins/3d/occ/loadmodel.cpp` — KiCad tessellates these formats with its
 * OpenCascade kernel; we use the same kernel compiled to WASM
 * (occt-import-js), lazy-loaded on first use so boards without project-local
 * CAD models never pay for it.
 *
 * Geometry comes out in the file's native millimetres — KiCad model space —
 * with per-BREP-face STEP colors mapped to one material per color, exactly as
 * our offline library converter does for the hosted `.glb` set.
 */
import * as THREE from 'three';

interface OcctFace {
  first: number;
  last: number;
  color?: [number, number, number] | null;
}
interface OcctMesh {
  name?: string;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  color?: [number, number, number] | null;
  brep_faces?: OcctFace[];
}
interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}
interface OcctModule {
  ReadStepFile(content: Uint8Array, params: null): OcctResult;
  ReadIgesFile(content: Uint8Array, params: null): OcctResult;
}

let occtPromise: Promise<OcctModule> | null = null;

// Lazy singleton: the WASM kernel is ~11 MB, fetched only when a project
// actually ships a STEP/IGES model.
function occt(): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      return (await init({ locateFile: () => wasmUrl })) as OcctModule;
    })();
  }
  return occtPromise;
}

function toObject3D(result: OcctResult): THREE.Object3D | null {
  if (!result.success || result.meshes.length === 0) return null;
  const root = new THREE.Group();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const materialFor = (color: [number, number, number] | null): THREE.MeshStandardMaterial => {
    const key = color ? color.join(',') : 'default';
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: color ? new THREE.Color(color[0], color[1], color[2]) : 0xcccccc,
        metalness: 0.1,
        roughness: 0.6,
      });
      matCache.set(key, m);
    }
    return m;
  };

  for (const mesh of result.meshes) {
    const position = new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3);
    const normal = mesh.attributes.normal
      ? new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3)
      : null;
    const allIdx = Uint32Array.from(mesh.index.array);

    // STEP colors are per-BREP-face; group triangle ranges by color into one
    // mesh per color, sharing the vertex buffers.
    const groups = new Map<
      string,
      { color: [number, number, number] | null; ranges: [number, number][] }
    >();
    const faces: OcctFace[] =
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

    for (const { color, ranges } of groups.values()) {
      let n = 0;
      for (const [a, b] of ranges) n += (b - a + 1) * 3;
      const idx = new Uint32Array(n);
      let o = 0;
      for (const [a, b] of ranges) {
        idx.set(allIdx.subarray(a * 3, (b + 1) * 3), o);
        o += (b - a + 1) * 3;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', position);
      if (normal) geom.setAttribute('normal', normal);
      else geom.computeVertexNormals();
      geom.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
      root.add(new THREE.Mesh(geom, materialFor(color)));
    }
  }
  return root;
}

/** Tessellate STEP (or IGES) file content to a three.js object; null on failure. */
export async function loadCadModel(
  bytes: Uint8Array,
  kind: 'step' | 'iges',
): Promise<THREE.Object3D | null> {
  try {
    const mod = await occt();
    const result = kind === 'step' ? mod.ReadStepFile(bytes, null) : mod.ReadIgesFile(bytes, null);
    return toObject3D(result);
  } catch {
    return null;
  }
}
