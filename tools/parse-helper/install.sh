#!/bin/sh
# Plexus Diagram local helper: one-command install on macOS.
#   curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh
# Safe to run again: it reinstalls the tool, rewrites the LaunchAgent, and reopens pairing.
# Environment overrides (for testing): PLEXUS_HELPER_SPEC, PLEXUS_HELPER_URL.
set -eu

SPEC="${PLEXUS_HELPER_SPEC:-git+https://github.com/Svyk/plexus-diagram#subdirectory=tools/parse-helper}"
URL="${PLEXUS_HELPER_URL:-http://127.0.0.1:48765}"
HELPER=plexus-parse-helper

say() { printf '%s\n' "$*"; }
fail() { printf 'Plexus helper install failed: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. On another system run: uv tool install \"$SPEC\" && $HELPER serve"

PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export PATH

if ! command -v uv >/dev/null 2>&1; then
  say "Installing uv (Python tool installer)..."
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  curl -LsSf https://astral.sh/uv/install.sh | sh || fail "could not install uv"
  command -v uv >/dev/null 2>&1 || fail "uv is installed but not on PATH. Open a new terminal and run this again."
fi

say "Installing the helper (first time takes a few minutes)..."
uv tool install --force "$SPEC" || fail "uv tool install failed"
command -v "$HELPER" >/dev/null 2>&1 || fail "$HELPER is not on PATH after install. Run: uv tool update-shell"

say "Starting it at login..."
"$HELPER" install-agent || fail "install-agent failed"

say "Waiting for the helper..."
tries=0
until curl -s -o /dev/null --max-time 2 "$URL/v1/health"; do
  tries=$((tries + 1))
  [ "$tries" -lt 30 ] || fail "the helper did not start. See ~/Library/Logs/plexus-parse-helper.log"
  sleep 1
done

"$HELPER" pair
say "Back to Roam: click Pair."
