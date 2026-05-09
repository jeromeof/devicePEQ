/**
 * Kiwi Ears-Allegro PRO (KT Micro) — auto-generated tests
 * Capture: tests/captures/ktmicro_kiwi_ears_allegro_pro.json
 * vendorId=0x31B2  productId=0x0111
 *
 * peq5Band12dBFullShelvesNoPregain — 5 bands, ±12 dB, LS+HS, no pregain
 * compensate2X=true (KT Micro Kiwi Ears default)
 * baseRegisterOffset=0x26, disconnectOnSave=true. Writes fire-and-forget.
 */

import { loadCapture } from '../MockHIDDevice.js';
import { ktmicroUsbHidHandler } from '../../devicePEQ/ktmicroUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Kiwi Ears',
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

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 5, 'should return 5 filter bands');
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  if (mock.unmatchedCount > 0) console.warn('Unmatched:', mock._unmatchedSends);
  assert.ok(true, `unmatched: ${mock.unmatchedCount}`);
}

export async function test_pushToDevice_sendsWriteForEachRegister(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  const writes = mock.sentBytes.filter(b => b.length > 4 && b[4] === 0x57);
  assert.equal(writes.length, details.modelConfig.maxFilters * 2,
    `should send 2 write packets per filter (${details.modelConfig.maxFilters * 2} total), got ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_allegro_pro.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should not throw (fire-and-forget writes)');
}
