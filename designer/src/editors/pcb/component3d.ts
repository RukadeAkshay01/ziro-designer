/**
 * Load and place footprint 3D models in the three.js scene, replicating KiCad's
 * exact placement matrix (render_3d_opengl.cpp get3dModelsFromFootprint):
 *
 *   footprint: translate(x, -y, surfaceZ) · rotateZ(orientation)
 *              · [if back: rotateY(π)·rotateZ(π)] · scale(model-unit→world)
 *   per model: translate(offset) · rotateZ(-rz)·rotateY(-ry)·rotateX(-rx)
 *              · scale(scale)
 *
 * KiCad's model space is millimetres (modelunit_to_3d_units_factor =
 * BiuTo3dUnits · IU_PER_MM), and `(offset …)` is millimetres applied in that
 * space. Each loader normalises geometry into mm exactly as KiCad's plugins
 * do:
 *   - `.glb` (our hosted library, converted from the KiCad 10 STEP set) and
 *     project STEP/IGES models are native mm — loaded raw;
 *   - `.wrl` is authored in 0.1-inch units — scaled ×2.54 at load, unless the
 *     file carries its own top-level scale transform (WRL2BASE's
 *     "ApplyUnitConversion" rule in plugins/3d/vrml).
 * Our world frame is also mm, so the footprint matrix's model-unit factor is 1.
 *
 * Models load async and are cached per source; a part used many times is
 * fetched once and cloned. A model's `(opacity …)` clones materials on its
 * instance (MODELTORENDER carries m_Opacity into the transparent pass).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import type { Board } from '@ziroeda/pcbnew';
import { resolvePath } from './filename_resolver.js';
import { loadCadModel } from './loadmodel.js';

const MM = 10000; // internal units per mm
const VRML_UNIT_MM = 2.54; // legacy VRML model unit = 0.1 inch (WRL2BASE)

type Footprint = Board['footprints'][number];
type Model = Footprint['models'][number];
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A file bundled with the uploaded project (VRML/STEP sources are ASCII). */
export interface ProjectFile {
  name: string;
  text: string;
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
  // Upstream scales by modelunit_to_3d_units_factor here; model space and our
  // world are both mm, so that factor is 1 and offset applies in mm directly.
  m.multiply(new THREE.Matrix4().makeTranslation(model.offset.x, model.offset.y, model.offset.z));
  m.multiply(rotZ(deg(-model.rotate.z)));
  m.multiply(rotY(deg(-model.rotate.y)));
  m.multiply(rotX(deg(-model.rotate.x)));
  m.multiply(new THREE.Matrix4().makeScale(model.scale.x, model.scale.y, model.scale.z));
  return m;
}

/**
 * VRML unit conversion (WRL2BASE::SetApplyUnitConversion): legacy `.wrl`
 * models are 0.1-inch units → ×2.54 into mm, but a file that already carries a
 * top-level scale transform is self-converting and is left alone.
 */
function vrmlIntoMm(o: THREE.Object3D): THREE.Object3D {
  const selfScaled = [o, ...o.children].some(
    (c) => c.scale.x !== 1 || c.scale.y !== 1 || c.scale.z !== 1,
  );
  const wrapper = new THREE.Group();
  wrapper.add(o);
  if (!selfScaled) o.scale.setScalar(VRML_UNIT_MM);
  return wrapper;
}

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * Load every footprint's 3D models and add them to `scene`. `libBase` is where
 * the hosted library lives (a `.glb` URL prefix); `projectFiles` carries the
 * uploaded project's own files so ${KIPRJMOD}/relative references load exactly
 * as KiCad loads them from the project directory.
 */
export function mountComponents(
  scene: THREE.Scene,
  board: Board,
  box: Box,
  hz: number,
  libBase: string,
  projectFiles?: ProjectFile[],
  onChange?: () => void,
): () => void {
  const vrmlLoader = new VRMLLoader();
  const gltfLoader = new GLTFLoader();
  const cache = new Map<string, Promise<THREE.Object3D | null>>();
  const added: THREE.Object3D[] = [];
  let cancelled = false;
  const enc = new TextEncoder();
  const fileNames = projectFiles?.map((f) => f.name);

  const loadUrl = (url: string): Promise<THREE.Object3D | null> =>
    /\.glb$/i.test(url)
      ? gltfLoader
          .loadAsync(url)
          .then((g) => g.scene as THREE.Object3D)
          .catch(() => null)
      : vrmlLoader
          .loadAsync(url)
          .then((o) => vrmlIntoMm(o))
          .catch(() => null);

  // Dispatch a project file by extension, mirroring KiCad's 3d plugin registry
  // (vrml plugin for .wrl, the OCC kernel for STEP/IGES). Compressed variants
  // (.wrz/.stpz) and .x3d are not loadable from text-ingested projects yet.
  const loadProjectFile = (name: string): Promise<THREE.Object3D | null> => {
    const file = projectFiles?.find((f) => f.name === name);
    if (!file) return Promise.resolve(null);
    switch (extOf(name)) {
      case 'wrl':
        return Promise.resolve().then(() => {
          try {
            return vrmlIntoMm(vrmlLoader.parse(file.text, name) as THREE.Object3D);
          } catch {
            return null;
          }
        });
      case 'step':
      case 'stp':
        return loadCadModel(enc.encode(file.text), 'step');
      case 'iges':
      case 'igs':
        return loadCadModel(enc.encode(file.text), 'iges');
      default:
        return Promise.resolve(null);
    }
  };

  for (const fp of board.footprints) {
    for (const model of fp.models) {
      if (model.hide || !model.path) continue;
      const res = resolvePath(model.path, { libBase, libExt: 'glb', projectFiles: fileNames });
      if (res.kind === 'unresolved') continue;
      const key = res.kind === 'url' ? res.url : `project:${res.name}`;

      let p = cache.get(key);
      if (!p) {
        p = res.kind === 'url' ? loadUrl(res.url) : loadProjectFile(res.name);
        cache.set(key, p);
      }
      const matrix = modelMatrix(fp, model, box, hz);
      const opacity = model.opacity;
      void p.then((obj) => {
        if (cancelled || !obj) return;
        const inst = obj.clone();
        inst.matrixAutoUpdate = false;
        inst.matrix.copy(matrix);
        inst.matrixWorldNeedsUpdate = true;
        if (opacity !== undefined && opacity < 1) {
          inst.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const m = (child.material as THREE.Material).clone();
              m.transparent = true;
              m.opacity *= opacity;
              child.material = m;
            }
          });
        }
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
