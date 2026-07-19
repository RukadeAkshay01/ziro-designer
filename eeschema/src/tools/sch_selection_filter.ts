/**
 * Selection filter, ported from KiCad's `SCH_SELECTION_FILTER_OPTIONS`
 * (include/project/sch_project_settings.h) and `SCH_SELECTION_TOOL::
 * itemPassesFilter` (eeschema/tools/sch_selection_tool.cpp).
 *
 * The filter is how KiCad enforces item locking: a locked item fails the
 * filter unless `lockedItems` is enabled, so locked symbols cannot be
 * selected — and therefore cannot be moved, dragged or deleted — until the
 * user turns "Locked items" on in the Selection Filter panel. Each item-type
 * category gates its kinds the same way.
 */

import type { Schematic } from '../types.js';
import { refId } from './hittest.js';

/** Mirrors SCH_SELECTION_FILTER_OPTIONS. `lockedItems` is special (excluded
 *  from All()); the rest are per-category toggles. */
export interface SelectionFilterOptions {
  lockedItems: boolean;
  symbols: boolean;
  text: boolean;
  wires: boolean;
  labels: boolean;
  pins: boolean;
  graphics: boolean;
  images: boolean;
  ruleAreas: boolean;
  otherItems: boolean;
}

/** SetDefaults(): everything selectable except locked items. */
export function defaultSelectionFilter(): SelectionFilterOptions {
  return {
    lockedItems: false,
    symbols: true,
    text: true,
    wires: true,
    labels: true,
    pins: true,
    graphics: true,
    images: true,
    ruleAreas: true,
    otherItems: true,
  };
}

/** Any() — true if at least one category (not lockedItems) is enabled. */
export function selectionFilterAny(o: SelectionFilterOptions): boolean {
  return (
    o.symbols ||
    o.text ||
    o.wires ||
    o.labels ||
    o.pins ||
    o.graphics ||
    o.images ||
    o.ruleAreas ||
    o.otherItems
  );
}

/** All() — true if every category (not lockedItems) is enabled. */
export function selectionFilterAll(o: SelectionFilterOptions): boolean {
  return (
    o.symbols &&
    o.text &&
    o.wires &&
    o.labels &&
    o.pins &&
    o.graphics &&
    o.images &&
    o.ruleAreas &&
    o.otherItems
  );
}

/** The category a resolved item belongs to, mirroring itemPassesFilter's switch. */
type Category = keyof Omit<SelectionFilterOptions, 'lockedItems'>;

/** Resolve a selection id to its `{ category, locked }`, or null if unknown. */
function resolveItem(doc: Schematic, id: string): { category: Category; locked: boolean } | null {
  // Symbols and sheets → "symbols" (SCH_SYMBOL_T / SCH_SHEET_T). Only symbols
  // carry a lock state in the schematic grammar.
  const si = doc.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === id);
  if (si !== -1) return { category: 'symbols', locked: doc.symbols[si]!.locked ?? false };
  if (doc.sheets.some((s, i) => refId('sheet', s.uuid, i) === id))
    return { category: 'symbols', locked: false };

  // Wires/buses and junctions → "wires"; graphic polylines → "graphics".
  const li = doc.lines.findIndex((l, i) => refId('line', l.uuid, i) === id);
  if (li !== -1)
    return { category: doc.lines[li]!.kind === 'polyline' ? 'graphics' : 'wires', locked: false };
  if (doc.junctions.some((j, i) => refId('junction', j.uuid, i) === id))
    return { category: 'wires', locked: false };

  if (doc.labels.some((l, i) => refId('label', l.uuid, i) === id))
    return { category: 'labels', locked: false };

  // Text boxes, tables and free text → "text".
  if (doc.textBoxes.some((tb, i) => refId('textbox', tb.uuid, i) === id))
    return { category: 'text', locked: false };
  if (doc.tables.some((t, i) => refId('table', t.uuid, i) === id))
    return { category: 'text', locked: false };
  const gi = doc.graphics.findIndex((_, i) => refId('graphic', undefined, i) === id);
  if (gi !== -1)
    return { category: doc.graphics[gi]!.kind === 'text' ? 'text' : 'graphics', locked: false };

  if (doc.images.some((im, i) => refId('image', im.uuid, i) === id))
    return { category: 'images', locked: false };

  // Bus entries and no-connect flags fall through to "other items".
  if (doc.busEntries.some((be, i) => refId('busentry', be.uuid, i) === id))
    return { category: 'otherItems', locked: false };
  if (doc.noConnects.some((nc, i) => refId('noconnect', nc.uuid, i) === id))
    return { category: 'otherItems', locked: false };

  return null;
}

/**
 * itemPassesFilter: a locked item is rejected unless `lockedItems`; otherwise
 * the item's category toggle decides. Unknown ids pass (they are already
 * model items the caller resolved).
 */
export function itemPassesFilter(doc: Schematic, id: string, o: SelectionFilterOptions): boolean {
  const info = resolveItem(doc, id);
  if (!info) return true;
  if (info.locked && !o.lockedItems) return false;
  return o[info.category];
}

/** Keep only the ids whose item passes the filter (SCH_SELECTION narrowing). */
export function applySelectionFilter(
  doc: Schematic,
  ids: ReadonlySet<string>,
  o: SelectionFilterOptions,
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) if (itemPassesFilter(doc, id, o)) out.add(id);
  return out;
}
