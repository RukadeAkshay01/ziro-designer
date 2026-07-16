/**
 * Page Settings (DIALOG_PAGES_SETTINGS): setPageSettingsCommand writes the
 * paper size / orientation and the title-block fields into both the typed model
 * and the source S-expression, round-trips through the writer, and is undoable.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  setPageSettingsCommand,
  getPageSettings,
} from '@ziroeda/eeschema/src/tools/page_settings.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols)
)`;

const load = () => readSchematic(parse(SCH));

describe('page settings', () => {
  it('reads current settings', () => {
    const s = getPageSettings(load());
    expect(s.paper).toBe('A4');
    expect(s.title).toBe('');
    expect(s.comments).toHaveLength(9);
  });

  it('writes paper, orientation and title block, and round-trips', () => {
    const doc = load();
    const after = setPageSettingsCommand({
      paper: 'A3 portrait',
      title: 'My Board',
      date: '2026-07-16',
      rev: 'B',
      company: 'ZiroEDA',
      comments: ['first', '', '', '', '', '', '', '', 'ninth'],
    }).apply(doc);

    expect(after.paper).toBe('A3 portrait');
    expect(after.titleBlock?.title).toBe('My Board');
    expect(after.titleBlock?.rev).toBe('B');

    const text = serializeSchematic(after);
    expect(text).toContain('(paper "A3" portrait)');
    expect(text).toContain('(title "My Board")');
    expect(text).toContain('(date "2026-07-16")');
    expect(text).toContain('(rev "B")');
    expect(text).toContain('(company "ZiroEDA")');
    expect(text).toContain('(comment 1 "first")');
    expect(text).toContain('(comment 9 "ninth")');

    // Re-reading the serialized document gives back the same settings.
    const reread = getPageSettings(readSchematic(parse(text)));
    expect(reread.paper).toBe('A3 portrait');
    expect(reread.title).toBe('My Board');
    expect(reread.comments[0]).toBe('first');
    expect(reread.comments[8]).toBe('ninth');
  });

  it('supports a custom (User) page size', () => {
    const after = setPageSettingsCommand({
      paper: 'User 200 150',
      title: '',
      date: '',
      rev: '',
      company: '',
      comments: new Array(9).fill(''),
    }).apply(load());
    expect(serializeSchematic(after)).toContain('(paper "User" 200 150)');
  });

  it('is undoable', () => {
    const doc = load();
    const h = new History();
    const after = h.execute(
      doc,
      setPageSettingsCommand({
        paper: 'A3',
        title: 'X',
        date: '',
        rev: '',
        company: '',
        comments: new Array(9).fill(''),
      }),
    );
    expect(after.paper).toBe('A3');
    const back = h.undo(after)!;
    expect(back.paper).toBe('A4');
    expect(back.titleBlock?.title).toBeUndefined();
  });
});
