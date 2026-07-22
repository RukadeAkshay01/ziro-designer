/**
 * Board connectivity: which track/arc endpoints attach to which pads/vias.
 *
 * A minimal port of the piece of pcbnew's CONNECTIVITY_DATA the interactive
 * editor needs first — enough to answer "when this footprint moves, which track
 * ends should move with it?" (EDIT_TOOL's drag vs. move). KiCad decides two
 * copper items touch when they share a net and their shapes overlap; here a
 * track end attaches to a pad when it lands inside the pad's copper on a shared
 * net (the common case: a route ending on a pad centre), which is what a drag
 * needs to keep the routing rubber-banded to the part.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Board, PcbPad } from './types.js';

/** A specific end of a track or arc segment. */
export interface TrackEndRef {
  kind: 'track' | 'arc';
  index: number;
  end: 'start' | 'end';
}

/** Board-absolute connection point of a pad (its centre). */
const padAnchor = (pad: PcbPad): Vec2 => pad.at;

/**
 * Does point `pt` (a track end) sit on `pad`'s copper? Uses the pad's circular
 * extent (half its larger dimension) — generous enough to catch routes that end
 * a hair off the exact centre, without reaching neighbouring pads.
 */
function endOnPad(pt: Vec2, pad: PcbPad): boolean {
  const r = Math.max(pad.size.x, pad.size.y) / 2;
  const a = padAnchor(pad);
  return Math.hypot(pt.x - a.x, pt.y - a.y) <= r;
}

/** Every pad of the given footprints, with its footprint index kept for grouping. */
function movingPads(board: Board, footprintIdx: ReadonlySet<number>): PcbPad[] {
  const pads: PcbPad[] = [];
  for (const i of footprintIdx) {
    const fp = board.footprints[i];
    if (fp) pads.push(...fp.pads);
  }
  return pads;
}

/**
 * Track/arc endpoints attached (same net + on-pad) to any pad of the given
 * footprints — the ends a drag should carry so the routing stretches with the
 * part. A track selected in its own right is the caller's concern; this only
 * reports the attachment geometry.
 */
export function connectedTrackEnds(board: Board, footprintIdx: ReadonlySet<number>): TrackEndRef[] {
  const pads = movingPads(board, footprintIdx);
  if (pads.length === 0) return [];

  const out: TrackEndRef[] = [];
  const attach = (
    pt: Vec2,
    net: number,
    kind: 'track' | 'arc',
    index: number,
    end: 'start' | 'end',
  ): void => {
    for (const pad of pads) {
      if ((pad.net ?? -1) !== net) continue;
      if (endOnPad(pt, pad)) {
        out.push({ kind, index, end });
        return;
      }
    }
  };

  board.tracks.forEach((t, i) => {
    attach(t.start, t.net, 'track', i, 'start');
    attach(t.end, t.net, 'track', i, 'end');
  });
  board.arcs.forEach((a, i) => {
    attach(a.start, a.net, 'arc', i, 'start');
    attach(a.end, a.net, 'arc', i, 'end');
  });
  return out;
}
