/**
 * Canvas2D renderer for the Symbol Editor scene.
 *
 * A faithful port of KiCad's symbol-editor drawing path:
 *   - SCH_PAINTER::draw(LIB_SYMBOL) filters items by unit/body style,
 *   - SCH_PAINTER::draw(SCH_PIN) draws the pin line + shape decorations and the
 *     name / number / electrical-type texts laid out exactly as
 *     PIN_LAYOUT_CACHE::GetPinNameInfo / GetPinNumberInfo / GetPinElectricalTypeInfo,
 *   - every pin gets the open-circle "dangling" target (m_IsSymbolEditor forces
 *     isDangling in the painter),
 *   - drawAnchor paints the blue cross at the symbol origin,
 *   - selected items get the blue LAYER_SELECTION_SHADOWS underglow.
 *
 * Geometry is the typed model's +Y-down space (the same space sch_painter draws in).
 */

import type { Vec2 } from '@ziroeda/kimath';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { LibGraphic, LibPin, LibSymbol, LibSymbolUnit, SchField } from '@ziroeda/eeschema';
import { layoutText, measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { ITALIC_TILT } from '@ziroeda/eeschema';
import type { Theme } from '../../schematic/theme.js';

export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MM = 10000; // IU per mm
const MIL = 0.0254 * MM;
export const GRID = 1.27 * MM; // 50 mil — the symbol editor's pin grid
const DEFAULT_LINE_WIDTH = 6 * MIL; // DEFAULT_LINE_WIDTH_MILS
const DEFAULT_TEXT = 1.27 * MM;
/** TARGET_PIN_RADIUS (ee_painter): 15 mils. */
export const TARGET_PIN_RADIUS = 15 * MIL;
/** TEXT_ANCHOR_SIZE (default_values.h): 8 mils, for the origin anchor cross. */
const TEXT_ANCHOR_SIZE = 8 * MIL;

/** Extra colours the symbol editor needs beyond the schematic theme (KiCad Default). */
export const SYMBOL_EDITOR_COLORS = {
  anchor: 'rgb(0, 0, 255)', // schematic.anchor
  hidden: 'rgb(194, 194, 194)', // schematic.hidden
  privateNote: 'rgb(72, 72, 255)', // schematic.private_note (electrical-type text)
  fields: 'rgb(132, 0, 132)', // schematic.fields (user fields)
};

/** Options mirroring the symbol editor's view settings. */
export interface SymbolViewOptions {
  unit: number;
  bodyStyle: number;
  /** SCH_ACTIONS::showElectricalTypes. */
  showPinElectricalTypes: boolean;
  /** SCH_ACTIONS::showHiddenPins. */
  showHiddenPins: boolean;
  /** SCH_ACTIONS::showHiddenFields. */
  showHiddenFields: boolean;
}

/** Stable id of an item inside the currently edited symbol. */
export type SymItemKind = 'pin' | 'gfx' | 'field';
export const symItemId = (kind: SymItemKind, unitIdx: number, itemIdx: number): string =>
  `${kind}:${unitIdx}:${itemIdx}`;

export function libUnitShown(u: LibSymbolUnit, unit: number, bodyStyle: number): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** Local body-end ("root", GetPinRoot) of a pin from its connection point. */
export function pinBodyEnd(pin: Pick<LibPin, 'at' | 'angle' | 'length'>): Vec2 {
  switch (((pin.angle % 360) + 360) % 360) {
    case 0:
      return { x: pin.at.x + pin.length, y: pin.at.y };
    case 90:
      return { x: pin.at.x, y: pin.at.y - pin.length };
    case 180:
      return { x: pin.at.x - pin.length, y: pin.at.y };
    default:
      return { x: pin.at.x, y: pin.at.y + pin.length };
  }
}

/** ElectricalPinTypeGetText (pin_type.cpp): UI names for the type tokens. */
export const PIN_TYPE_NAMES: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  bidirectional: 'Bidirectional',
  tri_state: 'Tri-state',
  passive: 'Passive',
  free: 'Free',
  unspecified: 'Unspecified',
  power_in: 'Power input',
  power_out: 'Power output',
  open_collector: 'Open collector',
  open_emitter: 'Open emitter',
  no_connect: 'Unconnected',
};

/** PinShapeGetText (pin_type.cpp): UI names for the graphic-style tokens. */
export const PIN_SHAPE_NAMES: Record<string, string> = {
  line: 'Line',
  inverted: 'Inverted',
  clock: 'Clock',
  inverted_clock: 'Inverted clock',
  input_low: 'Input low',
  clock_low: 'Clock low',
  output_low: 'Output low',
  falling_edge_clock: 'Falling edge clock',
  non_logic: 'NonLogic',
};

/** PinOrientationName: angle token -> UI name (0=Right 90=Up 180=Left 270=Down). */
export const PIN_ORIENTATION_NAMES: [number, string][] = [
  [0, 'Right'],
  [180, 'Left'],
  [90, 'Up'],
  [270, 'Down'],
];

// ----- text ------------------------------------------------------------------

const g_textPaths = new Map<string, { path: Path2D; width: number }>();

function textPath(text: string, size: number, italic: boolean): { path: Path2D; width: number } {
  const key = `${size}|${italic ? 1 : 0}|${text}`;
  let entry = g_textPaths.get(key);
  if (!entry) {
    const { strokes, width } = layoutText(text, size);
    const tilt = italic ? ITALIC_TILT : 0;
    const path = new Path2D();
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      const p0 = stroke[0]!;
      path.moveTo(p0.x - p0.y * tilt, p0.y);
      if (stroke.length === 1) path.lineTo(p0.x - p0.y * tilt + 0.01, p0.y);
      else
        for (let i = 1; i < stroke.length; i++) {
          const pt = stroke[i]!;
          path.lineTo(pt.x - pt.y * tilt, pt.y);
        }
    }
    if (g_textPaths.size > 6000) g_textPaths.clear();
    entry = { path, width };
    g_textPaths.set(key, entry);
  }
  return entry;
}

/** Stroke a Newstroke text run. justify tokens: left/right (+top/bottom); default centre. */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Vec2,
  heightIU: number,
  color: string,
  justify?: readonly string[],
  angleDeg = 0,
  bold = false,
  italic = false,
  penWidth?: number,
): void {
  if (text === '' || text === '~') return;
  const cap = heightIU;
  const right = justify?.includes('right'),
    left = justify?.includes('left');
  const top = justify?.includes('top'),
    bottom = justify?.includes('bottom');
  const a = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const { path, width } = textPath(text, heightIU, italic);
  const offX = right ? -width : left ? 0 : -width / 2;
  const offY = top ? cap : bottom ? 0 : cap / 2;
  ctx.save();
  ctx.translate(at.x, at.y);
  if (a !== 0) ctx.rotate(-a);
  ctx.translate(offX, offY);
  ctx.strokeStyle = color;
  ctx.lineWidth =
    penWidth ?? (bold ? heightIU / 5 : Math.max(heightIU * 0.11, DEFAULT_LINE_WIDTH * 0.6));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

// ----- pin text layout (PIN_LAYOUT_CACHE port) ---------------------------------

interface TextInfo {
  text: string;
  size: number;
  thickness: number;
  at: Vec2; // relative to the pin position after transform
  vertical: boolean;
  halign: 'left' | 'center' | 'right';
  valign: 'top' | 'center' | 'bottom';
}

/** getPinTextOffset: MilsToIU(KiROUND(24 * TextOffsetRatio)) with the 0.15 default. */
const PIN_TEXT_OFFSET = Math.round(24 * 0.15) * MIL;
/** PIN_TEXT_MARGIN (pin_layout_cache.cpp). */
const _PIN_TEXT_MARGIN = 4 * MIL;

/** ClampTextPenSize: pen no wider than a quarter of the text size. */
const clampTextPen = (pen: number, size: number): number => Math.min(pen, size / 4);

const flipH = (h: TextInfo['halign']): TextInfo['halign'] =>
  h === 'left' ? 'right' : h === 'right' ? 'left' : 'center';

/**
 * PIN_LAYOUT_CACHE::transformTextForPin — the layout is computed in the PIN_RIGHT
 * frame (position at origin, root at +x) and rotated to the pin's orientation.
 * Orientations: 0=right(identity) 180=left 90=up 270=down.
 */
function transformTextForPin(info: TextInfo, pin: LibPin): void {
  switch (((pin.angle % 360) + 360) % 360) {
    case 180: // PIN_LEFT
      info.halign = flipH(info.halign);
      info.at = { x: -info.at.x, y: info.at.y };
      break;
    case 90: // PIN_UP
      info.vertical = true;
      info.at = { x: info.at.y, y: -info.at.x };
      break;
    case 270: // PIN_DOWN
      info.vertical = true;
      info.at = { x: info.at.y, y: info.at.x };
      info.halign = flipH(info.halign);
      break;
    default: // PIN_RIGHT
      break;
  }
  info.at = { x: info.at.x + pin.at.x, y: info.at.y + pin.at.y };
}

/** GetPinNameInfo: name inside the body (offset > 0) or centred above the pin. */
export function pinNameInfo(
  pin: LibPin,
  sym: { pinNamesHidden: boolean; pinNameOffset: number },
): TextInfo | null {
  const name = pin.name === '~' ? '' : pin.name;
  if (name === '' || sym.pinNamesHidden) return null;
  const size = pin.nameSize ?? DEFAULT_TEXT;
  if (size <= 0) return null;
  const thickness = clampTextPen(DEFAULT_LINE_WIDTH, size);
  const info: TextInfo = {
    text: name,
    size,
    thickness,
    at: { x: 0, y: 0 },
    vertical: false,
    halign: 'left',
    valign: 'center',
  };
  if (sym.pinNameOffset > 0) {
    info.at = { x: pin.length + sym.pinNameOffset + thickness, y: 0 };
    info.halign = 'left';
    info.valign = 'center';
  } else {
    info.at = { x: pin.length / 2, y: -PIN_TEXT_OFFSET - thickness / 2 };
    info.halign = 'center';
    info.valign = 'bottom';
  }
  transformTextForPin(info, pin);
  return info;
}

/** GetPinNumberInfo: centred over the pin; below it when an outside name occupies the top. */
export function pinNumberInfo(
  pin: LibPin,
  sym: { pinNumbersHidden: boolean; pinNamesHidden: boolean; pinNameOffset: number },
): TextInfo | null {
  const number = pin.number === '~' ? '' : pin.number;
  if (number === '' || sym.pinNumbersHidden) return null;
  const size = pin.numberSize ?? DEFAULT_TEXT;
  if (size <= 0) return null;
  const thickness = clampTextPen(DEFAULT_LINE_WIDTH, size);
  const info: TextInfo = {
    text: number,
    size,
    thickness,
    at: { x: pin.length / 2, y: 0 },
    vertical: false,
    halign: 'center',
    valign: 'bottom',
  };
  const shownName = pin.name === '~' ? '' : pin.name;
  const numAbove = sym.pinNameOffset > 0 || shownName === '' || sym.pinNamesHidden;
  if (numAbove) {
    info.at = { x: info.at.x, y: -PIN_TEXT_OFFSET - thickness / 2 };
    info.valign = 'bottom';
  } else {
    info.at = { x: info.at.x, y: PIN_TEXT_OFFSET + thickness / 2 };
    info.valign = 'top';
  }
  transformTextForPin(info, pin);
  return info;
}

/** GetPinElectricalTypeInfo: the type name just off the pin tip (dangling side). */
export function pinElectricalTypeInfo(pin: LibPin): TextInfo {
  const size = Math.max(((pin.nameSize ?? DEFAULT_TEXT) * 3) / 4, 0.7 * MM);
  const thickness = size / 8;
  const info: TextInfo = {
    text: PIN_TYPE_NAMES[pin.electricalType] ?? pin.electricalType,
    size,
    thickness,
    // The editor's pins are always "dangling", so the extra half-radius applies.
    at: { x: -PIN_TEXT_OFFSET - thickness / 2 - TARGET_PIN_RADIUS - TARGET_PIN_RADIUS / 2, y: 0 },
    vertical: false,
    halign: 'right',
    valign: 'center',
  };
  transformTextForPin(info, pin);
  return info;
}

function drawTextInfo(ctx: CanvasRenderingContext2D, info: TextInfo, color: string): void {
  const justify: string[] = [];
  if (info.halign === 'left') justify.push('left');
  if (info.halign === 'right') justify.push('right');
  if (info.valign === 'top') justify.push('top');
  if (info.valign === 'bottom') justify.push('bottom');
  drawText(
    ctx,
    info.text,
    info.at,
    info.size,
    color,
    justify,
    info.vertical ? 90 : 0,
    false,
    false,
    info.thickness,
  );
}

// ----- pin drawing (SCH_PAINTER::draw(SCH_PIN) port) ----------------------------

function triLine(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, c: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, c: Vec2, r: number): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** COLOR4D::Brightened(f): move a colour fraction f toward white. */
function brighten(css: string, f: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  const rgb = m
    ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
    : /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css)?.slice(1).map(Number);
  if (!rgb) return css;
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  return `rgb(${mix(rgb[0]!)}, ${mix(rgb[1]!)}, ${mix(rgb[2]!)})`;
}

export interface PinDisplaySettings {
  pinNamesHidden: boolean;
  pinNumbersHidden: boolean;
  pinNameOffset: number;
  showElectricalTypes: boolean;
  showHiddenPins: boolean;
}

/**
 * Draw one pin exactly as SCH_PAINTER::draw(SCH_PIN) in the symbol editor:
 * the line + shape decoration, the dangling target circle (always, in the
 * editor), and the number/name/type texts. `shadow` draws only the selection
 * underglow pass.
 */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  pin: LibPin,
  sym: PinDisplaySettings,
  theme: Theme,
  shadow?: { color: string; width: number },
): void {
  const hiddenColor = SYMBOL_EDITOR_COLORS.hidden;
  const hidden = pin.hidden;
  if (hidden && !sym.showHiddenPins && !shadow) {
    return;
  }

  const pos = pin.at; // connection point (tip)
  const p0 = pinBodyEnd(pin); // root (body end)
  // Painter dir: sign(pos - p0) — from the root toward the tip.
  const dir = { x: Math.sign(pos.x - p0.x), y: Math.sign(pos.y - p0.y) };

  const color = shadow ? shadow.color : hidden ? hiddenColor : theme.pin;
  const numSize = pin.numberSize ?? DEFAULT_TEXT;
  const nameSize = pin.nameSize ?? DEFAULT_TEXT;
  const radius = (numSize > 0 ? numSize : DEFAULT_TEXT) / 2; // externalPinDecoSize
  const diam = radius * 2;
  const clockSize = (nameSize > 0 ? nameSize : numSize > 0 ? numSize : DEFAULT_TEXT) / 2; // internalPinDecoSize

  ctx.strokeStyle = color;
  ctx.lineWidth = DEFAULT_LINE_WIDTH + (shadow ? shadow.width : 0);

  if (pin.electricalType === 'no_connect') {
    // N.C.: plain line plus an X at the tip.
    line(ctx, p0, pos);
    line(
      ctx,
      { x: pos.x - TARGET_PIN_RADIUS, y: pos.y - TARGET_PIN_RADIUS },
      { x: pos.x + TARGET_PIN_RADIUS, y: pos.y + TARGET_PIN_RADIUS },
    );
    line(
      ctx,
      { x: pos.x + TARGET_PIN_RADIUS, y: pos.y - TARGET_PIN_RADIUS },
      { x: pos.x - TARGET_PIN_RADIUS, y: pos.y + TARGET_PIN_RADIUS },
    );
  } else {
    switch (pin.shape) {
      case 'inverted':
        circle(ctx, { x: p0.x + dir.x * radius, y: p0.y + dir.y * radius }, radius);
        line(ctx, { x: p0.x + dir.x * diam, y: p0.y + dir.y * diam }, pos);
        break;
      case 'inverted_clock':
        triLine(
          ctx,
          { x: p0.x + dir.y * clockSize, y: p0.y - dir.x * clockSize },
          { x: p0.x - dir.x * clockSize, y: p0.y - dir.y * clockSize },
          { x: p0.x - dir.y * clockSize, y: p0.y + dir.x * clockSize },
        );
        circle(ctx, { x: p0.x + dir.x * radius, y: p0.y + dir.y * radius }, radius);
        line(ctx, { x: p0.x + dir.x * diam, y: p0.y + dir.y * diam }, pos);
        break;
      case 'clock_low':
      case 'falling_edge_clock':
        triLine(
          ctx,
          { x: p0.x + dir.y * clockSize, y: p0.y - dir.x * clockSize },
          { x: p0.x - dir.x * clockSize, y: p0.y - dir.y * clockSize },
          { x: p0.x - dir.y * clockSize, y: p0.y + dir.x * clockSize },
        );
        if (!dir.y)
          triLine(
            ctx,
            { x: p0.x + dir.x * diam, y: p0.y },
            { x: p0.x + dir.x * diam, y: p0.y - diam },
            p0,
          );
        else
          triLine(
            ctx,
            { x: p0.x, y: p0.y + dir.y * diam },
            { x: p0.x - diam, y: p0.y + dir.y * diam },
            p0,
          );
        line(ctx, p0, pos);
        break;
      case 'clock':
        line(ctx, p0, pos);
        if (!dir.y)
          triLine(
            ctx,
            { x: p0.x, y: p0.y + clockSize },
            { x: p0.x - dir.x * clockSize, y: p0.y },
            { x: p0.x, y: p0.y - clockSize },
          );
        else
          triLine(
            ctx,
            { x: p0.x + clockSize, y: p0.y },
            { x: p0.x, y: p0.y - dir.y * clockSize },
            { x: p0.x - clockSize, y: p0.y },
          );
        break;
      case 'input_low':
        line(ctx, p0, pos);
        if (!dir.y)
          triLine(
            ctx,
            { x: p0.x + dir.x * diam, y: p0.y },
            { x: p0.x + dir.x * diam, y: p0.y - diam },
            p0,
          );
        else
          triLine(
            ctx,
            { x: p0.x, y: p0.y + dir.y * diam },
            { x: p0.x - diam, y: p0.y + dir.y * diam },
            p0,
          );
        break;
      case 'output_low':
        line(ctx, p0, pos);
        if (!dir.y) line(ctx, { x: p0.x, y: p0.y - diam }, { x: p0.x + dir.x * diam, y: p0.y });
        else line(ctx, { x: p0.x - diam, y: p0.y }, { x: p0.x, y: p0.y + dir.y * diam });
        break;
      case 'non_logic':
        line(ctx, p0, pos);
        line(
          ctx,
          { x: p0.x - (dir.x + dir.y) * radius, y: p0.y - (dir.y - dir.x) * radius },
          { x: p0.x + (dir.x + dir.y) * radius, y: p0.y + (dir.y - dir.x) * radius },
        );
        line(
          ctx,
          { x: p0.x - (dir.x - dir.y) * radius, y: p0.y - (dir.x + dir.y) * radius },
          { x: p0.x + (dir.x - dir.y) * radius, y: p0.y + (dir.x + dir.y) * radius },
        );
        break;
      default:
        line(ctx, p0, pos);
        break;
    }
  }

  if (shadow) return;

  // Dangling target: in the symbol editor every pin shows the open circle
  // (SCH_RENDER_SETTINGS::m_IsSymbolEditor forces isDangling), brightened 30%.
  ctx.strokeStyle = brighten(hidden ? hiddenColor : theme.pin, 0.3);
  ctx.lineWidth = DEFAULT_LINE_WIDTH / 3;
  circle(ctx, pos, TARGET_PIN_RADIUS);

  // Texts.
  const numInfo = pinNumberInfo(pin, sym);
  if (numInfo) drawTextInfo(ctx, numInfo, hidden ? hiddenColor : theme.pinNumber);
  const nameInfo = pinNameInfo(pin, sym);
  if (nameInfo) drawTextInfo(ctx, nameInfo, hidden ? hiddenColor : theme.pinName);
  if (sym.showElectricalTypes) {
    drawTextInfo(
      ctx,
      pinElectricalTypeInfo(pin),
      hidden ? hiddenColor : SYMBOL_EDITOR_COLORS.privateNote,
    );
  }
}

// ----- graphics ---------------------------------------------------------------

function drawArc3(
  ctx: CanvasRenderingContext2D,
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  fill = false,
): void {
  const ax = start.x,
    ay = start.y,
    bx = mid.x,
    by = mid.y,
    cx = end.x,
    cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) {
    line(ctx, start, end);
    return;
  }
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(cy - uy, cx - ux);
  const aMid = Math.atan2(by - uy, bx - ux);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = !(norm(aMid - a0) <= norm(a1 - a0));
  ctx.beginPath();
  ctx.arc(ux, uy, r, a0, a1, ccw);
  if (fill) ctx.fill();
  ctx.stroke();
}

/** KiCad `(color r g b a)` -> CSS. */
const cssColor = (c: readonly [number, number, number, number]): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

function setDash(ctx: CanvasRenderingContext2D, type: string | undefined, width: number): void {
  const w = width > 0 ? width : DEFAULT_LINE_WIDTH;
  switch (type) {
    case 'dash':
      ctx.setLineDash([12 * w, 3 * w]);
      break;
    case 'dot':
      ctx.setLineDash([w, 3 * w]);
      break;
    case 'dash_dot':
      ctx.setLineDash([12 * w, 3 * w, w, 3 * w]);
      break;
    case 'dash_dot_dot':
      ctx.setLineDash([12 * w, 3 * w, w, 3 * w, w, 3 * w]);
      break;
    default:
      ctx.setLineDash([]);
      break;
  }
}

/** Draw one graphic body item (SCH_PAINTER::draw(SCH_SHAPE/SCH_TEXT) on LAYER_DEVICE). */
export function drawGraphic(
  ctx: CanvasRenderingContext2D,
  g: LibGraphic,
  theme: Theme,
  shadow?: { color: string; width: number },
): void {
  const stroke = g.kind !== 'text' ? g.stroke : undefined;
  const width = stroke && stroke.width > 0 ? stroke.width : DEFAULT_LINE_WIDTH;
  const filled = g.kind !== 'text' && g.fill && g.fill.type !== 'none';
  ctx.lineWidth = width + (shadow ? shadow.width : 0);
  ctx.strokeStyle = shadow
    ? shadow.color
    : stroke?.color
      ? cssColor(stroke.color)
      : theme.symbolOutline;
  ctx.fillStyle =
    g.kind !== 'text' && g.fill?.type === 'color' && g.fill.color
      ? cssColor(g.fill.color)
      : g.kind !== 'text' && g.fill?.type === 'background'
        ? theme.symbolFill
        : theme.symbolOutline;
  if (!shadow) setDash(ctx, stroke?.type, width);

  switch (g.kind) {
    case 'rectangle': {
      ctx.beginPath();
      ctx.rect(
        Math.min(g.start.x, g.end.x),
        Math.min(g.start.y, g.end.y),
        Math.abs(g.end.x - g.start.x),
        Math.abs(g.end.y - g.start.y),
      );
      if (filled && !shadow) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'circle':
      ctx.beginPath();
      ctx.arc(g.center.x, g.center.y, g.radius, 0, Math.PI * 2);
      if (filled && !shadow) ctx.fill();
      ctx.stroke();
      break;
    case 'arc':
      drawArc3(ctx, g.start, g.mid, g.end, !!filled && !shadow);
      break;
    case 'polyline': {
      if (g.points.length === 0) break;
      ctx.beginPath();
      ctx.moveTo(g.points[0]!.x, g.points[0]!.y);
      for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i]!.x, g.points[i]!.y);
      if (filled && !shadow) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      if (shadow) break; // no stroke halo for text (matches drawLibUnitShadow)
      const h = g.effects?.fontSize?.[0] ?? DEFAULT_TEXT;
      drawText(
        ctx,
        g.text,
        g.at,
        h,
        theme.symbolOutline,
        g.effects?.justify,
        g.angle % 180 === 90 ? 90 : 0,
        g.effects?.bold,
        g.effects?.italic,
      );
      break;
    }
  }
  ctx.setLineDash([]);
}

// ----- fields -------------------------------------------------------------------

export function fieldColor(f: SchField, theme: Theme): string {
  if (f.effects?.color) return cssColor(f.effects.color);
  if (f.key === 'Reference') return theme.reference;
  if (f.key === 'Value') return theme.value;
  return SYMBOL_EDITOR_COLORS.fields;
}

export function drawField(
  ctx: CanvasRenderingContext2D,
  f: SchField,
  theme: Theme,
  showHidden: boolean,
  shadow?: { color: string; width: number },
): void {
  if (!f.at || f.value === '') return;
  const hidden = !!f.effects?.hidden;
  if (hidden && !showHidden) return;
  const h = f.effects?.fontSize?.[0] ?? DEFAULT_TEXT;
  if (shadow) {
    // Underline the run as the selection cue (fields have no outline geometry).
    const w = measureText(f.value, h);
    const justify = f.effects?.justify;
    const x0 = justify?.includes('right')
      ? f.at.x - w
      : justify?.includes('left')
        ? f.at.x
        : f.at.x - w / 2;
    ctx.strokeStyle = shadow.color;
    ctx.lineWidth = DEFAULT_LINE_WIDTH + shadow.width;
    line(ctx, { x: x0, y: f.at.y }, { x: x0 + w, y: f.at.y });
    return;
  }
  const color = hidden ? SYMBOL_EDITOR_COLORS.hidden : fieldColor(f, theme);
  const shown = f.nameShown ? `${f.key}: ${f.value}` : f.value;
  drawText(
    ctx,
    shown,
    f.at,
    h,
    color,
    f.effects?.justify,
    f.angle % 180 === 90 ? 90 : 0,
    f.effects?.bold,
    f.effects?.italic,
  );
}

// ----- scene --------------------------------------------------------------------

/** drawAnchor: the blue cross at the symbol origin, zoom-aware. */
function drawOrigin(ctx: CanvasRenderingContext2D, scale: number): void {
  const radius = Math.round(Math.abs((1 / scale) * TEXT_ANCHOR_SIZE) / 25) + TEXT_ANCHOR_SIZE;
  ctx.strokeStyle = SYMBOL_EDITOR_COLORS.anchor;
  ctx.lineWidth = DEFAULT_LINE_WIDTH / 3;
  line(ctx, { x: -radius, y: 0 }, { x: radius, y: 0 });
  line(ctx, { x: 0, y: -radius }, { x: 0, y: radius });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  theme: Theme,
  w: number,
  h: number,
): void {
  const left = -viewport.offsetX / viewport.scale;
  const top = -viewport.offsetY / viewport.scale;
  const right = (w - viewport.offsetX) / viewport.scale;
  const bottom = (h - viewport.offsetY) / viewport.scale;
  if (GRID * viewport.scale < 6) return;
  const dot = Math.max(0.15 * MM, 0.5 / viewport.scale);
  ctx.fillStyle = theme.grid;
  const x0 = Math.ceil(left / GRID) * GRID;
  const y0 = Math.ceil(top / GRID) * GRID;
  for (let x = x0; x <= right; x += GRID) {
    for (let y = y0; y <= bottom; y += GRID) {
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  }
}

const SELECTION_THICKNESS_MILS = 3;

/**
 * Render the symbol editor scene: grid, origin anchor, then the current
 * symbol's items for the shown unit/body style (selection shadows first, as
 * KiCad's LAYER_SELECTION_SHADOWS pass runs under the normal layers).
 */
export function renderSymbolScene(
  ctx: CanvasRenderingContext2D,
  sym: LibSymbol | null,
  viewport: Viewport,
  theme: Theme,
  canvasWidth: number,
  canvasHeight: number,
  opts: SymbolViewOptions,
  selection?: ReadonlySet<string>,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const { scale, offsetX, offsetY } = viewport;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawGrid(ctx, viewport, theme, canvasWidth, canvasHeight);
  drawOrigin(ctx, scale);
  if (!sym) return;

  const pinSettings: PinDisplaySettings = {
    pinNamesHidden: sym.pinNamesHidden,
    pinNumbersHidden: sym.pinNumbersHidden,
    pinNameOffset: sym.pinNameOffset,
    showElectricalTypes: opts.showPinElectricalTypes,
    showHiddenPins: opts.showHiddenPins,
  };

  // getShadowWidth(false): a zoom-scaled screen term plus a fixed world minimum.
  const shadowWidth = Math.abs(SELECTION_THICKNESS_MILS / scale) + SELECTION_THICKNESS_MILS * MIL;
  const shadow = { color: theme.selectionShadow, width: shadowWidth };

  // Selection shadow pass (under everything, like LAYER_SELECTION_SHADOWS).
  if (selection && selection.size > 0) {
    sym.units.forEach((u, ui) => {
      if (!libUnitShown(u, opts.unit, opts.bodyStyle)) return;
      u.graphics.forEach((g, gi) => {
        if (selection.has(symItemId('gfx', ui, gi))) drawGraphic(ctx, g, theme, shadow);
      });
      u.pins.forEach((p, pi) => {
        if (selection.has(symItemId('pin', ui, pi))) drawPin(ctx, p, pinSettings, theme, shadow);
      });
    });
    sym.properties.forEach((f, fi) => {
      if (selection.has(symItemId('field', 0, fi)))
        drawField(ctx, f, theme, opts.showHiddenFields, shadow);
    });
  }

  // Normal pass: graphics under pins (KiCad's layer order: device body, then pins).
  sym.units.forEach((u, ui) => {
    void ui;
    if (!libUnitShown(u, opts.unit, opts.bodyStyle)) return;
    for (const g of u.graphics) drawGraphic(ctx, g, theme);
  });
  sym.units.forEach((u) => {
    if (!libUnitShown(u, opts.unit, opts.bodyStyle)) return;
    for (const p of u.pins) drawPin(ctx, p, pinSettings, theme);
  });
  for (const f of sym.properties) drawField(ctx, f, theme, opts.showHiddenFields);
}

// ----- bounding / fit ------------------------------------------------------------

/** Bounding box of the shown unit's items (body + pins, without hidden pins). */
export function symbolBounds(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const inc = (p: Vec2): void => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const u of sym.units) {
    if (!libUnitShown(u, unit, bodyStyle)) continue;
    for (const g of u.graphics) {
      if (g.kind === 'rectangle') {
        inc(g.start);
        inc(g.end);
      } else if (g.kind === 'circle') {
        inc({ x: g.center.x - g.radius, y: g.center.y - g.radius });
        inc({ x: g.center.x + g.radius, y: g.center.y + g.radius });
      } else if (g.kind === 'arc') {
        inc(g.start);
        inc(g.mid);
        inc(g.end);
      } else if (g.kind === 'polyline') g.points.forEach(inc);
      else inc(g.at);
    }
    for (const p of u.pins) {
      if (p.hidden) continue;
      inc(p.at);
      inc(pinBodyEnd(p));
    }
  }
  for (const f of sym.properties) {
    if (f.at && !f.effects?.hidden && f.value !== '') inc(f.at);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Viewport fitting the symbol (or a sane default for an empty screen). */
export function fitSymbol(
  sym: LibSymbol | null,
  unit: number,
  bodyStyle: number,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const b = sym ? symbolBounds(sym, unit, bodyStyle) : null;
  if (!b) {
    // Empty: ~0.008 px/IU centred on the origin (a comfortable pin-grid zoom).
    const scale = canvasWidth / (60 * MM);
    return { scale, offsetX: canvasWidth / 2, offsetY: canvasHeight / 2 };
  }
  const pad = 8 * MM;
  const minX = b.minX - pad,
    minY = b.minY - pad,
    maxX = b.maxX + pad,
    maxY = b.maxY + pad;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;
  const scale = Math.min(canvasWidth / w, canvasHeight / h);
  return {
    scale,
    offsetX: canvasWidth / 2 - ((minX + maxX) / 2) * scale,
    offsetY: canvasHeight / 2 - ((minY + maxY) / 2) * scale,
  };
}

export { iuToMM, mmToIU, DEFAULT_LINE_WIDTH, DEFAULT_TEXT, MM, MIL, drawText };
