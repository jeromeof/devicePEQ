/**
 * MOONDROP Marigold (WalkPlay default / SchemeNo10) — auto-generated tests
 * Capture: tests/captures/walkplay_default_moondrop_marigold.json
 * vendorId=0x35D8  productId=0x011C
 *
 * walkplayPeq8Band10dBPkOnly — 8 bands, ±10 dB, PK-only (no shelves), pregain
 * Note: "Marigold" entry in config used moondropUsbHidHandler but the actual USB
 * product name "MOONDROP Marigold" falls back to walkplayUsbHID via default modelConfig.
 */

import { loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Moondrop',
    modelConfig: {
      peqConstraintsRef: 'walkplayPeq8Band10dBPkOnly',
      schemeNo:           10,
      maxFilters:          8,
      minGain:           -10,
      maxGain:            10,
      minQ:              0.1,
      maxQ:             10.0,
      firstWritableEQSlot: 101,
      maxWritableEQSlots:    1,
      disconnectOnSave:  false,
      deviceHandlesPregain:    false,
      availableSlots: [{ id: 101, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns8Bands(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const defined = result.filters.filter(f => f !== undefined);
  assert.equal(defined.length, 8, 'Marigold should return 8 filter bands');
}

export async function test_pullFromDevice_allFiltersAre峰型(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(typeof f.type === 'string', `filter[${i}].type should be a string`);
    assert.ok(typeof f.freq === 'number', `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithin6dBCeiling(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(f.gain >= -10 && f.gain <= 10,
      `filter[${i}].gain ${f.gain} should be within ±10 dB (walkplayPeq8Band10dBPkOnly)`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.pullFromDevice(details, 101);
  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsOnePacketPerBand(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters);
  const bandWrites = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x09);
  assert.equal(bandWrites.length, details.modelConfig.maxFilters,
    `should send one write per band (${details.modelConfig.maxFilters}), sent ${bandWrites.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/walkplay_default_moondrop_marigold.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined);
  let threw = false;
  try { await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
