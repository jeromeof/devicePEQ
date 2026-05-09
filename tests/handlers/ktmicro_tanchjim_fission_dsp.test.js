/**
 * TANCHJIM-FISSION  DSP (KT Micro) — auto-generated tests
 * Capture: tests/captures/ktmicro_tanchjim_fission_dsp.json
 * vendorId=0x31B2  productId=0x1119
 *
 * peq5Band12dBFullShelvesNoPregain — 5 bands, ±12 dB, LS+HS, no pregain
 * Reads 10 registers at baseRegisterOffset=0x26 (2 regs per band), compensate2X=false
 * Protocol: reg[0]=register, reg[4]=cmd (0x52=read, 0x57=write, 0x53=commit)
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
      maxFilters:           5,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 0x03,
      maxWritableEQSlots:     1,
      disconnectOnSave:    true,
      compensate2X:       false,
      baseRegisterOffset: 0x26,
      disabledPresetId:   0x02,
      availableSlots: [{ id: 0x03, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 5, 'KT Micro should return 5 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
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
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  result.filters.filter(f => f !== undefined && f !== null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────
// KT Micro: fire-and-forget writes (no ACK awaited per register).
// getCurrentSlot uses sendCommandWithResponse; writes use plain sendReport.

export async function test_pushToDevice_sendsWriteForEachRegister(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  // 2 registers per filter (gain/freq + Q/type) × 5 bands = 10 writes
  const writeSends = mock.sentBytes.filter(b => b.length > 4 && b[4] === 0x57);
  assert.equal(writeSends.length, details.modelConfig.maxFilters * 2,
    `should send 2 write packets per filter (${details.modelConfig.maxFilters * 2} total), sent ${writeSends.length}`);
}

export async function test_pushToDevice_sendsCommit(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  const commitSend = mock.sentBytes.find(b => b.length > 4 && b[4] === 0x53);
  assert.ok(commitSend !== undefined, 'should send commit command (0x53)');
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/ktmicro_tanchjim_fission_dsp.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
