The ecc83 demo is bundled from the upstream KiCad `demos/` directory
(GPL-3.0-or-later, Copyright The KiCad Developers) so File > Open Demo Project
always works and CI has a real-world compatibility fixture. The full demo
corpus is served from the hosted CDN (VITE_DEMOS_URL -> R2); build the upload
tree with `node tools/demos/build.mjs`.
