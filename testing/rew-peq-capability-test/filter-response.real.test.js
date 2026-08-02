// Real-capture companion to filter-response.test.js.
//
// filter-response.test.js proves the comparison MATH is correct using
// synthetic curves built from the same model it's checking (so it can dial
// in precise edge cases, but can't catch "does this actually line up with
// real hardware/REW output"). This suite runs the identical algorithm
// against a real capture from devicepeq-rew-verification.html — a real
// Protocol Max (WalkPlay SchemeNo16) device, real REW sweeps, real mic noise
// — to catch anything synthetic data structurally can't: wrong sample-rate
// assumption, a decode bug, a real device's biquad not actually matching the
// RBJ model, etc.
//
// Fixtures (both downsampled from raw ~0.336Hz-resolution REW exports — see
// the comment on each fixture's use below for how much precision that costs):
//   - protocol-max-q-sweep.json: flat 0dB baseline + three PK filters at
//     Q 5.1/5.1/10 (the verification tool's "Q Sweep" test group).
//   - protocol-max-full-plan.json: a later, larger run — 18 measurements
//     covering Filter Types / Gain Sweep / Q Sweep / Frequency Sweep / Shelf
//     Extremes. This is the run that surfaced the LSQ/HSQ finding below.
// Regenerate either by re-running the verification tool and re-exporting if they ever
// need refreshing.
//
// Run with:  node --test testing/rew-peq-capability-test/filter-response.real.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareToTheoretical, compensateForPregain, judgeFit, logSpacedFrequencies, estimateEffectiveQ,
} = require('./filter-response');
const { magnitudeAt } = require('./rew-control');
const fixture = require('./captures/protocol-max-q-sweep.json');
const fullPlanFixture = require('./captures/protocol-max-full-plan.json');

// The verification tool's current defaults (devicepeq-rew-verification.html) — 200
// log-spaced eval points and a 0.3dB RMSE tolerance, tightened from the
// original 60 points / 1.5dB specifically to catch moderate Q-implementation
// defects (e.g. a device quantizing Q to a coarse lookup table) that the
// looser original defaults let through.
const BENCH_EVAL_FREQS = logSpacedFrequencies(20, 20000, 200);
const BENCH_TOLERANCE_DB = 0.3;

function recompute(measurement) {
  const comparison = compareToTheoretical(fixture.baseline.fr, measurement.fr, measurement.filterSpec, {
    magnitudeAt, fs: fixture.sampleRate,
  });
  const { pregainDb, compensated } = compensateForPregain(comparison);
  const judged = judgeFit(compensated, { rmseToleranceDb: 1.0 });
  return { pregainDb, compensated, judged };
}

test('fixture sanity: baseline and all three captures loaded with matching grids', () => {
  assert.equal(fixture.device, 'Protocol Max');
  assert.equal(fixture.measurements.length, 3);
  for (const m of fixture.measurements) {
    assert.equal(m.fr.startFreq, fixture.baseline.fr.startFreq, `measurement ${m.id} grid should match baseline`);
    assert.equal(m.fr.freqStep, fixture.baseline.fr.freqStep, `measurement ${m.id} grid should match baseline`);
  }
});

for (const m of fixture.measurements) {
  test(`real capture #${m.id} (${JSON.stringify(m.filterSpec)}): recomputed fit reproduces what the verification tool recorded live`, () => {
    const { pregainDb, compensated, judged } = recompute(m);
    const bench = m.recordedFromBench;

    // The tool recorded "pass" on all three at capture time (full-resolution
    // curve, live run) — recomputing from the ~6x downsampled fixture should
    // reach the same verdict...
    assert.equal(judged.pass, true, `expected pass, got fail: ${judged.reason}`);
    assert.equal(bench.status, 'pass', 'sanity: fixture should carry a "pass" from the original live run');

    // ...and the actual numbers should be close, not just the boolean —
    // downsampling ~6x costs very little precision (observed ~0.005dB) since
    // the fixture resolution is still far finer than any feature under test.
    assert.ok(Math.abs(pregainDb - bench.pregainDb) < 0.05,
      `pregain should closely match the bench's live recording: recomputed=${pregainDb.toFixed(4)}dB, bench=${bench.pregainDb.toFixed(4)}dB`);
    assert.ok(Math.abs(compensated.inBandStats.rmse - bench.shapeRmse) < 0.02,
      `shape RMSE should closely match: recomputed=${compensated.inBandStats.rmse.toFixed(4)}dB, bench=${bench.shapeRmse.toFixed(4)}dB`);
    assert.ok(Math.abs(compensated.inBandStats.correlation - bench.correlation) < 0.001,
      `correlation should closely match: recomputed=${compensated.inBandStats.correlation.toFixed(6)}, bench=${bench.correlation.toFixed(6)}`);
  });
}

// ── Negative controls: real captures cross-checked against EACH OTHER's ───
// specs. The tests above only prove each capture matches its own spec —
// that's necessary but not sufficient; an algorithm that said "yes, matches"
// for everything would pass them too. These prove the fit actually
// discriminates real, physically-distinct filter responses from each other.
function recomputeAgainst(measurementFr, filterSpec) {
  const comparison = compareToTheoretical(fixture.baseline.fr, measurementFr, filterSpec, {
    magnitudeAt, fs: fixture.sampleRate,
  });
  const { compensated } = compensateForPregain(comparison);
  return { compensated, judged: judgeFit(compensated, { rmseToleranceDb: 1.0 }) };
}

const byId = (id) => fixture.measurements.find((x) => x.id === id);

test('real capture at 900Hz does not match the spec for the real capture at 1000Hz (frequency differs)', () => {
  const m900 = byId(1), m1000 = byId(2); // both Q=5.1, only center freq differs
  const { compensated, judged } = recomputeAgainst(m900.fr, m1000.filterSpec);
  assert.equal(judged.pass, false, 'a peak measured 100Hz away from the claimed center should not pass');
  assert.ok(compensated.inBandStats.rmse > 1.0, `shape RMSE should exceed tolerance, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
});

test('real captures at the same frequency but different Q do not match each other (bandwidth differs)', () => {
  const q5 = byId(2), q10 = byId(3); // both centered at 1000Hz, Q=5.1 vs Q=10
  const { compensated, judged } = recomputeAgainst(q5.fr, q10.filterSpec);
  assert.equal(judged.pass, false, 'a Q=5.1 peak should not pass as a Q=10 peak');
  assert.ok(compensated.inBandStats.rmse > 1.0, `shape RMSE should exceed tolerance, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
  // Notably this one is caught by RMSE, not correlation — same center freq
  // means the two curves still rise and fall together (correlation stays
  // high, ~0.99), but the actual dB magnitude at each point differs because
  // the peak widths differ. A width-only difference is exactly the kind of
  // mismatch correlation alone would miss; RMSE is what catches it here.
  assert.ok(compensated.inBandStats.correlation > 0.9, 'correlation stays high for a width-only difference — RMSE is what should be failing this, not correlation');
});

test('tightened bench defaults (200 eval points, 0.3dB tolerance) catch a moderate Q error the old defaults (60 points, 1.5dB) missed', () => {
  const trueCapture = byId(2); // real capture, actual Q=5.1 @ 1000Hz, +6dB
  const badlyImplementedQ = { freq: 1000, gain: 6, q: 7, type: 'PK' }; // ~37% off — plausible if a device quantizes Q to a coarse lookup table

  const oldComparison = compareToTheoretical(fixture.baseline.fr, trueCapture.fr, badlyImplementedQ, {
    magnitudeAt, fs: fixture.sampleRate, evalFreqs: logSpacedFrequencies(20, 20000, 60),
  });
  const oldJudged = judgeFit(compensateForPregain(oldComparison).compensated, { rmseToleranceDb: 1.5 });
  assert.equal(oldJudged.pass, true, 'sanity: the OLD loose defaults should have let this Q error through — that was the actual problem being fixed');

  const newComparison = compareToTheoretical(fixture.baseline.fr, trueCapture.fr, badlyImplementedQ, {
    magnitudeAt, fs: fixture.sampleRate, evalFreqs: BENCH_EVAL_FREQS,
  });
  const newJudged = judgeFit(compensateForPregain(newComparison).compensated, { rmseToleranceDb: BENCH_TOLERANCE_DB });
  assert.equal(newJudged.pass, false, `the current tighter bench defaults should catch a ~37% Q error: ${newJudged.reason}`);
});

test('a flat/no-filter capture does not match any real filter spec (sanity negative control)', () => {
  const flatAsIfMeasured = { fr: fixture.baseline.fr };
  const claimedFilter = byId(2).filterSpec; // +6dB Q=5.1 @ 1000Hz — should be obviously absent from a flat curve
  const { compensated, judged } = recomputeAgainst(flatAsIfMeasured.fr, claimedFilter);
  assert.equal(judged.pass, false, 'a flat capture should never be judged a match for a boosted filter');
  assert.ok(compensated.inBandStats.rmse > 1.0, `shape RMSE should exceed tolerance, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
});

// Capture #1 is a real-world illustration of why the whole-curve shape fit
// exists: the plan's "measure @ Hz" field (1000) went stale after the
// filter's own frequency was edited to 900 in the plan table before the run
// — a single-point check at 1000Hz sees almost none of a filter that's
// actually centered an octave-ish away, and would have been called a FAIL
// against the 6dB expectation. The shape fit isn't fooled by that, because
// it compares the whole curve against the theoretical curve for the filter
// that was ACTUALLY pushed (freq:900), not against the stale check frequency.
test('real capture #1: a stale single-point check frequency would have looked like a failure; the shape fit is not fooled', () => {
  const m = fixture.measurements.find((x) => x.id === 1);
  assert.equal(m.filterSpec.freq, 900, 'sanity: this capture is the one with the freq/measureFreq mismatch');
  assert.equal(m.measureFreq, 1000);

  const naiveSinglePointDelta = m.recordedFromBench.measuredDelta; // magnitude@1000Hz, measured − baseline
  const expectedDelta = 6; // the filter's own gain
  assert.ok(Math.abs(naiveSinglePointDelta - expectedDelta) > 5,
    `a single-point check at the stale 1000Hz frequency should look like a big miss vs the expected 6dB, got measured=${naiveSinglePointDelta.toFixed(2)}dB`);

  const { judged } = recompute(m);
  assert.equal(judged.pass, true, 'the full-curve shape fit against the filter that was actually pushed (900Hz) should still pass');
});

// ── Protocol Max shelf-Q investigation — resolved as a model bug, not a
// device characteristic. Locked in as regression coverage. ────────────────
//
// History: all six real LSQ/HSQ captures in protocol-max-full-plan.json (3
// frequencies, both boost and cut, requested Q=1.0 throughout) originally
// failed their shape fit, and estimateEffectiveQ() landed at a suspiciously
// tight 0.70-0.80 cluster — which looked at first like a real firmware
// characteristic (shelves running gentler than requested). It wasn't.
//
// Cross-checking against an independent, W3C-spec'd reference — a real
// WebAudio OfflineAudioContext BiquadFilterNode — showed these same captures
// fit the STANDARD RBJ/WebAudio shelf-Q formula
// (alpha = sin(w0)/2 * sqrt((A+1/A)*(1/Q-1)+2)) to within 0.05-0.23dB RMSE,
// while our model (mirroring computeIIRFilter()'s simplified peaking-style
// alpha = sin(w0)/(2Q)) was off by 0.6-1.1dB. biquadCoefficients() here was
// fixed to use the proper shelf alpha for LSQ/HSQ — see the comment above it.
// That fix is what these assertions now pin down: effective Q should land at
// ~1.0 (the formula now correctly explains the real device without needing
// to search for a "wrong" Q), and the captures should PASS outright at the
// bench's tightened defaults (200 eval points, 0.3dB tolerance) — the exact
// defaults that used to fail all six of them.
//
// (walkplayHidHandler.js's computeIIRFilter() likely has the same alpha bug
// for real — this only fixes the verification MODEL, not what's actually
// pushed to devices. That's a separate, deliberately unapplied change: it's
// shared by every WalkPlay-family device in peqConstraintsConfig.json, so it
// needs sign-off before touching production push code.)

test('Protocol Max: every real LSQ/HSQ capture passes outright once the model uses the proper shelf-Q formula', () => {
  const shelfMeasurements = fullPlanFixture.measurements.filter((m) => m.filterSpec.type === 'LSQ' || m.filterSpec.type === 'HSQ');
  assert.equal(shelfMeasurements.length, 6, 'sanity: expecting all 6 shelf captures from the full-plan run');

  // NOTE: deliberately not using recompute() — that helper closes over the
  // OTHER fixture's (protocol-max-q-sweep.json) baseline. Comparing against
  // the wrong baseline silently produces bogus, much-worse-looking fits.
  for (const m of shelfMeasurements) {
    const comparison = compareToTheoretical(fullPlanFixture.baseline.fr, m.fr, m.filterSpec, {
      magnitudeAt, fs: fullPlanFixture.sampleRate, evalFreqs: BENCH_EVAL_FREQS,
    });
    const { compensated } = compensateForPregain(comparison);
    const judged = judgeFit(compensated, { rmseToleranceDb: BENCH_TOLERANCE_DB });
    assert.equal(judged.pass, true, `${m.filterSpec.type} @ ${m.filterSpec.freq}Hz ${m.filterSpec.gain}dB should now pass: ${judged.reason}`);
    assert.ok(compensated.inBandStats.rmse < BENCH_TOLERANCE_DB, `RMSE should be well within tolerance, got ${compensated.inBandStats.rmse.toFixed(3)}dB`);
  }
});

test('Protocol Max: effective-Q search now lands at ~1.0 for real shelf captures — the "0.7-0.8x" finding was the model, not the device', () => {
  const shelfMeasurements = fullPlanFixture.measurements.filter((m) => m.filterSpec.type === 'LSQ' || m.filterSpec.type === 'HSQ');

  const ratios = [];
  for (const m of shelfMeasurements) {
    const est = estimateEffectiveQ(fullPlanFixture.baseline.fr, m.fr, m.filterSpec, { magnitudeAt, fs: fullPlanFixture.sampleRate });
    ratios.push(est.ratio);
    assert.ok(
      Math.abs(est.ratio - 1.0) < 0.15,
      `${m.filterSpec.type} @ ${m.filterSpec.freq}Hz ${m.filterSpec.gain}dB: expected effective-Q ratio near 1.0 now, got ${est.ratio.toFixed(3)}`
    );
    assert.ok(est.rmseAtEstimatedQ < 0.3, `RMSE at the estimated Q should be small, got ${est.rmseAtEstimatedQ.toFixed(3)}dB`);
  }

  // Should still cluster tightly — same real captures, same underlying
  // consistency — just centered on ~1.0 instead of ~0.73.
  const spread = Math.max(...ratios) - Math.min(...ratios);
  assert.ok(spread < 0.15, `ratios should cluster tightly — spread was ${spread.toFixed(3)} (${ratios.map((r) => r.toFixed(3))})`);
});

test('Protocol Max: PK captures (which already pass shape-fit) show no such effective-Q offset', () => {
  const pkMeasurements = fullPlanFixture.measurements.filter((m) => m.filterSpec.type === 'PK');
  assert.ok(pkMeasurements.length >= 5, 'sanity: expecting several PK captures from the full-plan run');

  for (const m of pkMeasurements) {
    const est = estimateEffectiveQ(fullPlanFixture.baseline.fr, m.fr, m.filterSpec, { magnitudeAt, fs: fullPlanFixture.sampleRate });
    assert.ok(Math.abs(est.ratio - 1.0) < 0.15,
      `PK @ ${m.filterSpec.freq}Hz Q=${m.filterSpec.q}: expected ratio≈1.0 (no defect), got ${est.ratio.toFixed(3)}`);
  }
});
