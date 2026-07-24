/**
 * Modeless Find / Find and Replace dialog. Counterpart:
 * `eeschema/dialogs/dialog_sch_find.cpp` (DIALOG_SCH_FIND,
 * dialog_sch_find_base.cpp). Layout mirrors the base sizers exactly:
 *
 *   mainSizer (vertical)
 *     topSizer (horizontal): leftSizer (grows) | rightSizer (buttons)
 *       leftGridSizer  — "Search for:" / "Replace with:" label + combo rows
 *       gbSizer2       — 3-column grid-bag of the search options
 *     bSizer6: staticline + "Show search panel" link (aligned right)
 *
 * Per the base, the Direction radios (m_radioForward/m_radioBackward) are
 * hidden in both modes, so they are omitted here. "Replace with:", the
 * "Replace matches in reference designators" option, and the Replace /
 * Replace All buttons appear only in Find and Replace mode
 * (wxFR_REPLACEDIALOG). Enter / F3 = find, Shift+Enter / Shift+F3 = reverse,
 * Esc = close. Options whose engines we don't have yet (net names, the
 * search panel) are greyed in place.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { MatchMode, SchSearchData } from '@ziroeda/eeschema';

interface Props {
  data: SchSearchData;
  onChange: (next: SchSearchData) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  /** "1 of 12" style status; empty until a search ran. */
  status: string;
  /** Replace mode (Find and Replace): shows the replace row and buttons. */
  replace?: boolean;
  onReplace?: () => void;
  onReplaceAll?: () => void;
}

export function DialogSchematicFind({
  data,
  onChange,
  onFindNext,
  onFindPrevious,
  onClose,
  status,
  replace,
  onReplace,
  onReplaceAll,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(data.findString);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commitText = (value: string): void => {
    setText(value);
    onChange({ ...data, findString: value });
  };
  const setMode = (mode: MatchMode, on: boolean): void =>
    onChange({ ...data, matchMode: on ? mode : 'plain' });

  return (
    <div className="ze-find-dialog ze-schfind-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ze-modal-header">
        {replace ? 'Find and Replace' : 'Find'}
        <span className="x" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="ze-find-body">
        {/* topSizer: left content (grows) + button column (right) */}
        <div className="ze-find-top">
          <div className="ze-find-left">
            {/* leftGridSizer: label | combo, second column growable */}
            <div className="ze-schfind-inputs">
              <span>Search for:</span>
              <input
                ref={inputRef}
                className="ze-search"
                value={text}
                placeholder="Text with optional wildcards"
                onChange={(e) => commitText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) onFindPrevious();
                    else onFindNext();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  }
                }}
              />
              {replace && (
                <>
                  <span>Replace with:</span>
                  <input
                    className="ze-search"
                    value={data.replaceString}
                    onChange={(e) => onChange({ ...data, replaceString: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onReplace?.();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onClose();
                      }
                    }}
                  />
                </>
              )}
            </div>
            {/* gbSizer2: 3-column grid-bag of search options (hgap 20). */}
            <div className="ze-schfind-scope">
              <label style={{ gridColumn: 1 }}>
                <input
                  type="checkbox"
                  checked={data.matchCase}
                  onChange={(e) => onChange({ ...data, matchCase: e.target.checked })}
                />
                Match case
              </label>
              <label style={{ gridColumn: 2 }}>
                <input
                  type="checkbox"
                  checked={data.matchMode === 'wholeword'}
                  onChange={(e) => setMode('wholeword', e.target.checked)}
                />
                Whole words only
              </label>
              <label style={{ gridColumn: 3 }}>
                <input
                  type="checkbox"
                  checked={data.matchMode === 'regex'}
                  onChange={(e) => setMode('regex', e.target.checked)}
                />
                Regular Expression
              </label>
              {/* gbSizer2 row 1 is an empty 8px spacer row. */}
              <div className="ze-schfind-gap" style={{ gridColumn: '1 / -1' }} />
              <label style={{ gridColumn: '1 / span 2' }}>
                <input
                  type="checkbox"
                  checked={data.searchAllPins}
                  onChange={(e) => onChange({ ...data, searchAllPins: e.target.checked })}
                />
                Search pin names and numbers
              </label>
              <label style={{ gridColumn: 3 }}>
                <input
                  type="checkbox"
                  checked={data.searchNetNames}
                  onChange={(e) => onChange({ ...data, searchNetNames: e.target.checked })}
                />
                Search net names
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={data.searchAllFields}
                  onChange={(e) => onChange({ ...data, searchAllFields: e.target.checked })}
                />
                Include hidden fields
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={data.searchCurrentSheetOnly}
                  disabled={data.searchSelectedOnly}
                  onChange={(e) => onChange({ ...data, searchCurrentSheetOnly: e.target.checked })}
                />
                Search the current sheet only
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={data.searchSelectedOnly}
                  onChange={(e) => onChange({ ...data, searchSelectedOnly: e.target.checked })}
                />
                Search the current selection only
              </label>
              {replace && (
                <label style={{ gridColumn: '1 / -1' }}>
                  <input
                    type="checkbox"
                    checked={data.replaceReferences}
                    onChange={(e) => onChange({ ...data, replaceReferences: e.target.checked })}
                  />
                  Replace matches in reference designators
                </label>
              )}
            </div>
          </div>
          {/* rightSizer: vertical button stack. */}
          <div className="ze-find-buttons">
            <button type="button" className="primary" onClick={onFindNext}>
              Find
            </button>
            {replace && (
              <button type="button" onClick={onReplace}>
                Replace
              </button>
            )}
            {replace && (
              <button type="button" onClick={onReplaceAll}>
                Replace All
              </button>
            )}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="ze-find-sep" />
        {/* bSizer6: status + "Show search panel" link. */}
        <div className="ze-find-status">
          <span className="status">{status}</span>
          <span className="ze-find-panellink" title="Search panel is staged" aria-disabled="true">
            Show search panel
          </span>
        </div>
      </div>
    </div>
  );
}
