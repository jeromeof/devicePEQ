// Browser ESM port of filter-response.js — identical logic, no Node
// dependencies either way, just `export` instead of `module.exports`. Keep
// this in sync with filter-response.js if the math ever changes.
//
// Theoretical biquad frequency-response model + statistical comparison
// against a real REW measurement pair (baseline vs filter-applied). Replaces
// ad hoc single-point delta checks ("read magnitude at 1kHz") with a real fit
// across the whole frequency range the filter should affect: RMSE, max
// error, and correlation between the measured delta curve and the
// theoretically-expected one.
//
// Standard RBJ Audio EQ Cookbook biquads, Q-parametrized. PK mirrors
// walkplayHidHandler.js's computeIIRFilter() exactly (A=10^(gain/40),
// alpha=sin(w0)/(2Q)), and fits real captures to ~0.05dB RMSE.
//
// LSQ/HSQ use the PROPER RBJ/WebAudio shelf-Q formula
// (alpha = sin(w0)/2 * sqrt((A+1/A)*(1/Q-1)+2)), NOT the simplified
// peaking-style alpha that computeIIRFilter() actually sends to the device.
// This was deliberately verified, not assumed: cross-checked against a real
// WebAudio OfflineAudioContext BiquadFilterNode (an independent, W3C-spec'd
// reference implementation) on 6 real Protocol Max shelf captures — the
// proper shelf alpha fits the real device to 0.07-0.42dB RMSE, vs 0.6-1.1dB
// using computeIIRFilter's simplified alpha (see filter-response.real.test.js
// for the locked-in numbers). Whatever the exact mechanism on the device
// side, its actual acoustic Q=1 behaves like the standard shelf formula, not
// the peaking-borrowed one — so mirroring computeIIRFilter's simplified
// alpha here would mean mirroring what's very likely a real formula bug in
// that function (LSQ/HSQ borrowing PK's alpha instead of using shelf alpha),
// not "what the device actually does" — and this model's whole point is to
// predict the latter.
function biquadCoefficients(type, centerFreq, gainDb, q, fs) {
  const A = Math.sqrt(Math.pow(10, gainDb / 20));
  const w0 = (2 * Math.PI * centerFreq) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);

  switch (type) {
    case 'LSQ': {
      const shelfAlpha = (sinw0 / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
      const s = 2 * Math.sqrt(A) * shelfAlpha;
      return {
        b0:    A * ((A + 1) - (A - 1) * cosw0 + s),
        b1:  2*A * ((A - 1) - (A + 1) * cosw0),
        b2:    A * ((A + 1) - (A - 1) * cosw0 - s),
        a0:         (A + 1) + (A - 1) * cosw0 + s,
        a1:    -2 * ((A - 1) + (A + 1) * cosw0),
        a2:         (A + 1) + (A - 1) * cosw0 - s,
      };
    }
    case 'HSQ': {
      const shelfAlpha = (sinw0 / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
      const s = 2 * Math.sqrt(A) * shelfAlpha;
      return {
        b0:     A * ((A + 1) + (A - 1) * cosw0 + s),
        b1:  -2*A * ((A - 1) + (A + 1) * cosw0),
        b2:     A * ((A + 1) + (A - 1) * cosw0 - s),
        a0:          (A + 1) - (A - 1) * cosw0 + s,
        a1:      2 * ((A - 1) - (A + 1) * cosw0),
        a2:          (A + 1) - (A - 1) * cosw0 - s,
      };
    }
    case 'LPF': // 2nd-order resonant low-pass, -12dB/oct beyond cutoff
      return {
        b0: (1 - cosw0) / 2, b1: 1 - cosw0, b2: (1 - cosw0) / 2,
        a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha,
      };
    case 'HPF': // 2nd-order resonant high-pass, -12dB/oct below cutoff
      return {
        b0: (1 + cosw0) / 2, b1: -(1 + cosw0), b2: (1 + cosw0) / 2,
        a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha,
      };
    case 'BPF': // constant 0dB peak gain band-pass — peak stays ~0dB regardless of Q
      return {
        b0: alpha, b1: 0, b2: -alpha,
        a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha,
      };
    case 'NOTCH':
    case 'BSF': // band-stop shares the notch topology — Q sets width/depth
      return {
        b0: 1, b1: -2 * cosw0, b2: 1,
        a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha,
      };
    case 'APF': // all-pass — numerator is the reverse of the denominator,
                // which is what guarantees |H|=1 (0dB) at every frequency;
                // only phase changes. Fitting this confirms magnitude is
                // untouched, not that the filter "does" anything audible.
      return {
        b0: 1 - alpha, b1: -2 * cosw0, b2: 1 + alpha,
        a0: 1 + alpha, a1: -2 * cosw0, a2: 1 - alpha,
      };
    default: // PK, CQ (constant-Q peaking ~= RBJ peaking EQ), and anything
             // else falls back to the peaking-EQ shape.
      return {
        b0: 1 + alpha * A, b1: -2 * cosw0, b2: 1 - alpha * A,
        a0: 1 + alpha / A, a1: -2 * cosw0, a2: 1 - alpha / A,
      };
  }
}

// Filter types this model can produce a theoretical curve for. Kept as a
// single exported list so callers (e.g. the REW verification tool) can
// decide "shape-fit vs single-point/record-only" without duplicating this
// set themselves.
export const MODELED_FILTER_TYPES = ['PK', 'LSQ', 'HSQ', 'LPF', 'HPF', 'BPF', 'NOTCH', 'BSF', 'APF', 'CQ'];

// |H(e^jw)| in dB for a given biquad, evaluated at evalFreq.
function biquadMagnitudeDb({ b0, b1, b2, a0, a1, a2 }, evalFreq, fs) {
  const w = (2 * Math.PI * evalFreq) / fs;
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const cos2w = Math.cos(2 * w), sin2w = Math.sin(2 * w);

  // H(e^jw) = (b0 + b1*e^-jw + b2*e^-2jw) / (a0 + a1*e^-jw + a2*e^-2jw)
  const numRe = b0 + b1 * cosw + b2 * cos2w;
  const numIm = -(b1 * sinw + b2 * sin2w);
  const denRe = a0 + a1 * cosw + a2 * cos2w;
  const denIm = -(a1 * sinw + a2 * sin2w);

  const numMag = Math.hypot(numRe, numIm);
  const denMag = Math.hypot(denRe, denIm);
  return 20 * Math.log10(numMag / denMag);
}

// Back-compat named export — RBJ peaking-EQ analytical magnitude response.
export function peakingMagnitudeDb(centerFreq, gainDb, q, evalFreq, fs = 96000) {
  return biquadMagnitudeDb(biquadCoefficients('PK', centerFreq, gainDb, q, fs), evalFreq, fs);
}

export function theoreticalMagnitudeDb(filterSpec, evalFreq, fs = 96000) {
  const { freq, gain, q, type } = filterSpec;
  const t = (type || '').toUpperCase();
  if (!MODELED_FILTER_TYPES.includes(t)) {
    throw new Error(`No theoretical model for filter type "${type}"`);
  }
  return biquadMagnitudeDb(biquadCoefficients(t, freq, gain, q, fs), evalFreq, fs);
}

// Log-spaced evaluation points across [minFreq, maxFreq] — denser sampling
// wastes nothing on a straight dB-vs-log(f) comparison and matches how
// filter effects are perceived/plotted.
export function logSpacedFrequencies(minFreq, maxFreq, count) {
  const logMin = Math.log10(minFreq), logMax = Math.log10(maxFreq);
  const freqs = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    freqs.push(Math.pow(10, logMin + t * (logMax - logMin)));
  }
  return freqs;
}

// Statistically compares a measured (baseline, test) FR pair against the
// theoretical response of filterSpec, over evalFreqs (defaults to 60
// log-spaced points from 20Hz-20kHz). Returns per-point data plus rollup
// stats: RMSE, max absolute error, mean error (bias), and Pearson
// correlation between measured and theoretical delta curves.
//
// Also returns outOfBand stats (should be ~0dB delta, flat) as a separate
// check that the filter isn't leaking effect where it shouldn't.
// Rollup stats for a set of {measuredDelta, expectedDelta, residual} points:
// RMSE/max/mean of the residual (measured-vs-theoretical error), plus the
// Pearson correlation between the measured and theoretical delta curves.
// Standalone (not nested) so compensateForPregain() below can reuse it on
// the pregain-corrected points without duplicating the math.
// FFT/deconvolution responses can contain a numerical floor (commonly around
// -300 dB) when a bin has no usable signal.  That is not an acoustic result
// and must not be allowed to dominate a relative-response comparison.
export const RESPONSE_DB_MIN = -120;
// REW exports absolute SPL-like magnitudes (often 60–110 dB), while the
// built-in response is normally relative dB. Keep the upper bound generous.
export const RESPONSE_DB_MAX = 200;

export function isUsableResponseDb(value, { minDb = RESPONSE_DB_MIN, maxDb = RESPONSE_DB_MAX } = {}) {
  return Number.isFinite(value) && value >= minDb && value <= maxDb;
}

const ISOLATED_RESPONSE_OUTLIER_DB = 20;

function computeStats(pts) {
  pts = pts.filter((p) => p && p.usable !== false && Number.isFinite(p.residual)
    && Number.isFinite(p.measuredDelta) && Number.isFinite(p.expectedDelta));
  if (!pts.length) return null;
  const n = pts.length;
  const residuals = pts.map((p) => p.residual);
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  const maxAbsError = Math.max(...residuals.map(Math.abs));
  const meanError = residuals.reduce((s, r) => s + r, 0) / n;

  const mx = pts.reduce((s, p) => s + p.measuredDelta, 0) / n;
  const my = pts.reduce((s, p) => s + p.expectedDelta, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (const p of pts) {
    const dx = p.measuredDelta - mx, dy = p.expectedDelta - my;
    cov += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  const correlation = (varX > 0 && varY > 0) ? cov / Math.sqrt(varX * varY) : null;

  return { n, rmse, maxAbsError, meanError, correlation };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function compareToTheoretical(baselineFr, testFr, filterSpec, {
  magnitudeAt,
  evalFreqs = logSpacedFrequencies(20, 20000, 60),
  inBandThresholdDb = 0.5,
  fs = 96000,
} = {}) {
  const points = evalFreqs.map((freq) => {
    const baselineDb = magnitudeAt(baselineFr, freq);
    const measuredDb = magnitudeAt(testFr, freq);
    const usable = isUsableResponseDb(baselineDb) && isUsableResponseDb(measuredDb);
    const measuredDelta = usable ? measuredDb - baselineDb : null;
    const expectedDelta = theoreticalMagnitudeDb(filterSpec, freq, fs);
    return {
      freq, baselineDb, measuredDb, measuredDelta, expectedDelta,
      residual: usable ? measuredDelta - expectedDelta : null,
      usable,
    };
  });

  // A finite response can still be an isolated deconvolution collapse. Do not
  // let one or two such bins create artificial out-of-band leakage. The limit
  // is deliberately large (20 dB) so real filter skirts and high-Q features
  // remain judgeable; this only removes discontinuous, isolated failures.
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p.usable) continue;
    const neighbours = points.slice(Math.max(0, i - 3), Math.min(points.length, i + 4))
      .filter((q, j) => q !== p && q.usable && Number.isFinite(q.residual));
    if (neighbours.length >= 2 && Math.abs(p.residual - median(neighbours.map((q) => q.residual))) > ISOLATED_RESPONSE_OUTLIER_DB) {
      p.usable = false;
      p.ignoredReason = 'isolated response discontinuity';
    }
  }
  const usablePoints = points.filter((p) => p.usable);
  const inBand = usablePoints.filter((p) => Math.abs(p.expectedDelta) >= inBandThresholdDb);
  const outOfBand = usablePoints.filter((p) => Math.abs(p.expectedDelta) < inBandThresholdDb);

  return {
    filterSpec,
    points,
    usablePoints,
    ignoredPointCount: points.length - usablePoints.length,
    ignoredPoints: points.filter((p) => !p.usable).map((p) => ({ freq: p.freq, baselineDb: p.baselineDb, measuredDb: p.measuredDb, reason: p.ignoredReason || 'unusable response value' })),
    inBandThresholdDb,
    inBandStats: computeStats(inBand),
    outOfBandStats: computeStats(outOfBand),
    overallStats: computeStats(points),
  };
}

// Estimates a broadband level offset (typically a device auto-pregain/
// headroom backoff triggered by a boost filter) from a compareToTheoretical()
// result, and returns the same comparison recomputed with that offset removed.
//
// The offset is the MEDIAN residual across all evaluation points, not the
// mean: a device that's applying pregain shifts the *entire* measured curve
// down by a constant amount, in-band and out-of-band alike, so the median
// residual estimates that constant robustly even where the filter's own
// shape doesn't fit theory perfectly at every point. Compare
// comparison.overallStats.meanError (pre-compensation, includes both the
// pregain offset AND any real shape error) against pregainDb — if they're
// close, the "failure" was mostly pregain, not a wrong biquad implementation.
export function compensateForPregain(comparison) {
  const usablePoints = comparison.points.filter((p) => p.usable !== false && Number.isFinite(p.residual));
  const pregainDb = usablePoints.length ? median(usablePoints.map((p) => p.residual)) : 0;

  const compensatedPoints = comparison.points.map((p) => ({
    ...p,
    measuredDelta: p.usable === false ? null : p.measuredDelta - pregainDb,
    residual: p.usable === false ? null : p.residual - pregainDb,
  }));
  const threshold = comparison.inBandThresholdDb ?? 0.5;
  const valid = compensatedPoints.filter((p) => p.usable !== false && Number.isFinite(p.residual));
  const inBand = valid.filter((p) => Math.abs(p.expectedDelta) >= threshold);
  const outOfBand = valid.filter((p) => Math.abs(p.expectedDelta) < threshold);

  return {
    pregainDb,
    compensated: {
      filterSpec: comparison.filterSpec,
      points: compensatedPoints,
      inBandThresholdDb: threshold,
      inBandStats: computeStats(inBand),
      outOfBandStats: computeStats(outOfBand),
      overallStats: computeStats(compensatedPoints),
      ignoredPointCount: comparison.ignoredPointCount ?? 0,
      ignoredPoints: comparison.ignoredPoints ?? [],
    },
  };
}

// Simple pass/fail rollup on top of compareToTheoretical()'s stats — tune
// thresholds per how noisy/repeatable your particular mic+IEM setup is.
export function judgeFit(comparison, { rmseToleranceDb = 1.5, correlationMin = 0.8, outOfBandRmseToleranceDb = 1.0 } = {}) {
  const inBand = comparison.inBandStats;
  const outOfBand = comparison.outOfBandStats;
  const inBandOk = inBand && inBand.rmse <= rmseToleranceDb && (inBand.correlation ?? 0) >= correlationMin;
  const outOfBandOk = !outOfBand || outOfBand.rmse <= outOfBandRmseToleranceDb;
  const ignoredNote = comparison.ignoredPointCount ? `; ignored ${comparison.ignoredPointCount} unusable response point(s)` : '';
  return {
    pass: !!(inBandOk && outOfBandOk),
    inBandOk, outOfBandOk,
    reason: (!inBand ? 'no in-band evaluation points (filter effect below threshold everywhere?)'
      : !inBandOk ? `in-band fit poor: rmse=${inBand.rmse.toFixed(2)}dB (tol ${rmseToleranceDb}), correlation=${(inBand.correlation ?? 0).toFixed(2)} (min ${correlationMin})`
      : !outOfBandOk ? `out-of-band leakage: rmse=${outOfBand.rmse.toFixed(2)}dB (tol ${outOfBandRmseToleranceDb})`
      : 'ok') + ignoredNote,
  };
}

// Diagnostic for the specific case a plain RMSE/correlation number doesn't
// explain well: "the shape is wrong, but wrong HOW?" Holds freq/gain fixed
// at what was actually requested and searches for the Q that best explains
// the measured curve, i.e. "what Q would make this a good fit?" — turning a
// failed shape fit into an actionable number (e.g. "requested Q=1.0, this
// device's real Q is closer to 0.75") instead of just a failing RMSE.
//
// Useful, but don't over-trust a consistent non-1.0 result: on a real
// WalkPlay Protocol Max, LSQ/HSQ shelf tests first failed shape-fit at
// requested Q=1 with RMSE 0.6-1.2dB, and this search landed on a tight
// 0.70-0.79 cluster across 6 captures — which looked exactly like a real
// firmware characteristic (shelves running gentler than requested). It
// wasn't. Cross-checking against an independent reference (a WebAudio
// BiquadFilterNode) showed our own model was using the wrong shelf-Q alpha
// formula; fixing that made the same captures pass outright at effective
// Q≈1.0 (see filter-response.real.test.js). A clean, tight ratio cluster is
// exactly what BOTH a real device quirk and a model bug look like from this
// diagnostic alone — check the model against an independent implementation
// before concluding it's the device.
//
// `significant` guards against a second failure mode found later: a raw
// least-squares grid search always returns SOME "best" Q, even when every
// candidate fits about equally (well OR badly) — there's no built-in check
// for whether that's a real improvement or just noise-chasing. This bites
// hardest when few or zero points cross the in-band threshold (small
// nominal gain, or most of the signal absorbed by pregain compensation),
// which falls back to searching the WHOLE curve — where a very high Q's
// "flat 0dB except a razor-thin spike at f0" can spuriously out-fit the
// true shape on ordinary broadband ripple. Without this gate, a filter that
// was already a good fit at the requested Q (small RMSE, high correlation)
// could still get reported with a nonsensical ratio like "3000%". Only
// trust estimatedQ/ratio when `significant` is true.
export function estimateEffectiveQ(baselineFr, measuredFr, filterSpec, {
  magnitudeAt,
  evalFreqs = logSpacedFrequencies(20, 20000, 200),
  fs = 96000,
  qSearchMin = 0.05,
  qSearchMax = 30,
  qSearchSteps = 300,
  minAbsoluteImprovementDb = 0.1,
  maxRelativeRmse = 0.6,
} = {}) {
  const comparison = compareToTheoretical(baselineFr, measuredFr, filterSpec, { magnitudeAt, evalFreqs, fs });
  // The broadband pregain offset is Q-independent (it's a level shift, not a
  // shape effect), so it's safe to estimate it once using the filter's own
  // claimed Q before searching for the Q that best explains the remaining
  // shape — no chicken-and-egg problem between the two.
  const { pregainDb, compensated } = compensateForPregain(comparison);
  const threshold = compensated.inBandThresholdDb ?? 0.5;
  const validCompensated = compensated.points.filter((p) => p.usable !== false && Number.isFinite(p.measuredDelta));
  const points = validCompensated.filter((p) => Math.abs(p.expectedDelta) >= threshold);
  const searchPoints = points.length ? points : validCompensated; // fall back to the whole curve if nothing crossed the in-band threshold
  const rmseAtRequestedQ = compensated.inBandStats?.rmse ?? null;

  let best = null;
  for (let i = 0; i <= qSearchSteps; i++) {
    const q = qSearchMin * Math.pow(qSearchMax / qSearchMin, i / qSearchSteps); // log-spaced — Q differences matter multiplicatively, not additively
    let sumSq = 0;
    for (const p of searchPoints) {
      const expected = theoreticalMagnitudeDb({ ...filterSpec, q }, p.freq, fs);
      const err = p.measuredDelta - expected;
      sumSq += err * err;
    }
    const rmse = Math.sqrt(sumSq / searchPoints.length);
    if (!best || rmse < best.rmse) best = { q, rmse };
  }

  // Require BOTH a meaningful absolute drop and a meaningful relative one —
  // absolute alone would still flag "2dB -> 1.9dB" as significant (barely
  // moved, both bad); relative alone would flag "0.02dB -> 0.008dB" (both
  // negligible, well within noise).
  const significant = rmseAtRequestedQ != null
    && (rmseAtRequestedQ - best.rmse) >= minAbsoluteImprovementDb
    && best.rmse <= rmseAtRequestedQ * maxRelativeRmse;

  return {
    pregainDb,
    requestedQ: filterSpec.q,
    estimatedQ: best.q,
    rmseAtEstimatedQ: best.rmse,
    rmseAtRequestedQ,
    ratio: best.q / filterSpec.q,
    significant,
  };
}

// ── Blind filter estimation ────────────────────────────────────────────────
// "Something changed the response — what filter was it?" Given a measured delta
// curve with NO known target, recover type/frequency/gain/Q.
//
// This exists for measurements taken through someone else's tool (a vendor web
// app, a phone app): the device was configured outside this bench, so there is
// no requested spec to compare against — only the acoustic result. Recovering
// the parameters lets the same shape-fit machinery run on it, and lets a user
// check whether what a vendor tool SAYS it applied is what it actually applied.
//
// Coordinate descent rather than a 3-D grid: a joint grid over freq x gain x Q at
// useful resolution is millions of evaluations and would block the page for
// seconds, while cycling 1-D refinements converges on this well-behaved surface
// in a fraction of that. Each candidate fits its own level offset, so a broadband
// level shift (device pregain) never leaks into the gain estimate.
const EST_TYPES = ['PK', 'LSQ', 'HSQ'];

function rmseWithOffset(points, spec, fs) {
  const res = points.map((p) => p.delta - theoreticalMagnitudeDb(spec, p.freq, fs));
  const sorted = [...res].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const offset = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  let sum = 0;
  for (const r of res) { const e = r - offset; sum += e * e; }
  return { rmse: Math.sqrt(sum / res.length), offset };
}

// 1-D refine of a single field: coarse log sweep, then windows around the winner.
function refineField(points, spec, field, lo, hi, fs, { steps = 28, passes = 3, log = true } = {}) {
  let a = log ? Math.log(lo) : lo, b = log ? Math.log(hi) : hi;
  let best = { value: spec[field], rmse: rmseWithOffset(points, spec, fs).rmse };
  for (let pass = 0; pass <= passes; pass++) {
    for (let i = 0; i <= steps; i++) {
      const t = a + ((b - a) * i) / steps;
      const value = log ? Math.exp(t) : t;
      const { rmse } = rmseWithOffset(points, { ...spec, [field]: value }, fs);
      if (rmse < best.rmse) best = { value, rmse };
    }
    const w = (b - a) / steps;
    const c = log ? Math.log(best.value) : best.value;
    a = c - w; b = c + w;
    steps = 12;
  }
  return best.value;
}

// Seeds matter: coordinate descent finds a local optimum, and a peak seeded an
// octave away can converge onto the wrong lobe. Seed from the curve's own shape.
function seedFor(type, points) {
  const sorted = [...points].sort((a, b) => a.freq - b.freq);
  const lowAvg = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.08)))
    .reduce((s, p) => s + p.delta, 0) / Math.max(1, Math.round(sorted.length * 0.08));
  const highAvg = sorted.slice(-Math.max(1, Math.round(sorted.length * 0.08)))
    .reduce((s, p) => s + p.delta, 0) / Math.max(1, Math.round(sorted.length * 0.08));
  if (type === 'LSQ') return { type, freq: 200, gain: lowAvg - highAvg, q: 0.7 };
  if (type === 'HSQ') return { type, freq: 4000, gain: highAvg - lowAvg, q: 0.7 };
  // PK: strongest excursion from the curve's own baseline level.
  const mid = (lowAvg + highAvg) / 2;
  let peak = sorted[0], peakAbs = -1;
  for (const p of sorted) {
    const d = Math.abs(p.delta - mid);
    if (d > peakAbs) { peakAbs = d; peak = p; }
  }
  return { type, freq: peak.freq, gain: peak.delta - mid, q: 1 };
}

/**
 * points: [{ freq, delta }] — measured minus baseline, in dB.
 * Returns the best-fitting spec plus every candidate, so callers can show how
 * clearly the winner beat the alternatives instead of implying false certainty.
 */
export function estimateFilterFromDelta(points, { fs = 44100, types = EST_TYPES, minGainDb = 0.5 } = {}) {
  const usable = points.filter((p) => Number.isFinite(p.delta) && Number.isFinite(p.freq));
  if (usable.length < 20) return { ok: false, reason: `only ${usable.length} usable points` };

  const deltas = usable.map((p) => p.delta);
  const span = Math.max(...deltas) - Math.min(...deltas);
  if (span < minGainDb) {
    return { ok: false, reason: `curve is flat (${span.toFixed(2)} dB peak-to-peak) — no filter to identify` };
  }

  const candidates = [];
  for (const type of types) {
    let spec = seedFor(type, usable);
    if (!Number.isFinite(spec.gain) || Math.abs(spec.gain) < 1e-3) spec.gain = span * (spec.gain < 0 ? -1 : 1);
    for (let round = 0; round < 5; round++) {
      spec = { ...spec, freq: refineField(usable, spec, 'freq', 20, 20000, fs) };
      spec = { ...spec, q: refineField(usable, spec, 'q', 0.05, 20, fs) };
      spec = { ...spec, gain: refineField(usable, spec, 'gain', Math.sign(spec.gain) * 0.1,
        Math.sign(spec.gain) * 40, fs, { log: false }) };
    }
    const { rmse, offset } = rmseWithOffset(usable, spec, fs);
    candidates.push({ ...spec, rmse, offsetDb: offset });
  }

  candidates.sort((a, b) => a.rmse - b.rmse);
  let best = candidates[0];

  // Shelf degeneracy. LSQ(+g) and HSQ(-g) at the same corner and Q differ by
  // EXACTLY a constant g at every frequency (verified numerically: the
  // difference is 6.0000 dB at all 12 probe points for a 6 dB pair). Since every
  // candidate fits its own level offset, the two are indistinguishable by shape
  // and their RMSEs are identical — the shape search alone can return either.
  //
  // What separates them is absolute level: a low shelf leaves the treble where
  // it was, a high shelf leaves the bass where it was. So prefer the orientation
  // needing the smaller level correction, and always report the twin, because
  // a device pregain large enough to outweigh that reasoning would flip it.
  let equivalent = null;
  if (best.type === 'LSQ' || best.type === 'HSQ') {
    const twinSpec = { ...best, type: best.type === 'LSQ' ? 'HSQ' : 'LSQ', gain: -best.gain };
    const twinFit = rmseWithOffset(usable, twinSpec, fs);
    const twin = { ...twinSpec, rmse: twinFit.rmse, offsetDb: twinFit.offset };
    if (Math.abs(twin.offsetDb) < Math.abs(best.offsetDb)) {
      equivalent = best;
      best = twin;
    } else {
      equivalent = twin;
    }
  }

  // A shelf and a very low-Q peak can also look alike over a limited span; say
  // so rather than presenting the winner as settled.
  const others = candidates.filter((c) => c.type !== best.type && c.type !== equivalent?.type);
  const typeMargin = others.length ? Math.min(...others.map((c) => c.rmse)) - best.rmse : Infinity;
  return {
    ok: true,
    type: best.type,
    freq: best.freq,
    gain: best.gain,
    q: best.q,
    offsetDb: best.offsetDb,
    rmse: best.rmse,
    typeConfident: typeMargin > Math.max(0.05, best.rmse * 0.25),
    // Present when the result is a shelf: the equally-good opposite reading.
    equivalent: equivalent && { type: equivalent.type, freq: equivalent.freq,
      gain: equivalent.gain, q: equivalent.q, offsetDb: equivalent.offsetDb },
    candidates,
  };
}
