/**
 * Modeless Find dialog for the board editor. Counterpart:
 * `pcbnew/dialogs/dialog_find.cpp` (DIALOG_FIND / dialog_find_base.cpp) — the
 * same controls in the same order: the search combo, then Match case, Whole
 * words only, Wildcards, Wrap; the include-scope checkboxes (footprint
 * reference designators, footprint values, other text items, net names — DRC
 * markers greyed until DRC lands); Find Next / Find Previous / Restart Search /
 * Close, with a status line. Enter = Find Next, Shift+Enter = Find Previous,
 * Esc = close.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

/** DIALOG_FIND's search options (EDA_SEARCH_DATA + include checkboxes). */
export interface PcbFindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  wildcard: boolean;
  wrap: boolean;
  includeReferences: boolean;
  includeValues: boolean;
  includeTexts: boolean;
  includeNets: boolean;
  /** Search fields marked hidden too (m_checkAllFields, "Include hidden fields"). */
  includeHidden: boolean;
}

export const DEFAULT_PCB_FIND: PcbFindOptions = {
  matchCase: false,
  wholeWord: false,
  wildcard: false,
  wrap: true,
  includeReferences: true,
  includeValues: true,
  includeTexts: true,
  includeNets: true,
  includeHidden: false,
};

interface Props {
  query: string;
  options: PcbFindOptions;
  onQuery: (q: string) => void;
  onOptions: (o: PcbFindOptions) => void;
  onFind: (dir: 'next' | 'prev' | 'restart') => void;
  onClose: () => void;
  /** Status line ("Hit(s): 3 of 12" / "No hits"); empty until a search ran. */
  status: string;
}

export function DialogPcbFind({
  query,
  options,
  onQuery,
  onOptions,
  onFind,
  onClose,
  status,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commitText = (value: string): void => {
    setText(value);
    onQuery(value);
  };
  const opt = (patch: Partial<PcbFindOptions>): void => onOptions({ ...options, ...patch });

  return (
    <div className="ze-find-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ze-modal-header">
        Find
        <span className="x" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="ze-find-body">
        {/* topSizer: left column (grows) + button column (right) */}
        <div className="ze-find-top">
          <div className="ze-find-left">
            {/* bSizer8: "Search for:" label + combo */}
            <label className="ze-find-searchrow">
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
                    onFind(e.shiftKey ? 'prev' : 'next');
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  }
                }}
              />
            </label>
            {/* sizerOptions: modifiers spread horizontally */}
            <div className="ze-find-modifiers">
              <label>
                <input
                  type="checkbox"
                  checked={options.matchCase}
                  onChange={(e) => opt({ matchCase: e.target.checked })}
                />
                Match case
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.wholeWord}
                  onChange={(e) => opt({ wholeWord: e.target.checked })}
                />
                Whole words only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.wildcard}
                  onChange={(e) => opt({ wildcard: e.target.checked })}
                />
                Wildcards
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.wrap}
                  onChange={(e) => opt({ wrap: e.target.checked })}
                />
                Wrap
              </label>
            </div>
            {/* sizerInclude: wxFlexGridSizer( 0, 2 ) — 2-column scope grid */}
            <div className="ze-find-scope">
              <label>
                <input
                  type="checkbox"
                  checked={options.includeReferences}
                  onChange={(e) => opt({ includeReferences: e.target.checked })}
                />
                Search footprint reference designators
              </label>
              <label title="DRC markers require the DRC engine (staged)">
                <input type="checkbox" checked={false} disabled />
                Search DRC markers
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeValues}
                  onChange={(e) => opt({ includeValues: e.target.checked })}
                />
                Search footprint values
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeNets}
                  onChange={(e) => opt({ includeNets: e.target.checked })}
                />
                Search net names
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeHidden}
                  onChange={(e) => opt({ includeHidden: e.target.checked })}
                />
                Include hidden fields
              </label>
              <span />
              <label>
                <input
                  type="checkbox"
                  checked={options.includeTexts}
                  onChange={(e) => opt({ includeTexts: e.target.checked })}
                />
                Search other text items
              </label>
            </div>
          </div>
          {/* buttonSizer: vertical stack, right side */}
          <div className="ze-find-buttons">
            <button type="button" className="primary" onClick={() => onFind('next')}>
              Find Next
            </button>
            <button type="button" onClick={() => onFind('prev')}>
              Find Previous
            </button>
            <button type="button" onClick={() => onFind('restart')}>
              Restart Search
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="ze-find-sep" />
        {/* sizerStatus: status text + "Show search panel" link */}
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
