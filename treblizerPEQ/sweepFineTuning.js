// Copyright 2025 : Pragmatic Audio

/**
 * Sweep-Based Fine Tuning Module for Treblizer PEQ
 *
 * Provides precision tuning methods for targeting specific frequencies:
 * - 3-Tone PEQ: Cycles through lower/center/upper bounds
 * - MicroSweep: Smooth sweep within filter bandwidth
 * - 2-Tone Reference: Alternates between reference and test frequencies
 *
 * These methods complement the ERB-based broad tuning by allowing
 * surgical corrections to specific problem frequencies.
 */

// Constants for microsweep timing
export const MS_PAUSE_SEC = 1.0;    // Pause duration at endpoints
export const MS_FADE_SEC = 0.005;   // Fade in/out duration

// Constants for warble modulation
export const WARBLE_RATE_HZ = 5;    // LFO frequency
export const WARBLE_DEPTH = 0.07;   // ±7% modulation depth

// Constants for 2-tone reference
export const REF_CYCLE_MS = 1000;   // 1 second per phase
export const REF_LEVEL = 0.15;      // Reference level

/**
 * Calculate step size in Hz based on percentage of sweep band
 * @param {number} percent - Percentage (0-100)
 * @param {number} sweepFStart - Start frequency
 * @param {number} sweepFEnd - End frequency
 * @returns {number} Half-span in Hz
 */
export function calculateStepHz(percent, sweepFStart, sweepFEnd) {
  const band = Math.max(1, sweepFEnd - sweepFStart);
  return (band * (percent / 100)) / 2;
}

/**
 * Calculate frequency bounds around center
 * @param {number} fc - Center frequency
 * @param {number} halfHz - Half-span in Hz
 * @param {number} sweepFStart - Start frequency
 * @param {number} sweepFEnd - End frequency
 * @returns {{fLo: number, fHi: number}} Lower and upper bounds
 */
export function calculatePercentBounds(fc, halfHz, sweepFStart, sweepFEnd) {
  let fLo = fc - halfHz;
  let fHi = fc + halfHz;
  fLo = Math.max(fLo, sweepFStart);
  fHi = Math.min(fHi, sweepFEnd);
  return { fLo, fHi };
}

/**
 * Convert octave bandwidth to Q factor
 * @param {number} bwOct - Bandwidth in octaves
 * @returns {number} Q factor
 */
export function octaveBWToQ(bwOct) {
  // Q = 1 / (2 * sinh(ln(2)/2 * BW))
  // Approximation: Q ≈ 1.41 / BW for small BW
  const sinh_arg = (Math.log(2) / 2) * bwOct;
  const sinh_val = Math.sinh(sinh_arg);
  return 1 / (2 * sinh_val);
}

/**
 * Create pink noise buffer using Paul Kellett's algorithm
 * @param {AudioContext} audioCtx
 * @returns {AudioBuffer}
 */
function createPinkNoiseBuffer(audioCtx) {
  if (!audioCtx) return null;
  const bufferSize = audioCtx.sampleRate * 2; // 2 seconds
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  return buffer;
}

/**
 * Sweep Fine Tuning Controller
 * Handles 3-tone and microsweep modes
 */
export class SweepFineTuningController {
  constructor(audioCtx, outPreGain, config) {
    this.audioCtx = audioCtx;
    this.outPreGain = outPreGain;
    this.config = config; // biquadMagQ, sweepFStart, sweepFEnd, etc.

    // UI callbacks
    this.ui = {
      showHUD: config.showHUD || (() => {}),
      hideHUD: config.hideHUD || (() => {}),
      drawGraph: config.drawGraph || (() => {}),
      updateButtons: config.updateButtons || (() => {}),
      getPercentBounds: config.getPercentBounds,
      octaveBWToQ: config.octaveBWToQ
    };

    // Audio nodes
    this.toneOscA = null;
    this.toneOscB = null;
    this.toneOscC = null;
    this.toneGainA = null;
    this.toneGainB = null;
    this.toneGainC = null;
    this.toneInterval = null;
    this.current3ToneFreq = null; // Currently playing 3-tone frequency

    // MicroSweep state
    this.msOsc = null;
    this.msGain = null;
    this.msActive = false;
    this.msRAF = null;
    this.msPhase = 0;
    this.msDir = 1;
    this.msLastTs = 0;
    this.msHold = 0;

    this.active = false;
  }

  /**
   * Check if any sweep mode is active
   */
  isActive() {
    return this.active || this.msActive;
  }

  /**
   * Get current microsweep frequency (for visualization)
   */
  getMicroSweepFreq() {
    if (!this.msActive || !this.msOsc) return null;
    return this.msOsc.frequency.value;
  }

  /**
   * Check if microsweep is holding at endpoint
   */
  isMicroSweepHolding() {
    return this.msHold > 0;
  }

  /**
   * Get current 3-tone frequency (for visualization)
   */
  get3ToneFreq() {
    if (!this.active) return null;
    return this.current3ToneFreq;
  }

  /**
   * Check if 3-tone mode is active
   */
  is3ToneActive() {
    return this.active && this.toneInterval !== null;
  }

  /**
   * Start 3-Tone mode
   */
  start3Tone() {
    this.stopAll();

    const { toneCenter, toneQ, toneGain, getPercentBounds } = this.config;

    // Debug logging
    if (!toneCenter || !toneQ || !toneGain) {
      console.error('3-Tone: DOM elements not found', {
        toneCenter: !!toneCenter,
        toneQ: !!toneQ,
        toneGain: !!toneGain
      });
      return;
    }

    const fc = Number(toneCenter.value);
    const Q = Number(toneQ.value);
    const g = Number(toneGain.value);

    // Validate inputs
    if (!isFinite(fc) || !isFinite(Q) || !isFinite(g)) {
      console.error('3-Tone: Invalid parameters', {
        fc, Q, g,
        toneCenterValue: toneCenter.value,
        toneQValue: toneQ.value,
        toneGainValue: toneGain.value
      });
      return;
    }

    const { fLo, fHi } = getPercentBounds(fc);

    // Validate frequency bounds
    if (!isFinite(fLo) || !isFinite(fHi) || fLo <= 0 || fHi <= 0) {
      console.error('3-Tone: Invalid frequency bounds', { fLo, fHi });
      return;
    }

    // Create oscillators and gain nodes
    this.toneOscA = this.audioCtx.createOscillator();
    this.toneOscB = this.audioCtx.createOscillator();
    this.toneOscC = this.audioCtx.createOscillator();
    this.toneGainA = this.audioCtx.createGain();
    this.toneGainB = this.audioCtx.createGain();
    this.toneGainC = this.audioCtx.createGain();

    this.toneOscA.type = 'sine';
    this.toneOscB.type = 'sine';
    this.toneOscC.type = 'sine';

    this.toneOscA.frequency.value = fLo;
    this.toneOscB.frequency.value = fc;
    this.toneOscC.frequency.value = fHi;

    const { biquadMagQ } = this.config;
    const magA = biquadMagQ(fc, g, Q, fLo);
    const magB = biquadMagQ(fc, g, Q, fc);
    const magC = biquadMagQ(fc, g, Q, fHi);

    // Validate magnitude responses
    if (!isFinite(magA) || !isFinite(magB) || !isFinite(magC)) {
      console.error('3-Tone: Invalid magnitude response', { magA, magB, magC });
      return;
    }

    const gainA = 0.15 * Math.pow(10, (g + magA) / 20);
    const gainB = 0.15 * Math.pow(10, (g + magB) / 20);
    const gainC = 0.15 * Math.pow(10, (g + magC) / 20);

    // Final validation of gain values
    if (!isFinite(gainA) || !isFinite(gainB) || !isFinite(gainC)) {
      console.error('3-Tone: Invalid gain values', { gainA, gainB, gainC });
      return;
    }

    this.toneGainA.gain.value = 0;
    this.toneGainB.gain.value = 0;
    this.toneGainC.gain.value = 0;

    this.toneOscA.connect(this.toneGainA).connect(this.outPreGain);
    this.toneOscB.connect(this.toneGainB).connect(this.outPreGain);
    this.toneOscC.connect(this.toneGainC).connect(this.outPreGain);

    this.toneOscA.start();
    this.toneOscB.start();
    this.toneOscC.start();

    // Cycle through tones
    let phase = 0;
    const cycle = () => {
      this.toneGainA.gain.value = phase === 0 ? gainA : 0;
      this.toneGainB.gain.value = phase === 1 ? gainB : 0;
      this.toneGainC.gain.value = phase === 2 ? gainC : 0;

      const freqs = [fLo, fc, fHi];
      const labels = ['A', 'B', 'C'];
      this.current3ToneFreq = freqs[phase];
      this.ui.showHUD(labels[phase], freqs[phase]);

      // Update visualization
      if (this.ui.drawGraph) this.ui.drawGraph();

      phase = (phase + 1) % 3;
    };

    cycle();
    this.toneInterval = setInterval(cycle, 1000);
    this.active = true;

    if (this.ui.updateButtons) this.ui.updateButtons(true);
  }

  /**
   * Start MicroSweep mode
   */
  startMicroSweep() {
    this.stopAll();

    const { toneCenter, toneQ, toneGain, getPercentBounds, microSweepDuration } = this.config;
    const fc = Number(toneCenter.value);
    const Q = Number(toneQ.value);
    const g = Number(toneGain.value);
    const { fLo, fHi } = getPercentBounds(fc);

    this.msOsc = this.audioCtx.createOscillator();
    this.msGain = this.audioCtx.createGain();

    this.msOsc.type = 'sine';
    this.msOsc.frequency.value = fLo;

    const { biquadMagQ } = this.config;
    const gainLin = 0.15 * Math.pow(10, (g + biquadMagQ(fc, g, Q, fLo)) / 20);
    this.msGain.gain.value = gainLin;

    this.msOsc.connect(this.msGain).connect(this.outPreGain);
    this.msOsc.start();

    this.msActive = true;
    this.msPhase = 0;
    this.msDir = 1;
    this.msLastTs = performance.now();
    this.msHold = 0;

    const halfCycleSec = Number(microSweepDuration.value);

    const sweep = (ts) => {
      if (!this.msActive) return;

      const dt = (ts - this.msLastTs) / 1000;
      this.msLastTs = ts;

      if (this.msHold > 0) {
        this.msHold -= dt;
        if (this.msHold <= 0) {
          this.msHold = 0;
          this.msDir *= -1;
          this.msPhase = this.msDir > 0 ? 0 : 1;
        }
      } else {
        this.msPhase += (this.msDir * dt) / halfCycleSec;

        if (this.msPhase >= 1) {
          this.msPhase = 1;
          this.msHold = MS_PAUSE_SEC;
        } else if (this.msPhase <= 0) {
          this.msPhase = 0;
          this.msHold = MS_PAUSE_SEC;
        }
      }

      const freq = fLo + (fHi - fLo) * this.msPhase;
      this.msOsc.frequency.value = freq;

      const currentGain = 0.15 * Math.pow(10, (g + biquadMagQ(fc, g, Q, freq)) / 20);
      this.msGain.gain.value = currentGain;

      this.ui.showHUD('Sweep', Math.round(freq));
      if (this.ui.drawGraph) this.ui.drawGraph();

      this.msRAF = requestAnimationFrame(sweep);
    };

    this.msRAF = requestAnimationFrame(sweep);

    if (this.ui.updateButtons) this.ui.updateButtons(true);
  }

  /**
   * Stop all sweep modes
   */
  stopAll() {
    // Stop 3-tone
    if (this.toneInterval) {
      clearInterval(this.toneInterval);
      this.toneInterval = null;
    }

    if (this.toneOscA) { try { this.toneOscA.stop(); } catch(_) {} this.toneOscA = null; }
    if (this.toneOscB) { try { this.toneOscB.stop(); } catch(_) {} this.toneOscB = null; }
    if (this.toneOscC) { try { this.toneOscC.stop(); } catch(_) {} this.toneOscC = null; }
    this.toneGainA = null;
    this.toneGainB = null;
    this.toneGainC = null;
    this.current3ToneFreq = null;

    // Stop microsweep
    if (this.msRAF) {
      cancelAnimationFrame(this.msRAF);
      this.msRAF = null;
    }

    if (this.msOsc) { try { this.msOsc.stop(); } catch(_) {} this.msOsc = null; }
    this.msGain = null;
    this.msActive = false;
    this.msPhase = 0;
    this.msDir = 1;
    this.msHold = 0;

    this.active = false;

    if (this.ui.hideHUD) this.ui.hideHUD();
    if (this.ui.updateButtons) this.ui.updateButtons(false);
    if (this.ui.drawGraph) this.ui.drawGraph();
  }
}

/**
 * 2-Tone Reference Controller
 * Handles Narrow Band (noise) and Warble modes
 */
export class TwoToneReferenceController {
  constructor(audioCtx, outPreGain, config) {
    this.audioCtx = audioCtx;
    this.outPreGain = outPreGain;
    this.config = config;

    // UI callbacks
    this.ui = {
      showHUD: config.showHUD || (() => {}),
      hideHUD: config.hideHUD || (() => {}),
      drawGraph: config.drawGraph || (() => {}),
      updateButtons: config.updateButtons || (() => {}),
      getPercentBounds: config.getPercentBounds,
      octaveBWToQ: config.octaveBWToQ,
      biquadMagQ: config.biquadMagQ
    };

    // Audio nodes
    this.refGain = null;
    this.testGain = null;
    this.refBandpass = null;
    this.testBandpass = null;
    this.refNoiseSource = null;
    this.testNoiseSource = null;
    this.refWarbleOsc = null;
    this.refWarbleLFO = null;
    this.refWarbleDepth = null;
    this.testWarbleOsc = null;
    this.testWarbleLFO = null;
    this.testWarbleDepth = null;

    // State
    this.active = false;
    this.interval = null;
    this.currentRefFreq = null;
    this.subtype = 'noise'; // 'noise' or 'warble'
    this.noiseBuffer = null;
  }

  /**
   * Check if 2-tone reference is active
   */
  isActive() {
    return this.active;
  }

  /**
   * Get current reference frequency (for visualization)
   */
  getCurrentRefFreq() {
    return this.currentRefFreq;
  }

  /**
   * Start 2-tone reference mode
   * @param {string} subtype - 'noise' or 'warble'
   */
  start(subtype = 'noise') {
    this.stop();

    this.subtype = subtype;
    const { toneCenter, toneQ, toneGain, refFreq, noiseBW, getPercentBounds, octaveBWToQ, biquadMagQ, sweepFStart, sweepFEnd } = this.config;

    const fc = Number(toneCenter.value);
    const Q = Number(toneQ.value);
    const g = Number(toneGain.value);
    const refF = Number(refFreq.value);
    const bwOct = Number(noiseBW.value);

    // Calculate test frequency (center of micro range)
    const { fLo, fHi } = getPercentBounds(fc);
    const testF = (fLo + fHi) / 2;

    if (subtype === 'noise') {
      // Create pink noise buffer if needed
      if (!this.noiseBuffer) {
        this.noiseBuffer = createPinkNoiseBuffer(this.audioCtx);
      }

      // Reference path: noise source -> bandpass -> gain -> output
      this.refNoiseSource = this.audioCtx.createBufferSource();
      this.refNoiseSource.buffer = this.noiseBuffer;
      this.refNoiseSource.loop = true;

      this.refBandpass = this.audioCtx.createBiquadFilter();
      this.refBandpass.type = 'bandpass';
      this.refBandpass.frequency.value = refF;
      this.refBandpass.Q.value = octaveBWToQ(bwOct);

      this.refGain = this.audioCtx.createGain();
      this.refGain.gain.value = REF_LEVEL;

      this.refNoiseSource.connect(this.refBandpass);
      this.refBandpass.connect(this.refGain);
      this.refGain.connect(this.outPreGain);

      this.refNoiseSource.start();

      // Test path: noise source -> bandpass -> gain -> output
      this.testNoiseSource = this.audioCtx.createBufferSource();
      this.testNoiseSource.buffer = this.noiseBuffer;
      this.testNoiseSource.loop = true;

      this.testBandpass = this.audioCtx.createBiquadFilter();
      this.testBandpass.type = 'bandpass';
      this.testBandpass.frequency.value = testF;
      this.testBandpass.Q.value = octaveBWToQ(bwOct);

      this.testGain = this.audioCtx.createGain();
      const testGainVal = REF_LEVEL * Math.pow(10, biquadMagQ(fc, g, Q, testF) / 20);
      this.testGain.gain.value = testGainVal;

      this.testNoiseSource.connect(this.testBandpass);
      this.testBandpass.connect(this.testGain);
      this.testGain.connect(this.outPreGain);

      this.testNoiseSource.start();

    } else {
      // Warble mode
      // Reference warble oscillator
      this.refWarbleOsc = this.audioCtx.createOscillator();
      this.refWarbleLFO = this.audioCtx.createOscillator();
      this.refWarbleDepth = this.audioCtx.createGain();

      this.refWarbleOsc.type = 'sine';
      this.refWarbleLFO.type = 'sine';

      this.refWarbleLFO.frequency.value = WARBLE_RATE_HZ;
      this.refWarbleDepth.gain.value = refF * WARBLE_DEPTH;

      this.refWarbleLFO.connect(this.refWarbleDepth);
      this.refWarbleDepth.connect(this.refWarbleOsc.frequency);
      this.refWarbleOsc.frequency.value = refF;

      this.refGain = this.audioCtx.createGain();
      this.refGain.gain.value = REF_LEVEL;

      this.refWarbleOsc.connect(this.refGain);
      this.refGain.connect(this.outPreGain);

      this.refWarbleOsc.start();
      this.refWarbleLFO.start();

      // Test warble oscillator
      this.testWarbleOsc = this.audioCtx.createOscillator();
      this.testWarbleLFO = this.audioCtx.createOscillator();
      this.testWarbleDepth = this.audioCtx.createGain();

      this.testWarbleOsc.type = 'sine';
      this.testWarbleLFO.type = 'sine';

      this.testWarbleLFO.frequency.value = WARBLE_RATE_HZ;
      this.testWarbleDepth.gain.value = testF * WARBLE_DEPTH;

      this.testWarbleLFO.connect(this.testWarbleDepth);
      this.testWarbleDepth.connect(this.testWarbleOsc.frequency);
      this.testWarbleOsc.frequency.value = testF;

      this.testGain = this.audioCtx.createGain();
      const testGainVal = REF_LEVEL * Math.pow(10, biquadMagQ(fc, g, Q, testF) / 20);
      this.testGain.gain.value = testGainVal;

      this.testWarbleOsc.connect(this.testGain);
      this.testGain.connect(this.outPreGain);

      this.testWarbleOsc.start();
      this.testWarbleLFO.start();
    }

    // Start alternating cycle
    let phase = 0; // 0 = reference, 1 = test
    const cycle = () => {
      if (phase === 0) {
        // Play reference
        this.refGain.gain.value = REF_LEVEL;
        this.testGain.gain.value = 0;
        this.currentRefFreq = refF;
        this.ui.showHUD('Ref', Math.round(refF));
      } else {
        // Play test
        this.refGain.gain.value = 0;
        const testGainVal = REF_LEVEL * Math.pow(10, this.ui.biquadMagQ(fc, g, Q, testF) / 20);
        this.testGain.gain.value = testGainVal;
        this.currentRefFreq = testF;
        this.ui.showHUD('Test', Math.round(testF));
      }

      if (this.ui.drawGraph) this.ui.drawGraph();
      phase = 1 - phase;
    };

    cycle();
    this.interval = setInterval(cycle, REF_CYCLE_MS);
    this.active = true;

    if (this.ui.updateButtons) this.ui.updateButtons(true);
  }

  /**
   * Stop 2-tone reference mode
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Stop noise sources
    if (this.refNoiseSource) { try { this.refNoiseSource.stop(); } catch(_) {} this.refNoiseSource = null; }
    if (this.testNoiseSource) { try { this.testNoiseSource.stop(); } catch(_) {} this.testNoiseSource = null; }

    // Stop warble oscillators
    if (this.refWarbleOsc) { try { this.refWarbleOsc.stop(); } catch(_) {} this.refWarbleOsc = null; }
    if (this.refWarbleLFO) { try { this.refWarbleLFO.stop(); } catch(_) {} this.refWarbleLFO = null; }
    if (this.testWarbleOsc) { try { this.testWarbleOsc.stop(); } catch(_) {} this.testWarbleOsc = null; }
    if (this.testWarbleLFO) { try { this.testWarbleLFO.stop(); } catch(_) {} this.testWarbleLFO = null; }

    // Clear gains and filters
    this.refGain = null;
    this.testGain = null;
    this.refBandpass = null;
    this.testBandpass = null;
    this.refWarbleDepth = null;
    this.testWarbleDepth = null;

    this.active = false;
    this.currentRefFreq = null;

    if (this.ui.hideHUD) this.ui.hideHUD();
    if (this.ui.updateButtons) this.ui.updateButtons(false);
    if (this.ui.drawGraph) this.ui.drawGraph();
  }
}

/**
 * Simplified information about PEQ Sweep method for user interface
 */
export const SWEEP_INFO = {
  title: "PEQ Sweep-Based Fine Tuning",

  summary: `Precision targeting of specific frequencies. Best used after ERB adjustments.`,

  details: `**Methods:**
• 3-Tone: Cycles through lower/center/upper bounds
• MicroSweep: Smooth sweep within filter bandwidth
• Warble: FM-modulated tone
• Narrow Band: 2-tone reference comparison

**Use for:**
- Targeting specific resonances
- Fine-tuning individual bands
- Surgical corrections

⚠ Caution: May over-compensate for your own ear resonances. Narrow adjustments may not transfer across recordings.`
};
