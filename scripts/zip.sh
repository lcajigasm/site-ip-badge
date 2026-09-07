#!/usr/bin/env bash
# Builds dist/site-ip-badge-<version>.zip from src/ (manifest.json at the zip root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
DIST="$ROOT/dist"
VERSION="$(jq -r .version "$SRC/manifest.json")"
OUT="$DIST/site-ip-badge-$VERSION.zip"

mkdir -p "$DIST"
rm -f "$OUT"
( cd "$SRC" && zip -r -X "$OUT" . -x '.*' -x '*/.*' -x '__MACOSX/*' -x '*.map' )

echo "Built $OUT"
unzip -l "$OUT" | tail -n +2
