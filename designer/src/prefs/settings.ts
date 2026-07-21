/**
 * Application settings, mirroring KiCad's JSON settings files.
 *
 * The shapes and key names follow KiCad's own settings classes so the stored
 * JSON reads like a KiCad `common.json` / `eeschema.json`:
 *   - COMMON_SETTINGS   (common/settings/common_settings.cpp)
 *   - EESCHEMA_SETTINGS (eeschema/eeschema_settings.cpp)
 * Defaults are KiCad 9.0's defaults. Persistence is localStorage (the web
 * equivalent of the ~/.config/kicad settings directory), merged over the
 * defaults on load so new keys pick up their defaults automatically.
 */

// ----- COMMON_SETTINGS ---------------------------------------------------------

/** MOUSE_DRAG_ACTION (common_settings.h). */
export type MouseDragAction = 'select' | 'drag_selected' | 'drag_any' | 'pan' | 'zoom' | 'none';

/** Scroll-wheel modifier assignment: which modifier triggers each gesture. */
export type ScrollModifier = 'none' | 'ctrl' | 'shift' | 'alt';

export interface CommonSettings {
  appearance: {
    /** PANEL_COMMON_SETTINGS "Icon theme": light | dark | auto. */
    icon_theme: 'light' | 'dark' | 'auto';
    toolbar_icon_size: 'small' | 'normal' | 'large';
    show_scrollbars: boolean;
    use_icons_in_menus: boolean;
    hicontrast_dimming_factor: number;
  };
  input: {
    auto_pan: boolean;
    auto_pan_acceleration: number; // 0..9
    center_on_zoom: boolean;
    warp_mouse_on_move: boolean;
    hotkey_feedback: boolean;
    immediate_actions: boolean; // !("First hotkey selects tool")
    zoom_acceleration: boolean;
    zoom_speed: number; // 1..10
    zoom_speed_auto: boolean;
    horizontal_pan: boolean;
    scroll_modifier_zoom: ScrollModifier;
    scroll_modifier_pan_h: ScrollModifier;
    scroll_modifier_pan_v: ScrollModifier;
    reverse_scroll_zoom: boolean;
    reverse_scroll_pan_h: boolean;
    mouse_left: MouseDragAction; // select | drag_selected | drag_any
    mouse_middle: MouseDragAction; // pan | zoom | none
    mouse_right: MouseDragAction; // pan | zoom | none
  };
  system: {
    file_history_size: number;
    autosave_interval: number; // seconds; 0 = disabled
    session: {
      remember_open_files: boolean;
      /** Libraries pinned to the top of the chooser tree (SESSION.pinned_symbol_libs). */
      pinned_symbol_libs: string[];
    };
  };
  backup: {
    enabled: boolean;
    backup_on_autosave: boolean;
    limit_total_files: number;
    limit_daily_files: number;
    min_interval: number; // seconds
    limit_total_size: number; // bytes
  };
}

export const COMMON_DEFAULTS: CommonSettings = {
  appearance: {
    icon_theme: 'auto',
    toolbar_icon_size: 'normal',
    show_scrollbars: true,
    use_icons_in_menus: true,
    hicontrast_dimming_factor: 80,
  },
  input: {
    auto_pan: false,
    auto_pan_acceleration: 5,
    center_on_zoom: true,
    warp_mouse_on_move: true,
    hotkey_feedback: true,
    immediate_actions: true,
    zoom_acceleration: false,
    zoom_speed: 1,
    zoom_speed_auto: true,
    horizontal_pan: false,
    scroll_modifier_zoom: 'none',
    scroll_modifier_pan_h: 'ctrl',
    scroll_modifier_pan_v: 'shift',
    reverse_scroll_zoom: false,
    reverse_scroll_pan_h: false,
    mouse_left: 'drag_selected',
    mouse_middle: 'pan',
    mouse_right: 'pan',
  },
  system: {
    file_history_size: 9,
    autosave_interval: 600,
    session: { remember_open_files: false, pinned_symbol_libs: [] },
  },
  backup: {
    enabled: true,
    backup_on_autosave: false,
    limit_total_files: 25,
    limit_daily_files: 5,
    min_interval: 300,
    limit_total_size: 104857600,
  },
};

// ----- EESCHEMA_SETTINGS --------------------------------------------------------

/** LINE_MODE (sch_line.h): 0 = free, 1 = 90°, 2 = 45°. */
export type LineMode = 0 | 1 | 2;

export interface TemplateFieldName {
  name: string;
  visible: boolean;
  url: boolean;
}

export interface GridOverride {
  enabled: boolean;
  size: string;
}

export interface EeschemaSettings {
  appearance: {
    /** Active colour theme id: '_builtin_default' | '_builtin_classic' | 'user'. */
    color_theme: string;
    default_font: string;
    show_hidden_pins: boolean;
    show_hidden_fields: boolean;
    show_erc_errors: boolean;
    show_erc_warnings: boolean;
    show_erc_exclusions: boolean;
    mark_sim_exclusions: boolean;
    show_op_voltages: boolean;
    show_op_currents: boolean;
    show_pin_alt_icons: boolean;
    show_page_limits: boolean;
    footprint_preview: boolean;
  };
  autoplace_fields: {
    enable: boolean;
    allow_rejustify: boolean;
    align_to_grid: boolean;
  };
  drawing: {
    default_line_thickness: number; // mils
    default_wire_thickness: number; // mils
    default_bus_thickness: number; // mils
    default_text_size: number; // mils
    line_mode: LineMode;
    /** editing.arc_edit_mode: 0 keep-center/adjust-radius, 1 keep-endpoints, 2 keep-center+radius. */
    arc_edit_mode: 0 | 1 | 2;
    auto_start_wires: boolean;
    repeat_label_increment: number;
    default_repeat_offset_x: number; // mils
    default_repeat_offset_y: number; // mils
    field_names: TemplateFieldName[];
    default_sheet_border_color: string;
    default_sheet_background_color: string;
    /** drawing.new_power_symbols: 0 Default, 1 Global, 2 Local (POWER_SYMBOLS). */
    new_power_symbols: 0 | 1 | 2;
  };
  input: {
    drag_is_move: boolean;
    esc_clears_net_highlight: boolean;
    /** input.allow_unconstrained_pin_swaps: allow swapping symbol pin positions. */
    allow_unconstrained_pin_swaps: boolean;
  };
  /** system.never_show_rescue_dialog (RescueNeverShow). */
  system: {
    never_show_rescue_dialog: boolean;
  };
  selection: {
    thickness: number; // mils
    highlight_thickness: number; // mils
    draw_selected_children: boolean;
    fill_shapes: boolean;
    highlight_netclass_colors: boolean;
    highlight_netclass_colors_thickness: number;
    highlight_netclass_colors_alpha: number;
  };
  annotation: {
    automatic: boolean;
    recursive: boolean;
    method: 0 | 1 | 2; // first free | sheet*100 | sheet*1000
    sort_order: 0 | 1; // by X | by Y
  };
  /** LIB_TREE persisted state (EESCHEMA_SETTINGS m_LibTree). */
  lib_tree: {
    open_libs: string[];
  };
  /** Symbol Chooser dialog state (EESCHEMA_SETTINGS m_SymChooserPanel). */
  sym_chooser: {
    sash_pos_h: number; // px width of the right (preview) pane
    sash_pos_v: number; // px height of the details pane (power layout)
    sort_mode: 0 | 1; // SORT_MODE: 0 best match, 1 alphabetic
  };
  window: {
    grid: {
      sizes: string[]; // "50 mil", "25 mil", ...
      last_size_idx: number;
      fast_grid_1: number;
      fast_grid_2: number;
      /** GAL grid appearance (gal_options_panel): dots | lines | crosses. */
      style: 'dots' | 'lines' | 'crosses';
      line_width: number; // px
      min_spacing: number; // px
      snap: 0 | 1 | 2; // always | when shown | never
      show: boolean;
      /** Whether the per-item grid overrides apply (ACTIONS::toggleGridOverrides). */
      overrides_enabled: boolean;
      overrides: {
        connected: GridOverride;
        wires: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    cursor: {
      /** Crosshair mode (cursorSmall/Full/45Crosshairs): small cross, full-window, or 45°. */
      crosshair: 'small' | 'full' | '45';
      always_show_cursor: boolean;
    };
  };
}

export const EESCHEMA_DEFAULTS: EeschemaSettings = {
  appearance: {
    color_theme: '_builtin_default',
    default_font: 'KiCad Font',
    show_hidden_pins: false,
    show_hidden_fields: false,
    show_erc_errors: true,
    show_erc_warnings: true,
    show_erc_exclusions: false,
    mark_sim_exclusions: true,
    show_op_voltages: true,
    show_op_currents: true,
    show_pin_alt_icons: true,
    show_page_limits: true,
    footprint_preview: true,
  },
  autoplace_fields: {
    enable: true,
    allow_rejustify: true,
    align_to_grid: true,
  },
  drawing: {
    default_line_thickness: 6,
    default_wire_thickness: 6,
    default_bus_thickness: 12,
    default_text_size: 50,
    line_mode: 1,
    arc_edit_mode: 0,
    auto_start_wires: true,
    repeat_label_increment: 1,
    default_repeat_offset_x: 0,
    default_repeat_offset_y: 100,
    field_names: [],
    default_sheet_border_color: '',
    default_sheet_background_color: '',
    new_power_symbols: 0,
  },
  input: {
    drag_is_move: false,
    esc_clears_net_highlight: true,
    allow_unconstrained_pin_swaps: false,
  },
  system: {
    never_show_rescue_dialog: false,
  },
  selection: {
    thickness: 3,
    highlight_thickness: 2,
    draw_selected_children: true,
    fill_shapes: false,
    highlight_netclass_colors: false,
    highlight_netclass_colors_thickness: 15,
    highlight_netclass_colors_alpha: 60,
  },
  annotation: {
    automatic: true,
    recursive: true,
    method: 0,
    sort_order: 0,
  },
  lib_tree: {
    open_libs: [],
  },
  sym_chooser: {
    sash_pos_h: 360,
    sash_pos_v: 150,
    sort_mode: 0,
  },
  window: {
    grid: {
      sizes: ['100 mil', '50 mil', '25 mil', '10 mil'],
      last_size_idx: 1,
      fast_grid_1: 1,
      fast_grid_2: 2,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      overrides_enabled: false,
      overrides: {
        connected: { enabled: false, size: '50 mil' },
        wires: { enabled: false, size: '50 mil' },
        text: { enabled: false, size: '25 mil' },
        graphics: { enabled: false, size: '25 mil' },
      },
    },
    cursor: {
      crosshair: 'full',
      always_show_cursor: false,
    },
  },
};

/** Parse a grid size string ("50 mil", "1.27 mm") into IU (100 nm). */
export function gridSizeToIU(size: string): number {
  const m = /^\s*([\d.]+)\s*(mil|mils|mm|in|inch)?\s*$/i.exec(size);
  if (!m) return 12700; // 50 mil fallback
  const v = Number(m[1]);
  const unit = (m[2] ?? 'mil').toLowerCase();
  if (!Number.isFinite(v) || v <= 0) return 12700;
  if (unit.startsWith('mm')) return Math.round(v * 10000);
  if (unit.startsWith('in')) return Math.round(v * 254000);
  return Math.round(v * 254); // mils
}

// ----- persistence + store --------------------------------------------------------

function deepMerge<T>(defaults: T, stored: unknown): T {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return (stored === undefined ? defaults : stored) as T;
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (typeof stored === 'object' && stored !== null) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(defaults);
    return deepMerge(structuredClone(defaults), JSON.parse(raw));
  } catch {
    return structuredClone(defaults);
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — settings simply don't persist */
  }
}

type Listener = () => void;

/**
 * SETTINGS_MANAGER, web edition: owns the common + eeschema settings and the
 * active color theme, persists on every change, and notifies subscribers (the
 * editors re-render through useSyncExternalStore).
 */
class SettingsManager {
  common: CommonSettings = load('ziroeda.common', COMMON_DEFAULTS);
  eeschema: EeschemaSettings = load('ziroeda.eeschema', EESCHEMA_DEFAULTS);
  /** The editable "User" colour theme: layer-key -> CSS colour overrides. */
  userColors: Record<string, string> = load('ziroeda.colors.user', {});
  private listeners = new Set<Listener>();
  /** Monotonic snapshot id for useSyncExternalStore. */
  version = 0;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  updateCommon(mutate: (s: CommonSettings) => void): void {
    const next = structuredClone(this.common);
    mutate(next);
    this.common = next;
    store('ziroeda.common', next);
    this.notify();
  }

  updateEeschema(mutate: (s: EeschemaSettings) => void): void {
    const next = structuredClone(this.eeschema);
    mutate(next);
    this.eeschema = next;
    store('ziroeda.eeschema', next);
    this.notify();
  }

  resetCommon(): void {
    this.common = structuredClone(COMMON_DEFAULTS);
    store('ziroeda.common', this.common);
    this.notify();
  }

  resetEeschema(): void {
    this.eeschema = structuredClone(EESCHEMA_DEFAULTS);
    store('ziroeda.eeschema', this.eeschema);
    this.notify();
  }

  setUserColors(colors: Record<string, string>): void {
    this.userColors = { ...colors };
    store('ziroeda.colors.user', this.userColors);
    this.notify();
  }

  resetUserColors(): void {
    this.userColors = {};
    store('ziroeda.colors.user', this.userColors);
    this.notify();
  }
}

export const settings = new SettingsManager();
