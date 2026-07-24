/**
 * Board Setup > Design Rules > Custom Rules. Counterpart:
 * `pcbnew/dialogs/panel_setup_rules_base.cpp` (PANEL_SETUP_RULES) — a "DRC Rules"
 * code editor (KiCad uses a wxStyledTextCtrl over the project's `.kicad_dru`
 * text) with a line-number gutter and a syntax-help affordance. Custom rules
 * constrain DRC beyond the per-netclass values.
 */

import { useRef, type JSX, type UIEvent } from 'react';
import type { CustomRules } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultCustomRules, type CustomRules } from '../../board_settings.js';

interface Props {
  value: CustomRules;
  onChange: (next: CustomRules) => void;
}

export function PanelPcbCustomRules({ value, onChange }: Props): JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.text.split('\n').length);
  // Keep the gutter scrolled in lock-step with the editor (wxStyledTextCtrl margin).
  const onScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const mono: React.CSSProperties = {
    fontFamily: 'var(--mono, monospace)',
    fontSize: 12.5,
    lineHeight: '18px',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 12.5 }}>DRC Rules</div>
        <span style={{ flex: 1 }} />
        <span
          className="ze-muted"
          style={{ fontSize: 11.5, cursor: 'default' }}
          title="Custom DRC rule syntax (KiCad .kicad_dru)"
        >
          Syntax help
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 240,
          display: 'flex',
          border: '1px solid var(--chrome-border)',
          borderRadius: 3,
          background: 'var(--chrome-bg2)',
          overflow: 'hidden',
        }}
      >
        {/* Line-number gutter */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          style={{
            ...mono,
            flex: '0 0 auto',
            padding: '6px 8px 6px 6px',
            textAlign: 'right',
            color: 'var(--ze-muted, #6b6e74)',
            background: 'var(--chrome-bg)',
            borderRight: '1px solid var(--chrome-border)',
            overflow: 'hidden',
            userSelect: 'none',
            whiteSpace: 'pre',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </div>
        <textarea
          style={{
            ...mono,
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: '6px 8px',
            background: 'transparent',
            color: 'var(--chrome-fg)',
            whiteSpace: 'pre',
            overflow: 'auto',
          }}
          spellCheck={false}
          value={value.text}
          onScroll={onScroll}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      </div>
    </div>
  );
}
