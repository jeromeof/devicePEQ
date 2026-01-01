// Copyright 2025 : Pragmatic Audio

/**
 * ERB-Based Tuning Module
 *
 * Implements Equivalent Rectangular Bandwidth (ERB) based treble tuning.
 * Uses narrow-band pink noise in psychoacoustically-motivated frequency bands
 * to allow for natural, perception-aligned adjustments without targeting
 * individual ear resonances.
 *
 * Key Concept:
 * The ear integrates energy across frequency bands (not narrow tones).
 * ERB models the effective bandwidth of human auditory filters.
 * This method avoids "EQing out one's own hearing" by using broad bands.
 */

// ERB Bands - four overlapping regions covering the treble range
// Each band targets specific perceptual qualities
export const ERB_BANDS = [
  { name: 'Lower Presence', fLow: 4500, fHigh: 7000, centerFreq: 5500, function: 'Body of presence', color: '#FF6B6B' },
  { name: 'Upper Presence', fLow: 6000, fHigh: 8500, centerFreq: 6800, function: 'Sibilance control', color: '#FFA500' },
  { name: 'Brilliance', fLow: 8000, fHigh: 12000, centerFreq: 9500, function: 'Sharpness / glare', color: '#4ECDC4' },
  { name: 'Air', fLow: 12000, fHigh: 20000, centerFreq: 14000, function: 'Openness', color: '#95E1D3' }
];

/**
 * Calculate ERB (Equivalent Rectangular Bandwidth) for a given frequency
 * ERB(f) = 24.7 * (4.37 * f/1000 + 1) Hz
 * This approximates the cochlear filter bandwidth at moderate listening levels
 * @param {number} freq - Frequency in Hz
 * @returns {number} ERB bandwidth in Hz
 */
export function calculateERB(freq) {
  return 24.7 * (4.37 * freq / 1000 + 1);
}

/**
 * Create pink noise buffer using Paul Kellett's refined algorithm
 * Pink noise has equal energy per octave, making it psychoacoustically
 * more relevant than white noise for audio work
 * @param {AudioContext} audioCtx - Web Audio API context
 * @returns {AudioBuffer} 2-second pink noise buffer
 */
export function createPinkNoiseBuffer(audioCtx) {
  if (!audioCtx) return null;
  const bufferSize = audioCtx.sampleRate * 2; // 2 seconds of noise
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);

  // Paul Kellett's refined pink noise algorithm
  let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    output[i] = pink * 0.11; // Reduce amplitude
    b6 = white * 0.115926;
  }
  return buffer;
}

/**
 * ERB Tuning Controller
 * Manages the ERB-based tuning interface and audio playback
 */
export class ERBTuningController {
  constructor(audioCtx, outPreGain, ui) {
    this.audioCtx = audioCtx;
    this.outPreGain = outPreGain;
    this.ui = ui; // UI callbacks: { showHUD, hideHUD, drawGraph, updateButtons }

    this.active = false;
    this.bandNodes = []; // Array of {source, bandpass, gain} for each band
    this.bandLevels = [0, 0, 0, 0]; // dB adjustments for each band
    this.noiseBuffer = null; // Shared pink noise buffer
    this.alternateInterval = null; // Interval for alternating playback
    this.currentBandIndex = -1; // Currently playing band (-1 = reference, 0-3 = bands)
    this.selectedBand = 0; // Which band is being adjusted (0-3)
    this.referenceBand = -1; // Which band to use as reference (-1 = 900Hz, 0-3 = ERB bands)
    this.refNodes = null; // Reference band nodes
  }

  /**
   * Set which band to use as reference for comparison
   * @param {number} bandIndex - Band index (-1 for 900Hz, 0-3 for ERB bands)
   */
  setReferenceBand(bandIndex) {
    this.referenceBand = bandIndex;
  }

  /**
   * Get current band level adjustments
   * @returns {number[]} Array of dB values for each band
   */
  getLevels() {
    return [...this.bandLevels];
  }

  /**
   * Set band level adjustments
   * @param {number[]} levels - Array of dB values for each band
   */
  setLevels(levels) {
    if (Array.isArray(levels) && levels.length === 4) {
      this.bandLevels = [...levels];

      // Update gain nodes if currently playing
      if (this.active) {
        this.bandNodes.forEach((nodes, idx) => {
          if (nodes && nodes.gain) {
            const gainLin = Math.pow(10, this.bandLevels[idx] / 20);
            nodes.gain.gain.value = gainLin * 0.15;
          }
        });
      }
    }
  }

  /**
   * Set which band is currently being adjusted (for alternating playback)
   */
  setSelectedBand(bandIndex) {
    this.selectedBand = Math.max(0, Math.min(3, bandIndex));
  }

  /**
   * Create audio nodes for a specific band or reference
   */
  _createBandNodes(bandIndex, isReference = false) {
    if (!this.noiseBuffer) {
      this.noiseBuffer = createPinkNoiseBuffer(this.audioCtx);
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const bandpass = this.audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';

    let centerFreq, bandwidth, gainLevel;

    if (isReference && this.referenceBand === -1) {
      // 900Hz midrange reference
      centerFreq = 900;
      bandwidth = 200; // ~800-1000 Hz
      gainLevel = 0.15; // Reference level
    } else {
      // ERB band (either selected or reference)
      const targetBand = isReference ? this.referenceBand : bandIndex;
      const band = ERB_BANDS[targetBand];
      centerFreq = Math.sqrt(band.fLow * band.fHigh);
      bandwidth = band.fHigh - band.fLow;
      // Use the band's gain level (0 for reference bands unless adjusted)
      const gainLin = Math.pow(10, this.bandLevels[targetBand] / 20);
      gainLevel = gainLin * 0.15;
    }

    bandpass.frequency.value = centerFreq;
    const Q = centerFreq / bandwidth;
    bandpass.Q.value = Math.max(0.5, Math.min(Q, 10));

    const gain = this.audioCtx.createGain();
    gain.gain.value = gainLevel;

    source.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.outPreGain);

    source.start();

    return { source, bandpass, gain };
  }

  /**
   * Switch to playing a specific band or reference
   */
  _switchToBand(bandIndex) {
    // Stop current nodes
    if (this.currentBandIndex === -1 && this.refNodes) {
      try { this.refNodes.source.stop(); } catch(_) {}
      this.refNodes = null;
    } else if (this.currentBandIndex >= 0 && this.bandNodes[this.currentBandIndex]) {
      try { this.bandNodes[this.currentBandIndex].source.stop(); } catch(_) {}
      this.bandNodes[this.currentBandIndex] = null;
    }

    // Start new band
    this.currentBandIndex = bandIndex;
    if (bandIndex === -1) {
      // Playing reference
      this.refNodes = this._createBandNodes(-1, true);
      let refLabel = 'REFERENCE: Neutral Midrange (900 Hz)';
      if (this.referenceBand >= 0) {
        refLabel = `REFERENCE: ${ERB_BANDS[this.referenceBand].name}`;
      }
      if (this.ui.showHUD) this.ui.showHUD(refLabel, null);
    } else {
      // Playing selected band
      this.bandNodes[bandIndex] = this._createBandNodes(bandIndex, false);
      const bandName = ERB_BANDS[bandIndex].name;
      const gainText = this.bandLevels[bandIndex].toFixed(1);
      const comparison = this.bandLevels[bandIndex] > 0 ? 'LOUDER than ref' : this.bandLevels[bandIndex] < 0 ? 'QUIETER than ref' : 'SAME as ref';
      if (this.ui.showHUD) this.ui.showHUD(`${bandName} (${gainText} dB) — ${comparison}`, null);
    }

    // Update visualization to show current band
    if (this.ui.drawGraph) this.ui.drawGraph();
  }

  /**
   * Start ERB band playback with alternating reference
   * Alternates between 900Hz reference and the selected band
   */
  start() {
    this.stop();

    this.active = true;

    // Start with reference
    this._switchToBand(-1);

    // Alternate every 2 seconds between reference and selected band
    this.alternateInterval = setInterval(() => {
      if (this.currentBandIndex === -1) {
        // Switch from reference to selected band
        this._switchToBand(this.selectedBand);
      } else {
        // Switch from band to reference
        this._switchToBand(-1);
      }
    }, 2000);

    // Update UI
    if (this.ui.updateButtons) this.ui.updateButtons(true);
    if (this.ui.drawGraph) this.ui.drawGraph();
  }

  /**
   * Stop ERB band playback and clean up audio nodes
   */
  stop() {
    this.active = false;

    // Stop alternating interval
    if (this.alternateInterval) {
      clearInterval(this.alternateInterval);
      this.alternateInterval = null;
    }

    // Stop and clean up reference nodes
    if (this.refNodes) {
      try { this.refNodes.source.stop(); } catch(_) {}
      this.refNodes = null;
    }

    // Stop and clean up all band nodes
    this.bandNodes.forEach(nodes => {
      if (nodes && nodes.source) {
        try { nodes.source.stop(); } catch(_) {}
      }
    });
    this.bandNodes = [];
    this.currentBandIndex = -1;

    // Update UI
    if (this.ui.hideHUD) this.ui.hideHUD();
    if (this.ui.updateButtons) this.ui.updateButtons(false);
    if (this.ui.drawGraph) this.ui.drawGraph();
  }

  /**
   * Check if ERB bands are currently active
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }

  /**
   * Get currently playing band index
   * @returns {number} -1 for reference, 0-3 for ERB bands, null if not active
   */
  getCurrentBandIndex() {
    return this.active ? this.currentBandIndex : null;
  }

  /**
   * Get reference band index
   * @returns {number} -1 for 900Hz, 0-3 for ERB bands
   */
  getReferenceBand() {
    return this.referenceBand;
  }

  /**
   * Get info about adjusted bands for saving to PEQ filters
   * @returns {Array} Array of {bandIndex, name, centerFreq, Q, gain}
   */
  getAdjustedBands() {
    const adjusted = [];

    ERB_BANDS.forEach((band, idx) => {
      const level = this.bandLevels[idx];
      if (Math.abs(level) > 0.1) { // Only include bands with significant adjustment
        const centerFreq = Math.sqrt(band.fLow * band.fHigh);
        const bandwidth = band.fHigh - band.fLow;
        const Q = centerFreq / bandwidth;

        adjusted.push({
          bandIndex: idx,
          name: band.name,
          centerFreq: Math.round(centerFreq),
          Q: Math.max(0.5, Math.min(Q, 10)),
          gain: level,
          fLow: band.fLow,
          fHigh: band.fHigh
        });
      }
    });

    return adjusted;
  }
}

/**
 * Simplified information about ERB method for user interface
 */
export const ERB_INFO = {
  title: "ERB-Based Tuning (Recommended)",

  summary: `Uses broad frequency bands that match how your ear naturally hears treble.`,

  details: `ERB (Equivalent Rectangular Bandwidth) matches your ear's natural frequency integration.

**Four bands:**
• Lower Presence (4.5-7 kHz): Vocal warmth
• Upper Presence (6-8.5 kHz): Sibilance control
• Brilliance (8-12 kHz): Sharpness / glare
• Air (12-20 kHz): Openness and extension

Adjust broad energy regions, not narrow peaks. Safer than targeting specific frequencies.`
};
