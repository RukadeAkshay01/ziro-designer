/**
 * PCB_IO_KICAD_SEXPR — the `.kicad_pcb` writer
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr.cpp). Regenerates the file text
 * from the live BOARD object model — KiCad's real approach (no source
 * preservation): every field the model holds is emitted from the object's
 * current state, so an edit shows up because the object changed.
 *
 * This formats the well-modeled item set (layers, nets, tracks/arcs/vias,
 * footprints with pads/fields/graphics, board graphics/text, zones). Fields the
 * object model does not yet carry (pad chamfers/custom primitives, zone hole
 * geometry, stroke styles, …) are not emitted — losslessness grows with the
 * model, exactly as intended. Uses the shared S-expr builder + serializer.
 */

import { atom, str, serialize, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import { type PAD, PAD_SHAPE, PAD_ATTRIB } from '../../pad.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import type { PCB_TEXT } from '../../pcb_text.js';
import { type PCB_TRACK, PCB_ARC, PCB_VIA, VIATYPE } from '../../pcb_track.js';
import type { ZONE } from '../../zone.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';

const BOARD_FILE_VERSION = 20241229;

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** IU -> trimmed millimetre string (KiCad formatInternalUnits). */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (name: string, p: VECTOR2I): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));
const atNode = (p: VECTOR2I, angleDeg = 0): SList =>
  angleDeg
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angleDeg)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

const PAD_SHAPE_STR: Record<PAD_SHAPE, string> = {
  [PAD_SHAPE.CIRCLE]: 'circle',
  [PAD_SHAPE.RECTANGLE]: 'rect',
  [PAD_SHAPE.OVAL]: 'oval',
  [PAD_SHAPE.TRAPEZOID]: 'trapezoid',
  [PAD_SHAPE.ROUNDRECT]: 'roundrect',
  [PAD_SHAPE.CHAMFERED_RECT]: 'roundrect',
  [PAD_SHAPE.CUSTOM]: 'custom',
};
const PAD_ATTRIB_STR: Record<PAD_ATTRIB, string> = {
  [PAD_ATTRIB.PTH]: 'thru_hole',
  [PAD_ATTRIB.SMD]: 'smd',
  [PAD_ATTRIB.CONN]: 'connect',
  [PAD_ATTRIB.NPTH]: 'np_thru_hole',
};

const strokeNode = (width: number): SList =>
  list(atom('stroke'), list(atom('width'), atom(mm(width))), list(atom('type'), atom('solid')));

function effectsNode(size: VECTOR2I, thickness: number): SList {
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(size.y)), atom(mm(size.x)))];
  if (thickness) font.push(list(atom('thickness'), atom(mm(thickness))));
  return list(atom('effects'), { kind: 'list', items: font });
}

// ---- per-item formatters (mirror the format() overloads) --------------------

function formatText(
  t: PCB_TEXT,
  tag: 'gr_text' | 'fp_text',
  localPos?: VECTOR2I,
  localAngle?: number,
): SList {
  const eda = t.m_eda;
  const pos = localPos ?? eda.GetTextPos();
  const ang = localAngle ?? eda.GetTextAngle().AsDegrees();
  const items: SNode[] = [atom(tag)];
  if (tag === 'fp_text') items.push(atom('user'));
  items.push(
    str(eda.GetText()),
    atNode(pos, ang),
    list(atom('layer'), str(t.GetLayer())),
    effectsNode(eda.GetTextSize(), 0),
  );
  return { kind: 'list', items };
}

function formatShape(s: PCB_SHAPE, prefix: 'gr' | 'fp', xform?: (p: VECTOR2I) => VECTOR2I): SList {
  const kindName: Record<SHAPE_T, string> = {
    [SHAPE_T.SEGMENT]: 'line',
    [SHAPE_T.RECTANGLE]: 'rect',
    [SHAPE_T.CIRCLE]: 'circle',
    [SHAPE_T.ARC]: 'arc',
    [SHAPE_T.POLY]: 'poly',
    [SHAPE_T.BEZIER]: 'bezier',
    [SHAPE_T.UNDEFINED]: 'line',
  };
  const t = (p: VECTOR2I): VECTOR2I => (xform ? xform(p) : p);
  const items: SNode[] = [atom(`${prefix}_${kindName[s.GetShape()]}`)];
  if (s.GetShape() === SHAPE_T.CIRCLE) {
    items.push(xy('center', t(s.GetStart())), xy('end', t(s.GetEnd())));
  } else {
    items.push(xy('start', t(s.GetStart())), xy('end', t(s.GetEnd())));
  }
  items.push(strokeNode(s.GetWidth()), list(atom('layer'), str(s.GetLayer())));
  return { kind: 'list', items };
}

function formatPad(pad: PAD, fp: FOOTPRINT): SList {
  const fpOrient = fp.GetOrientation();
  const local = RotatePoint(
    { x: pad.GetPosition().x - fp.GetPosition().x, y: pad.GetPosition().y - fp.GetPosition().y },
    fpOrient.negate(),
  );
  const localAngle = pad.GetOrientation().sub(fpOrient).Normalize().AsDegrees();
  const items: SNode[] = [
    atom('pad'),
    str(pad.GetNumber()),
    atom(PAD_ATTRIB_STR[pad.GetAttribute()]),
    atom(PAD_SHAPE_STR[pad.GetShape()]),
    atNode(local, localAngle),
    list(atom('size'), atom(mm(pad.GetSize().x)), atom(mm(pad.GetSize().y))),
    { kind: 'list', items: [atom('layers'), ...pad.GetLayerSet().map((l) => str(l))] },
  ];
  return { kind: 'list', items };
}

function formatFootprint(fp: FOOTPRINT): SList {
  const items: SNode[] = [
    atom('footprint'),
    str(fp.GetFPID()),
    list(atom('layer'), str(fp.GetLayer())),
    atNode(fp.GetPosition(), fp.GetOrientation().AsDegrees()),
  ];
  const toLocal = (p: VECTOR2I): VECTOR2I =>
    RotatePoint(
      { x: p.x - fp.GetPosition().x, y: p.y - fp.GetPosition().y },
      fp.GetOrientation().negate(),
    );
  for (const f of fp.Fields()) {
    const local = toLocal(f.m_eda.GetTextPos());
    const localAngle = f.m_eda.GetTextAngle().sub(fp.GetOrientation()).Normalize().AsDegrees();
    items.push(
      list(
        atom('property'),
        str(f.GetName()),
        str(f.GetText()),
        atNode(local, localAngle),
        list(atom('layer'), str(f.GetLayer())),
        effectsNode(f.m_eda.GetTextSize(), 0),
      ),
    );
  }
  for (const pad of fp.Pads()) items.push(formatPad(pad, fp));
  for (const d of fp.GraphicalItems()) {
    if (d instanceof PCB_SHAPE) items.push(formatShape(d, 'fp', toLocal));
    else
      items.push(
        formatText(
          d,
          'fp_text',
          toLocal(d.m_eda.GetTextPos()),
          d.m_eda.GetTextAngle().sub(fp.GetOrientation()).AsDegrees(),
        ),
      );
  }
  return { kind: 'list', items };
}

function formatTrack(t: PCB_TRACK): SList {
  if (t instanceof PCB_VIA) {
    const items: SNode[] = [atom('via')];
    if (t.GetViaType() === VIATYPE.MICROVIA) items.push(atom('micro'));
    else if (t.GetViaType() === VIATYPE.BLIND_BURIED) items.push(atom('blind'));
    items.push(
      atNode(t.GetPosition()),
      list(atom('size'), atom(mm(t.GetWidth()))),
      list(atom('drill'), atom(mm(t.GetDrillValue()))),
      list(atom('layers'), str(t.GetLayer()), str(t.GetBottomLayer())),
      list(atom('net'), atom(String(t.GetNetCode()))),
    );
    return { kind: 'list', items };
  }
  if (t instanceof PCB_ARC) {
    return list(
      atom('arc'),
      xy('start', t.GetStart()),
      xy('mid', t.GetMid()),
      xy('end', t.GetEnd()),
      list(atom('width'), atom(mm(t.GetWidth()))),
      list(atom('layer'), str(t.GetLayer())),
      list(atom('net'), atom(String(t.GetNetCode()))),
    );
  }
  return list(
    atom('segment'),
    xy('start', t.GetStart()),
    xy('end', t.GetEnd()),
    list(atom('width'), atom(mm(t.GetWidth()))),
    list(atom('layer'), str(t.GetLayer())),
    list(atom('net'), atom(String(t.GetNetCode()))),
  );
}

function formatZone(z: ZONE): SList {
  const items: SNode[] = [
    atom('zone'),
    list(atom('net'), atom(String(z.GetNetCode()))),
    { kind: 'list', items: [atom('layers'), ...z.GetLayerSet().map((l) => str(l))] },
  ];
  if (z.GetOutline().length > 0) {
    items.push(
      list(atom('polygon'), {
        kind: 'list',
        items: [atom('pts'), ...z.GetOutline().map((p) => xy('xy', p))],
      }),
    );
  }
  for (const [layer, rings] of z.GetFills()) {
    for (const ring of rings) {
      items.push(
        list(atom('filled_polygon'), list(atom('layer'), str(layer)), {
          kind: 'list',
          items: [atom('pts'), ...ring.map((p) => xy('xy', p))],
        }),
      );
    }
  }
  return { kind: 'list', items };
}

/** Build the `(kicad_pcb …)` node from the BOARD (PCB_IO_KICAD_SEXPR::format). */
export function formatBoardNode(board: BOARD): SList {
  const items: SNode[] = [
    atom('kicad_pcb'),
    list(atom('version'), atom(String(BOARD_FILE_VERSION))),
    list(atom('generator'), str('ziroeda')),
  ];
  if (board.paper) items.push(list(atom('paper'), str(board.paper)));
  items.push({
    kind: 'list',
    items: [
      atom('layers'),
      ...board
        .GetLayers()
        .map((l) =>
          list(
            atom(String(l.id)),
            str(l.name),
            atom(l.type),
            ...(l.userName ? [str(l.userName)] : []),
          ),
        ),
    ],
  });
  for (const [code, name] of board.GetNetInfo())
    items.push(list(atom('net'), atom(String(code)), str(name)));
  for (const fp of board.Footprints()) items.push(formatFootprint(fp));
  for (const t of board.Tracks()) items.push(formatTrack(t));
  for (const z of board.Zones()) items.push(formatZone(z));
  for (const d of board.Drawings())
    items.push(d instanceof PCB_SHAPE ? formatShape(d, 'gr') : formatText(d, 'gr_text'));
  return { kind: 'list', items };
}

/** PCB_IO_KICAD_SEXPR::Format — serialize a BOARD to `.kicad_pcb` text. */
export function formatBoard(board: BOARD): string {
  return serialize(formatBoardNode(board));
}
