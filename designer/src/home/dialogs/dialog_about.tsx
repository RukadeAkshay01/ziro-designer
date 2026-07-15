/** About dialog (upstream counterpart: common/dialog_about/). Shows the
 * product identity, the build stamp baked in by Vite, and the license. */

import type { JSX } from 'react';

declare const __BUILD_STAMP__: string;

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const build = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev';
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          About Ziro Designer
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body" style={{ lineHeight: 1.6 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Ziro Designer</div>
          <div style={{ opacity: 0.8 }}>
            The browser-native electronics design suite from ZiroEDA.
          </div>
          <div style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>Build {build}</div>
          <div style={{ opacity: 0.6, fontSize: 12 }}>
            Free software, GPL-3.0-or-later. KiCad-compatible; not affiliated with the KiCad
            project.
          </div>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
