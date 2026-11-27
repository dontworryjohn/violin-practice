// Step 5 of the sheet-reading tests (see README.md): reads every sheet in out/ with js/omr.js and
// compares the notes, lengths and bar lines with out/<id>.truth.json.
//   node tests/omr/bench.cjs [part-of-a-file-name]
// BROWSER=webkit runs it in Safari's engine (what every iPad browser uses) instead of Chromium.
const playwright = require('playwright');
const engine = process.env.BROWSER || 'chromium';
const fs = require('fs');
const DIR = require('path').join(__dirname, 'out');
const only = process.argv[2];
(async () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.(pdf|png|jpg)$/.test(f) && (!only || f.includes(only))).sort();
  const b = await playwright[engine].launch();
  console.log(`Reading in ${engine}`);
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:8000');
  await p.waitForSelector('.song-card');
  let tot = 0, ok = 0;
  for (const f of files) {
    const tf = `${DIR}/${f.replace(/^(scan_|photo_)/, '').split('.')[0]}.truth.json`;
    const truth = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : null;
    const b64 = fs.readFileSync(`${DIR}/${f}`).toString('base64');
    const res = await p.evaluate(async ({ b64, f }) => {
      const { readSheetMusic } = await import('/js/omr.js');
      const { parseTune } = await import('/js/notation.js');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const type = f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const t0 = performance.now();
      try {
        const { song, warnings } = await readSheetMusic(new File([bytes], f, { type }), 'fallback');
        const parsed = parseTune(song.notes, song);
        return { ms: Math.round(performance.now() - t0), song, warnings, errors: parsed.errors, bars: parsed.bars.map((bar) => bar.map((n) => ({ midi: n.type === 'note' ? n.midi : null, beats: n.beats }))) };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    }, { b64, f });
    if (!truth) {
      // A page without music must be refused with a message, not turned into notes.
      tot++;
      if (res.error) ok++;
      console.log(`${res.error ? '✓' : '✗'} ${f}: no music expected -> ${res.error || 'read notes!'}`);
      continue;
    }
    if (res.error) { tot++; console.log(`✗ ${f}: ERROR ${res.error}`); continue; }
    const want = truth.bars.flat(), got = res.bars.flat();
    // Alignment (edit distance) on pitch, then count length matches on aligned pairs.
    const n = want.length, m = got.length;
    const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (want[i - 1].midi === got[j - 1].midi ? 0 : 1));
    let i = n, j = m, pitchOk = 0, lenOk = 0; const diffs = [];
    while (i > 0 && j > 0) {
      if (D[i][j] === D[i - 1][j - 1] + (want[i - 1].midi === got[j - 1].midi ? 0 : 1)) {
        const w = want[i - 1], g = got[j - 1];
        if (w.midi === g.midi) pitchOk++; else diffs.unshift(`#${i} pitch ${w.midi}→${g.midi}`);
        if (Math.abs(w.beats - g.beats) < 1e-6) lenOk++; else diffs.unshift(`#${i} len ${w.beats}→${g.beats}`);
        i--; j--;
      } else if (D[i][j] === D[i - 1][j] + 1) { diffs.unshift(`#${i} missing ${want[i - 1].midi}:${want[i - 1].beats}`); i--; }
      else { diffs.unshift(`extra ${got[j - 1].midi}:${got[j - 1].beats} near #${i}`); j--; }
    }
    while (i > 0) { diffs.unshift(`#${i} missing`); i--; }
    while (j > 0) { diffs.unshift(`extra near start`); j--; }
    // Bar lines in the right places too: the notes in each bar must match.
    const barsOk = JSON.stringify(truth.bars.map((b) => b.map((x) => [x.midi, x.beats]))) === JSON.stringify(res.bars.map((b) => b.map((x) => [x.midi, x.beats])));
    if (!barsOk && pitchOk === n && lenOk === n) diffs.push('bar lines differ');
    const perfect = pitchOk === n && lenOk === n && m === n && barsOk;
    tot++; if (perfect) ok++;
    const meta = `key ${res.song.key}/${truth.key} beats ${res.song.beatsPerBar}/${truth.beatsPerBar} tempo ${res.song.tempo}/${truth.tempo} bars ${res.bars.length}/${truth.bars.length} title "${res.song.title}"`;
    console.log(`${perfect ? '✓' : '✗'} ${f}: pitch ${pitchOk}/${n} len ${lenOk}/${n} got ${m} | ${meta} | ${res.ms}ms${res.errors.length ? ' ERR ' + res.errors[0] : ''}`);
    if (!perfect) console.log('   ', diffs.slice(0, 12).join('; '));
  }
  console.log(`\n${ok}/${tot} perfect`, errs.length ? 'console errors: ' + errs.join(' | ') : '');
  await b.close();
})();
