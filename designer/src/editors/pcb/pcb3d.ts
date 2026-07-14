/**
 * 3D board viewer on three.js.
 *
 * The board is real geometry (KiCad create_scene.cpp approach): the Edge.Cuts
 * outline extruded to thickness, with each layer — FR4 body, copper (faint under
 * the mask), soldermask (translucent), exposed copper (gold), silkscreen, and
 * plated hole barrels — as its own triangle mesh stacked just off the face. All
 * geometry comes from boardGeom.ts/boardOutline.ts (see buildBoardGeom); this
 * file only turns those meshes into three.js meshes + materials, lights, and a
 * KiCad-style trackball camera. Component 3D models are added on top of this.
 */
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from './renderBoard.js';
import { buildBoardOutline } from './boardOutline.js';
import { buildBoardGeom, boardHoles, type Mesh } from './boardGeom.js';
import { mountComponents, type ProjectFile } from './component3d.js';
import type { Board } from '@ziroeda/pcbnew';

const MM = 10000;
// Where the 3D model library is hosted. Defaults to the bundled demo set;
// point VITE_MODELS3D_URL at the hosted library (Cloudflare R2 / jsDelivr) to
// cover all boards. See the ziro-3d-components-plan memory.
const MODELS3D_BASE = (import.meta.env.VITE_MODELS3D_URL as string | undefined) || '/models3d';

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The physical board extent = the Edge.Cuts outline, NOT the item bounding box
 * (which includes off-board documentation like the stackup table). Falls back to
 * the full scene bbox if no edge exists.
 */
function edgeBBox(board: Board, fallback: BBox): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const inc = (x?: number, y?: number): void => {
    if (x === undefined || y === undefined) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const shapes = [...board.shapes, ...board.footprints.flatMap((f) => f.shapes)];
  for (const s of shapes) {
    if (s.layer !== 'Edge.Cuts') continue;
    inc(s.start?.x, s.start?.y);
    inc(s.end?.x, s.end?.y);
    inc(s.mid?.x, s.mid?.y);
    if (s.center && s.end) {
      const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
      inc(s.center.x - r, s.center.y - r);
      inc(s.center.x + r, s.center.y + r);
    }
    for (const p of s.pts ?? []) inc(p.x, p.y);
  }
  return minX < maxX ? { minX, minY, maxX, maxY } : fallback;
}

export interface Viewer3D {
  dispose: () => void;
}

// A geometry group: interleaved [x,y,z, nx,ny,nz] verts + triangle indices.
interface Group {
  verts: number[];
  idx: number[];
}

/** Mount the 3D viewer into `container`; returns a disposer. `projectFiles`
 *  carries the open project's own files so ${KIPRJMOD}/relative model
 *  references resolve like KiCad's project directory. */
export function mount3DViewer(
  container: HTMLElement,
  board: Board,
  projectFiles?: ProjectFile[],
): Viewer3D | null {
  const scene2d = buildScene(board);
  if (!scene2d.bbox) return null;
  const box = edgeBBox(board, scene2d.bbox);
  const bw = (box.maxX - box.minX) / MM; // mm
  const bh = (box.maxY - box.minY) / MM;
  const th = (board.thickness ?? 1.6 * MM) / MM;
  const hz = th / 2;
  const half = Math.max(bw, bh) / 2;

  // ---- geometry (reused from the board renderer) ---------------------------
  const holes = boardHoles(board, box);
  const outline = buildBoardOutline(board, box, holes);
  const geom = buildBoardGeom(board, box);
  const outlineMesh: Mesh = { verts: outline.verts, tris: outline.tris };

  const mkGroup = (): Group => ({ verts: [], idx: [] });
  const addFlat = (g: Group, mesh: Mesh, z: number, nz: number): void => {
    const base = g.verts.length / 6;
    for (const p of mesh.verts) g.verts.push(p.x, p.y, z, 0, 0, nz);
    for (const t of mesh.tris) g.idx.push(base + t);
  };

  // Stack heights just off each face (mm): FR4 body → copper → mask → pads → silk.
  const zB = hz,
    zC = hz + 0.03,
    zM = hz + 0.06,
    zP = hz + 0.09,
    zS = hz + 0.12;
  const gBody = mkGroup(),
    gCopper = mkGroup(),
    gMask = mkGroup(),
    gGold = mkGroup(),
    gSilk = mkGroup(),
    gWall = mkGroup(),
    gHole = mkGroup();

  addFlat(gBody, outlineMesh, zB, 1);
  addFlat(gBody, outlineMesh, -zB, -1);
  addFlat(gCopper, geom.front.copper, zC, 1);
  addFlat(gCopper, geom.back.copper, -zC, -1);
  addFlat(gMask, outlineMesh, zM, 1);
  addFlat(gMask, outlineMesh, -zM, -1);
  addFlat(gGold, geom.front.pads, zP, 1);
  addFlat(gGold, geom.back.pads, -zP, -1);
  addFlat(gSilk, geom.front.silk, zS, 1);
  addFlat(gSilk, geom.back.silk, -zS, -1);

  // Extruded FR4 walls along every outline loop (outer boundary + cutouts).
  for (const loop of outline.loops) {
    for (let i = 0; i < loop.length; i++) {
      const p0 = loop[i]!,
        p1 = loop[(i + 1) % loop.length]!;
      const dx = p1.x - p0.x,
        dy = p1.y - p0.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = dy / L,
        ny = -dx / L;
      const b = gWall.verts.length / 6;
      gWall.verts.push(
        p0.x,
        p0.y,
        hz,
        nx,
        ny,
        0,
        p1.x,
        p1.y,
        hz,
        nx,
        ny,
        0,
        p1.x,
        p1.y,
        -hz,
        nx,
        ny,
        0,
        p0.x,
        p0.y,
        -hz,
        nx,
        ny,
        0,
      );
      gWall.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  // Plated hole barrels (gold) lining the drilled voids.
  const zBar = zS + 0.01;
  for (const h of holes) {
    const n = Math.max(10, Math.min(48, Math.round(h.r * 120)));
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n,
        a1 = (2 * Math.PI * (i + 1)) / n;
      const x0 = h.x + h.r * Math.cos(a0),
        y0 = h.y + h.r * Math.sin(a0);
      const x1 = h.x + h.r * Math.cos(a1),
        y1 = h.y + h.r * Math.sin(a1);
      const b = gHole.verts.length / 6;
      gHole.verts.push(
        x0,
        y0,
        zBar,
        -Math.cos(a0),
        -Math.sin(a0),
        0,
        x1,
        y1,
        zBar,
        -Math.cos(a1),
        -Math.sin(a1),
        0,
        x1,
        y1,
        -zBar,
        -Math.cos(a1),
        -Math.sin(a1),
        0,
        x0,
        y0,
        -zBar,
        -Math.cos(a0),
        -Math.sin(a0),
        0,
      );
      gHole.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  // ---- three.js scene ------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  // KiCad's 3D background: a vertical light→medium blue-grey gradient. The
  // renderer clears transparent so this CSS gradient shows around the board.
  canvas.style.background = 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)';
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
  } catch {
    container.removeChild(canvas);
    return null;
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  // A soft indoor environment so the PBR metals (copper/gold) catch light
  // instead of reflecting black — but keep it subtle so it doesn't wash the
  // board out (the env alone at full strength made it pale).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;

  const disposables: { dispose(): void }[] = [];
  const toGeom = (g: Group): THREE.BufferGeometry => {
    const nVerts = g.verts.length / 6;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts; i++) {
      pos[i * 3] = g.verts[i * 6]!;
      pos[i * 3 + 1] = g.verts[i * 6 + 1]!;
      pos[i * 3 + 2] = g.verts[i * 6 + 2]!;
      nrm[i * 3] = g.verts[i * 6 + 3]!;
      nrm[i * 3 + 1] = g.verts[i * 6 + 4]!;
      nrm[i * 3 + 2] = g.verts[i * 6 + 5]!;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    bg.setIndex(new THREE.Uint32BufferAttribute(g.idx, 1));
    disposables.push(bg);
    return bg;
  };
  const mat = (
    hex: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color: hex,
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.1,
      ...opts,
    });
    disposables.push(m);
    return m;
  };
  // KiCad board_adapter material colours.
  const M = {
    fr4: mat(0x8a6b3d),
    copper: mat(0xbf9c3a, { metalness: 0.35, roughness: 0.5 }),
    mask: mat(0x14331f, { transparent: true, opacity: 0.85, depthWrite: false }),
    gold: mat(0xd9ad4d, { metalness: 0.4, roughness: 0.45 }),
    silk: mat(0xededed),
    barrel: mat(0xb88f42, { metalness: 0.5, roughness: 0.4 }),
  };
  const add = (g: Group, m: THREE.Material): void => {
    if (g.idx.length) scene.add(new THREE.Mesh(toGeom(g), m));
  };
  add(gWall, M.fr4);
  add(gBody, M.fr4);
  add(gCopper, M.copper);
  add(gGold, M.gold);
  add(gSilk, M.silk);
  add(gHole, M.barrel);
  add(gMask, M.mask); // translucent last

  // Lighting: soft hemispheric ambient + a headlight that follows the camera
  // (KiCad's key light tracks the viewer), so the visible side is always lit.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556, 0.5));
  const headlight = new THREE.DirectionalLight(0xffffff, 1.35);
  scene.add(headlight);

  // Footprint 3D models (loaded async from the hosted library / project files).
  const disposeComponents = mountComponents(scene, board, box, hz, MODELS3D_BASE, projectFiles);

  // ---- camera + KiCad-style trackball --------------------------------------
  const camera = new THREE.PerspectiveCamera(45, 1, Math.max(0.05, half * 0.02), half * 200);
  // Open looking down onto the top side, tilted so the edges/thickness read.
  camera.position.set(half * 0.35, -half * 1.5, half * 2.2);
  camera.up.set(0, 1, 0);

  const controls = new TrackballControls(camera, canvas);
  controls.rotateSpeed = 3.2;
  controls.zoomSpeed = 1.3;
  controls.panSpeed = 0.8;
  controls.staticMoving = true; // no inertia — precise, KiCad-like
  controls.minDistance = half * 0.4;
  controls.maxDistance = half * 20;
  controls.target.set(0, 0, 0);

  let raf = 0;
  const animate = (): void => {
    raf = requestAnimationFrame(animate);
    controls.update();
    headlight.position.copy(camera.position); // headlight follows the camera
    renderer.render(scene, camera);
  };

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.handleResize();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  animate();

  return {
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeComponents();
      controls.dispose();
      for (const d of disposables) d.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
  };
}
