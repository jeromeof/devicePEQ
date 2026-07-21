/**
 * Kiwi Ears Chorus (KT Micro) — auto-generated tests
 * Capture: tests/captures/ktmicro_kiwi_ears_chorus.json
 * vendorId=0x31B2  productId=0x1132
 *
 * Device reports the generic productName "Kiwi Ears" (NOT "Chorus") — a name other
 * Kiwi Ears models may also use — so it is matched by productId 0x1132 via the KT Micro
 * vendor's deviceGroups, NOT by productName. Without that match it falls back to the
 * vendor defaultModelConfig (compensate2X=true, baseRegisterOffset=0x26) and reads the
 * wrong register bank, producing incorrect values.
 *
 * peq5Band12dBFullShelvesNoPregain — 5 bands, ±12 dB, LS+HS, no pregain
 * compensate2X=false       (frequencies are raw, matching equalizer.kiwiears.com)
 * Register map (official Kiwi Ears KT_1132L): bands 0-3 at 0x35-0x3C, band4 freq 0x3D,
 *   BAND4 Q AT 0x3F (0x3E is a phantom register, always reads 0.7). Confirmed on-device.
 * Writes fire-and-forget (no ACK from device)
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
      compensate2X:        false,
      bandRegisters: [            // band4 Q at 0x3F (0x3E is skipped)
        { freq: 0x35, q: 0x36 },
        { freq: 0x37, q: 0x38 },
        { freq: 0x39, q: 0x3A },
        { freq: 0x3B, q: 0x3C },
        { freq: 0x3D, q: 0x3F }
      ],
      disabledPresetId:   0x02,
      availableSlots: [{ id: 0x03, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 5, 'should return 5 filter bands');
}

export async function test_pullFromDevice_decodesChorusFrequencies(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  // Ground truth confirmed against equalizer.kiwiears.com display (no 2x compensation).
  assert.deepEqual(
    result.filters.map(f => f.freq),
    [61, 105, 184, 243, 316],
    'should decode raw Chorus frequencies from baseRegisterOffset 0x35'
  );
}

export async function test_pullFromDevice_decodesChorusGains(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  assert.deepEqual(
    result.filters.map(f => f.gain),
    [1.5, -1.4, 1.1, -1.3, 1.3],
    'should decode gain as signed 16-bit / 10'
  );
}

export async function test_pullFromDevice_decodesBand4QFrom0x3F(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  // Bands 0-3 are at Q 0.7; band4 Q comes from 0x3F (= 0.8 in this capture), proving the
  // handler reads 0x3F not the phantom 0x3E (which always reads 0.7).
  assert.deepEqual(
    result.filters.map(f => f.q),
    [0.7, 0.7, 0.7, 0.7, 0.8],
    'band4 Q must be read from 0x3F (0.8), not the phantom 0x3E (0.7)'
  );
  result.filters.forEach((f, i) => {
    assert.equal(f.type, 'PK', `filter[${i}].type should be PK`);
  });
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  if (mock.unmatchedCount > 0) console.warn('Unmatched:', mock._unmatchedSends);
  assert.equal(mock.unmatchedCount, 0, `unmatched sends should be 0, got ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────
// Push was not exercised in the capture, but writes are fire-and-forget and only
// getCurrentSlot (reg 0x24) needs a response — present in the capture — so these
// validate the write path against the correct 0x35 register layout.

export async function test_pushToDevice_sendsWriteForEachRegister(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
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

export async function test_pushToDevice_writesToBase0x35Registers(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  const writeRegs = mock.sentBytes.filter(b => b.length > 4 && b[4] === 0x57).map(b => b[0]);
  // bands 0-3 consecutive from 0x35; band4 freq 0x3D, band4 Q 0x3F (0x3E skipped)
  assert.deepEqual(writeRegs, [0x35,0x36, 0x37,0x38, 0x39,0x3A, 0x3B,0x3C, 0x3D,0x3F],
    'writes should target the KT_1132L register map with band4 Q at 0x3F');
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_chorus.json');
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
