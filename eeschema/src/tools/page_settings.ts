/**
 * Page settings. Counterpart: `common/dialogs/dialog_page_settings.cpp`
 * (DIALOG_PAGES_SETTINGS::onOK → SCH_EDIT_FRAME) — the paper size / orientation
 * and the title-block fields (date, revision, title, company, comments 1-9).
 *
 * A schematic document is lossless: the writer re-emits the `(paper …)` and
 * `(title_block …)` header nodes straight from `sch.source`, so an edit patches
 * both the typed model (used by the renderer) and those source nodes, and is
 * undoable like every other command.
 */

import type { Schematic, TitleBlock } from '../types.js';
import type { EditCommand } from './command.js';
import { list, atom, str, head, isList, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';

/** The editable page-settings fields (DIALOG_PAGES_SETTINGS controls). */
export interface PageSettings {
  /** Paper token as stored in `(paper …)`: "A4", "A4 portrait", or
   *  "User <w> <h>" (millimetres) for a custom size. */
  paper: string;
  title: string;
  date: string;
  rev: string;
  company: string;
  /** Nine comment lines (`(comment N "…")`); empty entries are dropped. */
  comments: readonly string[];
}

/** Read the current page settings out of a schematic (dialog seed values). */
export function getPageSettings(doc: Schematic): PageSettings {
  const tb = doc.titleBlock;
  const comments: string[] = ['', '', '', '', '', '', '', '', ''];
  if (tb) {
    for (const it of tb.source.items) {
      if (!isList(it) || head(it) !== 'comment') continue;
      const nNode = it.items[1];
      const vNode = it.items[2];
      const n = nNode && nNode.kind === 'atom' ? Number(nNode.value) : NaN;
      if (n >= 1 && n <= 9 && vNode && vNode.kind === 'string') comments[n - 1] = vNode.value;
    }
  }
  return {
    paper: doc.paper ?? 'A4',
    title: tb?.title ?? '',
    date: tb?.date ?? '',
    rev: tb?.rev ?? '',
    company: tb?.company ?? '',
    comments,
  };
}

/** Build a `(title_block …)` node from the fields (empty fields are omitted,
 *  as KiCad's TITLE_BLOCK::Format does). */
function buildTitleBlockNode(s: PageSettings): SList {
  const items: SNode[] = [atom('title_block')];
  if (s.title) items.push(list(atom('title'), str(s.title)));
  if (s.date) items.push(list(atom('date'), str(s.date)));
  if (s.rev) items.push(list(atom('rev'), str(s.rev)));
  if (s.company) items.push(list(atom('company'), str(s.company)));
  s.comments.forEach((c, i) => {
    if (c) items.push(list(atom('comment'), atom(String(i + 1)), str(c)));
  });
  return { kind: 'list', items };
}

/** Build a `(paper …)` node from the paper token. */
function buildPaperNode(paper: string): SList {
  const parts = paper.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? 'A4';
  if (name === 'User') {
    const w = Number(parts[1] ?? 0);
    const h = Number(parts[2] ?? 0);
    return list(atom('paper'), str('User'), atom(String(w)), atom(String(h)));
  }
  const items: SNode[] = [atom('paper'), str(name)];
  if (parts.includes('portrait')) items.push(atom('portrait'));
  return { kind: 'list', items };
}

/** Replace (or append) the single child of `parent` whose head is `name`. */
function upsertChild(parent: SList, name: string, node: SList): SList {
  let found = false;
  const items = parent.items.map((it) => {
    if (isList(it) && head(it) === name) {
      found = true;
      return node;
    }
    return it;
  });
  if (!found) items.push(node);
  return { kind: 'list', items };
}

/** Read the typed TitleBlock fields back out of a freshly built node. */
function typedTitleBlock(node: SList, s: PageSettings): TitleBlock {
  const tb: { -readonly [K in keyof TitleBlock]: TitleBlock[K] } = { source: node };
  if (s.title) tb.title = s.title;
  if (s.date) tb.date = s.date;
  if (s.rev) tb.rev = s.rev;
  if (s.company) tb.company = s.company;
  return tb;
}

/** Apply page settings to a document (typed model + source header nodes). */
function applyPageSettings(doc: Schematic, s: PageSettings): Schematic {
  const paperNode = buildPaperNode(s.paper);
  const titleNode = buildTitleBlockNode(s);
  let source = upsertChild(doc.source, 'paper', paperNode);
  source = upsertChild(source, 'title_block', titleNode);
  return {
    ...doc,
    paper: s.paper,
    titleBlock: typedTitleBlock(titleNode, s),
    source,
  };
}

/** Edit the page settings (SCH_EDIT_FRAME page-settings dialog), undoably. */
export function setPageSettingsCommand(next: PageSettings): EditCommand {
  return {
    label: 'Page Settings',
    apply(doc: Schematic): Schematic {
      return applyPageSettings(doc, next);
    },
    invert(before: Schematic): EditCommand {
      return setPageSettingsCommand(getPageSettings(before));
    },
  };
}
