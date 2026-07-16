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
  /** ids to grey out dynamically (e.g. hierarchy nav when there's nowhere to go),
   *  on top of a button's own static `disabled` flag. */
  disabledIds?: ReadonlySet<string>;
  onActivate?: (id: string) => void;
}

export function Toolbar({
  entries,
  orientation,
  side,
  activeTool,
  toggled,
  disabledIds,
  onActivate,
}: Props): JSX.Element {
  return (
    <div className={`ze-toolbar ${orientation}${side ? ` ${side}` : ''}`} role="toolbar">
      {entries.map((e, i) => {
        if (e === 'sep') return <span key={`s${i}`} className="ze-sep" />;
        const isActive = activeTool === e.id || toggled?.has(e.id);
        const disabled = e.disabled || disabledIds?.has(e.id);
        const url = toolbarIconUrl(e.id);
        return (
          <button
            key={e.id}
            className={`ze-tbtn${isActive ? ' active' : ''}${disabled ? ' disabled' : ''}`}
            title={e.title}
            aria-label={e.title}
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => !disabled && onActivate?.(e.id)}
          >
            {url ? <img src={url} alt="" /> : <Icon name={e.icon} />}
          </button>
        );
      })}
    </div>
  );
}
