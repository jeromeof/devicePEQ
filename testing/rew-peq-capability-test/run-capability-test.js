#!/usr/bin/env node
// Semi-automated PEQ capability test.
//
// For a connected USB HID device (currently wired up for the WalkPlay-family
// "Protocol Max"), this:
//   1. For each filter type the device's peqConstraints profile supports
//      (PK always, LSQ/HSQ if flagged), pushes three single-band test filters:
//        - gain = maxGain, Q = 1.0 ("max volume")
//        - gain = minGain, Q = 1.0 ("min volume")
//        - gain = maxGain, Q = maxQ  (Q stress test at max gain)
//   2. Reads the filter back from the device (pullFromDevice) to verify the
//      write landed as intended, independent of any acoustic check — retries
//      a few times since individual PEQ_VALUES read requests occasionally
//      drop (observed ~10-20% of the time on Protocol Max).
//   3. Brackets each test with a FRESH flat (all-bands-disabled) baseline
//      measurement immediately BEFORE and AFTER it, rather than reusing one
//      baseline from the start of the run. Long test sessions accumulate
//      physical drift (IEM seal, mic position) that can look like device
//      behavior if compared against a stale baseline — bracketing surfaces
//      that drift explicitly instead of letting it contaminate the results.
//   4. Compares the measured magnitude delta (vs the AVERAGE of the two
//      bracketing baselines) at a fixed check frequency against the
//      theoretically expected delta, within tolerance. Also reports the
//      before/after baseline drift itself, so a result can be read alongside
//      how much drift was present during it.
//   5. Rolls results up into a peqConstraints verification summary — does
//      what the device actually does match what usbDeviceConfig.js/
//      peqConstraintsConfig.json *claim* it can do?
//
// One-time requirement: WebHID device pairing needs a manual click in the
// browser the very first time (native chooser can't be scripted). After that,
// the persistent browser profile in .pw-profile/ remembers the grant and this
// script runs unattended.
//
// Usage: node run-capability-test.js

const path = require('path');
const fs = require('fs');
const { connectDevice, closeHarness } = require('./device-session');
const rew = require('./rew-control');
const fr = require('./filter-response');
const { assertAudioPreflight } = require('./audio-preflight');

// Corner/check frequencies chosen ~1+ decade apart from the shelf corner so the
// shelf has mostly settled to its asymptotic gain by the check frequency. PK is
// checked exactly at its own center, where a peaking biquad reaches the full
// specified gain regardless of Q. Tune per-device if these don't suit its range.
const TEST_FREQ_BY_TYPE = {
  PK:  { filterFreq: 1000, checkFreq: 1000, toleranceDb: 1.0 },
  LSQ: { filterFreq: 1000, checkFreq: 50,   toleranceDb: 2.0 },
  HSQ: { filterFreq: 1000, checkFreq: 12000, toleranceDb: 2.0 },
};

function buildTestPlan(modelConfig) {
  const types = ['PK'];
  if (modelConfig.supportsLSFilter) types.push('LSQ');
  if (modelConfig.supportsHSFilter) types.push('HSQ');

  const plan = [];
  for (const type of types) {
    const { filterFreq, checkFreq, toleranceDb } = TEST_FREQ_BY_TYPE[type];
    const cases = [
      { gain: modelConfig.maxGain, q: 1.0, constraintField: 'maxGain', tag: 'maxGain_Q1' },
      { gain: modelConfig.minGain, q: 1.0, constraintField: 'minGain', tag: 'minGain_Q1' },
      { gain: modelConfig.maxGain, q: modelConfig.maxQ, constraintField: 'maxQ', tag: 'maxGain_maxQ' },
    ];
    for (const c of cases) {
      const label = `${type} @ ${c.gain}dB Q=${c.q}`;
      plan.push({ type, filterFreq, checkFreq, toleranceDb, ...c, label });
    }
  }
  return plan;
}

function buildFilters(maxFilters, testBand) {
  const filters = new Array(maxFilters).fill(null).map(() => ({ disabled: true }));
  if (testBand) filters[0] = { ...testBand, disabled: false };
  return filters;
}

// Independent, non-acoustic check: does what pullFromDevice reports match what
// we asked pushFilters to write? Confirms the protocol write landed correctly,
// decoupled from whether the audible/measured effect also matches.
function verifyReadback(pushed, readBack, tolerances = { freqPct: 0.05, gainDb: 0.5, q: 0.5 }) {
  if (!readBack || !Array.isArray(readBack.filters) || !readBack.filters[0]) {
    return { ok: false, reason: 'pullFromDevice returned no band 0 filter' };
  }
  const got = readBack.filters[0];
  if (pushed === null) {
    // Expecting an all-disabled flat state.
    return { ok: !!got.disabled, pushed: null, readBack: got };
  }
  const freqOk = Math.abs(got.freq - pushed.freq) <= pushed.freq * tolerances.freqPct;
  const gainOk = Math.abs(got.gain - pushed.gain) <= tolerances.gainDb;
  const qOk = Math.abs(got.q - pushed.q) <= tolerances.q;
  const typeOk = !got.type || got.type === pushed.type;
  const ok = freqOk && gainOk && qOk && typeOk;
  return { ok, pushed, readBack: got, freqOk, gainOk, qOk, typeOk };
}

// Pushes testBand to band 0 (or all-disabled if testBand is null) and
// verifies via pullFromDevice, retrying a few times — individual PEQ_VALUES
// read requests have been observed to drop ~10-20% of the time.
async function pushAndVerify(page, slot, maxFilters, testBand, { maxAttempts = 4, retryDelayMs = 1500 } = {}) {
  const filters = buildFilters(maxFilters, testBand);
  let check;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.evaluate(({ enable, slot }) => window.harness.enablePEQ(enable, slot), { enable: testBand !== null, slot });
    await page.evaluate(({ filters, slot }) => window.harness.pushFilters(filters, 0, slot), { filters, slot });
    await new Promise((r) => setTimeout(r, retryDelayMs));
    const readBack = await page.evaluate((slot) => window.harness.pullFromDevice(slot), slot);
    check = verifyReadback(testBand, readBack);
    if (check.ok) return check;
    console.log(`  readback ${testBand ? JSON.stringify(testBand) : 'all-disabled'} mismatch on attempt ${attempt}/${maxAttempts}, retrying...`);
  }
  return check;
}

async function takeMeasurement(name) {
  const id = await rew.triggerMeasurement();
  await rew.renameMeasurement(id, name);
  const fr = await rew.getFrequencyResponse(id);
  return { id, fr };
}

async function main() {
  console.log(`Checking REW API...`);
  console.log(`  ${await rew.checkRewReachable()}`);

  // Catch an audio format mismatch here rather than mid-sweep: REW's failure is
  // a modal dialog, which blocks the run and can't be dismissed over the API.
  console.log(`Checking audio formats...`);
  await assertAudioPreflight();

  console.log(`Connecting to device...`);
  const { context, page, modelConfig } = await connectDevice();

  let slot = null;

  try {
    console.log(`Connected. modelConfig:`, JSON.stringify(modelConfig, null, 2));

    slot = modelConfig.firstWritableEQSlot ?? modelConfig.availableSlots?.[0]?.id;
    const maxFilters = modelConfig.maxFilters ?? 10;
    if (slot == null) throw new Error('Could not determine a writable slot from modelConfig.');

    const plan = buildTestPlan(modelConfig);
    console.log(`\nTest plan (${plan.length} cases, each bracketed by before/after baselines):`);
    plan.forEach((c, i) => console.log(`  ${i + 1}. ${c.label} @ ${c.filterFreq}Hz (check @ ${c.checkFreq}Hz)`));

    const results = [];

    for (let i = 0; i < plan.length; i++) {
      const testCase = plan[i];
      const testBand = { freq: testCase.filterFreq, gain: testCase.gain, q: testCase.q, type: testCase.type };
      const tag = `${String(i + 1).padStart(2, '0')}_${testCase.type}_${testCase.tag}_f${testCase.filterFreq}`;
      console.log(`\n[${testCase.label}] ── bracketed run ──`);

      console.log(`[${testCase.label}] Flattening PEQ for baseline-before...`);
      await pushAndVerify(page, slot, maxFilters, null);
      const before = await takeMeasurement(`${tag}_baselineBefore`);
      console.log(`[${testCase.label}] baseline-before id=${before.id}`);

      console.log(`[${testCase.label}] Pushing filter: ${JSON.stringify(testBand)}`);
      const readbackCheck = await pushAndVerify(page, slot, maxFilters, testBand);
      console.log(`[${testCase.label}] readback: ${readbackCheck.ok ? 'OK' : 'MISMATCH (giving up after retries)'} — got=${JSON.stringify(readbackCheck.readBack)}`);
      const test = await takeMeasurement(`${tag}_test`);
      console.log(`[${testCase.label}] test id=${test.id}`);

      console.log(`[${testCase.label}] Flattening PEQ for baseline-after...`);
      await pushAndVerify(page, slot, maxFilters, null);
      const after = await takeMeasurement(`${tag}_baselineAfter`);
      console.log(`[${testCase.label}] baseline-after id=${after.id}`);

      const drift = rew.magnitudeAt(after.fr, testCase.checkFreq) - rew.magnitudeAt(before.fr, testCase.checkFreq);

      // Average the two bracketing baselines point-by-point (same REW sweep
      // config before/after, so grids line up) into one reference curve, then
      // fit the WHOLE measured delta curve against the theoretical biquad
      // shape rather than reading a single check frequency. A device that
      // auto-backs-off gain on a boost filter (headroom protection) shifts
      // the entire curve down by a constant — compensateForPregain() detects
      // and removes that constant before judging the actual filter shape.
      const avgBaselineFr = {
        startFreq: before.fr.startFreq,
        freqStep: before.fr.freqStep,
        magnitude: before.fr.magnitude.map((v, i) => (v + after.fr.magnitude[i]) / 2),
      };
      const filterSpec = { freq: testCase.filterFreq, gain: testCase.gain, q: testCase.q, type: testCase.type };
      const comparison = fr.compareToTheoretical(avgBaselineFr, test.fr, filterSpec, { magnitudeAt: rew.magnitudeAt });
      const { pregainDb, compensated } = fr.compensateForPregain(comparison);
      const judged = fr.judgeFit(compensated, { rmseToleranceDb: testCase.toleranceDb });
      const expectedDelta = testCase.gain;
      const measuredDelta = rew.magnitudeAt(test.fr, testCase.checkFreq) - rew.magnitudeAt(avgBaselineFr, testCase.checkFreq);
      const acousticPass = judged.pass;

      results.push({
        label: testCase.label, type: testCase.type, constraintField: testCase.constraintField,
        checkFreq: testCase.checkFreq, expectedDelta, measuredDelta,
        pregainDb, shapeRmse: compensated.inBandStats?.rmse ?? null,
        shapeMaxErr: compensated.inBandStats?.maxAbsError ?? null,
        correlation: compensated.inBandStats?.correlation ?? null,
        tolerance: testCase.toleranceDb, acousticPass, judgeReason: judged.reason, drift,
        readbackOk: readbackCheck.ok, readbackDetail: readbackCheck,
        measurementIds: { before: before.id, test: test.id, after: after.id },
      });

      console.log(`[${testCase.label}] raw measured@checkFreq=${measuredDelta.toFixed(2)}dB pregain=${pregainDb.toFixed(2)}dB shapeRmse=${compensated.inBandStats?.rmse?.toFixed(2)}dB corr=${compensated.inBandStats?.correlation?.toFixed(2)} drift=${drift.toFixed(2)}dB -> ${acousticPass ? 'ACOUSTIC PASS' : 'ACOUSTIC FAIL'} (${judged.reason})`);
    }

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(`\n${'='.repeat(78)}`);
    console.log('REPORT');
    console.log('='.repeat(78));
    let acousticPassCount = 0, readbackPassCount = 0;
    for (const r of results) {
      const rbMark = r.readbackOk ? '✅' : '❌';
      const acMark = r.acousticPass ? '✅' : '❌';
      console.log(`${r.label}`);
      console.log(`  readback:  ${rbMark} write landed as pushed`);
      console.log(`  acoustic:  ${acMark} expected ${r.expectedDelta.toFixed(2)}dB, measured@checkFreq ${r.measuredDelta.toFixed(2)}dB, pregain ${r.pregainDb.toFixed(2)}dB, shape RMSE ${r.shapeRmse?.toFixed(2)}dB (tol ±${r.tolerance}dB), corr ${r.correlation?.toFixed(2)}, baseline drift ${r.drift.toFixed(2)}dB — ${r.judgeReason}`);
      if (r.readbackOk) readbackPassCount++;
      if (r.acousticPass) acousticPassCount++;
    }
    console.log(`\n${readbackPassCount}/${results.length} readback-verified, ${acousticPassCount}/${results.length} acoustically confirmed`);
    const maxDrift = Math.max(...results.map((r) => Math.abs(r.drift)));
    console.log(`Max baseline drift observed across all brackets: ${maxDrift.toFixed(2)}dB`);

    // ── peqConstraints verification summary ──────────────────────────────────
    console.log(`\n${'='.repeat(78)}`);
    console.log('peqConstraints VERIFICATION');
    console.log('='.repeat(78));
    const byField = {};
    for (const r of results) {
      byField[r.constraintField] = byField[r.constraintField] || [];
      byField[r.constraintField].push(r);
    }
    for (const [field, rs] of Object.entries(byField)) {
      const allOk = rs.every((r) => r.readbackOk && r.acousticPass);
      console.log(`${allOk ? '✅' : '⚠️ '} ${field}: ${rs.filter((r) => r.readbackOk && r.acousticPass).length}/${rs.length} filter types confirmed`);
    }
    const supportFields = ['supportsLSFilter', 'supportsHSFilter'].filter((f) => Object.prototype.hasOwnProperty.call(modelConfig, f));
    for (const f of supportFields) {
      const type = f === 'supportsLSFilter' ? 'LSQ' : 'HSQ';
      const tested = results.filter((r) => r.type === type);
      if (modelConfig[f] && tested.length === 0) {
        console.log(`⚠️  ${f}=true but no ${type} tests ran (unexpected — check buildTestPlan)`);
      } else if (modelConfig[f]) {
        const allOk = tested.every((r) => r.readbackOk && r.acousticPass);
        console.log(`${allOk ? '✅' : '⚠️ '} ${f}=true: ${type} tests ${allOk ? 'confirm this' : 'do NOT fully confirm this — investigate handler/constraints'}`);
      }
    }

    // ── Pregain / clipping-relevant rollup ────────────────────────────────────
    console.log(`\n${'='.repeat(78)}`);
    console.log('PREGAIN SUMMARY');
    console.log('='.repeat(78));
    for (const r of results) {
      console.log(`   ${r.label}: pregain ${r.pregainDb.toFixed(2)}dB`);
    }
    const overDelivered = results.filter((r) => r.pregainDb > 0.5); // measured MORE broadband gain than requested
    if (overDelivered.length) {
      console.log(`⚠️  ${overDelivered.length} case(s) measured MORE broadband gain than requested (positive pregain — potential clipping/overshoot risk):`);
      overDelivered.forEach((r) => console.log(`   - ${r.label}: pregain ${r.pregainDb.toFixed(2)}dB`));
    } else {
      console.log(`✅ No case measured more broadband gain than requested — pregain is consistently ≤0 (device backs off or matches, never overshoots).`);
    }

    // ── Cleanup: leave device in NoPEQ state ─────────────────────────────────
    console.log(`\nRestoring device to No PEQ...`);
    await pushAndVerify(page, slot, maxFilters, null);

    const outPath = path.join(__dirname, `results-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ modelConfig, results }, null, 2));
    console.log(`\nFull results saved to ${outPath}`);
  } finally {
    if (page && slot != null) {
      try { await page.evaluate((slot) => window.harness.enablePEQ(false, slot), slot); } catch (_) {}
    }
    await closeHarness(context, page);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
