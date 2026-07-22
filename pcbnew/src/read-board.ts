/**
 * Reader: S-expression AST -> typed Board model.
 *
 * The faithful counterpart to KiCad's `PCB_IO_KICAD_SEXPR_PARSER`
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr_parser.cpp). Semantics ported
 * for pre-affine-transform files (version < FIRST_FP_AFFINE_TRANSFORM =
 * 20260616, i.e. every KiCad 9 and earlier board):
 *  - footprint children store FP-relative positions; board coords are
 *    `fpPos + RotatePoint(local, fpAngle)` (parser's RebakeFromLib /
 *    SetFPRelativePosition path);
 *  - pad and fp-text angles in the file are board-frame ABSOLUTE
 *    (parsePAD: "The pad angle in the file is a board frame absolute value");
 *  - RotatePoint (libs/kimath/src/trigo.cpp): x' = x·cos + y·sin,
 *    y' = y·cos − x·sin.
 */

import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  arg,
  args,
  childNamed,
  childrenNamed,
  numArg,
  stringField,
  numberField,
} from '@ziroeda/sexpr/src/query.js';
import type {
  Board,
  Model3D,
  PadPrimitive,
  PadShape,
  PadType,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbZoneFill,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const ptAt = (node: SList | undefined, from = 0): Vec2 | undefined => {
  if (!node) return undefined;
  const x = numArg(node, from);
  const y = numArg(node, from + 1);
  if (x === undefined || y === undefined) return undefined;
  return { x: mmToIU(x), y: mmToIU(y) };
};

/** KiCad RotatePoint (trigo.cpp): screen coords, angle in degrees. */
export function rotatePcb(p: Vec2, angleDeg: number): Vec2 {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const x = Math.round(p.y * s + p.x * c);
  const y = Math.round(p.y * c - p.x * s);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

interface FpTransform {
  pos: Vec2;
  angle: number;
}

/** Footprint-child position -> board coords (legacy RebakeFromLib path). */
const toBoard = (local: Vec2, t: FpTransform | null): Vec2 => {
  if (!t) return local;
  const r = rotatePcb(local, t.angle);
  return { x: r.x + t.pos.x, y: r.y + t.pos.y };
};

const layerOf = (node: SList): string => {
  const l = childNamed(node, 'layer');
  return l ? (arg(l, 0) ?? '') : '';
};

const uuidOf = (node: SList): string | undefined =>
  stringField(node, 'uuid') ?? stringField(node, 'tstamp');

/** `(pts (xy …) (arc (start)(mid)(end)) …)` -> polyline, arcs tessellated. */
function readPts(pts: SList | undefined, t: FpTransform | null): Vec2[] {
  const out: Vec2[] = [];
  if (!pts) return out;
  for (const item of pts.items) {
    if (!isList(item)) continue;
    const h = head(item);
    if (h === 'xy') {
      const p = ptAt(item);
      if (p) out.push(toBoard(p, t));
    } else if (h === 'arc') {
      const start = ptAt(childNamed(item, 'start'));
      const mid = ptAt(childNamed(item, 'mid'));
      const end = ptAt(childNamed(item, 'end'));
      if (start && mid && end) {
        for (const p of tessellateArc(start, mid, end)) out.push(toBoard(p, t));
      }
    }
  }
  return out;
}

/** Sample a 3-point arc into a polyline (~5° steps), endpoints exact. */
export function tessellateArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const c = arcCenter(start, mid, end);
  if (!c) return [start, mid, end];
  const r = Math.hypot(start.x - c.x, start.y - c.y);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  // Sweep from a0 through am to a1: pick the direction that passes mid.
  const ccwSweep = (from: number, to: number): number => {
    let d = to - from;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const sweepCCW = ccwSweep(a0, a1);
  const midCCW = ccwSweep(a0, am);
  const useCCW = midCCW <= sweepCCW;
  const sweep = useCCW ? sweepCCW : sweepCCW - Math.PI * 2;
  const steps = Math.max(2, Math.min(96, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push({ x: Math.round(c.x + r * Math.cos(a)), y: Math.round(c.y + r * Math.sin(a)) });
  }
  pts[0] = start;
  pts[pts.length - 1] = end;
  return pts;
}

/** Circumcentre of three points, or null when collinear. */
export function arcCenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

function readTextEffects(item: SList): {
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  mirror?: boolean;
  justify?: string[];
} {
  const effects = childNamed(item, 'effects');
  const font = effects ? childNamed(effects, 'font') : undefined;
  const sizeNode = font ? childNamed(font, 'size') : undefined;
  const size = ptAt(sizeNode) ?? { x: mmToIU(1.27), y: mmToIU(1.27) };
  const thicknessMM = font ? numberField(font, 'thickness') : undefined;
  const justifyNode = effects ? childNamed(effects, 'justify') : undefined;
  const justify = justifyNode ? args(justifyNode) : undefined;
  return {
    // (size h w): height first — match the schematic reader convention of {x: w, y: h}.
    size: { x: size.y, y: size.x },
    thickness: thicknessMM !== undefined ? mmToIU(thicknessMM) : undefined,
    bold: font ? stringField(font, 'bold') === 'yes' : undefined,
    italic: font ? stringField(font, 'italic') === 'yes' : undefined,
    mirror: justify?.includes('mirror'),
    justify,
  };
}

function readPcbText(
  item: SList,
  kind: PcbTextItem['kind'],
  text: string,
  t: FpTransform | null,
): PcbTextItem | null {
  const at = childNamed(item, 'at');
  const pos = ptAt(at);
  if (!pos) return null;
  const angle = at ? (numArg(at, 2) ?? 0) : 0;
  const fx = readTextEffects(item);
  const hideNode = childNamed(item, 'hide');
  // Footprint text (t != null) keeps upright unless it carries `unlocked`
  // (either positional after the angle in `at`, or a child `(unlocked yes)`).
  const unlockedNode = childNamed(item, 'unlocked');
  const unlocked =
    (at ? args(at).includes('unlocked') : false) ||
    (unlockedNode ? arg(unlockedNode, 0) !== 'no' : false);
  return {
    kind,
    text,
    at: toBoard(pos, t),
    angle,
    layer: layerOf(item),
    size: fx.size,
    thickness: fx.thickness,
    bold: fx.bold,
    italic: fx.italic,
    mirror: fx.mirror,
    justify: fx.justify,
    keepUpright: t !== null && !unlocked,
    hide: hideNode ? arg(hideNode, 0) !== 'no' : false,
    knockout: childNamed(item, 'layer')
      ? args(childNamed(item, 'layer')!).includes('knockout')
      : false,
    uuid: uuidOf(item),
    source: item,
  };
}

function readShape(item: SList, t: FpTransform | null): PcbShape | null {
  const h = head(item) ?? '';
  const kind = h.replace(/^(gr_|fp_)/, '');
  if (!['line', 'arc', 'circle', 'rect', 'poly', 'curve'].includes(kind)) return null;
  const fillNode = childNamed(item, 'fill');
  const fillVal = fillNode ? arg(fillNode, 0) : undefined;
  const s: PcbShape = {
    kind: kind as PcbShape['kind'],
    width: mmToIU(strokeWidth(item)),
    fill: fillVal === 'yes' || fillVal === 'solid',
    layer: layerOf(item),
    uuid: uuidOf(item),
    source: item,
  };
  const start = ptAt(childNamed(item, 'start')) ?? ptAt(childNamed(item, 'center'));
  const end = ptAt(childNamed(item, 'end'));
  const mid = ptAt(childNamed(item, 'mid'));
  if (kind === 'circle') {
    const c = ptAt(childNamed(item, 'center'));
    if (c) s.center = toBoard(c, t);
    if (end) s.end = toBoard(end, t);
  } else {
    if (start) s.start = toBoard(start, t);
    if (end) s.end = toBoard(end, t);
    if (mid) s.mid = toBoard(mid, t);
  }
  if (kind === 'poly' || kind === 'curve') s.pts = readPts(childNamed(item, 'pts'), t);
  return s;
}

const strokeWidth = (item: SList): number => {
  const stroke = childNamed(item, 'stroke');
  if (stroke) return numberField(stroke, 'width') ?? 0;
  return numberField(item, 'width') ?? 0;
};

function readPad(item: SList, t: FpTransform | null): PcbPad | null {
  const positional = args(item);
  const number = positional[0] ?? '';
  const type = (positional[1] ?? 'smd') as PadType;
  const shape = (positional[2] ?? 'circle') as PadShape;
  const at = childNamed(item, 'at');
  const pos = ptAt(at);
  if (!pos) return null;
  const size = ptAt(childNamed(item, 'size')) ?? { x: 0, y: 0 };
  const layersNode = childNamed(item, 'layers');
  const drillNode = childNamed(item, 'drill');
  let drill: PcbPad['drill'];
  if (drillNode) {
    const nums = args(drillNode)
      .filter((a) => a !== 'oval')
      .map(Number);
    const w = mmToIU(nums[0] ?? 0);
    drill = {
      oblong: args(drillNode).includes('oval'),
      w,
      h: nums[1] !== undefined ? mmToIU(nums[1]) : w,
      offset: ptAt(childNamed(drillNode, 'offset')),
    };
  } else if (type === 'thru_hole' || type === 'np_thru_hole') {
    // parsePAD: a missing drill token on a through pad means a 1 nm hole.
    drill = { oblong: false, w: 1, h: 1 };
  }
  const primsNode = childNamed(item, 'primitives');
  const primitives: PadPrimitive[] = [];
  if (primsNode) {
    for (const p of primsNode.items) {
      if (!isList(p)) continue;
      const ph = head(p) ?? '';
      if (!['gr_poly', 'gr_line', 'gr_circle', 'gr_arc', 'gr_rect'].includes(ph)) continue;
      const fillNode = childNamed(p, 'fill');
      const fillVal = fillNode ? arg(fillNode, 0) : undefined;
      primitives.push({
        kind: ph as PadPrimitive['kind'],
        pts: childNamed(p, 'pts') ? readPts(childNamed(p, 'pts'), null) : undefined,
        start: ptAt(childNamed(p, 'start')),
        mid: ptAt(childNamed(p, 'mid')),
        end: ptAt(childNamed(p, 'end')),
        center: ptAt(childNamed(p, 'center')),
        width: mmToIU(strokeWidth(p)),
        fill: fillVal === 'yes' || fillVal === 'solid',
      });
    }
  }
  const chamferNode = childNamed(item, 'chamfer');
  return {
    number,
    type,
    shape,
    at: toBoard(pos, t),
    angle: at ? (numArg(at, 2) ?? 0) : 0,
    size,
    drill,
    layers: layersNode ? args(layersNode) : [],
    roundrectRatio: numberField(item, 'roundrect_rratio'),
    chamferRatio: numberField(item, 'chamfer_ratio'),
    chamfer: chamferNode ? args(chamferNode) : undefined,
    delta: ptAt(childNamed(item, 'rect_delta')),
    net: childNamed(item, 'net') ? numArg(childNamed(item, 'net')!, 0) : undefined,
    pinFunction: childNamed(item, 'pinfunction')
      ? arg(childNamed(item, 'pinfunction')!, 0)
      : undefined,
    pinType: childNamed(item, 'pintype') ? arg(childNamed(item, 'pintype')!, 0) : undefined,
    primitives: primitives.length > 0 ? primitives : undefined,
    uuid: uuidOf(item),
    source: item,
  };
}

/**
 * Read a standalone `.kicad_mod` file (a top-level `(footprint …)` node) into a
 * footprint in its own LOCAL frame — the form the Footprint Editor works in.
 * A library footprint carries no board placement, so children keep their stored
 * (footprint-relative) coordinates: no transform is baked in and the anchor sits
 * at the origin. This is the library-cache load path of KiCad's
 * `PCB_IO_KICAD_SEXPR_PARSER::parseFOOTPRINT` (the footprint is not re-based onto
 * a board), as opposed to `readFootprint`, which bakes children to board coords.
 */
export function readFootprintFile(root: SList): PcbFootprint | null {
  const h = head(root);
  if (h !== 'footprint' && h !== 'module') return null;
  return readFootprint(root, true);
}

function readFootprint(item: SList, local = false): PcbFootprint | null {
  const lib = arg(item, 0) ?? '';
  const at = childNamed(item, 'at');
  const pos = ptAt(at) ?? (local ? { x: 0, y: 0 } : undefined);
  if (!pos) return null;
  const angle = local ? 0 : at ? (numArg(at, 2) ?? 0) : 0;
  // On a board, children are baked to board coords through the placement
  // transform (legacy RebakeFromLib); a library footprint keeps local coords.
  const t: FpTransform | null = local ? null : { pos, angle };
  const attrNode = childNamed(item, 'attr');
  const lockedNode = childNamed(item, 'locked');
  const fp: PcbFootprint = {
    lib,
    at: pos,
    angle,
    layer: layerOf(item),
    descr: stringField(item, 'descr'),
    tags: stringField(item, 'tags'),
    attributes: attrNode ? args(attrNode) : undefined,
    locked: lockedNode ? arg(lockedNode, 0) !== 'no' : false,
    pads: [],
    shapes: [],
    texts: [],
    models: [],
    uuid: uuidOf(item),
    source: item,
  };
  for (const child of item.items) {
    if (!isList(child)) continue;
    const h = head(child) ?? '';
    if (h === 'pad') {
      const pad = readPad(child, t);
      if (pad) fp.pads.push(pad);
    } else if (h === 'model') {
      const m = readModel(child);
      if (m) fp.models.push(m);
    } else if (h.startsWith('fp_') && h !== 'fp_text' && h !== 'fp_text_box') {
      const s = readShape(child, t);
      if (s) fp.shapes.push(s);
    } else if (h === 'fp_text') {
      const kindArg = arg(child, 0);
      const kind = kindArg === 'reference' ? 'reference' : kindArg === 'value' ? 'value' : 'user';
      const text = arg(child, 1) ?? '';
      const tx = readPcbText(child, kind, text, t);
      if (tx) fp.texts.push(tx);
      if (kind === 'reference') fp.reference = text;
      if (kind === 'value') fp.value = text;
    } else if (h === 'property') {
      // KiCad 8+: Reference/Value are footprint properties with text semantics.
      const key = arg(child, 0);
      const value = arg(child, 1) ?? '';
      if (key === 'Reference' || key === 'Value') {
        const tx = readPcbText(child, key === 'Reference' ? 'reference' : 'value', value, t);
        if (tx) fp.texts.push(tx);
        if (key === 'Reference') fp.reference = value;
        else fp.value = value;
      }
    }
  }
  // KiCad resolves text variables when rendering; ${REFERENCE}/${VALUE} are
  // by far the common ones on Fab layers.
  for (const tx of fp.texts) {
    if (tx.text.includes('${')) {
      tx.text = tx.text
        .replaceAll('${REFERENCE}', fp.reference ?? '')
        .replaceAll('${VALUE}', fp.value ?? '');
    }
  }
  return fp;
}

// A footprint's `(model …)` 3D reference (PCB_IO_KICAD_SEXPR_PARSER::parse3DModel).
// Offset/scale/rotate stay in the file's native units (mm, unitless, degrees) —
// the 3D viewer applies KiCad's transform. The legacy `(at (xyz …))` variant is
// in *inches*: upstream multiplies it by 25.4 into mm.
function readModel(item: SList): Model3D | null {
  const path = arg(item, 0);
  if (!path) return null;
  const xyzOf = (
    node: SList | undefined,
    def: number,
    mul = 1,
  ): { x: number; y: number; z: number } => {
    const inner = node ? childNamed(node, 'xyz') : undefined;
    return {
      x: inner ? (numArg(inner, 0) ?? def) * mul : def,
      y: inner ? (numArg(inner, 1) ?? def) * mul : def,
      z: inner ? (numArg(inner, 2) ?? def) * mul : def,
    };
  };
  const hideNode = childNamed(item, 'hide');
  const offsetNode = childNamed(item, 'offset');
  const opacityNode = childNamed(item, 'opacity');
  const opacity = opacityNode ? numArg(opacityNode, 0) : undefined;
  return {
    path,
    offset: offsetNode ? xyzOf(offsetNode, 0) : xyzOf(childNamed(item, 'at'), 0, 25.4), // legacy `at` is in inches
    scale: xyzOf(childNamed(item, 'scale'), 1),
    rotate: xyzOf(childNamed(item, 'rotate'), 0),
    hide: hideNode ? arg(hideNode, 0) !== 'no' : false,
    ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
  };
}

function readZone(item: SList): PcbZone {
  const netNode = childNamed(item, 'net');
  const layersNode = childNamed(item, 'layers');
  const layerNode = childNamed(item, 'layer');
  const layers = layersNode ? args(layersNode) : layerNode ? [arg(layerNode, 0) ?? ''] : [];
  const fills: PcbZoneFill[] = [];
  for (const fp of childrenNamed(item, 'filled_polygon')) {
    const layer = stringField(fp, 'layer') ?? layers[0] ?? '';
    const pts = readPts(childNamed(fp, 'pts'), null);
    if (pts.length < 3) continue;
    const existing = fills.find((f) => f.layer === layer);
    if (existing) existing.polys.push(pts);
    else fills.push({ layer, polys: [pts] });
  }
  // The zone boundary `(polygon (pts …))` — drawn as the border, and larger
  // than the (clearance-inset) fill.
  const polyNode = childNamed(item, 'polygon');
  const outline = polyNode ? readPts(childNamed(polyNode, 'pts'), null) : [];
  // `(hatch <style> <pitch>)` — border display style + hatch pitch (mm).
  const hatchNode = childNamed(item, 'hatch');
  const hatchWord = hatchNode ? arg(hatchNode, 0) : undefined;
  const hatchStyle: PcbZone['hatchStyle'] =
    hatchWord === 'none' ? 'none' : hatchWord === 'full' ? 'full' : hatchWord ? 'edge' : undefined;
  const hatchPitch = hatchNode ? mmToIU(Number(arg(hatchNode, 1) ?? 0)) : 0;
  return {
    net: netNode ? (numArg(netNode, 0) ?? 0) : 0,
    netName: stringField(item, 'net_name'),
    layers,
    fills,
    outline: outline.length >= 3 ? outline : undefined,
    hatchStyle,
    hatchPitch,
    uuid: uuidOf(item),
    source: item,
  };
}

/** Read a parsed `.kicad_pcb` document into the typed Board model. */
export function readBoard(root: SList): Board {
  if (head(root) !== 'kicad_pcb') throw new Error('not a kicad_pcb document');
  const board: Board = {
    version: numberField(root, 'version') ?? 0,
    paper: stringField(root, 'paper'),
    titleBlock: (() => {
      const tb = childNamed(root, 'title_block');
      if (!tb) return undefined;
      return {
        title: stringField(tb, 'title'),
        date: stringField(tb, 'date'),
        rev: stringField(tb, 'rev'),
        company: stringField(tb, 'company'),
      };
    })(),
    layers: [],
    nets: new Map(),
    footprints: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    source: root,
  };
  const general = childNamed(root, 'general');
  if (general) {
    const th = numberField(general, 'thickness');
    if (th !== undefined) board.thickness = mmToIU(th);
  }
  const layersNode = childNamed(root, 'layers');
  if (layersNode) {
    for (const l of layersNode.items) {
      if (!isList(l)) continue;
      const id = Number(head(l));
      const rest = args(l);
      if (!Number.isFinite(id)) continue;
      board.layers.push({ id, name: rest[0] ?? '', kind: rest[1] ?? 'user', userName: rest[2] });
    }
  }
  for (const item of root.items) {
    if (!isList(item)) continue;
    switch (head(item)) {
      case 'net': {
        const code = numArg(item, 0);
        if (code !== undefined) board.nets.set(code, arg(item, 1) ?? '');
        break;
      }
      case 'footprint':
      case 'module': {
        const fp = readFootprint(item);
        if (fp) board.footprints.push(fp);
        break;
      }
      case 'segment': {
        const start = ptAt(childNamed(item, 'start'));
        const end = ptAt(childNamed(item, 'end'));
        if (start && end) {
          board.tracks.push({
            start,
            end,
            width: mmToIU(numberField(item, 'width') ?? 0),
            layer: layerOf(item),
            net: numberField(item, 'net') ?? 0,
            uuid: uuidOf(item),
            source: item,
          });
        }
        break;
      }
      case 'arc': {
        const start = ptAt(childNamed(item, 'start'));
        const mid = ptAt(childNamed(item, 'mid'));
        const end = ptAt(childNamed(item, 'end'));
        if (start && mid && end) {
          board.arcs.push({
            start,
            mid,
            end,
            width: mmToIU(numberField(item, 'width') ?? 0),
            layer: layerOf(item),
            net: numberField(item, 'net') ?? 0,
            uuid: uuidOf(item),
            source: item,
          });
        }
        break;
      }
      case 'via': {
        const at = ptAt(childNamed(item, 'at'));
        if (!at) break;
        const layersN = childNamed(item, 'layers');
        const ls = layersN ? args(layersN) : ['F.Cu', 'B.Cu'];
        const positional = args(item);
        board.vias.push({
          at,
          size: mmToIU(numberField(item, 'size') ?? 0),
          drill: mmToIU(numberField(item, 'drill') ?? 0),
          layers: [ls[0] ?? 'F.Cu', ls[1] ?? 'B.Cu'],
          kind: positional.includes('micro')
            ? 'micro'
            : positional.includes('blind')
              ? 'blind'
              : 'through',
          net: numberField(item, 'net') ?? 0,
          uuid: uuidOf(item),
          source: item,
        });
        break;
      }
      case 'zone':
        board.zones.push(readZone(item));
        break;
      case 'gr_line':
      case 'gr_arc':
      case 'gr_circle':
      case 'gr_rect':
      case 'gr_poly':
      case 'gr_curve': {
        const s = readShape(item, null);
        if (s) board.shapes.push(s);
        break;
      }
      case 'gr_text': {
        const tx = readPcbText(item, 'user', arg(item, 0) ?? '', null);
        if (tx) board.texts.push(tx);
        break;
      }
      default:
        break;
    }
  }
  return board;
}
