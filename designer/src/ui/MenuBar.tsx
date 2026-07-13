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
}

export interface Menu {
  label: string;
  items: MenuItem[];
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
              {menu.items.map((it, i) =>
                it.sep ? (
                  <div key={`s${i}`} className="ze-msep" />
                ) : (
                  <div
                    key={it.label ?? i}
                    className={`ze-mitem${it.disabled ? ' disabled' : ''}`}
                    onClick={() => {
                      if (it.disabled) return;
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span className="mico">
                      {it.icon && toolbarIconUrl(it.icon) ? (
                        <img src={toolbarIconUrl(it.icon)} alt="" />
                      ) : null}
                    </span>
                    <span className="lbl">{it.label}</span>
                    {it.shortcut && <span className="sc">{it.shortcut}</span>}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      {title && <div className="ze-menubar-title">{title}</div>}
      {rightSlot}
    </div>
  );
}
