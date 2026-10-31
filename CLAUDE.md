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
- Saved data lives in `localStorage` under `violinPractice.progress.v1` (practice) and
  `violinPractice.customSongs.v1` (custom songs). If a change alters their shape, old saved data
  must still load. To reset while testing: F12 → Application → Local storage → Clear.

## Conventions
- Songs use the letter/finger format documented in the README (`A0 E1:2 | ...`), in first position.
- Third-party assets need a licence that allows reuse, and a credit (see `sounds/violin/CREDITS.md`).
- Pull request descriptions follow `.github/pull_request_template.md` (the `pr-description` skill fills it in).
