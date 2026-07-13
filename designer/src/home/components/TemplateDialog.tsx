/** New Project from Template (KiCad's DIALOG_TEMPLATE_SELECTOR): pick a
 * template on the left, read its description, name it, and create. */

import type { JSX } from 'react';
import { sanitizeProjectName } from '../newProject.js';
import type { TemplateMeta } from '../templates.js';

export function TemplateDialog({
  templates,
  selected,
  name,
  onSelect,
  onName,
  onCancel,
  onCreate,
}: {
  templates: readonly TemplateMeta[];
  selected: TemplateMeta | null;
  name: string;
  onSelect: (t: TemplateMeta) => void;
  onName: (name: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-template-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          New Project from Template
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body">
          <div className="ze-tpl-list">
            {templates.map((t) => (
              <div
                key={t.id}
                className={`ze-tpl-card${selected?.id === t.id ? ' active' : ''}`}
                onClick={() => onSelect(t)}
                onDoubleClick={() => {
                  onSelect(t);
                  if (sanitizeProjectName(name)) onCreate();
                }}
                title={t.title}
              >
                {t.icon ? <img src={t.icon} alt="" /> : <span className="ze-tpl-noicon" />}
                <span>{t.title}</span>
              </div>
            ))}
          </div>
          <div className="ze-tpl-detail">
            {selected ? (
              <>
                <h3>{selected.title}</h3>
                <p className="ze-tpl-desc">{selected.description}</p>
              </>
            ) : (
              <p style={{ opacity: 0.6 }}>Select a template.</p>
            )}
          </div>
        </div>
        <div className="ze-modal-footer" style={{ justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Project name</span>
            <input
              className="ze-search"
              autoFocus
              placeholder="untitled"
              value={name}
              onChange={(e) => onName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
                else if (e.key === 'Escape') onCancel();
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ze-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="ze-btn primary"
              disabled={!selected || !sanitizeProjectName(name)}
              onClick={onCreate}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
