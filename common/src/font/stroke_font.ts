/**
 * KiCad Newstroke stroke font, ported from common/font/stroke_font.cpp.
 *
 * Glyphs are Hershey-encoded strings (see newstrokeGlyphs.ts). This decodes them
 * exactly as STROKE_FONT::loadNewStrokeFont does, and lays out a text run the way
 * STROKE_FONT::GetTextAsGlyphs does, so schematic text is stroked with the real
 * KiCad font instead of a system font.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { NEWSTROKE_GLYPHS } from './newstroke_glyphs.js';

const STROKE_FONT_SCALE = 1 / 21; // stroke_font.cpp
const FONT_OFFSET = -8; // historical Y offset baked into the glyph coordinates

interface Glyph {
  /** Advance width in reduced (em) units. */
  advance: number;
  /** Pen-down polylines in reduced units: x right from the glyph origin, y down from baseline. */
  strokes: Vec2[][];
}

let decoded: Glyph[] | null = null;

/** Decode one Hershey glyph string (loadNewStrokeFont's inner loop). */
function decodeGlyph(s: string): Glyph {
  const R = 'R'.charCodeAt(0);
  let startX = 0;
  let advance = 0;
  const strokes: Vec2[][] = [];
  let cur: Vec2[] | null = null;

  for (let i = 0; i < s.length; i += 2) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    if (i === 0) {
      // First pair: glyph start/end X give the advance width.
      startX = (c0 - R) * STROKE_FONT_SCALE;
      const endX = (c1 - R) * STROKE_FONT_SCALE;
      advance = endX - startX;
    } else if (s[i] === ' ' && s[i + 1] === 'R') {
      cur = null; // pen up: end the current stroke
    } else {
      const x = (c0 - R) * STROKE_FONT_SCALE - startX;
      const y = (c1 - R + FONT_OFFSET) * STROKE_FONT_SCALE;
      if (!cur) {
        cur = [];
        strokes.push(cur);
      }
      cur.push({ x, y });
    }
  }
  return { advance, strokes };
}

function glyphs(): Glyph[] {
  if (!decoded) decoded = NEWSTROKE_GLYPHS.map(decodeGlyph);
  return decoded;
}

/** Advance width of the space glyph (index 0), in em units. */
function spaceAdvance(): number {
  return glyphs()[0]!.advance;
}

// ----- KiCad text markup (font.cpp MARKUP_NODE) --------------------------------
// `~{...}` renders with an overbar, `_{...}` as subscript, `^{...}` as
// superscript. Factors from stroke_font.cpp GetTextAsGlyphs and
// font_metrics.h (m_OverbarHeight).
const SUPER_SUB_SIZE_MULTIPLIER = 0.8;
const SUPER_HEIGHT_OFFSET = 0.35;
const SUB_HEIGHT_OFFSET = 0.15;
const OVERBAR_HEIGHT = 1.23;

type MarkupStyle = 'normal' | 'overbar' | 'sub' | 'super';
interface MarkupRun {
  text: string;
  style: MarkupStyle;
}

/** Split one line into markup runs; plain text passes through untouched. */
function parseMarkup(line: string): MarkupRun[] {
  if (!/[~_^]\{/.test(line)) return [{ text: line, style: 'normal' }];
  const runs: MarkupRun[] = [];
  let plain = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    if ((c === '~' || c === '_' || c === '^') && next === '{') {
      // Find the matching close brace (markup can contain nested braces).
      let depth = 1;
      let j = i + 2;
      while (j < line.length && depth > 0) {
        if (line[j] === '{') depth++;
        else if (line[j] === '}') depth--;
        j++;
      }
      if (plain) {
        runs.push({ text: plain, style: 'normal' });
        plain = '';
      }
      runs.push({
        text: line.slice(i + 2, depth === 0 ? j - 1 : j),
        style: c === '~' ? 'overbar' : c === '_' ? 'sub' : 'super',
      });
      i = j - 1;
    } else {
      plain += c;
    }
  }
  if (plain) runs.push({ text: plain, style: 'normal' });
  return runs;
}

/** Advance one run's glyphs from `cursorX`; collect strokes when `out` given. */
function layoutRun(run: MarkupRun, size: number, cursorX: number, out?: Vec2[][]): number {
  const gl = glyphs();
  const glyphSize =
    run.style === 'sub' || run.style === 'super' ? size * SUPER_SUB_SIZE_MULTIPLIER : size;
  const dy =
    run.style === 'sub'
      ? glyphSize * SUB_HEIGHT_OFFSET
      : run.style === 'super'
        ? -glyphSize * SUPER_HEIGHT_OFFSET
        : 0;
  const barStart = cursorX;
  for (const ch of run.text) {
    if (ch === ' ') {
      cursorX += spaceAdvance() * glyphSize;
      continue;
    }
    let dd = ch.codePointAt(0)! - 0x20;
    if (dd < 0 || dd >= gl.length) dd = '?'.charCodeAt(0) - 0x20; // non-printable -> '?'
    const g = gl[dd]!;
    if (out) {
      const x0 = cursorX;
      out.push(
        ...g.strokes.map((s) =>
          s.map((p) => ({ x: x0 + p.x * glyphSize, y: p.y * glyphSize + dy })),
        ),
      );
    }
    cursorX += g.advance * glyphSize;
  }
  if (out && run.style === 'overbar') {
    // Shorten the bar a little so its rounded ends don't make it over-long.
    const barTrim = size * 0.1;
    const y = -size * OVERBAR_HEIGHT;
    out.push([
      { x: barStart + barTrim, y },
      { x: cursorX - barTrim, y },
    ]);
  }
  return cursorX;
}

/** Total advance width of `text` at glyph height `size` (IU) — no stroke building. */
export function measureText(text: string, size: number): number {
  let w = 0;
  for (const run of parseMarkup(text)) w = layoutRun(run, size, w);
  return w;
}

/**
 * Lay out `text` at glyph height `size` (em, IU) with the baseline-left origin at
 * (0,0). Returns the stroke polylines (in IU, y down from baseline) plus the total
 * advance width. Mirrors GetTextAsGlyphs: index = codepoint-0x20, '?' fallback,
 * space advances by the space glyph width, each glyph advances by its width*size.
 */
// KiCad FONT_METRICS::m_InterlinePitch (font_metrics.h): line pitch = 1.68·height.
const INTERLINE_PITCH = 1.68;

export function layoutText(text: string, size: number): { strokes: Vec2[][]; width: number } {
  // KiCad draws multi-line text (EDA_TEXT with embedded \n) as stacked lines
  // spaced by GetInterline(); a lone newline must not render as a glyph.
  const lines = text.split('\n');

  // Pass 1: lay each line out left-aligned from x=0, keep its strokes + width.
  // Markup runs (~{overbar}, _{sub}, ^{super}) are resolved here.
  const laid = lines.map((line) => {
    const strokes: Vec2[][] = [];
    let cursorX = 0;
    for (const run of parseMarkup(line)) cursorX = layoutRun(run, size, cursorX, strokes);
    return { strokes, width: cursorX };
  });

  const maxWidth = Math.max(0, ...laid.map((l) => l.width));
  // KiCad centres each line horizontally and centres the whole block vertically
  // for the default (centre) justify — so a short second line sits centred under
  // a long first line, not left-aligned.
  const vShift = -((lines.length - 1) * INTERLINE_PITCH * size) / 2;
  const out: Vec2[][] = [];
  laid.forEach((ld, li) => {
    const dx = (maxWidth - ld.width) / 2;
    const dy = li * INTERLINE_PITCH * size + vShift;
    for (const s of ld.strokes) out.push(s.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  });
  return { strokes: out, width: maxWidth };
}
