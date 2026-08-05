/** Convert a deconvolution result to the response shape consumed by the REW verifier. */
export function toVerificationResponse(result, { floorDb = -300, startBin = 0 } = {}) {
  if (!result || !(result.magnitude instanceof Float64Array)) throw new TypeError('invalid deconvolution result');
  if (!Number.isInteger(startBin) || startBin < 0 || startBin >= result.magnitude.length) throw new RangeError('invalid startBin');
  const magnitude = new Float32Array(result.magnitude.length - startBin);
  for (let i = 0; i < magnitude.length; i++) {
    const linear = result.magnitude[i + startBin];
    magnitude[i] = Number.isFinite(linear) && linear > 0
      ? Math.max(floorDb, 20 * Math.log10(linear))
      : floorDb;
  }
  return {
    startFreq: startBin * result.freqStep,
    freqStep: result.freqStep,
    magnitude,
    sampleRate: result.sampleRate,
    fftSize: result.fftSize,
  };
}

export function magnitudeAt(response, frequency) {
  if (!response || !Number.isFinite(frequency) || response.freqStep <= 0) return NaN;
  const index = Math.max(0, Math.min(response.magnitude.length - 1,
    Math.round((frequency - response.startFreq) / response.freqStep)));
  return response.magnitude[index];
}

/** Smooth a response in dB over a fractional-octave window without changing its grid. */
export function smoothResponse(response, { fractionalOctave = 1 / 12, passes = 1 } = {}) {
  if (!response || !(response.magnitude instanceof Float32Array) || !Number.isFinite(response.freqStep) || response.freqStep <= 0) {
    throw new TypeError('invalid response');
  }
  if (!Number.isFinite(fractionalOctave) || fractionalOctave <= 0) throw new RangeError('fractionalOctave must be positive');
  if (!Number.isInteger(passes) || passes < 1) throw new RangeError('passes must be a positive integer');

  let magnitude = response.magnitude;
  const ratio = Math.pow(2, fractionalOctave / 2);
  for (let pass = 0; pass < passes; pass++) {
    const prefix = new Float64Array(magnitude.length + 1);
    for (let i = 0; i < magnitude.length; i++) prefix[i + 1] = prefix[i] + magnitude[i];
    const smoothed = new Float32Array(magnitude.length);
    for (let i = 0; i < magnitude.length; i++) {
      const frequency = response.startFreq + i * response.freqStep;
      if (frequency <= 0) { smoothed[i] = magnitude[i]; continue; }
      const lo = Math.max(0, Math.ceil((frequency / ratio - response.startFreq) / response.freqStep));
      const hi = Math.min(magnitude.length - 1, Math.floor((frequency * ratio - response.startFreq) / response.freqStep));
      const count = Math.max(1, hi - lo + 1);
      smoothed[i] = (prefix[hi + 1] - prefix[lo]) / count;
    }
    magnitude = smoothed;
  }
  return { ...response, magnitude };
}

export function averageResponses(responses) {
  if (!Array.isArray(responses) || responses.length === 0) throw new RangeError('at least one response is required');
  const first = responses[0];
  for (const r of responses) {
    if (r.startFreq !== first.startFreq || r.freqStep !== first.freqStep || r.magnitude.length !== first.magnitude.length) {
      throw new RangeError('responses must share an identical frequency grid');
    }
  }
  const magnitude = new Float32Array(first.magnitude.length);
  for (let i = 0; i < magnitude.length; i++) {
    let sum = 0;
    for (const r of responses) sum += r.magnitude[i];
    magnitude[i] = sum / responses.length;
  }
  return { ...first, magnitude };
}
