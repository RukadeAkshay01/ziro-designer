/**
 * Pure editing operations on a LibSymbol, mirroring KiCad's symbol editor tools
 * (symbol_editor_edit_tool.cpp / symbol_editor_pin_tool.cpp / drawing tools).
 *
 * Every operation returns a new LibSymbol; the editor keeps whole-symbol
 * snapshots for undo/redo exactly as SYMBOL_EDIT_FRAME::SaveCopyInUndoList does
 * ("the full data is duplicated"). Items keep their `source` nodes so the
 * lossless writer can pass untouched items through byte-for-byte.
 */

import type { Vec2 } from '@ziroeda/kimath';
import {
  EMPTY_SOURCE,
  type LibGraphic,
  type LibPin,
  type LibSymbol,
  type LibSymbolUnit,
  type SchField,
} from '@ziroeda/eeschema';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import {
  GRID,
  libUnitShown,
  pinBodyEnd,
  pinNameInfo,
  pinNumberInfo,
  symItemId,
  type SymItemKind,
} from './render/symbolRenderer.js';

export interface SymItemRef {
  kind: SymItemKind;
  unitIdx: number;
  itemIdx: number;
}

export function parseItemId(id: string): SymItemRef | null {
  const m = /^(pin|gfx|field):(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { kind: m[1] as SymItemKind, unitIdx: Number(m[2]), itemIdx: Number(m[3]) };
}

const snap = (p: Vec2): Vec2 => ({
  x: Math.round(p.x / GRID) * GRID,
  y: Math.round(p.y / GRID) * GRID,
});
/** GetNearestHalfGridPosition: multi-item rotate/mirror centres snap to grid/2. */
const snapHalf = (p: Vec2): Vec2 => ({
  x: Math.round(p.x / (GRID / 2)) * (GRID / 2),
  y: Math.round(p.y / (GRID / 2)) * (GRID / 2),
});

// ----- structural helpers ------------------------------------------------------

function withUnits(sym: LibSymbol, units: readonly LibSymbolUnit[]): LibSymbol {
  return { ...sym, units };
}

function mapUnit(
  sym: LibSymbol,
  unitIdx: number,
  fn: (u: LibSymbolUnit) => LibSymbolUnit,
): LibSymbol {
  return withUnits(
    sym,
    sym.units.map((u, i) => (i === unitIdx ? fn(u) : u)),
  );
}

/** The base symbol name of a unit-node name (`R_0_1` -> `R`). */
const unitName = (symName: string, unit: number, bodyStyle: number): string =>
  `${symName}_${unit}_${bodyStyle}`;

/**
 * Find (or create) the unit entry items with (unit, bodyStyle) land in — KiCad
 * groups draw items into `Name_U_B` child symbols on save.
 */
export function ensureUnitEntry(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; unitIdx: number } {
  const idx = sym.units.findIndex((u) => u.unit === unit && u.bodyStyle === bodyStyle);
  if (idx !== -1) return { sym, unitIdx: idx };
  const entry: LibSymbolUnit = {
    name: unitName(sym.libId, unit, bodyStyle),
    unit,
    bodyStyle,
    graphics: [],
    pins: [],
    source: EMPTY_SOURCE,
  };
  // Keep KiCad's save order: sorted by unit then body style.
  const units = [...sym.units, entry].sort((a, b) => a.unit - b.unit || a.bodyStyle - b.bodyStyle);
  return { sym: withUnits(sym, units), unitIdx: units.indexOf(entry) };
}

/** Number of units (derived like LIB_SYMBOL::GetUnitCount from the unit entries). */
export function unitCount(sym: LibSymbol): number {
  return Math.max(1, ...sym.units.map((u) => u.unit));
}

export function hasAlternateBodyStyle(sym: LibSymbol): boolean {
  return sym.units.some((u) => u.bodyStyle > 1);
}

/** All pins visible for a unit/body-style view. */
export function pinsShown(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
): { pin: LibPin; id: string }[] {
  const out: { pin: LibPin; id: string }[] = [];
  sym.units.forEach((u, ui) => {
    if (!libUnitShown(u, unit, bodyStyle)) return;
    u.pins.forEach((p, pi) => out.push({ pin: p, id: symItemId('pin', ui, pi) }));
  });
  return out;
}

/** Every pin of the symbol (across all units/body styles), like LIB_SYMBOL::GetPins(). */
export function allPins(sym: LibSymbol): { pin: LibPin; unitIdx: number; pinIdx: number }[] {
  const out: { pin: LibPin; unitIdx: number; pinIdx: number }[] = [];
  sym.units.forEach((u, ui) =>
    u.pins.forEach((p, pi) => out.push({ pin: p, unitIdx: ui, pinIdx: pi })),
  );
  return out;
}

// ----- item transforms -----------------------------------------------------------

const rotCCW = (p: Vec2, c: Vec2): Vec2 => ({ x: c.x + (p.y - c.y), y: c.y - (p.x - c.x) });
const rotCW = (p: Vec2, c: Vec2): Vec2 => ({ x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) });
const mirX = (p: Vec2, cx: number): Vec2 => ({ x: 2 * cx - p.x, y: p.y });
const mirY = (p: Vec2, cy: number): Vec2 => ({ x: p.x, y: 2 * cy - p.y });

/** Pin orientation cycle for a CCW rotation: right(0) -> up(90) -> left(180) -> down(270). */
const rotPinAngle = (angle: number, ccw: boolean): number =>
  (((angle + (ccw ? 90 : -90)) % 360) + 360) % 360;

const translate = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

function movePin(pin: LibPin, d: Vec2): LibPin {
  return { ...pin, at: translate(pin.at, d) };
}

function moveGraphic(g: LibGraphic, d: Vec2): LibGraphic {
  switch (g.kind) {
    case 'rectangle':
      return { ...g, start: translate(g.start, d), end: translate(g.end, d) };
    case 'circle':
      return { ...g, center: translate(g.center, d) };
    case 'arc':
      return {
        ...g,
        start: translate(g.start, d),
        mid: translate(g.mid, d),
        end: translate(g.end, d),
      };
    case 'polyline':
      return { ...g, points: g.points.map((p) => translate(p, d)) };
    case 'text':
      return { ...g, at: translate(g.at, d) };
  }
}

function moveField(f: SchField, d: Vec2): SchField {
  return { ...f, at: translate(f.at ?? { x: 0, y: 0 }, d) };
}

function rotatePin(pin: LibPin, c: Vec2, ccw: boolean): LibPin {
  return {
    ...pin,
    at: ccw ? rotCCW(pin.at, c) : rotCW(pin.at, c),
    angle: rotPinAngle(pin.angle, ccw),
  };
}

function rotateGraphic(g: LibGraphic, c: Vec2, ccw: boolean): LibGraphic {
  const r = (p: Vec2): Vec2 => (ccw ? rotCCW(p, c) : rotCW(p, c));
  switch (g.kind) {
    case 'rectangle':
      return { ...g, start: r(g.start), end: r(g.end) };
    case 'circle':
      return { ...g, center: r(g.center) };
    case 'arc':
      return { ...g, start: r(g.start), mid: r(g.mid), end: r(g.end) };
    case 'polyline':
      return { ...g, points: g.points.map(r) };
    case 'text':
      return { ...g, at: r(g.at), angle: g.angle % 180 === 90 ? 0 : 90 };
  }
}

function rotateField(f: SchField, c: Vec2, ccw: boolean): SchField {
  const at = f.at ?? { x: 0, y: 0 };
  return { ...f, at: ccw ? rotCCW(at, c) : rotCW(at, c), angle: f.angle % 180 === 90 ? 0 : 90 };
}

/** Flip left/right tokens in a justify list (GetFlippedAlignment). */
function flipJustifyH(justify: readonly string[] | undefined): string[] {
  const j = [...(justify ?? [])];
  const hasLeft = j.includes('left'),
    hasRight = j.includes('right');
  const out = j.filter((t) => t !== 'left' && t !== 'right');
  if (hasLeft) out.push('right');
  else if (hasRight) out.push('left');
  return out;
}

function flipJustifyV(justify: readonly string[] | undefined): string[] {
  const j = [...(justify ?? [])];
  const hasTop = j.includes('top'),
    hasBottom = j.includes('bottom');
  const out = j.filter((t) => t !== 'top' && t !== 'bottom');
  if (hasTop) out.push('bottom');
  else if (hasBottom) out.push('top');
  return out;
}

/** Pin orientation under a horizontal mirror (right<->left) or vertical (up<->down). */
const mirrorPinAngleH = (a: number): number => (a === 0 ? 180 : a === 180 ? 0 : a);
const mirrorPinAngleV = (a: number): number => (a === 90 ? 270 : a === 270 ? 90 : a);

function mirrorPin(pin: LibPin, c: Vec2, horizontal: boolean): LibPin {
  return horizontal
    ? { ...pin, at: mirX(pin.at, c.x), angle: mirrorPinAngleH(pin.angle) }
    : { ...pin, at: mirY(pin.at, c.y), angle: mirrorPinAngleV(pin.angle) };
}

function mirrorGraphic(g: LibGraphic, c: Vec2, horizontal: boolean): LibGraphic {
  const m = (p: Vec2): Vec2 => (horizontal ? mirX(p, c.x) : mirY(p, c.y));
  switch (g.kind) {
    case 'rectangle':
      return { ...g, start: m(g.start), end: m(g.end) };
    case 'circle':
      return { ...g, center: m(g.center) };
    case 'arc':
      return { ...g, start: m(g.start), mid: m(g.mid), end: m(g.end) };
    case 'polyline':
      return { ...g, points: g.points.map(m) };
    case 'text': {
      const fx = g.effects;
      const effects = fx
        ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
        : fx;
      return { ...g, at: m(g.at), ...(effects ? { effects } : {}) };
    }
  }
}

function mirrorField(f: SchField, c: Vec2, horizontal: boolean): SchField {
  const at = f.at ?? { x: 0, y: 0 };
  const fx = f.effects;
  const effects = fx
    ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
    : fx;
  return { ...f, at: horizontal ? mirX(at, c.x) : mirY(at, c.y), ...(effects ? { effects } : {}) };
}

// ----- selection-level operations -------------------------------------------------

function itemPosition(sym: LibSymbol, ref: SymItemRef): Vec2 {
  if (ref.kind === 'pin') return sym.units[ref.unitIdx]?.pins[ref.itemIdx]?.at ?? { x: 0, y: 0 };
  if (ref.kind === 'field') return sym.properties[ref.itemIdx]?.at ?? { x: 0, y: 0 };
  const g = sym.units[ref.unitIdx]?.graphics[ref.itemIdx];
  if (!g) return { x: 0, y: 0 };
  switch (g.kind) {
    case 'rectangle':
      return g.start;
    case 'circle':
      return g.center;
    case 'arc':
      return g.start;
    case 'polyline':
      return g.points[0] ?? { x: 0, y: 0 };
    case 'text':
      return g.at;
  }
}

function selectionRefs(ids: ReadonlySet<string>): SymItemRef[] {
  const refs: SymItemRef[] = [];
  for (const id of ids) {
    const r = parseItemId(id);
    if (r) refs.push(r);
  }
  return refs;
}

function applyToItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  fnPin: (p: LibPin) => LibPin,
  fnGfx: (g: LibGraphic) => LibGraphic,
  fnField: (f: SchField) => SchField,
): LibSymbol {
  const units = sym.units.map((u, ui) => {
    let changed = false;
    const pins = u.pins.map((p, pi) => {
      if (!ids.has(symItemId('pin', ui, pi))) return p;
      changed = true;
      return fnPin(p);
    });
    const graphics = u.graphics.map((g, gi) => {
      if (!ids.has(symItemId('gfx', ui, gi))) return g;
      changed = true;
      return fnGfx(g);
    });
    return changed ? { ...u, pins, graphics } : u;
  });
  const properties = sym.properties.map((f, fi) =>
    ids.has(symItemId('field', 0, fi)) ? fnField(f) : f,
  );
  return { ...sym, units, properties };
}

export function moveSymbolItems(sym: LibSymbol, ids: ReadonlySet<string>, delta: Vec2): LibSymbol {
  return applyToItems(
    sym,
    ids,
    (p) => movePin(p, delta),
    (g) => moveGraphic(g, delta),
    (f) => moveField(f, delta),
  );
}

/**
 * Rotate the selection (SYMBOL_EDITOR_EDIT_TOOL::Rotate): a single item rotates
 * about its own position; several rotate about the selection centre snapped to
 * the half grid.
 */
export function rotateSymbolItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  ccw: boolean,
): LibSymbol {
  const refs = selectionRefs(ids);
  if (refs.length === 0) return sym;
  let c: Vec2;
  if (refs.length === 1) c = itemPosition(sym, refs[0]!);
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of refs) {
      const p = itemPosition(sym, r);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    c = snapHalf({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
  return applyToItems(
    sym,
    ids,
    (p) => rotatePin(p, c, ccw),
    (g) => rotateGraphic(g, c, ccw),
    (f) => rotateField(f, c, ccw),
  );
}

/**
 * Mirror the selection (SYMBOL_EDITOR_EDIT_TOOL::Mirror). A single *field*
 * only flips its justification (KiCad's special case); other single items
 * mirror about their own position; several mirror about the selection centre.
 */
export function mirrorSymbolItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  horizontal: boolean,
): LibSymbol {
  const refs = selectionRefs(ids);
  if (refs.length === 0) return sym;
  if (refs.length === 1 && refs[0]!.kind === 'field') {
    const fi = refs[0]!.itemIdx;
    const properties = sym.properties.map((f, i) => {
      if (i !== fi) return f;
      const fx = f.effects;
      const effects = fx
        ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
        : { hidden: false, justify: horizontal ? ['right'] : [] };
      return { ...f, effects };
    });
    return { ...sym, properties };
  }
  let c: Vec2;
  if (refs.length === 1) c = itemPosition(sym, refs[0]!);
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of refs) {
      const p = itemPosition(sym, r);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    c = snapHalf({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
  return applyToItems(
    sym,
    ids,
    (p) => mirrorPin(p, c, horizontal),
    (g) => mirrorGraphic(g, c, horizontal),
    (f) => mirrorField(f, c, horizontal),
  );
}

/** Delete the selected items (fields other than mandatory can go; pins/graphics always). */
export function deleteSymbolItems(sym: LibSymbol, ids: ReadonlySet<string>): LibSymbol {
  const units = sym.units.map((u, ui) => ({
    ...u,
    pins: u.pins.filter((_, pi) => !ids.has(symItemId('pin', ui, pi))),
    graphics: u.graphics.filter((_, gi) => !ids.has(symItemId('gfx', ui, gi))),
  }));
  const MANDATORY = new Set(['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']);
  const properties = sym.properties.filter(
    (f, fi) => !ids.has(symItemId('field', 0, fi)) || MANDATORY.has(f.key),
  );
  return { ...sym, units, properties };
}

/** Replace one item by id. */
export function replaceSymbolItem(
  sym: LibSymbol,
  id: string,
  item: LibPin | LibGraphic | SchField,
): LibSymbol {
  const ref = parseItemId(id);
  if (!ref) return sym;
  if (ref.kind === 'field') {
    return {
      ...sym,
      properties: sym.properties.map((f, i) => (i === ref.itemIdx ? (item as SchField) : f)),
    };
  }
  return mapUnit(sym, ref.unitIdx, (u) =>
    ref.kind === 'pin'
      ? { ...u, pins: u.pins.map((p, i) => (i === ref.itemIdx ? (item as LibPin) : p)) }
      : {
          ...u,
          graphics: u.graphics.map((g, i) => (i === ref.itemIdx ? (item as LibGraphic) : g)),
        },
  );
}

/** Add a pin (SYMBOL_EDITOR_PIN_TOOL::PlacePin): returns the new item's id. */
export function addPinToSymbol(
  sym: LibSymbol,
  pin: LibPin,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; id: string } {
  const r = ensureUnitEntry(sym, unit, bodyStyle);
  const u = r.sym.units[r.unitIdx]!;
  const next = mapUnit(r.sym, r.unitIdx, (uu) => ({ ...uu, pins: [...uu.pins, pin] }));
  return { sym: next, id: symItemId('pin', r.unitIdx, u.pins.length) };
}

/**
 * CreateImagePins: with synchronized pin edit on a multi-unit symbol, placing a
 * pin in one unit creates matching pins in every other unit (same position,
 * temporary "-U<letter>" numbers).
 */
export function createImagePins(
  sym: LibSymbol,
  pin: LibPin,
  unit: number,
  bodyStyle: number,
): LibSymbol {
  if (unit === 0) return sym;
  let out = sym;
  const count = unitCount(sym);
  for (let ii = 1; ii <= count; ii++) {
    if (ii === unit) continue;
    const copy: LibPin = {
      ...pin,
      number: `${pin.number}-U${String.fromCharCode(64 + ii)}`,
      source: EMPTY_SOURCE,
    };
    out = addPinToSymbol(out, copy, ii, bodyStyle).sym;
  }
  return out;
}

/** Add a graphic body item; returns the new item's id. */
export function addGraphicToSymbol(
  sym: LibSymbol,
  g: LibGraphic,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; id: string } {
  const r = ensureUnitEntry(sym, unit, bodyStyle);
  const u = r.sym.units[r.unitIdx]!;
  const next = mapUnit(r.sym, r.unitIdx, (uu) => ({ ...uu, graphics: [...uu.graphics, g] }));
  return { sym: next, id: symItemId('gfx', r.unitIdx, u.graphics.length) };
}

/** Place Anchor (SYMBOL_EDITOR_DRAWING_TOOLS::PlaceAnchor): symbol->Move(-pos). */
export function moveSymbolOrigin(sym: LibSymbol, pos: Vec2): LibSymbol {
  const d = { x: -pos.x, y: -pos.y };
  const units = sym.units.map((u) => ({
    ...u,
    pins: u.pins.map((p) => movePin(p, d)),
    graphics: u.graphics.map((g) => moveGraphic(g, d)),
  }));
  const properties = sym.properties.map((f) => (f.at ? moveField(f, d) : f));
  return { ...sym, units, properties };
}

/** Rename the symbol: updates libId, the Value field (KiCad keeps them in sync) and unit names. */
export function renameSymbol(sym: LibSymbol, newName: string): LibSymbol {
  const units = sym.units.map((u) => ({ ...u, name: unitName(newName, u.unit, u.bodyStyle) }));
  const properties = sym.properties.map((f) =>
    f.key === 'Value' && f.value === sym.libId ? { ...f, value: newName } : f,
  );
  return { ...sym, libId: newName, units, properties };
}

/** SetUnitCount: grow with empty unit entries, or drop the entries above the count. */
export function setUnitCount(sym: LibSymbol, count: number): LibSymbol {
  const cur = unitCount(sym);
  if (count === cur) return sym;
  if (count < cur) {
    return withUnits(
      sym,
      sym.units.filter((u) => u.unit <= count),
    );
  }
  let out = sym;
  for (let ii = cur + 1; ii <= count; ii++) out = ensureUnitEntry(out, ii, 1).sym;
  return out;
}

// ----- hit testing -----------------------------------------------------------------

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx,
    py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

interface TextBoxSpec {
  text: string;
  size: number;
  at: Vec2;
  vertical: boolean;
  halign: 'left' | 'center' | 'right';
  valign: 'top' | 'center' | 'bottom';
}

function inTextBox(p: Vec2, t: TextBoxSpec): boolean {
  if (t.text === '' || t.text === '~') return false;
  const w = measureText(t.text, t.size);
  const h = t.size;
  // Local frame: x along the reading direction, y down.
  let lx: number, ly: number;
  if (t.vertical) {
    lx = t.at.y - p.y;
    ly = p.x - t.at.x;
  } else {
    lx = p.x - t.at.x;
    ly = p.y - t.at.y;
  }
  const x0 = t.halign === 'left' ? 0 : t.halign === 'right' ? -w : -w / 2;
  const y0 = t.valign === 'top' ? 0 : t.valign === 'bottom' ? -h : -h / 2;
  return lx >= x0 && lx <= x0 + w && ly >= y0 && ly <= y0 + h;
}

export interface SymbolHit {
  id: string;
  kind: SymItemKind;
}

/**
 * Hit-test the shown items at a world point (tolerance in IU) — pins by their
 * line + text boxes, graphics by stroke (interior when filled), fields by their
 * text box. Later-drawn items win (pins over body, fields on top).
 */
export function hitTestSymbol(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
  world: Vec2,
  tol: number,
  showHiddenPins: boolean,
  showHiddenFields: boolean,
): SymbolHit | null {
  // Fields first (drawn on top).
  for (let fi = sym.properties.length - 1; fi >= 0; fi--) {
    const f = sym.properties[fi]!;
    if (!f.at || f.value === '') continue;
    if (f.effects?.hidden && !showHiddenFields) continue;
    const size = f.effects?.fontSize?.[0] ?? 1.27 * 10000;
    const justify = f.effects?.justify;
    const box: TextBoxSpec = {
      text: f.nameShown ? `${f.key}: ${f.value}` : f.value,
      size,
      at: f.at,
      vertical: f.angle % 180 === 90,
      halign: justify?.includes('left') ? 'left' : justify?.includes('right') ? 'right' : 'center',
      valign: justify?.includes('top') ? 'top' : justify?.includes('bottom') ? 'bottom' : 'center',
    };
    if (inTextBox(world, box)) return { id: symItemId('field', 0, fi), kind: 'field' };
  }

  // Pins: the line segment plus the name/number text boxes.
  for (let ui = sym.units.length - 1; ui >= 0; ui--) {
    const u = sym.units[ui]!;
    if (!libUnitShown(u, unit, bodyStyle)) continue;
    for (let pi = u.pins.length - 1; pi >= 0; pi--) {
      const p = u.pins[pi]!;
      if (p.hidden && !showHiddenPins) continue;
      if (distToSegment(world, p.at, pinBodyEnd(p)) <= tol)
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
      const ni = pinNameInfo(p, sym);
      if (
        ni &&
        inTextBox(world, {
          text: ni.text,
          size: ni.size,
          at: ni.at,
          vertical: ni.vertical,
          halign: ni.halign,
          valign: ni.valign,
        })
      )
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
      const nu = pinNumberInfo(p, sym);
      if (
        nu &&
        inTextBox(world, {
          text: nu.text,
          size: nu.size,
          at: nu.at,
          vertical: nu.vertical,
          halign: nu.halign,
          valign: nu.valign,
        })
      )
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
    }
  }

  // Graphics: stroke proximity; interior counts when filled.
  for (let ui = sym.units.length - 1; ui >= 0; ui--) {
    const u = sym.units[ui]!;
    if (!libUnitShown(u, unit, bodyStyle)) continue;
    for (let gi = u.graphics.length - 1; gi >= 0; gi--) {
      const g = u.graphics[gi]!;
      if (hitGraphic(g, world, tol)) return { id: symItemId('gfx', ui, gi), kind: 'gfx' };
    }
  }
  return null;
}

function hitGraphic(g: LibGraphic, p: Vec2, tol: number): boolean {
  switch (g.kind) {
    case 'rectangle': {
      const x0 = Math.min(g.start.x, g.end.x),
        x1 = Math.max(g.start.x, g.end.x);
      const y0 = Math.min(g.start.y, g.end.y),
        y1 = Math.max(g.start.y, g.end.y);
      const inside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      if (g.fill && g.fill.type !== 'none' && inside) return true;
      const dTop = distToSegment(p, { x: x0, y: y0 }, { x: x1, y: y0 });
      const dBot = distToSegment(p, { x: x0, y: y1 }, { x: x1, y: y1 });
      const dL = distToSegment(p, { x: x0, y: y0 }, { x: x0, y: y1 });
      const dR = distToSegment(p, { x: x1, y: y0 }, { x: x1, y: y1 });
      return Math.min(dTop, dBot, dL, dR) <= tol;
    }
    case 'circle': {
      const d = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      if (g.fill && g.fill.type !== 'none' && d <= g.radius) return true;
      return Math.abs(d - g.radius) <= tol;
    }
    case 'arc': {
      // Sample the arc as a polyline for hit purposes.
      const pts = sampleArc(g.start, g.mid, g.end);
      for (let i = 1; i < pts.length; i++)
        if (distToSegment(p, pts[i - 1]!, pts[i]!) <= tol) return true;
      return false;
    }
    case 'polyline': {
      for (let i = 1; i < g.points.length; i++)
        if (distToSegment(p, g.points[i - 1]!, g.points[i]!) <= tol) return true;
      if (g.fill && g.fill.type !== 'none' && pointInPolygon(p, g.points)) return true;
      return false;
    }
    case 'text': {
      const size = g.effects?.fontSize?.[0] ?? 1.27 * 10000;
      const justify = g.effects?.justify;
      return inTextBox(p, {
        text: g.text,
        size,
        at: g.at,
        vertical: g.angle % 180 === 90,
        halign: justify?.includes('left')
          ? 'left'
          : justify?.includes('right')
            ? 'right'
            : 'center',
        valign: justify?.includes('top')
          ? 'top'
          : justify?.includes('bottom')
            ? 'bottom'
            : 'center',
      });
    }
  }
}

function sampleArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const ax = start.x,
    ay = start.y,
    bx = mid.x,
    by = mid.y,
    cx = end.x,
    cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return [start, end];
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
  const sweep = ccw ? -norm(a0 - a1) : norm(a1 - a0);
  const n = 24;
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: ux + r * Math.cos(a), y: uy + r * Math.sin(a) });
  }
  return pts;
}

function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!,
      b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Box-select: item ids fully inside (window) or touching (greedy) the rect. */
export function boxSelectSymbol(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
  a: Vec2,
  b: Vec2,
  greedy: boolean,
  showHiddenPins: boolean,
): Set<string> {
  const x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y),
    y1 = Math.max(a.y, b.y);
  const insidePt = (p: Vec2): boolean => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const out = new Set<string>();

  sym.units.forEach((u, ui) => {
    if (!libUnitShown(u, unit, bodyStyle)) return;
    u.pins.forEach((p, pi) => {
      if (p.hidden && !showHiddenPins) return;
      const tip = insidePt(p.at),
        root = insidePt(pinBodyEnd(p));
      if (greedy ? tip || root : tip && root) out.add(symItemId('pin', ui, pi));
    });
    u.graphics.forEach((g, gi) => {
      const pts = graphicPoints(g);
      const allIn = pts.every(insidePt);
      const anyIn = pts.some(insidePt);
      if (greedy ? anyIn : allIn) out.add(symItemId('gfx', ui, gi));
    });
  });
  sym.properties.forEach((f, fi) => {
    if (!f.at || f.value === '' || f.effects?.hidden) return;
    if (insidePt(f.at)) out.add(symItemId('field', 0, fi));
  });
  return out;
}

function graphicPoints(g: LibGraphic): Vec2[] {
  switch (g.kind) {
    case 'rectangle':
      return [g.start, g.end];
    case 'circle':
      return [
        { x: g.center.x - g.radius, y: g.center.y - g.radius },
        { x: g.center.x + g.radius, y: g.center.y + g.radius },
      ];
    case 'arc':
      return [g.start, g.mid, g.end];
    case 'polyline':
      return [...g.points];
    case 'text':
      return [g.at];
  }
}

export { snap, snapHalf };
