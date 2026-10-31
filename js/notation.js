// Turns the letter/finger tune format ("A0 A0 E0:2 | ...") into notes with pitches.
//
// Token format
//   <string><finger>[L|H][:beats]
//     string  G, D, A or E
//     finger  0 (open string) to 4
//     L / H   optional: force a low or high finger (e.g. E2L = G natural, E2H = G sharp)
//     beats   optional: how long the note lasts (default 1). 2 = hold for 2, 0.5 = quick, 1/2 also works
//   R or -    a rest, e.g. R:2
//   |         a bar line (optional: without bar lines the tune is split into bars automatically)

export const STRINGS = ['G', 'D', 'A', 'E'];
export const STRING_MIDI = { G: 55, D: 62, A: 69, E: 76 };

export const KEYS = {
  D: 'D major',
  A: 'A major',
  G: 'G major',
  C: 'C major',
};

const KEY_ROOT = { C: 0, G: 7, D: 2, A: 9 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Semitones above the open string each finger can land on in first position.
// The first option that belongs to the song's key wins.
const FINGER_CHOICES = { 0: [0], 1: [2, 1], 2: [4, 3], 3: [5, 6], 4: [7] };
const LOW_HIGH = { 1: { L: 1, H: 2 }, 2: { L: 3, H: 4 }, 3: { L: 5, H: 6 } };

const NOTE_RE = /^([GDAE])([0-4])([LH])?(?::(\d+(?:\.\d+)?|\d+\/\d+))?$/i;
const REST_RE = /^(?:R|-)(?::(\d+(?:\.\d+)?|\d+\/\d+))?$/i;

function inKey(pitchClass, key) {
  const root = KEY_ROOT[key] ?? KEY_ROOT.D;
  return MAJOR_STEPS.some((s) => (root + s) % 12 === pitchClass);
}

export function pitchFor(string, finger, key = 'D', mod) {
  const base = STRING_MIDI[string];
  let offset;
  if (mod && LOW_HIGH[finger]) {
    offset = LOW_HIGH[finger][mod];
  } else {
    const options = FINGER_CHOICES[finger];
    offset = options.find((o) => inKey((base + o) % 12, key)) ?? options[0];
  }
  const midi = base + offset;
  return { midi, name: NOTE_NAMES[midi % 12] };
}

function parseBeats(text) {
  if (!text) return 1;
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number);
    return b ? a / b : NaN;
  }
  return Number(text);
}

function splitIntoBars(notes, beatsPerBar) {
  const bars = [];
  let bar = [];
  let beats = 0;
  for (const n of notes) {
    bar.push(n);
    beats += n.beats;
    if (beats >= beatsPerBar - 1e-6) {
      bars.push(bar);
      bar = [];
      beats = 0;
    }
  }
  if (bar.length) bars.push(bar);
  return bars;
}

export function parseTune(text, { key = 'D', beatsPerBar = 4 } = {}) {
  const errors = [];
  const warnings = [];
  const src = (text || '').trim();
  const hasBarLines = src.includes('|');
  let bars = [];

  for (const chunk of hasBarLines ? src.split('|') : [src]) {
    const tokens = chunk.trim().split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) continue;
    const bar = [];
    for (const token of tokens) {
      let m = token.match(NOTE_RE);
      if (m) {
        const string = m[1].toUpperCase();
        const finger = Number(m[2]);
        const mod = m[3] ? m[3].toUpperCase() : undefined;
        const beats = parseBeats(m[4]);
        if (!(beats > 0)) {
          errors.push(`"${token}": the length after ":" must be more than 0.`);
          continue;
        }
        bar.push({ type: 'note', string, finger, mod, beats, token, ...pitchFor(string, finger, key, mod) });
        continue;
      }
      m = token.match(REST_RE);
      if (m) {
        const beats = parseBeats(m[1]);
        if (!(beats > 0)) {
          errors.push(`"${token}": the length after ":" must be more than 0.`);
          continue;
        }
        bar.push({ type: 'rest', beats, token });
        continue;
      }
      errors.push(`"${token}" isn't a note I know. Use a string letter (G, D, A, E) and a finger (0-4), like A0 or E2.`);
    }
    if (bar.length) bars.push(bar);
  }

  if (!hasBarLines) bars = splitIntoBars(bars[0] || [], beatsPerBar);

  let index = 0;
  let beat = 0;
  bars.forEach((bar, b) => {
    const total = bar.reduce((sum, n) => sum + n.beats, 0);
    const isEdge = b === 0 || b === bars.length - 1;
    if (Math.abs(total - beatsPerBar) > 1e-6 && !isEdge) {
      warnings.push(`Bar ${b + 1} has ${+total.toFixed(2)} beats (expected ${beatsPerBar}).`);
    }
    for (const n of bar) {
      n.bar = b;
      n.index = index++;
      n.startBeat = beat;
      beat += n.beats;
    }
  });

  if (!bars.length && !errors.length) errors.push('Type some notes first, like: A0 A0 E0 E0');

  return { bars, notes: bars.flat(), errors, warnings, totalBeats: beat };
}
