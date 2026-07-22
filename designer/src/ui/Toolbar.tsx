import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
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

/**
 * A TOOLBAR_GROUP_CONFIG / ACTION_GROUP: rendered as a single button showing
 * the selected action (first action by default) with a triangle in the
 * bottom-right corner. Click runs the selected action; pressing for 500 ms or
 * dragging off the button pops up a palette with every action in the group
 * (common/tool/action_toolbar.cpp).
 */
export interface ToolGroup {
  group: string;
  actions: ToolButton[];
  /** Open the palette on a normal click instead of activating the shown action. */
  paletteOnClick?: boolean;
}

export type ToolEntry = ToolButton | ToolGroup | 'sep';

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

// The time between pressing the left mouse button and opening the palette
// (ACTION_TOOLBAR's PALETTE_OPEN_DELAY).
const PALETTE_OPEN_DELAY = 500;
// Border around the palette buttons on all sides / between adjacent buttons.
const PALETTE_BORDER = 4;
const BUTTON_BORDER = 1;

interface PaletteState {
  group: ToolGroup;
  /** Bounding rect of the group button that opened the palette. */
  anchor: DOMRect;
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
  // Selected ("default") action of each group, like ACTION_GROUP's
  // m_defaultAction: the palette pick the group button currently shows.
  const [groupSel, setGroupSel] = useState<Record<string, string>>({});
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const pressTimer = useRef<number | null>(null);
  // Swallows the click that ends the press which opened the palette.
  const suppressClick = useRef(false);

  const cancelTimer = (): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => cancelTimer, []);

  // wxPopupTransientWindow: any press outside the palette (or Escape)
  // dismisses it.
  useEffect(() => {
    if (!palette) return;
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest('.ze-tb-palette')) setPalette(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPalette(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [palette]);

  const isDisabled = (b: ToolButton): boolean => !!b.disabled || !!disabledIds?.has(b.id);

  /** The action a group button currently displays and activates. */
  const displayedAction = (g: ToolGroup): ToolButton => {
    const active = g.actions.find((a) => a.id === activeTool);
    if (active) return active;
    const toggledAction = toggled ? g.actions.find((a) => toggled.has(a.id)) : undefined;
    if (toggledAction) return toggledAction;
    const sel = g.actions.find((a) => a.id === groupSel[g.group]);
    return sel ?? g.actions[0]!;
  };

  const openPalette = (g: ToolGroup, btn: HTMLElement): void => {
    cancelTimer();
    suppressClick.current = true;
    setPalette({ group: g, anchor: btn.getBoundingClientRect() });
  };

  const renderButton = (
    b: ToolButton,
    opts: { group?: ToolGroup; inPalette?: boolean } = {},
  ): JSX.Element => {
    const disabled = isDisabled(b);
    const isActive = !opts.inPalette && (activeTool === b.id || toggled?.has(b.id));
    const url = toolbarIconUrl(b.id) ?? toolbarIconUrl(b.icon);
    const g = opts.group;
    return (
      <button
        key={b.id}
        className={`ze-tbtn${isActive ? ' active' : ''}${disabled ? ' disabled' : ''}${g ? ' ze-tbtn-group' : ''}`}
        title={b.title}
        aria-label={b.title}
        aria-pressed={isActive}
        disabled={disabled}
        onPointerDown={(e) => {
          if (!g || disabled || e.button !== 0) return;
          suppressClick.current = false;
          const btn = e.currentTarget;
          cancelTimer();
          pressTimer.current = window.setTimeout(() => openPalette(g, btn), PALETTE_OPEN_DELAY);
        }}
        onPointerLeave={(e) => {
          // Dragging off the pressed button opens the palette immediately
          // (ACTION_TOOLBAR::onItemDrag).
          if (g && pressTimer.current !== null && e.buttons & 1) openPalette(g, e.currentTarget);
          else cancelTimer();
        }}
        onPointerUp={cancelTimer}
        onClick={(e) => {
          if (disabled) return;
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (g?.paletteOnClick && !opts.inPalette) {
            openPalette(g, e.currentTarget);
            return;
          }
          if (opts.inPalette && g) {
            setGroupSel((p) => ({ ...p, [g.group]: b.id }));
            setPalette(null);
          }
          onActivate?.(b.id);
        }}
      >
        {url ? <img src={url} alt="" /> : <Icon name={b.icon} />}
      </button>
    );
  };

  // ACTION_TOOLBAR::popupPalette: perpendicular to the toolbar, aligned with
  // the button that opened it, shifted off the toolbar by the palette border.
  const paletteStyle = (p: PaletteState): CSSProperties => {
    const pad = PALETTE_BORDER + BUTTON_BORDER;
    if (orientation === 'vertical') {
      const style: CSSProperties = { top: p.anchor.top - pad };
      if (side === 'right') style.right = window.innerWidth - p.anchor.left + PALETTE_BORDER;
      else style.left = p.anchor.right + PALETTE_BORDER;
      return style;
    }
    return { top: p.anchor.bottom + PALETTE_BORDER, left: p.anchor.left - pad };
  };

  return (
    <div className={`ze-toolbar ${orientation}${side ? ` ${side}` : ''}`} role="toolbar">
      {entries.map((e, i) => {
        if (e === 'sep') return <span key={`s${i}`} className="ze-sep" />;
        if ('group' in e) {
          const shown = displayedAction(e);
          return (
            <span key={e.group} className="ze-tb-groupwrap" title={shown.title}>
              {renderButton(shown, { group: e })}
              <span className={`ze-tb-arrow${isDisabled(shown) ? ' disabled' : ''}`} />
            </span>
          );
        }
        return renderButton(e);
      })}
      {palette && (
        <div
          className={`ze-tb-palette ${orientation === 'vertical' ? 'horizontal' : 'vertical'}`}
          style={paletteStyle(palette)}
          role="menu"
          aria-label={palette.group.group}
        >
          {palette.group.actions.map((a) =>
            renderButton(a, { group: palette.group, inPalette: true }),
          )}
        </div>
      )}
    </div>
  );
}
