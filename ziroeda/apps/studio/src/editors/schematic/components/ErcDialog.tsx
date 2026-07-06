import type { ErcViolation } from '@ziroeda/core';

/**
 * Electrical Rules Checker results, after KiCad's DIALOG_ERC: a violation list
 * with severity markers and an error/warning tally; clicking a violation centres
 * the canvas on the fault and selects the offending items. Rendered as a
 * floating panel so the sheet stays visible while stepping through faults
 * (KiCad's ERC dialog is modeless for the same reason).
 */

interface Props {
  violations: readonly ErcViolation[];
  onRun: () => void;
  onLocate: (v: ErcViolation) => void;
  onClose: () => void;
}

export function ErcDialog({ violations, onRun, onLocate, onClose }: Props): JSX.Element {
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;

  return (
    <div className="ze-erc-panel">
      <div className="ze-modal-header">
        Electrical Rules Checker
        <span className="x" onClick={onClose}>✕</span>
      </div>
      <div className="ze-erc-list">
        {violations.length === 0 && (
          <div className="ze-erc-empty">No ERC violations found.</div>
        )}
        {violations.map((v, i) => (
          <div key={i} className={`ze-erc-row ${v.severity}`} onClick={() => onLocate(v)}>
            <span className="sev">{v.severity === 'error' ? '⏺' : '⏺'}</span>
            <span className="msg">{v.message}</span>
          </div>
        ))}
      </div>
      <div className="ze-erc-footer">
        <span className="tally err">⏺ {errors} errors</span>
        <span className="tally warn">⏺ {warnings} warnings</span>
        <span className="grow" />
        <button className="ze-btn primary" onClick={onRun}>Run ERC</button>
      </div>
    </div>
  );
}
