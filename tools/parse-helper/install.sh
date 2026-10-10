#!/bin/sh
# Plexus Diagram local helper.
#
# macOS, default: the light Rust helper (Apple Vision OCR, about 15 MB).
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh
# Docling add-on (Python, about 1.1 GB), and every install on another system:
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --docling
# High accuracy on top of that (PaddleOCR-VL-0.9B, Qwen3-VL-8B-Instruct-4bit for page text, and PP-DocLayoutV2, first read, SHA-256 checked):
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --docling --vlm
# Remove the LaunchAgent and the installed files:
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --uninstall
# Switch a Mac that already has something on port 48765:
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --replace
#
# curl does not set the Gatekeeper quarantine attribute. A binary saved from a
# browser does. Clear it with: xattr -d com.apple.quarantine <file>
# This script clears that attribute on the files it installs, when it is set.
#
# Environment overrides (tests and unusual installs):
#   PLEXUS_HELPER_PREFIX, PLEXUS_HELPER_PORT, PLEXUS_HELPER_URL,
#   PLEXUS_LAUNCH_AGENTS_DIR, PLEXUS_LAUNCHCTL, PLEXUS_HELPER_LOG,
#   PLEXUS_HELPER_RELEASE_DIR, PLEXUS_HELPER_RELEASE_BASE, PLEXUS_HELPER_TAG,
#   PLEXUS_HELPER_OS, PLEXUS_HELPER_ARCH, PLEXUS_HELPER_SKIP_WAIT, PLEXUS_HELPER_SPEC
set -eu

SPEC="${PLEXUS_HELPER_SPEC:-git+https://github.com/Svyk/plexus-diagram#subdirectory=tools/parse-helper}"
PORT="${PLEXUS_HELPER_PORT:-48765}"
URL="${PLEXUS_HELPER_URL:-http://127.0.0.1:${PORT}}"
HELPER=plexus-parse-helper
LABEL=com.plexus.parse-helper
PREFIX="${PLEXUS_HELPER_PREFIX:-$HOME/Library/Application Support/plexus-parse-helper}"
BIN_DIR="${PREFIX}/bin"
AGENTS="${PLEXUS_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="${AGENTS}/${LABEL}.plist"
LOG="${PLEXUS_HELPER_LOG:-$HOME/Library/Logs/plexus-parse-helper.log}"
LAUNCHCTL="${PLEXUS_LAUNCHCTL:-launchctl}"
RELEASE_BASE="${PLEXUS_HELPER_RELEASE_BASE:-https://github.com/Svyk/plexus-diagram/releases/download}"
SKIP_WAIT="${PLEXUS_HELPER_SKIP_WAIT:-0}"
OS_NAME="${PLEXUS_HELPER_OS:-$(uname -s)}"
REPLACE=0

say() { printf '%s\n' "$*"; }
fail() { printf 'Plexus helper install failed: %s\n' "$*" >&2; exit 1; }

port_open() {
  curl -s -o /dev/null --max-time 2 "$URL/v1/health"
}

plist_is_ours() {
  if [ ! -f "$PLIST" ]; then
    return 1
  fi
  grep -q "plexus-parse-helper-rs" "$PLIST"
}

bootout_agent() {
  uid=$(id -u)
  "$LAUNCHCTL" bootout "gui/${uid}/${LABEL}" >/dev/null 2>&1 || true
}

clear_quarantine() {
  if command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$1" 2>/dev/null || true
  fi
}

wait_for_health() {
  if [ "$SKIP_WAIT" = 1 ]; then
    return 0
  fi
  tries=0
  until curl -s -o /dev/null --max-time 2 "$URL/v1/health"; do
    tries=$((tries + 1))
    [ "$tries" -lt 30 ] || fail "the helper did not start. See ${LOG}"
    sleep 1
  done
}

# Today's Python helper. Also the path on Linux and Windows.
install_docling() {
  PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  export PATH

  if ! command -v uv >/dev/null 2>&1; then
    say "Installing uv (Python tool installer)..."
    command -v curl >/dev/null 2>&1 || fail "curl is required"
    curl -LsSf https://astral.sh/uv/install.sh | sh || fail "could not install uv"
    command -v uv >/dev/null 2>&1 || fail "uv is installed but not on PATH. Open a new terminal and run this again."
  fi

  say "Installing the Docling helper (first time takes a few minutes)..."
  if [ "$VLM" = 1 ]; then
    say "High accuracy also installs mlx-vlm and onnxruntime."
    say "The first read downloads PaddleOCR-VL-0.9B (about 1.9 GB), Qwen3-VL-8B-Instruct-4bit for page text (about 5.8 GB), and PP-DocLayoutV2 (about 204 MB) and checks each file's SHA-256. Nothing is fetched at install. All three are Apache-2.0."
    uv tool install --force --with mlx-vlm --with onnxruntime "$SPEC" || fail "uv tool install failed"
  else
    uv tool install --force "$SPEC" || fail "uv tool install failed"
  fi
  command -v "$HELPER" >/dev/null 2>&1 || fail "$HELPER is not on PATH after install. Run: uv tool update-shell"

  say "Starting it at login..."
  "$HELPER" install-agent || fail "install-agent failed"

  say "Waiting for the helper..."
  wait_for_health
  "$HELPER" pair
}

arch_name() {
  if [ -n "${PLEXUS_HELPER_ARCH:-}" ]; then
    printf '%s\n' "$PLEXUS_HELPER_ARCH"
    return 0
  fi
  machine=$(uname -m)
  case "$machine" in
    arm64|aarch64) printf '%s\n' arm64 ;;
    x86_64|amd64) printf '%s\n' x86_64 ;;
    *) fail "unsupported architecture: ${machine}" ;;
  esac
}

# First helper-rs-v* tag in the releases payload (GitHub lists newest first).
first_helper_tag() {
  awk '
    {
      s = $0
      while (match(s, /"tag_name"/)) {
        rest = substr(s, RSTART + RLENGTH)
        if (match(rest, /^[[:space:]]*:[[:space:]]*"helper-rs-v[^"]*"/)) {
          val = substr(rest, RSTART, RLENGTH)
          sub(/^[^"]*"/, "", val)
          sub(/"$/, "", val)
          print val
          exit
        }
        s = substr(s, RSTART + RLENGTH)
      }
    }
  '
}

resolve_tag() {
  if [ -n "${PLEXUS_HELPER_TAG:-}" ]; then
    printf '%s\n' "$PLEXUS_HELPER_TAG"
    return 0
  fi
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  json=$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/Svyk/plexus-diagram/releases?per_page=30") || fail "could not list GitHub releases"
  tag=$(printf '%s\n' "$json" | first_helper_tag)
  [ -n "$tag" ] || fail "no helper-rs-v* release on github.com/Svyk/plexus-diagram. Set PLEXUS_HELPER_TAG."
  printf '%s\n' "$tag"
}

verify_sha() {
  file=$1
  sums=$2
  name=$(basename "$file")
  want=$(awk -v name="$name" '$2 == name || $2 == ("*" name) { print $1; exit }' "$sums")
  [ -n "$want" ] || fail "SHA256SUMS has no entry for ${name}"
  got=$(shasum -a 256 "$file" | awk '{ print $1 }')
  [ "$got" = "$want" ] || fail "SHA256 mismatch for ${name}"
}

write_plist() {
  bin=$1
  pdfium=$2
  mkdir -p "$AGENTS"
  mkdir -p "$(dirname "$LOG")"
  path_value="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>serve</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>${PORT}</string>
    <string>--pdfium</string>
    <string>${pdfium}</string>
    <string>--token-file</string>
    <string>${PREFIX}/token</string>
    <string>--pair-file</string>
    <string>${PREFIX}/pair-until</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path_value}</string>
  </dict>
</dict>
</plist>
EOF
}

start_agent() {
  uid=$(id -u)
  # Bootout is by label, so it stops whatever is logged in under com.plexus.parse-helper,
  # including a helper on another port. Only a reinstall of this binary, or --replace, may do that.
  if [ "$REPLACING" = 1 ]; then
    bootout_agent
  fi
  if ! "$LAUNCHCTL" bootstrap "gui/${uid}" "$PLIST"; then
    if [ "$REPLACING" = 1 ]; then
      "$LAUNCHCTL" kickstart -k "gui/${uid}/${LABEL}" || fail "could not start ${LABEL}. See ${LOG}"
    else
      fail "LaunchAgent ${LABEL} is already loaded. Nothing was stopped. Re-run with --replace to switch the login helper. To try a copy without touching it, set PLEXUS_LAUNCHCTL to a stub and PLEXUS_LAUNCH_AGENTS_DIR to a temporary directory."
    fi
  fi
}

refuse_taken() {
  fail "port ${PORT} is already in use. The program listening there was left running. To switch to the light helper, re-run with --replace: curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --replace. To keep it and add Docling: curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --docling"
}

install_rust() {
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
  command -v shasum >/dev/null 2>&1 || fail "shasum is required"
  REPLACING=0
  if plist_is_ours || [ "$REPLACE" = 1 ]; then
    REPLACING=1
  fi
  if port_open; then
    if [ "$REPLACING" = 1 ]; then
      say "Replacing the helper on ${URL}..."
      bootout_agent
    else
      refuse_taken
    fi
  fi
  arch=$(arch_name) || fail "could not choose an architecture"
  asset="plexus-parse-helper-rs-macos-${arch}.tar.gz"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  if [ -n "${PLEXUS_HELPER_RELEASE_DIR:-}" ]; then
    [ -f "${PLEXUS_HELPER_RELEASE_DIR}/${asset}" ] || fail "missing ${asset} in PLEXUS_HELPER_RELEASE_DIR"
    [ -f "${PLEXUS_HELPER_RELEASE_DIR}/SHA256SUMS" ] || fail "missing SHA256SUMS in PLEXUS_HELPER_RELEASE_DIR"
    cp "${PLEXUS_HELPER_RELEASE_DIR}/${asset}" "${work}/${asset}"
    cp "${PLEXUS_HELPER_RELEASE_DIR}/SHA256SUMS" "${work}/SHA256SUMS"
  else
    tag=$(resolve_tag) || fail "could not choose a release"
    say "Downloading ${asset} from ${tag}..."
    curl -fL --retry 3 -o "${work}/${asset}" "${RELEASE_BASE}/${tag}/${asset}" || fail "could not download ${asset}"
    curl -fL --retry 3 -o "${work}/SHA256SUMS" "${RELEASE_BASE}/${tag}/SHA256SUMS" || fail "could not download SHA256SUMS"
  fi
  verify_sha "${work}/${asset}" "${work}/SHA256SUMS"
  stage="${work}/stage"
  mkdir -p "$stage"
  tar -xzf "${work}/${asset}" -C "$stage"
  [ -f "${stage}/plexus-parse-helper-rs" ] || fail "archive has no plexus-parse-helper-rs"
  [ -f "${stage}/libpdfium.dylib" ] || fail "archive has no libpdfium.dylib"
  mkdir -p "$BIN_DIR"
  cp "${stage}/plexus-parse-helper-rs" "${BIN_DIR}/plexus-parse-helper-rs"
  cp "${stage}/libpdfium.dylib" "${BIN_DIR}/libpdfium.dylib"
  chmod 755 "${BIN_DIR}/plexus-parse-helper-rs"
  clear_quarantine "${BIN_DIR}/plexus-parse-helper-rs"
  clear_quarantine "${BIN_DIR}/libpdfium.dylib"
  write_plist "${BIN_DIR}/plexus-parse-helper-rs" "${BIN_DIR}/libpdfium.dylib"
  say "Starting it at login..."
  start_agent
  say "Waiting for the helper..."
  wait_for_health
  "${BIN_DIR}/plexus-parse-helper-rs" pair --token-file "${PREFIX}/token" --pair-file "${PREFIX}/pair-until"
}

uninstall_helper() {
  say "Removing the local helper..."
  # A temporary agents directory is a side-by-side check. Bootout would stop the
  # logged-in helper even when its plist lives somewhere else, and uv would
  # remove the Python tool from the real home.
  if [ "$AGENTS" = "$HOME/Library/LaunchAgents" ]; then
    bootout_agent
    if command -v uv >/dev/null 2>&1; then
      uv tool uninstall plexus-parse-helper >/dev/null 2>&1 || true
    fi
  else
    say "The login helper was left running. Removed only the plist under ${AGENTS}."
  fi
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST"
  fi
  if [ -d "$BIN_DIR" ]; then
    rm -f "${BIN_DIR}/plexus-parse-helper-rs" "${BIN_DIR}/libpdfium.dylib"
    rmdir "$BIN_DIR" 2>/dev/null || true
  fi
  say "Removed. The token file, if you had one, was left in place."
}

MODE=rust
VLM=0
for arg in "$@"; do
  case "$arg" in
    --docling) MODE=docling ;;
    --vlm) VLM=1; MODE=docling ;;
    --uninstall) MODE=uninstall ;;
    --replace) REPLACE=1 ;;
    --help|-h)
      say "usage: install.sh [--docling] [--vlm] [--replace] [--uninstall]"
      exit 0
      ;;
    *) fail "unknown option: ${arg}" ;;
  esac
done

if [ "$MODE" = uninstall ]; then
  uninstall_helper
  exit 0
fi

if [ "$OS_NAME" != Darwin ] || [ "$MODE" = docling ]; then
  install_docling
  exit 0
fi

install_rust
