# Sheet-reading tests

Checks `js/omr.js`, which reads notes from PDFs and photos of sheet music. It makes sheet music
whose notes are known (the songs in `songs.json` and a D major scale), draws it in two engraving
styles, turns some pages into scan-like and photo-like pictures, then reads them all and compares.

Generated files go in `tests/omr/out/` (not committed).

## Needs
- The app served from the repository root: `python3 -m http.server 8000`
- Playwright with Chromium (Node), Verovio (`pip install verovio`), `pdftoppm` (poppler-utils) and
  ImageMagick (`convert`).

## Run
From the repository root, with the server running:

```bash
node tests/omr/make_fixtures.cjs
```
```bash
python3 tests/omr/make_verovio.py
```
```bash
node tests/omr/svg2pdf.cjs
```
```bash
tests/omr/make_scans.sh
```
```bash
node tests/omr/bench.cjs
```

If `require('playwright')` isn't found, prefix the node commands with `NODE_PATH=$(npm root -g)`.

Each line shows ✓ when every note, length and bar line matches, or ✗ with the differences
(`#12 missing 69:2` = the 12th note, MIDI 69 for 2 beats, was not found). A page with no music
must be refused with a message.

To test a real sheet, put `name.pdf` (or `.png`/`.jpg`) in `out/` together with a
`name.truth.json` (same shape as the generated ones), then run `node tests/omr/bench.cjs name`.
