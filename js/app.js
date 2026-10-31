import { parseTune, KEYS } from './notation.js';
import { SongPlayer, Metronome, violinNote, audio } from './audio.js';
import { Tracker, BADGES, dateKey } from './tracker.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CUSTOM_KEY = 'violinPractice.customSongs.v1';
const SLOW_SPEED = 0.6;

const tracker = new Tracker();
let builtInSongs = [];
let customSongs = loadCustomSongs();
let current = null; // { song, parsed, noteEls }
let loggedThisPlay = false;

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

let lastNow = null;
const player = new SongPlayer({
  onNote(idx) {
    if (!current) return;
    if (lastNow) lastNow.classList.remove('now');
    lastNow = idx >= 0 ? current.noteEls[idx] : null;
    if (!lastNow) return;
    lastNow.classList.add('now');
    const r = lastNow.getBoundingClientRect();
    const barH = $('.player-bar').getBoundingClientRect().height;
    if (r.top < 90 || r.bottom > window.innerHeight - barH - 10) {
      lastNow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  },
  onCount(n, total) {
    const el = $('#countIn');
    el.hidden = false;
    el.innerHTML = `<span>${n}</span>`;
    if (n === total) setTimeout(() => (el.hidden = true), (60 / (player.tempo * player.speed)) * 900);
  },
  onState(state) {
    $('#playBtn').textContent = state === 'playing' ? '⏸ Pause' : '▶ Play';
    if (state !== 'playing') $('#countIn').hidden = true;
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
  current = { song, parsed, noteEls, barEls };
  lastNow = null;
  player.load(parsed, song);
  fillBarSelects(parsed.bars.length);
  $('#songTitle').textContent = `${song.emoji || '🎵'} ${song.title}`;
  $('#songKey').textContent = KEYS[song.key] || song.key;
  updateTempoLabel();
  updateMasterBtn();
  updateRangeHighlight();
  $('#songListView').hidden = true;
  $('#songView').hidden = false;
  showTab('songs');
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

$('#metroStart').addEventListener('click', () => {
  if (metro.running) {
    metro.stop();
    $$('.dot').forEach((d) => d.classList.remove('on'));
  } else {
    metro.start();
  }
  $('#metroStart').textContent = metro.running ? '⏹ Stop' : '▶ Start';
});

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
          const s = findSong(id);
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

function resetForm() {
  editingId = null;
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
    customSongs.push({ id: `my-${Date.now().toString(36)}`, ...s });
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

/* ---------------- Start up ---------------- */

async function init() {
  setBpm(80);
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
  renderDayDetail();
  if (tracker.running) keepAwake(true);
  celebrate(tracker.checkBadges());
}

init();
