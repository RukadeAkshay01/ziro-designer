/**
 * Load and place footprint 3D models in the three.js scene, replicating KiCad's
 * exact placement matrix (render_3d_opengl.cpp renderFootprint):
 *
 *   footprint: translate(x, -y, surfaceZ) · rotateZ(orientation)
 *              · [if back: rotateY(π)·rotateZ(π)] · scale(model-unit→mm)
 *   per model: translate(offset) · rotateZ(-rz)·rotateY(-ry)·rotateX(-rx)
 *              · scale(scale)
 *
 * KiCad's model space is 0.1-inch units (2.54 mm) with the mounting plane at
 * Z=0. Legacy `.wrl` models are authored directly in that space (VRMLLoader
 * reads them raw). Our hosted library is the KiCad 10 STEP set pre-converted
 * to `.glb` in native millimetres, so — exactly like KiCad's own STEP loader
 * (3d_cache OCC plugin) — glTF geometry is pre-scaled by 1/2.54 into model
 * space and the shared placement matrix carries over unchanged. Models load
 * async and are cached per URL; a part used many times is fetched once and
 * cloned.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import type { Board } from '@ziroeda/pcbnew';
import { resolveModel } from './model3d.js';

const MM = 10000; // internal units per mm
const MODEL_UNIT_MM = 2.54; // KiCad VRML unit = 0.1 inch

type Footprint = Board['footprints'][number];
type Model = Footprint['models'][number];
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const rotZ = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(r);
const rotY = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(r);
const rotX = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(r);
const deg = (d: number): number => (d * Math.PI) / 180;

/** KiCad placement matrix for one footprint model, in our centred mm/Z-up frame. */
export function modelMatrix(fp: Footprint, model: Model, box: Box, hz: number): THREE.Matrix4 {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const fx = (fp.at.x - cx) / MM;
  const fy = -(fp.at.y - cy) / MM; // KiCad flips Y into the 3D frame
  const flipped = fp.layer === 'B.Cu';

  const m = new THREE.Matrix4().makeTranslation(fx, fy, flipped ? -hz : hz);
  m.multiply(rotZ(deg(fp.angle)));
  if (flipped) {
    m.multiply(rotY(Math.PI));
    m.multiply(rotZ(Math.PI));
  }
  m.multiply(new THREE.Matrix4().makeScale(MODEL_UNIT_MM, MODEL_UNIT_MM, MODEL_UNIT_MM));
  m.multiply(new THREE.Matrix4().makeTranslation(model.offset.x, model.offset.y, model.offset.z));
  m.multiply(rotZ(deg(-model.rotate.z)));
  m.multiply(rotY(deg(-model.rotate.y)));
  m.multiply(rotX(deg(-model.rotate.x)));
  m.multiply(new THREE.Matrix4().makeScale(model.scale.x, model.scale.y, model.scale.z));
  return m;
}

/**
 * Load every footprint's 3D models and add them to `scene`. `libBase` is where
 * the hosted library lives (a `.wrl`/`.glb` URL prefix); `projectFiles` lets
 * ${KIPRJMOD} models resolve to bundled files (not fetched yet). Returns a
 * disposer + an onDone callback fired when all loads settle.
 */
export function mountComponents(
  scene: THREE.Scene,
  board: Board,
  box: Box,
  hz: number,
  libBase: string,
  onChange?: () => void,
): () => void {
  const vrmlLoader = new VRMLLoader();
  const gltfLoader = new GLTFLoader();
  const cache = new Map<string, Promise<THREE.Object3D | null>>();
  const added: THREE.Object3D[] = [];
  let cancelled = false;

  // glTF geometry is in mm; bring it into KiCad model space (1 unit = 2.54 mm)
  // so the placement matrix treats every format identically.
  const intoModelSpace = (o: THREE.Object3D): THREE.Object3D => {
    o.scale.setScalar(1 / MODEL_UNIT_MM);
    const wrapper = new THREE.Group();
    wrapper.add(o);
    return wrapper;
  };

  for (const fp of board.footprints) {
    for (const model of fp.models) {
      if (model.hide || !model.path) continue;
      const res = resolveModel(model.path, { libBase, libExt: 'glb' });
      if (res.kind !== 'url') continue; // project-local models: later
      const url = res.url;

      let p = cache.get(url);
      if (!p) {
        p = /\.glb$/i.test(url)
          ? gltfLoader
              .loadAsync(url)
              .then((g) => intoModelSpace(g.scene))
              .catch(() => null)
          : vrmlLoader
              .loadAsync(url)
              .then((o) => o as THREE.Object3D)
              .catch(() => null);
        cache.set(url, p);
      }
      const matrix = modelMatrix(fp, model, box, hz);
      void p.then((obj) => {
        if (cancelled || !obj) return;
        const inst = obj.clone();
        inst.matrixAutoUpdate = false;
        inst.matrix.copy(matrix);
        inst.matrixWorldNeedsUpdate = true;
        scene.add(inst);
        added.push(inst);
        onChange?.();
      });
    }
  }

  return () => {
    cancelled = true;
    for (const o of added) scene.remove(o);
  };
}
