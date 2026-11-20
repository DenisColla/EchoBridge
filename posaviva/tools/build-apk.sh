#!/usr/bin/env bash
# Builds the PosaViva release APK:
#   1. npm ci (or npm install) + npm run build in posaviva/web   -> posaviva/web/dist
#   2. copies dist/* into android/app/src/main/assets/www/        (folder cleaned first)
#   3. ./gradlew assembleRelease (signed with android/keystore/posaviva-dev.jks)
#   4. copies the APK to posaviva/release/PosaViva.apk and prints apksigner/aapt2 summaries
#
# Usage: tools/build-apk.sh [--skip-web] [--www DIR]
#   --skip-web   don't run npm; package the existing posaviva/web/dist
#   --www DIR    package DIR (must contain index.html) instead of posaviva/web/dist
# Env:   ANDROID_HOME (default ~/android-sdk; installed via tools/setup-android-sdk.sh if missing)
#        POSAVIVA_VERSION_CODE / POSAVIVA_VERSION_NAME  override versionCode/versionName
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
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
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
    npm ci --no-audit --no-fund || { warn "npm ci failed (no/old lockfile?), falling back to npm install"; npm install --no-audit --no-fund; }
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
"$BT/apksigner" verify --verbose --print-certs "$APK_OUT" \
  | grep -E '^Verifie[sd]|^Verified using|Signer #1 certificate (DN|SHA-256)|^WARNING' || true

log "aapt2 dump badging"
"$BT/aapt2" dump badging "$APK_OUT" \
  | grep -E "^(package|sdkVersion|targetSdkVersion|application-label:|uses-permission|launchable-activity|uses-gl-es|densities)" || true

log "Done: $APK_OUT ($(du -h "$APK_OUT" | cut -f1))"
echo "    Install/update on a USB-connected phone:  adb install -r \"$APK_OUT\""
