/**
 * Move command: translate a set of selected items by a delta (internal units).
 *
 * Translating a symbol also moves its fields, matching KiCad (fields are
 * positioned in absolute coordinates and travel with their parent symbol).
 * The inverse of a move is simply a move by the negated delta, so undo/redo are
 * exact.
 */

import type { Schematic, SchSymbol, SchLine, SchJunction, SchLabel, SchField, Vec2 } from '../model/types.js';
import { refId } from './hittest.js';
import type { MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

function moveField(f: SchField, d: Vec2): SchField {
  return f.at ? { ...f, at: add(f.at, d) } : f;
}

function moveSymbol(s: SchSymbol, d: Vec2): SchSymbol {
  return { ...s, at: add(s.at, d), fields: s.fields.map((f) => moveField(f, d)) };
}
const moveLine = (l: SchLine, d: Vec2): SchLine => ({ ...l, start: add(l.start, d), end: add(l.end, d) });
const moveJunction = (j: SchJunction, d: Vec2): SchJunction => ({ ...j, at: add(j.at, d) });
const moveLabel = (l: SchLabel, d: Vec2): SchLabel => ({ ...l, at: add(l.at, d) });

/** Create a command that moves every item in `ids` by `delta`. */
export function moveItems(ids: ReadonlySet<string>, delta: Vec2): EditCommand {
  return {
    label: 'Move',
    apply(doc: Schematic): Schematic {
      if (ids.size === 0 || (delta.x === 0 && delta.y === 0)) return doc;
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => (ids.has(refId('symbol', s.uuid, i)) ? moveSymbol(s, delta) : s)),
        lines: doc.lines.map((l, i) => (ids.has(refId('line', l.uuid, i)) ? moveLine(l, delta) : l)),
        junctions: doc.junctions.map((j, i) => (ids.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j)),
        labels: doc.labels.map((l, i) => (ids.has(refId('label', l.uuid, i)) ? moveLabel(l, delta) : l)),
      };
    },
    invert(): EditCommand {
      return moveItems(ids, { x: -delta.x, y: -delta.y });
    },
  };
}

/**
 * Connection-aware move: moves `spec.fullIds` entirely and drags the coincident
 * endpoints of connected wires (`spec.wireStart` / `spec.wireEnd`) so wires stay
 * attached. The inverse negates the delta with the same plan, so undo is exact.
 */
export function moveWithConnections(spec: MoveSpec, delta: Vec2): EditCommand {
  return {
    label: 'Move',
    apply(doc: Schematic): Schematic {
      if (delta.x === 0 && delta.y === 0) return doc;
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => (spec.fullIds.has(refId('symbol', s.uuid, i)) ? moveSymbol(s, delta) : s)),
        junctions: doc.junctions.map((j, i) => (spec.fullIds.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j)),
        labels: doc.labels.map((l, i) => (spec.fullIds.has(refId('label', l.uuid, i)) ? moveLabel(l, delta) : l)),
        lines: doc.lines.map((l, i) => {
          const id = refId('line', l.uuid, i);
          if (spec.fullIds.has(id)) return moveLine(l, delta);
          const ms = spec.wireStart.has(id);
          const me = spec.wireEnd.has(id);
          if (!ms && !me) return l;
          return { ...l, start: ms ? add(l.start, delta) : l.start, end: me ? add(l.end, delta) : l.end };
        }),
      };
    },
    invert(): EditCommand {
      return moveWithConnections(spec, { x: -delta.x, y: -delta.y });
    },
  };
}
