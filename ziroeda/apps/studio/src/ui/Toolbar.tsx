import type { JSX } from 'react';
import { Icon } from './icons.js';
import { toolbarIconUrl } from './toolbarIcons.js';
import type { ToolEntry } from './toolbars.js';

interface Props {
  entries: ToolEntry[];
  orientation: 'horizontal' | 'vertical';
  side?: 'left' | 'right';
  /** id of the currently active (radio-selected) tool, for the right toolbar. */
  activeTool?: string;
  /** set of ids that are toggled on, for the left toolbar. */
  toggled?: ReadonlySet<string>;
  onActivate?: (id: string) => void;
}

export function Toolbar({ entries, orientation, side, activeTool, toggled, onActivate }: Props): JSX.Element {
  return (
    <div className={`ze-toolbar ${orientation}${side ? ' ' + side : ''}`} role="toolbar">
      {entries.map((e, i) => {
        if (e === 'sep') return <span key={`s${i}`} className="ze-sep" />;
        const isActive = activeTool === e.id || toggled?.has(e.id);
        const url = toolbarIconUrl(e.id);
        return (
          <button
            key={e.id}
            className={`ze-tbtn${isActive ? ' active' : ''}`}
            title={e.title}
            aria-label={e.title}
            aria-pressed={isActive}
            onClick={() => onActivate?.(e.id)}
          >
            {url ? <img src={url} alt="" /> : <Icon name={e.icon} />}
          </button>
        );
      })}
    </div>
  );
}
