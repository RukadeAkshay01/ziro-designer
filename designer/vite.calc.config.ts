import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the standalone Calculator Tools page as a single self-contained
// bundle (all JS in one chunk, CSS not split, assets inlined) so a tiny
// post-build step can fold it into one HTML file for manual testing.
export default defineConfig({
  base: './',
  define: { __BUILD_STAMP__: JSON.stringify('calc-standalone') },
  plugins: [react()],
  build: {
    outDir: 'dist-calc',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'calc-standalone.html',
      output: { inlineDynamicImports: true, manualChunks: undefined },
    },
  },
});
