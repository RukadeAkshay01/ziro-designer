import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// A short build stamp (git SHA + UTC time) so the running app can show exactly
// which deploy is loaded — this makes "am I on the latest build?" verifiable
// instead of guessing when behaviour looks stale.
function buildStamp(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const t = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return `${sha} ${t}Z`;
  } catch {
    return 'dev';
  }
}

// On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
// asset base must be the repo subpath. Locally it stays '/'. The CI workflow sets
// VITE_BASE=/pcb/.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  plugins: [react()],
  server: { port: 5173 },
});
