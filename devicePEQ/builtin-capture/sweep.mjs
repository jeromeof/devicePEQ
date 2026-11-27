// Independent sweep primitives for the built-in browser capture backend.
// The implementation is intentionally dependency-free so the numerical core can
// be tested in Node as well as imported by browser code.

// Fade at each end of the sweep, as a fraction of its duration. On a log sweep a
// time fraction is a fraction of the octave span, so the old 5% faded the top half
// octave (≈14–20 kHz on a 20 Hz–20 kHz sweep) and starved it of energy; 1% is about
// a tenth of an octave.
export const DEFAULT_FADE_FRACTION = 0.01;

/**
 * How far to sweep for a measurement that must be valid up to `endHz`. Above the
 * sweep's last frequency the deconvolution is noise over almost nothing, so the
 * sweep runs ~7.5% (an octave tenth) past the requested end, staying below Nyquist.
 */
export function sweepEndFor(endHz, sampleRate) {
  return Math.max(endHz, Math.min(endHz * 1.075, sampleRate * 0.475));
}

/**
 * The band a sweep from startHz to sweepEndHz actually resolves: everything
 * outside the middle of its end fades, never beyond what was asked for.
 */
export function validSweepBand({ startHz, endHz, sweepEndHz = endHz, fadeFraction = DEFAULT_FADE_FRACTION }) {
  const halfFade = Math.pow(sweepEndHz / startHz, fadeFraction / 2);
  return { validStartHz: Math.max(30, startHz * 1.02, startHz * halfFade), validEndHz: Math.min(endHz, sweepEndHz / halfFade) };
}

export function nextPowerOfTwo(value) {
  if (!Number.isFinite(value) || value < 1) throw new RangeError('value must be a positive finite number');
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

export function validateSweep({ startHz, endHz, durationSec, sampleRate }) {
  for (const [name, value] of Object.entries({ startHz, endHz, durationSec, sampleRate })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  }
  if (endHz <= startHz) throw new RangeError('endHz must be greater than startHz');
  if (endHz >= sampleRate / 2) throw new RangeError('endHz must be below the Nyquist frequency');
}

export function fadeLength(samples, fraction = 0.05) {
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError('samples must be a positive integer');
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 0.5) throw new RangeError('fraction must be between 0 and 0.5');
  return Math.min(Math.floor(samples / 2), Math.floor(samples * fraction));
}

export function windowValue(index, length, fadeIn, fadeOut = fadeIn) {
  if (index < 0 || index >= length) throw new RangeError('index outside window');
  if (fadeIn > 0 && index < fadeIn) return 0.5 * (1 - Math.cos(Math.PI * index / fadeIn));
  if (fadeOut > 0 && index >= length - fadeOut) {
    const back = length - 1 - index;
    return 0.5 * (1 - Math.cos(Math.PI * Math.max(0, back) / fadeOut));
  }
  return 1;
}

/** Render a phase-continuous exponential sine sweep at the requested rate. */
export function renderLogSweep({ startHz, endHz, durationSec, sampleRate, window = true, fadeFraction = DEFAULT_FADE_FRACTION, levelDb = 0 }) {
  validateSweep({ startHz, endHz, durationSec, sampleRate });
  if (!Number.isFinite(levelDb) || levelDb > 0 || levelDb < -60) throw new RangeError('levelDb must be between -60 and 0 dBFS');
  const samples = Math.max(2, Math.round(durationSec * sampleRate));
  const level = Math.pow(10, levelDb / 20);
  const sweep = new Float64Array(samples);
  const T = samples / sampleRate;
  const L = T / Math.log(endHz / startHz);
  const K = 2 * Math.PI * startHz * L;
  const fade = window ? fadeLength(samples, fadeFraction) : 0;
  for (let n = 0; n < samples; n++) {
    const t = n / sampleRate;
    const envelope = window ? windowValue(n, samples, fade, fade) : 1;
    sweep[n] = Math.sin(K * (Math.exp(t / L) - 1)) * envelope * level;
  }
  return { samples: sweep, fadeSamples: fade, sampleRate, startHz, endHz, durationSec: T, levelDb };
}

export function withLeadIn(signal, leadInSamples) {
  if (!(signal instanceof Float64Array)) throw new TypeError('signal must be Float64Array');
  if (!Number.isInteger(leadInSamples) || leadInSamples < 0) throw new RangeError('leadInSamples must be non-negative integer');
  const result = new Float64Array(leadInSamples + signal.length);
  result.set(signal, leadInSamples);
  return result;
}
