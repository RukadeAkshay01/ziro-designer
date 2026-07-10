/**
 * React bindings for the settings manager: subscribe components to the
 * settings snapshots and derive the active schematic colour theme.
 */
import { useSyncExternalStore } from 'react';
import { settings } from './settings.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';

export function useSettingsVersion(): number {
  return useSyncExternalStore(settings.subscribe, () => settings.version);
}

export function useCommonSettings(): typeof settings.common {
  useSettingsVersion();
  return settings.common;
}

export function useEeschemaSettings(): typeof settings.eeschema {
  useSettingsVersion();
  return settings.eeschema;
}

/** Resolve the active theme (COLOR_SETTINGS lookup): builtin id or the User theme. */
export function resolveTheme(): Theme {
  const id = settings.eeschema.appearance.color_theme;
  const builtin = BUILTIN_THEMES[id];
  if (builtin) return builtin.theme;
  // "User" theme: the default theme with the stored per-layer overrides.
  return { ...KICAD_DEFAULT, ...settings.userColors } as Theme;
}

export function useSchematicTheme(): Theme {
  useSettingsVersion();
  return resolveTheme();
}
