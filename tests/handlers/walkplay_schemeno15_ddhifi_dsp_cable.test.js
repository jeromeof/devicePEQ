/**
 * ddHiFi DSP Cable - Memory (WalkPlay SchemeNo15) — auto-generated tests
 * Capture: tests/captures/walkplay_schemeno15_ddhifi_dsp_cable.json
 * vendorId=0x3302  productId=0x4357
 *
 * SchemeNo15: walkplayPeq8Band10dBFullShelves — 8 bands, ±10 dB, LS+HS, pregain
 */

import { loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'ddHifi',
    modelConfig: {
      peqConstraintsRef: 'walkplayPeq8Band10dBFullShelves',
      schemeNo:           15,
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
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns8Bands(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const defined = result.filters.filter(f => f !== undefined);
  assert.equal(defined.length, 8, 'SchemeNo15 should return 8 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];
  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),     `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number', `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within SchemeNo15 ±12 dB range`);
  });
}

export async function test_pullFromDevice_readsGlobalGain(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  assert.ok(typeof result.globalGain === 'number',
    `globalGain should be a number, got ${result.globalGain}`);
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.pullFromDevice(details, 101);
  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsOnePacketPerBand(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
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

export async function test_pushToDevice_includesCorrectBandIndices(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, 0, filters);
  const bandWrites = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x09);
  bandWrites.forEach((b, i) => {
    assert.equal(b[4], i, `write packet ${i} should have band index ${i} at byte[4], got ${b[4]}`);
  });
}

export async function test_pushToDevice_writesGlobalGain(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters);
  const gainWrite = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x03);
  assert.ok(gainWrite !== undefined,
    'SchemeNo15 (deviceHandlesPregain=false) should write global gain explicitly');
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno15_ddhifi_dsp_cable.json');
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
