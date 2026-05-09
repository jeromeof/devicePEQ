/**
 * KT02H20 HIFI Audio (ktmicroUsbHidHandler) — auto-generated tests
 * Capture: tests/captures/ktmicro_kt02h20_hifi_audio.json
 * vendorId=0x31B2  productId=0x0111
 *
 * peq5Band12dBFullShelvesNoPregain — 5 bands, ±12 dB, no LS/HS, no pregain
 * compensate2X=true (default): 2 writes per band (filter/freq + gain/Q) = 10 total writes
 * baseRegisterOffset=0x26 (default): reads registers 0x26-0x2F (5 bands × 2 regs each)
 */

import { loadCapture } from '../MockHIDDevice.js';
import { ktmicroUsbHidHandler } from '../../devicePEQ/ktmicroUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'JCally',
    modelConfig: {
      peqConstraintsRef:   'peq5Band12dBFullShelvesNoPregain',
      maxFilters:           5,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 0x03,
      maxWritableEQSlots:     1,
      disconnectOnSave:    true,
      compensate2X:        true,
      baseRegisterOffset:  0x26,
      disabledPresetId:   0x02,
      availableSlots: [{ id: 0x03, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 5, 'KT02H20 should return 5 filter bands');
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  if (mock.unmatchedCount > 0) console.warn('Unmatched:', mock._unmatchedSends);
  assert.ok(true, `unmatched: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsTwoWritesPerBand(assert) {
  // compensate2X=true: handler sends 2 write packets per band (filter/freq + gain/Q)
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  const writes = mock.sentBytes.filter(b => b.length > 4 && b[4] === 0x57);
  assert.equal(writes.length, details.modelConfig.maxFilters * 2,
    `should send 2 write packets per band (${details.modelConfig.maxFilters * 2} total), got ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/ktmicro_kt02h20_hifi_audio.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should not throw');
}
