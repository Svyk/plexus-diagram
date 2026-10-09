#!/bin/sh
# Download the macOS arm64 Pdfium shared library used at runtime. Not committed.
# Pdfium itself is BSD-licensed; the binary is about 7 MB (chromium/8086).
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
mkdir -p "$root/vendor"
url="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8086/pdfium-mac-arm64.tgz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fL --retry 3 -o "$tmp/pdfium.tgz" "$url"
tar -xzf "$tmp/pdfium.tgz" -C "$tmp" lib/libpdfium.dylib
mv "$tmp/lib/libpdfium.dylib" "$root/vendor/libpdfium.dylib"
ls -lh "$root/vendor/libpdfium.dylib"
