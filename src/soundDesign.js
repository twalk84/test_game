// Enhanced sound design — layered synthesis with noise, filters, envelopes

export class SoundDesigner {
  constructor(getAudioCtx, getMasterGain, isMuted) {
    this._getCtx = getAudioCtx;
    this._getGain = getMasterGain;
    this._isMuted = isMuted;
    this.footstepTimer = 0;
    this.footstepLeft = true;
    this.combatMusicIntensity = 0;
  }

  _ctx() { return this._getCtx(); }
  _gain() { return this._getGain(); }

  // ---- Noise buffer (shared) ----
  _noiseBuffer = null;
  _getNoiseBuffer() {
    const ctx = this._ctx();
    if (!ctx) return null;
    if (this._noiseBuffer) return this._noiseBuffer;
    const length = ctx.sampleRate * 0.5;
    this._noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return this._noiseBuffer;
  }

  // ---- Layered weapon fire ----
  playWeaponFire(weaponId) {
    if (this._isMuted()) return;
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    // Noise burst (impact body)
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this._getNoiseBuffer();
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";

    const configs = {
      rifle: { freq: 1200, dur: 0.06, vol: 0.04 },
      shotgun: { freq: 600, dur: 0.12, vol: 0.06 },
      pulse: { freq: 2400, dur: 0.04, vol: 0.03 },
      sniper: { freq: 800, dur: 0.15, vol: 0.05 },
      grenade: { freq: 300, dur: 0.2, vol: 0.06 },
    };
    const c = configs[weaponId] || configs.rifle;

    noiseFilter.frequency.value = c.freq;
    noiseFilter.Q.value = 2;
    noiseGain.gain.setValueAtTime(c.vol, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + c.dur);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + c.dur);

    // Tonal body (oscillator)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(c.freq * 0.3, now);
    osc.frequency.exponentialRampToValueAtTime(c.freq * 0.1, now + c.dur);
    oscGain.gain.setValueAtTime(c.vol * 0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + c.dur * 0.8);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(now);
    osc.stop(now + c.dur);
  }

  // ---- Explosion (grenade, boss slam) ----
  playExplosion() {
    if (this._isMuted()) return;
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this._getNoiseBuffer();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.4);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + 0.5);

    // Sub bass thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(60, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    subGain.gain.setValueAtTime(0.15, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    sub.connect(subGain);
    subGain.connect(master);
    sub.start(now);
    sub.stop(now + 0.35);
  }

  // ---- Thunder ----
  playThunder() {
    if (this._isMuted()) return;
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this._getNoiseBuffer();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 1.2);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + 1.5);
  }

  // ---- Footsteps ----
  playFootstep() {
    if (this._isMuted()) return;
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const freq = this.footstepLeft ? 80 : 90;
    this.footstepLeft = !this.footstepLeft;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this._getNoiseBuffer();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq * 3;
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + 0.08);
  }

  // ---- Rain ambient loop ----
  _rainNode = null;
  _rainGain = null;
  setRainIntensity(intensity) {
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;

    if (intensity > 0 && !this._rainNode) {
      this._rainNode = ctx.createBufferSource();
      this._rainNode.buffer = this._getNoiseBuffer();
      this._rainNode.loop = true;
      this._rainGain = ctx.createGain();
      this._rainGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 3000;
      filter.Q.value = 0.5;
      this._rainNode.connect(filter);
      filter.connect(this._rainGain);
      this._rainGain.connect(master);
      this._rainNode.start();
    }

    if (this._rainGain) {
      this._rainGain.gain.value = intensity * 0.06;
    }

    if (intensity <= 0 && this._rainNode) {
      try { this._rainNode.stop(); } catch { /* */ }
      this._rainNode = null;
      this._rainGain = null;
    }
  }

  // ---- Ambient wind ----
  _windNode = null;
  _windGain = null;
  setWindIntensity(intensity) {
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;

    if (intensity > 0 && !this._windNode) {
      this._windNode = ctx.createBufferSource();
      this._windNode.buffer = this._getNoiseBuffer();
      this._windNode.loop = true;
      this._windGain = ctx.createGain();
      this._windGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 400;
      this._windNode.connect(filter);
      filter.connect(this._windGain);
      this._windGain.connect(master);
      this._windNode.start();
    }

    if (this._windGain) {
      this._windGain.gain.value = intensity * 0.04;
    }

    if (intensity <= 0 && this._windNode) {
      try { this._windNode.stop(); } catch { /* */ }
      this._windNode = null;
      this._windGain = null;
    }
  }

  // ---- Procedural ambient music (slow arpeggios) ----
  _musicTimer = 0;
  _musicNoteIndex = 0;
  _minorScale = [220, 261.6, 293.7, 329.6, 349.2, 392, 440]; // A minor
  updateMusic(dt, inCombat) {
    if (this._isMuted()) return;
    const targetIntensity = inCombat ? 1.0 : 0.3;
    this.combatMusicIntensity += (targetIntensity - this.combatMusicIntensity) * dt * 2;
    const interval = inCombat ? 0.25 : 0.8;

    this._musicTimer -= dt;
    if (this._musicTimer <= 0) {
      this._musicTimer = interval;
      this._playMusicNote();
    }
  }

  _playMusicNote() {
    const ctx = this._ctx();
    const master = this._gain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const freq = this._minorScale[this._musicNoteIndex % this._minorScale.length];
    this._musicNoteIndex++;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq * (0.5 + this.combatMusicIntensity * 0.5);
    const vol = 0.015 + this.combatMusicIntensity * 0.01;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  updateFootsteps(dt, isMoving, isSprinting) {
    if (!isMoving) {
      this.footstepTimer = 0;
      return;
    }
    const interval = isSprinting ? 0.28 : 0.42;
    this.footstepTimer += dt;
    if (this.footstepTimer >= interval) {
      this.footstepTimer -= interval;
      this.playFootstep();
    }
  }
}
