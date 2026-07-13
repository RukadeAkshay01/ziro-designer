# 3D-model library pipeline

Builds the hosted 3D-model library from the upstream KiCad `packages3D` STEP
set. Since KiCad 10 the upstream repo ships **STEP only** (the `.wrl` meshes
were always a derived artifact); browsers cannot render STEP, so we tessellate
each model once, offline, with the same OpenCascade kernel KiCad's own 3D
viewer uses (`occt-import-js`, OCCT compiled to WASM) and publish web-native
glTF binaries (`.glb`).

- Geometry stays in the STEP file's native **millimetres**; the app-side
  loader (`designer/src/editors/pcb/component3d.ts`) scales by 1/2.54 into
  KiCad model space (1 unit = 0.1 inch), mirroring KiCad's own STEP loader.
- Per-BREP-face STEP colors are preserved: faces are grouped by color into one
  glTF primitive per material (black DIP bodies, metal pins, …).
- Output keys mirror the upstream layout (`<Lib>.3dshapes/<Model>.glb`) so
  `resolveModel` (`model3d.ts`) maps `${KICAD*_3DMODEL_DIR}` references
  straight onto the hosted bucket with `libExt: 'glb'`.

## Rebuild (new upstream release)

```bash
npm install

# 1. Fetch + extract the upstream release (~660 MB archive, ~3.2 GB extracted)
VER=10.0.4
curl -sSL -o pkg3d.tar.gz "https://gitlab.com/kicad/libraries/kicad-packages3D/-/archive/$VER/kicad-packages3D-$VER.tar.gz"
mkdir -p step && tar xzf pkg3d.tar.gz --strip-components=1 -C step

# 2. Convert (resumable; one shard per core, ~1 h on 4 cores for ~7 200 models)
for i in 0 1 2 3; do node convert.mjs --batch step glb $i 4 & done; wait
cat glb/failed-*.log 2>/dev/null  # should be empty

# 3. Upload to the R2 bucket (keys = <Lib>.3dshapes/<Model>.glb at bucket root)
rclone copy glb r2:ziro-3dmodels --transfers 16

# 4. Point the app at it
#    VITE_MODELS3D_URL=https://<public-r2-host>  (no trailing slash needed)
```

The bundled demo set under `designer/public/models3d/` is produced by the
same converter (single-file mode: `node convert.mjs in.step out.glb`).
