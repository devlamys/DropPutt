#!/usr/bin/env bash
# Puts the DropPutt launcher icon and splash screen into an Android project.
#   ./brand-android.sh customer|vendor|rider
# Re-run after `cap add android` or when public/icon-*.png change. Needs ImageMagick (`convert`).
set -euo pipefail
app="$1"
res="$(dirname "$0")/$app/android/app/src/main/res"
pub="$(dirname "$0")/../frontend/public"
red="#E8431A"

declare -A legacy=([mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192)
declare -A fore=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)
for d in "${!legacy[@]}"; do
  s=${legacy[$d]}; f=${fore[$d]}
  convert "$pub/icon-512.png" -resize ${s}x${s} "$res/mipmap-$d/ic_launcher.png"
  convert "$pub/icon-512.png" -resize ${s}x${s} \( -size ${s}x${s} xc:none -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) -compose DstIn -composite "$res/mipmap-$d/ic_launcher_round.png"
  convert "$pub/icon-maskable-512.png" -resize ${f}x${f} "$res/mipmap-$d/ic_launcher_foreground.png"
done
printf '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' "$red" > "$res/values/ic_launcher_background.xml"

# Splash: the logo on the brand colour, at the size of each existing splash image.
for f in "$res"/drawable*/splash.png; do
  size=$(identify -format '%wx%h' "$f")
  w=${size%x*}; h=${size#*x}
  m=$(( (w < h ? w : h) * 30 / 100 ))
  convert -size ${size} xc:"$red" \( "$pub/icon-512.png" -resize ${m}x${m} \) -gravity center -composite "$f"
done
echo "branded $app"
