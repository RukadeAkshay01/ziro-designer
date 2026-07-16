import { useMemo, useState } from 'react';
import {
  COMMON_DEFAULTS,
  EESCHEMA_DEFAULTS,
  settings,
  type CommonSettings,
  type EeschemaSettings,
  type MouseDragAction,
  type ScrollModifier,
} from './settings.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';
import { TOOL_HOTKEYS } from '../editors/schematic/menubar.js';

/**
 * The Preferences dialog — the web mirror of KiCad's PAGED_DIALOG preferences
 * (EDA_BASE_FRAME::ShowPreferences): a page tree on the left, panels on the
 * right, transcribed from the wxFormBuilder panel sources:
 *   - Common                 <- panel_common_settings_base.cpp
 *   - Mouse and Touchpad     <- panel_mouse_settings_base.cpp
 *   - Hotkeys                <- panel_hotkeys_editor (read-only here)
 *   - Schematic Editor
 *     - Display Options      <- panel_eeschema_display_options_base.cpp (+ GAL options)
 *     - Grids                <- panel_grid_settings_base.cpp
 *     - Editing Options      <- panel_eeschema_editing_options_base.cpp
 *     - Annotation Options   <- panel_eeschema_annotation_options_base.cpp
 *     - Colors               <- panel_eeschema_color_settings (theme + per-layer)
 *     - Field Name Templates <- panel_template_fieldnames_base.cpp
 *
 * Edits go to a working copy and commit on OK, as KiCad's TransferDataFromWindow
 * does. "Reset to Defaults" resets the current page only (RESETTABLE_PANEL).
 */

type PageId =
  | 'common'
  | 'mouse'
  | 'hotkeys'
  | 'sch-display'
  | 'sch-grids'
  | 'sch-editing'
  | 'sch-annotation'
  | 'sch-colors'
  | 'sch-fields';

const PAGES: { id: PageId | null; label: string; indent?: boolean }[] = [
  { id: 'common', label: 'Common' },
  { id: 'mouse', label: 'Mouse and Touchpad' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: null, label: 'Schematic Editor' },
  { id: 'sch-display', label: 'Display Options', indent: true },
  { id: 'sch-grids', label: 'Grids', indent: true },
  { id: 'sch-editing', label: 'Editing Options', indent: true },
  { id: 'sch-annotation', label: 'Annotation Options', indent: true },
  { id: 'sch-colors', label: 'Colors', indent: true },
  { id: 'sch-fields', label: 'Field Name Templates', indent: true },
];

// ----- tiny form helpers ----------------------------------------------------------

function Check({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <label className="ze-pref-check" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  width?: number;
}): JSX.Element {
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      <input
        type="number"
        className="ze-search num"
        value={value}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        style={{ width: width ?? 80 }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

function Sel<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      <select
        className="ze-select"
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange((typeof value === 'number' ? Number(raw) : raw) as T);
        }}
      >
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="ze-pref-group">
      <div className="ze-pref-group-title">{title}</div>
      <div className="ze-pref-group-body">{children}</div>
    </div>
  );
}

/** A label + colour swatch row (KiCad's COLOR_SWATCH). Empty value means "unset". */
function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (css: string) => void;
}): JSX.Element {
  const hex = splitCss(value || fallback).hex;
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      <input
        type="color"
        value={hex}
        style={{ width: 44, height: 20, padding: 0, border: 'none', background: 'none' }}
        onChange={(e) => onChange(joinCss(e.target.value, 1))}
      />
    </label>
  );
}

// ----- colour helpers ---------------------------------------------------------------

/** CSS colour -> #rrggbb + alpha (for <input type=color> round-trips). */
function splitCss(css: string): { hex: string; alpha: number } {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css);
  if (m) {
    const h = (n: string): string => Number(n).toString(16).padStart(2, '0');
    return {
      hex: `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`,
      alpha: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(css)) return { hex: css, alpha: 1 };
  return { hex: '#000000', alpha: 1 };
}

function joinCss(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The Colors page rows: KiCad layer display names (common/layer_id.cpp) -> Theme keys. */
const COLOR_LAYERS: [keyof Theme, string][] = [
  ['anchor', 'Anchors'],
  ['background', 'Background'],
  ['netHighlight', 'Highlighted items'],
  ['bus', 'Buses'],
  ['busJunction', 'Bus junctions'],
  ['symbolFill', 'Symbol body fills'],
  ['symbolOutline', 'Symbol body outlines'],
  ['cursor', 'Cursor'],
  ['ercError', 'ERC errors'],
  ['ercWarning', 'ERC warnings'],
  ['fields', 'Symbol fields'],
  ['grid', 'Grid'],
  ['hidden', 'Hidden items'],
  ['junction', 'Junctions'],
  ['globalLabel', 'Global labels'],
  ['hierLabel', 'Hierarchical labels'],
  ['label', 'Labels'],
  ['noConnect', 'No-connect symbols'],
  ['noteLine', 'Schematic text & graphics'],
  ['privateNote', 'Symbol private text & graphics'],
  ['pin', 'Pins'],
  ['pinName', 'Pin names'],
  ['pinNumber', 'Pin numbers'],
  ['reference', 'Symbol references'],
  ['value', 'Symbol values'],
  ['selectionShadow', 'Selection highlight'],
  ['sheetBorder', 'Sheet borders'],
  ['sheetBackground', 'Sheet backgrounds'],
  ['sheetName', 'Sheet names'],
  ['sheetFields', 'Sheet fields'],
  ['sheetFile', 'Sheet file names'],
  ['sheetLabel', 'Sheet pins'],
  ['wire', 'Wires'],
  ['pageFrame', 'Drawing sheet'],
  ['pageLimits', 'Page limits'],
];

/** Fixed (non-tool) hotkeys shown on the read-only Hotkeys page. */
const FIXED_HOTKEYS: [string, string][] = [
  ['Ctrl+S', 'Save'],
  ['Ctrl+O', 'Open'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / Cut / Paste'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+,', 'Preferences'],
  ['R', 'Rotate Counterclockwise'],
  ['X', 'Mirror Vertically'],
  ['Y', 'Mirror Horizontally'],
  ['E', 'Properties'],
  ['Delete', 'Delete selection'],
  ['Escape', 'Cancel current tool / clear selection'],
];

const TOOL_HOTKEY_NAMES: Record<string, string> = {
  placeSymbol: 'Add Symbol',
  placePower: 'Add Power',
  drawWire: 'Add Wire',
  drawBus: 'Add Bus',
  noConnect: 'Add No Connect Flag',
  junction: 'Add Junction',
  placeLabel: 'Add Label',
  placeHierLabel: 'Add Hierarchical Label',
  placeText: 'Add Text',
  drawSheet: 'Add Hierarchical Sheet',
};

// ----- the dialog ---------------------------------------------------------------------

export function PreferencesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [page, setPage] = useState<PageId>('common');
  const [common, setCommon] = useState<CommonSettings>(() => structuredClone(settings.common));
  const [eeschema, setEeschema] = useState<EeschemaSettings>(() =>
    structuredClone(settings.eeschema),
  );
  const [userColors, setUserColors] = useState<Record<string, string>>(() => ({
    ...settings.userColors,
  }));

  const upC = (fn: (s: CommonSettings) => void): void =>
    setCommon((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });
  const upE = (fn: (s: EeschemaSettings) => void): void =>
    setEeschema((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const ok = (): void => {
    settings.updateCommon((s) => Object.assign(s, common));
    settings.updateEeschema((s) => Object.assign(s, eeschema));
    settings.setUserColors(userColors);
    onClose();
  };

  const resetPage = (): void => {
    switch (page) {
      case 'common':
      case 'mouse':
        setCommon(structuredClone(COMMON_DEFAULTS));
        break;
      case 'sch-colors':
        setUserColors({});
        upE((s) => {
          s.appearance.color_theme = EESCHEMA_DEFAULTS.appearance.color_theme;
        });
        break;
      default:
        setEeschema(structuredClone(EESCHEMA_DEFAULTS));
        break;
    }
  };

  const mouseActionOpts: [MouseDragAction, string][] = [
    ['select', 'Draw selection rectangle'],
    ['drag_selected', 'Drag selected objects; otherwise draw selection rectangle'],
    ['drag_any', 'Drag any object (selected or not)'],
  ];
  const panZoomNone: [MouseDragAction, string][] = [
    ['pan', 'Pan'],
    ['zoom', 'Zoom'],
    ['none', 'None'],
  ];
  const scrollCols: [ScrollModifier, string][] = [
    ['none', '--'],
    ['ctrl', 'Ctrl'],
    ['shift', 'Shift'],
    ['alt', 'Alt'],
  ];

  const themeId = eeschema.appearance.color_theme;
  const activeColors: Theme = useMemo(() => {
    const builtin = BUILTIN_THEMES[themeId];
    if (builtin) return builtin.theme;
    return { ...KICAD_DEFAULT, ...userColors } as Theme;
  }, [themeId, userColors]);

  const body = (): JSX.Element => {
    switch (page) {
      case 'common':
        return (
          <>
            <Group title="Antialiasing">
              <Sel
                label="Accelerated graphics:"
                value={0}
                options={[
                  [0, 'No Antialiasing'],
                  [1, 'Fast Antialiasing'],
                  [2, 'High Quality Antialiasing'],
                ]}
                onChange={() => {}}
              />
              <Sel
                label="Fallback graphics:"
                value={0}
                options={[
                  [0, 'No Antialiasing'],
                  [1, 'Fast Antialiasing'],
                  [2, 'High Quality Antialiasing'],
                ]}
                onChange={() => {}}
              />
              <div className="ze-muted">
                (The browser canvas antialiases on its own; these choices have no effect here.)
              </div>
            </Group>
            <Group title="User Interface">
              <Check
                label="Show icons in menus"
                checked={common.appearance.use_icons_in_menus}
                onChange={(v) =>
                  upC((s) => {
                    s.appearance.use_icons_in_menus = v;
                  })
                }
              />
              <Check
                label="Show scrollbars in editors"
                checked={common.appearance.show_scrollbars}
                onChange={(v) =>
                  upC((s) => {
                    s.appearance.show_scrollbars = v;
                  })
                }
              />
              <Sel
                label="Icon theme:"
                value={common.appearance.icon_theme}
                options={[
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                  ['auto', 'Automatic'],
                ]}
                onChange={(v) =>
                  upC((s) => {
                    s.appearance.icon_theme = v;
                  })
                }
              />
              <Sel
                label="Toolbar icon size:"
                value={common.appearance.toolbar_icon_size}
                options={[
                  ['small', 'Small'],
                  ['normal', 'Normal'],
                  ['large', 'Large'],
                ]}
                onChange={(v) =>
                  upC((s) => {
                    s.appearance.toolbar_icon_size = v;
                  })
                }
              />
              <Num
                label="High-contrast mode dimming factor:"
                value={common.appearance.hicontrast_dimming_factor}
                unit="%"
                min={0}
                max={100}
                onChange={(v) =>
                  upC((s) => {
                    s.appearance.hicontrast_dimming_factor = v;
                  })
                }
              />
            </Group>
            <Group title="Editing">
              <Check
                label="Warp mouse to anchor of moved object"
                checked={common.input.warp_mouse_on_move}
                onChange={(v) =>
                  upC((s) => {
                    s.input.warp_mouse_on_move = v;
                  })
                }
              />
              <Check
                label="First hotkey selects tool"
                checked={!common.input.immediate_actions}
                title="If not checked, hotkeys will immediately perform an action even if the relevant tool was not previously selected."
                onChange={(v) =>
                  upC((s) => {
                    s.input.immediate_actions = !v;
                  })
                }
              />
              <Check
                label="Show popup indicator when toggling settings with hotkeys"
                checked={common.input.hotkey_feedback}
                onChange={(v) =>
                  upC((s) => {
                    s.input.hotkey_feedback = v;
                  })
                }
              />
            </Group>
            <Group title="Session">
              <Check
                label="Remember open files for next project launch"
                checked={common.system.session.remember_open_files}
                onChange={(v) =>
                  upC((s) => {
                    s.system.session.remember_open_files = v;
                  })
                }
              />
              <Num
                label="Auto save:"
                value={Math.round(common.system.autosave_interval / 60)}
                unit="minutes"
                min={0}
                max={60}
                onChange={(v) =>
                  upC((s) => {
                    s.system.autosave_interval = v * 60;
                  })
                }
              />
              <Num
                label="File history size:"
                value={common.system.file_history_size}
                min={0}
                max={50}
                onChange={(v) =>
                  upC((s) => {
                    s.system.file_history_size = v;
                  })
                }
              />
            </Group>
            <Group title="Project Backup">
              <Check
                label="Automatically backup projects"
                checked={common.backup.enabled}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.enabled = v;
                  })
                }
              />
              <Check
                label="Create backups when auto save occurs"
                checked={common.backup.backup_on_autosave}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.backup_on_autosave = v;
                  })
                }
              />
              <Num
                label="Maximum backups to keep:"
                value={common.backup.limit_total_files}
                min={0}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.limit_total_files = v;
                  })
                }
              />
              <Num
                label="Maximum backups per day:"
                value={common.backup.limit_daily_files}
                min={0}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.limit_daily_files = v;
                  })
                }
              />
              <Num
                label="Minimum time between backups:"
                value={Math.round(common.backup.min_interval / 60)}
                unit="minutes"
                min={0}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.min_interval = v * 60;
                  })
                }
              />
              <Num
                label="Maximum total backup size:"
                value={Math.round(common.backup.limit_total_size / 1048576)}
                unit="MB"
                min={0}
                onChange={(v) =>
                  upC((s) => {
                    s.backup.limit_total_size = v * 1048576;
                  })
                }
              />
            </Group>
          </>
        );

      case 'mouse':
        return (
          <>
            <Group title="Pan and Zoom">
              <Check
                label="Center and warp cursor on zoom"
                title="Center the cursor on screen when zooming."
                checked={common.input.center_on_zoom}
                onChange={(v) =>
                  upC((s) => {
                    s.input.center_on_zoom = v;
                  })
                }
              />
              <Check
                label="Automatically pan while moving object"
                title="When drawing a track or moving an item, pan when approaching the edge of the display."
                checked={common.input.auto_pan}
                onChange={(v) =>
                  upC((s) => {
                    s.input.auto_pan = v;
                  })
                }
              />
              <Check
                label="Use zoom acceleration"
                title="Zoom faster when scrolling quickly"
                checked={common.input.zoom_acceleration}
                onChange={(v) =>
                  upC((s) => {
                    s.input.zoom_acceleration = v;
                  })
                }
              />
              <div className="ze-pref-row">
                <span className="lbl">Zoom speed:</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={common.input.zoom_speed}
                  disabled={common.input.zoom_speed_auto}
                  onChange={(e) =>
                    upC((s) => {
                      s.input.zoom_speed = Number(e.target.value);
                    })
                  }
                />
                <Check
                  label="Automatic"
                  checked={common.input.zoom_speed_auto}
                  onChange={(v) =>
                    upC((s) => {
                      s.input.zoom_speed_auto = v;
                    })
                  }
                />
              </div>
              <div className="ze-pref-row">
                <span className="lbl">Auto pan speed:</span>
                <input
                  type="range"
                  min={1}
                  max={9}
                  value={common.input.auto_pan_acceleration}
                  onChange={(e) =>
                    upC((s) => {
                      s.input.auto_pan_acceleration = Number(e.target.value);
                    })
                  }
                />
              </div>
            </Group>
            <Group title="Drag Gestures">
              <Sel
                label="Left button drag:"
                value={common.input.mouse_left}
                options={mouseActionOpts}
                onChange={(v) =>
                  upC((s) => {
                    s.input.mouse_left = v;
                  })
                }
              />
              <Sel
                label="Middle button drag:"
                value={common.input.mouse_middle}
                options={panZoomNone}
                onChange={(v) =>
                  upC((s) => {
                    s.input.mouse_middle = v;
                  })
                }
              />
              <Sel
                label="Right button drag:"
                value={common.input.mouse_right}
                options={panZoomNone}
                onChange={(v) =>
                  upC((s) => {
                    s.input.mouse_right = v;
                  })
                }
              />
            </Group>
            <Group title="Scroll Gestures">
              <div className="ze-muted">
                Vertical touchpad or scroll wheel movement — only one action can be assigned to each
                column:
              </div>
              <table className="ze-pref-scrolltable">
                <thead>
                  <tr>
                    <th></th>
                    {scrollCols.map(([, l]) => (
                      <th key={l}>{l}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Zoom:</td>
                    {scrollCols.map(([v]) => (
                      <td key={v}>
                        <input
                          type="radio"
                          name="scroll-zoom"
                          checked={common.input.scroll_modifier_zoom === v}
                          onChange={() =>
                            upC((s) => {
                              s.input.scroll_modifier_zoom = v;
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <Check
                        label="Reverse"
                        checked={common.input.reverse_scroll_zoom}
                        onChange={(v) =>
                          upC((s) => {
                            s.input.reverse_scroll_zoom = v;
                          })
                        }
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Pan up/down:</td>
                    {scrollCols.map(([v]) => (
                      <td key={v}>
                        <input
                          type="radio"
                          name="scroll-panv"
                          checked={common.input.scroll_modifier_pan_v === v}
                          onChange={() =>
                            upC((s) => {
                              s.input.scroll_modifier_pan_v = v;
                            })
                          }
                        />
                      </td>
                    ))}
                    <td></td>
                  </tr>
                  <tr>
                    <td>Pan left/right:</td>
                    {scrollCols.map(([v]) => (
                      <td key={v}>
                        <input
                          type="radio"
                          name="scroll-panh"
                          checked={common.input.scroll_modifier_pan_h === v}
                          onChange={() =>
                            upC((s) => {
                              s.input.scroll_modifier_pan_h = v;
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <Check
                        label="Reverse"
                        checked={common.input.reverse_scroll_pan_h}
                        onChange={(v) =>
                          upC((s) => {
                            s.input.reverse_scroll_pan_h = v;
                          })
                        }
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <Check
                label="Pan left/right with horizontal movement"
                title="Pan the canvas left and right when scrolling left to right on the touchpad"
                checked={common.input.horizontal_pan}
                onChange={(v) =>
                  upC((s) => {
                    s.input.horizontal_pan = v;
                  })
                }
              />
              <div className="ze-pref-row">
                <button
                  className="ze-btn"
                  onClick={() =>
                    upC((s) => {
                      s.input.scroll_modifier_zoom = 'none';
                      s.input.scroll_modifier_pan_h = 'ctrl';
                      s.input.scroll_modifier_pan_v = 'shift';
                      s.input.reverse_scroll_zoom = false;
                      s.input.reverse_scroll_pan_h = false;
                      s.input.horizontal_pan = false;
                    })
                  }
                >
                  Reset to Mouse Defaults
                </button>
                <button
                  className="ze-btn"
                  onClick={() =>
                    upC((s) => {
                      s.input.scroll_modifier_zoom = 'ctrl';
                      s.input.scroll_modifier_pan_h = 'shift';
                      s.input.scroll_modifier_pan_v = 'none';
                      s.input.horizontal_pan = true;
                    })
                  }
                >
                  Reset to Trackpad Defaults
                </button>
              </div>
            </Group>
          </>
        );

      case 'hotkeys':
        return (
          <Group title="Hotkeys">
            <div className="ze-muted">
              Hotkeys follow KiCad's defaults. Custom bindings are not editable yet.
            </div>
            <table className="ze-pref-hotkeys">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Hotkey</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(TOOL_HOTKEYS).map(([key, toolId]) => (
                  <tr key={key}>
                    <td>{TOOL_HOTKEY_NAMES[toolId] ?? toolId}</td>
                    <td>{key.toUpperCase()}</td>
                  </tr>
                ))}
                {FIXED_HOTKEYS.map(([key, name]) => (
                  <tr key={key}>
                    <td>{name}</td>
                    <td>{key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Group>
        );

      case 'sch-display':
        return (
          <div className="ze-pref-columns">
            <div>
              <Group title="Grid Display">
                <Sel
                  label="Style:"
                  value={eeschema.window.grid.style}
                  options={[
                    ['dots', 'Dots'],
                    ['lines', 'Lines'],
                    ['crosses', 'Small crosses'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.style = v;
                    })
                  }
                />
                <Num
                  label="Grid thickness:"
                  value={eeschema.window.grid.line_width}
                  unit="pixels"
                  min={1}
                  max={5}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.line_width = v;
                    })
                  }
                />
                <Num
                  label="Minimum grid spacing:"
                  value={eeschema.window.grid.min_spacing}
                  unit="pixels"
                  min={2}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.min_spacing = v;
                    })
                  }
                />
                <Sel
                  label="Snap to grid:"
                  value={eeschema.window.grid.snap}
                  options={[
                    [0, 'Always'],
                    [1, 'When grid shown'],
                    [2, 'Never'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.snap = v as 0 | 1 | 2;
                    })
                  }
                />
              </Group>
              <Group title="Cursor">
                <Sel
                  label="Crosshair:"
                  value={eeschema.window.cursor.crosshair}
                  options={[
                    ['small', 'Small crosshairs'],
                    ['full', 'Full window crosshairs'],
                    ['45', '45° full window crosshairs'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.cursor.crosshair = v;
                    })
                  }
                />
                <Check
                  label="Always show crosshairs"
                  checked={eeschema.window.cursor.always_show_cursor}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.cursor.always_show_cursor = v;
                    })
                  }
                />
              </Group>
              <Group title="Cross-probing">
                <Check
                  label="Select/highlight objects corresponding to PCB selection"
                  checked={true}
                  onChange={() => {}}
                  title="Highlight symbols corresponding to selected footprints"
                  disabled
                />
                <Check
                  label="Center view on cross-probed items"
                  checked={true}
                  onChange={() => {}}
                  disabled
                />
                <Check
                  label="Zoom to fit cross-probed items"
                  checked={true}
                  onChange={() => {}}
                  disabled
                />
                <Check
                  label="Highlight cross-probed nets"
                  checked={true}
                  onChange={() => {}}
                  disabled
                />
                <div className="ze-muted">
                  (Cross-probing arrives with schematic↔PCB selection sync.)
                </div>
              </Group>
            </div>
            <div>
              <Group title="Appearance">
                <Sel
                  label="Default font:"
                  value={eeschema.appearance.default_font}
                  options={[['KiCad Font', 'KiCad Font']]}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.default_font = v;
                    })
                  }
                />
                <Check
                  label="Show hidden pins"
                  checked={eeschema.appearance.show_hidden_pins}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_hidden_pins = v;
                    })
                  }
                />
                <Check
                  label="Show hidden fields"
                  checked={eeschema.appearance.show_hidden_fields}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_hidden_fields = v;
                    })
                  }
                />
                <Check
                  label="Show ERC errors"
                  checked={eeschema.appearance.show_erc_errors}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_errors = v;
                    })
                  }
                />
                <Check
                  label="Show ERC warnings"
                  checked={eeschema.appearance.show_erc_warnings}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_warnings = v;
                    })
                  }
                />
                <Check
                  label="Show ERC exclusions"
                  checked={eeschema.appearance.show_erc_exclusions}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_exclusions = v;
                    })
                  }
                />
                <Check
                  label="Mark items which are excluded from simulation"
                  checked={eeschema.appearance.mark_sim_exclusions}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.mark_sim_exclusions = v;
                    })
                  }
                />
                <Check
                  label="Show OP voltages"
                  checked={eeschema.appearance.show_op_voltages}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_op_voltages = v;
                    })
                  }
                />
                <Check
                  label="Show OP currents"
                  checked={eeschema.appearance.show_op_currents}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_op_currents = v;
                    })
                  }
                />
                <Check
                  label="Show pin alternate mode indicator icons"
                  checked={eeschema.appearance.show_pin_alt_icons}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_pin_alt_icons = v;
                    })
                  }
                />
                <Check
                  label="Show page limits"
                  checked={eeschema.appearance.show_page_limits}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_page_limits = v;
                    })
                  }
                />
              </Group>
              <Group title="Selection & Highlighting">
                <Check
                  label="Draw selected child items"
                  checked={eeschema.selection.draw_selected_children}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.draw_selected_children = v;
                    })
                  }
                />
                <Check
                  label="Fill selected shapes"
                  checked={eeschema.selection.fill_shapes}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.fill_shapes = v;
                    })
                  }
                />
                <Num
                  label="Selection thickness:"
                  value={eeschema.selection.thickness}
                  unit="mils"
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.thickness = v;
                    })
                  }
                />
                <div className="ze-muted">(selection color can be edited in the "Colors" page)</div>
                <Num
                  label="Highlight thickness:"
                  value={eeschema.selection.highlight_thickness}
                  unit="mils"
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_thickness = v;
                    })
                  }
                />
                <Check
                  label="Highlight netclass colors"
                  checked={eeschema.selection.highlight_netclass_colors}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors = v;
                    })
                  }
                />
                <Num
                  label="Color highlight thickness:"
                  value={eeschema.selection.highlight_netclass_colors_thickness}
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors_thickness = v;
                    })
                  }
                />
                <Num
                  label="Color highlight opacity:"
                  value={eeschema.selection.highlight_netclass_colors_alpha}
                  unit="%"
                  min={0}
                  max={100}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors_alpha = v;
                    })
                  }
                />
              </Group>
            </div>
          </div>
        );

      case 'sch-grids': {
        const grid = eeschema.window.grid;
        return (
          <>
            <Group title="Grids">
              {grid.sizes.map((size, i) => (
                <div key={i} className="ze-pref-row">
                  <input
                    type="radio"
                    name="cur-grid"
                    checked={grid.last_size_idx === i}
                    onChange={() =>
                      upE((s) => {
                        s.window.grid.last_size_idx = i;
                      })
                    }
                  />
                  <input
                    className="ze-search"
                    value={size}
                    style={{ width: 120 }}
                    onChange={(e) =>
                      upE((s) => {
                        s.window.grid.sizes[i] = e.target.value;
                      })
                    }
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <button
                    className="ze-btn sm"
                    title="Remove grid"
                    disabled={grid.sizes.length <= 1}
                    onClick={() =>
                      upE((s) => {
                        s.window.grid.sizes.splice(i, 1);
                        const clamp = (n: number): number =>
                          Math.min(n, s.window.grid.sizes.length - 1);
                        s.window.grid.last_size_idx = clamp(s.window.grid.last_size_idx);
                        s.window.grid.fast_grid_1 = clamp(s.window.grid.fast_grid_1);
                        s.window.grid.fast_grid_2 = clamp(s.window.grid.fast_grid_2);
                      })
                    }
                  >
                    −
                  </button>
                </div>
              ))}
              <div className="ze-pref-row">
                <button
                  className="ze-btn sm"
                  onClick={() =>
                    upE((s) => {
                      s.window.grid.sizes.push('25 mil');
                    })
                  }
                >
                  + Add grid
                </button>
              </div>
            </Group>
            <Group title="Fast Grid Switching">
              <Sel
                label="Grid 1:"
                value={grid.fast_grid_1}
                options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.fast_grid_1 = v;
                  })
                }
              />
              <Sel
                label="Grid 2:"
                value={grid.fast_grid_2}
                options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.fast_grid_2 = v;
                  })
                }
              />
            </Group>
            <Group title="Grid Overrides">
              <Check
                label="Enable grid overrides"
                checked={grid.overrides_enabled}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.overrides_enabled = v;
                  })
                }
              />
              {(
                [
                  ['connected', 'Connected items:'],
                  ['wires', 'Wires:'],
                  ['text', 'Text:'],
                  ['graphics', 'Graphics:'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="ze-pref-row">
                  <Check
                    label={label}
                    checked={grid.overrides[key].enabled}
                    disabled={!grid.overrides_enabled}
                    onChange={(v) =>
                      upE((s) => {
                        s.window.grid.overrides[key].enabled = v;
                      })
                    }
                  />
                  <input
                    className="ze-search"
                    value={grid.overrides[key].size}
                    style={{ width: 100 }}
                    disabled={!grid.overrides_enabled || !grid.overrides[key].enabled}
                    onChange={(e) =>
                      upE((s) => {
                        s.window.grid.overrides[key].size = e.target.value;
                      })
                    }
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              ))}
            </Group>
          </>
        );
      }

      case 'sch-editing':
        return (
          <div className="ze-pref-columns">
            <div>
              <Group title="Editing">
                <Sel
                  label="Line drawing mode:"
                  value={eeschema.drawing.line_mode}
                  options={[
                    [0, 'Free Angle'],
                    [1, '90 deg Angle'],
                    [2, '45 deg Angle'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.line_mode = v as 0 | 1 | 2;
                    })
                  }
                />
                <Sel
                  label="Arc editing mode:"
                  value={eeschema.drawing.arc_edit_mode}
                  options={[
                    [0, 'Keep center, adjust radius'],
                    [1, 'Keep endpoints or direction of starting point'],
                    [2, 'Keep center and radius, adjust endpoints'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.arc_edit_mode = v as 0 | 1 | 2;
                    })
                  }
                />
                <Check
                  label="Mouse drag performs Drag (G) operation"
                  checked={!eeschema.input.drag_is_move}
                  title="If unchecked, mouse drag will perform move (M) operation"
                  onChange={(v) =>
                    upE((s) => {
                      s.input.drag_is_move = !v;
                    })
                  }
                />
                <Check
                  label="Automatically start wires on unconnected pins"
                  checked={eeschema.drawing.auto_start_wires}
                  title="When enabled, you can start wiring by clicking on unconnected pins even when the wire tool is not active"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.auto_start_wires = v;
                    })
                  }
                />
                <Check
                  label="<ESC> clears net highlighting"
                  checked={eeschema.input.esc_clears_net_highlight}
                  title="First <ESC> in selection tool clears selection, next clears net highlighting"
                  onChange={(v) =>
                    upE((s) => {
                      s.input.esc_clears_net_highlight = v;
                    })
                  }
                />
                <Check
                  label="Automatically annotate symbols"
                  checked={eeschema.annotation.automatic}
                  onChange={(v) =>
                    upE((s) => {
                      s.annotation.automatic = v;
                    })
                  }
                />
                <Check
                  label="Allow unconstrained pin swaps"
                  checked={eeschema.input.allow_unconstrained_pin_swaps}
                  title="Allows swapping symbol pins' positions. May cause invalid design changes; use with caution."
                  onChange={(v) =>
                    upE((s) => {
                      s.input.allow_unconstrained_pin_swaps = v;
                    })
                  }
                />
              </Group>
              <Group title="Defaults for New Objects">
                <ColorRow
                  label="Sheet border:"
                  value={eeschema.drawing.default_sheet_border_color}
                  fallback="rgb(132, 0, 0)"
                  onChange={(css) =>
                    upE((s) => {
                      s.drawing.default_sheet_border_color = css;
                    })
                  }
                />
                <ColorRow
                  label="Sheet background:"
                  value={eeschema.drawing.default_sheet_background_color}
                  fallback="rgb(255, 255, 194)"
                  onChange={(css) =>
                    upE((s) => {
                      s.drawing.default_sheet_background_color = css;
                    })
                  }
                />
                <Sel
                  label="Power Symbols:"
                  value={eeschema.drawing.new_power_symbols}
                  options={[
                    [0, 'Default'],
                    [1, 'Global'],
                    [2, 'Local'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.new_power_symbols = v as 0 | 1 | 2;
                    })
                  }
                />
              </Group>
              <Group title="Left Click Mouse Commands">
                <div className="ze-pref-hint">
                  Left click (and drag) actions depend on 2 modifier keys: Shift and Ctrl
                </div>
                <table className="ze-pref-mouse">
                  <tbody>
                    <tr>
                      <td>Long Click</td>
                      <td>Clarify selection from menu</td>
                    </tr>
                    <tr>
                      <td>Shift</td>
                      <td>Add item(s) to selection</td>
                    </tr>
                    <tr>
                      <td>Ctrl+Shift</td>
                      <td>Remove item(s) from selection</td>
                    </tr>
                  </tbody>
                </table>
              </Group>
            </div>
            <div>
              <Group title="Symbol Field Automatic Placement">
                <Check
                  label="Automatically place symbol fields"
                  checked={eeschema.autoplace_fields.enable}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.enable = v;
                    })
                  }
                />
                <Check
                  label="Allow field autoplace to change justification"
                  checked={eeschema.autoplace_fields.allow_rejustify}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.allow_rejustify = v;
                    })
                  }
                />
                <Check
                  label="Always align autoplaced fields to the 50 mil grid"
                  checked={eeschema.autoplace_fields.align_to_grid}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.align_to_grid = v;
                    })
                  }
                />
              </Group>
              <Group title="Repeated Items">
                <Num
                  label="Horizontal pitch:"
                  value={eeschema.drawing.default_repeat_offset_x}
                  unit="mils"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.default_repeat_offset_x = v;
                    })
                  }
                />
                <Num
                  label="Vertical pitch:"
                  value={eeschema.drawing.default_repeat_offset_y}
                  unit="mils"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.default_repeat_offset_y = v;
                    })
                  }
                />
                <Num
                  label="Label increment:"
                  value={eeschema.drawing.repeat_label_increment}
                  min={-10}
                  max={10}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.repeat_label_increment = v;
                    })
                  }
                />
              </Group>
              <Group title="Dialog Preferences">
                <Check
                  label="Show footprint previews in Symbol Chooser"
                  checked={eeschema.appearance.footprint_preview}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.footprint_preview = v;
                    })
                  }
                />
                <Check
                  label="Never show Rescue Symbols tool"
                  checked={eeschema.system.never_show_rescue_dialog}
                  onChange={(v) =>
                    upE((s) => {
                      s.system.never_show_rescue_dialog = v;
                    })
                  }
                />
              </Group>
            </div>
          </div>
        );

      case 'sch-annotation':
        return (
          <>
            <Group title="Annotation">
              <Check
                label="Automatically annotate symbols"
                checked={eeschema.annotation.automatic}
                onChange={(v) =>
                  upE((s) => {
                    s.annotation.automatic = v;
                  })
                }
              />
            </Group>
            <Group title="Order">
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-order"
                  checked={eeschema.annotation.sort_order === 0}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.sort_order = 0;
                    })
                  }
                />
                Sort symbols by X position
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-order"
                  checked={eeschema.annotation.sort_order === 1}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.sort_order = 1;
                    })
                  }
                />
                Sort symbols by Y position
              </label>
            </Group>
            <Group title="Numbering">
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 0}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 0;
                    })
                  }
                />
                Use first free number after:
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 1}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 1;
                    })
                  }
                />
                First free after sheet number X 100
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 2}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 2;
                    })
                  }
                />
                First free after sheet number X 1000
              </label>
            </Group>
          </>
        );

      case 'sch-colors':
        return (
          <>
            <Group title="Theme">
              <Sel
                label="Theme:"
                value={themeId}
                options={[
                  ['_builtin_default', 'KiCad Default'],
                  ['_builtin_classic', 'KiCad Classic'],
                  ['user', 'User'],
                ]}
                onChange={(v) =>
                  upE((s) => {
                    s.appearance.color_theme = v;
                  })
                }
              />
              {themeId !== 'user' && (
                <div className="ze-muted">
                  Built-in themes are read-only. Select the "User" theme to edit colors.
                </div>
              )}
            </Group>
            <Group title="Colors">
              <div className="ze-pref-colorgrid">
                {COLOR_LAYERS.map(([key, label]) => {
                  const css = activeColors[key];
                  const { hex, alpha } = splitCss(css);
                  return (
                    <label key={key} className="ze-pref-colorrow">
                      <input
                        type="color"
                        value={hex}
                        disabled={themeId !== 'user'}
                        onChange={(e) =>
                          setUserColors((c) => ({ ...c, [key]: joinCss(e.target.value, alpha) }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </Group>
          </>
        );

      case 'sch-fields':
        return (
          <Group title="Field Name Templates">
            <table className="ze-pref-hotkeys">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Visible</th>
                  <th>URL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {eeschema.drawing.field_names.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="ze-search"
                        value={f.name}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.name = e.target.value;
                          })
                        }
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.visible}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.visible = e.target.checked;
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.url}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.url = e.target.checked;
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="ze-btn sm"
                        onClick={() =>
                          upE((s) => {
                            s.drawing.field_names.splice(i, 1);
                          })
                        }
                      >
                        −
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ze-pref-row">
              <button
                className="ze-btn sm"
                onClick={() =>
                  upE((s) => {
                    s.drawing.field_names.push({ name: '', visible: false, url: false });
                  })
                }
              >
                + Add field
              </button>
            </div>
            <div className="ze-muted">
              Template fields are added to every new symbol placed on the schematic.
            </div>
          </Group>
        );
    }
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-prefs-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-prefs-body">
          <div className="ze-prefs-tree">
            {PAGES.map((p) =>
              p.id === null ? (
                <div key={p.label} className="ze-prefs-parent">
                  {p.label}
                </div>
              ) : (
                <div
                  key={p.id}
                  className={`ze-prefs-page${page === p.id ? ' active' : ''}${p.indent ? ' indent' : ''}`}
                  onClick={() => setPage(p.id!)}
                >
                  {p.label}
                </div>
              ),
            )}
          </div>
          <div className="ze-prefs-panel">{body()}</div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={resetPage}>
            Reset to Defaults
          </button>
          <span style={{ flex: 1 }} />
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
