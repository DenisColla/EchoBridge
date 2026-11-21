#!/usr/bin/env bash
# Downloads the CC0 MakeHuman assets (base mesh hm08, targets, default rig, eyes)
# into tools/.cache/makehuman. Only the CC0 data folders are checked out.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/.cache/makehuman"
if [ -f "$DEST/makehuman/data/3dobjs/base.obj" ]; then echo "MakeHuman data already present in $DEST"; exit 0; fi
rm -rf "$DEST"; mkdir -p "$(dirname "$DEST")"
git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman "$DEST"
cd "$DEST"
git sparse-checkout set makehuman/data/3dobjs makehuman/data/rigs makehuman/data/targets makehuman/data/eyes makehuman/data/poseunits makehuman/data/skins makehuman/data/litspheres
echo "Done: $DEST/makehuman/data"
