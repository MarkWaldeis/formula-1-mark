/**
 * Web Audio API F1 V6 Turbo Hybrid Engine Sound Synthesizer
 * Provides realistic engine sounds with RPM, gear shifts, turbo whine and throttle response.
 */

export class F1AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isPlaying = false;
    this.isMuted = true;
    
    // Oscillators and nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.subOsc = null;
    this.turboOsc = null;
    this.filter = null;
    this.engineGain = null;
    this.turboGain = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.4, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      
      // Main V6 engine fundamental tone (Sawtooth for raw harmonic richness)
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.setValueAtTime(110, this.ctx.currentTime);
      
      // Harmonic octave
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.setValueAtTime(220, this.ctx.currentTime);
      
      // Deep exhaust rumble
      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = 'sawtooth';
      this.subOsc.frequency.setValueAtTime(55, this.ctx.currentTime);
      
      // Turbo charger high-frequency whine
      this.turboOsc = this.ctx.createOscillator();
      this.turboOsc.type = 'sine';
      this.turboOsc.frequency.setValueAtTime(1200, this.ctx.currentTime);

      // Low-pass filter simulating engine bay acoustic damping
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(1800, this.ctx.currentTime);
      this.filter.Q.setValueAtTime(2.5, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.35, this.ctx.currentTime);

      this.turboGain = this.ctx.createGain();
      this.turboGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      // Route graph
      this.engineOsc1.connect(this.engineGain);
      this.engineOsc2.connect(this.engineGain);
      this.subOsc.connect(this.engineGain);
      this.engineGain.connect(this.filter);
      this.filter.connect(this.masterGain);

      this.turboOsc.connect(this.turboGain);
      this.turboGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.subOsc.start();
      this.turboOsc.start();
      this.isPlaying = true;
    } catch (e) {
      console.warn("Web Audio initialization error:", e);
    }
  }

  toggleMute() {
    if (!this.ctx) {
      this.init();
      this.isMuted = false;
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      }
      return !this.isMuted;
    }
    
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    
    this.isMuted = !this.isMuted;
    const targetGain = this.isMuted ? 0 : 0.4;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
    }
    return !this.isMuted;
  }

  update(speedKmh, rpm = 8000, gear = 4, isBraking = false) {
    if (!this.ctx || this.isMuted || !this.isPlaying) return;

    const t = this.ctx.currentTime;
    // Map RPM (3000 - 13000) to fundamental engine frequencies
    const baseFreq = 70 + (rpm / 13000) * 190;
    
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.04);
    this.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.04);
    
    // Turbo whine pitch tracks speed & throttle
    const turboFreq = 800 + (speedKmh / 350) * 2200;
    this.turboOsc.frequency.setTargetAtTime(turboFreq, t, 0.08);

    // Filter opens with speed
    const cutoff = isBraking ? 1200 : (1600 + (speedKmh / 350) * 2500);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.05);
  }
}
