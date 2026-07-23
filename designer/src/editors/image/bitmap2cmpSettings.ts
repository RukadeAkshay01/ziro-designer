/**
 * BITMAP2CMP_SETTINGS, web edition (`bitmap2cmp_settings.cpp`). The stored JSON
 * uses KiCad's own key names from `bitmap2component.json` (schema v1) so the
 * blob reads like the desktop settings file: units / threshold / negative /
 * last_format / last_mod_layer plus the last input/output file names.
 * Persistence is localStorage, like the rest of the app's settings.
 *
 * The file-history side (KiCad's FILE_HISTORY, surfaced as File → Open Recent)
 * has no path-based equivalent in a browser, so recent images are kept as data
 * URLs — same pattern as the Drawing Sheet Editor's recent files.
 */

export interface Bitmap2CmpSettings {
  bitmap_file_name: string;
  converted_file_name: string;
  /** Output-size unit choice: 0 mm, 1 inch, 2 DPI. */
  units: number;
  /** Black/white threshold, 0..100. */
  threshold: number;
  negative: boolean;
  /** OUTPUT_FMT_ID: 0 symbol, 1 symbol-paste, 2 footprint, 3 postscript, 4 drawing sheet. */
  last_format: number;
  /** Footprint outline layer index (F.Cu first, PCBNew ordering). */
  last_mod_layer: number;
}

export const BITMAP2CMP_DEFAULTS: Bitmap2CmpSettings = {
  bitmap_file_name: '',
  converted_file_name: '',
  units: 0,
  threshold: 50,
  negative: false,
  last_format: 0,
  last_mod_layer: 0,
};

const SETTINGS_KEY = 'ziroeda.bitmap2cmp';

export function loadBitmap2CmpSettings(): Bitmap2CmpSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...BITMAP2CMP_DEFAULTS };
    return { ...BITMAP2CMP_DEFAULTS, ...(JSON.parse(raw) as Partial<Bitmap2CmpSettings>) };
  } catch {
    return { ...BITMAP2CMP_DEFAULTS };
  }
}

export function saveBitmap2CmpSettings(s: Bitmap2CmpSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — settings simply don't persist */
  }
}

// ----- recent images (FILE_HISTORY) -------------------------------------------

export interface RecentImage {
  name: string;
  /** The image bytes as a data URL, so Open Recent can reload them. */
  data: string;
}

const RECENT_KEY = 'ziroeda.bitmap2cmp.recent';
const RECENT_MAX = 5;
/** Skip storing images whose data URL would blow the localStorage quota. */
const RECENT_MAX_DATA = 1_500_000;

export function loadRecentImages(): RecentImage[] {
  try {
    const v = localStorage.getItem(RECENT_KEY);
    return v ? (JSON.parse(v) as RecentImage[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentImages(list: RecentImage[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* quota exceeded — drop the history rather than the session */
  }
}

/** Prepend a file to the history (deduplicated by name), UpdateFileHistory-style. */
export function pushRecentImage(list: RecentImage[], entry: RecentImage): RecentImage[] {
  if (entry.data.length > RECENT_MAX_DATA) return list;
  return [entry, ...list.filter((r) => r.name !== entry.name)].slice(0, RECENT_MAX);
}
