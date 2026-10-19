#!/bin/sh
# Bundles src/*.js into a single classic script (no modules → works from any static host).
cd "$(dirname "$0")"
{
  echo "/* Candy Merge 2048 — © KOGAMES. Built $(date -u +%Y-%m-%dT%H:%MZ). Source: src/ */"
  echo "(function(){'use strict';"
  for f in physics.js i18n.js save.js audio.js main.js; do
    echo "// ===== $f ====="
    sed -E 's/^export (default )?//' "src/$f"
  done
  echo "})();"
} > game.js
echo "built game.js ($(wc -c < game.js) bytes)"
