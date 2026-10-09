#!/bin/sh
# Download the macOS Pdfium shared library used at runtime. Not committed.
# Pdfium itself is BSD-licensed; the binary is about 7 MB (chromium/8086).
# Usage: ./fetch-pdfium.sh [arm64|x64]
# With no argument, the machine's architecture is used (arm64 or x86_64 → x64).
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
arch=${1:-}
if [ -z "$arch" ]; then
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *)
      printf 'unsupported architecture: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac
fi
case "$arch" in
  arm64|aarch64) asset=pdfium-mac-arm64.tgz ;;
  x64|x86_64|amd64) asset=pdfium-mac-x64.tgz ;;
  *)
    printf 'unsupported pdfium arch: %s\n' "$arch" >&2
    exit 1
    ;;
esac
mkdir -p "$root/vendor"
url="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8086/${asset}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fL --retry 3 -o "$tmp/pdfium.tgz" "$url"
tar -xzf "$tmp/pdfium.tgz" -C "$tmp" lib/libpdfium.dylib
mv "$tmp/lib/libpdfium.dylib" "$root/vendor/libpdfium.dylib"
ls -lh "$root/vendor/libpdfium.dylib"
