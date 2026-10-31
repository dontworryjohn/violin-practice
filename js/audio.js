// Web Audio: a warm violin-like voice, a click, the song player and the metronome.

let ctx = null;
let master = null;
let reverbSend = null;

export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);

    // A small "room" so the violin doesn't sound dry.
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 1.8, 3.2);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.25;
    reverbSend.connect(conv);
    conv.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function makeImpulse(c, seconds, decay) {
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function peaking(c, freq, gain, q) {
  const f = c.createBiquadFilter();
  f.type = 'peaking';
  f.frequency.value = freq;
  f.gain.value = gain;
  f.Q.value = q;
  return f;
}

// Plays one bowed note. Returns a handle with stop() so playback can be cut short.
export function violinNote(midi, when, duration) {
  const c = audio();
  const freq = midiToFreq(midi);
  const attack = Math.min(0.08, duration * 0.35);
  const endTime = when + Math.max(duration, attack + 0.03);

  const voice = c.createGain();
  voice.gain.setValueAtTime(0.0001, when);
  voice.gain.linearRampToValueAtTime(0.24, when + attack);
  voice.gain.setTargetAtTime(0.17, when + attack, 0.12);
  voice.gain.setTargetAtTime(0.0001, endTime, 0.05);

  // Bowed-string body: sawtooth oscillators shaped by violin-body resonances.
  const mix = c.createGain();
  mix.gain.value = 0.33;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 190;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(5200, freq * 7);
  lp.Q.value = 0.6;
  const body1 = peaking(c, 480, 5, 1.4);
  const body2 = peaking(c, 1200, -3, 1.0);
  const body3 = peaking(c, 2900, 4, 1.6);
  mix.connect(hp).connect(body1).connect(body2).connect(body3).connect(lp).connect(voice);
  voice.connect(master);
  voice.connect(reverbSend);

  // Gentle vibrato that fades in after the note starts, like a real player.
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.6;
  const lfoDepth = c.createGain();
  lfoDepth.gain.setValueAtTime(0, when);
  lfoDepth.gain.linearRampToValueAtTime(0, when + 0.18);
  lfoDepth.gain.linearRampToValueAtTime(14, when + 0.5);
  lfo.connect(lfoDepth);

  const oscs = [-6, 0, 7].map((detune) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = detune;
    lfoDepth.connect(o.detune);
    o.connect(mix);
    return o;
  });
  const all = [...oscs, lfo];
  const stopAt = endTime + 0.4;
  all.forEach((o) => {
    o.start(when);
    o.stop(stopAt);
  });

  const handle = {
    onended: null,
    stop() {
      const now = c.currentTime;
      voice.gain.cancelScheduledValues(now);
      voice.gain.setTargetAtTime(0.0001, now, 0.02);
      all.forEach((o) => {
        try {
          o.stop(now + 0.1);
        } catch (e) {
          /* already stopped */
        }
      });
    },
  };
  oscs[0].onended = () => {
    voice.disconnect();
    if (handle.onended) handle.onended();
  };
  return handle;
}

// A short wooden "tock" for the metronome and count-in.
export function click(when, accent = false) {
  const c = audio();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.value = accent ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + 0.1);
}

const LOOKAHEAD = 0.2; // seconds of audio scheduled ahead of time
const INTERVAL = 25; // ms between scheduler runs

export class SongPlayer {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.notes = [];
    this.voices = new Set();
    this.queue = [];
    this.state = 'stopped';
    this.loop = false;
    this.countIn = true;
    this.speed = 1;
    this.tempo = 90;
    this.beatsPerBar = 4;
    this.pos = 0;
    this.startIdx = 0;
    this.endIdx = -1;
    this.tick = this.tick.bind(this);
  }

  load(parsed, { tempo = 90, beatsPerBar = 4 } = {}) {
    this.stop();
    this.parsed = parsed;
    this.notes = parsed.notes;
    this.tempo = tempo;
    this.beatsPerBar = beatsPerBar;
    this.setRange(0, parsed.bars.length - 1);
    this.pos = this.startIdx;
  }

  setRange(fromBar, toBar) {
    const bars = this.parsed ? this.parsed.bars : [];
    if (!bars.length) return;
    fromBar = Math.max(0, Math.min(fromBar, bars.length - 1));
    toBar = Math.max(fromBar, Math.min(toBar, bars.length - 1));
    this.range = [fromBar, toBar];
    this.startIdx = bars[fromBar][0].index;
    this.endIdx = bars[toBar][bars[toBar].length - 1].index;
    if (this.pos < this.startIdx || this.pos > this.endIdx) this.pos = this.startIdx;
  }

  get secondsPerBeat() {
    return 60 / (this.tempo * this.speed);
  }

  play() {
    if (!this.notes.length || this.state === 'playing') return;
    const c = audio();
    if (this.pos < this.startIdx || this.pos > this.endIdx) this.pos = this.startIdx;
    let t = c.currentTime + 0.12;
    this.queue = [];
    if (this.countIn) {
      const spb = this.secondsPerBeat;
      for (let i = 0; i < this.beatsPerBar; i++) {
        click(t + i * spb, i === 0);
        this.queue.push({ time: t + i * spb, count: i + 1 });
      }
      t += this.beatsPerBar * spb;
    }
    this.nextTime = t;
    this.nextIdx = this.pos;
    this.endTime = null;
    this.state = 'playing';
    this.schedule();
    this.timer = setInterval(() => this.schedule(), INTERVAL);
    this.raf = requestAnimationFrame(this.tick);
    this.cb.onState?.('playing');
  }

  schedule() {
    const c = audio();
    while (this.endTime === null && this.nextTime < c.currentTime + LOOKAHEAD) {
      const n = this.notes[this.nextIdx];
      const dur = n.beats * this.secondsPerBeat;
      if (n.type === 'note') {
        const v = violinNote(n.midi, this.nextTime, dur * 0.9);
        this.voices.add(v);
        v.onended = () => this.voices.delete(v);
      }
      this.queue.push({ time: this.nextTime, idx: this.nextIdx });
      this.nextTime += dur;
      this.nextIdx++;
      if (this.nextIdx > this.endIdx) {
        if (this.loop) this.nextIdx = this.startIdx;
        else this.endTime = this.nextTime;
      }
    }
  }

  tick() {
    const now = audio().currentTime;
    while (this.queue.length && this.queue[0].time <= now) {
      const q = this.queue.shift();
      if (q.idx !== undefined) {
        this.pos = q.idx;
        this.cb.onNote?.(q.idx);
      } else {
        this.cb.onCount?.(q.count, this.beatsPerBar);
      }
    }
    if (this.endTime !== null && now >= this.endTime) {
      this.stop();
      this.cb.onEnd?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  halt() {
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.voices.forEach((v) => v.stop());
    this.voices.clear();
    this.queue = [];
  }

  pause() {
    if (this.state !== 'playing') return;
    this.halt();
    this.state = 'paused';
    this.cb.onState?.('paused');
  }

  stop() {
    const wasActive = this.state !== 'stopped';
    this.halt();
    this.state = 'stopped';
    this.pos = this.startIdx;
    if (wasActive) {
      this.cb.onNote?.(-1);
      this.cb.onState?.('stopped');
    }
  }
}

export class Metronome {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.bpm = 80;
    this.beatsPerBar = 4;
    this.accent = true;
    this.running = false;
    this.queue = [];
    this.tick = this.tick.bind(this);
  }

  setBeats(n) {
    this.beatsPerBar = n;
    this.beat = 0;
  }

  start() {
    if (this.running) return;
    const c = audio();
    this.running = true;
    this.beat = 0;
    this.nextTime = c.currentTime + 0.08;
    this.queue = [];
    this.schedule();
    this.timer = setInterval(() => this.schedule(), INTERVAL);
    this.raf = requestAnimationFrame(this.tick);
  }

  schedule() {
    const c = audio();
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      const beat = this.beat % this.beatsPerBar;
      click(this.nextTime, this.accent && beat === 0);
      this.queue.push({ time: this.nextTime, beat });
      this.nextTime += 60 / this.bpm;
      this.beat = beat + 1;
    }
  }

  tick() {
    const now = audio().currentTime;
    while (this.queue.length && this.queue[0].time <= now) {
      const q = this.queue.shift();
      this.cb.onBeat?.(q.beat, this.beatsPerBar);
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.queue = [];
  }
}
