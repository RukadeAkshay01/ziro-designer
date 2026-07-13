/** New Project name prompt (KiCad's File > New Project dialog). */

import type { JSX } from 'react';
import { sanitizeProjectName } from '../new_project.js';

export function NewProjectDialog({
  name,
  onChange,
  onCancel,
  onCreate,
}: {
  name: string;
  onChange: (name: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          New Project
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>Name</span>
            <input
              className="ze-search"
              autoFocus
              placeholder="untitled"
              value={name}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
                else if (e.key === 'Escape') onCancel();
              }}
            />
          </div>
          <div style={{ opacity: 0.6, fontSize: 12, paddingLeft: 66 }}>
            Creates {sanitizeProjectName(name) || 'untitled'}.kicad_pro, .kicad_sch and .kicad_pcb.
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            disabled={!sanitizeProjectName(name)}
            onClick={onCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
