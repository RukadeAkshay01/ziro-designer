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

import { buildScene, drawBoard, DEFAULT_DRAW_OPTIONS, type PcbDrawOptions } from './renderBoard.js';
import { buildBoardOutline } from './boardOutline.js';
import type { Board } from '@ziroeda/core';

const MM = 10000;

// Front/back layer sets for the two board faces (the visually dominant layers).
const FRONT_LAYERS = ['Edge.Cuts', 'F.Cu', 'F.Mask', 'F.Paste', 'F.SilkS'];
const BACK_LAYERS = ['Edge.Cuts', 'B.Cu', 'B.Mask', 'B.Paste', 'B.SilkS'];

interface Face { canvas: HTMLCanvasElement; }

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

/** Render one board face to an offscreen texture canvas (top-down ortho). */
function renderFace(board: Board, box: BBox, layers: string[], mirror: boolean, texSize: number): Face | null {
  const scene = buildScene(board);
  const { minX, minY, maxX, maxY } = box;
  const w = maxX - minX;
  const h = maxY - minY;
  const span = Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = texSize;
  canvas.height = texSize;
  const scale = texSize / span;
  // Centre the board in the square texture; mirror X for the back face so the
  // texture reads correctly when the slab is flipped over.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const view = mirror
    ? { scale: -scale, tx: texSize / 2 + cx * scale, ty: texSize / 2 - cy * scale }
    : { scale, tx: texSize / 2 - cx * scale, ty: texSize / 2 - cy * scale };
  const opts: PcbDrawOptions = { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false, zoneOpacity: 1, fpText: false, fpValues: false, fpReferences: false };
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawBoard(ctx, scene, view as { scale: number; tx: number; ty: number }, new Set(layers), texSize, texSize, opts);
  return { canvas };
}

const VERT = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec2 vUV;
varying vec3 vNormal;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vUV = aUV;
  vNormal = mat3(uModel) * aNormal;
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
varying vec3 vNormal;
uniform sampler2D uTex;
uniform int uUseTex;
uniform vec3 uColor;
void main() {
  vec3 base = uUseTex == 1 ? texture2D(uTex, vUV).rgb : uColor;
  // KiCad-style lighting: a camera-ish key light + a fill from below plus a
  // strong hemispheric ambient, so the light background doesn't leave the board
  // looking flat/dark. (render_3d_opengl uses several lights + ambient.)
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(0.35, 0.5, 1.0))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.3, -0.4, -0.6))), 0.0);
  float amb = 0.62;
  gl_FragColor = vec4(base * (amb + 0.5 * key + 0.14 * fill), 1.0);
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

  const front = renderFace(board, box, FRONT_LAYERS, false, 1024);
  const back = renderFace(board, box, BACK_LAYERS, true, 1024);
  if (!front || !back) return null;

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

  // Real board geometry: the Edge.Cuts outline (with cutouts) extruded to the
  // board thickness, instead of a bounding-box slab. Top(+Z)/bottom(−Z) faces
  // carry the artwork textures; the extruded walls are FR4. UVs map board XY
  // into the square face texture (board centred, span = max(bw,bh)). Y was
  // already flipped into the centred 3D frame by buildBoardOutline.
  const hz = th / 2;
  const span = Math.max(bw, bh);
  const uvU = (x: number): number => 0.5 + x / span;
  const uvV = (y: number): number => 0.5 - y / span;
  const outline = buildBoardOutline(board, box);

  interface Group { verts: number[]; idx: number[]; tex: 'front' | 'back' | null }
  const gFront: Group = { verts: [], idx: [], tex: 'front' };
  const gBack: Group = { verts: [], idx: [], tex: 'back' };
  const gSide: Group = { verts: [], idx: [], tex: null };
  const push = (g: Group, x: number, y: number, z: number, u: number, v: number, nx: number, ny: number, nz: number): number => {
    const i = g.verts.length / 8;
    g.verts.push(x, y, z, u, v, nx, ny, nz);
    return i;
  };
  // Triangulated top + bottom faces (front/back artwork).
  for (const p of outline.verts) push(gFront, p.x, p.y, hz, uvU(p.x), uvV(p.y), 0, 0, 1);
  gFront.idx = outline.tris.slice();
  for (const p of outline.verts) push(gBack, p.x, p.y, -hz, uvU(p.x), uvV(p.y), 0, 0, -1);
  gBack.idx = outline.tris.slice();
  // Extruded FR4 walls along every loop edge (outer boundary + cutouts).
  for (const loop of outline.loops) {
    for (let i = 0; i < loop.length; i++) {
      const p0 = loop[i]!;
      const p1 = loop[(i + 1) % loop.length]!;
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = dy / L, ny = -dx / L; // horizontal wall normal
      const a = push(gSide, p0.x, p0.y, hz, 0, 0, nx, ny, 0);
      const b = push(gSide, p1.x, p1.y, hz, 0, 0, nx, ny, 0);
      const c = push(gSide, p1.x, p1.y, -hz, 0, 0, nx, ny, 0);
      const d = push(gSide, p0.x, p0.y, -hz, 0, 0, nx, ny, 0);
      gSide.idx.push(a, b, c, a, c, d);
    }
  }
  const groups = [gFront, gBack, gSide];

  const mkTex = (img: HTMLCanvasElement): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  };
  const frontTex = mkTex(front.canvas);
  const backTex = mkTex(back.canvas);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUV = gl.getAttribLocation(prog, 'aUV');
  const aNormal = gl.getAttribLocation(prog, 'aNormal');
  const uMVP = gl.getUniformLocation(prog, 'uMVP');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uTex = gl.getUniformLocation(prog, 'uTex');
  const uUseTex = gl.getUniformLocation(prog, 'uUseTex');
  const uColor = gl.getUniformLocation(prog, 'uColor');

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
    return { vbo, ibo, count: g.idx.length, tex: g.tex };
  });

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0); // transparent — the CSS gradient is the background

  // orbit state. Default to KiCad's opening view: looking down onto the top
  // (component) side, tilted so the board thickness/edges read as 3D.
  let yaw = -0.5, pitch = 0.5, dist = half * 3.2;
  let dragging = false, lastX = 0, lastY = 0;

  const render = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const eye = [
      dist * Math.cos(pitch) * Math.sin(yaw),
      dist * Math.sin(pitch),
      dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const proj = perspective(Math.PI / 4, w / h, 0.1, dist * 10 + 100);
    const model = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const mvp = mul(proj, lookAt(eye, [0, 0, 0], [0, 1, 0]));
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniformMatrix4fv(uModel, false, model);

    glGroups.forEach((g) => {
      if (g.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(aUV);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 32, 20);
      if (g.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, g.tex === 'front' ? frontTex : backTex);
        gl.uniform1i(uTex, 0);
        gl.uniform1i(uUseTex, 1);
      } else {
        gl.uniform1i(uUseTex, 0);
        gl.uniform3f(uColor, 0.4, 0.4, 0.5); // FR4 body (KiCad m_BoardBodyColor)
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
      gl.drawElements(gl.TRIANGLES, g.count, idxType, 0);
    });
  };

  let raf = 0;
  const requestRender = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  const onDown = (e: PointerEvent): void => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.01;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - (e.clientY - lastY) * 0.01));
    lastX = e.clientX; lastY = e.clientY;
    requestRender();
  };
  const onUp = (): void => { dragging = false; };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    dist = Math.max(half * 0.6, Math.min(half * 12, dist * (e.deltaY < 0 ? 0.9 : 1.1)));
    requestRender();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
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
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
  };
}
