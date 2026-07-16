/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Base URL of the hosted 3D-model library (R2); falls back to /models3d. */
  readonly VITE_MODELS3D_URL?: string;
  /** Hosted demo-corpus base URL (R2); falls back to the bundled /demos. */
  readonly VITE_DEMOS_URL?: string;
  /** Full hosted symbol-library base URL (R2); falls back to bundled /symbols. */
  readonly VITE_SYMBOLS_URL?: string;
  /** Full hosted footprint-library base URL (R2); falls back to bundled /footprints. */
  readonly VITE_FOOTPRINTS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build stamp (git SHA + UTC time) injected by vite.config.ts `define`. */
declare const __BUILD_STAMP__: string;
