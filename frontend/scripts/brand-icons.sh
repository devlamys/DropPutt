#!/usr/bin/env bash
# Builds the PNG app icons from public/favicon.svg (the single source of the DropPutt mark).
#   scripts/brand-icons.sh
# icon-192 / icon-512: the rounded tile (home screen "any" icons, apple-touch-icon).
# icon-maskable-512: the same art as a full square; the mark sits inside the 80% safe zone,
# so Android can crop it to a circle or squircle. Needs ImageMagick (`convert`).
set -euo pipefail
cd "$(dirname "$0")/../public"
tmp="$(mktemp --suffix=.svg)"
trap 'rm -f "$tmp"' EXIT
sed 's/ rx="15"//' favicon.svg > "$tmp"
for size in 192 512; do
  convert -background none -density 1536 favicon.svg -resize "${size}x${size}" "icon-${size}.png"
done
convert -background none -density 1536 "$tmp" -resize 512x512 icon-maskable-512.png
echo "icons rebuilt from favicon.svg"
