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
export function toAbc(parsed, song, { fingers = true, baton = false } = {}) {
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
    // With the baton, leave more room between lines so it doesn't cover the line above.
    ...(baton ? ['%%staffsep 75'] : []),
    `K:${song.key || 'D'}`,
    `${bars.join(' | ')} |]`,
  ].join('\n');
}

// Draws the tune into `container` and returns controls for highlighting.
export function renderSheet(container, parsed, song, { fingers = true, style = 'band', onNoteClick } = {}) {
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
  const [tune] = window.ABCJS.renderAbc(container, toAbc(parsed, song, { fingers, baton: style === 'baton' }), {
    add_classes: true,
    responsive: 'resize',
    staffwidth: Math.max(260, width / zoom - 12),
    wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: barsPerLine },
    paddingtop: style === 'baton' ? 70 : 4, // room above the first line for the baton
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
    // The note head (first shape in the note) is where the baton taps.
    const head = els[0]?.querySelector('path');
    const hb = head ? head.getBBox() : { x: x1, width: x2 - x1 };
    return { x1, y1, x2, y2, cx: hb.x + hb.width / 2 };
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

  const SVGNS = 'http://www.w3.org/2000/svg';
  const make = (tag, cls) => {
    const el = document.createElementNS(SVGNS, tag);
    el.setAttribute('class', cls);
    return el;
  };

  // Jumping band: drawn behind the music.
  const band = make('rect', 'sheet-band');
  band.setAttribute('rx', 6);
  band.style.display = 'none';
  svg.insertBefore(band, svg.firstChild);

  // Conductor's baton: drawn in front of the music.
  const baton = make('g', 'sheet-baton');
  const ring = make('circle', 'baton-ring');
  const stick = make('line', 'baton-stick');
  const grip = make('line', 'baton-grip');
  const tip = make('circle', 'baton-tip');
  tip.setAttribute('r', 7);
  baton.append(ring, stick, grip, tip);
  baton.style.display = 'none';
  svg.appendChild(baton);

  const BATON_LENGTH = 54;
  const tapY = (i) => boxes[i].y1 - 9; // just above the note
  function drawBaton(x, y, lift, ringAt, ripple) {
    const angle = ((28 + 22 * lift) * Math.PI) / 180;
    const hx = x + BATON_LENGTH * Math.sin(angle);
    const hy = y - BATON_LENGTH * Math.cos(angle);
    const gx = x + (BATON_LENGTH - 15) * Math.sin(angle);
    const gy = y - (BATON_LENGTH - 15) * Math.cos(angle);
    tip.setAttribute('cx', x);
    tip.setAttribute('cy', y);
    stick.setAttribute('x1', x);
    stick.setAttribute('y1', y);
    stick.setAttribute('x2', hx);
    stick.setAttribute('y2', hy);
    grip.setAttribute('x1', gx);
    grip.setAttribute('y1', gy);
    grip.setAttribute('x2', hx);
    grip.setAttribute('y2', hy);
    // A ring ripples out from each tap.
    ring.setAttribute('cx', ringAt.x);
    ring.setAttribute('cy', ringAt.y);
    ring.setAttribute('r', 7 + 12 * ripple);
    ring.style.opacity = String(Math.max(0, 1 - ripple));
  }

  let nowIdx = -1;
  let followStyle = style === 'baton' ? 'baton' : 'band';

  function markNote(idx) {
    if (nowIdx >= 0 && notes[nowIdx]) notes[nowIdx].els.forEach((g) => g.classList.remove('sheet-now'));
    nowIdx = idx >= 0 && idx < count ? idx : -1;
    if (nowIdx >= 0) notes[nowIdx].els.forEach((g) => g.classList.add('sheet-now'));
  }

  const controls = {
    count,
    // Highlights note `idx` (-1 = none). Returns an element to keep in view, or null.
    setNow(idx) {
      markNote(idx);
      if (nowIdx < 0) {
        band.style.display = 'none';
        baton.style.display = 'none';
        return null;
      }
      const b = boxes[nowIdx];
      if (followStyle === 'baton') {
        band.style.display = 'none';
        baton.style.display = '';
        drawBaton(b.cx, tapY(nowIdx), 0, { x: b.cx, y: tapY(nowIdx) }, 1);
        return notes[nowIdx].els[0];
      }
      baton.style.display = 'none';
      const pad = 4;
      band.setAttribute('x', b.x1 - pad);
      band.setAttribute('y', b.line.y1 - pad);
      band.setAttribute('width', b.x2 - b.x1 + pad * 2);
      band.setAttribute('height', b.line.y2 - b.line.y1 + pad * 2);
      band.style.display = '';
      return band;
    },
    setStyle(newStyle) {
      followStyle = newStyle === 'baton' ? 'baton' : 'band';
      return controls.setNow(nowIdx);
    },
    // Baton movement while note `idx` sounds. `frac` is how far through the note we are (0-1),
    // `beats` its length, `nextIdx` the note that comes next (-1 = the end), `sinceTapMs` the
    // time since the tap. It rests on the note, then lifts and swings down onto the next one.
    batonStep(idx, frac, beats, nextIdx, sinceTapMs) {
      if (followStyle !== 'baton' || idx < 0 || idx >= count) return;
      baton.style.display = '';
      const from = boxes[idx];
      const to = nextIdx >= 0 && nextIdx < count ? boxes[nextIdx] : null;
      const hold = beats > 1 ? 1 - 0.55 / beats : 0.45; // part of the note spent resting on it
      const x0 = from.cx;
      const y0 = tapY(idx);
      let x = x0;
      let y = y0;
      let lift = 0;
      if (to && frac > hold) {
        const m = Math.min(1, (frac - hold) / (1 - hold));
        const ease = m * m * (3 - 2 * m);
        lift = Math.sin(Math.PI * Math.min(1, m * 1.15)); // up quickly, then down onto the next note
        x = x0 + (to.cx - x0) * ease;
        y = y0 + (tapY(nextIdx) - y0) * ease - 30 * lift;
      }
      drawBaton(x, y, lift, { x: x0, y: y0 }, Math.min(1, sinceTapMs / 300));
    },
    // Count-in: the baton taps in place on the first note, once per beat.
    batonCount(idx, frac) {
      if (followStyle !== 'baton' || idx < 0 || idx >= count) return;
      markNote(-1);
      band.style.display = 'none';
      baton.style.display = '';
      const b = boxes[idx];
      const y0 = tapY(idx);
      const lift = Math.sin(Math.PI * frac);
      drawBaton(b.cx, y0 - 22 * lift, lift * 0.6, { x: b.cx, y: y0 }, Math.min(1, frac * 2.5));
    },
    noteElement(idx) {
      return idx >= 0 && idx < count ? notes[idx].els[0] : null;
    },
    setRange(startIdx, endIdx, whole) {
      notes.slice(0, count).forEach(({ els }, i) =>
        els.forEach((g) => g.classList.toggle('sheet-out', !whole && (i < startIdx || i > endIdx))),
      );
    },
  };
  return controls;
}
