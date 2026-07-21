/**
 * The RS-274X / RS-274D interpreter, mirroring the parsing half of
 * `gerbview/gerber_file_image.cpp`, `gerbview/rs274x.cpp` and
 * `gerbview/rs274d.cpp`. `parseGerber(text, name)` reads a Gerber file into a
 * GERBER_FILE_IMAGE: it handles the `%…%` extended directives (FS, MO, AD, AM,
 * LP/LM/LR/LS, SR, AB, IP, IR, MI, OF, SF, AS, TF/TA/TO/TD, IN, LN) and the
 * D-code graphic commands (G01/2/3, G36/37, G74/75, D01/D02/D03), producing
 * segments, arcs, filled regions and flashed apertures in absolute IU.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { APERTURE_T, GBR_BASIC_SHAPE, GERB_INTERPOL } from './types.js';
import { APERTURE_DEF_HOLE } from './dcode.js';
import { ApertureMacro, AMP, type AmPrimitive } from './aperture_macro.js';
import {
  GERBER_DRAW_ITEM,
  type ApertureTransform,
  type GbrNetMetadata,
} from './gerber_draw_item.js';
import { GERBER_FILE_IMAGE } from './gerber_file_image.js';

/** Live pen/graphic state while interpreting D-code commands. */
interface GraphicState {
  interpol: GERB_INTERPOL;
  multiQuadrant: boolean; // G75 (true) vs G74 single-quadrant (false)
  regionActive: boolean; // between G36 and G37
  currentAperture: number; // selected D-code (>=10)
  pos: Vec2; // current pen position, file units
  polarity: boolean; // LP: true = dark, false = clear
  apTransform: ApertureTransform;
  netMeta: GbrNetMetadata;
}

export function parseGerber(text: string, fileName: string): GERBER_FILE_IMAGE {
  const img = new GERBER_FILE_IMAGE();
  img.fileName = fileName;
  img.rawText = text;

  const state: GraphicState = {
    interpol: GERB_INTERPOL.LINEAR_1X,
    multiQuadrant: false,
    regionActive: false,
    currentAperture: 0,
    pos: { x: 0, y: 0 },
    polarity: true,
    apTransform: { mirror: 'N', rotation: 0, scale: 1 },
    netMeta: {},
  };

  // Accumulator for the polygon being built between G36 and G37.
  let regionPoints: Vec2[] = [];
  // Step & repeat: while active, new items are captured to replay on close.
  let srActive = false;
  let srParams = { xRepeat: 1, yRepeat: 1, xStep: 0, yStep: 0 };
  let srStartIndex = 0;
  // Aperture block (AB): capture items into a block instead of the image.
  const blockStack: { dcode: number; items: GERBER_DRAW_ITEM[] }[] = [];
  const blockItems = new Map<number, GERBER_DRAW_ITEM[]>();

  /** Add a finished item to the current sink (block or image). */
  const emit = (item: GERBER_DRAW_ITEM): void => {
    item.layerPolarity = state.polarity;
    item.apTransform = { ...state.apTransform };
    item.netMetadata = { ...state.netMeta };
    if (blockStack.length > 0) blockStack[blockStack.length - 1]!.items.push(item);
    else img.items.push(item);
  };

  // --- coordinate conversion ---------------------------------------------
  const decodeCoord = (raw: string, intDigits: number, fracDigits: number): number => {
    let s = raw.trim();
    let sign = 1;
    if (s.startsWith('+')) s = s.slice(1);
    else if (s.startsWith('-')) {
      sign = -1;
      s = s.slice(1);
    }
    if (s.includes('.')) {
      // Explicit decimal point — value is already in file units.
      return sign * parseFloat(s);
    }
    const total = intDigits + fracDigits;
    if (img.coordFormat.leadingZerosOmitted) {
      s = s.padStart(total, '0');
    } else {
      s = s.padEnd(total, '0');
    }
    const intPart = s.slice(0, s.length - fracDigits) || '0';
    const fracPart = fracDigits > 0 ? s.slice(s.length - fracDigits) : '';
    const value = parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
    return sign * value;
  };

  /** File-unit point → absolute IU, applying image transforms. */
  const toIU = (p: Vec2): Vec2 => {
    let x = p.x;
    let y = p.y;
    if (img.swapAxis) [x, y] = [y, x];
    x = x * img.scaleFactor.x + img.offset.x;
    y = y * img.scaleFactor.y + img.offset.y;
    if (img.mirror.x) x = -x;
    if (img.mirror.y) y = -y;
    // Image rotation (IR) about origin.
    if (img.imageRotation) {
      const a = (img.imageRotation * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      [x, y] = [x * c - y * s, x * s + y * c];
    }
    return { x: x * img.iuScale, y: y * img.iuScale };
  };

  const iuLen = (v: number): number => v * img.iuScale;

  // --- flashing / drawing -------------------------------------------------
  const flashAperture = (at: Vec2): void => {
    const d = img.getDcode(state.currentAperture);
    // Aperture-block flash: replay the block's items translated to `at`.
    if (blockItems.has(state.currentAperture)) {
      const iuAt = toIU(at);
      for (const proto of blockItems.get(state.currentAperture)!) {
        const clone = cloneItemTranslated(proto, iuAt.x, iuAt.y);
        clone.layerPolarity = state.polarity;
        if (blockStack.length > 0) blockStack[blockStack.length - 1]!.items.push(clone);
        else img.items.push(clone);
      }
      return;
    }
    if (!d) return;
    const item = new GERBER_DRAW_ITEM();
    item.start = toIU(at);
    item.end = item.start;
    item.dcode = d;
    item.dcodeNum = state.currentAperture;
    switch (d.shape) {
      case APERTURE_T.APT_CIRCLE:
        item.shape = GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE;
        break;
      case APERTURE_T.APT_RECT:
        item.shape = GBR_BASIC_SHAPE.GBR_SPOT_RECT;
        break;
      case APERTURE_T.APT_OVAL:
        item.shape = GBR_BASIC_SHAPE.GBR_SPOT_OVAL;
        break;
      case APERTURE_T.APT_POLYGON:
        item.shape = GBR_BASIC_SHAPE.GBR_SPOT_POLY;
        break;
      default:
        item.shape = GBR_BASIC_SHAPE.GBR_SPOT_MACRO;
        break;
    }
    emit(item);
  };

  const drawSegmentOrArc = (to: Vec2): void => {
    const d = img.getDcode(state.currentAperture);
    const width = d ? iuLen(d.size.x) : 0;
    if (state.interpol === GERB_INTERPOL.LINEAR_1X) {
      if (state.regionActive) {
        regionPoints.push(toIU(to));
      } else {
        const item = new GERBER_DRAW_ITEM();
        item.shape = GBR_BASIC_SHAPE.GBR_SEGMENT;
        item.start = toIU(state.pos);
        item.end = toIU(to);
        item.width = width;
        item.dcode = d ?? null;
        item.dcodeNum = state.currentAperture;
        emit(item);
      }
    } else {
      // Arc: centre is given by I/J offsets from the current point.
      drawArc(state.pos, to, width, d);
    }
  };

  // I/J offsets captured for the current arc command.
  let arcIJ: { i: number; j: number } | null = null;

  const drawArc = (
    from: Vec2,
    to: Vec2,
    width: number,
    d: ReturnType<typeof img.getDcode>,
  ): void => {
    const ij = arcIJ ?? { i: 0, j: 0 };
    let centre: Vec2;
    if (state.multiQuadrant) {
      centre = { x: from.x + ij.i, y: from.y + ij.j };
    } else {
      // Single-quadrant: signs of I/J are unknown; pick the combination whose
      // radius to start and end match best (KiCad's approach).
      const candidates: Vec2[] = [
        { x: from.x + ij.i, y: from.y + ij.j },
        { x: from.x - ij.i, y: from.y + ij.j },
        { x: from.x + ij.i, y: from.y - ij.j },
        { x: from.x - ij.i, y: from.y - ij.j },
      ];
      let best = candidates[0]!;
      let bestErr = Infinity;
      for (const c of candidates) {
        const r1 = Math.hypot(from.x - c.x, from.y - c.y);
        const r2 = Math.hypot(to.x - c.x, to.y - c.y);
        const err = Math.abs(r1 - r2);
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
      centre = best;
    }
    if (state.regionActive) {
      // Approximate the arc with segments appended to the region contour.
      for (const p of arcPolyline(from, to, centre, state.interpol)) regionPoints.push(toIU(p));
      return;
    }
    const item = new GERBER_DRAW_ITEM();
    item.shape = GBR_BASIC_SHAPE.GBR_ARC;
    item.start = toIU(from);
    item.end = toIU(to);
    item.arcCentre = toIU(centre);
    item.width = width;
    item.dcode = d ?? null;
    item.dcodeNum = state.currentAperture;
    // Preserve arc direction for the renderer.
    item.arcCcw = state.interpol === GERB_INTERPOL.ARC_G03_CCW;
    emit(item);
  };

  // --- tokeniser: split into extended blocks (%..%) and word commands -----
  // Normalise line endings, then walk char by char.
  const src = text;
  let i = 0;
  const n = src.length;

  const readUntil = (stop: string): string => {
    let out = '';
    while (i < n && src[i] !== stop) out += src[i++]!;
    return out;
  };

  while (i < n) {
    const ch = src[i]!;
    if (ch === '%') {
      i++; // consume %
      const block = readUntil('%');
      i++; // consume closing %
      handleExtended(block);
    } else if (ch === '*') {
      i++;
    } else if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      i++;
    } else {
      // A word command up to the next '*'.
      const word = readUntil('*');
      if (i < n) i++; // consume '*'
      handleWord(word.trim());
    }
  }

  // Close any dangling region.
  if (regionPoints.length >= 3) finishRegion();

  return img;

  // ----- extended (%) directive handling --------------------------------
  function handleExtended(block: string): void {
    // A block may contain several commands separated by '*'.
    const parts = block.split('*').map((s) => s.trim());
    // AM (macro) needs the raw multi-line body; detect and handle specially.
    if (parts[0]?.startsWith('AM')) {
      handleApertureMacro(parts);
      return;
    }
    for (const cmd of parts) {
      if (cmd.length === 0) continue;
      handleParam(cmd);
    }
  }

  function handleParam(cmd: string): void {
    const code = cmd.slice(0, 2);
    const rest = cmd.slice(2);
    switch (code) {
      case 'FS':
        parseFS(rest);
        break;
      case 'MO':
        img.setUnit(rest.startsWith('MM') ? 'mm' : 'in');
        break;
      case 'AD':
        parseAD(rest);
        break;
      case 'LP':
        state.polarity = rest.trim().toUpperCase().startsWith('D');
        break;
      case 'LM': {
        const m = rest.trim().toUpperCase();
        state.apTransform.mirror = m === 'X' ? 'X' : m === 'Y' ? 'Y' : m === 'XY' ? 'XY' : 'N';
        break;
      }
      case 'LR':
        state.apTransform.rotation = parseFloat(rest) || 0;
        break;
      case 'LS':
        state.apTransform.scale = parseFloat(rest) || 1;
        break;
      case 'IP':
        img.imageNegative = rest.trim().toUpperCase().startsWith('NEG');
        break;
      case 'IR':
        img.imageRotation = (((parseInt(rest, 10) || 0) % 360) + 360) % 360;
        break;
      case 'MI':
        parseMI(rest);
        break;
      case 'OF':
        parseOF(rest);
        break;
      case 'IO':
        parseOF(rest);
        break;
      case 'SF':
        parseSF(rest);
        break;
      case 'AS':
        img.swapAxis = rest.trim().toUpperCase() === 'AYBX';
        break;
      case 'IN':
        img.imageName = rest.trim();
        break;
      case 'LN':
        img.layerName = rest.trim();
        break;
      case 'SR':
        parseSR(rest);
        break;
      case 'AB':
        parseAB(rest);
        break;
      case 'TF':
        parseTF(rest);
        break;
      case 'TA':
        state.netMeta.apertureAttributes = state.netMeta.apertureAttributes ?? [];
        state.netMeta.apertureAttributes.push(rest.trim());
        break;
      case 'TO':
        parseTO(rest);
        break;
      case 'TD':
        parseTD(rest);
        break;
      default:
        // G04 comment or unsupported (IJ, KO…): ignore.
        break;
    }
  }

  function parseFS(rest: string): void {
    // e.g. LAX46Y46  (L=leading omitted, A=absolute, X<int><frac>Y<int><frac>)
    const up = rest.toUpperCase();
    img.coordFormat.leadingZerosOmitted = !up.startsWith('T');
    img.coordFormat.absolute = up.includes('A') ? true : !up.includes('I');
    const xm = up.match(/X(\d)(\d)/);
    const ym = up.match(/Y(\d)(\d)/);
    if (xm) {
      img.coordFormat.xInt = parseInt(xm[1]!, 10);
      img.coordFormat.xFrac = parseInt(xm[2]!, 10);
    }
    if (ym) {
      img.coordFormat.yInt = parseInt(ym[1]!, 10);
      img.coordFormat.yFrac = parseInt(ym[2]!, 10);
    }
  }

  function parseMI(rest: string): void {
    const a0 = rest.match(/A(\d)/);
    const b0 = rest.match(/B(\d)/);
    img.mirror.x = a0 ? a0[1] === '1' : img.mirror.x;
    img.mirror.y = b0 ? b0[1] === '1' : img.mirror.y;
  }

  function parseOF(rest: string): void {
    const a = rest.match(/A([-+0-9.]+)/);
    const b = rest.match(/B([-+0-9.]+)/);
    img.offset = {
      x: a ? parseFloat(a[1]!) : img.offset.x,
      y: b ? parseFloat(b[1]!) : img.offset.y,
    };
  }

  function parseSF(rest: string): void {
    const a = rest.match(/A([-+0-9.]+)/);
    const b = rest.match(/B([-+0-9.]+)/);
    img.scaleFactor = {
      x: a ? parseFloat(a[1]!) : img.scaleFactor.x,
      y: b ? parseFloat(b[1]!) : img.scaleFactor.y,
    };
  }

  function parseTF(rest: string): void {
    const fields = rest.split(',');
    const name = fields[0]?.trim();
    if (name === '.FileFunction') img.fileFunction = fields.slice(1).join(',').trim();
    else if (name === '.FilePolarity') img.filePolarity = fields[1]?.trim() ?? null;
    else if (name === '.GenerationSoftware' || name === '.CreationDate')
      img.generatedBy = fields.slice(1).join(',').trim();
    else if (name === '.MD5') img.md5 = fields[1]?.trim() ?? null;
  }

  function parseTO(rest: string): void {
    const fields = rest.split(',');
    const name = fields[0]?.trim();
    if (name === '.N') state.netMeta.netName = fields.slice(1).join(',').trim();
    else if (name === '.C') state.netMeta.componentRef = fields.slice(1).join(',').trim();
    else if (name === '.P') {
      state.netMeta.componentRef = fields[1]?.trim() ?? state.netMeta.componentRef;
      state.netMeta.padName = fields[2]?.trim();
    } else {
      state.netMeta.objectAttributes = state.netMeta.objectAttributes ?? [];
      state.netMeta.objectAttributes.push(rest.trim());
    }
  }

  function parseTD(rest: string): void {
    const target = rest.trim();
    if (!target) {
      state.netMeta = {};
      return;
    }
    if (target === '.N') delete state.netMeta.netName;
    else if (target === '.C') delete state.netMeta.componentRef;
    else if (target === '.P') delete state.netMeta.padName;
  }

  function parseAD(rest: string): void {
    // Dnn<Template>[,params]
    const m = rest.match(/^D(\d+)/);
    if (!m) return;
    const num = parseInt(m[1]!, 10);
    const body = rest.slice(m[0].length);
    const d = img.getOrCreateDcode(num);
    d.iuScale = img.iuScale;
    d.defined = true;

    const commaIdx = body.indexOf(',');
    const template = (commaIdx >= 0 ? body.slice(0, commaIdx) : body).trim();
    const paramStr = commaIdx >= 0 ? body.slice(commaIdx + 1) : '';
    const params = paramStr
      .split('X')
      .map((s) => parseFloat(s.trim()))
      .filter((v) => Number.isFinite(v));

    switch (template) {
      case 'C':
        d.shape = APERTURE_T.APT_CIRCLE;
        d.size = { x: params[0] ?? 0, y: params[0] ?? 0 };
        applyHole(d, params, 1);
        break;
      case 'R':
        d.shape = APERTURE_T.APT_RECT;
        d.size = { x: params[0] ?? 0, y: params[1] ?? 0 };
        applyHole(d, params, 2);
        break;
      case 'O':
        d.shape = APERTURE_T.APT_OVAL;
        d.size = { x: params[0] ?? 0, y: params[1] ?? 0 };
        applyHole(d, params, 2);
        break;
      case 'P': {
        d.shape = APERTURE_T.APT_POLYGON;
        d.size = { x: params[0] ?? 0, y: params[0] ?? 0 };
        d.edgesCount = Math.round(params[1] ?? 3);
        d.rotation = params[2] ?? 0;
        applyHole(d, params, 3);
        break;
      }
      default: {
        // Macro reference.
        d.shape = APERTURE_T.APT_MACRO;
        d.macro = img.macros.get(template) ?? null;
        d.macroParams = params;
        break;
      }
    }
  }

  function applyHole(
    d: ReturnType<typeof img.getOrCreateDcode>,
    params: number[],
    holeStart: number,
  ): void {
    if (params.length > holeStart) {
      const hx = params[holeStart]!;
      if (params.length > holeStart + 1) {
        d.drillShape = APERTURE_DEF_HOLE.RECT;
        d.drill = { x: hx, y: params[holeStart + 1]! };
      } else {
        d.drillShape = APERTURE_DEF_HOLE.ROUND;
        d.drill = { x: hx, y: hx };
      }
    }
  }

  function handleApertureMacro(parts: string[]): void {
    // parts[0] == "AM<name>", following parts are primitive definitions.
    const name = parts[0]!.slice(2).trim();
    const macro = new ApertureMacro(name);
    for (let k = 1; k < parts.length; k++) {
      const body = parts[k]!.trim();
      if (body.length === 0) continue;
      if (body.startsWith('0')) {
        // Comment primitive "0 ...": keep as no-op.
        macro.primitives.push({ primitiveId: AMP.COMMENT, params: [] });
        continue;
      }
      if (body.startsWith('$')) {
        // Equation "$4=$1x0.5": store as a COMMENT-class assignment primitive.
        const eq = body.indexOf('=');
        if (eq > 0) {
          macro.primitives.push({
            primitiveId: AMP.COMMENT,
            params: [body.slice(0, eq).trim(), body.slice(eq + 1).trim()],
          });
        }
        continue;
      }
      const fields = body.split(',').map((s) => s.trim());
      const id = parseInt(fields[0]!, 10) as AMP;
      const prim: AmPrimitive = { primitiveId: id, params: fields.slice(1) };
      macro.primitives.push(prim);
    }
    img.macros.set(name, macro);
  }

  function parseSR(rest: string): void {
    // %SRX3Y2I5.0J0*% opens; %SR*% closes.
    if (rest.trim().length === 0) {
      // Close: replay the captured items in the X/Y grid.
      if (srActive) replayStepRepeat();
      srActive = false;
      return;
    }
    const x = rest.match(/X(\d+)/);
    const y = rest.match(/Y(\d+)/);
    const iStep = rest.match(/I([-+0-9.]+)/);
    const jStep = rest.match(/J([-+0-9.]+)/);
    srParams = {
      xRepeat: x ? parseInt(x[1]!, 10) : 1,
      yRepeat: y ? parseInt(y[1]!, 10) : 1,
      xStep: iStep ? parseFloat(iStep[1]!) : 0,
      yStep: jStep ? parseFloat(jStep[1]!) : 0,
    };
    srActive = true;
    srStartIndex = img.items.length;
  }

  function replayStepRepeat(): void {
    const base = img.items.slice(srStartIndex);
    if (base.length === 0) return;
    const stepX = iuLen(srParams.xStep);
    const stepY = iuLen(srParams.yStep);
    for (let ry = 0; ry < srParams.yRepeat; ry++) {
      for (let rx = 0; rx < srParams.xRepeat; rx++) {
        if (rx === 0 && ry === 0) continue; // originals stay in place
        const dx = rx * stepX;
        const dy = ry * stepY;
        for (const proto of base) img.items.push(cloneItemTranslated(proto, dx, dy));
      }
    }
  }

  function parseAB(rest: string): void {
    const m = rest.match(/D(\d+)/);
    if (m) {
      // Open a block aperture.
      const num = parseInt(m[1]!, 10);
      blockStack.push({ dcode: num, items: [] });
    } else {
      // Close: store the accumulated block items on the block map.
      const blk = blockStack.pop();
      if (blk) {
        // Store relative to origin (0,0); flashes translate to the flash point.
        blockItems.set(blk.dcode, blk.items);
        img.getOrCreateDcode(blk.dcode).defined = true;
      }
    }
  }

  // ----- word (D-code) command handling ----------------------------------
  function handleWord(word: string): void {
    if (word.length === 0) return;

    // Extract G, D, X, Y, I, J tokens in order.
    let gCode: number | null = null;
    let dCode: number | null = null;
    let mCode: number | null = null;
    let xVal: number | null = null;
    let yVal: number | null = null;
    let iVal: number | null = null;
    let jVal: number | null = null;

    const re = /([GDMXYIJ])([-+]?[0-9.]+)/g;
    let mm: RegExpExecArray | null = re.exec(word);
    for (; mm !== null; mm = re.exec(word)) {
      const letter = mm[1]!;
      const raw = mm[2]!;
      switch (letter) {
        case 'G':
          gCode = parseInt(raw, 10);
          break;
        case 'D':
          dCode = parseInt(raw, 10);
          break;
        case 'M':
          mCode = parseInt(raw, 10);
          break;
        case 'X':
          xVal = decodeCoord(raw, img.coordFormat.xInt, img.coordFormat.xFrac);
          break;
        case 'Y':
          yVal = decodeCoord(raw, img.coordFormat.yInt, img.coordFormat.yFrac);
          break;
        case 'I':
          iVal = decodeCoord(raw, img.coordFormat.xInt, img.coordFormat.xFrac);
          break;
        case 'J':
          jVal = decodeCoord(raw, img.coordFormat.yInt, img.coordFormat.yFrac);
          break;
        default:
          break;
      }
    }

    // Handle G codes (may accompany a D command in the same word).
    if (gCode !== null) applyGCode(gCode);
    if (mCode === 2 || mCode === 0) return; // M02/M00 end of file

    // Aperture selection: Dnn with nn >= 10 and no coordinates.
    if (dCode !== null && dCode >= 10 && xVal === null && yVal === null) {
      state.currentAperture = dCode;
      return;
    }

    if (xVal === null && yVal === null && dCode === null) return;

    const target: Vec2 = img.coordFormat.absolute
      ? { x: xVal ?? state.pos.x, y: yVal ?? state.pos.y }
      : { x: state.pos.x + (xVal ?? 0), y: state.pos.y + (yVal ?? 0) };

    arcIJ = iVal !== null || jVal !== null ? { i: iVal ?? 0, j: jVal ?? 0 } : { i: 0, j: 0 };

    const op = dCode ?? 0;
    if (op === 1) {
      // D01: interpolate (draw).
      drawSegmentOrArc(target);
      state.pos = target;
    } else if (op === 2) {
      // D02: move (pen up). Close current region contour first.
      if (state.regionActive && regionPoints.length >= 3) {
        finishRegion();
      }
      state.pos = target;
      if (state.regionActive) regionPoints.push(toIU(target));
    } else if (op === 3) {
      // D03: flash.
      state.pos = target;
      flashAperture(target);
    } else {
      // Coordinates with no D: treat as a draw if a mode is active (rare).
      if (state.currentAperture) {
        drawSegmentOrArc(target);
        state.pos = target;
      }
    }
    arcIJ = null;
  }

  function applyGCode(g: number): void {
    switch (g) {
      case 1:
        state.interpol = GERB_INTERPOL.LINEAR_1X;
        break;
      case 2:
        state.interpol = GERB_INTERPOL.ARC_G02_CW;
        break;
      case 3:
        state.interpol = GERB_INTERPOL.ARC_G03_CCW;
        break;
      case 74:
        state.multiQuadrant = false;
        break;
      case 75:
        state.multiQuadrant = true;
        break;
      case 36:
        state.regionActive = true;
        regionPoints = [toIU(state.pos)];
        break;
      case 37:
        finishRegion();
        state.regionActive = false;
        break;
      case 70:
        img.setUnit('in');
        break;
      case 71:
        img.setUnit('mm');
        break;
      case 90:
        img.coordFormat.absolute = true;
        break;
      case 91:
        img.coordFormat.absolute = false;
        break;
      default:
        break;
    }
  }

  function finishRegion(): void {
    if (regionPoints.length >= 3) {
      const item = new GERBER_DRAW_ITEM();
      item.shape = GBR_BASIC_SHAPE.GBR_POLYGON;
      item.polyPoints = regionPoints.slice();
      item.dcodeNum = 0;
      emit(item);
    }
    regionPoints = [];
  }
}

/** Deep-ish clone of an item, translated by (dx,dy) IU. */
function cloneItemTranslated(src: GERBER_DRAW_ITEM, dx: number, dy: number): GERBER_DRAW_ITEM {
  const c = new GERBER_DRAW_ITEM();
  c.shape = src.shape;
  c.start = { x: src.start.x + dx, y: src.start.y + dy };
  c.end = { x: src.end.x + dx, y: src.end.y + dy };
  c.arcCentre = { x: src.arcCentre.x + dx, y: src.arcCentre.y + dy };
  c.width = src.width;
  c.polyPoints = src.polyPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  c.dcode = src.dcode;
  c.dcodeNum = src.dcodeNum;
  c.layerPolarity = src.layerPolarity;
  c.apTransform = { ...src.apTransform };
  c.netMetadata = { ...src.netMetadata };
  c.arcCcw = src.arcCcw;
  return c;
}

/** Turn an arc into a polyline (for region contours). */
function arcPolyline(from: Vec2, to: Vec2, centre: Vec2, interpol: GERB_INTERPOL): Vec2[] {
  const r = Math.hypot(from.x - centre.x, from.y - centre.y);
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
  let a1 = Math.atan2(to.y - centre.y, to.x - centre.x);
  const ccw = interpol === GERB_INTERPOL.ARC_G03_CCW;
  if (ccw && a1 <= a0) a1 += 2 * Math.PI;
  if (!ccw && a1 >= a0) a1 -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
  const pts: Vec2[] = [];
  for (let k = 1; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    pts.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
  }
  return pts;
}
