/**
 * Folds the standalone Calculator Tools build (dist-calc) into a single
 * self-contained HTML file with all JS and CSS inlined, so it can be opened
 * directly in any browser (or published as an Artifact) for manual testing.
 *
 * Run after `vite build --config vite.calc.config.ts`; produces
 * dist-calc/calculator-tools.html.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('../dist-calc/', import.meta.url);
const assetsDir = new URL('./assets/', dir);
const assets = readdirSync(assetsDir);
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('build assets not found — run the vite build first');

let jsCode = readFileSync(new URL(js, assetsDir), 'utf8');
const cssCode = readFileSync(new URL(css, assetsDir), 'utf8');

// Neutralise sequences that would terminate the inline <script>/<style> host
// element early (the classic inlining pitfall).
jsCode = jsCode.replace(/<\/script>/gi, '<\\/script>').replace(/<!--/g, '<\\!--');

let html = readFileSync(new URL('calc-standalone.html', dir), 'utf8');
html = html.replace(/<link[^>]+href="[^"]*\.css"[^>]*>/, () => `<style>${cssCode}</style>`);
html = html.replace(
  /<script[^>]+src="[^"]*\.js"[^>]*><\/script>/,
  () => `<script type="module">${jsCode}</script>`,
);

const out = new URL('calculator-tools.html', dir);
writeFileSync(out, html);
console.log(
  `wrote ${out.pathname} (${(html.length / 1024).toFixed(0)} KB, single self-contained file)`,
);
