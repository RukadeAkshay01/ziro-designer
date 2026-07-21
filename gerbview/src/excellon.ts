/**
 * Excellon drill-file reader, mirroring `gerbview/excellon_read_drill.cpp`.
 * It parses the M48 header (unit + zero mode + tool table) and the body
 * (tool select, drill hits, routed slots G85/G00-G03) into a GERBER_FILE_IMAGE
 * whose items are flashed round pads (holes) and segments (routed slots), so a
 * drill file shares the same rendering path as Gerber layers.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { APERTURE_T, GBR_BASIC_SHAPE, IU_PER_MM, IU_PER_MILS } from './types.js';
import { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { GERBER_FORMAT } from './types.js';
import { GERBER_DRAW_ITEM } from './gerber_draw_item.js';

interface DrillState {
  unit: 'mm' | 'in';
  iuScale: number;
  leadingZerosOmitted: boolean; // LZ header => leading kept, TZ => trailing kept
  intDigits: number;
  fracDigits: number;
  incremental: boolean;
  routing: boolean; // G00/G01 routing mode (pen down after M15)
  penDown: boolean;
  tool: number;
  pos: Vec2;
}

export function parseExcellon(text: string, fileName: string): GERBER_FILE_IMAGE {
  const img = new GERBER_FILE_IMAGE();
  img.fileName = fileName;
  img.rawText = text;
  img.format = GERBER_FORMAT.EXCELLON;
  img.fileFunction = 'Drill';

  const st: DrillState = {
    unit: 'in',
    iuScale: IU_PER_MILS * 1000,
    leadingZerosOmitted: true,
    intDigits: 2,
    fracDigits: 4,
    incremental: false,
    routing: false,
    penDown: false,
    tool: 0,
    pos: { x: 0, y: 0 },
  };

  const toolDia = new Map<number, number>(); // tool number -> diameter (file units)

  const setUnit = (u: 'mm' | 'in'): void => {
    st.unit = u;
    st.iuScale = u === 'mm' ? IU_PER_MM : IU_PER_MILS * 1000;
    if (u === 'mm') {
      st.intDigits = 3;
      st.fracDigits = 3;
    } else {
      st.intDigits = 2;
      st.fracDigits = 4;
    }
  };

  const decode = (raw: string): number => {
    let s = raw.trim();
    let sign = 1;
    if (s.startsWith('+')) s = s.slice(1);
    else if (s.startsWith('-')) {
      sign = -1;
      s = s.slice(1);
    }
    if (s.includes('.')) return sign * parseFloat(s);
    const total = st.intDigits + st.fracDigits;
    if (st.leadingZerosOmitted) s = s.padStart(total, '0');
    else s = s.padEnd(total, '0');
    const intPart = s.slice(0, s.length - st.fracDigits) || '0';
    const fracPart = st.fracDigits > 0 ? s.slice(s.length - st.fracDigits) : '';
    return sign * parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
  };

  const toIU = (p: Vec2): Vec2 => ({ x: p.x * st.iuScale, y: p.y * st.iuScale });

  const flashHole = (at: Vec2): void => {
    const dia = toolDia.get(st.tool) ?? 0;
    const item = new GERBER_DRAW_ITEM();
    item.shape = GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE;
    item.start = toIU(at);
    item.end = item.start;
    item.dcodeNum = st.tool;
    const d = img.getOrCreateDcode(st.tool + 1000); // avoid clashing D-code space
    d.iuScale = st.iuScale;
    d.shape = APERTURE_T.APT_CIRCLE;
    d.size = { x: dia, y: dia };
    d.defined = true;
    item.dcode = d;
    img.items.push(item);
  };

  const routeSegment = (from: Vec2, to: Vec2): void => {
    const dia = toolDia.get(st.tool) ?? 0;
    const item = new GERBER_DRAW_ITEM();
    item.shape = GBR_BASIC_SHAPE.GBR_SEGMENT;
    item.start = toIU(from);
    item.end = toIU(to);
    item.width = dia * st.iuScale;
    item.dcodeNum = st.tool;
    img.items.push(item);
  };

  let inHeader = false;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith(';')) continue; // comment

    if (line.startsWith('M48')) {
      inHeader = true;
      continue;
    }
    if (line === '%' || line.startsWith('M95')) {
      inHeader = false;
      continue;
    }
    if (line.startsWith('M30') || line.startsWith('M00')) break; // end

    // Header directives.
    if (inHeader) {
      if (line.startsWith('METRIC')) {
        setUnit('mm');
        if (/LZ/.test(line)) st.leadingZerosOmitted = false;
        else if (/TZ/.test(line)) st.leadingZerosOmitted = true;
        parseFormatHint(line, st);
        continue;
      }
      if (line.startsWith('INCH')) {
        setUnit('in');
        if (/LZ/.test(line)) st.leadingZerosOmitted = false;
        else if (/TZ/.test(line)) st.leadingZerosOmitted = true;
        parseFormatHint(line, st);
        continue;
      }
      if (line.startsWith('FMAT')) continue;
      if (line.startsWith('ICI')) {
        st.incremental = /ON/i.test(line);
        continue;
      }
      const tool = line.match(/^T(\d+)/);
      if (tool) {
        const num = parseInt(tool[1]!, 10);
        const c = line.match(/C([-+0-9.]+)/);
        if (c) toolDia.set(num, parseFloat(c[1]!));
        continue;
      }
      continue;
    }

    // Body: allow unit changes that some tools emit outside the header.
    if (line.startsWith('METRIC') || line === 'M71') {
      setUnit('mm');
      if (/LZ/.test(line)) st.leadingZerosOmitted = false;
      else if (/TZ/.test(line)) st.leadingZerosOmitted = true;
      continue;
    }
    if (line.startsWith('INCH') || line === 'M72') {
      setUnit('in');
      if (/LZ/.test(line)) st.leadingZerosOmitted = false;
      else if (/TZ/.test(line)) st.leadingZerosOmitted = true;
      continue;
    }
    if (line === 'G90') {
      st.incremental = false;
      continue;
    }
    if (line === 'G91') {
      st.incremental = true;
      continue;
    }
    if (line.startsWith('G05')) {
      st.routing = false;
      continue;
    }
    if (line.startsWith('M15')) {
      st.penDown = true;
      continue;
    }
    if (line.startsWith('M16') || line.startsWith('M17')) {
      st.penDown = false;
      continue;
    }

    // Tool select (T<n>) possibly with its own C diameter.
    const toolSel = line.match(/^T(\d+)/);
    if (toolSel && !/[XY]/.test(line)) {
      st.tool = parseInt(toolSel[1]!, 10);
      const c = line.match(/C([-+0-9.]+)/);
      if (c) toolDia.set(st.tool, parseFloat(c[1]!));
      continue;
    }

    // Routing mode changes.
    const g = line.match(/^G0?([0-3])/);
    if (g) {
      const gc = parseInt(g[1]!, 10);
      if (gc === 0 || gc === 1) st.routing = true;
      // fallthrough to coordinate handling below for G01 X.. Y..
    }

    // Coordinate line: drill hit, routed move, or G85 slot.
    if (/[XY]/.test(line)) {
      handleCoordLine(line);
    }
  }

  return img;

  function handleCoordLine(line: string): void {
    // A G85 slot: "X..Y..G85X..Y.." — two coordinate pairs.
    const slot = line.split('G85');
    const first = parseXY(slot[0]!);
    const start: Vec2 = {
      x: first.x ?? (st.incremental ? 0 : st.pos.x),
      y: first.y ?? (st.incremental ? 0 : st.pos.y),
    };
    const from: Vec2 = st.incremental
      ? { x: st.pos.x + (first.x ?? 0), y: st.pos.y + (first.y ?? 0) }
      : start;

    if (slot.length > 1) {
      const second = parseXY(slot[1]!);
      const to: Vec2 = st.incremental
        ? { x: from.x + (second.x ?? 0), y: from.y + (second.y ?? 0) }
        : { x: second.x ?? from.x, y: second.y ?? from.y };
      routeSegment(from, to);
      st.pos = to;
      return;
    }

    if (st.routing && st.penDown) {
      // Routed move with pen down draws a slot from the last point.
      routeSegment(st.pos, from);
      st.pos = from;
    } else if (st.routing && !st.penDown) {
      // Pen-up positioning move: just update position.
      st.pos = from;
    } else {
      // Drill mode: each coordinate is a hole.
      flashHole(from);
      st.pos = from;
    }
  }

  function parseXY(s: string): { x: number | null; y: number | null } {
    const xm = s.match(/X([-+0-9.]+)/);
    const ym = s.match(/Y([-+0-9.]+)/);
    return {
      x: xm ? decode(xm[1]!) : null,
      y: ym ? decode(ym[1]!) : null,
    };
  }
}

/** Read an explicit "000.000"-style format hint from a METRIC/INCH line. */
function parseFormatHint(line: string, st: DrillState): void {
  const m = line.match(/(\d)\.(\d)/) || line.match(/0{2,}\.0{2,}/);
  if (m && m[1] && m[2]) {
    st.intDigits = parseInt(m[1], 10);
    st.fracDigits = parseInt(m[2], 10);
  }
}
