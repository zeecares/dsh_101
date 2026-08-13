#!/bin/sh
# Regenerate ../docs/index.html (the GitHub Pages site) from ../tutorial.md.
# Requires pandoc. Run from this directory: ./build.sh
set -e
cd "$(dirname "$0")"
pandoc ../tutorial.md \
  --standalone \
  --template=template.html \
  --toc --toc-depth=2 \
  --metadata title="From Claude Code to DeepSeek Harness" \
  -o ../docs/index.html
echo "wrote ../docs/index.html"
