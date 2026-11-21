# Violin Practice Pal: project notes

Plain HTML/CSS/JavaScript (ES modules) with no build step. Hosted on GitHub Pages from `main` (root folder).

## Run it
```bash
python3 -m http.server 8000
```
Open http://localhost:8000. Opening `index.html` directly from disk won't load `songs.json` or the sounds.

## Testing changes
- No test framework or CI yet. Test in a real browser (Playwright + Chromium) against the local server,
  and check the console has no errors.
- Check every song in `songs.json` still parses: import `parseTune` from `js/notation.js`, then run it
  on each song's `notes` (with the song's `key` and `beatsPerBar`). Expect no `errors`, and every bar
  except the first and last should have `beatsPerBar` beats.
- Check layouts at tablet portrait 768×1024, tablet landscape 1180×820 and phone 390×844, with no
  horizontal scrolling. The main use is a tablet on a music stand, read from about 1 metre away.
- Audio: headless tests can confirm notes are scheduled and recordings load, not how they sound.
  List "how it sounds" under *Not tested automatically*.
- Songs show in two views, letters (`#notation`) and sheet music (`#sheet`, drawn by `js/sheet.js`
  with abcjs). Sheet music follows the music with a band (default) or a conductor's baton.
  A change to playback, highlighting or looping must be tested in both views and both styles. Every
  note in `songs.json` must appear on the staff: `renderSheet(...).count` equals the number of parsed notes.
- Saved data lives in `localStorage` under `violinPractice.progress.v1` (practice),
  `violinPractice.customSongs.v1` (custom songs) and `violinPractice.view.v1` (letters/sheet, finger numbers, band/baton).
  Uploaded PDFs and photos live in IndexedDB, database `violinPractice.sheets`, store `sheets`. If a change alters their shape, old saved data
  must still load. To reset while testing: F12 → Application → Local storage → Clear.

- Uploads (`js/import.js`): test with a MusicXML file, an `.mxl` (zipped) copy, an ABC file, a PDF and a photo.
  An imported score must fill the Add Song form with no `errors`, and play in both views.
- Reading PDFs and photos (`js/omr.js`): run the tests in `tests/omr/` (steps in its README) before and after
  a change, and compare the ✓ count. Don't commit other people's sheet music as test files.

## Conventions
- Songs use the letter/finger format documented in the README (`A0 E1:2 | ...`), in first position.
- Third-party assets need a licence that allows reuse, and a credit (see `sounds/violin/CREDITS.md`).
- Pull request descriptions follow `.github/pull_request_template.md`: what changed, how to test it, and what was tested.
