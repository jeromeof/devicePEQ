// Independent sweep primitives for the built-in browser capture backend.
// The implementation is intentionally dependency-free so the numerical core can
// be tested in Node as well as imported by browser code.

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
export function renderLogSweep({ startHz, endHz, durationSec, sampleRate, window = true, fadeFraction = 0.05, levelDb = 0 }) {
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
