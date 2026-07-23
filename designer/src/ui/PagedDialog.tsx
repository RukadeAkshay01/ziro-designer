/**
 * PagedDialog — the shared "setup" dialog shell.
 *
 * Counterpart: `common/widgets/paged_dialog.cpp` (PAGED_DIALOG), the base class
 * KiCad reuses for Schematic Setup, Board Setup and Preferences. It provides:
 *   - a top info bar (read-only / warning messages),
 *   - a treebook on the left: expandable section nodes with indented sub-pages,
 *     up/down keyboard navigation, and last-visited-page memory keyed by title,
 *   - a bottom button row: an optional "Reset to Defaults" (label becomes
 *     "Reset <Page> to Defaults" and is enabled only for resettable pages), an
 *     optional auxiliary action (e.g. "Import Settings from Another Project..."),
 *     a stretch spacer, then Cancel / OK,
 *   - an initial size and a resize border (min clamp 600x500).
 *
 * Each concrete dialog (DialogSchematicSetup, DialogBoardSetup) supplies its own
 * page tree and panel renderers; this component owns the chrome and selection.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

export interface PagedDialogPage {
  /** Stable page id (also the selection key). */
  id: string;
  /** Tree label — matches KiCad's page title. */
  label: string;
  /** Greyed / not selectable: engine data not modelled yet. */
  disabled?: boolean;
  /** Whether this page can be reset to defaults (drives the Reset button). */
  resettable?: boolean;
  /** Resolves the panel shown on the right (KiCad's AddLazySubPage). */
  render: () => JSX.Element;
}

export interface PagedDialogSection {
  /** Section header label — an expandable parent node (empty page upstream). */
  label: string;
  pages: PagedDialogPage[];
}

interface Props {
  /** Window title; also the key under which the last page is remembered. */
  title: string;
  sections: PagedDialogSection[];
  /** Page to open on (ShowSchematicSetupDialog's aInitialPage). */
  initialPage?: string;
  /** Show the "Reset to Defaults" button (aShowReset). */
  showReset?: boolean;
  /** Auxiliary action label, e.g. "Import Settings from Another Project..."; omitted = no button. */
  auxiliaryAction?: string;
  /** Initial dialog size (aInitialSize); defaults to KiCad's 920x460. */
  initialSize?: { width: number; height: number };
  /** Message shown in the top info bar (e.g. project read-only). */
  infoBar?: string;
  onOk: () => void;
  onCancel: () => void;
}

// Last-selected page per dialog title, so re-opening lands where you left off
// (PAGED_DIALOG's g_lastPage). Module-scoped to survive dialog unmount.
const g_lastPage: Record<string, string> = {};

/** Enabled pages in tree order — the set up/down navigation walks. */
function enabledOrder(sections: PagedDialogSection[]): string[] {
  return sections.flatMap((s) => s.pages.filter((p) => !p.disabled).map((p) => p.id));
}

export function PagedDialog({
  title,
  sections,
  initialPage,
  showReset,
  auxiliaryAction,
  initialSize,
  infoBar,
  onOk,
  onCancel,
}: Props): JSX.Element {
  const order = enabledOrder(sections);
  const firstEnabled = order[0] ?? '';

  const [page, setPageState] = useState<string>(() => {
    const remembered = g_lastPage[title];
    const wanted = initialPage ?? remembered ?? firstEnabled;
    return order.includes(wanted) ? wanted : firstEnabled;
  });
  // Collapsed section labels (all expanded by default, like ExpandNode on every node).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const setPage = (id: string): void => {
    g_lastPage[title] = id;
    setPageState(id);
  };

  const allPages = sections.flatMap((s) => s.pages);
  const active = allPages.find((p) => p.id === page);

  // Up/Down move between enabled pages (PAGED_DIALOG::onCharHook), unless focus is
  // in a text field / grid where the arrows mean something else.
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const i = order.indexOf(page);
      if (i === -1) return;
      const next = e.key === 'ArrowDown' ? Math.min(i + 1, order.length - 1) : Math.max(i - 1, 0);
      const target = order[next];
      if (target && target !== page) {
        e.preventDefault();
        setPage(target);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  const toggleSection = (label: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const size = initialSize ?? { width: 920, height: 460 };

  const resetLabel =
    active?.resettable && active.label ? `Reset ${active.label} to Defaults` : 'Reset to Defaults';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-paged-dialog"
        style={{
          width: size.width,
          height: size.height,
          minWidth: 600,
          minHeight: 500,
          maxWidth: '96vw',
          maxHeight: '92vh',
          resize: 'both',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        {infoBar && <div className="ze-paged-infobar">{infoBar}</div>}

        <div className="ze-modal-body">
          <div className="ze-paged-tree" ref={treeRef} tabIndex={0}>
            {sections.map((section) => {
              const open = !collapsed.has(section.label);
              return (
                <div key={section.label}>
                  <div
                    className="ze-tree-item root"
                    onClick={() => toggleSection(section.label)}
                    title={section.label}
                  >
                    <span className={`twisty expandable${open ? ' open' : ''}`} />
                    {section.label}
                  </div>
                  {open &&
                    section.pages.map((p) => (
                      <div
                        key={p.id}
                        className={`ze-tree-item${p.id === page ? ' active' : ''}`}
                        style={{
                          paddingLeft: 26,
                          opacity: p.disabled ? 0.45 : 1,
                          cursor: p.disabled ? 'default' : 'pointer',
                        }}
                        onClick={() => !p.disabled && setPage(p.id)}
                        title={p.disabled ? 'Not implemented yet' : p.label}
                      >
                        {p.label}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>

          <div className="ze-paged-panel">
            {active && !active.disabled ? (
              active.render()
            ) : (
              <div style={{ padding: 16, color: 'var(--ze-muted, #888)', fontSize: 12 }}>
                This setup page is not implemented yet.
              </div>
            )}
          </div>
        </div>

        <div className="ze-modal-footer ze-paged-footer">
          {showReset && (
            // Stubbed: enabled only for resettable pages, exactly like KiCad — none
            // of our pages declare themselves resettable yet, so it reads disabled.
            <button
              className="ze-btn"
              disabled={!active?.resettable}
              title="Reset this page to defaults"
            >
              {resetLabel}
            </button>
          )}
          {auxiliaryAction && (
            // Stubbed: placed exactly where KiCad puts it; wiring lands in a later step.
            <button className="ze-btn" title="Not implemented yet">
              {auxiliaryAction}
            </button>
          )}
          <div className="ze-paged-footer-spacer" />
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
