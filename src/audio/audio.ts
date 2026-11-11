/** All sound is synthesised with the Web Audio API; there are no audio files. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private noise!: AudioBuffer;
  enabled = true;

  /** Must be called from a user gesture (a menu click) before any sound can play. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.6 : 0;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    const skid = ctx.createBufferSource();
    skid.buffer = this.noise;
    skid.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 3;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(bp).connect(this.skidGain).connect(this.master);
    skid.start();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v ? 0.6 : 0, this.ctx.currentTime, 0.05);
  }

  /** Continuous sounds, called every frame. `running` is false in menus and pause. */
  drive(speed: number, throttle: number, skid: number, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Fake gearbox: revs climb within each gear, then drop.
    const gear = Math.min(4, Math.floor(speed / 9));
    const rev = (speed - gear * 9) / 9;
    const f = 55 + gear * 9 + rev * 55 + throttle * 8;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(380 + f * 4 + throttle * 500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(running ? 0.1 + throttle * 0.1 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(running ? Math.min(0.28, skid) : 0, t, 0.06);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  play(name: 'cash' | 'pickup' | 'tip' | 'fail' | 'crash' | 'horn' | 'land', strength = 1) {
    switch (name) {
      case 'cash':
        this.tone(988, 0.12, 'triangle', 0.35);
        this.tone(1319, 0.3, 'triangle', 0.35, 0.1);
        break;
      case 'pickup':
        this.tone(523, 0.1, 'triangle', 0.3);
        this.tone(784, 0.18, 'triangle', 0.3, 0.09);
        break;
      case 'tip':
        this.tone(1568, 0.09, 'sine', 0.22);
        break;
      case 'fail':
        this.tone(300, 0.4, 'sawtooth', 0.22, 0, -180);
        break;
      case 'crash':
        this.burst(0.35, Math.min(0.9, 0.25 + strength * 0.04), 900);
        this.tone(90, 0.2, 'square', 0.25, 0, -50);
        break;
      case 'land':
        this.burst(0.18, 0.4, 400);
        break;
      case 'horn':
        this.tone(415, 0.35, 'square', 0.14);
        this.tone(523, 0.35, 'square', 0.14);
        break;
    }
  }
}
