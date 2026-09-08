#!/usr/bin/env bash
# Assemble the deployable site.
#
# `wrangler pages deploy .` uploads the whole repository, which published the
# iOS app's Swift sources, every Python script under scripts/, the test files,
# server.js, wrangler.toml and package.json — all fetchable over HTTPS. Pages
# does not honour .assetsignore (verified against a real deployment), so the
# only reliable way to stop shipping them is to deploy a directory that never
# contained them.
#
# The manifest is explicit rather than an exclude list: a new file has to be
# named here to be published, so the default for anything added to the repo is
# "not on the website".
set -euo pipefail
cd "$(dirname "$0")/.."

DIST=dist
FILES=(
  index.html
  style.css
  _routes.json
  favicon.ico
  favicon.svg
  favicon-32.png
  favicon-192.png
  favicon-512.png
  apple-touch-icon.png
  og-image.png
)

rm -rf "$DIST"
mkdir -p "$DIST"
for f in "${FILES[@]}"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
  cp "$f" "$DIST/$f"
done
cp -R functions "$DIST/functions"

echo "$DIST: $(find "$DIST" -type f | wc -l | tr -d ' ') files, $(du -sh "$DIST" | cut -f1)"
