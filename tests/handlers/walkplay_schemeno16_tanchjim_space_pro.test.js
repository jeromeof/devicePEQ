/**
 * TANCHJIM-SPACE PRO (WalkPlay SchemeNo16) — auto-generated tests
 * Capture: tests/captures/walkplay_schemeno16_tanchjim_space_pro.json
 *
 * SchemeNo16: peq10Band10dBFullShelves — 10 bands, ±10 dB, LS+HS, pregain
 * vendorId=0x3302  productId=0x4367
 */

import { loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'WalkPlay',
    modelConfig: {
      peqConstraintsRef: 'peq10Band10dBFullShelves',
      schemeNo:           16,
      maxFilters:         10,
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

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns10Bands(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const defined = result.filters.filter(f => f !== undefined);

  assert.equal(defined.length, 10, 'SchemeNo16 should return 10 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];

  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),
      `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number' && f.freq >= 0,
      `filter[${i}].freq should be a number >= 0, got ${f.freq}`);
    assert.ok(typeof f.gain === 'number',
      `filter[${i}].gain should be a number, got ${f.gain}`);
  });
}

export async function test_pullFromDevice_gainsWithinSchemeNo16Range(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(f.gain >= -10 && f.gain <= 10,
      `filter[${i}].gain ${f.gain} should be within SchemeNo16 ±10 dB range`);
  });
}

export async function test_pullFromDevice_readsGlobalGain(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  assert.ok(typeof result.globalGain === 'number',
    `globalGain should be a number, got ${result.globalGain}`);
}

export async function test_pullFromDevice_sendsCorrectBandCount(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await walkplayUsbHID.pullFromDevice(details, 101);

  const filterReads = mock.sentBytes.filter(b => b[0] === 128 && b[1] === 9 && b.length === 6);
  assert.equal(filterReads.length, details.modelConfig.maxFilters,
    `should send exactly ${details.modelConfig.maxFilters} filter read requests`);
}

// ── pushToDevice ───────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsOnePacketPerBand(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters);

  // WRITE=0x01, CMD.PEQ_VALUES=0x09
  const bandWrites = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x09);
  assert.equal(bandWrites.length, details.modelConfig.maxFilters,
    `should send one write per band (${details.modelConfig.maxFilters}), sent ${bandWrites.length}`);
}

export async function test_pushToDevice_includesCorrectBandIndices(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
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
  const mock = await loadCapture('../captures/walkplay_schemeno16_tanchjim_space_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters);

  // deviceHandlesPregain=false for SchemeNo16 — explicit global gain write expected
  const gainWrite = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x03);
  assert.ok(gainWrite !== undefined,
    'SchemeNo16 (deviceHandlesPregain=false) should write global gain explicitly');
}
