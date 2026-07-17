import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { toolbarIconUrl } from './toolbarIcons.js';

export interface MenuItem {
  label?: string;
  /** Tool/action id — its KiCad icon is shown if one is mapped. */
  icon?: string;
  action?: () => void;
  sep?: boolean;
  disabled?: boolean;
  /** Keyboard hint shown right-aligned (e.g. "Ctrl+S"). */
  shortcut?: string;
  /** ACTION_MENU::CHECK items — shows a checkmark when true. */
  checked?: boolean;
  /** Nested items rendered as a flyout submenu (KiCad ACTION_MENU submenus:
   *  Import, Export, Attributes, Open Recent…). `items` and `submenu` are
   *  accepted interchangeably so callers from either editor keep working. */
  submenu?: MenuItem[];
  items?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

/** One dropdown row: separator, plain/CHECK item, or item with a flyout submenu. */
function MenuEntry({ item, close }: { item: MenuItem; close: () => void }): JSX.Element {
  const [subOpen, setSubOpen] = useState(false);
  if (item.sep) return <div className="ze-msep" />;
  const sub = item.submenu ?? item.items;
  const hasSub = !!sub && sub.length > 0;
  return (
    <div
      className={`ze-mitem${item.disabled ? ' disabled' : ''}${hasSub ? ' has-sub' : ''}`}
      style={hasSub ? { position: 'relative' } : undefined}
      onMouseEnter={hasSub ? () => setSubOpen(true) : undefined}
      onMouseLeave={hasSub ? () => setSubOpen(false) : undefined}
      onClick={() => {
        if (item.disabled || hasSub) return;
        close();
        item.action?.();
      }}
    >
      <span className="mico">
        {item.checked ? (
          <span className="mcheck">✓</span>
        ) : item.icon && toolbarIconUrl(item.icon) ? (
          <img src={toolbarIconUrl(item.icon)} alt="" />
        ) : null}
      </span>
      <span className="lbl">{item.label}</span>
      {item.shortcut && <span className="sc">{item.shortcut}</span>}
      {hasSub && <span className="sub-arrow">▸</span>}
      {hasSub && subOpen && !item.disabled && (
        <div
          className="ze-dropdown ze-submenu"
          style={{ position: 'absolute', left: '100%', top: -4 }}
        >
          {sub!.map((s, i) => (
            <MenuEntry key={s.label ?? `s${i}`} item={s} close={close} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A cursor-positioned popup (KiCad's TOOL_MENU shown on right-click): the
 *  same rows and styling as the menu-bar dropdowns, kept on-screen near the
 *  viewport edges, closed by an outside click or Escape. */
export function ContextMenu({
  items,
  x,
  y,
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Capture phase so Escape closes the menu without also reaching the
    // editor's hotkey handler (which would clear the selection).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, Math.max(4, window.innerWidth - r.width - 4)),
      top: Math.min(y, Math.max(4, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="ze-dropdown ze-context"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <MenuEntry key={it.label ?? `s${i}`} item={it} close={onClose} />
      ))}
    </div>
  );
}

/** A KiCad-style menu bar with click-to-open dropdowns and hover-to-switch. */
export function MenuBar({
  menus,
  leftSlot,
  rightSlot,
  title,
}: {
  menus: Menu[];
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  /** KiCad-style "<project> — <Editor>" shown in the bar (window-title info). */
  title?: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ze-menubar" ref={ref}>
      {leftSlot}
      {menus.map((menu) => (
        <div
          key={menu.label}
          className={`ze-menu${open === menu.label ? ' open' : ''}`}
          onClick={() => setOpen((o) => (o === menu.label ? null : menu.label))}
          onMouseEnter={() => open && setOpen(menu.label)}
        >
          {menu.label}
          {open === menu.label && (
            <div className="ze-dropdown" onClick={(e) => e.stopPropagation()}>
              {menu.items.map((it, i) => (
                <MenuEntry key={it.label ?? `s${i}`} item={it} close={() => setOpen(null)} />
              ))}
            </div>
          )}
        </div>
      ))}
      {title && <div className="ze-menubar-title">{title}</div>}
      {rightSlot}
    </div>
  );
}
