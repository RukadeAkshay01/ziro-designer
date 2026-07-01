/**
 * KiCad Newstroke stroke font, ported from common/font/stroke_font.cpp.
 *
 * Glyphs are Hershey-encoded strings (see newstrokeGlyphs.ts). This decodes them
 * exactly as STROKE_FONT::loadNewStrokeFont does, and lays out a text run the way
 * STROKE_FONT::GetTextAsGlyphs does, so schematic text is stroked with the real
 * KiCad font instead of a system font.
 */

import type { Vec2 } from '@ziroeda/core';
import { NEWSTROKE_GLYPHS } from './newstrokeGlyphs.js';

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
      if (!cur) { cur = []; strokes.push(cur); }
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

/** Total advance width of `text` at glyph height `size` (IU) — no stroke building. */
export function measureText(text: string, size: number): number {
  const gl = glyphs();
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') { w += spaceAdvance() * size; continue; }
    let dd = ch.codePointAt(0)! - 0x20;
    if (dd < 0 || dd >= gl.length) dd = '?'.charCodeAt(0) - 0x20;
    w += gl[dd]!.advance * size;
  }
  return w;
}

/**
 * Lay out `text` at glyph height `size` (em, IU) with the baseline-left origin at
 * (0,0). Returns the stroke polylines (in IU, y down from baseline) plus the total
 * advance width. Mirrors GetTextAsGlyphs: index = codepoint-0x20, '?' fallback,
 * space advances by the space glyph width, each glyph advances by its width*size.
 */
export function layoutText(text: string, size: number): { strokes: Vec2[][]; width: number } {
  const gl = glyphs();
  const out: Vec2[][] = [];
  let cursorX = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === ' ') {
      cursorX += spaceAdvance() * size;
      continue;
    }
    let dd = code - 0x20;
    if (dd < 0 || dd >= gl.length) dd = '?'.charCodeAt(0) - 0x20; // non-printable/out-of-range -> '?'
    const g = gl[dd]!;
    for (const stroke of g.strokes) {
      out.push(stroke.map((p) => ({ x: cursorX + p.x * size, y: p.y * size })));
    }
    cursorX += g.advance * size;
  }
  return { strokes: out, width: cursorX };
}
