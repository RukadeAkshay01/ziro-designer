/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Base URL of the hosted 3D-model library (R2); falls back to /models3d. */
  readonly VITE_MODELS3D_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build stamp (git SHA + UTC time) injected by vite.config.ts `define`. */
declare const __BUILD_STAMP__: string;
