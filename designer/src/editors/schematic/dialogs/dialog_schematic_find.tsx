/**
 * Modeless Find dialog. Counterpart: `eeschema/dialogs/dialog_schematic_find.cpp`
 * (DIALOG_SCH_FIND) — the same options in the same order: Match case,
 * Words, Wildcards, Search pin names and numbers, Search hidden fields,
 * Search the current sheet only. Enter / F3 = Find Next, Shift+F3 = Find
 * Previous, Esc = close. (Replace mode comes with the replace tool port.)
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
    <div className="ze-find-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ze-modal-header">
        {replace ? 'Find and Replace' : 'Find'}
        <span className="x" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="ze-find-body">
        <label className="row">
          <span>Search for:</span>
          <input
            ref={inputRef}
            className="ze-search"
            value={text}
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
        </label>
        {replace && (
          <label className="row">
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
          </label>
        )}
        <div className="opts">
          <label>
            <input
              type="checkbox"
              checked={data.matchCase}
              onChange={(e) => onChange({ ...data, matchCase: e.target.checked })}
            />
            Match case
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.matchMode === 'wholeword'}
              onChange={(e) => setMode('wholeword', e.target.checked)}
            />
            Words
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.matchMode === 'wildcard'}
              onChange={(e) => setMode('wildcard', e.target.checked)}
            />
            Wildcards
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.searchAllPins}
              onChange={(e) => onChange({ ...data, searchAllPins: e.target.checked })}
            />
            Search pin names and numbers
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.searchAllFields}
              onChange={(e) => onChange({ ...data, searchAllFields: e.target.checked })}
            />
            Search hidden fields
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.searchCurrentSheetOnly}
              onChange={(e) => onChange({ ...data, searchCurrentSheetOnly: e.target.checked })}
            />
            Search the current sheet only
          </label>
          {replace && (
            <label>
              <input
                type="checkbox"
                checked={data.replaceReferences}
                onChange={(e) => onChange({ ...data, replaceReferences: e.target.checked })}
              />
              Replace matches in reference designators
            </label>
          )}
        </div>
        <div className="ze-find-buttons">
          <span className="status">{status}</span>
          <button type="button" onClick={onFindPrevious}>
            Find Previous
          </button>
          <button type="button" className="primary" onClick={onFindNext}>
            Find Next
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
    </div>
  );
}
