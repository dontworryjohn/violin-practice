// Sheet music view: draws a parsed tune as a treble-clef staff with abcjs
// (vendor/abcjs, loaded as the global ABCJS) and highlights the note being played.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_SHARPS = { C: [], G: ['F'], D: ['F', 'C'], A: ['F', 'C', 'G'] };

// ABC notation for one pitch, e.g. 55 -> "G,", 69 -> "A", 76 -> "e", 84 -> "c'".
function abcPitch(midi, accidental) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  let letter = name[0];
  if (octave >= 5) letter = letter.toLowerCase() + "'".repeat(octave - 5);
  else letter += ','.repeat(4 - octave);
  return accidental + letter;
}

// Length in ABC units, with L:1/8 (an eighth note is 1, a quarter note is 2).
function abcLength(beats) {
  const eighths = beats * 2;
  if (eighths === 1) return '';
  if (Number.isInteger(eighths)) return String(eighths);
  const sixteenths = Math.round(eighths * 2);
  return sixteenths === 1 ? '/' : `${sixteenths}/2`;
}

// Converts a parsed tune (from notation.js) to ABC notation.
export function toAbc(parsed, song, { fingers = true } = {}) {
  const keySharps = KEY_SHARPS[song.key] || [];
  const bars = parsed.bars.map((bar) => {
    const override = new Map(); // accidentals written earlier in this bar, per pitch letter+octave
    let out = '';
    bar.forEach((n, i) => {
      const prev = bar[i - 1];
      // Beam quick notes that fall inside the same beat; otherwise separate them.
      const beam = prev && n.beats < 1 && prev.beats < 1 && Math.floor(prev.startBeat + 1e-6) === Math.floor(n.startBeat + 1e-6);
      if (i > 0 && !beam) out += ' ';
      if (n.type === 'rest') {
        out += `z${abcLength(n.beats)}`;
        return;
      }
      const name = NOTE_NAMES[n.midi % 12];
      const sharp = name.length > 1;
      const slot = name[0] + Math.floor(n.midi / 12);
      const current = override.has(slot) ? override.get(slot) : keySharps.includes(name[0]);
      let acc = '';
      if (sharp !== current) {
        acc = sharp ? '^' : '=';
        override.set(slot, sharp);
      }
      const label = fingers ? `"_${n.string}${n.finger}"` : '';
      out += `${label}${abcPitch(n.midi, acc)}${abcLength(n.beats)}`;
    });
    return out;
  });
  return [
    'X:1',
    `M:${song.beatsPerBar || 4}/4`,
    'L:1/8',
    '%%annotationfont Helvetica 9',
    `K:${song.key || 'D'}`,
    `${bars.join(' | ')} |]`,
  ].join('\n');
}

// Draws the tune into `container` and returns controls for highlighting.
export function renderSheet(container, parsed, song, { fingers = true, onNoteClick } = {}) {
  container.innerHTML = '';
  if (!window.ABCJS) {
    container.innerHTML = '<p class="card">⚠️ The sheet music library didn\'t load. Use the letters view instead.</p>';
    return null;
  }
  const width = container.clientWidth || 700;
  // How big the music looks: the staff is drawn `width / zoom` units wide, then stretched
  // to fill the box ("responsive"), so a bigger zoom means bigger notes and fewer bars per line.
  const zoom = width < 600 ? 1.15 : width < 1000 ? 1.8 : 1.6;
  const barsPerLine = width < 600 ? 2 : width < 1000 ? 3 : 4;
  const elemToIndex = new Map();
  const [tune] = window.ABCJS.renderAbc(container, toAbc(parsed, song, { fingers }), {
    add_classes: true,
    responsive: 'resize',
    staffwidth: Math.max(260, width / zoom - 12),
    wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: barsPerLine },
    paddingtop: 4,
    paddingbottom: 8,
    paddingleft: 4,
    paddingright: 4,
    selectionColor: 'currentColor',
    clickListener(abcElem) {
      const i = elemToIndex.get(abcElem);
      if (i !== undefined && onNoteClick) onNoteClick(i);
    },
  });

  // abcjs lists notes and rests in the same order as parsed.notes.
  const notes = [];
  tune.lines.forEach((line) => {
    (line.staff || []).forEach((staff) => {
      (staff.voices[0] || []).forEach((el) => {
        if (el.el_type !== 'note' || !el.abselem) return;
        elemToIndex.set(el, notes.length);
        notes.push({ els: el.abselem.elemset.filter(Boolean) });
      });
    });
  });
  const count = Math.min(notes.length, parsed.notes.length);

  // Colour each finger label by its string, like the letters view.
  for (let i = 0; i < count; i++) {
    const n = parsed.notes[i];
    notes[i].els.forEach((g) => {
      g.classList.add('sheet-note');
      if (n.type === 'note') g.classList.add(`s-${n.string}`);
    });
  }

  // Position of every note in the SVG, and the top/bottom of its line of music,
  // so the highlight band is the same height for every note on a line.
  const svg = container.querySelector('svg');
  const boxes = notes.slice(0, count).map(({ els }) => {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    els.forEach((g) => {
      const b = g.getBBox();
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.width);
      y2 = Math.max(y2, b.y + b.height);
    });
    return { x1, y1, x2, y2 };
  });
  const lines = [];
  boxes.forEach((b, i) => {
    const line = lines.find((l) => b.y1 < l.y2 && b.y2 > l.y1);
    if (line) {
      line.y1 = Math.min(line.y1, b.y1);
      line.y2 = Math.max(line.y2, b.y2);
      line.members.push(i);
    } else {
      lines.push({ y1: b.y1, y2: b.y2, members: [i] });
    }
  });
  lines.forEach((l) => l.members.forEach((i) => (boxes[i].line = l)));

  const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  band.setAttribute('class', 'sheet-band');
  band.setAttribute('rx', 6);
  band.style.display = 'none';
  svg.insertBefore(band, svg.firstChild); // first child = drawn behind the music

  let nowIdx = -1;
  return {
    count,
    setNow(idx) {
      if (nowIdx >= 0 && notes[nowIdx]) notes[nowIdx].els.forEach((g) => g.classList.remove('sheet-now'));
      nowIdx = idx < count ? idx : -1;
      if (nowIdx < 0) {
        band.style.display = 'none';
        return null;
      }
      notes[nowIdx].els.forEach((g) => g.classList.add('sheet-now'));
      const b = boxes[nowIdx];
      const pad = 4;
      band.setAttribute('x', b.x1 - pad);
      band.setAttribute('y', b.line.y1 - pad);
      band.setAttribute('width', b.x2 - b.x1 + pad * 2);
      band.setAttribute('height', b.line.y2 - b.line.y1 + pad * 2);
      band.style.display = '';
      return band;
    },
    setRange(startIdx, endIdx, whole) {
      notes.slice(0, count).forEach(({ els }, i) =>
        els.forEach((g) => g.classList.toggle('sheet-out', !whole && (i < startIdx || i > endIdx))),
      );
    },
  };
}
