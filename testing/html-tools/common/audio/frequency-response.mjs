// Frequency-response primitives: parsing measurement files, interpolating them,
// applying a calibration and comparing two responses.
//
// A "response" here is { startFreq, freqStep, magnitude: Float32Array } — the
// shape the built-in capture backend produces. A "curve" is a sorted array of
// { freq, db } points, which is what text files parse into.

function numericPair(line) {
  const clean = line.replace(/[,;]+/g, ' ').trim();
  if (!clean || /^[#/]/.test(clean) || /^[-+]?\d+(?:\.\d+)?\s*(?:hz)?\s*[-+]?\d/.test(clean) === false) return null;
  const values = clean.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!values || values.length < 2) return null;
  const freq = Number(values[0]), db = Number(values[1]);
  return Number.isFinite(freq) && freq > 0 && Number.isFinite(db) ? { freq, db } : null;
}

/** Parse a two-column frequency/dB file (REW, CrinGraph, AutoEQ and friends). */
export function parseFrequencyPairs(text) {
  const points = String(text || '').split(/\r?\n/).map(numericPair).filter(Boolean);
  points.sort((a, b) => a.freq - b.freq);
  const unique = [];
  for (const point of points) {
    if (unique.length && unique[unique.length - 1].freq === point.freq) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  if (unique.length < 2) throw new Error('The file needs at least two frequency/dB rows.');
  return unique;
}

/** Interpolate a parsed curve on a log-frequency axis, clamping outside its range. */
export function interpolateLog(points, frequency) {
  if (!points?.length || !Number.isFinite(frequency) || frequency <= 0) return 0;
  if (frequency <= points[0].freq) return points[0].db;
  if (frequency >= points[points.length - 1].freq) return points[points.length - 1].db;
  let hi = 1;
  while (hi < points.length && points[hi].freq < frequency) hi++;
  const lo = points[hi - 1], high = points[hi];
  const t = Math.log(frequency / lo.freq) / Math.log(high.freq / lo.freq);
  return lo.db + (high.db - lo.db) * t;
}

/** Nearest-bin dB of a captured response. */
export function responseDbAt(response, frequency) {
  if (!response || !Number.isFinite(response.freqStep) || response.freqStep <= 0) return NaN;
  const i = Math.max(0, Math.min(response.magnitude.length - 1,
    Math.round((frequency - response.startFreq) / response.freqStep)));
  return response.magnitude[i];
}

/** Add a microphone/interface calibration curve to a captured response. */
export function applyCalibration(response, calibration) {
  if (!calibration?.length) return response;
  const magnitude = new Float32Array(response.magnitude.length);
  for (let i = 0; i < magnitude.length; i++) {
    magnitude[i] = response.magnitude[i] + interpolateLog(calibration, response.startFreq + i * response.freqStep);
  }
  return { ...response, magnitude };
}

/**
 * Sample two responses onto one log grid so mismatched bin grids cannot disagree.
 * @returns {Array<{f:number, a:number, b:number}>}
 */
export function compareResponses(a, b, { fMin = 20, fMax = 20000, steps = 400 } = {}) {
  const out = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / steps);
    out[i] = { f, a: responseDbAt(a, f), b: responseDbAt(b, f) };
  }
  return out;
}

/**
 * Largest signed difference between two responses, and where it occurs.
 * Resolution is the log grid, not the source bins: at the default 400 steps the
 * spacing near 5 kHz is ~35 Hz, so a feature narrower than that can be stepped
 * over. Raise `steps` when comparing unsmoothed captures.
 */
export function peakDifference(a, b, options) {
  let peak = 0, at = 0;
  for (const p of compareResponses(a, b, options)) {
    const d = p.b - p.a;
    if (Number.isFinite(d) && Math.abs(d) > Math.abs(peak)) { peak = d; at = p.f; }
  }
  return { peak, at };
}
