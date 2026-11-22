#!/usr/bin/env bash
# Realistic bodies for PosaViva: the MakeHuman topology / rig / weights / expressions /
# helpers keep working, the body SHAPE and skin relief come from the Blender Studio
# "Human Base Meshes" bundle v1.4.1 (CC0 1.0, realistic female / male by Dan Ulrich).
#
#   tools/hbm/run.sh            # everything (download ~50 MB + python venv with bpy on first run)
#   tools/hbm/run.sh fit        # re-fit only (bundle already exported)
#   tools/hbm/run.sh bake       # re-bake the normal maps only
#
# Steps (all intermediate data in tools/.cache/hbm, results in tools/hbm/data):
#   1. download the bundle, export levels 0..3 of both realistic bodies (export_hbm.py, bpy)
#   2. dump the MakeHuman data from the asset build (PV_DUMP_MH=... build-assets.mjs)
#   3. register the MakeHuman bodies onto them (fit.py)      -> data/fit_{f,m}.bin
#   4. bake the sculpted detail into normal maps (bake.py)   -> data/skin_normal_{f,m}.png
#   5. rebuild web/public/assets (build-assets.mjs uses data/ automatically)
# tools/hbm/data is committed, so step 5 alone (node tools/build-assets.mjs) reproduces the assets.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="$ROOT/tools/.cache/hbm"
DATA="$HERE/data"
VENV="${HBM_VENV:-$CACHE/venv}"
URL="https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip"
STEP="${1:-all}"
mkdir -p "$CACHE" "$DATA"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q bpy==5.3.0 scipy pillow
fi
PY="$VENV/bin/python -I"

if [ "$STEP" = all ]; then
  if [ ! -f "$CACHE/bundle/human_base_meshes_bundle.blend" ]; then
    curl -fL -o "$CACHE/hbm.zip" "$URL"
    mkdir -p "$CACHE/bundle.tmp" && (cd "$CACHE/bundle.tmp" && unzip -q -o ../hbm.zip)
    mv "$(dirname "$(find "$CACHE/bundle.tmp" -name human_base_meshes_bundle.blend | head -1)")" "$CACHE/bundle"
    rm -rf "$CACHE/bundle.tmp"
  fi
  $PY "$HERE/export_hbm.py" -- "$CACHE/bundle/human_base_meshes_bundle.blend" "$CACHE"
fi
if [ "$STEP" = all ] || [ "$STEP" = fit ]; then
  PV_DUMP_MH="$CACHE/mh.json" node "$ROOT/tools/build-assets.mjs"
  $PY "$HERE/fit.py" "$CACHE" "$CACHE/out" f m
  cp "$CACHE/out/fit_f.bin" "$CACHE/out/fit_m.bin" "$DATA/"
fi
if [ "$STEP" = all ] || [ "$STEP" = fit ] || [ "$STEP" = bake ]; then
  $PY "$HERE/bake.py" "$CACHE" "$CACHE/out" "$DATA" f m
fi
node "$ROOT/tools/build-assets.mjs"
