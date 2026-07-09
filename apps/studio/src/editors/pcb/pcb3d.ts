/**
 * Minimal 3D board viewer (raw WebGL — no external libraries, CSP-safe).
 *
 * KiCad's 3D viewer builds a full solid model with component STEP bodies; that
 * is out of scope here. This renders the board the way pcbnew's "realistic
 * board without models" preview does: the copper/silk/mask artwork rendered to
 * textures and mapped onto the real Edge.Cuts board outline (with cutouts),
 * extruded to the board thickness as FR4, with orbit + zoom. It reuses the exact
 * 2D PCB_PAINTER output (renderBoard.ts) for the faces, so the copper you see in
 * 2D is what you see in 3D. Outline chaining/triangulation lives in boardOutline.ts.
 */

import { buildScene } from './renderBoard.js';
import { buildBoardOutline } from './boardOutline.js';
import { buildBoardGeom, boardHoles, type Mesh } from './boardGeom.js';
import type { Board } from '@ziroeda/core';

const MM = 10000;

interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

/**
 * The physical board extent = the Edge.Cuts outline, NOT the item bounding box
 * (which includes off-board documentation like the stackup table and board
 * characteristics text). Falls back to the full scene bbox if no edge exists.
 */
function edgeBBox(board: Board, fallback: BBox): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const inc = (x?: number, y?: number): void => {
    if (x === undefined || y === undefined) return;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  const shapes = [...board.shapes, ...board.footprints.flatMap((f) => f.shapes)];
  for (const s of shapes) {
    if (s.layer !== 'Edge.Cuts') continue;
    inc(s.start?.x, s.start?.y); inc(s.end?.x, s.end?.y); inc(s.mid?.x, s.mid?.y);
    if (s.center && s.end) {
      const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
      inc(s.center.x - r, s.center.y - r); inc(s.center.x + r, s.center.y + r);
    }
    for (const p of s.pts ?? []) inc(p.x, p.y);
  }
  return minX < maxX ? { minX, minY, maxX, maxY } : fallback;
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNormal;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uLightDir;   // world-space direction to the camera (a headlight)
void main() {
  // Headlight (like KiCad, whose key light tracks the camera): abs() so a thin
  // layer is lit from whichever side you're looking at, over a soft ambient.
  vec3 n = normalize(vNormal);
  float d = abs(dot(n, normalize(uLightDir)));
  gl_FragColor = vec4(uColor * (0.5 + 0.6 * d), uAlpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

// --- tiny mat4 helpers (column-major) ---------------------------------------
type Mat4 = Float32Array;
const mul = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
};
const perspective = (fovy: number, aspect: number, near: number, far: number): Mat4 => {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
};
const lookAt = (eye: number[], center: number[], up: number[]): Mat4 => {
  const sub = (a: number[], b: number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const norm = (v: number[]): number[] => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l]; };
  const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const o = new Float32Array(16);
  o[0] = x[0]!; o[4] = x[1]!; o[8] = x[2]!; o[12] = -dot(x, eye);
  o[1] = y[0]!; o[5] = y[1]!; o[9] = y[2]!; o[13] = -dot(y, eye);
  o[2] = z[0]!; o[6] = z[1]!; o[10] = z[2]!; o[14] = -dot(z, eye);
  o[15] = 1;
  return o;
};

// --- SGI / Gavin Bell arcball trackball, ported from KiCad's
// 3d_rendering/trackball.cpp so rotation feels exactly like KiCad: project the
// two mouse points onto a virtual sphere (radius 0.8, hyperbolic falloff past
// the edge) and rotate about the axis between them by the arc angle. This gives
// fine-grained, direction-aware control — unlike a fixed-scale Euler nudge.
const TB = 0.8;
const tbProject = (x: number, y: number): number => {
  const d = Math.hypot(x, y);
  if (d < TB * 0.7071067811865476) return Math.sqrt(TB * TB - d * d); // inside sphere
  const t = TB / 1.4142135623730951; // on hyperbola past the edge
  return (t * t) / d;
};
// Column-major rotation matrix from a quaternion (x,y,z,w).
const quatToMat = (x: number, y: number, z: number, w: number): Mat4 => new Float32Array([
  1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
  2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
  2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
  0, 0, 0, 1,
]);
// Rotation for a drag from (p1)→(p2), each normalised to [-1,1] screen space.
const trackballMat = (p1x: number, p1y: number, p2x: number, p2y: number): Mat4 => {
  if (p1x === p2x && p1y === p2y) return quatToMat(0, 0, 0, 1);
  const p1: [number, number, number] = [p1x, p1y, tbProject(p1x, p1y)];
  const p2: [number, number, number] = [p2x, p2y, tbProject(p2x, p2y)];
  // Axis = p1 × p2 (KiCad reads its rot matrix transposed, so this matches the
  // effective direction). Angle = 2·asin(|p1−p2| / 2r).
  const a = [p1[1] * p2[2] - p1[2] * p2[1], p1[2] * p2[0] - p1[0] * p2[2], p1[0] * p2[1] - p1[1] * p2[0]];
  const dx = p1[0] - p2[0], dy = p1[1] - p2[1], dz = p1[2] - p2[2];
  const t = Math.min(1, Math.max(-1, Math.hypot(dx, dy, dz) / (2 * TB)));
  const phi = 2 * Math.asin(t);
  const al = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  const s = Math.sin(phi / 2);
  return quatToMat((a[0]! / al) * s, (a[1]! / al) * s, (a[2]! / al) * s, Math.cos(phi / 2));
};

export interface Viewer3D { dispose: () => void; }

/** Mount the 3D viewer into `container`; returns a disposer. */
export function mount3DViewer(container: HTMLElement, board: Board): Viewer3D | null {
  const scene = buildScene(board);
  if (!scene.bbox) return null;
  const box = edgeBBox(board, scene.bbox);
  const { minX, minY, maxX, maxY } = box;
  const bw = (maxX - minX) / MM; // mm
  const bh = (maxY - minY) / MM;
  const th = (board.thickness ?? 1.6 * MM) / MM;
  const half = Math.max(bw, bh) / 2;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  // KiCad's 3D background is a vertical gradient (board_adapter g_DefaultBackground
  // Top/Bot): light blue-grey at the top → medium blue-grey at the bottom. The
  // canvas clears transparent so this CSS gradient shows through around the board.
  canvas.style.background = 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)';
  container.appendChild(canvas);
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { container.removeChild(canvas); return null; }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // Real geometry (KiCad create_scene.cpp approach): the board outline extruded
  // to thickness, then each layer as its own triangle mesh stacked just off the
  // face — soldermask, copper (faint under the mask), exposed copper (gold), and
  // silkscreen. All triangles → stays sharp at any zoom, no baked texture.
  const hz = th / 2;
  const outline = buildBoardOutline(board, box);
  const geom = buildBoardGeom(board, box);

  // KiCad's exact 3D material colours (board_adapter.cpp defaults). The mask is
  // translucent (alpha 0.83), so the FR4 body + copper show through it — that's
  // the faintly see-through look of the board's centre.
  const C = {
    fr4: [0.40, 0.40, 0.50] as const,     // board body (FR4)
    copper: [0.75, 0.61, 0.23] as const,  // copper (traces, under the mask)
    mask: [0.08, 0.20, 0.14] as const,    // soldermask (translucent)
    gold: [0.85, 0.68, 0.30] as const,    // exposed copper at openings (pads)
    silk: [0.94, 0.94, 0.94] as const,    // silkscreen
  };

  interface Group { verts: number[]; idx: number[]; color: readonly [number, number, number]; alpha: number }
  const mkGroup = (color: readonly [number, number, number], alpha = 1): Group => ({ verts: [], idx: [], color, alpha });
  // A flat mesh placed at height z with a ±Z normal (6 floats/vertex: pos, nrm).
  const addFlat = (g: Group, mesh: Mesh, z: number, nz: number): void => {
    const base = g.verts.length / 6;
    for (const p of mesh.verts) g.verts.push(p.x, p.y, z, 0, 0, nz);
    for (const t of mesh.tris) g.idx.push(base + t);
  };
  const outlineMesh: Mesh = { verts: outline.verts, tris: outline.tris };

  // Stack heights just off each face (mm): FR4 body → copper → mask → pads → silk.
  const zB = hz, zC = hz + 0.03, zM = hz + 0.06, zP = hz + 0.09, zS = hz + 0.12;
  const gWall = mkGroup(C.fr4);
  const gBody = mkGroup(C.fr4);
  const gCopper = mkGroup(C.copper);
  const gMask = mkGroup(C.mask, 0.83);
  const gGold = mkGroup(C.gold);
  const gSilk = mkGroup(C.silk);

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

  // Drilled holes (vias + through-hole pads): a dark cap on each face plus a
  // barrel through the board, so holes read as real drills at any angle.
  const gHole = mkGroup([0.07, 0.07, 0.08]);
  const zH = zP + 0.006; // just above the pads
  for (const h of boardHoles(board, box)) {
    const n = Math.max(10, Math.min(48, Math.round(h.r * 120)));
    for (const s of [1, -1]) {                       // dark cap on each face
      const cz = s > 0 ? zH : -zH;
      const c = gHole.verts.length / 6;
      gHole.verts.push(h.x, h.y, cz, 0, 0, s);
      for (let i = 0; i <= n; i++) { const a = (2 * Math.PI * i) / n; gHole.verts.push(h.x + h.r * Math.cos(a), h.y + h.r * Math.sin(a), cz, 0, 0, s); }
      for (let i = 1; i <= n; i++) { if (s > 0) gHole.idx.push(c, c + i, c + i + 1); else gHole.idx.push(c, c + i + 1, c + i); }
    }
    for (let i = 0; i < n; i++) {                     // barrel wall (inward normals)
      const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
      const x0 = h.x + h.r * Math.cos(a0), y0 = h.y + h.r * Math.sin(a0);
      const x1 = h.x + h.r * Math.cos(a1), y1 = h.y + h.r * Math.sin(a1);
      const b = gHole.verts.length / 6;
      gHole.verts.push(x0, y0, zH, -Math.cos(a0), -Math.sin(a0), 0, x1, y1, zH, -Math.cos(a1), -Math.sin(a1), 0, x1, y1, -zH, -Math.cos(a1), -Math.sin(a1), 0, x0, y0, -zH, -Math.cos(a0), -Math.sin(a0), 0);
      gHole.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  // Extruded FR4 walls along every outline loop (outer boundary + cutouts).
  for (const loop of outline.loops) {
    for (let i = 0; i < loop.length; i++) {
      const p0 = loop[i]!, p1 = loop[(i + 1) % loop.length]!;
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = dy / L, ny = -dx / L;
      const b = gWall.verts.length / 6;
      gWall.verts.push(p0.x, p0.y, hz, nx, ny, 0, p1.x, p1.y, hz, nx, ny, 0, p1.x, p1.y, -hz, nx, ny, 0, p0.x, p0.y, -hz, nx, ny, 0);
      gWall.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  // Opaque layers first, then the translucent mask, then pads/silk/holes on top.
  const groups = [gWall, gBody, gCopper, gMask, gGold, gSilk, gHole];

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aNormal = gl.getAttribLocation(prog, 'aNormal');
  const uMVP = gl.getUniformLocation(prog, 'uMVP');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uColor = gl.getUniformLocation(prog, 'uColor');
  const uAlpha = gl.getUniformLocation(prog, 'uAlpha');
  const uLightDir = gl.getUniformLocation(prog, 'uLightDir');

  // Tessellated boards can exceed 65 k vertices, so use 32-bit indices when the
  // extension is available (falls back to 16-bit on the rare GPU without it).
  const uintOK = !!gl.getExtension('OES_element_index_uint');
  const idxType = uintOK ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  const glGroups = groups.map((g) => {
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.verts), gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, uintOK ? new Uint32Array(g.idx) : new Uint16Array(g.idx), gl.STATIC_DRAW);
    return { vbo, ibo, count: g.idx.length, color: g.color, alpha: g.alpha };
  });

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Blend RGB normally; keep dst alpha maxed so the board stays opaque to the
  // page (only the cleared background shows the CSS gradient), not see-through
  // to the browser behind the translucent mask.
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0); // transparent — the CSS gradient is the background

  // ---- trackball camera: free 360° tumble (no clamp) + pan + zoom ----------
  const rotX = (a: number): Mat4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const rotY = (a: number): Mat4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  let rot = mul(rotX(-0.9), rotY(-0.45)); // open on a tilted top view
  let dist = half * 3.2;
  let panX = 0, panY = 0;
  let mode: 'none' | 'rotate' | 'pan' = 'none';
  let lastX = 0, lastY = 0;

  const render = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const eye = [panX, panY, dist];
    // Tight near/far around the board — a tiny near plane wastes almost all
    // depth precision and makes the thin stacked layers z-fight/flicker. Keep
    // near a healthy fraction of the camera distance (never clips the board,
    // whose nearest point is ~dist - 1.41*half).
    const near = Math.max(dist * 0.1, dist - half * 3);
    const far = dist + half * 5;
    const proj = perspective(Math.PI / 4, w / h, near, far);
    const mvp = mul(mul(proj, lookAt(eye, [panX, panY, 0], [0, 1, 0])), rot);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniformMatrix4fv(uModel, false, rot);
    gl.uniform3f(uLightDir, 0, 0, 1); // camera sits on +Z (a headlight)

    glGroups.forEach((g) => {
      if (g.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 24, 12);
      gl.uniform3f(uColor, g.color[0], g.color[1], g.color[2]);
      gl.uniform1f(uAlpha, g.alpha);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
      gl.drawElements(gl.TRIANGLES, g.count, idxType, 0);
    });
  };

  let raf = 0;
  const requestRender = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  const onDown = (e: PointerEvent): void => {
    mode = e.button === 0 ? 'rotate' : 'pan';
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (mode === 'none') return;
    if (mode === 'rotate') {
      // KiCad trackball: normalise both points to [-1,1] in the canvas, rotate
      // between them, and pre-multiply → grab-and-spin with KiCad's exact feel.
      const r = canvas.getBoundingClientRect();
      const W = r.width || 1, H = r.height || 1;
      const nx = (px: number): number => (2 * (px - r.left) - W) / W;
      const ny = (py: number): number => (H - 2 * (py - r.top)) / H;
      rot = mul(trackballMat(nx(lastX), ny(lastY), nx(e.clientX), ny(e.clientY)), rot);
    } else {
      const k = dist / (canvas.clientHeight || 1);
      panX -= (e.clientX - lastX) * k; panY += (e.clientY - lastY) * k;
    }
    lastX = e.clientX; lastY = e.clientY;
    requestRender();
  };
  const onUp = (e: PointerEvent): void => { mode = 'none'; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    dist = Math.max(half * 0.4, Math.min(half * 14, dist * (e.deltaY < 0 ? 0.9 : 1.1)));
    requestRender();
  };
  const onCtx = (e: Event): void => e.preventDefault(); // right-drag pans; no menu
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onCtx);
  const ro = new ResizeObserver(requestRender);
  ro.observe(canvas);
  requestRender();

  return {
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
  };
}
