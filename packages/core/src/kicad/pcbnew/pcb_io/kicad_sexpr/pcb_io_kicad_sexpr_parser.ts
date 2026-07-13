/**
 * PCB_IO_KICAD_SEXPR_PARSER — the `.kicad_pcb` reader
 * (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp). Builds the BOARD
 * object model from file text. KiCad hand-writes a DSN lexer; here the shared
 * S-expr parser (src/sexpr) is the lexer/AST and this class maps the AST to
 * objects (parseBOARD / parseFOOTPRINT / parsePAD / parsePCB_TRACK / …).
 *
 * Footprint children are baked to board-absolute coordinates on read (rotate by
 * the footprint orientation, then translate) — matching both KiCad's in-memory
 * model (absolute m_pos) and the object model here. Only the modeled grammar is
 * consumed; unmodeled tokens are ignored (they'll be added as the model grows).
 */

import { parse, head, isList, type SList } from '../../../../sexpr/index.js';
import { arg, args, childNamed, numArg, numberField } from '../../../../sexpr/query.js';
import { mmToIU } from '../../../../units.js';
import { EDA_ANGLE } from '../../../common/eda_angle.js';
import { RotatePoint } from '../../../common/trigo.js';
import type { VECTOR2I } from '../../../common/math/vector2.js';
import { BOARD, type BOARD_LAYER } from '../../board.js';
import { FOOTPRINT, type FP_DRAWING } from '../../footprint.js';
import { PAD, PAD_SHAPE, PAD_ATTRIB } from '../../pad.js';
import { PCB_FIELD, MANDATORY_FIELD_T } from '../../pcb_field.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TRACK, PCB_ARC, PCB_VIA, VIATYPE } from '../../pcb_track.js';
import { ZONE } from '../../zone.js';
import { SHAPE_T } from '../../../common/eda_shape.js';

const ptOf = (n?: SList): VECTOR2I => (n ? { x: mmToIU(numArg(n, 0) ?? 0), y: mmToIU(numArg(n, 1) ?? 0) } : { x: 0, y: 0 });
const layerOf = (n: SList): string => arg(childNamed(n, 'layer') ?? { kind: 'list', items: [] }, 0) ?? 'F.Cu';
const netOf = (n: SList): number => numberField(n, 'net') ?? 0;
const widthOf = (n: SList): number => mmToIU(childNamed(n, 'stroke') ? (numberField(childNamed(n, 'stroke')!, 'width') ?? 0) : (numberField(n, 'width') ?? 0));

/** (at x y [deg]) -> { pos in IU, angle in degrees }. */
function atOf(n: SList): { pos: VECTOR2I; angle: number } {
  const at = childNamed(n, 'at');
  return { pos: ptOf(at), angle: at ? (numArg(at, 2) ?? 0) : 0 };
}

const PAD_SHAPE_MAP: Record<string, PAD_SHAPE> = {
  circle: PAD_SHAPE.CIRCLE, rect: PAD_SHAPE.RECTANGLE, oval: PAD_SHAPE.OVAL,
  trapezoid: PAD_SHAPE.TRAPEZOID, roundrect: PAD_SHAPE.ROUNDRECT, custom: PAD_SHAPE.CUSTOM,
};
const PAD_ATTRIB_MAP: Record<string, PAD_ATTRIB> = {
  thru_hole: PAD_ATTRIB.PTH, smd: PAD_ATTRIB.SMD, connect: PAD_ATTRIB.CONN, np_thru_hole: PAD_ATTRIB.NPTH,
};
const SHAPE_MAP: Record<string, SHAPE_T> = {
  line: SHAPE_T.SEGMENT, rect: SHAPE_T.RECTANGLE, circle: SHAPE_T.CIRCLE, arc: SHAPE_T.ARC, poly: SHAPE_T.POLY, curve: SHAPE_T.BEZIER,
};

function textSize(n: SList): VECTOR2I {
  const font = childNamed(childNamed(n, 'effects') ?? { kind: 'list', items: [] }, 'font');
  const size = font ? childNamed(font, 'size') : undefined;
  // File order is (size h w); the model stores {x: w, y: h}.
  return size ? { x: mmToIU(numArg(size, 1) ?? 1), y: mmToIU(numArg(size, 0) ?? 1) } : { x: mmToIU(1), y: mmToIU(1) };
}

export class PCB_IO_KICAD_SEXPR_PARSER {
  parse(text: string): BOARD {
    const root = parse(text);
    if (head(root) !== 'kicad_pcb') throw new Error('not a kicad_pcb document');
    return this.parseBOARD(root);
  }

  private parseBOARD(root: SList): BOARD {
    const board = new BOARD();
    const layers: BOARD_LAYER[] = [];
    for (const item of root.items) {
      if (!isList(item)) continue;
      switch (head(item)) {
        case 'paper': board.paper = arg(item, 0); break;
        case 'layers':
          for (const l of item.items) {
            if (!isList(l)) continue;
            const id = Number(head(l));
            if (Number.isInteger(id)) layers.push({ id, name: arg(l, 0) ?? '', type: arg(l, 1) ?? 'user', userName: arg(l, 2) });
          }
          break;
        case 'net': board.SetNet(numArg(item, 0) ?? 0, arg(item, 1) ?? ''); break;
        case 'footprint': case 'module': board.Add(this.parseFOOTPRINT(item)); break;
        case 'segment': board.Add(this.parseSegment(item)); break;
        case 'arc': board.Add(this.parseArc(item)); break;
        case 'via': board.Add(this.parseVia(item)); break;
        case 'zone': board.Add(this.parseZONE(item)); break;
        case 'gr_line': case 'gr_rect': case 'gr_circle': case 'gr_arc': case 'gr_poly': case 'gr_curve':
          board.Add(this.parseShape(item, 'gr')); break;
        case 'gr_text': board.Add(this.parseText(item, 'gr_text')); break;
        default: break;
      }
    }
    board.SetLayers(layers);
    return board;
  }

  private parseSegment(n: SList): PCB_TRACK {
    return new PCB_TRACK(ptOf(childNamed(n, 'start')), ptOf(childNamed(n, 'end')), widthOf(n), layerOf(n), netOf(n));
  }
  private parseArc(n: SList): PCB_ARC {
    return new PCB_ARC(ptOf(childNamed(n, 'start')), ptOf(childNamed(n, 'mid')), ptOf(childNamed(n, 'end')), widthOf(n), layerOf(n), netOf(n));
  }
  private parseVia(n: SList): PCB_VIA {
    const ls = childNamed(n, 'layers') ? args(childNamed(n, 'layers')!) : ['F.Cu', 'B.Cu'];
    const positional = args(n);
    const type = positional.includes('micro') ? VIATYPE.MICROVIA : positional.includes('blind') ? VIATYPE.BLIND_BURIED : VIATYPE.THROUGH;
    return new PCB_VIA(ptOf(childNamed(n, 'at')), mmToIU(numberField(n, 'size') ?? 0), mmToIU(numberField(n, 'drill') ?? 0),
      ls[0] ?? 'F.Cu', ls[1] ?? 'B.Cu', type, netOf(n));
  }

  /** `xf` maps each point to board-absolute (footprint children) or is identity. */
  private parseShape(n: SList, prefix: 'gr' | 'fp', xf: (p: VECTOR2I) => VECTOR2I = (p) => p): PCB_SHAPE {
    const kind = SHAPE_MAP[(head(n) ?? '').slice(prefix.length + 1)] ?? SHAPE_T.SEGMENT;
    const filled = ['solid', 'yes'].includes(arg(childNamed(n, 'fill') ?? { kind: 'list', items: [] }, 0) ?? '');
    const opts: { start?: VECTOR2I; end?: VECTOR2I; mid?: VECTOR2I; poly?: VECTOR2I[]; width?: number; filled?: boolean } = { width: widthOf(n), filled };
    if (kind === SHAPE_T.CIRCLE) { opts.start = xf(ptOf(childNamed(n, 'center'))); opts.end = xf(ptOf(childNamed(n, 'end'))); }
    else if (kind === SHAPE_T.ARC) { opts.start = xf(ptOf(childNamed(n, 'start'))); opts.mid = xf(ptOf(childNamed(n, 'mid'))); opts.end = xf(ptOf(childNamed(n, 'end'))); }
    else if (kind === SHAPE_T.POLY || kind === SHAPE_T.BEZIER) { opts.poly = this.parsePts(childNamed(n, 'pts')).map(xf); }
    else { opts.start = xf(ptOf(childNamed(n, 'start'))); opts.end = xf(ptOf(childNamed(n, 'end'))); }
    return new PCB_SHAPE(kind, layerOf(n), opts);
  }

  private parseText(n: SList, tag: 'gr_text' | 'fp_text'): PCB_TEXT {
    const textStr = tag === 'fp_text' ? (arg(n, 1) ?? '') : (arg(n, 0) ?? '');
    const { pos, angle } = atOf(n);
    return new PCB_TEXT(layerOf(n), { text: textStr, pos, angle: new EDA_ANGLE(angle), size: textSize(n) });
  }

  private parsePts(pts?: SList): VECTOR2I[] {
    if (!pts) return [];
    return pts.items.filter((p): p is SList => isList(p) && head(p) === 'xy').map((p) => ptOf(p));
  }

  private parseZONE(n: SList): ZONE {
    const layers = childNamed(n, 'layers') ? args(childNamed(n, 'layers')!) : [layerOf(n)];
    const outline = this.parsePts(childNamed(childNamed(n, 'polygon') ?? { kind: 'list', items: [] }, 'pts'));
    const fills = new Map<string, VECTOR2I[][]>();
    for (const fp of n.items) {
      if (!isList(fp) || head(fp) !== 'filled_polygon') continue;
      const layer = layerOf(fp);
      const ring = this.parsePts(childNamed(fp, 'pts'));
      const arr = fills.get(layer) ?? [];
      arr.push(ring);
      fills.set(layer, arr);
    }
    return new ZONE({ outline, layers, fills, netCode: netOf(n) });
  }

  private parseFOOTPRINT(n: SList): FOOTPRINT {
    const { pos, angle } = atOf(n);
    const orient = new EDA_ANGLE(angle);
    const toAbs = (local: VECTOR2I): VECTOR2I => { const r = RotatePoint(local, orient); return { x: r.x + pos.x, y: r.y + pos.y }; };

    const pads: PAD[] = [];
    const fields: PCB_FIELD[] = [];
    const drawings: FP_DRAWING[] = [];

    for (const c of n.items) {
      if (!isList(c)) continue;
      const h = head(c);
      if (h === 'pad') pads.push(this.parsePAD(c, toAbs, orient));
      else if (h === 'property') fields.push(this.parseProperty(c, toAbs, orient));
      else if (h === 'fp_text') drawings.push(this.parseFpText(c, toAbs, orient));
      else if (['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly', 'fp_curve'].includes(h ?? '')) {
        drawings.push(this.parseShape(c, 'fp', toAbs));
      }
    }
    return new FOOTPRINT({ fpid: arg(n, 0), pos, orient, layer: layerOf(n), pads, fields, drawings });
  }

  private parsePAD(n: SList, toAbs: (p: VECTOR2I) => VECTOR2I, fpOrient: EDA_ANGLE): PAD {
    const { pos: local, angle: localAngle } = atOf(n);
    const ls = childNamed(n, 'layers') ? args(childNamed(n, 'layers')!) : ['F.Cu'];
    const size = childNamed(n, 'size');
    return new PAD({
      number: arg(n, 1) ?? '',
      pos: toAbs(local),
      orient: fpOrient.add(new EDA_ANGLE(localAngle)),
      size: { x: mmToIU(numArg(size ?? { kind: 'list', items: [] }, 0) ?? 0), y: mmToIU(numArg(size ?? { kind: 'list', items: [] }, 1) ?? 0) },
      shape: PAD_SHAPE_MAP[arg(n, 3) ?? 'circle'] ?? PAD_SHAPE.CIRCLE,
      attribute: PAD_ATTRIB_MAP[arg(n, 2) ?? 'smd'] ?? PAD_ATTRIB.SMD,
      layers: ls,
      roundRectRadiusRatio: numberField(n, 'roundrect_rratio'),
    });
  }

  private parseProperty(n: SList, toAbs: (p: VECTOR2I) => VECTOR2I, fpOrient: EDA_ANGLE): PCB_FIELD {
    const name = arg(n, 0) ?? '';
    const id = name === 'Reference' ? MANDATORY_FIELD_T.REFERENCE : name === 'Value' ? MANDATORY_FIELD_T.VALUE : MANDATORY_FIELD_T.DESCRIPTION;
    const { pos, angle } = atOf(n);
    return new PCB_FIELD(layerOf(n), id, name, { text: arg(n, 1) ?? '', pos: toAbs(pos), angle: fpOrient.add(new EDA_ANGLE(angle)), size: textSize(n) });
  }

  private parseFpText(n: SList, toAbs: (p: VECTOR2I) => VECTOR2I, fpOrient: EDA_ANGLE): PCB_TEXT {
    const { pos, angle } = atOf(n);
    return new PCB_TEXT(layerOf(n), { text: arg(n, 1) ?? '', pos: toAbs(pos), angle: fpOrient.add(new EDA_ANGLE(angle)), size: textSize(n) });
  }
}

/** Convenience: parse `.kicad_pcb` text to a BOARD. */
export function parseBoard(text: string): BOARD {
  return new PCB_IO_KICAD_SEXPR_PARSER().parse(text);
}
