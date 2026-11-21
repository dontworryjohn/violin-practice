# 🎻 Violin Practice Pal

A simple, kid-friendly practice app for beginner violinists. Tunes are written as **big note letters with the string and finger number underneath**, so you don't need to read standard notation yet.

It is plain HTML, CSS and JavaScript: no build step and nothing to install. It works well on a tablet on a music stand.

## What's inside

| Section | What it does |
| --- | --- |
| 🎵 **Songs** | 10 traditional beginner tunes in first position (D and A major). Each note shows the note name (e.g. **F♯**) with the string and finger underneath (e.g. **E1**), colour-coded by string. Tap any note to hear it. |
| 🎼 **Sheet music** | Switch any song between **🔤 Letters** and **🎼 Sheet music** (a treble-clef staff in the song's key). Choose how to follow the music: a **🟨 yellow band** that jumps to each note (the default, like the letters view), or a **🪄 conductor's baton** that taps each note as it starts and rests on long notes. Finger numbers (e.g. **E1**) can be shown under the notes in the string colours, or hidden. The choice is remembered on each device. |
| ▶ **Playback** | Plays the tune with recordings of a real violin (Web Audio API) and highlights the current note. Includes play/pause/stop, 🐢 slow practice (60% speed), a count-in and 🔁 looping a range of bars. |
| 🥁 **Metronome** | 40–160 BPM with a slider and +/− buttons (hold to change quickly), 2, 3 or 4 beats in a bar, a louder first beat, flashing beat lights and tap tempo. |
| ⭐ **My Practice** | Start/stop practice timer (also in the top bar), daily goal (15 minutes by default), a calendar of practice days, a streak counter, the songs practised each day, and badges. |
| 📥 **Upload sheet music** | In ✏️ Add Song: upload a **MusicXML** (`.musicxml`, `.mxl`) or **ABC** (`.abc`) file and it is turned into string + finger notes automatically, ready to check, listen to and save. Upload a **PDF or photo** and it is kept on the device and shown under *My sheet music* in Songs, with zoom and a metronome (no playback: the app can't read notes from a picture). |
| ✏️ **Add Song** | A form for parents to type new tunes in the same format, with a live preview and a Listen button. |

String colours: **G** purple · **D** blue · **A** green · **E** orange.

Badges: 🎻 First Practice · 🎯 Goal Getter · 🔥 3-Day Streak · 🌟 7-Day Streak · 🏆 First Song Mastered · 📚 Song Collector (5 songs) · 🦸 Practice Hero (30-day streak).

All progress is saved in the browser's `localStorage` on that device. Clearing the browser's site data resets it.

## How notes are written

Each note is a **string letter + finger number**:

```
A0 A0 E0 E0 | E1 E1 E0:2 | A3 A3 A2 A2 | A1 A1 A0:2
```

| You type | Meaning |
| --- | --- |
| `A0` | Open A string (finger 0) |
| `E1` | First finger on the E string |
| `D3:2` | Hold for 2 beats (`:3`, `:4` also work) |
| `A1:0.5` | A quick note, half a beat (`:1/2` also works) |
| `A0:1.5` | A dotted note, one and a half beats |
| `R` or `R:2` | A rest |
| `\|` | A bar line (optional: leave them out and bars are added for you) |
| `E2L` / `E2H` | Force a low or high finger (here G or G♯) |

**Finger 2 is chosen automatically from the key.** In D major, `E2` is G (low 2). In A major, `E2` is G♯ (high 2). Supported keys: D, A, G and C major.

## Adding songs

### Option 1: upload the sheet music (no typing)

1. Open **✏️ Add Song** and press **Choose a file** (or drop a file on it).
2. **MusicXML / ABC:** the notes, key, time and speed are filled in for you. Check the preview, press **▶ Listen**, then **💾 Save song**.
   Most notation apps and sites can export MusicXML (MuseScore, Flat.io, Noteflight, Sibelius, Finale, Dorico: look for *Export → MusicXML*).
3. **PDF / photo:** it is saved on this device and appears in **🎵 Songs** under **My sheet music**.

How notes are converted: every note goes in first position, on the open string where it is one, otherwise on the
highest string that reaches it (low/high fingers are marked with `L`/`H` when the key's usual finger would be wrong).
Notes below G3 or above B5 move by an octave. Only the top note of a chord and the first voice of the violin part
(or the first part) are kept. Repeat signs aren't followed: use 🔁 Loop. Keys other than C, G, D and A major are
shown in the nearest of those, with the right pitches. The upload panel lists anything that was changed.

### Option 2: type it in the app

1. Open **✏️ Add Song**.
2. Type a name and the notes. The preview shows any mistakes straight away.
3. Press **▶ Listen** to check it, then **💾 Save song**.

Songs saved this way are stored on that device only.

### Option 3: in `songs.json` (permanent, shows on every device)

Add an entry to the `songs` list in [`songs.json`](songs.json):

```json
{
  "id": "happy-birthday",
  "title": "Happy Birthday",
  "emoji": "🎂",
  "key": "D",
  "beatsPerBar": 3,
  "tempo": 90,
  "level": 2,
  "notes": "A0:0.5 A0:0.5 | A1 A0 A3 | A2:2 A0:0.5 A0:0.5 | A1 A0 E0 | A3:2"
}
```

| Field | Meaning |
| --- | --- |
| `id` | A unique short name (letters, numbers, dashes) |
| `title` | The song name shown in the app |
| `emoji` | Optional picture for the song card |
| `key` | `D`, `A`, `G` or `C` |
| `beatsPerBar` | 2, 3 or 4 |
| `tempo` | Normal speed in beats per minute |
| `level` | 1–3 difficulty dots |
| `notes` | The tune, in the format above |

Tip: after saving a song in the app, press **📋 Copy JSON** next to it under *My songs* and paste the result into `songs.json`.

Commas between entries matter in JSON. If the song list stops loading, check for a missing or extra comma.

## Deploying with GitHub Pages

1. Push this repository to GitHub (the files must be at the root of the branch: `index.html`, `songs.json`, `css/`, `js/`).
2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose your branch (e.g. `main`) and the **/ (root)** folder, then press **Save**.
5. After a minute or two the site is live at `https://<your-username>.github.io/<repository-name>/`.

The empty `.nojekyll` file tells GitHub Pages to serve the files exactly as they are.

**On a tablet:** open the site in Safari or Chrome and choose **Add to Home Screen**, so it opens like an app. While the practice timer runs, the app asks the device to keep the screen awake (on browsers that support it).

## Running it on your own computer

Browsers block `songs.json` when `index.html` is opened directly from disk, so use a tiny local web server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Project layout

```
index.html        the page
css/style.css     all styles
js/app.js         screens and buttons
js/notation.js    reads the letter/finger format and works out the pitches
js/audio.js       violin sound, song player and metronome (Web Audio API)
sounds/violin/    one recorded violin note per semitone, G3 to C6 (see CREDITS.md)
js/tracker.js     practice timer, streaks, calendar data and badges
js/sheet.js       turns a tune into sheet music and moves the highlight along it
js/import.js      reads uploaded MusicXML / MXL / ABC files into the letter/finger format
js/pictures.js    stores uploaded PDFs and photos (IndexedDB) and shows them
vendor/abcjs/     abcjs library that draws the sheet music (MIT licence)
vendor/pdfjs/     pdf.js library that shows uploaded PDFs (Apache 2.0 licence)
songs.json        the built-in song library
```

All the built-in tunes are traditional and in the public domain.

## Credits

The violin sound uses recordings from the **Fluid R3 GM** SoundFont by Frank Wen, via
[midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). See [`sounds/violin/CREDITS.md`](sounds/violin/CREDITS.md).

Sheet music is drawn with [abcjs](https://github.com/paulrosen/abcjs) 6.4.4 by Paul Rosen and Gregory Dyke,
included in `vendor/abcjs/` under the MIT licence (see [`vendor/abcjs/LICENSE.md`](vendor/abcjs/LICENSE.md)).

Uploaded PDFs are shown with [pdf.js](https://github.com/mozilla/pdf.js) 4.10.38 (legacy build) by Mozilla,
included in `vendor/pdfjs/` under the Apache 2.0 licence (see [`vendor/pdfjs/LICENSE`](vendor/pdfjs/LICENSE)).

## Making changes (for developers)

Work on a branch and open a pull request into `main`. Every pull request description should say
**what changed** and **how to test it**:

- `.github/pull_request_template.md` fills in those sections automatically on GitHub.
- This project's run and test steps are in [`CLAUDE.md`](CLAUDE.md).
