#!/usr/bin/env bash
# Step 4 of the sheet-reading tests (see README.md): scan-like pictures made from some of the PDFs,
# a tilted, noisy "photo", and a page with no music. Needs poppler-utils (pdftoppm) and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/out"
for f in dscale.verovio twinkle.verovio jingle-bells.abcjs ode-to-joy.verovio lightly-row.abcjs; do
  pdftoppm -r 150 -png -singlefile "$f.pdf" "scan_$f"
done
convert scan_lightly-row.abcjs.png -rotate 0.6 -attenuate 0.4 +noise Gaussian -blur 0x0.6 -quality 80 photo_lightly-row.abcjs.jpg
convert -size 1200x900 xc:white -fill black -pointsize 40 -annotate +100+200 'Shopping list: milk, eggs, bread' \
  -annotate +100+300 'Call the teacher on Tuesday' not_music.png
echo "made: $(ls scan_* photo_* not_music.png | tr '\n' ' ')"
