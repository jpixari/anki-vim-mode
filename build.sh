#!/bin/sh
# Builds the installable add-on package: <name>.ankiaddon in the repo root.
# Usage: ./build.sh [output-name]   (default: anki_vim_mode.ankiaddon)
set -eu

cd "$(dirname "$0")"

out="${1:-anki_vim_mode.ankiaddon}"

rm -f "$out"
# An .ankiaddon is a zip with the add-on's files at its top level.
zip -q -X "$out" \
    __init__.py \
    vim_core.py \
    vim_text.js \
    editor_vim.js \
    editor_vim.css \
    config.json \
    config.md \
    manifest.json

echo "built $out"
