/** Gentle, self-contained procedural score. Audio is unlocked only by a user gesture. */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.muted = false;
    this.volume = 0.65;
    this.nextBeat = 0;
    this.beat = 0;
    this.intensity = 0;
    this.lastFx = Object.create(null);
    this.noise = null;
  }
  init() {
    try {
      if (!this.ctx) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return;
        this.ctx = new Context();
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.fxBus = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.musicBus.gain.value = 0.36;
        this.fxBus.gain.value = 0.7;
        this.musicBus.connect(this.master);
        this.fxBus.connect(this.master);
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.ratio.value = 3;
        this.master.connect(compressor);
        compressor.connect(this.ctx.destination);
        this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < data.length; i++) {
          brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
          data[i] = brown * 5;
        }
        this.nextBeat = this.ctx.currentTime + 0.08;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* Unsupported or policy-blocked audio never prevents play. */ }
  }
  setMuted(value) {
    this.muted = Boolean(value);
    this.applyVolume();
  }
  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, Number(value) || 0));
    this.applyVolume();
  }
  applyVolume() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }
  tone(freq, duration, volume, type = 'sine', time, destination, endFreq) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = time ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(destination || this.fxBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  wash(duration = 0.2, volume = 0.05, frequency = 1400) {
    if (!this.ctx || !this.noise || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.fxBus);
    source.start(now, Math.random() * Math.max(0, 1 - duration));
    source.stop(now + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  sfx(name) {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted) return;
    const now = this.ctx.currentTime;
    const gap = { shoot: 0.1, hit: 0.075, pickup: 0.09, hurt: 0.22 }[name] || 0.04;
    if (now - (this.lastFx[name] ?? -99) < gap) return;
    this.lastFx[name] = now;
    switch (name) {
      case 'shoot': this.tone(370, 0.07, 0.018, 'triangle', now, null, 160); break;
      case 'hit': this.tone(180, 0.085, 0.026, 'triangle', now, null, 80); break;
      case 'hurt': this.wash(0.23, 0.16, 700); this.tone(110, 0.23, 0.09, 'triangle', now, null, 55); break;
      case 'dash': this.wash(0.23, 0.1, 1800); this.tone(260, 0.17, 0.035, 'sine', now, null, 520); break;
      case 'pulse': this.tone(100, 0.6, 0.13, 'sine', now, null, 430); this.tone(300, 0.7, 0.07, 'triangle', now + 0.03, null, 600); this.wash(0.4, 0.08, 2000); break;
      case 'pickup': this.tone(740, 0.13, 0.025, 'sine', now, null, 990); break;
      case 'click': this.tone(540, 0.09, 0.04, 'sine'); break;
      case 'upgrade': [440, 554.37, 659.25, 880].forEach((f, i) => this.tone(f, 0.6, 0.065, 'sine', now + i * 0.1)); break;
      case 'beacon': [293.66, 440, 587.33, 739.99].forEach((f, i) => this.tone(f, 1.25, 0.065, 'sine', now + i * 0.17)); break;
      case 'win': [293.66, 369.99, 440, 587.33, 739.99, 880, 1174.66].forEach((f, i) => this.tone(f, 1.6, 0.075, 'sine', now + i * 0.19)); break;
      case 'lose': [392, 329.63, 293.66, 220].forEach((f, i) => this.tone(f, 1.1, 0.065, 'sine', now + i * 0.24)); break;
      default: break;
    }
  }
  update(dt, intensity = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.intensity += (Math.max(0, Math.min(1, intensity)) - this.intensity) * Math.min(1, dt * 2);
    const now = this.ctx.currentTime;
    if (this.nextBeat < now - 0.3) this.nextBeat = now + 0.04;
    const sequence = [0, 7, 12, 7, 4, 7, 14, 12, 2, 7, 11, 7, 4, 9, 12, 7, 0, 7, 16, 12, 4, 7, 14, 12, 2, 9, 14, 11, 4, 7, 12, 7];
    while (this.nextBeat < now + 0.14) {
      const n = this.beat % sequence.length;
      const chordRoot = [146.832, 130.813, 164.814, 110][Math.floor(this.beat / 16) % 4];
      const freq = chordRoot * 2 ** (sequence[n] / 12 + 1);
      if (!this.muted) {
        this.tone(freq, 1.1, n % 4 === 0 ? 0.065 : 0.04, 'sine', this.nextBeat, this.musicBus);
        if (n % 4 === 0) {
          this.tone(chordRoot / 2, 1.8, 0.105, 'sine', this.nextBeat, this.musicBus);
          this.tone(chordRoot * 1.5, 2.2, 0.025, 'triangle', this.nextBeat, this.musicBus);
        }
        if (this.intensity > 0.45 && n % 2 === 0) {
          this.tone(70, 0.17, 0.05 * this.intensity, 'sine', this.nextBeat, this.musicBus, 32);
        }
      }
      this.beat++;
      this.nextBeat += 0.36 - this.intensity * 0.055;
    }
  }
}
