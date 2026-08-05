import { fft } from './fft.mjs';
import { nextPowerOfTwo } from './sweep.mjs';

function assertSignal(value, name) {
  if (!(value instanceof Float64Array) || value.length === 0) throw new TypeError(`${name} must be a non-empty Float64Array`);
}

/**
 * Estimate H(f)=Y(f)/X(f) from a captured response and the exact played signal.
 * A small magnitude floor prevents silent/near-silent reference bins producing
 * infinities. The returned bins are the non-negative half of the FFT.
 */
export function deconvolve(captured, played, sampleRate, { fftSize, referenceFloor = 1e-12, noise = null, noiseSegmentLength = 8192, subtractNoise = true } = {}) {
  assertSignal(captured, 'captured');
  assertSignal(played, 'played');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive and finite');
  if (played.length > captured.length) throw new RangeError('played signal cannot be longer than captured signal');
  const size = fftSize == null ? nextPowerOfTwo(captured.length) : fftSize;
  if (size < captured.length || size < played.length || (size & (size - 1)) !== 0) throw new RangeError('fftSize must be a power of two covering both signals');

  const xr = new Float64Array(size), xi = new Float64Array(size);
  const yr = new Float64Array(size), yi = new Float64Array(size);
  const nr = new Float64Array(size), ni = new Float64Array(size);
  xr.set(played); yr.set(captured);
  if (noise != null) {
    assertSignal(noise, 'noise');
    if (noise.length > captured.length) throw new RangeError('noise sample cannot be longer than captured signal');
    nr.set(noise);
  }
  fft(xr, xi); fft(yr, yi);
  let noisePower = null;
  if (noise != null) {
    if (!Number.isInteger(noiseSegmentLength) || noiseSegmentLength < 1) throw new RangeError('noiseSegmentLength must be a positive integer');
    // A single short periodogram is very noisy. Average several independent
    // noise segments, scaling each segment's FFT power to the full capture
    // length before subtraction. This estimates expected noise power rather
    // than letting one random FFT bin decide the correction.
    noisePower = new Float64Array(Math.floor(size / 2) + 1);
    let segmentCount = 0;
    for (let start = 0; start < noise.length; start += noiseSegmentLength) {
      const length = Math.min(noiseSegmentLength, noise.length - start);
      nr.fill(0); ni.fill(0);
      for (let i = 0; i < length; i++) nr[i] = noise[start + i];
      fft(nr, ni);
      const scale = size / length;
      for (let k = 0; k < noisePower.length; k++) noisePower[k] += (nr[k] * nr[k] + ni[k] * ni[k]) * scale;
      segmentCount++;
    }
    if (segmentCount > 0) for (let k = 0; k < noisePower.length; k++) noisePower[k] /= segmentCount;
  }

  const points = Math.floor(size / 2) + 1;
  const magnitude = new Float64Array(points);
  const phase = new Float64Array(points);
  const noiseMagnitude = noise == null ? null : new Float64Array(points);
  for (let k = 0; k < points; k++) {
    const xMag2 = xr[k] * xr[k] + xi[k] * xi[k];
    if (xMag2 <= referenceFloor * referenceFloor) {
      magnitude[k] = NaN; phase[k] = NaN; continue;
    }
    // Y / X = Y * conjugate(X) / |X|².
    const hr = (yr[k] * xr[k] + yi[k] * xi[k]) / xMag2;
    const hi = (yi[k] * xr[k] - yr[k] * xi[k]) / xMag2;
    const measuredMagnitude = Math.hypot(hr, hi);
    const noiseEquivalent = noise == null ? 0 : Math.sqrt(noisePower[k] / xMag2);
    noiseMagnitude && (noiseMagnitude[k] = noiseEquivalent);
    magnitude[k] = subtractNoise ? Math.sqrt(Math.max(0, measuredMagnitude * measuredMagnitude - noiseEquivalent * noiseEquivalent)) : measuredMagnitude;
    phase[k] = Math.atan2(hi, hr);
  }
  return { sampleRate, fftSize: size, freqStep: sampleRate / size, magnitude, phase, noiseMagnitude, noiseSubtracted: noise != null && subtractNoise };
}
