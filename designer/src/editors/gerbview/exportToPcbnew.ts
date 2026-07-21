/**
 * Export loaded Gerber layers to a Pcbnew board file — the app-side mirror of
 * GerbView's GBR_TO_PCB_EXPORTER (`gerbview/export_to_pcbnew.cpp`). Each visible
 * layer maps to a board layer (by its X2 file function where known, else a
 * user-drawing layer), and its graphic items become board graphics: segments →
 * `gr_line`, arcs → `gr_arc`, circles → `gr_circle`, regions and flashed pads →
 * filled `gr_poly` / `gr_circle`. Coordinates convert to millimetres with the
 * Y axis flipped (Gerber Y is up, board Y is down).
 */

import { GBR_BASIC_SHAPE, IU_PER_MM, type GERBER_FILE_IMAGE } from '@ziroeda/gerbview';

interface ExportLayer {
  image: GERBER_FILE_IMAGE;
  name: string;
}

const MM = (iu: number): string => (iu / IU_PER_MM).toFixed(6);
const NEG_MM = (iu: number): string => (-iu / IU_PER_MM).toFixed(6);

/** Board layer names available for export mapping. */
const USER_LAYERS = ['Dwgs.User', 'Cmts.User', 'Eco1.User', 'Eco2.User'];

/** Pick a board layer name for an image from its file function. */
function boardLayerFor(image: GERBER_FILE_IMAGE, fallbackIdx: number): string {
  const fn = (image.fileFunction ?? '').toLowerCase();
  if (fn.includes('copper')) {
    if (fn.includes('bot') || fn.includes('l2') || fn.includes(',b')) return 'B.Cu';
    return 'F.Cu';
  }
  if (fn.includes('soldermask') || fn.includes('mask'))
    return fn.includes('bot') ? 'B.Mask' : 'F.Mask';
  if (fn.includes('legend') || fn.includes('silk'))
    return fn.includes('bot') ? 'B.SilkS' : 'F.SilkS';
  if (fn.includes('paste')) return fn.includes('bot') ? 'B.Paste' : 'F.Paste';
  if (fn.includes('profile') || fn.includes('edge')) return 'Edge.Cuts';
  if (image.fileFunction === 'Drill') return 'Edge.Cuts';
  return USER_LAYERS[fallbackIdx % USER_LAYERS.length]!;
}

function grLine(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  layer: string,
): string {
  return `  (gr_line (start ${MM(a.x)} ${NEG_MM(a.y)}) (end ${MM(b.x)} ${NEG_MM(b.y)}) (layer "${layer}") (width ${MM(Math.max(w, IU_PER_MM * 0.05))}))`;
}

function grCircle(c: { x: number; y: number }, r: number, layer: string, filled: boolean): string {
  const end = { x: c.x + r, y: c.y };
  return `  (gr_circle (center ${MM(c.x)} ${NEG_MM(c.y)}) (end ${MM(end.x)} ${NEG_MM(end.y)}) (layer "${layer}") (width ${MM(IU_PER_MM * 0.1)})${filled ? ' (fill solid)' : ''})`;
}

function grPoly(pts: { x: number; y: number }[], layer: string): string {
  if (pts.length < 3) return '';
  const p = pts.map((pt) => `(xy ${MM(pt.x)} ${NEG_MM(pt.y)})`).join(' ');
  return `  (gr_poly (pts ${p}) (layer "${layer}") (width 0) (fill solid))`;
}

function grArc(
  start: { x: number; y: number },
  end: { x: number; y: number },
  centre: { x: number; y: number },
  ccw: boolean,
  w: number,
  layer: string,
): string {
  // Compute the arc midpoint for the (start)(mid)(end) form.
  const r = Math.hypot(start.x - centre.x, start.y - centre.y);
  const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
  let a1 = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (ccw && a1 <= a0) a1 += 2 * Math.PI;
  if (!ccw && a1 >= a0) a1 -= 2 * Math.PI;
  const am = (a0 + a1) / 2;
  const mid = { x: centre.x + r * Math.cos(am), y: centre.y + r * Math.sin(am) };
  return `  (gr_arc (start ${MM(start.x)} ${NEG_MM(start.y)}) (mid ${MM(mid.x)} ${NEG_MM(mid.y)}) (end ${MM(end.x)} ${NEG_MM(end.y)}) (layer "${layer}") (width ${MM(Math.max(w, IU_PER_MM * 0.05))}))`;
}

export function exportLayersToPcb(layers: ExportLayer[]): string {
  const body: string[] = [];

  layers.forEach((layer, li) => {
    const boardLayer = boardLayerFor(layer.image, li);
    for (const item of layer.image.items) {
      switch (item.shape) {
        case GBR_BASIC_SHAPE.GBR_SEGMENT:
          body.push(grLine(item.start, item.end, item.width, boardLayer));
          break;
        case GBR_BASIC_SHAPE.GBR_ARC:
          body.push(
            grArc(item.start, item.end, item.arcCentre, item.arcCcw, item.width, boardLayer),
          );
          break;
        case GBR_BASIC_SHAPE.GBR_CIRCLE: {
          const r = Math.hypot(item.start.x - item.arcCentre.x, item.start.y - item.arcCentre.y);
          body.push(grCircle(item.arcCentre, r, boardLayer, false));
          break;
        }
        case GBR_BASIC_SHAPE.GBR_POLYGON:
          body.push(grPoly(item.polyPoints, boardLayer));
          break;
        default: {
          // Flashed spot: export the exposure-on primitives as filled graphics.
          for (const sh of item.resolveFlashShapes()) {
            if (!sh.exposure) continue;
            if (sh.kind === 'circle') body.push(grCircle(sh.center, sh.radius, boardLayer, true));
            else if (sh.kind === 'segment') body.push(grLine(sh.a, sh.b, sh.width, boardLayer));
            else body.push(grPoly(sh.points, boardLayer));
          }
          break;
        }
      }
    }
  });

  return [
    '(kicad_pcb (version 20221018) (generator ziroeda_gerbview)',
    '  (general (thickness 1.6))',
    '  (paper "A4")',
    '  (layers',
    '    (0 "F.Cu" signal)',
    '    (31 "B.Cu" signal)',
    '    (32 "B.Adhes" user)',
    '    (33 "F.Adhes" user)',
    '    (34 "B.Paste" user)',
    '    (35 "F.Paste" user)',
    '    (36 "B.SilkS" user)',
    '    (37 "F.SilkS" user)',
    '    (38 "B.Mask" user)',
    '    (39 "F.Mask" user)',
    '    (40 "Dwgs.User" user)',
    '    (41 "Cmts.User" user)',
    '    (42 "Eco1.User" user)',
    '    (43 "Eco2.User" user)',
    '    (44 "Edge.Cuts" user)',
    '  )',
    ...body,
    ')',
    '',
  ].join('\n');
}
