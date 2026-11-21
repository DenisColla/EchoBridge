#!/usr/bin/env bash
# Installs a minimal Android SDK for building the PosaViva Android shell.
#
#   ANDROID_HOME (default: $HOME/android-sdk, outside the repo)
#     cmdline-tools/22.0     Android SDK Command-line Tools 22.0 (from dl.google.com)
#     platform-tools         adb, etc.
#     platforms/android-36   compileSdk / targetSdk 36 (Android 16)
#     build-tools/36.0.0     aapt2, apksigner, zipalign, d8
#
# Idempotent: re-running only installs what is missing.
# Usage: tools/setup-android-sdk.sh            (uses $ANDROID_HOME or ~/android-sdk)
#        ANDROID_HOME=/opt/android-sdk tools/setup-android-sdk.sh
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_HOME
# sdkmanager also reads ANDROID_SDK_ROOT on some versions; keep both consistent.
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Keep these in sync with android/app/build.gradle.
PLATFORM="platforms;android-36"
BUILD_TOOLS="build-tools;36.0.0"
PACKAGES=("platform-tools" "$PLATFORM" "$BUILD_TOOLS")

# Pinned Android SDK Command-line Tools 22.0 (repository2-3.xml "cmdline-tools;22.0").
# 22.0 is the last release whose sdkmanager is the classic Java tool. 23.0+
# replaces it with a wrapper around the new "android" CLI, which no longer writes
# licenses/ files, unpacks ~350 MB into ~/.android and enables usage metrics.
CMDLINE_TOOLS_VERSION="22.0"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-15859902_latest.zip"
CMDLINE_TOOLS_SHA1="040d3996a65543d22ec4bf73e4c37aa37a8d4af4"
REPO_BASE="https://dl.google.com/android/repository"

log() { printf '\033[1;34m[android-sdk]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[android-sdk] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) ;;
  *) die "This script installs the Linux cmdline-tools. On macOS/Windows install the SDK via Android Studio and set ANDROID_HOME." ;;
esac
command -v java >/dev/null 2>&1 || die "java not found (JDK 17+ required; JDK 21 recommended)."
command -v unzip >/dev/null 2>&1 || die "unzip not found."
command -v curl >/dev/null 2>&1 || die "curl not found."

mkdir -p "$ANDROID_HOME"
# Installed in a versioned folder so an existing cmdline-tools/latest (possibly a
# newer, CLI-based release) is never clobbered.
CMDLINE_TOOLS_DIR="$ANDROID_HOME/cmdline-tools/$CMDLINE_TOOLS_VERSION"
SDKMANAGER="$CMDLINE_TOOLS_DIR/bin/sdkmanager"

# 1) Command-line tools -------------------------------------------------------
if [ -x "$SDKMANAGER" ]; then
  log "cmdline-tools $CMDLINE_TOOLS_VERSION already present: $CMDLINE_TOOLS_DIR"
else
  log "Downloading Android cmdline-tools ($CMDLINE_TOOLS_ZIP)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 3 --retry-delay 2 -o "$TMP/cmdline-tools.zip" "$REPO_BASE/$CMDLINE_TOOLS_ZIP"
  echo "$CMDLINE_TOOLS_SHA1  $TMP/cmdline-tools.zip" | sha1sum -c - >/dev/null \
    || die "SHA-1 mismatch for $CMDLINE_TOOLS_ZIP"
  unzip -q "$TMP/cmdline-tools.zip" -d "$TMP/x"
  rm -rf "$CMDLINE_TOOLS_DIR"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv "$TMP/x/cmdline-tools" "$CMDLINE_TOOLS_DIR"
  log "cmdline-tools installed in $CMDLINE_TOOLS_DIR"
fi

# sdkmanager is a JVM tool. If HTTPS_PROXY is set and the JVM is not already
# configured for a proxy (e.g. via JAVA_TOOL_OPTIONS), pass it explicitly.
SDK_ARGS=("--sdk_root=$ANDROID_HOME")
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && [[ "${JAVA_TOOL_OPTIONS:-}" != *https.proxyHost* ]]; then
  P="${HTTPS_PROXY:-${https_proxy:-}}"; P="${P#*://}"; P="${P%%/*}"; P="${P##*@}"
  SDK_ARGS+=("--proxy=http" "--proxy_host=${P%%:*}" "--proxy_port=${P##*:}")
fi

# sdkmanager prints \r progress bars and a deprecation banner: keep them in a
# log and only show it when something fails.
SDK_LOG="$(mktemp)"
run_sdkmanager() {
  if ! yes 2>/dev/null | "$SDKMANAGER" "${SDK_ARGS[@]}" "$@" >"$SDK_LOG" 2>&1; then
    # "yes" dies of SIGPIPE when sdkmanager exits, so check the real status below.
    :
  fi
}

# 2) Licenses ----------------------------------------------------------------
if [ -f "$ANDROID_HOME/licenses/android-sdk-license" ]; then
  log "SDK licenses already accepted"
else
  log "Accepting SDK licenses"
  run_sdkmanager --licenses
  [ -f "$ANDROID_HOME/licenses/android-sdk-license" ] \
    || { tr '\r' '\n' <"$SDK_LOG" | tail -n 30 >&2; die "License acceptance failed."; }
fi

# 3) Packages ----------------------------------------------------------------
pkg_dir() { echo "$ANDROID_HOME/${1//;//}"; }
MISSING=()
for p in "${PACKAGES[@]}"; do
  [ -f "$(pkg_dir "$p")/package.xml" ] || MISSING+=("$p")
done
if [ "${#MISSING[@]}" -eq 0 ]; then
  log "All packages already installed"
else
  log "Installing: ${MISSING[*]}"
  run_sdkmanager --install "${MISSING[@]}"
  for p in "${MISSING[@]}"; do
    [ -f "$(pkg_dir "$p")/package.xml" ] \
      || { tr '\r' '\n' <"$SDK_LOG" | grep -vE '^\s*$' | tail -n 30 >&2; die "Failed to install $p"; }
  done
fi
rm -f "$SDK_LOG"

for p in "${PACKAGES[@]}"; do
  rev="$(sed -n 's/^Pkg.Revision=//p' "$(pkg_dir "$p")/source.properties" 2>/dev/null || true)"
  printf '  %-24s %s\n' "$p" "${rev:-installed}"
done
log "Done. ANDROID_HOME=$ANDROID_HOME"
log "Add to your shell:  export ANDROID_HOME=\"$ANDROID_HOME\"; export PATH=\"\$ANDROID_HOME/platform-tools:\$PATH\""
