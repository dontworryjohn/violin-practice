// Practice tracker: timer, daily goal, streaks, songs practised and badges.
// Everything is saved in this browser's localStorage.

const STORAGE_KEY = 'violinPractice.progress.v1';
const MAX_SESSION_SECONDS = 4 * 60 * 60; // ignore a timer accidentally left running all day
export const PRACTISED_SECONDS = 60; // a day counts once you've practised at least a minute

export const BADGES = [
  { id: 'first-practice', emoji: '🎻', name: 'First Practice', desc: 'Practise for the first time' },
  { id: 'goal', emoji: '🎯', name: 'Goal Getter', desc: 'Reach your daily goal' },
  { id: 'streak-3', emoji: '🔥', name: '3-Day Streak', desc: 'Practise 3 days in a row' },
  { id: 'streak-7', emoji: '🌟', name: '7-Day Streak', desc: 'Practise 7 days in a row' },
  { id: 'first-mastered', emoji: '🏆', name: 'First Song Mastered', desc: 'Master your first song' },
  { id: 'five-mastered', emoji: '📚', name: 'Song Collector', desc: 'Master 5 songs' },
  { id: 'streak-30', emoji: '🦸', name: 'Practice Hero', desc: 'Practise 30 days in a row' },
];

export function dateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaults() {
  return { goalMinutes: 15, days: {}, mastered: [], badges: {}, timerStart: null };
}

export class Tracker {
  constructor() {
    this.state = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaults(), ...JSON.parse(raw) };
    } catch (e) {
      /* storage unavailable or corrupt: start fresh */
    }
    return defaults();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      /* private mode etc. – the app still works for this visit */
    }
  }

  day(key) {
    if (!this.state.days[key]) this.state.days[key] = { seconds: 0, songs: {} };
    return this.state.days[key];
  }

  get goalSeconds() {
    return this.state.goalMinutes * 60;
  }

  setGoal(minutes) {
    this.state.goalMinutes = Math.max(5, Math.min(120, minutes));
    this.save();
  }

  get running() {
    return this.state.timerStart !== null;
  }

  liveSeconds() {
    if (!this.running) return 0;
    return Math.min(MAX_SESSION_SECONDS, Math.max(0, (Date.now() - this.state.timerStart) / 1000));
  }

  start() {
    if (this.running) return;
    this.state.timerStart = Date.now();
    this.save();
  }

  // Stops the timer, adds the time to the day it started on, and returns any new badges.
  stop() {
    if (!this.running) return [];
    const seconds = Math.round(this.liveSeconds());
    this.day(dateKey(new Date(this.state.timerStart))).seconds += seconds;
    this.state.timerStart = null;
    this.save();
    return this.checkBadges();
  }

  secondsOn(key) {
    const stored = this.state.days[key]?.seconds || 0;
    return key === dateKey() ? stored + this.liveSeconds() : stored;
  }

  isPractised(key) {
    return (this.state.days[key]?.seconds || 0) >= PRACTISED_SECONDS;
  }

  goalMet(key) {
    return (this.state.days[key]?.seconds || 0) >= this.goalSeconds;
  }

  logSong(id) {
    const d = this.day(dateKey());
    d.songs[id] = (d.songs[id] || 0) + 1;
    this.save();
  }

  isMastered(id) {
    return this.state.mastered.includes(id);
  }

  toggleMastered(id) {
    const m = this.state.mastered;
    if (m.includes(id)) m.splice(m.indexOf(id), 1);
    else m.push(id);
    this.save();
    return this.checkBadges();
  }

  // Days in a row, counting back from today (or from yesterday if today isn't done yet).
  streak() {
    const d = new Date();
    if (!this.isPractised(dateKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (this.isPractised(dateKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  totals() {
    const days = Object.entries(this.state.days);
    return {
      minutes: Math.round(days.reduce((s, [, d]) => s + d.seconds, 0) / 60),
      daysPractised: days.filter(([k]) => this.isPractised(k)).length,
    };
  }

  checkBadges() {
    const streak = this.streak();
    const keys = Object.keys(this.state.days);
    const earned = {
      'first-practice': keys.some((k) => this.isPractised(k)),
      goal: keys.some((k) => this.goalMet(k)),
      'streak-3': streak >= 3,
      'streak-7': streak >= 7,
      'streak-30': streak >= 30,
      'first-mastered': this.state.mastered.length >= 1,
      'five-mastered': this.state.mastered.length >= 5,
    };
    const fresh = [];
    for (const badge of BADGES) {
      if (earned[badge.id] && !this.state.badges[badge.id]) {
        this.state.badges[badge.id] = dateKey();
        fresh.push(badge);
      }
    }
    if (fresh.length) this.save();
    return fresh;
  }
}
