/**
 * Gerber X2 + Excellon plot writers — the fabrication-output core of
 * pcbnew's plot dialog, transcribed from GERBER_PLOTTER::StartPlot
 * (common/plotters/GERBER_plotter.cpp), the TF attribute builders
 * (pcbnew/pcbplot.cpp AddGerberX2Header / GetGerberFileFunctionAttribute)
 * and GENDRILL_EXCELLON_WRITER (pcbnew/exporters/gendrill_excellon_writer.cpp).
 *
 * Format 4.6 mm, leading zeros omitted, absolute (%FSLAX46Y46*%), Y negated
 * like KiCad's plot origin. Geometry covered: tracks/arcs (stroked), vias and
 * pads (flashed; rotated rect pads become G36 regions), zone fills (regions),
 * board/footprint graphics (stroked, arcs/circles linearized). Stroked text is
 * not yet plotted (KiCad strokes glyphs; staged).
 */

import type { Board, PcbPad, PcbShape } from './types.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { tessellateArc, rotatePcb } from './read-board.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Fractional digits for the 4.x format; the dialog offers 4.5 / 4.6. */
let coordDigits = 6;
/** IU -> Gerber 4.x integer (mm · 10^digits). */
const g = (iu: number): string => String(Math.round(iuToMM(iu) * 10 ** coordDigits));
/** A coordinate pair with KiCad's negated Y. */
const xy = (p: Vec2): string => `X${g(p.x)}Y${g(-p.y)}`;
/** mm with a forced decimal point (aperture definitions). */
const fmm = (iu: number): string => iuToMM(iu).toFixed(6);

/** TF.FileFunction per layer (pcbplot.cpp GetGerberFileFunctionAttribute). */
export function gerberFileFunction(layer: string, copperCount: number): string {
  if (layer === 'F.Cu') return 'Copper,L1,Top';
  if (layer === 'B.Cu') return `Copper,L${copperCount},Bot`;
  const inner = /^In(\d+)\.Cu$/.exec(layer);
  if (inner) return `Copper,L${Number(inner[1]) + 1},Inr`;
  const map: Record<string, string> = {
    'F.Mask': 'Soldermask,Top',
    'B.Mask': 'Soldermask,Bot',
    'F.SilkS': 'Legend,Top',
    'B.SilkS': 'Legend,Bot',
    'F.Paste': 'Paste,Top',
    'B.Paste': 'Paste,Bot',
    'F.Adhes': 'Glue,Top',
    'B.Adhes': 'Glue,Bot',
    'Edge.Cuts': 'Profile,NP',
    'F.Fab': 'AssemblyDrawing,Top',
    'B.Fab': 'AssemblyDrawing,Bot',
    'Dwgs.User': 'OtherDrawing,Comment',
    'Cmts.User': 'Other,Comment',
    'Eco1.User': 'Other,ECO1',
    'Eco2.User': 'Other,ECO2',
  };
  return map[layer] ?? 'Other,Comment';
}

/** FilePolarity: negative for soldermask, positive for the graphic layers. */
const filePolarity = (layer: string): string => (/\.Mask$/.test(layer) ? 'Negative' : 'Positive');

/** Protel filename extension (pcbplot GetGerberProtelExtension). */
export function gerberProtelExtension(layer: string): string {
  const map: Record<string, string> = {
    'F.Cu': 'gtl',
    'B.Cu': 'gbl',
    'F.Mask': 'gts',
    'B.Mask': 'gbs',
    'F.SilkS': 'gto',
    'B.SilkS': 'gbo',
    'F.Paste': 'gtp',
    'B.Paste': 'gbp',
    'Edge.Cuts': 'gm1',
  };
  return map[layer] ?? 'gbr';
}

const onLayer = (layers: string[], layer: string): boolean =>
  layers.some((l) => l === layer || (l.startsWith('*.') && layer.endsWith(l.slice(1))));

interface Aperture {
  key: string;
  def: string; // the %ADD payload after the D-code, e.g. "C,0.200000"
  dcode: number;
}

/** Plot one layer to Gerber X2 text. */
export function plotGerberLayer(
  board: Board,
  layer: string,
  opts: { creationDate?: string; coordDigits?: 5 | 6 } = {},
): string {
  coordDigits = opts.coordDigits ?? 6;
  const copperCount = board.layers.filter((l) => /\.Cu$/.test(l.name)).length || 2;
  const apertures = new Map<string, Aperture>();
  let nextD = 10;
  const aperture = (def: string): Aperture => {
    let a = apertures.get(def);
    if (!a) {
      a = { key: def, def, dcode: nextD++ };
      apertures.set(def, a);
    }
    return a;
  };
  // Body ops recorded as [apertureKey, commands] so the aperture list can be
  // emitted first, then the body replayed grouped by D-code selection.
  const body: { ap: Aperture; cmds: string[] }[] = [];
  const stroke = (pts: Vec2[], width: number): void => {
    if (pts.length < 2) return;
    const ap = aperture(`C,${fmm(Math.max(width, 1))}`);
    const cmds = [`${xy(pts[0]!)}D02*`];
    for (let i = 1; i < pts.length; i++) cmds.push(`${xy(pts[i]!)}D01*`);
    body.push({ ap, cmds });
  };
  const flash = (def: string, at: Vec2): void => {
    body.push({ ap: aperture(def), cmds: [`${xy(at)}D03*`] });
  };
  const region = (pts: Vec2[]): void => {
    if (pts.length < 3) return;
    // Regions carry no aperture but Gerber requires a current one; reuse/create
    // a hairline.
    const ap = aperture(`C,${fmm(1)}`);
    const cmds = ['G36*', `${xy(pts[0]!)}D02*`];
    for (let i = 1; i < pts.length; i++) cmds.push(`${xy(pts[i]!)}D01*`);
    cmds.push(`${xy(pts[0]!)}D01*`, 'G37*');
    body.push({ ap, cmds });
  };

  const shapePlot = (s: PcbShape): void => {
    if (s.layer !== layer) return;
    const w = Math.max(s.width, 1);
    if (s.kind === 'line' && s.start && s.end) stroke([s.start, s.end], w);
    else if (s.kind === 'arc' && s.start && s.mid && s.end)
      stroke(tessellateArc(s.start, s.mid, s.end), w);
    else if (s.kind === 'circle' && s.center && s.end) {
      const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
      const pts: Vec2[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push({ x: s.center.x + r * Math.cos(a), y: s.center.y + r * Math.sin(a) });
      }
      if (s.fill) region(pts);
      else stroke(pts, w);
    } else if (s.kind === 'rect' && s.start && s.end) {
      const c = [
        s.start,
        { x: s.end.x, y: s.start.y },
        s.end,
        { x: s.start.x, y: s.end.y },
        s.start,
      ];
      if (s.fill) region(c.slice(0, 4));
      else stroke(c, w);
    } else if (s.pts && s.pts.length >= 2) {
      if (s.fill && s.pts.length >= 3) region(s.pts);
      else stroke([...s.pts, ...(s.kind === 'poly' ? [s.pts[0]!] : [])], w);
    }
  };

  const padPlot = (p: PcbPad): void => {
    if (!onLayer(p.layers, layer)) return;
    const rot = (((p.angle ?? 0) % 360) + 360) % 360;
    const axisAligned = rot % 90 === 0;
    const w = rot % 180 === 90 ? p.size.y : p.size.x;
    const h = rot % 180 === 90 ? p.size.x : p.size.y;
    if (p.shape === 'circle') flash(`C,${fmm(p.size.x)}`, p.at);
    else if (axisAligned && (p.shape === 'rect' || p.shape === 'roundrect'))
      flash(`R,${fmm(w)}X${fmm(h)}`, p.at);
    else if (axisAligned && p.shape === 'oval') flash(`O,${fmm(w)}X${fmm(h)}`, p.at);
    else {
      // Rotated / complex pads: plot the outline as a region.
      const hw = p.size.x / 2;
      const hh = p.size.y / 2;
      const corners: Vec2[] = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ].map((c) => {
        const r = rotatePcb(c, -(p.angle ?? 0));
        return { x: r.x + p.at.x, y: r.y + p.at.y };
      });
      region(corners);
    }
  };

  if (/\.Cu$/.test(layer)) {
    for (const t of board.tracks) if (t.layer === layer) stroke([t.start, t.end], t.width);
    for (const a of board.arcs)
      if (a.layer === layer) stroke(tessellateArc(a.start, a.mid, a.end), a.width);
    for (const v of board.vias) flash(`C,${fmm(v.size)}`, v.at);
    for (const z of board.zones)
      if (z.layers.some((l) => l === layer))
        for (const f of z.fills) if (f.layer === layer) for (const poly of f.polys) region(poly);
  }
  for (const fp of board.footprints) {
    for (const p of fp.pads) padPlot(p);
    for (const s of fp.shapes) shapePlot(s);
  }
  for (const s of board.shapes) shapePlot(s);

  const date = opts.creationDate ?? '';
  const out: string[] = [
    '%TF.GenerationSoftware,ZiroEDA,Pcbnew,1.0*%',
    ...(date ? [`%TF.CreationDate,${date}*%`] : []),
    `%TF.FileFunction,${gerberFileFunction(layer, copperCount)}*%`,
    `%TF.FilePolarity,${filePolarity(layer)}*%`,
    `%FSLAX4${coordDigits}Y4${coordDigits}*%`,
    `G04 Gerber Fmt 4.${coordDigits}, Leading zero omitted, Abs format (unit mm)*`,
    '%MOMM*%',
    '%LPD*%',
    'G01*',
    'G04 APERTURE LIST*',
    ...[...apertures.values()].map((a) => `%ADD${a.dcode}${a.def}*%`),
    'G04 APERTURE END LIST*',
  ];
  let current = -1;
  for (const { ap, cmds } of body) {
    if (ap.dcode !== current) {
      out.push(`D${ap.dcode}*`);
      current = ap.dcode;
    }
    out.push(...cmds);
  }
  out.push('M02*');
  return `${out.join('\n')}\n`;
}

/** Trimmed decimal mm for Excellon coordinates ("X200.0Y-148.0"). */
const dmm = (iu: number): string => {
  const s = iuToMM(iu).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  return s.includes('.') ? s : `${s}.0`;
};

/**
 * Excellon drill file for all plated + non-plated holes (PTH pads and vias),
 * GENDRILL_EXCELLON_WRITER's decimal-metric format.
 */
export function plotExcellonDrill(board: Board, opts: { creationDate?: string } = {}): string {
  // tool diameter (IU) -> hole positions
  const tools = new Map<number, Vec2[]>();
  const addHole = (d: number, at: Vec2): void => {
    if (d <= 0) return;
    const arr = tools.get(d) ?? [];
    arr.push(at);
    tools.set(d, arr);
  };
  for (const v of board.vias) addHole(v.drill, v.at);
  for (const fp of board.footprints)
    for (const p of fp.pads) if (p.drill && p.drill.w > 1) addHole(p.drill.w, p.at);

  const dias = [...tools.keys()].sort((a, b) => a - b);
  const out: string[] = [
    'M48',
    ...(opts.creationDate ? [`; DRILL file ZiroEDA date ${opts.creationDate}`] : []),
    '; FORMAT={-:-/ absolute / metric / decimal}',
    'FMAT,2',
    'METRIC',
    ...dias.map((d, i) => `T${i + 1}C${iuToMM(d).toFixed(3)}`),
    '%',
    'G90',
    'G05',
  ];
  dias.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const at of tools.get(d)!) out.push(`X${dmm(at.x)}Y${dmm(-at.y)}`);
  });
  out.push('M30');
  return `${out.join('\n')}\n`;
}

/** Minimal Gerber job file (.gbrjob) listing the plotted layer files. */
export function plotGerberJob(board: Board, files: { layer: string; name: string }[]): string {
  const copperCount = board.layers.filter((l) => /\.Cu$/.test(l.name)).length || 2;
  return JSON.stringify(
    {
      Header: { GenerationSoftware: { Vendor: 'ZiroEDA', Application: 'Pcbnew' } },
      GeneralSpecs: { ProjectId: { Name: board.fileName ?? 'board' }, LayerNumber: copperCount },
      FilesAttributes: files.map((f) => ({
        Path: f.name,
        FileFunction: gerberFileFunction(f.layer, copperCount),
      })),
    },
    null,
    2,
  );
}
