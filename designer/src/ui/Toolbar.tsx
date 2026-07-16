import type { JSX } from 'react';
import { Icon } from './icons.js';
import { toolbarIconUrl } from './toolbarIcons.js';

export interface ToolButton {
  id: string;
  icon: string;
  title: string;
  toggle?: boolean;
  /** Feature not implemented yet — shown greyed in its upstream position. */
  disabled?: boolean;
}

export type ToolEntry = ToolButton | 'sep';

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

export function Toolbar({
  entries,
  orientation,
  side,
  activeTool,
  toggled,
  onActivate,
}: Props): JSX.Element {
  return (
    <div className={`ze-toolbar ${orientation}${side ? ` ${side}` : ''}`} role="toolbar">
      {entries.map((e, i) => {
        if (e === 'sep') return <span key={`s${i}`} className="ze-sep" />;
        const isActive = activeTool === e.id || toggled?.has(e.id);
        const url = toolbarIconUrl(e.id);
        return (
          <button
            key={e.id}
            className={`ze-tbtn${isActive ? ' active' : ''}${e.disabled ? ' disabled' : ''}`}
            title={e.title}
            aria-label={e.title}
            aria-pressed={isActive}
            disabled={e.disabled}
            onClick={() => !e.disabled && onActivate?.(e.id)}
          >
            {url ? <img src={url} alt="" /> : <Icon name={e.icon} />}
          </button>
        );
      })}
    </div>
  );
}
