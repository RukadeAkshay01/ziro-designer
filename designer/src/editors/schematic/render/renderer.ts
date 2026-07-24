/**
 * Canvas2D renderer for a ZiroEDA schematic model.
 *
 * Framework-agnostic: it takes a 2D context, the typed Schematic, a viewport, and
 * a theme, and draws in world (internal-unit) space via a single canvas transform.
 * Grounded in KiCad's geometry: symbol graphics and pins are mapped through the
 * placement transform (rotation + mirror) exactly as KiCad does, and pin body ends
 * follow KiCad's per-orientation direction.
 */

import { CalcArcCenter, type Vec2 } from '@ziroeda/kimath';
import {
  symbolTransform,
  localToWorld,
  iuToMM,
  layoutDrawingSheet,
  defaultDrawingSheet,
  setOverbarHeightRatio,
  type WksResolveContext,
  type WksSheet,
  type Transform,
} from '@ziroeda/common';
import {
  buildWireWithHopShape,
  expandTextVars,
  refId,
  symbolBodyBBox,
  danglingPinPositions,
  danglingWireEnds,
  danglingLabelAnchors,
  type DanglingWireEnd,
  fieldShownText,
  fieldBoundingBox,
  fieldDrawRotation,
  getPageSettings,
  ITALIC_TILT,
  type BBox,
  type Schematic,
  type SchLabel,
  type LibGraphic,
  type LibSymbol,
  type LibSymbolUnit,
} from '@ziroeda/eeschema';
import type { Theme } from '../theme.js';
import { drawDrawingSheetItems } from '../../drawingsheet/wksRender.js';
import { layoutText, measureText } from '@ziroeda/common/src/font/stroke_font.js';

// Per-render state (single-threaded): the visible world rect for culling and the
// current zoom, so text below a few screen pixels is drawn cheaply.
let g_scale = 1;
let g_minX = -Infinity,
  g_minY = -Infinity,
  g_maxX = Infinity,
  g_maxY = Infinity;
function inView(minX: number, minY: number, maxX: number, maxY: number): boolean {
  return maxX >= g_minX && minX <= g_maxX && maxY >= g_minY && minY <= g_maxY;
}

// Per-document cache of symbol field layouts (shown text, bounding box, draw
// rotation): SCH_FIELD::GetBoundingBox costs a text measure + transform per
// field, far too much to redo on every pan frame of a dense sheet.
interface FieldDraw {
  key: string;
  shown: string;
  centre: Vec2;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  h: number;
  rot: 0 | 90;
  bold: boolean;
  italic: boolean;
  cssColor?: string;
  /** Hidden field, drawn ghosted only when "Show hidden fields" is on. */
  hidden?: boolean;
}
let g_fieldSch: Schematic | null = null;
let g_fieldDraws: FieldDraw[][] = [];
let g_fieldShowHidden = false;
let g_fieldResolver: RenderOpts['resolveTextVar'];
let g_subpart: RenderOpts['subpart'];
let g_fieldSubpart: RenderOpts['subpart'];

// Symbol body boxes are likewise cached per document: symbolBodyBBox walks every
// graphic of every unit through the placement transform.
let g_bboxSch: Schematic | null = null;
let g_bboxes: BBox[] = [];

function bodyBoxesFor(sch: Schematic, libById: Map<string, LibSymbol>): BBox[] {
  if (sch !== g_bboxSch) {
    g_bboxSch = sch;
    g_bboxes = sch.symbols.map((sym) => symbolBodyBBox(sym, libById.get(sym.libId)));
  }
  return g_bboxes;
}

function fieldDrawsFor(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  showHidden: boolean,
): FieldDraw[][] {
  if (
    sch === g_fieldSch &&
    showHidden === g_fieldShowHidden &&
    g_resolveText === g_fieldResolver &&
    g_subpart === g_fieldSubpart
  )
    return g_fieldDraws;
  g_fieldSch = sch;
  g_fieldShowHidden = showHidden;
  g_fieldResolver = g_resolveText;
  g_fieldSubpart = g_subpart;
  g_fieldDraws = sch.symbols.map((sym) => {
    const lib = libById.get(sym.libId);
    // A multi-unit Reference gains its unit letter (GetRef(..., true)).
    const unitCount = lib ? lib.units.reduce((m, u) => Math.max(m, u.unit), 0) : 1;
    const out: FieldDraw[] = [];
    for (const f of sym.fields) {
      if (!f.at) continue;
      if (f.effects?.hidden && !showHidden) continue;
      // GetShownText: field values expand `${VAR}` (layout uses the result).
      const shown = shownText(fieldShownText(f, sym, unitCount, g_subpart));
      if (shown === '') continue;
      const box = fieldBoundingBox(f, sym, shown, measureText);
      const fd: FieldDraw = {
        key: f.key,
        shown,
        centre: { x: box.x + Math.trunc(box.w / 2), y: box.y + Math.trunc(box.h / 2) },
        minX: box.x,
        minY: box.y,
        maxX: box.x + box.w,
        maxY: box.y + box.h,
        h: f.effects?.fontSize?.[0] ?? 1.27 * MM,
        rot: fieldDrawRotation(f, sym),
        bold: !!f.effects?.bold,
        italic: !!f.effects?.italic,
      };
      if (f.effects?.hidden) fd.hidden = true;
      if (f.effects?.color) fd.cssColor = cssColor(f.effects.color);
      out.push(fd);
    }
    return out;
  });
  return g_fieldDraws;
}

// Cache the dangling sets (pins, wire ends, labels) by document identity so
// they aren't recomputed on every pan/zoom (the schematic object is stable
// between edits).
interface DanglingSets {
  pins: readonly Vec2[];
  wireEnds: readonly DanglingWireEnd[];
  labels: readonly { pos: Vec2; kind: string }[];
}
let g_dangleSch: Schematic | null = null;
let g_dangle: DanglingSets = { pins: [], wireEnds: [], labels: [] };
function danglingFor(sch: Schematic, libById: Map<string, LibSymbol>): DanglingSets {
  if (sch !== g_dangleSch) {
    g_dangleSch = sch;
    g_dangle = {
      pins: danglingPinPositions(sch, libById),
      wireEnds: danglingWireEnds(sch, libById),
      labels: danglingLabelAnchors(sch, libById),
    };
  }
  return g_dangle;
}

/** World(IU) -> screen(px): screenX = worldX * scale + offsetX. */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Render options driven by the Preferences dialog (EESCHEMA_SETTINGS): the
 * display-options toggles, the selection/highlight pen widths and the grid
 * appearance (GAL_OPTIONS + window.grid).
 */
export interface RenderOpts {
  showHiddenPins: boolean;
  showHiddenFields: boolean;
  showPageLimits: boolean;
  /** Draw the page border + title block (LAYER_DRAWINGSHEET). Defaults to true;
   *  Print/Plot's "drawing sheet" option turns it off. */
  showDrawingSheet?: boolean;
  /** Custom drawing sheet (a loaded `.kicad_wks`), like KiCad's project
   *  `m_DrawingSheetFileName`. Unset = the built-in default stationery. */
  drawingSheet?: WksSheet;
  /** Pen width (IU) for zero-width strokes — the plot dialog's "Minimum line
   *  width" (default pen thickness). Unset = KiCad's 6-mil default. */
  defaultPenIU?: number;
  /** Effective junction-dot diameter (IU) for junctions with no explicit
   *  diameter (SCHEMATIC_SETTINGS::GetJunctionSize()). A value ≤ 1 means the
   *  user chose "None" — no dot is drawn. Unset = DEFAULT_JUNCTION_DIAM. */
  junctionDiameterIU?: number;
  /** Dashed-line dash / gap lengths as multiples of the line width
   *  (m_DashedLineDashRatio / m_DashedLineGapRatio; ISO 128-2 defaults 12 / 3). */
  dashLengthRatio?: number;
  gapLengthRatio?: number;
  /** Label / pin-text lift as a fraction of text size (m_TextOffsetRatio;
   *  default 0.15 — the Formatting panel's percent value ÷ 100). */
  textOffsetRatio?: number;
  /** Global-label box margin as a fraction of text size (m_LabelSizeRatio;
   *  default 0.375 — the Formatting panel's percent value ÷ 100). */
  labelSizeRatio?: number;
  /** Overbar Y offset as a multiple of text size (FONT_METRICS
   *  m_OverbarHeight; default 1.23). */
  overbarHeightRatio?: number;
  /** Pin decoration size in IU (m_PinSymbolSize; default 25 mil). 0 keeps
   *  KiCad's per-pin fallback: the pin's own text sizes ÷ 2. */
  pinSymbolSizeIU?: number;
  /** Wire hop-over arc radius in IU (default line width ×
   *  SCHEMATIC_SETTINGS::GetHopOverScale). Unset or 0 = no hop-overs. */
  hopOverRadiusIU?: number;
  /** Per-item netclass fallbacks (SCH_LINE::GetLineColor/GetPenWidth/
   *  GetEffectiveLineStyle, SCH_JUNCTION::getEffectiveShape): applied only
   *  where the item carries no stroke of its own. */
  netOverrides?: {
    lines: ReadonlyMap<string, { color?: string; widthIU?: number; dash?: string }>;
    junctions: ReadonlyMap<string, number>;
  };
  /** Text-variable resolver (PROJECT/TITLE_BLOCK/SCHEMATIC TextVarResolver):
   *  when set, `${VAR}` in labels, text, text boxes, tables and fields renders
   *  expanded (GetShownText). Unset = text draws verbatim. */
  resolveTextVar?: (token: string) => string | undefined;
  /** Unit-notation inputs for multi-unit references
   *  (SCHEMATIC_SETTINGS::SubReference: m_SubpartIdSeparator char code, 0 =
   *  none, and m_SubpartFirstId 'A'/'1'). Unset = plain letters (U1A). */
  subpart?: { separator: number; firstId: number };
  /** Title-block page context of the rendered sheet instance
   *  (SCH_SHEET_PATH / DS_DRAW_ITEM_LIST): the page-number *string* shown by
   *  `${#}` (SetPageNumber — may be "A", "ii", …), the sheet *ordinal*
   *  (SetSheetNumber — drives page1only/notonpage1 item visibility), the
   *  hierarchy's sheet count (`${##}`), and the sheet name / human-readable
   *  path (`${SHEETNAME}` / `${SHEETPATH}`). Unset = standalone sheet. */
  pageNumber?: string;
  sheetNumber?: number;
  sheetCount?: number;
  sheetName?: string;
  sheetPath?: string;
  /** selection.thickness (mils). */
  selectionThicknessMils: number;
  /** selection.highlight_thickness (mils). */
  highlightThicknessMils: number;
  grid: {
    show: boolean;
    sizeIU: number;
    style: 'dots' | 'lines' | 'crosses';
    lineWidthPx: number;
    minSpacingPx: number;
    /** Per-item grid overrides (ACTIONS::toggleGridOverrides): IU sizes, only
     * present when enabled + that item's override is on. */
    overrides?: {
      enabled: boolean;
      connected?: number;
      wires?: number;
      text?: number;
      graphics?: number;
    };
  };
}

export const DEFAULT_RENDER_OPTS: RenderOpts = {
  showHiddenPins: false,
  showHiddenFields: false,
  showPageLimits: true,
  selectionThicknessMils: 3,
  highlightThicknessMils: 2,
  grid: { show: true, sizeIU: 12700, style: 'dots', lineWidthPx: 1, minSpacingPx: 10 },
};

const MM = 10000; // IU per mm
const DEFAULT_LINE_WIDTH = 0.1524 * MM; // ~6 mil, KiCad default
const DEFAULT_JUNCTION_DIAM = 0.9144 * MM; // 36 mil (eeschema/default_values.h)
// The pen for zero-width strokes; plot/print override it per render via
// RenderOpts.defaultPenIU (KiCad's plot "minimum line width" setting).
let g_defaultPen = DEFAULT_LINE_WIDTH;
// The junction-dot diameter for diameter-0 junctions, from Schematic Setup >
// Formatting (SCH_JUNCTION::getEffectiveShape falls back to settings size).
let g_junctionDiam = DEFAULT_JUNCTION_DIAM;
// Dashed-line ratios (m_DashedLineDashRatio / m_DashedLineGapRatio) and the
// label/pin text lift (m_TextOffsetRatio), from Schematic Setup > Formatting.
let g_dashRatio = 12;
let g_gapRatio = 3;
let g_textOffsetRatio = 0.15;
let g_labelSizeRatio = 0.375; // DEFAULT_LABEL_SIZE_RATIO (box expansion)
let g_pinSymbolSize = 0.635 * MM; // m_PinSymbolSize (25 mil); 0 = per-pin fallback
let g_hopOverRadius = 0; // hop-over arc radius (IU); 0 = hop-overs off
// Netclass fallbacks for the current render (unset = no netclass visuals).
let g_netOverrides: RenderOpts['netOverrides'];
// Text-variable resolver for the current render (unset = draw verbatim).
let g_resolveText: RenderOpts['resolveTextVar'];
/** GetShownText: expand `${VAR}` when a resolver is active. */
function shownText(text: string): string {
  return g_resolveText && text.includes('${') ? expandTextVars(text, g_resolveText) : text;
}
const _GRID = 1.27 * MM; // 50 mil

function libUnitMatches(u: LibSymbolUnit, unit: number, bodyStyle: number): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** EDA_ANGLE::Normalize180 in radians: fold an angle into (-π, π]. */
function normalizePI(a: number): number {
  let r = a;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** KiCad `(color r g b a)` (rgb 0-255, a 0-1) -> a CSS colour. */
function cssColor(c: readonly [number, number, number, number]): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
}

/** A small padlock glyph at (x, y) marking a locked item (IU coordinates). */
function drawLockBadge(ctx: CanvasRenderingContext2D, x: number, y: number, theme: Theme): void {
  const s = 0.9 * MM; // ~0.9 mm badge
  ctx.save();
  ctx.fillStyle = theme.hidden;
  ctx.strokeStyle = theme.hidden;
  ctx.lineWidth = 0.12 * MM;
  // Shackle (arc) above the body.
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s * 0.42, s * 0.28, Math.PI, 2 * Math.PI);
  ctx.stroke();
  // Body (rounded rect) of the lock.
  ctx.fillRect(x + s * 0.14, y + s * 0.42, s * 0.72, s * 0.55);
  ctx.restore();
}

/**
 * Apply a KiCad line style to the context (STROKE_PARAMS::Stroke). Segment
 * lengths come from RENDER_SETTINGS::GetDashLength/GetGapLength/GetDotLength
 * (render_settings.cpp): with the ISO 128-2 correction of 1.0, dash =
 * (dashRatio − 1) × width, gap = (gapRatio + 1) × width, dot = 0.2 × width.
 * The ratios are Schematic Setup > Formatting's dashed-line settings.
 */
function setDash(ctx: CanvasRenderingContext2D, type: string | undefined, width: number): void {
  const w = width > 0 ? width : g_defaultPen;
  const dash = Math.max(g_dashRatio - 1, 1) * w;
  const gap = Math.max(g_gapRatio + 1, 1) * w;
  const dot = 0.2 * w;
  switch (type) {
    case 'dash':
      ctx.setLineDash([dash, gap]);
      break;
    case 'dot':
      ctx.setLineDash([dot, gap]);
      break;
    case 'dash_dot':
      ctx.setLineDash([dash, gap, dot, gap]);
      break;
    case 'dash_dot_dot':
      ctx.setLineDash([dash, gap, dot, gap, dot, gap]);
      break;
    default:
      ctx.setLineDash([]);
      break;
  }
}

/** Local body-end of a pin given its connection point, orientation and length (KiCad mapping). */
function pinBodyEnd(at: Vec2, angle: number, length: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0:
      return { x: at.x + length, y: at.y };
    case 90:
      return { x: at.x, y: at.y - length };
    case 180:
      return { x: at.x - length, y: at.y };
    case 270:
      return { x: at.x, y: at.y + length };
    default:
      return at;
  }
}

export function renderSchematic(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  viewport: Viewport,
  theme: Theme,
  canvasWidth: number,
  canvasHeight: number,
  selection?: ReadonlySet<string>,
  highlight?: ReadonlySet<string>,
  opts: RenderOpts = DEFAULT_RENDER_OPTS,
): void {
  g_defaultPen =
    opts.defaultPenIU && opts.defaultPenIU > 0 ? opts.defaultPenIU : DEFAULT_LINE_WIDTH;
  g_junctionDiam =
    opts.junctionDiameterIU && opts.junctionDiameterIU > 0
      ? opts.junctionDiameterIU
      : DEFAULT_JUNCTION_DIAM;
  g_dashRatio = opts.dashLengthRatio && opts.dashLengthRatio > 0 ? opts.dashLengthRatio : 12;
  g_gapRatio = opts.gapLengthRatio && opts.gapLengthRatio > 0 ? opts.gapLengthRatio : 3;
  g_textOffsetRatio =
    opts.textOffsetRatio !== undefined && opts.textOffsetRatio >= 0 ? opts.textOffsetRatio : 0.15;
  g_labelSizeRatio =
    opts.labelSizeRatio !== undefined && opts.labelSizeRatio >= 0 ? opts.labelSizeRatio : 0.375;
  // 0 is meaningful (per-pin fallback), so only undefined restores the default.
  g_pinSymbolSize =
    opts.pinSymbolSizeIU !== undefined && opts.pinSymbolSizeIU >= 0
      ? opts.pinSymbolSizeIU
      : PIN_SYMBOL_SIZE;
  g_hopOverRadius = opts.hopOverRadiusIU && opts.hopOverRadiusIU > 0 ? opts.hopOverRadiusIU : 0;
  g_netOverrides = opts.netOverrides;
  g_resolveText = opts.resolveTextVar;
  g_subpart = opts.subpart;
  // The stroke font draws ~{...} overbars at the settings ratio (m_OverbarHeight).
  setOverbarHeightRatio(opts.overbarHeightRatio);
  const libById = new Map<string, LibSymbol>();
  for (const lib of sch.libSymbols) libById.set(lib.libId, lib);

  // Background.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // World transform.
  const { scale, offsetX, offsetY } = viewport;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Visible world rect (+ margin) and zoom, for culling and small-text handling.
  g_scale = scale;
  const cullMargin = 4 * MM;
  g_minX = -offsetX / scale - cullMargin;
  g_minY = -offsetY / scale - cullMargin;
  g_maxX = (canvasWidth - offsetX) / scale + cullMargin;
  g_maxY = (canvasHeight - offsetY) / scale + cullMargin;

  if (opts.grid.show) drawGrid(ctx, viewport, theme, canvasWidth, canvasHeight, opts.grid);
  // Page limits (LAYER_SCHEMATIC_PAGE_LIMITS): the paper-edge outline,
  // toggled by "Show page limits" in the Display Options.
  if (opts.showPageLimits) {
    const page = paperSizeIU(sch.paper);
    if (page) {
      ctx.strokeStyle = theme.pageLimits;
      ctx.lineWidth = 0.1 * MM;
      ctx.setLineDash([]);
      ctx.strokeRect(0, 0, page.w, page.h);
    }
  }
  if (opts.showDrawingSheet !== false) drawDrawingSheet(ctx, sch, theme, opts.drawingSheet, opts);

  const hl = (id: string): boolean => highlight?.has(id) ?? false;

  // KiCad draws selection as a blue LAYER_SELECTION_SHADOWS glow *under* the item,
  // never a bounding box: a wider stroke of the item's own geometry in the shadow
  // colour, drawn before the normal render so it reads as an underglow. Width is
  // getShadowWidth(false) = selection_thickness (3 mils) as a zoom-scaled screen
  // term plus a fixed world minimum. Net highlight (magenta) is a *separate* thing.
  const SELECTION_THICKNESS_MILS = opts.selectionThicknessMils;
  const selShadowWidth =
    Math.abs(SELECTION_THICKNESS_MILS / scale) + SELECTION_THICKNESS_MILS * (0.0254 * MM);
  if (selection && selection.size > 0)
    drawSelectionShadows(
      ctx,
      sch,
      libById,
      selection,
      theme,
      theme.selectionShadow,
      selShadowWidth,
    );

  // Net highlighting, ported from SCH_PAINTER: brightened items are drawn twice —
  // once on LAYER_SELECTION_SHADOWS (a wider stroke of the brightened colour at 15%
  // alpha, i.e. getRenderColor()'s `color.WithAlpha(0.15)` branch for IsBrightened()
  // with aDrawingShadows), then again on their normal layer at full-opacity
  // LAYER_BRIGHTENED with their ordinary pen width (getRenderColor/getLineWidth with
  // aDrawingShadows == false). getShadowWidth() adds highlight_thickness (2 mils,
  // eeschema_settings.cpp) both as a screen-space term (scaled by current zoom) and as
  // a fixed minimum in world units, so the halo doesn't vanish when zoomed out.
  const HIGHLIGHT_THICKNESS_MILS = opts.highlightThicknessMils;
  const MIL = 0.0254 * MM; // 1 mil in IU
  const shadowWidth = Math.abs(HIGHLIGHT_THICKNESS_MILS / scale) + HIGHLIGHT_THICKNESS_MILS * MIL;
  const HALO_COLOR = 'rgba(255, 0, 255, 0.15)'; // LAYER_BRIGHTENED at 15% alpha

  if (highlight && highlight.size > 0) {
    ctx.strokeStyle = HALO_COLOR;
    sch.lines.forEach((line, i) => {
      if (!hl(refId('line', line.uuid, i))) return;
      const base = line.stroke && line.stroke.width > 0 ? line.stroke.width : g_defaultPen;
      ctx.lineWidth = base + shadowWidth;
      strokeLine(ctx, line.start, line.end);
    });
    // Junction shadows are drawn as a stroked ring at the junction's own radius
    // (SCH_PAINTER::draw(SCH_JUNCTION*): SetIsStroke(drawingShadows), unchanged
    // circle radius), not a bigger filled disc.
    ctx.strokeStyle = HALO_COLOR;
    sch.junctions.forEach((j, i) => {
      const jid = refId('junction', j.uuid, i);
      if (!hl(jid)) return;
      const d =
        j.diameter > 0 ? j.diameter : (g_netOverrides?.junctions.get(jid) ?? g_junctionDiam);
      if (d <= 1) return; // settings size "None": nothing to halo
      ctx.lineWidth = shadowWidth;
      ctx.beginPath();
      ctx.arc(j.at.x, j.at.y, d / 2, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  // Wires, buses and graphic polylines. Wires/buses use the theme net colours; a
  // graphic polyline uses its own stroke colour (KiCad graphics carry their colour)
  // and dash style, and draws all of its vertices — not just the first segment.
  sch.lines.forEach((line, i) => {
    const pts = line.points ?? [line.start, line.end];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!inView(minX, minY, maxX, maxY)) return;

    const on = hl(refId('line', line.uuid, i));
    // Netclass fallbacks apply only where the wire/bus carries no stroke of
    // its own (SCH_LINE::GetPenWidth / GetLineColor / GetEffectiveLineStyle).
    const nc =
      line.kind === 'wire' || line.kind === 'bus'
        ? g_netOverrides?.lines.get(refId('line', line.uuid, i))
        : undefined;
    const width =
      line.stroke && line.stroke.width > 0 ? line.stroke.width : (nc?.widthIU ?? g_defaultPen);
    // An explicit stroke colour overrides the layer colour for wires and buses
    // too (SCH_PAINTER::getRenderColor honours SCH_LINE::GetLineColor()).
    ctx.strokeStyle = on
      ? theme.netHighlight
      : line.stroke?.color
        ? cssColor(line.stroke.color)
        : nc?.color
          ? nc.color
          : line.kind === 'bus'
            ? theme.bus
            : line.kind === 'wire'
              ? theme.wire
              : theme.noteLine;
    ctx.lineWidth = width;
    const dashType =
      line.stroke?.type && line.stroke.type !== 'default'
        ? line.stroke.type
        : (nc?.dash ?? line.stroke?.type);
    setDash(ctx, dashType, width);
    // Wires/buses hop over crossing wires when the Formatting hop-over size is
    // on (SCH_PAINTER::draw(SCH_LINE): BuildWireWithHopShape segments + arcs;
    // hops are a small arc, so a solid line style gives best results).
    if ((line.kind === 'wire' || line.kind === 'bus') && g_hopOverRadius > 0) {
      for (const part of buildWireWithHopShape(line, sch.lines, g_hopOverRadius)) {
        if (part.kind === 'seg') {
          ctx.beginPath();
          ctx.moveTo(part.a.x, part.a.y);
          ctx.lineTo(part.b.x, part.b.y);
          ctx.stroke();
        } else {
          const center = CalcArcCenter(part.start, part.mid, part.end);
          const startAngle = Math.atan2(part.start.y - center.y, part.start.x - center.x);
          const midAngle = Math.atan2(part.mid.y - center.y, part.mid.x - center.x);
          const endAngle = Math.atan2(part.end.y - center.y, part.end.x - center.x);
          // EDA_ANGLE::Normalize180 on each half, then sum — keeps the sweep
          // direction through the arc's midpoint.
          const angle = normalizePI(midAngle - startAngle) + normalizePI(endAngle - midAngle);
          const radius = Math.hypot(part.start.x - center.x, part.start.y - center.y);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, startAngle, startAngle + angle, angle < 0);
          ctx.stroke();
          setDash(ctx, dashType, width);
        }
      }
      ctx.setLineDash([]);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]!.x, pts[k]!.y);
    ctx.stroke();
    if (dashType && dashType !== 'default' && dashType !== 'solid') ctx.setLineDash([]);
  });

  // Wire-to-bus entries: a 45-degree stub from `at` to `at + size`, drawn on the
  // wire layer (SCH_PAINTER::draw(SCH_BUS_ENTRY_BASE): SCH_BUS_WIRE_ENTRY -> LAYER_WIRE).
  for (const be of sch.busEntries) {
    const ex = be.at.x + be.size.x,
      ey = be.at.y + be.size.y;
    if (
      !inView(
        Math.min(be.at.x, ex),
        Math.min(be.at.y, ey),
        Math.max(be.at.x, ex),
        Math.max(be.at.y, ey),
      )
    )
      continue;
    ctx.strokeStyle = theme.wire;
    ctx.lineWidth = be.stroke && be.stroke.width > 0 ? be.stroke.width : g_defaultPen;
    ctx.beginPath();
    ctx.moveTo(be.at.x, be.at.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  // Sheet-level graphic shapes (rectangle/circle/arc on the notes layer): the
  // item's own stroke colour/dash, else LAYER_NOTES; colour fills honoured.
  for (const g of sch.graphics) drawSheetGraphic(ctx, g, theme);

  // Text boxes (SCH_TEXTBOX): bordered box with word-wrapped text inside.
  for (const tb of sch.textBoxes) drawTextBox(ctx, tb, theme);

  // Tables (SCH_TABLE): cell text, then border + row/column separators.
  for (const t of sch.tables) drawTable(ctx, t, theme);

  // Embedded bitmaps (SCH_BITMAP): centred at `at`, sized pixels x 254000/300 IU
  // (BITMAP_BASE m_pixelSizeIu for 300 ppi) x the item's scale.
  for (const im of sch.images) {
    const entry = imageFor(im);
    if (!entry) continue;
    const w = entry.img.naturalWidth * IU_PER_PIXEL * im.scale;
    const h = entry.img.naturalHeight * IU_PER_PIXEL * im.scale;
    if (!inView(im.at.x - w / 2, im.at.y - h / 2, im.at.x + w / 2, im.at.y + h / 2)) continue;
    ctx.drawImage(entry.img, im.at.x - w / 2, im.at.y - h / 2, w, h);
  }

  // Junctions (recoloured when on the highlighted net); an explicit colour
  // overrides the layer colour (SCH_JUNCTION::GetJunctionColor).
  sch.junctions.forEach((j, i) => {
    if (!inView(j.at.x, j.at.y, j.at.x, j.at.y)) return;
    const jid = refId('junction', j.uuid, i);
    // Diameter 0 = "use schematic settings" (clamped to ≥170% of the net's
    // wire width when a netclass sets one); a settings size of ≤1 IU is the
    // "None" choice — the junction exists but draws no dot (sch_junction.cpp).
    const d = j.diameter > 0 ? j.diameter : (g_netOverrides?.junctions.get(jid) ?? g_junctionDiam);
    if (d <= 1) return;
    ctx.fillStyle = hl(jid) ? theme.netHighlight : j.color ? cssColor(j.color) : theme.junction;
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, d / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // No-connect flags: KiCad's X, spanning DEFAULT_NOCONNECT_SIZE (48 mil) about
  // the point, in the LAYER_NOCONNECT colour (SCH_PAINTER::draw(SCH_NO_CONNECT)).
  if (sch.noConnects.length > 0) {
    ctx.strokeStyle = theme.noConnect;
    ctx.lineWidth = g_defaultPen;
    const delta = Math.max(NOCONNECT_SIZE, g_defaultPen * 3) / 2;
    for (const nc of sch.noConnects) {
      if (!inView(nc.at.x - delta, nc.at.y - delta, nc.at.x + delta, nc.at.y + delta)) continue;
      ctx.beginPath();
      ctx.moveTo(nc.at.x - delta, nc.at.y - delta);
      ctx.lineTo(nc.at.x + delta, nc.at.y + delta);
      ctx.moveTo(nc.at.x - delta, nc.at.y + delta);
      ctx.lineTo(nc.at.x + delta, nc.at.y - delta);
      ctx.stroke();
    }
  }

  // Placed symbols (culled to the visible rect, including their fields).
  const fieldDraws = fieldDrawsFor(sch, libById, opts.showHiddenFields);
  const bodyBoxes = bodyBoxesFor(sch, libById);
  sch.symbols.forEach((sym, si) => {
    const lib = libById.get(sym.libId);
    const bb: BBox = bodyBoxes[si]!;
    const bodyVisible = inView(bb.minX, bb.minY, bb.maxX, bb.maxY);
    if (lib && bodyVisible) {
      const t = symbolTransform(sym.angle, sym.mirror);
      const pins = {
        numbersHidden: lib.pinNumbersHidden,
        namesHidden: lib.pinNamesHidden,
        nameOffset: lib.pinNameOffset,
      };
      const symId = refId('symbol', sym.uuid, si);
      let pinIndex = 0;
      // Background fills of every unit first, then the foreground pass, so
      // the common unit's body fill never covers pin names (painter layers).
      for (const unit of lib.units) {
        if (libUnitMatches(unit, sym.unit, sym.bodyStyle))
          drawLibUnit(
            ctx,
            unit,
            sym.at,
            t,
            theme,
            pins,
            symId,
            0,
            highlight,
            shadowWidth,
            opts.showHiddenPins,
            'bg',
          );
      }
      for (const unit of lib.units) {
        if (libUnitMatches(unit, sym.unit, sym.bodyStyle))
          pinIndex = drawLibUnit(
            ctx,
            unit,
            sym.at,
            t,
            theme,
            pins,
            symId,
            pinIndex,
            highlight,
            shadowWidth,
            opts.showHiddenPins,
            'fg',
          );
      }
    }
    // Fields are painted exactly as KiCad's SCH_PAINTER::draw(SCH_FIELD): the
    // field's bounding box (text box rotated by the field angle, mapped through
    // the symbol transform — SCH_FIELD::GetBoundingBox) is computed once per
    // document (cached below) and the text is stroked CENTER/CENTER at the box
    // centre with the draw rotation (GetDrawRotation).
    for (const fd of fieldDraws[si] ?? []) {
      if (!inView(fd.minX, fd.minY, fd.maxX, fd.maxY)) continue;
      const color = fd.hidden
        ? theme.hidden
        : (fd.cssColor ??
          (fd.key === 'Reference'
            ? theme.reference
            : fd.key === 'Value'
              ? theme.value
              : theme.fields));
      drawText(ctx, fd.shown, fd.centre, fd.h, color, undefined, fd.rot, fd.bold, fd.italic);
    }
    // Locked symbols show a small padlock at the body's top-left corner
    // (SCH_PAINTER draws a lock overlay for SCH_ITEM::IsLocked items).
    if (sym.locked && bodyVisible) drawLockBadge(ctx, bb.minX, bb.minY, theme);
  });

  // Labels and free text (culled).
  for (const l of sch.labels) {
    if (l.effects?.hidden) continue;
    const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
    const span = h * (Math.max(1, l.text.length) + 4);
    if (!inView(l.at.x - span, l.at.y - span, l.at.x + span, l.at.y + span)) continue;
    drawLabel(ctx, l, theme);
  }

  // Hierarchical sheets (SCH_PAINTER::draw(SCH_SHEET)): optional colour fill,
  // border in the sheet's own stroke colour or LAYER_SHEET, the Sheetname /
  // Sheetfile fields, and pins drawn exactly as hierarchical labels (the
  // painter casts SCH_SHEET_PIN to SCH_HIERLABEL) in the LAYER_SHEETLABEL colour.
  for (const sh of sch.sheets) {
    const pad = 8 * MM; // fields sit just outside the rectangle
    if (!inView(sh.at.x - pad, sh.at.y - pad, sh.at.x + sh.size.w + pad, sh.at.y + sh.size.h + pad))
      continue;
    const border = sh.stroke?.color ? cssColor(sh.stroke.color) : theme.sheetBorder;
    const bw = sh.stroke && sh.stroke.width > 0 ? sh.stroke.width : g_defaultPen;
    if (sh.fillColor) {
      ctx.fillStyle = cssColor(sh.fillColor);
      ctx.fillRect(sh.at.x, sh.at.y, sh.size.w, sh.size.h);
    }
    ctx.strokeStyle = border;
    ctx.lineWidth = bw;
    ctx.setLineDash([]);
    ctx.strokeRect(sh.at.x, sh.at.y, sh.size.w, sh.size.h);

    for (const f of sh.fields) {
      if (!f.at || f.effects?.hidden || f.value === '') continue;
      // SCH_FIELD::GetShownText prefixes the filename field (sch_field.cpp).
      const text = f.key === 'Sheetfile' ? `File: ${f.value}` : f.value;
      const color =
        f.key === 'Sheetname'
          ? theme.sheetName
          : f.key === 'Sheetfile'
            ? theme.sheetFile
            : theme.label;
      const h = f.effects?.fontSize?.[0] ?? 1.27 * MM;
      drawText(
        ctx,
        text,
        f.at,
        h,
        color,
        f.effects?.justify,
        f.angle % 180 === 90 ? 90 : 0,
        f.effects?.bold,
        f.effects?.italic,
      );
    }

    for (const p of sh.pins) {
      const fake: SchLabel = {
        kind: 'hierarchical_label',
        text: p.name,
        at: p.at,
        // Sheet-pin angle encodes the side (0=right, 90=top, 180=left, 270=bottom);
        // the flag orientation comes from angle + justify like a hier label.
        angle: p.angle === 90 || p.angle === 270 ? 90 : 0,
        shape: p.shape,
        source: p.source,
        ...(p.effects ? { effects: p.effects } : {}),
      };
      drawLabel(ctx, fake, { ...theme, hierLabel: theme.sheetLabel });
    }
  }

  // Dangling-pin targets: KiCad draws an open circle (TARGET_PIN_RADIUS = 15 mil,
  // thickness = penWidth/3, in the pin colour Brightened(0.3)) on every pin with no
  // connection (drawPinDanglingIndicator). Cached by document identity so it isn't
  // recomputed on every pan/zoom, and culled to the visible rect.
  const dangling = danglingFor(sch, libById);
  if (dangling.pins.length > 0) {
    ctx.strokeStyle = brighten(theme.pin, 0.3);
    ctx.lineWidth = g_defaultPen / 3;
    for (const p of dangling.pins) {
      if (!inView(p.x, p.y, p.x, p.y)) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, TARGET_PIN_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Dangling wire ends and label anchors get the small square
  // (drawDanglingIndicator): half-side = line width + DANGLING_SYMBOL_SIZE/2
  // (6 mil), stroked at the dangling-indicator thickness (default pen / 3) in
  // the item's colour Brightened(0.3) so it reads over a junction dot.
  const MIL6 = 1524; // 6 mil in IU
  if (dangling.wireEnds.length > 0 || dangling.labels.length > 0) {
    ctx.lineWidth = g_defaultPen / 3;
    ctx.setLineDash([]);
    ctx.strokeStyle = brighten(theme.wire, 0.3);
    for (const d of dangling.wireEnds) {
      if (!inView(d.pos.x, d.pos.y, d.pos.x, d.pos.y)) continue;
      const w = d.strokeWidth > 0 ? d.strokeWidth : g_defaultPen;
      const r = w + MIL6;
      ctx.strokeRect(d.pos.x - r, d.pos.y - r, r * 2, r * 2);
    }
    // Labels pass aWidth = DANGLING_SYMBOL_SIZE/2, so their square is 24 mil.
    const rLabel = MIL6 + MIL6;
    for (const d of dangling.labels) {
      if (!inView(d.pos.x, d.pos.y, d.pos.x, d.pos.y)) continue;
      const color =
        d.kind === 'global_label'
          ? theme.globalLabel
          : d.kind === 'hierarchical_label'
            ? theme.hierLabel
            : theme.label;
      ctx.strokeStyle = brighten(color, 0.3);
      ctx.strokeRect(d.pos.x - rLabel, d.pos.y - rLabel, rLabel * 2, rLabel * 2);
    }
  }
}

/** Draw one sheet-level graphic shape (notes layer). */
function drawSheetGraphic(ctx: CanvasRenderingContext2D, g: LibGraphic, theme: Theme): void {
  if (g.kind === 'text') return; // free text arrives via labels, not graphics
  const stroke = g.stroke;
  const width = stroke && stroke.width > 0 ? stroke.width : g_defaultPen;
  const color = stroke?.color ? cssColor(stroke.color) : theme.noteLine;
  const fill = g.fill?.type === 'color' && g.fill.color ? cssColor(g.fill.color) : null;

  // Cheap culling per shape.
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
  if (!inView(minX, minY, maxX, maxY)) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  setDash(ctx, stroke?.type, width);
  if (fill) ctx.fillStyle = fill;
  if (g.kind === 'arc') {
    // drawArc manages its own path (and fills the segment when asked).
    if (fill) drawArc(ctx, g.start, g.mid, g.end, true);
    else drawArc(ctx, g.start, g.mid, g.end);
  } else {
    ctx.beginPath();
    if (g.kind === 'rectangle') {
      ctx.rect(
        Math.min(g.start.x, g.end.x),
        Math.min(g.start.y, g.end.y),
        Math.abs(g.end.x - g.start.x),
        Math.abs(g.end.y - g.start.y),
      );
    } else if (g.kind === 'circle') {
      ctx.arc(g.center.x, g.center.y, g.radius, 0, Math.PI * 2);
    } else {
      g.points.forEach((p: Vec2, i: number) =>
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
      );
    }
    if (fill) ctx.fill();
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/**
 * KiCad interline pitch for the stroke font: METRICS::m_InterlinePitch (1.68) x
 * STROKE_FONT::LEGACY_FACTOR (0.9583). Line N's baseline sits N*pitch below the first.
 */
const INTERLINE = 1.68 * 0.9583;

/** Word-wrap `text` into lines fitting `maxWidth` at font `height` (KiCad LinebreakText). */
function wrapTextBox(text: string, maxWidth: number, height: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let cur = '';
    for (const word of para.split(' ')) {
      const trial = cur === '' ? word : `${cur} ${word}`;
      if (cur === '' || measureText(trial, height) <= maxWidth) cur = trial;
      else {
        out.push(cur);
        cur = word;
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Draw a text box (SCH_TEXTBOX): its border rectangle + fill, then the text
 * word-wrapped inside the box minus margins, honouring justification (default
 * left/top). Grounded in KiCad's SCH_TEXTBOX::GetShownText / GetDrawPos.
 */
function drawTextBox(
  ctx: CanvasRenderingContext2D,
  tbIn: Schematic['textBoxes'][number],
  theme: Theme,
): void {
  // GetShownText: expand `${VAR}` before wrapping (substitution changes widths).
  const tb =
    g_resolveText && tbIn.text.includes('${') ? { ...tbIn, text: shownText(tbIn.text) } : tbIn;
  const x0 = Math.min(tb.start.x, tb.end.x),
    x1 = Math.max(tb.start.x, tb.end.x);
  const y0 = Math.min(tb.start.y, tb.end.y),
    y1 = Math.max(tb.start.y, tb.end.y);
  if (!inView(x0, y0, x1, y1)) return;

  const stroke = tb.stroke;
  const width = stroke && stroke.width > 0 ? stroke.width : g_defaultPen;
  const borderColor = stroke?.color ? cssColor(stroke.color) : theme.noteLine;
  const textColor = tb.effects?.color ? cssColor(tb.effects.color) : theme.noteLine;
  const fill =
    tb.fill?.type === 'color' && tb.fill.color
      ? cssColor(tb.fill.color)
      : tb.fill?.type === 'background'
        ? theme.background
        : null;

  // Border + fill. A width-0 default border still draws (KiCad draws the outline).
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke?.type !== 'none') {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = width;
    setDash(ctx, stroke?.type, width);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Wrapped text inside the box minus margins.
  const m = tb.margins ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const h = tb.effects?.fontSize?.[0] ?? 12700;
  const bold = tb.effects?.bold ?? false;
  const italic = tb.effects?.italic ?? false;
  const innerW = x1 - x0 - m.left - m.right;
  if (innerW <= 0 || tb.text === '') return;
  const lines = wrapTextBox(tb.text, innerW, h);
  const pitch = h * INTERLINE;
  const justify = tb.effects?.justify ?? ['left', 'top'];
  const right = justify.includes('right'),
    hcenter = justify.includes('center') && !justify.includes('left') && !justify.includes('right');
  const bottom = justify.includes('bottom'),
    vcenter = justify.includes('center');

  const anchorX = right ? x1 - m.right : hcenter ? (x0 + m.left + x1 - m.right) / 2 : x0 + m.left;
  const hj: readonly string[] = right ? ['right'] : hcenter ? ['center'] : ['left'];
  const blockH = (lines.length - 1) * pitch + h;
  const innerTop = y0 + m.top,
    innerBot = y1 - m.bottom;
  const firstBaseTop = bottom
    ? innerBot - blockH + h
    : vcenter
      ? (innerTop + innerBot) / 2 - blockH / 2 + h
      : innerTop + h;

  lines.forEach((line, i) => {
    // drawText takes the top of the cap box when justify includes 'top'; pass the
    // per-line top so each wrapped row sits pitch apart.
    drawText(
      ctx,
      line,
      { x: anchorX, y: firstBaseTop - h + i * pitch },
      h,
      textColor,
      [...hj, 'top'],
      0,
      bold,
      italic,
    );
  });
}

/** Draw word-wrapped text inside the box [x0,y0]-[x1,y1] minus margins (shared by cells). */
function drawBoxText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x0: number,
  y0: number,
  x1: number,
  _y1: number,
  m: { left: number; top: number; right: number; bottom: number },
  effects: Schematic['textBoxes'][number]['effects'],
  color: string,
): void {
  const h = effects?.fontSize?.[0] ?? 12700;
  const innerW = x1 - x0 - m.left - m.right;
  if (innerW <= 0 || text === '') return;
  const lines = wrapTextBox(text, innerW, h);
  const pitch = h * INTERLINE;
  const justify = effects?.justify ?? ['left', 'top'];
  const right = justify.includes('right'),
    hcenter = justify.includes('center') && !justify.includes('left') && !justify.includes('right');
  const anchorX = right ? x1 - m.right : hcenter ? (x0 + m.left + x1 - m.right) / 2 : x0 + m.left;
  const hj: readonly string[] = right ? ['right'] : hcenter ? ['center'] : ['left'];
  const top = y0 + m.top;
  lines.forEach((line, i) => {
    drawText(
      ctx,
      line,
      { x: anchorX, y: top + i * pitch },
      h,
      color,
      [...hj, 'top'],
      0,
      effects?.bold ?? false,
      effects?.italic ?? false,
    );
  });
}

/**
 * Draw a table (SCH_TABLE): each cell's wrapped text, then the row/column
 * separators and the external border. Grounded in SCH_TABLE::Plot ordering
 * (cells first, grid lines last).
 */
function drawTable(
  ctx: CanvasRenderingContext2D,
  t: Schematic['tables'][number],
  theme: Theme,
): void {
  if (t.cells.length === 0) return;
  // Table extent from the cells.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of t.cells) {
    x0 = Math.min(x0, c.start.x, c.end.x);
    y0 = Math.min(y0, c.start.y, c.end.y);
    x1 = Math.max(x1, c.start.x, c.end.x);
    y1 = Math.max(y1, c.start.y, c.end.y);
  }
  if (!inView(x0, y0, x1, y1)) return;

  const color = theme.noteLine;
  const border = t.borderStroke && t.borderStroke.width > 0 ? t.borderStroke.width : g_defaultPen;
  const sep =
    t.separatorsStroke && t.separatorsStroke.width > 0 ? t.separatorsStroke.width : g_defaultPen;

  // Cell text.
  const m = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const c of t.cells) {
    const cm = c.margins ?? m;
    drawBoxText(
      ctx,
      shownText(c.text),
      Math.min(c.start.x, c.end.x),
      Math.min(c.start.y, c.end.y),
      Math.max(c.start.x, c.end.x),
      Math.max(c.start.y, c.end.y),
      cm,
      c.effects,
      color,
    );
  }

  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';

  // Column separators (internal vertical lines), from cumulative column widths.
  if (t.separatorCols) {
    ctx.lineWidth = sep;
    let x = x0;
    for (let c = 0; c < t.colWidths.length - 1; c++) {
      x += t.colWidths[c]!;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
  }
  // Row separators (internal horizontal lines). The first one is the header separator.
  let y = y0;
  for (let r = 0; r < t.rowHeights.length - 1; r++) {
    y += t.rowHeights[r]!;
    const isHeader = r === 0;
    if ((isHeader && t.borderHeader) || (!isHeader && t.separatorRows)) {
      ctx.lineWidth = sep;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }

  // External border around the whole table.
  if (t.borderExternal) {
    ctx.lineWidth = border;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// ----- embedded bitmaps -------------------------------------------------------

// BITMAP_BASE: m_pixelSizeIu = 254000 / ppi with the default 300 ppi.
const IU_PER_PIXEL = 254000 / 300;

interface ImageEntry {
  img: HTMLImageElement;
  ready: boolean;
}
const g_images = new Map<string, ImageEntry>();
let g_invalidate: (() => void) | null = null;

/** The canvas registers its redraw here so images repaint once they decode. */
export function setRenderInvalidator(fn: (() => void) | null): void {
  g_invalidate = fn;
}

function imageFor(im: { data: string; uuid?: string }): ImageEntry | null {
  if (typeof Image === 'undefined' || im.data === '') return null;
  const key = im.uuid ?? im.data.slice(0, 64);
  let entry = g_images.get(key);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false };
    img.onload = () => {
      entry!.ready = true;
      g_invalidate?.();
    };
    img.src = `data:image/png;base64,${im.data}`;
    g_images.set(key, entry);
  }
  return entry.ready ? entry : null;
}

// TARGET_PIN_RADIUS (sch_pin.h): dangling-pin circle radius and the N.C. pin
// cross arm length, 15 mil.
const TARGET_PIN_RADIUS = 0.381 * MM;

// KiCad DEFAULT_NOCONNECT_SIZE: 48 mil.
const NOCONNECT_SIZE = 1.2192 * MM;

// SCH_RENDER_SETTINGS::m_PinSymbolSize (25 mil): the fixed size of pin
// decorations — negation bubble radius, clock notch, polarity slopes.
const PIN_SYMBOL_SIZE = 0.635 * MM;

// KiCad's ERC marker: MarkerShapeCorners (marker_base.cpp) scaled by 0.15 mm
// (sch_marker.cpp SCALING_FACTOR) — the little bent arrow anchored at the fault.
const MARKER_SHAPE: readonly (readonly [number, number])[] = [
  [0, 0],
  [8, 1],
  [4, 3],
  [13, 8],
  [9, 9],
  [8, 13],
  [3, 4],
  [1, 8],
  [0, 0],
];
const MARKER_SCALE = 0.15 * MM;

/** An ERC marker to draw: position + severity (colour). */
export interface MarkerDraw {
  at: Vec2;
  severity: 'error' | 'warning';
}

/** Draw ERC markers over the schematic (sets its own canvas transform). */
export function drawErcMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly MarkerDraw[],
  viewport: Viewport,
  theme: Theme,
): void {
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);
  for (const m of markers) {
    ctx.fillStyle = m.severity === 'error' ? theme.ercError : theme.ercWarning;
    ctx.beginPath();
    MARKER_SHAPE.forEach(([x, y], i) => {
      const px = m.at.x + x * MARKER_SCALE;
      const py = m.at.y + y * MARKER_SCALE;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
}

/** KiCad COLOR4D::Brightened(f): move the colour a fraction f toward white.
 *  Accepts both `#rrggbb` and the theme's `rgb(r, g, b)` forms. */
function brighten(color: string, f: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) {
    return `rgb(${mix(parseInt(hex[1]!, 16))}, ${mix(parseInt(hex[2]!, 16))}, ${mix(parseInt(hex[3]!, 16))})`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (rgb) {
    return `rgb(${mix(Number(rgb[1]))}, ${mix(Number(rgb[2]))}, ${mix(Number(rgb[3]))})`;
  }
  return color;
}

// ----- labels (SCH_LABEL / GLOBALLABEL / HIERLABEL / TEXT) -------------------

// SPIN_STYLE: LEFT=0, UP=1, RIGHT=2, BOTTOM=3 (KiCad spin_style.h).
const SPIN = { LEFT: 0, UP: 1, RIGHT: 2, BOTTOM: 3 } as const;

/** KiCad SCH_LABEL_BASE::GetSpinStyle(): from text angle + horizontal justify. */
function labelSpin(angle: number, justify?: readonly string[]): number {
  const vertical = (((angle % 360) + 360) % 360) % 180 === 90;
  const right = justify?.includes('right') ?? false;
  if (vertical) return right ? SPIN.BOTTOM : SPIN.UP;
  return right ? SPIN.LEFT : SPIN.RIGHT;
}

// Hierarchical-label flag polygons, transcribed from KiCad's TemplateShape table.
// Indexed [shape][spin]; each entry is (x,y) multipliers of halfSize (textHeight/2).
// Shapes: 0 input, 1 output, 2 bidirectional, 3 tri_state, 4 passive(unspecified).
// Spins:  0 LEFT(HN), 1 UP, 2 RIGHT(HI), 3 BOTTOM.
const HIER_TEMPLATES: number[][][] = [
  [
    // input
    [0, 0, -1, -1, -2, -1, -2, 1, -1, 1, 0, 0],
    [0, 0, 1, -1, 1, -2, -1, -2, -1, -1, 0, 0],
    [0, 0, 1, 1, 2, 1, 2, -1, 1, -1, 0, 0],
    [0, 0, 1, 1, 1, 2, -1, 2, -1, 1, 0, 0],
  ],
  [
    // output
    [-2, 0, -1, 1, 0, 1, 0, -1, -1, -1, -2, 0],
    [0, -2, 1, -1, 1, 0, -1, 0, -1, -1, 0, -2],
    [2, 0, 1, -1, 0, -1, 0, 1, 1, 1, 2, 0],
    [0, 2, 1, 1, 1, 0, -1, 0, -1, 1, 0, 2],
  ],
  [
    // bidirectional
    [0, 0, -1, -1, -2, 0, -1, 1, 0, 0],
    [0, 0, -1, -1, 0, -2, 1, -1, 0, 0],
    [0, 0, 1, -1, 2, 0, 1, 1, 0, 0],
    [0, 0, -1, 1, 0, 2, 1, 1, 0, 0],
  ],
  [
    // tri_state (same outline as bidirectional)
    [0, 0, -1, -1, -2, 0, -1, 1, 0, 0],
    [0, 0, -1, -1, 0, -2, 1, -1, 0, 0],
    [0, 0, 1, -1, 2, 0, 1, 1, 0, 0],
    [0, 0, -1, 1, 0, 2, 1, 1, 0, 0],
  ],
  [
    // passive / unspecified
    [0, -1, -2, -1, -2, 1, 0, 1, 0, -1],
    [1, 0, 1, -2, -1, -2, -1, 0, 1, 0],
    [0, -1, 2, -1, 2, 1, 0, 1, 0, -1],
    [1, 0, 1, 2, -1, 2, -1, 0, 1, 0],
  ],
];

const SHAPE_INDEX: Record<string, number> = {
  input: 0,
  output: 1,
  bidirectional: 2,
  tri_state: 3,
  passive: 4,
};
/** Rotate a point by the spin style, as KiCad's global-label CreateGraphicShape does. */
function spinRotate(p: Vec2, spin: number): Vec2 {
  switch (spin) {
    case SPIN.UP:
      return { x: p.y, y: -p.x }; // -90°
    case SPIN.RIGHT:
      return { x: -p.x, y: -p.y }; // 180°
    case SPIN.BOTTOM:
      return { x: -p.y, y: p.x }; // +90°
    default:
      return p; // LEFT
  }
}

/** When `shadow` is set, draw only the blue selection underglow (wider strokes, no text). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  l: SchLabel,
  theme: Theme,
  shadow?: { color: string; width: number },
): void {
  // GetShownText: labels and free text expand `${VAR}` before layout, so the
  // flag box and centring use the substituted width.
  if (g_resolveText && l.text.includes('${')) l = { ...l, text: shownText(l.text) };
  const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
  const spin = labelSpin(l.angle, l.effects?.justify);
  // Free text uses its own font colour when set, else the notes-layer blue
  // (LAYER_NOTES, rgb(0,0,194) in KiCad's default theme) — not the label black.
  const color = shadow
    ? shadow.color
    : l.kind === 'global_label'
      ? theme.globalLabel
      : l.kind === 'hierarchical_label'
        ? theme.hierLabel
        : l.kind === 'text'
          ? l.effects?.color
            ? cssColor(l.effects.color)
            : theme.noText
          : theme.label;
  // SCH_LABEL_BASE::GetSchematicTextOffset: lift the text clear of the wire by
  // m_TextOffsetRatio x text size plus the pen width (sch_label.cpp).
  const dist = Math.round(g_textOffsetRatio * h) + g_defaultPen;
  // Reading direction unit vector for the spin style (where the text flows).
  const flow =
    spin === SPIN.LEFT
      ? { x: -1, y: 0 }
      : spin === SPIN.RIGHT
        ? { x: 1, y: 0 }
        : spin === SPIN.UP
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };

  ctx.lineWidth = shadow ? g_defaultPen + shadow.width : g_defaultPen;
  ctx.strokeStyle = color;

  if (l.kind === 'hierarchical_label' || l.kind === 'global_label') {
    const halfSize = h / 2;
    if (l.kind === 'hierarchical_label') {
      const tpl = HIER_TEMPLATES[SHAPE_INDEX[l.shape ?? 'input'] ?? 0]![spin]!;
      const pts: Vec2[] = [];
      for (let i = 0; i < tpl.length; i += 2)
        pts.push({ x: l.at.x + halfSize * tpl[i]!, y: l.at.y + halfSize * tpl[i + 1]! });
      polygon(ctx, pts, false, true);
      // Text sits just beyond the flag (which spans ~2*halfSize from the anchor).
      const off = 2 * halfSize + dist;
      if (!shadow)
        drawText(
          ctx,
          l.text,
          { x: l.at.x + flow.x * off, y: l.at.y + flow.y * off },
          h,
          color,
          justifyFor(spin),
        );
    } else {
      // Global label: 6-point box (margined) with a notch/point per shape, then
      // spin-rotated. Margin = m_LabelSizeRatio × text size
      // (SCH_LABEL_BASE::GetLabelBoxExpansion).
      const margin = g_labelSizeRatio * h;
      const hs = halfSize + margin;
      const symbLen = Math.max(1, l.text.length) * h * 0.62 + 2 * margin;
      const x = symbLen + 3,
        y = hs + 3;
      const box: { x: number; y: number }[] = [
        { x: 0, y: 0 },
        { x: 0, y: -y },
        { x: -x, y: -y },
        { x: -x, y: 0 },
        { x: -x, y },
        { x: 0, y },
      ];
      let xoff = 0;
      const s = l.shape ?? 'bidirectional';
      if (s === 'input') {
        xoff = -hs;
        box[0]!.x += hs;
      } else if (s === 'output') {
        box[3]!.x -= hs;
      } else if (s === 'bidirectional' || s === 'tri_state') {
        xoff = -hs;
        box[0]!.x += hs;
        box[3]!.x -= hs;
      }
      const pts = box.map((p) => {
        const r = spinRotate({ x: p.x + xoff, y: p.y }, spin);
        return { x: l.at.x + r.x, y: l.at.y + r.y };
      });
      polygon(ctx, pts, false, true);
      // Centre the text in the box (box centre is at -symbLen/2 along the reading axis).
      const c = spinRotate({ x: -x / 2 + xoff, y: 0 }, spin);
      if (!shadow) drawText(ctx, l.text, { x: l.at.x + c.x, y: l.at.y + c.y }, h, color);
    }
    return;
  }

  // Free text (SCH_TEXT): drawn exactly at its anchor with its stored
  // justification and angle — KiCad applies no wire offset to plain text.
  if (l.kind === 'text') {
    if (shadow) {
      const len = Math.max(1, l.text.length) * h * 0.6;
      strokeLine(ctx, l.at, { x: l.at.x + len, y: l.at.y });
      return;
    }
    drawText(
      ctx,
      l.text,
      l.at,
      h,
      color,
      l.effects?.justify ?? ['left', 'bottom'],
      l.angle % 180 === 90 ? 90 : 0,
      l.effects?.bold ?? false,
      l.effects?.italic ?? false,
    );
    return;
  }

  // Local label: text lifted off the wire perpendicular to it (x for vertical
  // spins, y for horizontal — sch_label.cpp GetSchematicTextOffset), drawn with
  // the file's own justification (which carries the 'bottom' that keeps the
  // glyphs fully clear of the wire) and rotated for vertical spins.
  const perp = spin === SPIN.UP || spin === SPIN.BOTTOM ? { x: -dist, y: 0 } : { x: 0, y: -dist };
  const anchor = { x: l.at.x + perp.x, y: l.at.y + perp.y };
  if (shadow) {
    // No flag to glow: underline the text run in the reading direction as the cue.
    const len = Math.max(1, l.text.length) * h * 0.6;
    const from =
      spin === SPIN.LEFT || spin === SPIN.BOTTOM
        ? { x: anchor.x - flow.x * len, y: anchor.y - flow.y * len }
        : anchor;
    const to = { x: from.x + flow.x * len, y: from.y + flow.y * len };
    strokeLine(ctx, from, to);
    return;
  }
  const vertical = spin === SPIN.UP || spin === SPIN.BOTTOM;
  drawText(
    ctx,
    l.text,
    anchor,
    h,
    color,
    l.effects?.justify ?? [...justifyFor(spin), 'bottom'],
    vertical ? 90 : 0,
    l.effects?.bold ?? false,
    l.effects?.italic ?? false,
  );
}

/** Text justification for a spin style: anchored at the connection point, reading outward. */
function justifyFor(spin: number): string[] {
  switch (spin) {
    case SPIN.LEFT:
      return ['right'];
    case SPIN.UP:
      return ['left'];
    case SPIN.BOTTOM:
      return ['right'];
    default:
      return ['left']; // RIGHT
  }
}

/**
 * KiCad-style selection: a blue LAYER_SELECTION_SHADOWS glow drawn *under* each
 * selected item by re-stroking the item's own geometry wider in the shadow colour
 * (SCH_PAINTER draws selected items on the shadow layer at getShadowWidth() extra
 * width). Wires, junctions, symbol bodies + pins, and label flags/anchors each get
 * the halo; there is no bounding box, matching the desktop app.
 */
function drawSelectionShadows(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
  theme: Theme,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  // Wires / buses: wider stroke of the segment.
  sch.lines.forEach((l, i) => {
    if (!selection.has(refId('line', l.uuid, i))) return;
    const base = l.stroke && l.stroke.width > 0 ? l.stroke.width : g_defaultPen;
    ctx.lineWidth = base + width;
    strokeLine(ctx, l.start, l.end);
  });

  // Junctions: a slightly larger filled disc under the dot.
  sch.junctions.forEach((j, i) => {
    const jid = refId('junction', j.uuid, i);
    if (!selection.has(jid)) return;
    const d = j.diameter > 0 ? j.diameter : (g_netOverrides?.junctions.get(jid) ?? g_junctionDiam);
    if (d <= 1) return; // settings size "None": no dot to underlay
    const r = d / 2 + width / 2;
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  // No-connect flags: a wider X under the mark.
  sch.noConnects.forEach((nc, i) => {
    if (!selection.has(refId('noconnect', nc.uuid, i))) return;
    ctx.lineWidth = g_defaultPen + width;
    const delta = Math.max(NOCONNECT_SIZE, g_defaultPen * 3) / 2;
    ctx.beginPath();
    ctx.moveTo(nc.at.x - delta, nc.at.y - delta);
    ctx.lineTo(nc.at.x + delta, nc.at.y + delta);
    ctx.moveTo(nc.at.x - delta, nc.at.y + delta);
    ctx.lineTo(nc.at.x + delta, nc.at.y - delta);
    ctx.stroke();
  });

  // Symbols: re-stroke the body graphics and pins in the shadow colour.
  sch.symbols.forEach((sym, i) => {
    if (!selection.has(refId('symbol', sym.uuid, i))) return;
    const lib = libById.get(sym.libId);
    if (!lib) return;
    const t = symbolTransform(sym.angle, sym.mirror);
    for (const unit of lib.units)
      if (libUnitMatches(unit, sym.unit, sym.bodyStyle))
        drawLibUnitShadow(ctx, unit, sym.at, t, color, width);
  });

  // Labels: re-stroke the flag/box geometry wider in the shadow colour.
  sch.labels.forEach((l, i) => {
    if (l.effects?.hidden || !selection.has(refId('label', l.uuid, i))) return;
    drawLabel(ctx, l, theme, { color, width });
  });

  // Sheets: re-stroke the rectangle wider.
  sch.sheets.forEach((sh, i) => {
    if (!selection.has(refId('sheet', sh.uuid, i))) return;
    const bw = sh.stroke && sh.stroke.width > 0 ? sh.stroke.width : g_defaultPen;
    ctx.lineWidth = bw + width;
    ctx.strokeRect(sh.at.x, sh.at.y, sh.size.w, sh.size.h);
  });
}

interface PinDisplay {
  numbersHidden: boolean;
  namesHidden: boolean;
  nameOffset: number;
}

/** Local-space unit vector pointing from a pin's connection point toward the body. */
function pinDir(angle: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0:
      return { x: 1, y: 0 };
    case 90:
      return { x: 0, y: -1 };
    case 180:
      return { x: -1, y: 0 };
    default:
      return { x: 0, y: 1 };
  }
}

/** Underglow for a selected symbol: re-stroke its body graphics and pins wider in `color`. */
function drawLibUnitShadow(
  ctx: CanvasRenderingContext2D,
  unit: LibSymbolUnit,
  origin: Vec2,
  t: Transform,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  for (const g of unit.graphics) {
    const base =
      g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width : g_defaultPen;
    ctx.lineWidth = base + width;
    switch (g.kind) {
      case 'rectangle': {
        const corners = [
          { x: g.start.x, y: g.start.y },
          { x: g.end.x, y: g.start.y },
          { x: g.end.x, y: g.end.y },
          { x: g.start.x, y: g.end.y },
        ].map((c) => localToWorld(origin, t, c));
        polygon(ctx, corners, false, true);
        break;
      }
      case 'polyline':
      case 'bezier':
        polygon(
          ctx,
          g.points.map((p) => localToWorld(origin, t, p)),
          false,
          false,
        );
        break;
      case 'circle': {
        const c = localToWorld(origin, t, g.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, g.radius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc':
        drawArc(
          ctx,
          localToWorld(origin, t, g.start),
          localToWorld(origin, t, g.mid),
          localToWorld(origin, t, g.end),
          false,
        );
        break;
      case 'text':
        break; // text has no stroke halo
    }
  }
  ctx.lineWidth = g_defaultPen + width;
  for (const pin of unit.pins) {
    if (pin.hidden) continue;
    const a = localToWorld(origin, t, pin.at);
    const b = localToWorld(origin, t, pinBodyEnd(pin.at, pin.angle, pin.length));
    strokeLine(ctx, a, b);
  }
}

function drawLibUnit(
  ctx: CanvasRenderingContext2D,
  unit: LibSymbolUnit,
  origin: Vec2,
  t: Transform,
  theme: Theme,
  pins: PinDisplay,
  symId?: string,
  pinIndexStart = 0,
  highlight?: ReadonlySet<string>,
  shadowWidth = 0,
  showHiddenPins = false,
  // SCH_PAINTER paints LAYER_DEVICE_BACKGROUND for *every* unit before any
  // LAYER_DEVICE content, so a later unit's body fill (the common _0_x unit)
  // can never cover another unit's outlines or pin text. Callers run the
  // 'bg' phase across all units first, then the 'fg' phase.
  phase: 'bg' | 'fg' | 'all' = 'all',
): number {
  // Two passes matching SCH_PAINTER's layer order: background/custom fills
  // first (LAYER_DEVICE_BACKGROUND), then outlines and outline-colour fills
  // (LAYER_DEVICE) — so a filled body never covers a neighbour's outline.
  const tracePath = (g: (typeof unit.graphics)[number]): boolean => {
    switch (g.kind) {
      case 'rectangle': {
        const corners = [
          { x: g.start.x, y: g.start.y },
          { x: g.end.x, y: g.start.y },
          { x: g.end.x, y: g.end.y },
          { x: g.start.x, y: g.end.y },
        ].map((c) => localToWorld(origin, t, c));
        ctx.beginPath();
        ctx.moveTo(corners[0]!.x, corners[0]!.y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
        ctx.closePath();
        return true;
      }
      case 'polyline': {
        const pts = g.points.map((p) => localToWorld(origin, t, p));
        if (pts.length === 0) return false;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        return true;
      }
      case 'bezier': {
        const pts = g.points.map((p) => localToWorld(origin, t, p));
        if (pts.length < 4) return false;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        ctx.bezierCurveTo(pts[1]!.x, pts[1]!.y, pts[2]!.x, pts[2]!.y, pts[3]!.x, pts[3]!.y);
        return true;
      }
      case 'circle': {
        const c = localToWorld(origin, t, g.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, g.radius, 0, Math.PI * 2);
        return true;
      }
      default:
        return false;
    }
  };

  // Pass 1: LAYER_DEVICE_BACKGROUND — body-background and custom-colour fills.
  if (phase !== 'fg') {
    for (const g of unit.graphics) {
      if (g.kind === 'text') continue;
      const fillType = g.fill?.type;
      if (fillType !== 'background' && fillType !== 'color') continue;
      ctx.fillStyle =
        fillType === 'color' && g.fill?.color ? cssColor(g.fill.color) : theme.symbolFill;
      if (g.kind === 'arc') {
        drawArc(
          ctx,
          localToWorld(origin, t, g.start),
          localToWorld(origin, t, g.mid),
          localToWorld(origin, t, g.end),
          true,
          false,
        );
      } else if (tracePath(g)) {
        ctx.fill();
      }
    }
    if (phase === 'bg') return pinIndexStart;
  }

  // Pass 2: LAYER_DEVICE — outlines, outline-colour (FILLED_SHAPE) fills, text.
  for (const g of unit.graphics) {
    const lw = g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width : g_defaultPen;
    ctx.lineWidth = lw;
    ctx.strokeStyle = theme.symbolOutline;
    ctx.fillStyle = theme.symbolOutline;

    if (g.kind === 'text') {
      const p = localToWorld(origin, t, g.at);
      drawText(
        ctx,
        g.text,
        p,
        g.effects?.fontSize?.[0] ?? 1.27 * MM,
        theme.symbolOutline,
        g.effects?.justify,
        g.angle,
      );
      continue;
    }

    const outlineFilled = g.fill?.type === 'outline';
    if (g.kind === 'arc') {
      drawArc(
        ctx,
        localToWorld(origin, t, g.start),
        localToWorld(origin, t, g.mid),
        localToWorld(origin, t, g.end),
        outlineFilled,
      );
    } else if (tracePath(g)) {
      if (outlineFilled) ctx.fill();
      ctx.stroke();
    }
  }

  // Pins (SCH_PAINTER::draw(SCH_PIN) + PIN_LAYOUT_CACHE placement).
  const DEFAULT_TEXT = 1.27 * MM;
  // getPinTextOffset: MilsToIU(round(24 * m_TextOffsetRatio)), default ratio 0.15.
  const TEXT_OFFSET = Math.round(24 * g_textOffsetRatio) * 254;
  let pinIndex = pinIndexStart;
  for (const pin of unit.pins) {
    const idx = pinIndex++;
    // Hidden pins are skipped unless "Show hidden pins" is on, which draws
    // them ghosted in the LAYER_HIDDEN colour (SCH_PAINTER's force_show path).
    if (pin.hidden && !showHiddenPins) continue;
    const hiddenGhost = pin.hidden;
    // Per-pin text sizes; a stored size of 0 means "not drawn" (KiCad lays the text
    // out at zero height — Altium imports hide pin names this way and put graphic
    // text in the body instead).
    const NUM = pin.numberSize ?? DEFAULT_TEXT;
    const NAME = pin.nameSize ?? DEFAULT_TEXT;
    // externalPinDecoSize / internalPinDecoSize (sch_painter.cpp): the
    // Schematic Setup m_PinSymbolSize when set; a value of 0 falls back to the
    // pin's own text sizes (number/2 for external decorations — negation
    // bubble, polarity slopes — and name/2, else number/2, for the clock).
    const radius = g_pinSymbolSize > 0 ? g_pinSymbolSize : NUM / 2;
    const diam = radius * 2;
    const clockSize = g_pinSymbolSize > 0 ? g_pinSymbolSize : NAME !== 0 ? NAME / 2 : NUM / 2;

    const endLocal = pinBodyEnd(pin.at, pin.angle, pin.length);
    const pos = localToWorld(origin, t, pin.at); // connection point (tip)
    const p0 = localToWorld(origin, t, endLocal); // pin root (at the body)
    // Direction from the root toward the tip, in world space (painter's `dir`) —
    // computed after the symbol transform so rotated/mirrored symbols lay their
    // decorations and text out exactly like upstream.
    const len = pin.length;
    const dir =
      len > 0
        ? { x: Math.sign(pos.x - p0.x), y: Math.sign(pos.y - p0.y) }
        : { x: -pinDir(pin.angle).x, y: -pinDir(pin.angle).y };

    const line = (ax: number, ay: number, bx: number, by: number) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    const triLine = (a1: Vec2, a2: Vec2, a3: Vec2) => {
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.lineTo(a3.x, a3.y);
      ctx.stroke();
    };

    /** The pin line plus its GRAPHIC_PINSHAPE decoration (sch_painter.cpp). */
    const strokePinBody = (): void => {
      if (pin.electricalType === 'no_connect') {
        // N.C. pins draw the line plus an X at the connection point, with
        // arms of TARGET_PIN_RADIUS (15 mil, sch_pin.h).
        const R = TARGET_PIN_RADIUS;
        line(p0.x, p0.y, pos.x, pos.y);
        line(pos.x - R, pos.y - R, pos.x + R, pos.y + R);
        line(pos.x + R, pos.y - R, pos.x - R, pos.y + R);
        return;
      }

      const clockNotch = () => {
        // Triangle pointing into the body at the pin root.
        const pc = { x: p0.x - dir.x * clockSize, y: p0.y - dir.y * clockSize };
        triLine({ x: p0.x + dir.y * clockSize, y: p0.y - dir.x * clockSize }, pc, {
          x: p0.x - dir.y * clockSize,
          y: p0.y + dir.x * clockSize,
        });
      };
      const lowSlope = () => {
        // IEEE active-low input slope outside the body.
        if (!dir.y) {
          triLine(
            { x: p0.x + dir.x * diam, y: p0.y },
            { x: p0.x + dir.x * diam, y: p0.y - diam },
            p0,
          );
        } else {
          triLine(
            { x: p0.x, y: p0.y + dir.y * diam },
            { x: p0.x - diam, y: p0.y + dir.y * diam },
            p0,
          );
        }
      };

      switch (pin.shape) {
        case 'inverted':
        case 'inverted_clock': {
          ctx.beginPath();
          ctx.arc(p0.x + dir.x * radius, p0.y + dir.y * radius, radius, 0, Math.PI * 2);
          ctx.stroke();
          line(p0.x + dir.x * diam, p0.y + dir.y * diam, pos.x, pos.y);
          if (pin.shape === 'inverted_clock') clockNotch();
          break;
        }
        case 'clock':
          line(p0.x, p0.y, pos.x, pos.y);
          clockNotch();
          break;
        case 'clock_low':
        case 'edge_clock_high': // FALLING_EDGE_CLOCK draws identically upstream
          clockNotch();
          lowSlope();
          line(p0.x, p0.y, pos.x, pos.y);
          break;
        case 'input_low':
          line(p0.x, p0.y, pos.x, pos.y);
          lowSlope();
          break;
        case 'output_low':
          line(p0.x, p0.y, pos.x, pos.y);
          if (!dir.y) line(p0.x, p0.y - diam, p0.x + dir.x * diam, p0.y);
          else line(p0.x - diam, p0.y, p0.x, p0.y + dir.y * diam);
          break;
        case 'non_logic':
          line(p0.x, p0.y, pos.x, pos.y);
          line(
            p0.x - (dir.x + dir.y) * radius,
            p0.y - (dir.y - dir.x) * radius,
            p0.x + (dir.x + dir.y) * radius,
            p0.y + (dir.y - dir.x) * radius,
          );
          line(
            p0.x - (dir.x - dir.y) * radius,
            p0.y - (dir.x + dir.y) * radius,
            p0.x + (dir.x - dir.y) * radius,
            p0.y + (dir.x + dir.y) * radius,
          );
          break;
        default:
          line(p0.x, p0.y, pos.x, pos.y);
      }
    };

    // Brightened pin (on the highlighted net): shadow-pass halo behind, then the
    // pin redrawn in the brightened colour, exactly like the wire/junction pass.
    const brightened = symId !== undefined && (highlight?.has(`${symId}:pin${idx}`) ?? false);
    if (brightened) {
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.15)';
      ctx.lineWidth = g_defaultPen + shadowWidth;
      strokePinBody();
    }
    ctx.strokeStyle = brightened ? '#ff00ff' : hiddenGhost ? theme.hidden : theme.pin;
    ctx.lineWidth = g_defaultPen;
    strokePinBody();

    // ----- pin name/number placement (PIN_LAYOUT_CACHE) ----------------------
    const horiz = dir.y === 0;
    const textAngle = horiz ? 0 : 90;
    const mid = { x: (pos.x + p0.x) / 2, y: (pos.y + p0.y) / 2 };
    const nameShown = !pins.namesHidden && NAME > 0 && !!pin.name && pin.name !== '~';
    const numberShown = !pins.numbersHidden && NUM > 0 && !!pin.number && pin.number !== '~';
    const nameInside = pins.nameOffset > 0;

    if (numberShown) {
      // The number is centred along the pin: above it, or below when the name
      // is shown outside (name above / number below).
      const below = nameShown && !nameInside;
      const off = (NUM / 2 + TEXT_OFFSET) * (below ? 1 : -1);
      const anchor = horiz ? { x: mid.x, y: mid.y + off } : { x: mid.x + off, y: mid.y };
      drawText(
        ctx,
        pin.number,
        anchor,
        NUM,
        hiddenGhost ? theme.hidden : theme.pinNumber,
        undefined,
        textAngle,
      );
    }

    if (nameShown) {
      if (nameInside) {
        // Inside the body, just past the pin root, reading outward.
        const anchor = {
          x: p0.x - dir.x * pins.nameOffset,
          y: p0.y - dir.y * pins.nameOffset,
        };
        // Rotated (vertical) text advances upward on screen, so the side the
        // text extends toward flips with the pin direction.
        const justify = horiz ? [dir.x < 0 ? 'left' : 'right'] : [dir.y < 0 ? 'right' : 'left'];
        drawText(
          ctx,
          pin.name,
          anchor,
          NAME,
          hiddenGhost ? theme.hidden : theme.pinName,
          justify,
          textAngle,
        );
      } else {
        // Outside: centred over the middle of the pin.
        const off = NAME / 2 + TEXT_OFFSET;
        const anchor = horiz ? { x: mid.x, y: mid.y - off } : { x: mid.x - off, y: mid.y };
        drawText(
          ctx,
          pin.name,
          anchor,
          NAME,
          hiddenGhost ? theme.hidden : theme.pinName,
          undefined,
          textAngle,
        );
      }
    }
  }
  return pinIndex;
}

// ----- primitives -----------------------------------------------------------

function strokeLine(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function polygon(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: boolean, close: boolean): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  if (close) ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

/**
 * Draw a circular arc through three points (KiCad stores arcs as start/mid/end).
 * When `fill` is set, the arc's circular segment is filled (the path is implicitly
 * closed by the chord for filling but only the arc itself is stroked) — matching
 * KiCad, where a filled arc combines with its sibling polyline to form e.g. a gate
 * body, and the shared chord edge is never stroked.
 */
function drawArc(
  ctx: CanvasRenderingContext2D,
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  fill = false,
  stroke = true,
): void {
  const ax = start.x,
    ay = start.y,
    bx = mid.x,
    by = mid.y,
    cx = end.x,
    cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) {
    if (stroke) strokeLine(ctx, start, end); // collinear: degenerate to a segment
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
  // Choose sweep direction so the arc passes through the mid point.
  const ccw = !isBetween(a0, aMid, a1);
  ctx.beginPath();
  ctx.arc(ux, uy, r, a0, a1, ccw);
  if (fill) ctx.fill(); // fills the segment (arc + chord); does not affect the stroked path
  if (stroke) ctx.stroke();
}

function isBetween(a0: number, aMid: number, a1: number): boolean {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const s = norm(a1 - a0);
  const m = norm(aMid - a0);
  return m <= s;
}

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
): void {
  if (text === '' || text === '~') return;

  const cap = heightIU;
  const right = justify?.includes('right'),
    left = justify?.includes('left');
  const top = justify?.includes('top'),
    bottom = justify?.includes('bottom');

  // KiCad reads 90°/rotated text turned counter-clockwise (screen y is down).
  const a = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(-a),
    sin = Math.sin(-a);
  const _placeAt = (x: number, y: number): Vec2 => ({
    x: at.x + x * cos - y * sin,
    y: at.y + x * sin + y * cos,
  });

  // Real glyphs at every zoom (KiCad keeps stroking text however small); below
  // ~0.6 screen px a run is sub-pixel noise, so it is skipped entirely.
  if (heightIU * g_scale < 0.6) return;

  // KiCad strokes schematic text with the Newstroke font. The glyph run is built
  // once into a Path2D (baseline-left origin, italic shear baked in) and cached
  // by text+size, then placed per call with a canvas transform — retained paths
  // make dense sheets (hundreds of labels/pin names) pan smoothly.
  const width = glyphRun(text, heightIU, italic).width;
  const offX = right ? -width : left ? 0 : -width / 2; // default: centre
  const offY = top ? cap : bottom ? 0 : cap / 2; // baseline placement; default: middle

  ctx.save();
  ctx.translate(at.x, at.y);
  if (a !== 0) ctx.rotate(-a); // matches placeAt's screen-space rotation
  ctx.translate(offX, offY);
  ctx.strokeStyle = color;
  // KiCad text pen: normal text uses the constant default pen (6 mil —
  // EDA_TEXT::GetEffectiveTextPenWidth), capped by ClampTextPenSize at
  // 0.25 × size for tiny text; bold = size/5 (GetPenSizeForBold).
  ctx.lineWidth = bold ? heightIU / 5 : Math.min(g_defaultPen, heightIU * 0.25);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Vector-text mode strokes segments directly (capturable by the SVG adapter);
  // canvas keeps the retained Path2D fast path.
  if (g_vectorText) strokeGlyphs(ctx, text, heightIU, italic);
  else ctx.stroke(textPath(text, heightIU, italic).path);
  ctx.restore();
}

// Vector-text mode (Plot to SVG): stroke glyph segments directly onto the
// context instead of a retained Path2D, so a non-canvas 2D context (the SVG
// adapter) can record them. Canvas rendering keeps the fast cached-path route.
let g_vectorText = false;
export function setVectorText(on: boolean): void {
  g_vectorText = on;
}

// Retained glyph runs: text+size+italic -> sheared polylines (baseline-left
// origin) + advance width, cached by text+size. (A crude size cap resets the
// cache; real sheets stay well under it.)
const g_glyphRuns = new Map<string, { strokes: Vec2[][]; width: number }>();

function glyphRun(
  text: string,
  size: number,
  italic: boolean,
): { strokes: Vec2[][]; width: number } {
  const key = `${size}|${italic ? 1 : 0}|${text}`;
  let entry = g_glyphRuns.get(key);
  if (!entry) {
    const { strokes, width } = layoutText(text, size);
    // Italic: STROKE_GLYPH::Transform shears each point right by y·ITALIC_TILT
    // (y is negative above the baseline, so tops lean right) — glyph.cpp.
    const tilt = italic ? ITALIC_TILT : 0;
    const sheared: Vec2[][] = strokes.map((stroke) =>
      stroke.map((pt) => ({ x: pt.x - pt.y * tilt, y: pt.y })),
    );
    if (g_glyphRuns.size > 6000) g_glyphRuns.clear();
    entry = { strokes: sheared, width };
    g_glyphRuns.set(key, entry);
  }
  return entry;
}

// Retained Path2D per glyph run (canvas fast path only).
const g_textPaths = new Map<string, Path2D>();

function textPath(text: string, size: number, italic: boolean): { path: Path2D; width: number } {
  const { strokes, width } = glyphRun(text, size, italic);
  const key = `${size}|${italic ? 1 : 0}|${text}`;
  let path = g_textPaths.get(key);
  if (!path) {
    path = new Path2D();
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      const p0 = stroke[0]!;
      path.moveTo(p0.x, p0.y);
      if (stroke.length === 1)
        path.lineTo(p0.x + 0.01, p0.y); // lone point -> dot
      else for (let i = 1; i < stroke.length; i++) path.lineTo(stroke[i]!.x, stroke[i]!.y);
    }
    if (g_textPaths.size > 6000) g_textPaths.clear();
    g_textPaths.set(key, path);
  }
  return { path, width };
}

/** Stroke a glyph run directly onto the context (vector-text mode). */
function strokeGlyphs(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  italic: boolean,
): void {
  const { strokes } = glyphRun(text, size, italic);
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const p0 = stroke[0]!;
    ctx.moveTo(p0.x, p0.y);
    if (stroke.length === 1) ctx.lineTo(p0.x + 0.01, p0.y);
    else for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i]!.x, stroke[i]!.y);
    ctx.stroke();
  }
}

// ----- drawing sheet (page frame + title block) ------------------------------
//
// KiCad's default drawing sheet (common/drawing_sheet/
// drawing_sheet_default_description.cpp): 10 mm margins, a double border 2 mm
// apart, a coordinate band with 50 mm divisions (numbers across, letters down),
// and the 110 x 34 mm title block in the bottom-right corner with the
// title-block variables resolved. Drawn in LAYER_SCHEMATIC_DRAWINGSHEET red.

/** Paper sizes in mm (landscape), from common/page_info.cpp. */
const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

/** Page size for a `(paper ...)` token in IU, or null when unknown. Handles
 *  the custom form `User <w> <h>` (millimetres) as well as the named sizes. */
export function paperSizeIU(paper: string | undefined): { w: number; h: number } | null {
  if (!paper) return null;
  const parts = paper.split(/\s+/);
  if (parts[0] === 'User') {
    const w = Number(parts[1]);
    const h = Number(parts[2]);
    if (w > 0 && h > 0) return { w: w * MM, h: h * MM };
    return null;
  }
  const dims = PAPER_MM[parts[0]!];
  if (!dims) return null;
  const portrait = parts.includes('portrait');
  const [w, h] = portrait ? [dims[1], dims[0]] : dims;
  return { w: w! * MM, h: h! * MM };
}

/** No drawing-sheet item is ever "selected" on the schematic canvas. */
const NO_DS_SELECTION: ReadonlySet<number> = new Set();

function drawDrawingSheet(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  theme: Theme,
  sheet?: WksSheet,
  // Sheet-instance page context (RenderOpts subset) for the title block.
  opts: Pick<
    RenderOpts,
    'pageNumber' | 'sheetNumber' | 'sheetCount' | 'sheetName' | 'sheetPath'
  > = {},
): void {
  const page = paperSizeIU(sch.paper);
  if (!page) return;
  // Render the real default drawing sheet through the same resolver + painter
  // pl_editor uses (layoutDrawingSheet → drawDrawingSheetItems), so every
  // title-block variable is substituted from the document — including the
  // company line and Comment 1-4, which the previous hand-rolled block dropped
  // (it also hardcoded the version, sheet id and path).
  const ps = getPageSettings(sch);
  const resolveCtx: WksResolveContext = {
    // Page context from the sheet instance (SCH_SHEET_PATH): ordinal for the
    // page1only visibility, page string for ${#}, count for ${##}, and the
    // human-readable path for ${SHEETPATH}. A standalone sheet is 1/1 at "/".
    pageNumber: opts.sheetNumber ?? 1,
    ...(opts.pageNumber !== undefined ? { pageName: opts.pageNumber } : {}),
    sheetCount: opts.sheetCount ?? 1,
    title: ps.title,
    rev: ps.rev,
    date: ps.date,
    company: ps.company,
    comments: [...ps.comments],
    paper: ps.paper,
    fileName: sch.fileName ?? '',
    ...(opts.sheetName !== undefined ? { sheetName: opts.sheetName } : {}),
    sheetPath: opts.sheetPath ?? '/',
    appVersion: 'ZiroEDA',
  };
  const draws = layoutDrawingSheet(
    sheet ?? defaultDrawingSheet(),
    { widthMM: iuToMM(page.w), heightMM: iuToMM(page.h) },
    resolveCtx,
  );
  drawDrawingSheetItems(ctx, draws, NO_DS_SELECTION, {
    color: theme.pageFrame,
    // 1-device-pixel pen floor keeps hairlines visible when zoomed out.
    minWidth: g_scale > 0 ? 1 / g_scale : 1,
  });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  theme: Theme,
  canvasWidth: number,
  canvasHeight: number,
  grid: RenderOpts['grid'],
): void {
  // Visible world bounds (inverse of the viewport transform).
  const left = -viewport.offsetX / viewport.scale;
  const top = -viewport.offsetY / viewport.scale;
  const right = (canvasWidth - viewport.offsetX) / viewport.scale;
  const bottom = (canvasHeight - viewport.offsetY) / viewport.scale;

  // GAL grid density limit: double the drawn step until it clears the
  // configured minimum on-screen spacing (gal options "Minimum grid spacing").
  let step = grid.sizeIU;
  const minPx = Math.max(2, grid.minSpacingPx);
  while (step * viewport.scale < minPx) step *= 2;

  ctx.fillStyle = theme.grid;
  ctx.strokeStyle = theme.grid;
  const px = Math.max(1, grid.lineWidthPx) / viewport.scale; // grid pen, in world units
  const x0 = Math.ceil(left / step) * step;
  const y0 = Math.ceil(top / step) * step;

  if (grid.style === 'lines') {
    ctx.lineWidth = px;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let x = x0; x <= right; x += step) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = y0; y <= bottom; y += step) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
    return;
  }
  if (grid.style === 'crosses') {
    ctx.lineWidth = px;
    ctx.setLineDash([]);
    const arm = 3 / viewport.scale; // ~3 px arms
    ctx.beginPath();
    for (let x = x0; x <= right; x += step) {
      for (let y = y0; y <= bottom; y += step) {
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y + arm);
      }
    }
    ctx.stroke();
    return;
  }
  // Dots.
  const dot = Math.max(0.15 * MM, px);
  for (let x = x0; x <= right; x += step) {
    for (let y = y0; y <= bottom; y += step) {
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  }
}

/** Render a single library symbol centred and scaled into a preview canvas. */
export function renderSymbolPreview(
  ctx: CanvasRenderingContext2D,
  lib: LibSymbol,
  width: number,
  height: number,
  theme: Theme,
  unit = 1,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const units = lib.units.filter((u) => libUnitMatches(u, unit > 0 ? unit : 1, 1));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const inc = (p: Vec2) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const u of units) {
    for (const g of u.graphics) {
      if (g.kind === 'rectangle') {
        inc(g.start);
        inc(g.end);
      } else if (g.kind === 'polyline' || g.kind === 'bezier') g.points.forEach(inc);
      else if (g.kind === 'circle') {
        inc({ x: g.center.x - g.radius, y: g.center.y - g.radius });
        inc({ x: g.center.x + g.radius, y: g.center.y + g.radius });
      } else if (g.kind === 'arc') {
        inc(g.start);
        inc(g.mid);
        inc(g.end);
      } else inc(g.at);
    }
    // Hidden pins (e.g. power) sit far from the body; excluding them keeps the
    // visible symbol from being shrunk to a dot, matching KiCad's preview fit.
    for (const pin of u.pins) {
      if (pin.hidden) continue;
      inc(pin.at);
      inc(pinBodyEnd(pin.at, pin.angle, pin.length));
    }
  }
  if (!Number.isFinite(minX)) {
    ctx.fillStyle = '#888';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No preview', width / 2, height / 2);
    return;
  }

  const bw = maxX - minX || 1,
    bh = maxY - minY || 1;
  const scale = Math.min(width / (bw * 1.35), height / (bh * 1.35));
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  ctx.setTransform(scale, 0, 0, scale, width / 2 - cx * scale, height / 2 - cy * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pins = {
    numbersHidden: lib.pinNumbersHidden,
    namesHidden: lib.pinNamesHidden,
    nameOffset: lib.pinNameOffset,
  };
  // Background fills of every unit, then foreground (painter layer order).
  for (const u of units)
    drawLibUnit(
      ctx,
      u,
      { x: 0, y: 0 },
      symbolTransform(0),
      theme,
      pins,
      undefined,
      0,
      undefined,
      0,
      false,
      'bg',
    );
  for (const u of units)
    drawLibUnit(
      ctx,
      u,
      { x: 0, y: 0 },
      symbolTransform(0),
      theme,
      pins,
      undefined,
      0,
      undefined,
      0,
      false,
      'fg',
    );
}

/** Compute a viewport that fits the schematic content into the given canvas size. */
export function fitToContent(sch: Schematic, canvasWidth: number, canvasHeight: number): Viewport {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (p: Vec2) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const l of sch.lines) {
    include(l.start);
    include(l.end);
  }
  for (const j of sch.junctions) include(j.at);
  for (const s of sch.symbols) {
    include(s.at);
    for (const f of s.fields) if (f.at) include(f.at);
  }
  for (const l of sch.labels) include(l.at);
  for (const sh of sch.sheets) {
    include(sh.at);
    include({ x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h });
  }
  // The drawing sheet is part of the scene: fit shows the whole page (as KiCad does).
  const page = paperSizeIU(sch.paper);
  if (page) {
    include({ x: 0, y: 0 });
    include({ x: page.w, y: page.h });
  }

  if (!Number.isFinite(minX))
    return { scale: 0.02, offsetX: canvasWidth / 2, offsetY: canvasHeight / 2 };

  const pad = 8 * MM;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;
  const scale = Math.min(canvasWidth / w, canvasHeight / h);
  const offsetX = canvasWidth / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = canvasHeight / 2 - ((minY + maxY) / 2) * scale;
  return { scale, offsetX, offsetY };
}

/** Fit the viewport to an explicit world-space box (Zoom to Selected Objects). */
export function fitToBBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const pad = 8 * MM;
  const minX = box.minX - pad;
  const minY = box.minY - pad;
  const maxX = box.maxX + pad;
  const maxY = box.maxY + pad;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = Math.min(canvasWidth / w, canvasHeight / h);
  return {
    scale,
    offsetX: canvasWidth / 2 - ((minX + maxX) / 2) * scale,
    offsetY: canvasHeight / 2 - ((minY + maxY) / 2) * scale,
  };
}

export { iuToMM };
