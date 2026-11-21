#!/usr/bin/env bash
# Builds the PosaViva release APK:
#   1. npm ci (skipped when node_modules is current) + npm run build in posaviva/web -> web/dist
#   2. copies dist/* into android/app/src/main/assets/www/ (folder cleaned first) and checks
#      that the data files exist, every local reference resolves and nothing loads remote URLs
#   3. ./gradlew assembleRelease (R8-shrunk, signed with android/keystore/posaviva-dev.jks)
#   4. copies the APK to posaviva/release/PosaViva.apk, runs apksigner verify, prints the
#      aapt2 badging and checks that every assets/www file made it into the APK
#
# Usage: tools/build-apk.sh [--skip-web] [--www DIR]
#   --skip-web   don't run npm; package the existing posaviva/web/dist
#   --www DIR    package DIR (must contain index.html) instead of posaviva/web/dist
# Env:   ANDROID_HOME (default ~/android-sdk; installed via tools/setup-android-sdk.sh if missing)
#        POSAVIVA_VERSION_CODE / POSAVIVA_VERSION_NAME  override versionCode/versionName
#        POSAVIVA_NPM_CI=1  always reinstall node_modules with npm ci
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WEB="$ROOT/web"
ANDROID="$ROOT/android"
WWW="$ANDROID/app/src/main/assets/www"
APK_SRC="$ANDROID/app/build/outputs/apk/release/app-release.apk"
APK_OUT="$ROOT/release/PosaViva.apk"
BUILD_TOOLS_VERSION="36.0.0"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

SKIP_WEB=0
DIST="$WEB/dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-web) SKIP_WEB=1 ;;
    --www) [ $# -ge 2 ] || die "--www needs a directory"; DIST="$(cd "$2" && pwd)"; SKIP_WEB=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

# --- Toolchain ----------------------------------------------------------------
command -v java >/dev/null 2>&1 || die "java not found (JDK 17+ required, JDK 21 recommended)."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
unset ANDROID_SDK_ROOT || true
if [ ! -f "$ANDROID_HOME/platforms/android-36/package.xml" ] \
   || [ ! -x "$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION/apksigner" ]; then
  log "Android SDK incomplete in $ANDROID_HOME, running setup-android-sdk.sh"
  "$HERE/setup-android-sdk.sh"
fi
BT="$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION"

# --- 1. Web build ---------------------------------------------------------------
if [ "$SKIP_WEB" -eq 1 ]; then
  log "Skipping web build (packaging $DIST)"
elif [ ! -f "$WEB/package.json" ]; then
  warn "posaviva/web/package.json not found: the web app does not exist yet, skipping the npm build."
else
  command -v npm >/dev/null 2>&1 || die "npm not found (Node 20+ required)."
  log "Building web app (posaviva/web)"
  (
    cd "$WEB"
    # npm keeps a copy of the installed tree in node_modules/.package-lock.json. When neither
    # package.json nor package-lock.json is newer, the install is current: skip it (npm ci
    # would delete node_modules, which breaks a running dev server and needs the network).
    if [ -f node_modules/.package-lock.json ] && [ -f package-lock.json ] \
       && ! [ package-lock.json -nt node_modules/.package-lock.json ] \
       && ! [ package.json -nt node_modules/.package-lock.json ] && [ "${POSAVIVA_NPM_CI:-0}" != 1 ]; then
      echo "    node_modules up to date (POSAVIVA_NPM_CI=1 forces a clean install)"
    elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
      npm ci --no-audit --no-fund || { warn "npm ci failed, falling back to npm install"; npm install --no-audit --no-fund; }
    else
      npm install --no-audit --no-fund
    fi
    npm run build
  )
fi

# --- 2. Copy into assets/www ----------------------------------------------------
if [ -f "$DIST/index.html" ]; then
  log "Copying $DIST -> app/src/main/assets/www"
  rm -rf "$WWW"
  mkdir -p "$WWW"
  cp -a "$DIST/." "$WWW/"
  touch "$WWW/.gitkeep"
  printf '    %s files, %s\n' "$(find "$WWW" -type f ! -name .gitkeep | wc -l)" "$(du -sh "$WWW" | cut -f1)"
elif [ -f "$WWW/index.html" ]; then
  warn "$DIST/index.html not found: packaging the existing content of assets/www unchanged."
else
  die "Nothing to package: no $DIST/index.html and assets/www is empty. Build the web app first (or use --www DIR)."
fi

# Packaging sanity check: the runtime data files exist, every "./x.js|css|png|..." that
# index.html and the chunks reference exists (refs starting with "./assets/" resolve
# against the page, others against the referencing file), and no remote URL is loaded:
# the APK has no INTERNET permission, so a font or CDN link would simply fail on the phone.
if command -v node >/dev/null 2>&1; then
  node - "$WWW" <<'NODE' || die "assets/www is incomplete (see above)."
const fs = require('fs'), path = require('path');
const www = process.argv[2];
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(www);
const missing = [], remote = new Set();
for (const req of ['index.html', 'assets/human.json', 'assets/human.bin', 'assets/eye.png', 'assets/skin.png']) {
  if (!fs.existsSync(path.join(www, req))) missing.push(`${req} (required)`);
}
for (const f of files.filter((p) => /\.(html|js|css)$/.test(p))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/["'`(]\.\/([\w@./-]+\.(?:js|css|png|jpe?g|webp|svg|bin|json|woff2?|ttf))["'`)]/g)) {
    const base = m[1].startsWith('assets/') ? www : path.dirname(f);
    if (!fs.existsSync(path.join(base, m[1]))) missing.push(`${path.relative(www, f)} -> ./${m[1]}`);
  }
  for (const m of src.matchAll(/(?:https?:|["'`(])\/\/(?!www\.w3\.org\/)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?=[\/:"'`)?#]|$)[^\s"'`)]*/gi)) remote.add(`${path.relative(www, f)}: ${m[0].replace(/^["'`(]/, '')}`);
}
if (remote.size) console.warn('\x1b[1;33m[warn]\x1b[0m remote URLs in the web build (no network in the APK):\n  ' + [...remote].slice(0, 20).join('\n  '));
if (missing.length) { console.error('\x1b[1;31m[error]\x1b[0m missing files:\n  ' + missing.join('\n  ')); process.exit(1); }
console.log(`    checked ${files.length} files: data files present, all local references resolve`);
NODE
else
  warn "node not found: skipping the assets/www reference check."
fi

# --- 3. Gradle ---------------------------------------------------------------------
GRADLE_ARGS=(assembleRelease)
[ -n "${POSAVIVA_VERSION_CODE:-}" ] && GRADLE_ARGS+=("-PversionCode=$POSAVIVA_VERSION_CODE")
[ -n "${POSAVIVA_VERSION_NAME:-}" ] && GRADLE_ARGS+=("-PversionName=$POSAVIVA_VERSION_NAME")

log "Gradle ${GRADLE_ARGS[*]}"
GRADLE_LOG="$(mktemp)"
trap 'rm -f "$GRADLE_LOG"' EXIT
attempt=1
while :; do
  set +e
  (cd "$ANDROID" && ./gradlew "${GRADLE_ARGS[@]}") 2>&1 | tee "$GRADLE_LOG"
  status=${PIPESTATUS[0]}
  set -e
  [ "$status" -eq 0 ] && break
  # Maven Central / Google Maven occasionally answer 429 or drop connections. Downloads that
  # succeeded are cached, so a retry continues where it stopped. Real build errors are not retried.
  if [ "$attempt" -lt 4 ] && grep -qE 'status code (429|5[0-9][0-9])|Could not (GET|HEAD|download|resolve)|Connection reset|timed out' "$GRADLE_LOG"; then
    attempt=$((attempt + 1))
    warn "Dependency download failed (network/rate limit), retrying ($attempt/4) in 10s..."
    sleep 10
    continue
  fi
  die "Gradle build failed."
done

# --- 4. Output + verification ----------------------------------------------------
[ -f "$APK_SRC" ] || die "APK not found at $APK_SRC"
mkdir -p "$(dirname "$APK_OUT")"
cp -f "$APK_SRC" "$APK_OUT"

log "apksigner verify"
# --min-sdk-version 24 makes apksigner check the v2 block as well: with the APK's own
# minSdk 30 it would only exercise v3 and report v2 as "false" although it is present.
if ! VERIFY_OUT="$("$BT/apksigner" verify --verbose --print-certs --min-sdk-version 24 "$APK_OUT" 2>&1)"; then
  echo "$VERIFY_OUT" >&2
  die "apksigner verify FAILED for $APK_OUT"
fi
echo "$VERIFY_OUT" | grep -E '^Verifies|^Verified using v[1-4] |Signer #1 certificate (DN|SHA-256)|^WARNING' || true

log "aapt2 dump badging"
"$BT/aapt2" dump badging "$APK_OUT" \
  | grep -E "^ *(package|minSdkVersion|targetSdkVersion|application-label:|uses-permission|launchable-activity|uses-gl-es|densities)" || true

log "APK contents"
# Every file of assets/www must be in the APK (aapt2's ignore pattern silently drops some names).
WWW_LIST="$(cd "$WWW" && find . -type f ! -name '.*' | sed 's#^\./#assets/www/#' | sort)"
APK_LIST="$(unzip -Z1 "$APK_OUT" 'assets/www/*' 2>/dev/null | sort)"
DROPPED="$(comm -23 <(echo "$WWW_LIST") <(echo "$APK_LIST"))"
[ -z "$DROPPED" ] || die "files of assets/www missing from the APK:
$DROPPED"
unzip -lv "$APK_OUT" | awk '
  / assets\/www\// { n++; raw += $1; packed += $3; if ($3 > 150000) big = big sprintf("      %-44s %7.0f KB -> %7.0f KB (%s)\n", substr($8, 12), $1/1024, $3/1024, $2) }
  / classes[0-9]*\.dex$/ { dex += $3 }
  END {
    printf "    web assets: %d files, %.1f MB -> %.1f MB in the APK\n", n, raw/1048576, packed/1048576
    printf "%s", big
    printf "    dex: %.0f KB\n", dex/1024
  }'

log "Done: $APK_OUT ($(du -h "$APK_OUT" | cut -f1))"
echo "    Install/update on a USB-connected phone:  adb install -r \"$APK_OUT\""
