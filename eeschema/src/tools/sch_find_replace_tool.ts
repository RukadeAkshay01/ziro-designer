/**
 * Find (and replace) over schematic text. Counterpart:
 * `eeschema/tools/sch_find_replace_tool.cpp` plus the search-settings shape
 * from `include/eda_search_data.h` (EDA_SEARCH_DATA / SCH_SEARCH_DATA).
 *
 * Matching follows EDA_ITEM::Matches: case-insensitive by default, with
 * whole-word and wildcard (`*`/`?`, whole-string) modes. The searched text
 * sources mirror the upstream SCH_ITEM::Matches implementations: labels and
 * text, symbol fields (visible only, unless "search hidden fields"), pin
 * names/numbers (when "search pin names and numbers"), sheet fields
 * (Sheetname/Sheetfile), text boxes, and table cells.
 */

import type { Vec2 } from '@ziroeda/kimath';
import type { LibSymbol, SchField, Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';

export type MatchMode = 'plain' | 'wholeword' | 'wildcard' | 'regex';

/** EDA_SEARCH_DATA + the SCH_SEARCH_DATA extras. */
export interface SchSearchData {
  findString: string;
  replaceString: string;
  matchCase: boolean;
  matchMode: MatchMode;
  /** Search hidden fields too (searchAllFields). */
  searchAllFields: boolean;
  /** Search pin names and numbers (searchAllPins). */
  searchAllPins: boolean;
  searchCurrentSheetOnly: boolean;
  /** Restrict matches to the current selection (searchSelectedOnly). */
  searchSelectedOnly: boolean;
  /** Search connected-net names too (searchNetNames). */
  searchNetNames: boolean;
  /** Replace may touch reference designators (replaceReferences). */
  replaceReferences: boolean;
  /** The dialog is in replace mode (searchAndReplace): reference fields are
   *  then excluded from matches unless replaceReferences is set. */
  searchAndReplace: boolean;
}

export const defaultSearchData = (): SchSearchData => ({
  findString: '',
  replaceString: '',
  matchCase: false,
  matchMode: 'plain',
  searchAllFields: false,
  searchAllPins: false,
  searchCurrentSheetOnly: false,
  searchSelectedOnly: false,
  searchNetNames: false,
  replaceReferences: false,
  searchAndReplace: false,
});

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** EDA_ITEM::Matches( text, searchData ). */
export function matchesText(text: string, d: SchSearchData): boolean {
  if (!d.findString) return false;
  const t = d.matchCase ? text : text.toUpperCase();
  const s = d.matchCase ? d.findString : d.findString.toUpperCase();
  switch (d.matchMode) {
    case 'wholeword':
      return new RegExp(`\\b${escapeRe(s)}\\b`).test(t);
    case 'wildcard': {
      // wxString::Matches: whole-string match where * = any run, ? = any char.
      const re = escapeRe(s).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
      return new RegExp(`^${re}$`).test(t);
    }
    case 'regex':
      // EDA_SEARCH_DATA searchAndReplace regex mode (wxRegEx): an invalid
      // pattern simply matches nothing, like upstream's failed Compile().
      try {
        return new RegExp(d.findString, d.matchCase ? '' : 'i').test(text);
      } catch {
        return false;
      }
    default:
      return t.includes(s);
  }
}

/** One hit: the selectable item id, where to centre the view, and the text. */
export interface FindMatch {
  id: string;
  kind: 'symbol' | 'label' | 'sheet' | 'textbox' | 'table';
  pos: Vec2;
  text: string;
}

/**
 * All matches in one document, in reading order (top-to-bottom then
 * left-to-right) so repeated Find Next progresses predictably.
 */
export interface FindContext {
  /** Current selection ids — required to honour "search the current selection only". */
  selection?: ReadonlySet<string>;
  /** Net name -> a locatable item id + position, for "search net names". Pass
   *  the computeNetlist result; each net is located at one of its wire/label
   *  items so Find Next can centre the view on it. */
  nets?: readonly { name: string; items: readonly string[] }[];
}

export function findMatches(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  d: SchSearchData,
  ctx: FindContext = {},
): FindMatch[] {
  const out: FindMatch[] = [];
  if (!d.findString) return out;

  // Search connected-net names (SCH_FIND_REPLACE_TOOL search-net-names): a
  // matching net is located at its first wire/label item.
  if (d.searchNetNames && ctx.nets) {
    const posById = new Map<string, { pos: Vec2; kind: 'label' | 'line' }>();
    doc.labels.forEach((l, i) =>
      posById.set(refId('label', l.uuid, i), { pos: l.at, kind: 'label' }),
    );
    doc.lines.forEach((l, i) => {
      if (l.kind === 'wire') posById.set(refId('line', l.uuid, i), { pos: l.start, kind: 'line' });
    });
    for (const net of ctx.nets) {
      if (!matchesText(net.name, d)) continue;
      for (const itemId of net.items) {
        const at = posById.get(itemId);
        if (at) {
          // The item id selects the right wire/label; kind only drives view
          // centring, so 'label' (a point-located kind) is fine for both.
          out.push({ id: itemId, kind: 'label', pos: at.pos, text: net.name });
          break;
        }
      }
    }
  }

  // Labels cover every SCH_LABEL_BASE plus plain text (kind 'text').
  doc.labels.forEach((l, i) => {
    if (matchesText(l.text, d))
      out.push({ id: refId('label', l.uuid, i), kind: 'label', pos: l.at, text: l.text });
  });

  doc.symbols.forEach((sym, i) => {
    const id = refId('symbol', sym.uuid, i);
    for (const f of sym.fields) {
      const hidden = f.effects?.hidden === true;
      if (hidden && !d.searchAllFields) continue;
      // SCH_FIELD::Matches: in replace mode a reference designator only
      // matches when "Replace matches in reference designators" is on.
      if (f.key === 'Reference' && d.searchAndReplace && !d.replaceReferences) continue;
      if (matchesText(f.value, d)) {
        out.push({ id, kind: 'symbol', pos: f.at ?? sym.at, text: f.value });
        break; // one hit per symbol is enough to select it
      }
    }
    if (d.searchAllPins && !out.some((m) => m.id === id)) {
      const lib = libById.get(sym.libId);
      const pins = lib?.units.flatMap((u) => u.pins) ?? [];
      if (pins.some((p) => matchesText(p.name, d) || matchesText(p.number, d)))
        out.push({ id, kind: 'symbol', pos: sym.at, text: sym.libId });
    }
  });

  doc.sheets.forEach((sh, i) => {
    for (const f of sh.fields) {
      if (matchesText(f.value, d)) {
        out.push({
          id: refId('sheet', sh.uuid, i),
          kind: 'sheet',
          pos: sh.at,
          text: f.value,
        });
        break;
      }
    }
  });

  doc.textBoxes.forEach((tb, i) => {
    if (matchesText(tb.text, d))
      out.push({ id: refId('textbox', tb.uuid, i), kind: 'textbox', pos: tb.start, text: tb.text });
  });

  doc.tables.forEach((t, i) => {
    const hit = t.cells.find((c) => matchesText(c.text, d));
    if (hit)
      out.push({
        id: refId('table', t.uuid, i),
        kind: 'table',
        pos: hit.start,
        text: hit.text,
      });
  });

  // "Search the current selection only": drop matches outside the selection.
  const scoped =
    d.searchSelectedOnly && ctx.selection ? out.filter((m) => ctx.selection!.has(m.id)) : out;

  scoped.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  return scoped;
}

const isWordChar = (c: string): boolean => /\w/.test(c);

/**
 * EDA_ITEM::Replace( aSearchData, aText ): substitute every occurrence of the
 * search string (positions found case-folded, whole-word boundaries checked
 * per occurrence) while keeping the untouched parts of the original text.
 * Returns the new text, or null when nothing was replaced.
 */
export function replaceText(text: string, d: SchSearchData): string | null {
  if (!d.findString) return null;
  // Regex mode replaces every pattern match (wxRegEx::ReplaceAll).
  if (d.matchMode === 'regex') {
    try {
      const re = new RegExp(d.findString, d.matchCase ? 'g' : 'gi');
      const result = text.replace(re, d.replaceString);
      return result !== text ? result : null;
    } catch {
      return null;
    }
  }
  const folded = d.matchCase ? text : text.toUpperCase();
  const search = d.matchCase ? d.findString : d.findString.toUpperCase();
  let result = '';
  let ii = 0;
  let replaced = false;

  while (ii < folded.length) {
    const next = folded.indexOf(search, ii);
    if (next === -1) {
      result += text.slice(ii);
      break;
    }
    if (next > ii) result += text.slice(ii, next);
    const end = next + search.length;
    let startOK = true;
    let endOK = true;
    if (d.matchMode === 'wholeword') {
      startOK = next === 0 || !isWordChar(folded[next - 1]!);
      endOK = end === folded.length || !isWordChar(folded[end]!);
    }
    if (startOK && endOK) {
      result += d.replaceString;
      replaced = true;
      ii = end;
    } else {
      result += text[next]!;
      ii = next + 1;
    }
  }

  return replaced ? result : null;
}

/**
 * The Replace / Replace All command (SCH_FIND_REPLACE_TOOL::ReplaceAndFindNext
 * / ReplaceAll): substitute in every replaceable matched item of one document,
 * or only in the items listed in `ids` (Replace = just the current match).
 *
 * Replaceability mirrors upstream SCH_FIELD::IsReplaceable/Matches: reference
 * designators only with "Replace matches in reference designators", hidden
 * fields only when they are searched, and never a sheet's Sheetfile (renaming
 * the file a sheet points at is not a text edit).
 */
export function replaceCommand(d: SchSearchData, ids?: ReadonlySet<string>): EditCommand {
  const want = (id: string): boolean => !ids || ids.has(id);
  const replaceFields = (
    fields: readonly SchField[],
    opts: { isSheet: boolean },
  ): readonly SchField[] => {
    let changed = false;
    const next = fields.map((f) => {
      if (opts.isSheet && f.key === 'Sheetfile') return f;
      if (!opts.isSheet && f.key === 'Reference' && !d.replaceReferences) return f;
      if (f.effects?.hidden === true && !d.searchAllFields) return f;
      const t = replaceText(f.value, d);
      if (t === null) return f;
      changed = true;
      return { ...f, value: t };
    });
    return changed ? next : fields;
  };

  return {
    label: 'Find and Replace',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        labels: doc.labels.map((l, i) => {
          if (!want(refId('label', l.uuid, i))) return l;
          const t = replaceText(l.text, d);
          return t === null ? l : { ...l, text: t };
        }),
        symbols: doc.symbols.map((s, i) => {
          if (!want(refId('symbol', s.uuid, i))) return s;
          const fields = replaceFields(s.fields, { isSheet: false });
          return fields === s.fields ? s : { ...s, fields };
        }),
        sheets: doc.sheets.map((sh, i) => {
          if (!want(refId('sheet', sh.uuid, i))) return sh;
          const fields = replaceFields(sh.fields, { isSheet: true });
          return fields === sh.fields ? sh : { ...sh, fields };
        }),
        textBoxes: doc.textBoxes.map((tb, i) => {
          if (!want(refId('textbox', tb.uuid, i))) return tb;
          const t = replaceText(tb.text, d);
          return t === null ? tb : { ...tb, text: t };
        }),
        tables: doc.tables.map((t, i) => {
          if (!want(refId('table', t.uuid, i))) return t;
          let changed = false;
          const cells = t.cells.map((c) => {
            const nt = replaceText(c.text, d);
            if (nt === null) return c;
            changed = true;
            return { ...c, text: nt };
          });
          return changed ? { ...t, cells } : t;
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      return restoreTextItems(before);
    },
  };
}

/** Inverse of a replace: put back the pre-replace text-bearing collections. */
function restoreTextItems(before: Schematic): EditCommand {
  return {
    label: 'Find and Replace',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        labels: before.labels,
        symbols: before.symbols,
        sheets: before.sheets,
        textBoxes: before.textBoxes,
        tables: before.tables,
      };
    },
    invert(b: Schematic): EditCommand {
      return restoreTextItems(b);
    },
  };
}
