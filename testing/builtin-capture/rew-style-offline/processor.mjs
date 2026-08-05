import { fft } from '../../../devicePEQ/builtin-capture/fft.mjs';
import { nextPowerOfTwo } from '../../../devicePEQ/builtin-capture/sweep.mjs';

function signal(value, name) {
  if (!(value instanceof Float64Array) || !value.length) throw new TypeError(`${name} must be a non-empty Float64Array`);
}

function convolution(a, b) {
  const n = nextPowerOfTwo(a.length + b.length - 1);
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  return ar;
}

function leadingZeroCount(samples) {
  let i = 0;
  while (i < samples.length && Math.abs(samples[i]) <= 1e-15) i++;
  return i;
}

export function inverseLogSweep(sweep, sampleRate, { startHz, endHz, durationSec } = {}) {
  signal(sweep, 'sweep');
  if (![sampleRate, startHz, endHz].every(Number.isFinite) || sampleRate <= 0 || startHz <= 0 || endHz <= startHz) {
    throw new RangeError('invalid sweep parameters');
  }
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : sweep.length / sampleRate;
  const L = duration / Math.log(endHz / startHz);
  const inverse = new Float64Array(sweep.length);
  for (let i = 0; i < sweep.length; i++) inverse[i] = sweep[sweep.length - 1 - i] * Math.exp(-i / (sampleRate * L));
  return inverse;
}

function fftWindow(impulse, start, length, taperFraction) {
  const n = nextPowerOfTwo(length);
  const real = new Float64Array(n), imag = new Float64Array(n);
  const taper = Math.max(1, Math.floor(length * taperFraction));
  for (let i = 0; i < length; i++) {
    const source = start + i;
    if (source >= 0 && source < impulse.length) {
      const weight = i >= length - taper
        ? 0.5 * (1 + Math.cos(Math.PI * (i - (length - taper)) / taper))
        : 1;
      real[i] = impulse[source] * weight;
    }
  }
  fft(real, imag);
  return { real, imag, fftSize: n };
}

function peakInRange(values, from, to) {
  let index = from;
  for (let i = from + 1; i <= to; i++) if (Math.abs(values[i]) > Math.abs(values[index])) index = i;
  return index;
}

/**
 * Offline matched-inverse swept-sine processor.
 *
 * The reference sweep is processed through the same inverse filter and time
 * window as the capture. This removes the inverse-filter's own coloration and
 * makes output level cancellation explicit instead of relying on peak scaling.
 */
export function processSweep(captured, played, sampleRate, {
  startHz = 20,
  endHz = Math.min(sampleRate * 0.45, 20000),
  durationSec,
  leadInSamples = 0,
  preWindowSec = 0.01,
  postWindowSec = 0.5,
  searchAfterSec = 0.5,
  regularization = 1e-10,
  noise = null,
  clipThreshold = 0.999,
  abortOnClipping = true,
} = {}) {
  signal(captured, 'captured'); signal(played, 'played');
  if (!Number.isInteger(leadInSamples) || leadInSamples < 0 || leadInSamples >= played.length) throw new RangeError('invalid leadInSamples');
  if (![preWindowSec, postWindowSec, searchAfterSec].every(Number.isFinite) || preWindowSec < 0 || postWindowSec <= 0 || searchAfterSec < 0) throw new RangeError('invalid analysis window');
  if (!(regularization > 0) || !Number.isFinite(regularization)) throw new RangeError('regularization must be positive');

  const lead = leadingZeroCount(played);
  const sweep = played.subarray(lead);
  let peakInput = 0, clippedSamples = 0;
  for (const sample of captured) {
    const absolute = Math.abs(sample);
    if (absolute > peakInput) peakInput = absolute;
    if (absolute >= clipThreshold) clippedSamples++;
  }
  if (abortOnClipping && clippedSamples) throw new Error(`capture contains ${clippedSamples} clipped samples`);
  let noiseFloorDbfs = null;
  if (noise != null) {
    signal(noise, 'noise');
    let power = 0;
    for (const sample of noise) power += sample * sample;
    const rms = Math.sqrt(power / noise.length);
    noiseFloorDbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }
  const inverse = inverseLogSweep(sweep, sampleRate, { startHz, endHz, durationSec });
  const measuredImpulse = convolution(captured, inverse);
  const referenceImpulse = convolution(sweep, inverse);
  const expectedPeak = leadInSamples + sweep.length - 1;
  const from = Math.max(0, expectedPeak - Math.round(preWindowSec * sampleRate));
  const to = Math.min(measuredImpulse.length - 1, expectedPeak + Math.round(searchAfterSec * sampleRate));
  const peakIndex = peakInRange(measuredImpulse, from, to);
  const peak = Math.abs(measuredImpulse[peakIndex]);
  if (!(peak > 0) || !Number.isFinite(peak)) throw new Error('no usable swept-sine response peak');

  const pre = Math.round(preWindowSec * sampleRate);
  const length = Math.max(32, pre + Math.round(postWindowSec * sampleRate));
  const measured = fftWindow(measuredImpulse, peakIndex - pre, length, 0.1);
  const reference = fftWindow(referenceImpulse, sweep.length - 1 - pre, length, 0.1);
  const magnitude = new Float64Array(measured.fftSize / 2 + 1);
  const phase = new Float64Array(magnitude.length);
  for (let k = 0; k < magnitude.length; k++) {
    const refPower = reference.real[k] ** 2 + reference.imag[k] ** 2;
    const denominator = refPower + regularization;
    const r = (measured.real[k] * reference.real[k] + measured.imag[k] * reference.imag[k]) / denominator;
    const im = (measured.imag[k] * reference.real[k] - measured.real[k] * reference.imag[k]) / denominator;
    magnitude[k] = Math.hypot(r, im);
    phase[k] = Math.atan2(im, r);
  }
  return {
    startFreq: 0,
    freqStep: sampleRate / measured.fftSize,
    sampleRate,
    fftSize: measured.fftSize,
    magnitude,
    phase,
    expectedPeak,
    peakIndex,
    preWindowSamples: pre,
    postWindowSamples: length - pre,
    validStartFreq: Math.max(30, startHz * 1.02),
    validEndFreq: Math.min(endHz * 0.9, sampleRate * 0.375),
    capturePeak: peakInput,
    clippedSamples,
    noiseFloorDbfs,
  };
}

export function dbAt(response, frequency) {
  const index = Math.max(0, Math.min(response.magnitude.length - 1, Math.round((frequency - response.startFreq) / response.freqStep)));
  const value = response.magnitude[index];
  return value > 0 && Number.isFinite(value) ? 20 * Math.log10(value) : -Infinity;
}
