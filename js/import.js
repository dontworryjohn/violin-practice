// Turns uploaded sheet music into the app's letter/finger format ("D0 D1 D2:2 | ...").
//
// Supported files
//   MusicXML  .musicxml / .xml   (exported by MuseScore, Flat.io, Noteflight, Sibelius, Finale, Dorico...)
//   MXL       .mxl               (compressed MusicXML, the default export of many apps)
//   ABC       .abc               (read with abcjs, which the app already uses to draw sheet music)
//
// Every note is placed in first position on the violin: the open string if the note is one,
// otherwise the highest string it can be reached on. Pitches stay exactly as written: when the
// key's usual finger would give a different note, a low/high marker (L/H) is added.

import { STRING_MIDI, pitchFor } from './notation.js';

// "D_Major_Scale_20260925_094242.pdf" -> "D Major Scale"
export function titleFromFileName(name) {
  const t = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+(?:\d{8}|\d{4} \d{2} \d{2})(?:\s*\d{6})?$/, '')
    .trim()
    .slice(0, 60);
  return t || 'My sheet music';
}

export const SCORE_EXTENSIONS = ['musicxml', 'xml', 'mxl', 'abc'];
export const PICTURE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'];

const LOWEST = STRING_MIDI.G; // G3, open G string
const HIGHEST = STRING_MIDI.E + 7; // B5, 4th finger on the E string
const STEP_SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const KEY_BY_FIFTHS = { 0: 'C', 1: 'G', 2: 'D', 3: 'A' };
const KEY_NAMES = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];

export function fileKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (SCORE_EXTENSIONS.includes(ext)) return 'score';
  if (PICTURE_EXTENSIONS.includes(ext)) return 'picture';
  return null;
}

/* ---------------- Notes to string + finger ---------------- */

// String and finger for a pitch in first position, e.g. 66 (F♯4) in D major -> "D2".
export function fingering(midi, key) {
  const order = ['E', 'A', 'D', 'G'];
  let string = order.find((s) => midi >= STRING_MIDI[s] && midi - STRING_MIDI[s] <= (s === 'E' ? 7 : 6)) || 'G';
  const offset = midi - STRING_MIDI[string];
  const finger = offset === 0 ? 0 : offset === 7 ? 4 : Math.ceil(offset / 2);
  let mod = '';
  if (pitchFor(string, finger, key).midi !== midi) mod = offset % 2 ? 'L' : 'H';
  return `${string}${finger}${mod}`;
}

// Beat count as the notes format writes it: 1, 0.5, 1.5, 2/3...
function beatText(beats) {
  for (const den of [1, 2, 4, 8, 16, 3, 6, 12, 24, 5, 7]) {
    const num = beats * den;
    if (Math.abs(num - Math.round(num)) < 1e-4) {
      if ([1, 2, 4, 8, 16].includes(den)) return String(+(Math.round(num) / den).toFixed(4));
      return `${Math.round(num)}/${den}`;
    }
  }
  return String(+beats.toFixed(3));
}

function closestKey(fifths) {
  return KEY_BY_FIFTHS[Math.max(0, Math.min(3, fifths))];
}

// bars: [[{ midi | null (rest), beats }]] -> song fields and a list of things worth knowing.
function buildSong({ title, fifths = 0, beatsPerBar = 4, tempo, bars, notes: extra = [] }) {
  const warnings = [...extra];
  const key = closestKey(fifths);
  if (KEY_BY_FIFTHS[fifths] === undefined) {
    warnings.push(`The music is in ${KEY_NAMES[fifths + 7] || 'a key'} major, which the key list doesn't have. It is shown in ${key} major, and every note still plays at the right pitch.`);
  }
  let bpb = beatsPerBar;
  if (![2, 3, 4].includes(bpb)) {
    const near = [2, 3, 4].reduce((a, b) => (Math.abs(b - bpb) < Math.abs(a - bpb) ? b : a));
    warnings.push(`The time signature has ${+bpb.toFixed(2)} beats in a bar; the app counts ${near}. The bars are kept as written.`);
    bpb = near;
  }
  let shiftedUp = 0;
  let shiftedDown = 0;
  const text = bars
    .filter((bar) => bar.length)
    .map((bar) =>
      bar
        .map((n) => {
          const len = n.beats === 1 ? '' : `:${beatText(n.beats)}`;
          if (n.midi == null) return `R${len}`;
          let m = n.midi;
          while (m < LOWEST) (m += 12), shiftedUp++;
          while (m > HIGHEST) (m -= 12), shiftedDown++;
          return `${fingering(m, key)}${len}`;
        })
        .join(' '),
    )
    .join(' | ');
  if (shiftedUp) warnings.push(`${shiftedUp} note(s) were too low for the violin and were moved up an octave.`);
  if (shiftedDown) warnings.push(`${shiftedDown} note(s) were too high for first position and were moved down an octave.`);
  return {
    song: {
      title: (title || 'My sheet music').trim().slice(0, 60),
      emoji: '🎼',
      key,
      beatsPerBar: bpb,
      tempo: Math.max(40, Math.min(160, Math.round(tempo || 90))),
      notes: text,
    },
    warnings,
  };
}

/* ---------------- MusicXML ---------------- */

const kids = (el, name) => [...(el?.children || [])].filter((c) => c.localName === name);
const kid = (el, name) => kids(el, name)[0];
const txt = (el, name) => kid(el, name)?.textContent.trim();

export function importMusicXml(xmlText, fallbackTitle) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error("This file isn't valid MusicXML.");
  const root = doc.documentElement;
  if (root.localName === 'score-timewise') {
    throw new Error('This MusicXML file uses the "timewise" layout, which isn\'t supported. Export it again as normal (partwise) MusicXML.');
  }
  if (root.localName !== 'score-partwise') throw new Error("This file isn't MusicXML sheet music.");

  const notes = [];
  // Pick the violin part if there is one, otherwise the first part.
  const parts = kids(root, 'part');
  if (!parts.length) throw new Error('No music was found in this file.');
  const names = new Map(
    [...root.getElementsByTagName('score-part')].map((sp) => [sp.getAttribute('id'), txt(sp, 'part-name') || '']),
  );
  const part = parts.find((p) => /violin|vln|vl\./i.test(names.get(p.getAttribute('id')))) || parts[0];
  if (parts.length > 1) {
    notes.push(`This file has ${parts.length} parts. I used "${names.get(part.getAttribute('id')) || 'the first part'}".`);
  }

  const title =
    txt(kid(root, 'work'), 'work-title') ||
    txt(root, 'movement-title') ||
    [...root.getElementsByTagName('credit-words')].map((c) => c.textContent.trim()).find(Boolean) ||
    fallbackTitle;

  let divisions = 1;
  let fifths = null;
  let beatsPerBar = null;
  let tempo = null;
  let voice = null;
  let chords = 0;
  let crossTies = 0;
  let changes = false;
  let repeats = false;
  let otherVoices = false;
  let lastNote = null; // to join tied notes
  const bars = [];

  for (const measure of kids(part, 'measure')) {
    const bar = [];
    for (const el of measure.children) {
      const tag = el.localName;
      if (tag === 'attributes') {
        divisions = Number(txt(el, 'divisions')) || divisions;
        const f = txt(kid(el, 'key'), 'fifths');
        if (f != null) {
          if (fifths !== null && Number(f) !== fifths) changes = true;
          fifths ??= Number(f);
        }
        const time = kid(el, 'time');
        if (time && txt(time, 'beats')) {
          const b = (Number(eval_sum(txt(time, 'beats'))) * 4) / Number(txt(time, 'beat-type'));
          if (beatsPerBar !== null && b !== beatsPerBar) changes = true;
          beatsPerBar ??= b;
        }
      } else if (tag === 'direction' || tag === 'sound') {
        const sound = tag === 'sound' ? el : kid(el, 'sound');
        if (tempo === null && sound?.getAttribute('tempo')) tempo = Number(sound.getAttribute('tempo'));
        const metro = el.getElementsByTagName('metronome')[0];
        if (tempo === null && metro && txt(metro, 'per-minute')) {
          const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[txt(metro, 'beat-unit')] || 1;
          const dotted = kid(metro, 'beat-unit-dot') ? 1.5 : 1;
          tempo = parseFloat(txt(metro, 'per-minute')) * unit * dotted;
        }
      } else if (tag === 'barline') {
        if (kid(el, 'repeat')) repeats = true;
      } else if (tag === 'note') {
        if (kid(el, 'grace') || kid(el, 'cue')) continue;
        const v = txt(el, 'voice') || '1';
        const staff = txt(el, 'staff') || '1';
        if (staff !== '1') continue;
        voice ??= v;
        if (v !== voice) {
          otherVoices = true;
          continue;
        }
        const pitch = kid(el, 'pitch');
        const midi = pitch
          ? (Number(txt(pitch, 'octave')) + 1) * 12 + STEP_SEMIS[txt(pitch, 'step')] + Math.round(Number(txt(pitch, 'alter') || 0))
          : null;
        if (kid(el, 'chord')) {
          // Keep the top note of a chord: that's usually the tune.
          chords++;
          if (midi != null && bar.length && bar[bar.length - 1].midi != null && midi > bar[bar.length - 1].midi) {
            bar[bar.length - 1].midi = midi;
          }
          continue;
        }
        if (!pitch && !kid(el, 'rest')) continue; // unpitched (drum) note
        let beats = Number(txt(el, 'duration')) / divisions;
        if (!(beats > 0)) {
          if (kid(el, 'rest')?.getAttribute('measure') === 'yes') beats = beatsPerBar || 4;
          else continue;
        }
        const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
        if (ties.includes('stop') && lastNote && lastNote.midi === midi) {
          if (bar.includes(lastNote)) {
            lastNote.beats += beats;
            if (!ties.includes('start')) lastNote = null;
            continue;
          }
          crossTies++;
        }
        const n = { midi, beats };
        bar.push(n);
        lastNote = midi != null && ties.includes('start') ? n : null;
      }
    }
    if (!bar.length && beatsPerBar) bar.push({ midi: null, beats: beatsPerBar });
    bars.push(bar);
  }

  if (!bars.some((b) => b.some((n) => n.midi != null))) throw new Error('No notes were found in this file.');
  if (chords) notes.push(`${chords} chord note(s) were left out: only the top note of each chord is kept.`);
  if (otherVoices) notes.push('Some bars have a second line of notes (another voice). Only the first is kept.');
  if (crossTies) notes.push(`${crossTies} note(s) tied over a bar line are shown as two notes.`);
  if (repeats) notes.push('The music has repeat signs. The app plays it once through; use 🔁 Loop to repeat bars.');
  if (changes) notes.push('The key or time signature changes part way through. The first one is used.');

  return buildSong({ title, fifths: fifths ?? 0, beatsPerBar: beatsPerBar ?? 4, tempo, bars, notes });
}

// Time signatures like "3+2" add up.
function eval_sum(s) {
  return String(s)
    .split('+')
    .reduce((a, b) => a + Number(b), 0);
}

/* ---------------- MXL (zipped MusicXML) ---------------- */

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('This .mxl file uses a compression the app can\'t open. Export it as uncompressed MusicXML instead.');
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser can\'t open .mxl files. Export the music as uncompressed MusicXML (.musicxml) instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipMxl(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // Find the end-of-central-directory record.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This .mxl file isn't a valid compressed MusicXML file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    return dec.decode(await inflate(bytes.subarray(start, start + e.size), e.method));
  };
  let main = null;
  const container = await read('META-INF/container.xml');
  if (container) {
    const m = container.match(/full-path\s*=\s*"([^"]+)"/);
    if (m) main = m[1];
  }
  main ||= [...entries.keys()].find((n) => !n.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(n));
  const xml = main && (await read(main));
  if (!xml) throw new Error('No music was found inside this .mxl file.');
  return xml;
}

/* ---------------- ABC ---------------- */

const ACC = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export function importAbc(abcText, fallbackTitle) {
  if (!window.ABCJS) throw new Error("The sheet music library didn't load, so ABC files can't be read right now.");
  const [tune] = window.ABCJS.parseOnly(abcText);
  if (!tune || !tune.lines?.some((l) => l.staff)) throw new Error('No music was found in this ABC file.');
  const notes = [];
  const meter = tune.getMeterFraction?.() || { num: 4, den: 4 };
  const t = tune.metaText?.tempo;
  const tempo = t?.bpm ? t.bpm * (t.duration?.[0] ? t.duration[0] * 4 : 1) : null;

  let fifths = null;
  let chords = 0;
  let repeats = false;
  let lastTie = null;
  const bars = [];
  let bar = [];
  let triplet = { left: 0, mult: 1 };
  for (const line of tune.lines) {
    const staff = line.staff?.[0];
    if (!staff) continue;
    const keyAcc = new Map((staff.key?.accidentals || []).map((a) => [a.note.toUpperCase(), ACC[a.acc] || 0]));
    if (fifths === null && staff.key) {
      fifths = (staff.key.accidentals || []).reduce((n, a) => n + (a.acc === 'sharp' ? 1 : a.acc === 'flat' ? -1 : 0), 0);
      if (staff.key.mode && staff.key.mode.toLowerCase() !== 'maj' && staff.key.mode !== '') {
        notes.push('The tune is in a minor or modal key. It is shown in the closest major key the app has.');
      }
    }
    let barAcc = new Map();
    if (staff.voices.length > 1) notes.push('The ABC file has more than one voice. Only the first is kept.');
    for (const el of staff.voices[0]) {
      if (el.el_type === 'bar') {
        if (/repeat/.test(el.type || '')) repeats = true;
        if (bar.length) bars.push(bar);
        bar = [];
        barAcc = new Map();
        continue;
      }
      if (el.el_type !== 'note') continue; // grace notes ride on the main note and are skipped
      if (el.startTriplet) triplet = { left: el.startTriplet, mult: el.tripletMultiplier || 1 };
      let beats = el.duration * 4;
      if (triplet.left > 0) {
        beats *= triplet.mult;
        triplet.left--;
      }
      if (!(beats > 0)) continue;
      if (el.rest || !el.pitches?.length) {
        if (el.rest?.type !== 'spacer') bar.push({ midi: null, beats });
        continue;
      }
      if (el.pitches.length > 1) chords++;
      const midis = el.pitches.map((p) => {
        const oct = Math.floor(p.pitch / 7);
        const step = ((p.pitch % 7) + 7) % 7;
        const letter = 'CDEFGAB'[step];
        const slot = `${letter}${oct}`;
        if (p.accidental) barAcc.set(slot, ACC[p.accidental] ?? 0);
        const alter = barAcc.has(slot) ? barAcc.get(slot) : keyAcc.get(letter) || 0;
        return 60 + oct * 12 + MAJOR[step] + alter;
      });
      const midi = Math.max(...midis);
      if (lastTie && lastTie.midi === midi && bar.includes(lastTie)) {
        lastTie.beats += beats;
      } else {
        const n = { midi, beats };
        bar.push(n);
        lastTie = el.pitches.some((p) => p.startTie) ? n : null;
        continue;
      }
      if (!el.pitches.some((p) => p.startTie)) lastTie = null;
    }
  }
  if (bar.length) bars.push(bar);
  if (!bars.some((b) => b.some((n) => n.midi != null))) throw new Error('No notes were found in this ABC file.');
  if (chords) notes.push(`${chords} chord(s) were found: only the top note of each is kept.`);
  if (repeats) notes.push('The music has repeat signs. The app plays it once through; use 🔁 Loop to repeat bars.');
  return buildSong({
    title: tune.metaText?.title || fallbackTitle,
    fifths: fifths ?? 0,
    beatsPerBar: (meter.num * 4) / meter.den,
    tempo,
    bars,
    notes,
  });
}

/* ---------------- Any score file ---------------- */

export async function importScoreFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const fallback = titleFromFileName(file.name);
  if (ext === 'abc') return importAbc(await file.text(), fallback);
  if (ext === 'mxl') return importMusicXml(await unzipMxl(await file.arrayBuffer()), fallback);
  return importMusicXml(await file.text(), fallback);
}
