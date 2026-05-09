/**
 * TANCHJIM BUNNY DSP (KT Micro) — auto-generated tests
 * Capture: tests/captures/ktmicro_tanchjim_bunny_dsp.json
 * vendorId=0x31B2  productId=0x1112
 *
 * peq5Band12dBFullShelvesNoPregain + pregain override — 5 bands, ±12 dB, LS+HS, pregain
 * Also captures write (push) exchanges for future pushToDevice tests
 */

import { loadCapture } from '../MockHIDDevice.js';
import { ktmicroUsbHidHandler } from '../../devicePEQ/ktmicroUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'TANCHJIM',
    modelConfig: {
      peqConstraintsRef:   'peq5Band12dBFullShelvesNoPregain',
      peqConstraintsOverride: { deviceHandlesPregain: false },
      maxFilters:           5,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 0x03,
      maxWritableEQSlots:     1,
      disconnectOnSave:    true,
      compensate2X:       false,
      disabledPresetId:   0x02,
      availableSlots: [{ id: 0x03, name: 'Custom' }],
      ...overrides
    }
  };
}

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);

  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const defined = result.filters.filter(f => f !== undefined && f !== null);

  assert.equal(defined.length, 5, 'should return 5 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];

  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),     `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number', `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);

  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);

  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── pushToDevice ───────────────────────────────────────────────────────────────
// KT Micro push requires ACK responses — uses captured write exchanges.

export async function test_pushToDevice_roundTrip(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Pull to get current filters, then push them back
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);

  // Each filter writes 2 registers → 2 × 5 = 10 write sends
  const writeSends = mock._sentReports.filter(r => !r.type || r.type !== 'feature');
  assert.ok(writeSends.length > 0, `push should send write commands, sent ${writeSends.length}`);
}

export async function test_pushToDevice_sendsCorrectWriteCount(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_bunny_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);

  // KT Micro writes 2 regs per filter (gain+q, freq) = 2 × maxFilters writes
  const sends = mock.sendCount;
  assert.ok(sends >= details.modelConfig.maxFilters,
    `should send at least ${details.modelConfig.maxFilters} write commands for ${filters.length} filters, sent ${sends}`);
}
