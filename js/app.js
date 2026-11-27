import { parseTune, KEYS } from './notation.js';
import { SongPlayer, Metronome, violinNote, audio } from './audio.js';
import { Tracker, BADGES, dateKey } from './tracker.js';
import { renderSheet } from './sheet.js';
import { fileKind, importScoreFile, titleFromFileName } from './import.js';
import { listPictures, getPicture, addPicture, renamePicture, deletePicture, showPicture, fingerprint, findPictureByHash } from './pictures.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CUSTOM_KEY = 'violinPractice.customSongs.v1';
const VIEW_KEY = 'violinPractice.view.v1'; // letters or sheet music, remembered per device
const SLOW_SPEED = 0.6;

const tracker = new Tracker();
let builtInSongs = [];
let customSongs = loadCustomSongs();
let current = null; // { song, parsed, noteEls, barEls, sheet, nowIdx }
let loggedThisPlay = false;
let pictures = []; // uploaded PDFs and photos: { id, title, type, added }
let pictureShown = null; // { id, viewer, zoom }

/* ---------------- Helpers ---------------- */

function loadCustomSongs() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveCustomSongs() {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customSongs));
  } catch (e) {
    toast('Could not save – storage is full or blocked.');
  }
}

const allSongs = () => [...builtInSongs, ...customSongs];
const findSong = (id) => allSongs().find((s) => s.id === id);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const badgeQueue = [];
function celebrate(badges) {
  badgeQueue.push(...badges);
  if (!$('#celebrate').hidden || !badgeQueue.length) return;
  const b = badgeQueue.shift();
  $('#celebrateEmoji').textContent = b.emoji;
  $('#celebrateName').textContent = b.name;
  $('#celebrate').hidden = false;
  $('#celebrateOk').focus();
}
$('#celebrateOk').addEventListener('click', () => {
  $('#celebrate').hidden = true;
  renderTracker();
  celebrate([]);
});

function fmtTime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function niceDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function holdLabel(beats) {
  if (beats === 1) return '';
  if (beats === 0.5) return 'quick';
  if (beats < 1) return `${beats} beat`;
  return `hold ${Number.isInteger(beats) ? beats : beats.toString().replace('.5', '½')}`;
}

/* ---------------- Tabs ---------------- */

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'tracker') renderTracker();
  window.scrollTo({ top: 0 });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

/* ---------------- Notation ---------------- */

function renderNotation(container, parsed) {
  container.innerHTML = '';
  const noteEls = [];
  const barEls = [];
  parsed.bars.forEach((bar, b) => {
    const barEl = document.createElement('div');
    barEl.className = 'bar';
    barEl.innerHTML = `<div class="bar-num">Bar ${b + 1}</div>`;
    const notesEl = document.createElement('div');
    notesEl.className = 'bar-notes';
    for (const n of bar) {
      const el = document.createElement('button');
      el.type = 'button';
      el.style.setProperty('--w', Math.max(n.beats, 0.8));
      el.dataset.idx = n.index;
      const hold = holdLabel(n.beats);
      if (n.type === 'note') {
        el.className = `note s-${n.string}`;
        el.setAttribute('aria-label', `${n.name}, ${n.string} string, finger ${n.finger}${hold ? ', ' + hold : ''}`);
        el.innerHTML = `<span class="name">${n.name}</span><span class="sf">${n.string}${n.finger}</span>${hold ? `<span class="hold">${hold}</span>` : ''}`;
        el.addEventListener('click', () => violinNote(n.midi, audio().currentTime + 0.02, 0.9));
      } else {
        el.className = 'note rest';
        el.setAttribute('aria-label', `rest${hold ? ', ' + hold : ''}`);
        el.innerHTML = `<span class="name">𝄽</span><span class="sf">rest</span>${hold ? `<span class="hold">${hold}</span>` : ''}`;
      }
      noteEls.push(el);
      notesEl.append(el);
    }
    barEl.append(notesEl);
    barEls.push(barEl);
    container.append(barEl);
  });
  return { noteEls, barEls };
}

/* ---------------- Song list ---------------- */

function renderSongList() {
  const list = $('#songList');
  const songs = allSongs();
  if (!songs.length) {
    list.innerHTML = '<p>No songs yet.</p>';
    return;
  }
  list.innerHTML = songs
    .map((s) => {
      const level = s.level ? `<span class="level" aria-label="Level ${s.level}">${'●'.repeat(s.level)}${'○'.repeat(3 - Math.min(3, s.level))}</span>` : '<span>My song</span>';
      return `<button class="song-card" type="button" data-id="${esc(s.id)}">
        <span class="emoji" aria-hidden="true">${esc(s.emoji || '🎵')}</span>
        <span><span class="title">${esc(s.title)}</span><span class="meta">${KEYS[s.key] || s.key} · ${level}</span></span>
        <span class="trophy" aria-label="${tracker.isMastered(s.id) ? 'mastered' : ''}">${tracker.isMastered(s.id) ? '🏆' : ''}</span>
      </button>`;
    })
    .join('');
  $$('.song-card', list).forEach((c) => c.addEventListener('click', () => openSong(c.dataset.id)));
}

/* ---------------- Song player ---------------- */

/* ---------------- Letters / sheet music view ---------------- */

function loadView() {
  try {
    return { mode: 'letters', fingers: true, follow: 'band', ...JSON.parse(localStorage.getItem(VIEW_KEY)) };
  } catch (e) {
    return { mode: 'letters', fingers: true, follow: 'band' };
  }
}
const view = loadView();
function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch (e) {
    /* not saved – fine */
  }
}

// Keeps the highlighted note visible above the player controls.
function keepInView(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const barH = $('.player-bar').getBoundingClientRect().height;
  if (r.top < 90 || r.bottom > window.innerHeight - barH - 10) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

let lastNow = null;
// Highlights note `idx` (-1 = none) in whichever view is showing.
function showNow(idx) {
  if (!current) return;
  current.nowIdx = idx;
  if (lastNow) lastNow.classList.remove('now');
  lastNow = null;
  if (view.mode === 'sheet') {
    keepInView(current.sheet?.setNow(idx));
    return;
  }
  current.sheet?.setNow(-1);
  lastNow = idx >= 0 ? current.noteEls[idx] : null;
  if (!lastNow) return;
  lastNow.classList.add('now');
  keepInView(lastNow);
}

function playSingleNote(idx) {
  const n = current?.parsed.notes[idx];
  if (n && n.type === 'note') violinNote(n.midi, audio().currentTime + 0.02, 0.9);
}

function drawSheet() {
  if (!current) return;
  const box = $('#sheet');
  current.sheet = renderSheet(box, current.parsed, current.song, {
    fingers: view.fingers,
    style: view.follow,
    onNoteClick: playSingleNote,
  });
  current.sheetWidth = box.clientWidth;
}

function applyView() {
  const sheet = view.mode === 'sheet';
  $('#viewLetters').setAttribute('aria-pressed', String(!sheet));
  $('#viewSheet').setAttribute('aria-pressed', String(sheet));
  $('#fingersBtn').hidden = !sheet;
  $('#fingersBtn').setAttribute('aria-pressed', String(view.fingers));
  $('#followSwitch').hidden = !sheet;
  $('#followBand').setAttribute('aria-pressed', String(view.follow !== 'baton'));
  $('#followBaton').setAttribute('aria-pressed', String(view.follow === 'baton'));
  $('#legend').hidden = sheet && !view.fingers;
  $('#notation').hidden = sheet;
  $('#sheet').hidden = !sheet;
  if (!current) return;
  if (sheet && (!current.sheet || current.sheetWidth !== $('#sheet').clientWidth)) drawSheet();
  current.sheet?.setStyle(view.follow);
  updateRangeHighlight();
  showNow(current.nowIdx ?? -1);
  startBaton();
}

function setView(mode) {
  view.mode = mode;
  saveView();
  applyView();
}
$('#viewLetters').addEventListener('click', () => setView('letters'));
$('#viewSheet').addEventListener('click', () => setView('sheet'));
function setFollow(style) {
  if (view.follow === style) return;
  view.follow = style;
  saveView();
  if (current) current.sheet = null; // redraw: the baton needs a little more room above each line
  applyView();
}
$('#followBand').addEventListener('click', () => setFollow('band'));
$('#followBaton').addEventListener('click', () => setFollow('baton'));
$('#fingersBtn').addEventListener('click', () => {
  view.fingers = !view.fingers;
  saveView();
  if (current) current.sheet = null; // redraw with or without finger numbers
  applyView();
});

// Redraw the sheet music when the screen is rotated or resized, so it fits the new width.
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (current && view.mode === 'sheet' && current.sheetWidth !== $('#sheet').clientWidth) applyView();
  }, 250);
});

/* Conductor's baton: unlike the band, it moves smoothly between notes, so while a song plays
   a timer redraws it every frame from how far through the current note (or count-in beat) we are. */
let beat = null; // { kind: 'note' | 'count', idx, t0, ms, beats }
let batonFrame = 0;
const batonActive = () => !!(current?.sheet && view.mode === 'sheet' && view.follow === 'baton' && player.state === 'playing');
function nextNoteIdx(i) {
  if (i + 1 <= player.endIdx) return i + 1;
  return player.loop ? player.startIdx : -1;
}
function batonTick() {
  batonFrame = 0;
  if (!batonActive() || !beat) return;
  const elapsed = performance.now() - beat.t0;
  const frac = Math.min(1, elapsed / beat.ms);
  if (beat.kind === 'count') current.sheet.batonCount(beat.idx, frac);
  else current.sheet.batonStep(beat.idx, frac, beat.beats, nextNoteIdx(beat.idx), elapsed);
  batonFrame = requestAnimationFrame(batonTick);
}
function startBaton() {
  if (!batonFrame && batonActive()) batonFrame = requestAnimationFrame(batonTick);
}

const player = new SongPlayer({
  onNote(idx) {
    showNow(idx);
    const n = idx >= 0 ? current?.parsed.notes[idx] : null;
    beat = n ? { kind: 'note', idx, t0: performance.now(), ms: n.beats * player.secondsPerBeat * 1000, beats: n.beats } : null;
    startBaton();
  },
  onCount(n, total) {
    beat = { kind: 'count', idx: player.pos, t0: performance.now(), ms: player.secondsPerBeat * 1000 };
    // The baton taps the count-in on the first note, so bring that note into view straight away.
    if (n === 1 && batonActive()) keepInView(current.sheet.noteElement(player.pos));
    startBaton();
    const el = $('#countIn');
    el.hidden = false;
    el.innerHTML = `<span>${n}</span>`;
    if (n === total) setTimeout(() => (el.hidden = true), (60 / (player.tempo * player.speed)) * 900);
  },
  onState(state) {
    $('#playBtn').textContent = state === 'playing' ? '⏸ Pause' : '▶ Play';
    if (state !== 'playing') $('#countIn').hidden = true;
    if (state === 'stopped') beat = null;
    startBaton(); // pause simply stops the timer, leaving the baton where it is
  },
  onEnd() {
    toast('Well played! 👏');
  },
});

function updateTempoLabel() {
  if (!current) return;
  const bpm = Math.round(current.song.tempo * player.speed);
  $('#tempoLabel').textContent = `♩ = ${bpm}${player.speed < 1 ? ' 🐢' : ''}`;
}

function updateRangeHighlight() {
  if (!current) return;
  const [from, to] = player.range;
  const whole = from === 0 && to === current.parsed.bars.length - 1;
  current.barEls.forEach((el, i) => {
    el.classList.toggle('out', !whole && (i < from || i > to));
    el.classList.toggle('in-loop', !whole && player.loop && i >= from && i <= to);
  });
  current.sheet?.setRange(player.startIdx, player.endIdx, whole);
}

function fillBarSelects(count) {
  const opts = Array.from({ length: count }, (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
  $('#loopFrom').innerHTML = opts;
  $('#loopTo').innerHTML = opts;
  $('#loopFrom').value = 0;
  $('#loopTo').value = count - 1;
}

function openSong(id) {
  const song = findSong(id);
  if (!song) return;
  const parsed = parseTune(song.notes, song);
  const { noteEls, barEls } = renderNotation($('#notation'), parsed);
  current = { song, parsed, noteEls, barEls, sheet: null, nowIdx: -1 };
  lastNow = null;
  player.load(parsed, song);
  fillBarSelects(parsed.bars.length);
  $('#songTitle').textContent = `${song.emoji || '🎵'} ${song.title}`;
  $('#songKey').textContent = KEYS[song.key] || song.key;
  updateTempoLabel();
  updateMasterBtn();
  closePicture(false);
  $('#songListView').hidden = true;
  $('#songView').hidden = false;
  showTab('songs');
  applyView(); // after the song view is visible, so the sheet music knows its width
}

function closeSong() {
  player.stop();
  current = null;
  $('#songView').hidden = true;
  $('#songListView').hidden = false;
  renderSongList();
}

function updateMasterBtn() {
  const on = current && tracker.isMastered(current.song.id);
  const btn = $('#masterBtn');
  btn.setAttribute('aria-pressed', String(!!on));
  btn.textContent = on ? '🏆 Mastered!' : '☆ I can play it!';
}

$('#backBtn').addEventListener('click', closeSong);

$('#playBtn').addEventListener('click', () => {
  if (player.state === 'playing') {
    player.pause();
    return;
  }
  if (player.state === 'stopped') loggedThisPlay = false;
  if (!loggedThisPlay && current) {
    tracker.logSong(current.song.id);
    loggedThisPlay = true;
  }
  player.play();
});
$('#stopBtn').addEventListener('click', () => player.stop());

function toggleBtn(btn) {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  return on;
}

$('#slowBtn').addEventListener('click', (e) => {
  player.speed = toggleBtn(e.currentTarget) ? SLOW_SPEED : 1;
  updateTempoLabel();
});
$('#countBtn').addEventListener('click', (e) => {
  player.countIn = toggleBtn(e.currentTarget);
});
$('#loopBtn').addEventListener('click', (e) => {
  player.loop = toggleBtn(e.currentTarget);
  updateRangeHighlight();
});

function onRangeChange(changed) {
  let from = Number($('#loopFrom').value);
  let to = Number($('#loopTo').value);
  if (from > to) {
    if (changed === 'from') to = from;
    else from = to;
    $('#loopFrom').value = from;
    $('#loopTo').value = to;
  }
  const wasPlaying = player.state === 'playing';
  player.stop();
  player.setRange(from, to);
  updateRangeHighlight();
  if (wasPlaying) player.play();
}
$('#loopFrom').addEventListener('change', () => onRangeChange('from'));
$('#loopTo').addEventListener('change', () => onRangeChange('to'));
$('#loopAllBtn').addEventListener('click', () => {
  if (!current) return;
  $('#loopFrom').value = 0;
  $('#loopTo').value = current.parsed.bars.length - 1;
  onRangeChange('to');
});

$('#masterBtn').addEventListener('click', () => {
  if (!current) return;
  const fresh = tracker.toggleMastered(current.song.id);
  updateMasterBtn();
  if (tracker.isMastered(current.song.id)) toast('Amazing! Song mastered 🏆');
  celebrate(fresh);
});

/* ---------------- Metronome ---------------- */

const TEMPO_WORDS = [
  [60, '🐌 Very slow (Largo)'],
  [76, '🐢 Slow (Adagio)'],
  [108, '🚶 Walking (Andante)'],
  [120, '🙂 Medium (Moderato)'],
  [140, '🐇 Quick (Allegro)'],
  [161, '🚀 Very fast (Presto)'],
];

const metro = new Metronome({
  onBeat(beat) {
    $$('.dot').forEach((d, i) => d.classList.toggle('on', i === beat));
    const card = $('#metroCard');
    card.classList.add('flash');
    card.classList.toggle('accent', beat === 0 && metro.accent);
    clearTimeout(metro.flashTimer);
    metro.flashTimer = setTimeout(() => card.classList.remove('flash', 'accent'), 110);
  },
});

function renderDots() {
  $('#beatDots').innerHTML = Array.from({ length: metro.beatsPerBar }, (_, i) => `<div class="dot${i === 0 && metro.accent ? ' first' : ''}"></div>`).join('');
}

function setBpm(v) {
  const bpm = Math.max(40, Math.min(160, Math.round(v)));
  metro.bpm = bpm;
  $('#bpmValue').textContent = bpm;
  $('#bpmSlider').value = bpm;
  $('#tempoWord').textContent = TEMPO_WORDS.find(([max]) => bpm < max)[1];
  $('#miniBpm').textContent = bpm;
}

function setMetroRunning(on) {
  if (on && !metro.running) metro.start();
  if (!on && metro.running) {
    metro.stop();
    $$('.dot').forEach((d) => d.classList.remove('on'));
  }
  $('#metroStart').textContent = metro.running ? '⏹ Stop' : '▶ Start';
  $('#miniMetroBtn').setAttribute('aria-pressed', String(metro.running));
}

$('#bpmSlider').addEventListener('input', (e) => setBpm(Number(e.target.value)));

// +/- buttons: tap for 1, hold to keep going.
function holdRepeat(btn, step) {
  let t1;
  let t2;
  const end = () => {
    clearTimeout(t1);
    clearInterval(t2);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setBpm(metro.bpm + step);
    t1 = setTimeout(() => (t2 = setInterval(() => setBpm(metro.bpm + step), 80)), 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, end));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setBpm(metro.bpm + step);
    }
  });
}
holdRepeat($('#bpmDown'), -1);
holdRepeat($('#bpmUp'), 1);

$$('#beatsSeg .btn').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#beatsSeg .btn').forEach((x) => x.classList.toggle('active', x === b));
    metro.setBeats(Number(b.dataset.beats));
    renderDots();
  }),
);

$('#accentBtn').addEventListener('click', (e) => {
  metro.accent = toggleBtn(e.currentTarget);
  renderDots();
});

$('#metroStart').addEventListener('click', () => setMetroRunning(!metro.running));

const taps = [];
$('#tapBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    setBpm(60000 / avg);
    $('#tapBtn').textContent = `👆 Tap tempo (${metro.bpm})`;
  } else {
    $('#tapBtn').textContent = '👆 Keep tapping…';
  }
});

/* ---------------- Practice tracker ---------------- */

let calMonth = new Date();
calMonth.setDate(1);
let selectedDay = dateKey();
let goalToastShown = false;
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {
    /* not supported – fine */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tracker.running) keepAwake(true);
});

function toggleTimer() {
  if (tracker.running) {
    const mins = Math.round(tracker.liveSeconds() / 60);
    const fresh = tracker.stop();
    keepAwake(false);
    toast(mins >= 1 ? `Great job! ${mins} minute${mins === 1 ? '' : 's'} of practice 🎉` : 'Timer stopped');
    celebrate(fresh);
  } else {
    tracker.start();
    keepAwake(true);
    goalToastShown = tracker.goalMet(dateKey());
    toast('Practice timer started ⏱');
  }
  renderTimer();
  renderTracker();
}
$('#timerPill').addEventListener('click', toggleTimer);
$('#timerBtn').addEventListener('click', toggleTimer);

function renderTimer() {
  const running = tracker.running;
  const today = tracker.secondsOn(dateKey());
  const goal = tracker.goalSeconds;
  $('#timerPill').classList.toggle('running', running);
  $('#timerPillText').textContent = running ? `${fmtTime(tracker.liveSeconds())} ⏹` : 'Start practice';
  $('#timerBtn').textContent = running ? '⏹ Stop practice' : '▶ Start practice';
  $('#bigTimer').textContent = fmtTime(running ? tracker.liveSeconds() : today);
  $('#todayText').textContent = `${Math.floor(today / 60)} of ${tracker.state.goalMinutes} min today`;
  const circ = 2 * Math.PI * 52;
  const ring = $('#ringFg');
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - Math.min(1, today / goal));
  if (running && !goalToastShown && today >= goal) {
    goalToastShown = true;
    toast('🎯 You reached today\'s goal! Keep going or take a bow.');
  }
}
setInterval(renderTimer, 1000);

function changeGoal(step) {
  tracker.setGoal(tracker.state.goalMinutes + step);
  $('#goalVal').textContent = tracker.state.goalMinutes;
  renderTimer();
  renderCalendar();
}
$('#goalDown').addEventListener('click', () => changeGoal(-5));
$('#goalUp').addEventListener('click', () => changeGoal(5));

function renderCalendar() {
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  $('#calTitle').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = dateKey();
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`);
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDow }, () => '<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(year, month, d));
    const cls = ['cal-day'];
    let mark = '';
    if (tracker.goalMet(key)) {
      cls.push('goal');
      mark = '⭐';
    } else if (tracker.isPractised(key)) {
      cls.push('practised');
      mark = '🎵';
    }
    if (key === todayKey) cls.push('today');
    if (key === selectedDay) cls.push('selected');
    if (key > todayKey) cls.push('future');
    cells.push(`<button type="button" class="${cls.join(' ')}" data-key="${key}" aria-label="${key}${mark ? ' practised' : ''}">${d}<span class="mark">${mark}</span></button>`);
  }
  $('#calendar').innerHTML = [...dows, ...cells].join('');
  $$('.cal-day').forEach((b) =>
    b.addEventListener('click', () => {
      selectedDay = b.dataset.key;
      renderCalendar();
      renderDayDetail();
    }),
  );
}
$('#calPrev').addEventListener('click', () => {
  calMonth.setMonth(calMonth.getMonth() - 1);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  calMonth.setMonth(calMonth.getMonth() + 1);
  renderCalendar();
});

function renderDayDetail() {
  const isToday = selectedDay === dateKey();
  const [y, m, d] = selectedDay.split('-').map(Number);
  $('#dayTitle').textContent = isToday ? 'Today' : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const day = tracker.state.days[selectedDay];
  const mins = Math.floor(tracker.secondsOn(selectedDay) / 60);
  const songs = Object.entries(day?.songs || {}).sort((a, b) => b[1] - a[1]);
  const list = songs.length
    ? `<ul class="day-songs">${songs
        .map(([id, n]) => {
          const pic = pictures.find((p) => p.id === id);
          const s = findSong(id) || (pic && { title: pic.title, emoji: picIcon(pic) });
          return `<li><span>${esc(s ? `${s.emoji || '🎵'} ${s.title}` : id)}</span><span>${n}×</span></li>`;
        })
        .join('')}</ul>`
    : `<p class="muted">${isToday ? 'No songs played yet today. Press ▶ Play on a song!' : 'No songs played this day.'}</p>`;
  $('#dayDetail').innerHTML = `<p><strong>${mins} minute${mins === 1 ? '' : 's'}</strong> of practice${tracker.goalMet(selectedDay) ? ' – goal reached ⭐' : ''}</p><h3>Songs practised</h3>${list}`;
}

function renderBadges() {
  const earned = tracker.state.badges;
  $('#badges').innerHTML = BADGES.map((b) => {
    const got = earned[b.id];
    return `<div class="badge${got ? '' : ' locked'}" title="${esc(b.desc)}">
      <span class="b-emoji" aria-hidden="true">${b.emoji}</span>
      <span class="b-name">${esc(b.name)}</span>
      <span class="b-desc">${got ? 'Earned ' + niceDate(got) : esc(b.desc)}</span>
    </div>`;
  }).join('');
}

function renderTracker() {
  $('#goalVal').textContent = tracker.state.goalMinutes;
  const streak = tracker.streak();
  $('#streakNum').textContent = streak;
  $('#streakText').textContent = streak === 1 ? 'day in a row' : 'days in a row';
  const t = tracker.totals();
  $('#totalsText').textContent = `${t.daysPractised} day${t.daysPractised === 1 ? '' : 's'} practised · ${t.minutes} min in total · ${tracker.state.mastered.length} song${tracker.state.mastered.length === 1 ? '' : 's'} mastered`;
  renderTimer();
  renderCalendar();
  renderDayDetail();
  renderBadges();
}

/* ---------------- Add my own song ---------------- */

let editingId = null;
let previewParsed = null;
const previewPlayer = new SongPlayer({
  onNote(idx) {
    $$('#preview .note.now').forEach((n) => n.classList.remove('now'));
    if (idx >= 0) $(`#preview .note[data-idx="${idx}"]`)?.classList.add('now');
  },
  onState(state) {
    $('#previewBtn').textContent = state === 'playing' ? '⏹ Stop' : '▶ Listen';
  },
});
previewPlayer.countIn = false;

function formSong() {
  return {
    title: $('#fTitle').value.trim(),
    emoji: $('#fEmoji').value.trim() || '🎵',
    key: $('#fKey').value,
    beatsPerBar: Number($('#fBeats').value),
    tempo: Math.max(40, Math.min(160, Number($('#fTempo').value) || 90)),
    notes: $('#fNotes').value.trim().replace(/\s+/g, ' '),
  };
}

function updatePreview() {
  previewPlayer.stop();
  const s = formSong();
  const msg = $('#formMsg');
  if (!s.notes) {
    $('#preview').innerHTML = '<p class="muted">Type some notes and they will appear here.</p>';
    msg.innerHTML = '';
    previewParsed = null;
    return;
  }
  previewParsed = parseTune(s.notes, s);
  renderNotation($('#preview'), previewParsed);
  $$('#preview .note').forEach((el) => el.setAttribute('tabindex', '-1'));
  if (previewParsed.errors.length) {
    msg.innerHTML = previewParsed.errors.slice(0, 3).map((e) => `<div class="err">⚠️ ${esc(e)}</div>`).join('');
  } else if (previewParsed.warnings.length) {
    msg.innerHTML = previewParsed.warnings.slice(0, 3).map((e) => `<div class="warn">💡 ${esc(e)}</div>`).join('');
  } else {
    msg.innerHTML = `<div class="ok">✅ ${previewParsed.notes.length} notes in ${previewParsed.bars.length} bars – looks good!</div>`;
  }
}
['#fNotes', '#fKey', '#fBeats', '#fTempo'].forEach((sel) => $(sel).addEventListener('input', updatePreview));

$('#previewBtn').addEventListener('click', () => {
  if (previewPlayer.state === 'playing') {
    previewPlayer.stop();
    return;
  }
  if (!previewParsed || !previewParsed.notes.length) {
    toast('Type some notes first 🎵');
    return;
  }
  previewPlayer.load(previewParsed, formSong());
  previewPlayer.play();
});

let formSource = null; // fingerprint of the uploaded file the form was filled from, if any
let formPart = null; // { index, count } when that file holds several pieces or movements
function resetForm() {
  editingId = null;
  formSource = null;
  formPart = null;
  $('#songForm').reset();
  $('#formTitle').textContent = 'Add my own song';
  $('#saveBtn').textContent = '💾 Save song';
  updatePreview();
}
$('#clearBtn').addEventListener('click', resetForm);

$('#songForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = formSong();
  if (!s.title) {
    toast('Give the song a name first');
    $('#fTitle').focus();
    return;
  }
  const parsed = parseTune(s.notes, s);
  if (parsed.errors.length || !parsed.notes.length) {
    toast('Fix the notes marked ⚠️ first');
    return;
  }
  if (editingId) {
    const i = customSongs.findIndex((x) => x.id === editingId);
    customSongs[i] = { ...customSongs[i], ...s };
  } else {
    // Remember which uploaded file a song came from, so uploading it again can offer the saved song.
    // For a file with several parts, also which part (1, 2, …) of how many, so the others can be offered.
    customSongs.push({
      id: `my-${Date.now().toString(36)}`,
      ...s,
      ...(formSource ? { sourceHash: formSource } : {}),
      ...(formSource && formPart ? { sourcePart: formPart.index + 1, sourceParts: formPart.count } : {}),
    });
  }
  saveCustomSongs();
  toast(`Saved "${s.title}"! Find it in Songs 🎵`);
  resetForm();
  renderMySongs();
  renderSongList();
});

function songJson(s) {
  const { id, title, emoji, key, beatsPerBar, tempo, notes } = s;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id;
  return JSON.stringify({ id: slug, title, emoji, key, beatsPerBar, tempo, level: 1, notes }, null, 2);
}

function renderMySongs() {
  const box = $('#mySongs');
  if (!customSongs.length) {
    box.innerHTML = '<p class="muted">Songs you save appear here. They are stored on this device.</p>';
    return;
  }
  box.innerHTML = customSongs
    .map(
      (s) => `<div class="my-song" data-id="${esc(s.id)}">
        <span class="name">${esc(s.emoji || '🎵')} ${esc(s.title)}</span>
        <button class="btn" type="button" data-act="open">▶ Open</button>
        <button class="btn" type="button" data-act="edit">✏️ Edit</button>
        <button class="btn" type="button" data-act="copy">📋 Copy JSON</button>
        <button class="btn" type="button" data-act="delete">🗑️</button>
      </div>`,
    )
    .join('');
  $$('.my-song', box).forEach((row) => {
    const s = customSongs.find((x) => x.id === row.dataset.id);
    $$('.btn', row).forEach((btn) =>
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'open') openSong(s.id);
        if (act === 'edit') {
          editingId = s.id;
          $('#fTitle').value = s.title;
          $('#fEmoji').value = s.emoji || '';
          $('#fKey').value = s.key;
          $('#fBeats').value = s.beatsPerBar;
          $('#fTempo').value = s.tempo;
          $('#fNotes').value = s.notes;
          $('#formTitle').textContent = `Edit "${s.title}"`;
          $('#saveBtn').textContent = '💾 Save changes';
          updatePreview();
          $('#songForm').scrollIntoView({ behavior: 'smooth' });
        }
        if (act === 'copy') {
          const json = songJson(s);
          try {
            await navigator.clipboard.writeText(json);
            toast('Copied! Paste it into songs.json to keep it forever.');
          } catch (e) {
            window.prompt('Copy this into songs.json:', json);
          }
        }
        if (act === 'delete' && window.confirm(`Delete "${s.title}"?`)) {
          customSongs = customSongs.filter((x) => x.id !== s.id);
          saveCustomSongs();
          if (editingId === s.id) resetForm();
          renderMySongs();
          renderSongList();
        }
      }),
    );
  });
}

/* ---------------- Uploaded sheet music ---------------- */

const picIcon = (p) => (p.type === 'pdf' ? '📄' : '🖼️');

function renderPictureList() {
  $('#pictureListWrap').hidden = !pictures.length;
  $('#pictureList').innerHTML = pictures
    .map(
      (p) => `<button class="song-card" type="button" data-id="${esc(p.id)}">
        <span class="emoji" aria-hidden="true">${picIcon(p)}</span>
        <span><span class="title">${esc(p.title)}</span><span class="meta">${p.type === 'pdf' ? 'PDF' : 'Photo'} · read along</span></span>
        <span></span>
      </button>`,
    )
    .join('');
  $$('#pictureList .song-card').forEach((c) => c.addEventListener('click', () => openPicture(c.dataset.id)));
}

function renderMyPictures() {
  const box = $('#myPictures');
  if (!pictures.length) {
    box.innerHTML = '<p class="muted">PDFs and photos you upload appear here. They are stored on this device.</p>';
    return;
  }
  box.innerHTML = pictures
    .map(
      (p) => `<div class="my-song" data-id="${esc(p.id)}">
        <span class="name">${picIcon(p)} ${esc(p.title)}</span>
        <button class="btn" type="button" data-act="open">👀 Open</button>
        <button class="btn" type="button" data-act="read">🎼 Read the notes</button>
        <button class="btn" type="button" data-act="rename">✏️ Rename</button>
        <button class="btn" type="button" data-act="delete" aria-label="Delete ${esc(p.title)}">🗑️</button>
      </div>`,
    )
    .join('');
  $$('.my-song', box).forEach((row) => {
    const p = pictures.find((x) => x.id === row.dataset.id);
    $$('.btn', row).forEach((btn) =>
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'open') openPicture(p.id);
        if (act === 'read') readSavedPicture(p.id);
        if (act === 'rename') {
          const title = window.prompt('New name for this sheet music:', p.title);
          if (title && title.trim()) {
            await renamePicture(p.id, title);
            await refreshPictures();
          }
        }
        if (act === 'delete' && window.confirm(`Delete "${p.title}"?`)) {
          await deletePicture(p.id);
          await refreshPictures();
        }
      }),
    );
  });
}

async function refreshPictures() {
  try {
    pictures = await listPictures();
  } catch (e) {
    pictures = [];
  }
  renderPictureList();
  renderMyPictures();
}

const ZOOMS = [0.6, 0.75, 1, 1.25, 1.5, 2, 2.5];

async function openPicture(id) {
  const meta = pictures.find((p) => p.id === id);
  if (!meta) return;
  if (current) closeSong();
  closePicture(false);
  $('#pictureTitle').textContent = `${picIcon(meta)} ${meta.title}`;
  $('#picturePages').textContent = 'Loading…';
  $('#songListView').hidden = true;
  $('#songView').hidden = true;
  $('#pictureView').hidden = false;
  showTab('songs');
  const shown = { id, viewer: null, zoom: 1 };
  pictureShown = shown;
  tracker.logSong(id);
  try {
    const sheet = await getPicture(id);
    if (!sheet) throw new Error('This sheet music is no longer on this device.');
    const viewer = await showPicture($('#pictureBox'), sheet);
    if (pictureShown !== shown) {
      viewer.destroy();
      return;
    }
    shown.viewer = viewer;
    $('#picturePages').textContent = viewer.pages === 1 ? '1 page' : `${viewer.pages} pages`;
  } catch (e) {
    if (pictureShown !== shown) return;
    $('#picturePages').textContent = '';
    $('#pictureBox').innerHTML = `<p class="card">⚠️ Couldn't open this file. ${esc(e.message || '')}</p>`;
  }
}

function closePicture(showList = true) {
  if (pictureShown) {
    pictureShown.viewer?.destroy();
    pictureShown = null;
    setMetroRunning(false);
  }
  $('#pictureView').hidden = true;
  $('#pictureBox').innerHTML = '';
  if (showList) {
    $('#songListView').hidden = false;
    renderSongList();
  }
}
$('#pictureBackBtn').addEventListener('click', () => closePicture());

function zoomPicture(step) {
  if (!pictureShown?.viewer) return;
  const i = ZOOMS.indexOf(pictureShown.zoom);
  const z = step === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + step))];
  pictureShown.zoom = z;
  pictureShown.viewer.redraw(z);
}
$('#zoomOut').addEventListener('click', () => zoomPicture(-1));
$('#zoomIn').addEventListener('click', () => zoomPicture(1));
$('#zoomFit').addEventListener('click', () => zoomPicture(0));
let pictureResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(pictureResizeTimer);
  pictureResizeTimer = setTimeout(() => pictureShown?.viewer?.redraw(), 200);
});

$('#miniMetroBtn').addEventListener('click', () => setMetroRunning(!metro.running));
holdRepeat($('#miniBpmDown'), -1);
holdRepeat($('#miniBpmUp'), 1);

function uploadMessage(html) {
  $('#uploadMsg').innerHTML = html;
}

// Puts an imported or recognised song into the Add Song form, with notes about what changed.
function fillFormFrom(song, warnings, intro, source = null) {
  showTab('add');
  resetForm();
  formSource = source;
  $('#fTitle').value = song.title;
  $('#fEmoji').value = song.emoji;
  $('#fKey').value = song.key;
  $('#fBeats').value = song.beatsPerBar;
  $('#fTempo').value = song.tempo;
  $('#fNotes').value = song.notes;
  updatePreview();
  const count = previewParsed ? previewParsed.notes.filter((n) => n.type === 'note').length : 0;
  uploadMessage(
    `<div class="ok">✅ ${intro(count)} Check them in the form below, press ▶ Listen, then 💾 Save song.</div>` +
      warnings.map((w) => `<div class="warn">💡 ${esc(w)}</div>`).join(''),
  );
  $('#songForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Reads the notes from a PDF or photo (js/omr.js), and fills the form if it worked. A file with
// several pieces or movements gets a button for each, to put that one in the form instead.
// `part` (0, 1, …) picks which one goes in the form first.
// `pictureRead` keeps the sheet being read (title, fingerprint, a note to show under the result,
// and its parts, just one for a single piece) so a part button can put another part in the form.
let pictureRead = null;
async function readPictureNotes(file, title, hash, part = 0, extraNote = '') {
  const { readSheetMusic } = await import('./omr.js');
  const { song, warnings, parts } = await readSheetMusic(file, title);
  pictureRead = { title, hash, extraNote, parts: parts || [{ song, warnings }] };
  showPicturePart(parts && parts[part] ? part : 0);
}
function showPicturePart(index) {
  const { title, hash, extraNote, parts } = pictureRead;
  const { song, warnings } = parts[index];
  fillFormFrom(song, warnings, (count) => `Read ${count} notes from the sheet "${esc(title)}".`, hash);
  if (parts.length > 1) {
    formPart = { index, count: parts.length };
    $('#uploadMsg').insertAdjacentHTML(
      'beforeend',
      `<div class="player-row upload-actions" role="group" aria-label="Parts of this file">` +
        parts
          .map((p, k) => `<button class="btn${k === index ? ' primary' : ''}" type="button" data-upload-act="part" data-part="${k}" aria-pressed="${k === index}">🎼 ${esc(p.label)}</button>`)
          .join('') +
        `</div>`,
    );
  }
  if (extraNote) $('#uploadMsg').insertAdjacentHTML('beforeend', `<div class="warn">${extraNote}</div>`);
}

// The same file (by content, whatever its name) was turned into songs before: offer those songs
// instead of reading it again. `again(part)` reads it anyway, putting that part (0, 1, …) in the
// form. A file with several parts also gets a button for each part not saved yet.
let readAgain = null;
function offerSavedSong(songs, note, again) {
  showTab('add');
  readAgain = again;
  const count = Math.max(0, ...songs.map((s) => s.sourceParts || 0));
  const saved = new Set(songs.map((s) => s.sourcePart));
  const missing = [];
  for (let k = 1; k <= count; k++) if (!saved.has(k)) missing.push(k);
  const ordered = [...songs].sort((a, b) => (a.sourcePart || 0) - (b.sourcePart || 0));
  const name = (s) => `${esc(s.emoji || '🎵')} ${esc(s.title)}`;
  const intro =
    songs.length === 1
      ? `✅ You already made a song from this file: <b>${name(songs[0])}</b>.`
      : `✅ You already made ${songs.length} songs from this file.`;
  const left = missing.length
    ? `<div class="warn">🎼 This file has ${count} parts. Not saved yet: part ${missing.join(', ')}.</div>`
    : '';
  uploadMessage(
    `<div class="ok">${intro}</div>` +
      left +
      (note ? `<div class="warn">${note}</div>` : '') +
      `<div class="player-row upload-actions">` +
      ordered
        .map((s, i) => `<button class="btn${i === 0 && !missing.length ? ' primary' : ''}" type="button" data-upload-act="open" data-id="${esc(s.id)}">▶ ${songs.length === 1 ? 'Open it' : s.sourcePart ? `Open part ${s.sourcePart}` : `Open ${name(s)}`}</button>`)
        .join('') +
      missing
        .map((k, i) => `<button class="btn${i === 0 ? ' primary' : ''}" type="button" data-upload-act="again" data-part="${k - 1}">🎼 Read part ${k}</button>`)
        .join('') +
      (missing.length ? '' : `<button class="btn" type="button" data-upload-act="again">🎼 Read the notes again</button>`) +
      `</div>`,
  );
  $('#uploadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#uploadMsg').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-upload-act]');
  if (!btn) return;
  if (btn.dataset.uploadAct === 'open') openSong(btn.dataset.id);
  if (btn.dataset.uploadAct === 'part' && pictureRead) {
    const k = Number(btn.dataset.part);
    if (pictureRead.parts[k]) showPicturePart(k);
  }
  if (btn.dataset.uploadAct === 'again' && readAgain && !uploading) {
    const again = readAgain;
    readAgain = null;
    uploading = true;
    uploadMessage('<div>⏳ Reading the music…</div>');
    try {
      await again(Number(btn.dataset.part) || 0);
    } finally {
      uploading = false;
    }
  }
});

const readFailedHelp = `<div class="warn">💡 Clear, computer-made sheet music reads best. A MusicXML copy (Export → MusicXML in most notation apps) always works.</div>`;

// Reads a PDF/photo's notes into the form; on failure explains, and says whether the sheet is saved.
async function readPictureOrExplain(file, saved, extraNote, part = 0) {
  try {
    await readPictureNotes(file, saved?.title || titleFromFileName(file.name), saved?.hash, part, extraNote);
  } catch (e) {
    uploadMessage(
      `<div class="err">⚠️ Couldn't read the notes: ${esc(e.message || 'something went wrong.')}</div>` +
        (saved
          ? `<div class="ok">✅ The sheet is saved, so you can still read along with it: 🎵 Songs → <b>My sheet music</b>.</div>`
          : '<div class="err">⚠️ The file couldn\'t be saved either. Storage may be full.</div>') +
        readFailedHelp,
    );
  }
}

let uploading = false;
async function handleUpload(file) {
  if (!file || uploading) return;
  const kind = fileKind(file.name) || (file.type.startsWith('image/') || file.type === 'application/pdf' ? 'picture' : null);
  if (!kind) {
    uploadMessage(`<div class="err">⚠️ "${esc(file.name)}" isn't a file I can use. Upload MusicXML (.musicxml, .mxl), ABC (.abc), a PDF or a photo.</div>`);
    return;
  }
  uploading = true;
  readAgain = null;
  uploadMessage('<div>⏳ Reading the music… (a few seconds for a PDF or photo)</div>');
  try {
    // The same file can come back under another name: recognise it by its contents.
    const hash = await fingerprint(file);
    const madeSongs = customSongs.filter((x) => x.sourceHash === hash);

    if (kind === 'picture') {
      // Keep one copy of the original to read along with.
      let saved = null;
      let alreadySaved = false;
      try {
        saved = await findPictureByHash(hash);
        alreadySaved = !!saved;
        if (!saved) {
          saved = await addPicture(file, hash);
          await refreshPictures();
        }
      } catch (e) {
        /* still try to read the notes */
      }
      const keptNote = !saved
        ? ''
        : alreadySaved
          ? `📄 This sheet is already saved as "<b>${esc(saved.title)}</b>" in 🎵 Songs → My sheet music, so it wasn't saved twice.`
          : '📄 The original is saved too: find it in 🎵 Songs under <b>My sheet music</b>.';
      if (madeSongs.length) {
        offerSavedSong(madeSongs, keptNote, (part) => readPictureOrExplain(file, saved, keptNote, part));
        return;
      }
      await readPictureOrExplain(file, saved, keptNote);
      return;
    }

    const importIt = async () => {
      try {
        const { song, warnings } = await importScoreFile(file);
        fillFormFrom(song, warnings, (count) => `Read ${count} notes from "${esc(file.name)}".`, hash);
      } catch (e) {
        uploadMessage(`<div class="err">⚠️ ${esc(e.message || "Couldn't read this file.")}</div>`);
      }
    };
    if (madeSongs.length) {
      offerSavedSong(madeSongs, '', importIt);
      return;
    }
    await importIt();
  } finally {
    uploading = false;
  }
}

// "Read the notes" on a sheet that was saved earlier.
async function readSavedPicture(id) {
  const sheet = await getPicture(id);
  if (!sheet || uploading) return;
  uploading = true;
  readAgain = null;
  const file = new File([sheet.blob], sheet.type === 'pdf' ? `${sheet.title}.pdf` : sheet.title, { type: sheet.blob.type || (sheet.type === 'pdf' ? 'application/pdf' : 'image/png') });
  try {
    if (pictureShown) closePicture();
    const hash = sheet.hash || (await fingerprint(sheet.blob));
    const saved = { id: sheet.id, title: sheet.title, type: sheet.type, added: sheet.added, hash };
    const madeSongs = customSongs.filter((x) => x.sourceHash === hash);
    if (madeSongs.length) {
      offerSavedSong(madeSongs, '', (part) => readPictureOrExplain(file, saved, undefined, part));
      return;
    }
    toast('⏳ Reading the notes…');
    showTab('add');
    await readPictureOrExplain(file, saved);
    $('#uploadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    uploading = false;
  }
}
$('#readNotesBtn').addEventListener('click', () => pictureShown && readSavedPicture(pictureShown.id));

$('#uploadInput').addEventListener('change', (e) => {
  handleUpload(e.target.files[0]);
  e.target.value = '';
});
const dropZone = $('#dropZone');
['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, () => dropZone.classList.remove('over')));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  handleUpload(e.dataTransfer.files[0]);
});

/* ---------------- Start up ---------------- */

// Browsers only allow sound after the first tap. Use that first tap to load the violin
// recordings, so they're ready by the time Play is pressed.
document.addEventListener('pointerdown', () => audio(), { once: true, capture: true });

async function init() {
  setBpm(80);
  applyView();
  renderDots();
  renderTracker();
  renderMySongs();
  updatePreview();
  try {
    const res = await fetch('songs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    builtInSongs = (await res.json()).songs || [];
  } catch (e) {
    $('#songList').insertAdjacentHTML(
      'beforebegin',
      '<p class="card">⚠️ Could not load <code>songs.json</code>. If you opened the file directly, run a small web server instead (see the README).</p>',
    );
  }
  renderSongList();
  await refreshPictures();
  renderDayDetail();
  if (tracker.running)
 keepAwake(true);
  celebrate(tracker.checkBadges());
}

init();
