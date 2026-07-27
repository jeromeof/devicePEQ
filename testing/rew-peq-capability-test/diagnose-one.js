#!/usr/bin/env node
// One-off diagnostic: push a single strong PK filter, read it back from the
// device (protocol-level check), take a REW measurement, rename it, and dump
// the frequency response around the filter's center so we can see the actual
// shape of the effect (not just one point) before trusting the full matrix.
const { connectDevice, closeHarness } = require('./device-session');
const rew = require('./rew-control');

async function main() {
  const { context, page, modelConfig } = await connectDevice();
  const slot = modelConfig.firstWritableEQSlot;
  const maxFilters = modelConfig.maxFilters;

  try {
    console.log('Connected. slot', slot, 'maxFilters', maxFilters);

    console.log('\n--- current device state before anything ---');
    const before = await page.evaluate((slot) => window.harness.pullFromDevice(slot), slot);
    console.log('globalGain:', before.globalGain, 'band0:', JSON.stringify(before.filters?.[0]));

    console.log('\n--- baseline: disabling PEQ ---');
    await page.evaluate((slot) => window.harness.enablePEQ(false, slot), slot);
    const baselineId = await rew.triggerMeasurement();
    await rew.renameMeasurement(baselineId, 'DIAG_00_Baseline_NoPEQ');
    const baselineFr = await rew.getFrequencyResponse(baselineId);
    console.log('baseline measurement id', baselineId);

    console.log('\n--- pushing single PK +10dB @ 1kHz Q=1 to band0, rest disabled, globalGain=0 ---');
    const testBand = { freq: 1000, gain: 10, q: 1, type: 'PK' };
    const filters = new Array(maxFilters).fill(null).map(() => ({ disabled: true }));
    filters[0] = { ...testBand, disabled: false };
    await page.evaluate((slot) => window.harness.enablePEQ(true, slot), slot);
    await page.evaluate(({ filters, slot }) => window.harness.pushFilters(filters, 0, slot), { filters, slot });

    console.log('\n--- reading back from device immediately after push ---');
    const after = await page.evaluate((slot) => window.harness.pullFromDevice(slot), slot);
    console.log('globalGain:', after.globalGain, 'band0:', JSON.stringify(after.filters?.[0]));

    console.log('\n--- measuring ---');
    const measId = await rew.triggerMeasurement();
    await rew.renameMeasurement(measId, 'DIAG_01_PK_10dB_f1000_Q1');
    const fr = await rew.getFrequencyResponse(measId);

    console.log('\n--- frequency response around 1kHz (baseline vs test) ---');
    for (const f of [200, 500, 800, 900, 950, 1000, 1050, 1100, 1200, 1500, 2000, 5000]) {
      const b = rew.magnitudeAt(baselineFr, f);
      const t = rew.magnitudeAt(fr, f);
      console.log(`  ${String(f).padStart(5)}Hz: baseline=${b.toFixed(2)}dB test=${t.toFixed(2)}dB delta=${(t - b).toFixed(2)}dB`);
    }

    console.log('\nRestoring No PEQ...');
    await page.evaluate((slot) => window.harness.enablePEQ(false, slot), slot);
  } finally {
    await closeHarness(context, page);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
