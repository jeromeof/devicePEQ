// Unit tests for the pregain-compensated shape-fit algorithm in
// filter-response.js — no REW instance, no device, no network. All fixtures
// are synthetic frequency-response curves built from the SAME theoretical
// model the production code uses (theoreticalMagnitudeDb), plus a small
// deterministic pseudo-noise term standing in for real mic/room ripple.
// That's deliberate: this suite is about "does the comparison math itself
// behave correctly" (does it match close curves, does it reject curves that
// differ in *shape* even if the overall level looks similar), not "does REW
// integration work" — that needs a live REW + device and isn't unit-testable.
//
// Run with:  node --test testing/rew-peq-capability-test/filter-response.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareToTheoretical,
  compensateForPregain,
  judgeFit,
  theoreticalMagnitudeDb,
  logSpacedFrequencies,
  estimateEffectiveQ,
} = require('./filter-response');
const { magnitudeAt } = require('./rew-control');

const SAMPLE_RATE = 44100; // matches the bench's current default device-fs assumption

// Builds a synthetic REW-shaped {startFreq, freqStep, magnitude} object —
// same shape getFrequencyResponse() returns — from a magnitude-in-dB
// generator function. Linear frequency axis, matching REW's real format
// (see the comment on magnitudeAt in rew-control.js).
// numPoints=20000 gives ~1Hz spacing across 20Hz-20kHz — real REW captures
// are typically this fine or finer (a 262144-point FFT at 48kHz is ~0.18Hz).
// This matters: with the default 2000-point grid, magnitudeAt()'s
// nearest-neighbor lookup introduces real quantization error against a
// sharp/narrow low-frequency peak (e.g. Q=8 @ 100Hz is ~12.5Hz wide) even
// when the two curves are IDENTICAL by construction — a false shape
// mismatch that has nothing to do with the comparison algorithm itself.
function makeFr({ startFreq = 20, endFreq = 20000, numPoints = 20000, gen }) {
  const freqStep = (endFreq - startFreq) / (numPoints - 1);
  const magnitude = new Float32Array(numPoints);
  for (let i = 0; i < numPoints; i++) magnitude[i] = gen(startFreq + i * freqStep);
  return { startFreq, freqStep, magnitude };
}

// Deterministic pseudo-measurement-noise (NOT Math.random — tests must be
// reproducible). ~±0.15dB, standing in for real mic/room ripple; negligible
// next to any effect under test here.
function noise(freq) {
  return 0.15 * Math.sin(freq / 137) * Math.cos(freq / 29 + 1);
}

function flatBaseline() {
  return makeFr({ gen: (f) => noise(f) });
}

// A "measured" capture that really is the given filter (plus noise, plus an
// optional constant offset simulating a device pregain/headroom backoff).
function withFilter(filterSpec, { offsetDb = 0, fs = SAMPLE_RATE } = {}) {
  return makeFr({ gen: (f) => theoreticalMagnitudeDb(filterSpec, f, fs) + offsetDb + noise(f) });
}

const DENSE_EVAL_FREQS = logSpacedFrequencies(20, 20000, 400); // finer than the bench's default 60 — needed to resolve sharp/high-Q peaks in these tests

function fit(baseline, measured, filterSpec, opts = {}) {
  const comparison = compareToTheoretical(baseline, measured, filterSpec, {
    magnitudeAt, fs: SAMPLE_RATE, evalFreqs: DENSE_EVAL_FREQS, ...opts,
  });
  const { pregainDb, compensated } = compensateForPregain(comparison);
  const judged = judgeFit(compensated, { rmseToleranceDb: 1.0, ...opts.judge });
  return { comparison, pregainDb, compensated, judged };
}

// ── "these are the same" cases ──────────────────────────────────────────────

test('a measurement that really is the filter matches it: low RMSE, high correlation, ~0 pregain', () => {
  const filterSpec = { freq: 1000, gain: 6, q: 1.0, type: 'PK' };
  const { pregainDb, compensated, judged } = fit(flatBaseline(), withFilter(filterSpec), filterSpec);

  assert.ok(Math.abs(pregainDb) < 0.3, `pregain should be ~0dB for a matching capture, got ${pregainDb.toFixed(3)}dB`);
  assert.ok(compensated.inBandStats.rmse < 0.5, `shape RMSE should be small, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
  assert.ok(compensated.inBandStats.correlation > 0.95, `correlation should be near 1, got ${compensated.inBandStats.correlation}`);
  assert.equal(judged.pass, true, judged.reason);
});

test('a broadband pregain offset is detected and removed before the shape is judged', () => {
  const filterSpec = { freq: 1000, gain: 6, q: 1.0, type: 'PK' };
  const baseline = flatBaseline();
  const measured = withFilter(filterSpec, { offsetDb: -2.1 }); // simulated headroom backoff

  const uncompensated = compareToTheoretical(baseline, measured, filterSpec, { magnitudeAt, fs: SAMPLE_RATE, evalFreqs: DENSE_EVAL_FREQS });
  assert.ok(uncompensated.overallStats.meanError < -1.5, 'uncompensated residual should show the pregain as a broadband bias');

  const { pregainDb, compensated, judged } = fit(baseline, measured, filterSpec);
  assert.ok(Math.abs(pregainDb - -2.1) < 0.3, `pregain should be detected close to -2.1dB, got ${pregainDb.toFixed(3)}dB`);
  assert.ok(compensated.inBandStats.rmse < 0.5, `shape should still fit tightly once pregain is compensated, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
  assert.equal(judged.pass, true, `shape should still pass once pregain is compensated: ${judged.reason}`);
});

// ── "these are NOT the same" cases — the actual point of this suite ────────

test('a sharp peak measured at the wrong frequency is flagged as a shape mismatch, not just a level difference', () => {
  // Same gain, same sharp Q, one octave apart — deliberately NOT a level/SPL
  // difference (both curves have an equally tall, equally narrow peak
  // somewhere); the only difference is WHERE the peak actually is.
  const expectedFilter = { freq: 100, gain: 8, q: 8, type: 'PK' };
  const actualFilter = { freq: 200, gain: 8, q: 8, type: 'PK' };
  const baseline = flatBaseline();

  // Sanity check: the correctly-placed capture fits its own expectation.
  const good = fit(baseline, withFilter(expectedFilter), expectedFilter);
  assert.equal(good.judged.pass, true, `100Hz peak should fit its own theoretical curve: ${good.judged.reason}`);

  // The real test: a capture whose peak actually landed an octave away must
  // NOT be judged a match for the 100Hz expectation.
  const bad = fit(baseline, withFilter(actualFilter), expectedFilter);
  assert.equal(bad.judged.inBandOk, false, 'a peak shifted a full octave should fail the in-band shape check');
  assert.equal(bad.judged.pass, false, 'a peak shifted a full octave should be flagged as a mismatch overall');
  assert.ok(bad.compensated.inBandStats.rmse > 3, `shape RMSE should be large for a mislocated peak, got ${bad.compensated.inBandStats.rmse.toFixed(3)}dB`);

  // The mismatch should be visibly worse than the matching case, not just
  // over some arbitrary threshold — guards against both sides silently
  // drifting together if the model or the noise function ever changes.
  assert.ok(bad.compensated.inBandStats.rmse > good.compensated.inBandStats.rmse * 5,
    `mismatched capture (${bad.compensated.inBandStats.rmse.toFixed(2)}dB) should be dramatically worse than the matching one (${good.compensated.inBandStats.rmse.toFixed(2)}dB)`);
});

test('an unrelated bump elsewhere in the curve is flagged as out-of-band leakage, even when the intended filter shape is correct', () => {
  const expectedFilter = { freq: 1000, gain: 6, q: 2, type: 'PK' };
  const spuriousBump = { freq: 6000, gain: 10, q: 6, type: 'PK' }; // something the filter has no business producing
  const baseline = flatBaseline();
  const measured = makeFr({
    gen: (f) =>
      theoreticalMagnitudeDb(expectedFilter, f, SAMPLE_RATE) +
      theoreticalMagnitudeDb(spuriousBump, f, SAMPLE_RATE) +
      noise(f),
  });

  const { compensated, judged } = fit(baseline, measured, expectedFilter);

  assert.ok(compensated.inBandStats.rmse < 1.0, `the intended 1kHz filter shape should still fit well on its own, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
  assert.equal(judged.outOfBandOk, false, 'the unrelated 6kHz bump should be flagged as out-of-band leakage');
  assert.equal(judged.pass, false, 'overall fit should fail due to leakage even though the intended filter shape matched');
});

// ── coverage for the LP/HP/etc. models added on top of PK/LSQ/HSQ ──────────

test('a newly-modeled type (LPF) shape-fits correctly against its own theoretical curve', () => {
  const filterSpec = { freq: 3000, gain: 0, q: 1.0, type: 'LPF' };
  const { judged } = fit(flatBaseline(), withFilter(filterSpec), filterSpec, { inBandThresholdDb: 1.0 });
  assert.equal(judged.pass, true, judged.reason);
});

// ── estimateEffectiveQ() — a "requested Q vs what actually explains this
// curve" diagnostic. Originally added after real Protocol Max captures
// seemed to show LSQ/HSQ shelves consistently running at ~0.7-0.8x their
// requested Q — that turned out to be a wrong-alpha-formula bug in our own
// model (see the comment on biquadCoefficients() and
// filter-response.real.test.js), not a real device characteristic. The
// diagnostic itself is still useful in general — this test just checks it
// correctly recovers an injected Q offset on synthetic data, independent of
// whether any specific real device actually has one. ──────────────────────

test('estimateEffectiveQ recovers a known injected Q defect (device implements a narrower/gentler Q than requested)', () => {
  const trueQ = 0.75;
  const requestedQ = 1.0;
  const filterAsActuallyImplemented = { freq: 1000, gain: 8, q: trueQ, type: 'LSQ' };
  const filterAsRequested = { freq: 1000, gain: 8, q: requestedQ, type: 'LSQ' };

  const baseline = flatBaseline();
  const measured = withFilter(filterAsActuallyImplemented); // the device thinks it's applying trueQ; we only ever ask it for requestedQ

  const est = estimateEffectiveQ(baseline, measured, filterAsRequested, { magnitudeAt, fs: SAMPLE_RATE });
  assert.ok(Math.abs(est.estimatedQ - trueQ) < 0.05, `should recover the injected Q≈${trueQ}, got ${est.estimatedQ.toFixed(3)}`);
  assert.ok(Math.abs(est.ratio - trueQ / requestedQ) < 0.05, `ratio should reflect the injected defect, got ${est.ratio.toFixed(3)}`);
  assert.ok(est.rmseAtEstimatedQ < 0.1, `RMSE at the estimated Q should be small — this is what "found the real Q" looks like, got ${est.rmseAtEstimatedQ.toFixed(3)}dB`);
  assert.equal(est.significant, true, 'a real, large improvement over the requested Q should be flagged significant');
});

// Found via a real devicepeq-rew-verification.html run: a PK filter that was
// ALREADY a good fit at the requested Q (RMSE ~0.15dB, correlation ~1.00 —
// well within normal tolerance) still showed "Effective Q: 30.00 (3000% of
// requested)" in the UI. Root cause: with a small enough nominal effect (or
// most of the signal absorbed by pregain compensation), zero points cross
// the in-band threshold, and the search falls back to the WHOLE curve —
// where a very high Q's "flat 0dB except a razor-thin spike at f0" can
// spuriously out-fit the true shape on ordinary broadband noise, and the
// raw grid search has no concept of "is this actually a better fit" to
// stop it from reporting that spurious point as the answer.
test('estimateEffectiveQ does not report a spurious extreme Q when the requested-Q fit is already good (the "3000%" bug)', () => {
  // Small nominal gain -> theoretical curve never reaches the 0.5dB in-band
  // threshold anywhere -> forces the exact fallback path that produced this
  // bug in practice.
  const filterSpec = { freq: 1000, gain: 0.3, q: 1.0, type: 'PK' };
  const baseline = flatBaseline();
  const measured = withFilter(filterSpec);

  const est = estimateEffectiveQ(baseline, measured, filterSpec, { magnitudeAt, fs: SAMPLE_RATE });
  assert.equal(est.significant, false,
    `should not report a significant Q finding for an already-good fit, got estimatedQ=${est.estimatedQ.toFixed(2)} ratio=${est.ratio.toFixed(2)} rmseAtRequestedQ=${est.rmseAtRequestedQ} rmseAtEstimatedQ=${est.rmseAtEstimatedQ.toFixed(4)}`);
});

test('estimateEffectiveQ does not falsely suggest a Q defect when the filter is implemented correctly', () => {
  const filterSpec = { freq: 1000, gain: 6, q: 1.0, type: 'PK' };
  const est = estimateEffectiveQ(flatBaseline(), withFilter(filterSpec), filterSpec, { magnitudeAt, fs: SAMPLE_RATE });
  assert.ok(Math.abs(est.ratio - 1.0) < 0.05, `a correctly-implemented filter should show ratio≈1.0, got ${est.ratio.toFixed(3)}`);
});
