// Step 1 of the sheet-reading tests (see README.md). Needs the app served on http://localhost:8000.
// Builds test sheets with known answers in tests/omr/out/:
//   <id>.truth.json   bars of { midi | null, beats } plus key/beats/tempo/title
//   <id>.musicxml     for Verovio (rendered by make_verovio.py)
//   <id>.abcjs.pdf    drawn by abcjs (the app's own sheet renderer), printed to a vector PDF
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const FIFTHS = { C: 0, G: 1, D: 2, A: 3 };
const STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

function noteType(beats) {
  return (
    {
      4: ['whole', 0], 3: ['half', 1], 2: ['half', 0], 1.5: ['quarter', 1], 1: ['quarter', 0],
      0.75: ['eighth', 1], 0.5: ['eighth', 0], 0.25: ['16th', 0],
    }[beats] || ['quarter', 0]
  );
}

// `slurs`: join notes in pairs with slurs (curves that must not be mistaken for flags or beams).
function musicXml(song, bars, { slurs = false } = {}) {
  let k = 0;
  const meas = bars.map((bar, i) => {
    const attrs = i
      ? ''
      : `<attributes><divisions>4</divisions><key><fifths>${FIFTHS[song.key]}</fifths></key><time><beats>${song.beatsPerBar}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${song.tempo}</per-minute></metronome></direction-type><sound tempo="${song.tempo}"/></direction>`;
    const notes = bar
      .map((n) => {
        const [type, dots] = noteType(n.beats);
        const dur = Math.round(n.beats * 4);
        const dotXml = '<dot/>'.repeat(dots);
        if (n.midi == null) return `<note><rest/><duration>${dur}</duration><voice>1</voice><type>${type}</type>${dotXml}</note>`;
        const pc = n.midi % 12;
        const alter = ALTER[pc] ? '<alter>1</alter>' : '';
        // Pairs of notes: start, stop, start, stop… (no unfinished slur on the last note).
        const total = bars.flat().filter((x) => x.midi != null).length;
        const kind = k % 2 ? 'stop' : k < total - 1 ? 'start' : null;
        k++;
        const slur = slurs && kind ? `<notations><slur number="1" type="${kind}"/></notations>` : '';
        return `<note><pitch><step>${STEPS[pc]}</step>${alter}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${dotXml}${slur}</note>`;
      })
      .join('');
    return `<measure number="${i + 1}">${attrs}${notes}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>${song.title}</work-title></work>
<part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
<part id="P1">${meas.join('')}</part></score-partwise>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8000');
  await page.waitForSelector('.song-card');
  const songs = await page.evaluate(async () => {
    const { parseTune } = await import('/js/notation.js');
    const { songs } = await (await fetch('/songs.json')).json();
    const extra = {
      id: 'dscale', title: 'D Major Scale', key: 'D', beatsPerBar: 4, tempo: 120,
      notes: 'D0 D1 D2 D3 | A0 A1 A2 A3 | A3 A2 A1 A0 | D3 D2 D1 D0 | D0 D2 A0 A3 | A3 A0 D2 D0 | D0:0.5 D2:0.5 D1:0.5 D3:0.5 D2:0.5 A0:0.5 D3:0.5 A1:0.5 | A0:0.5 A2:0.5 A1:0.5 A3:0.5 A2:0.5 E0:0.5 A3:0.5 E1:0.5 | E1:0.5 A3:0.5 E0:0.5 A2:0.5 A3:0.5 A1:0.5 A2:0.5 A0:0.5 | A1:0.5 D3:0.5 A0:0.5 D2:0.5 D3:0.5 D1:0.5 D2:0.5 D0:0.5 | R:4',
    };
    return [...songs, extra].map((s) => {
      const p = parseTune(s.notes, s);
      return { ...s, bars: p.bars.map((b) => b.map((n) => ({ midi: n.type === 'note' ? n.midi : null, beats: n.beats }))) };
    });
  });

  for (const s of songs) {
    const truth = { title: s.title, key: s.key, beatsPerBar: s.beatsPerBar, tempo: s.tempo, bars: s.bars };
    fs.writeFileSync(path.join(OUT, `${s.id}.truth.json`), JSON.stringify(truth));
    fs.writeFileSync(path.join(OUT, `${s.id}.musicxml`), musicXml(s, s.bars));
    if (s.id === 'lightly-row') {
      // The same tune with slurs over pairs of notes, like many teachers' sheets.
      fs.writeFileSync(path.join(OUT, 'lightly-row-slurs.truth.json'), JSON.stringify(truth));
      fs.writeFileSync(path.join(OUT, 'lightly-row-slurs.musicxml'), musicXml(s, s.bars, { slurs: true }));
    }

    // abcjs drawing (no finger labels), letter-size page.
    const p2 = await browser.newPage();
    await p2.goto('http://localhost:8000/index.html');
    await p2.evaluate(async (s) => {
      const { parseTune } = await import('/js/notation.js');
      const { toAbc } = await import('/js/sheet.js');
      const abc = toAbc(parseTune(s.notes, s), s, { fingers: false }).replace('X:1', `X:1\nT:${s.title}\nQ:1/4=${s.tempo}`);
      document.body.innerHTML = '<div id="m" style="width:720px;background:#fff"></div>';
      document.body.style.background = '#fff';
      window.ABCJS.renderAbc('m', abc, { staffwidth: 680, wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: 4 } });
    }, s);
    await p2.pdf({ path: path.join(OUT, `${s.id}.abcjs.pdf`), format: 'Letter', printBackground: true });
    await p2.close();
  }
  console.log('songs:', songs.map((s) => s.id).join(' '));
  await browser.close();
})();
