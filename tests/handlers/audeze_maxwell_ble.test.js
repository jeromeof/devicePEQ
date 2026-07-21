/**
 * Audeze Maxwell (airohaBle BLE) — regression tests
 * Capture: tests/captures/audeze_maxwell_ble.json  (synthetic from airohaBleHandler.js protocol)
 * Handler: devicePEQ/airohaBleHandler.js
 * vendorId: N/A (BLE)  productName: "Audeze Maxwell"
 *
 * Synthetic capture notes:
 *   - Band 6 (index 5): 1000 Hz, +5.00 dB, Q = 1.00 — used to verify decode
 *   - All other bands: 0 dB, Q = 0.71, various standard frequencies
 *   - Response: single 193-byte Airoha PEQ packet (05 5B BD header)
 */

import { loadBleCapture } from '../MockBLEDevice.js';
import { airohaBle } from '../../devicePEQ/airohaBleHandler.js';

const MODEL_CONFIG = {
  minGain:             -12,
  maxGain:              12,
  maxFilters:           10,
  firstWritableEQSlot:  0,
  maxWritableEQSlots:   4,
  disconnectOnSave:     false,
  disabledPresetId:    -1,
  availableSlots: [
    { id: 0, name: 'Preset 1' },
    { id: 1, name: 'Preset 2' },
    { id: 2, name: 'Preset 3' },
    { id: 3, name: 'Preset 4' },
  ],
};

function makeDeviceDetails(mock, overrides = {}) {
  return {
    model:            mock.productName,
    manufacturer:     'Audeze',
    modelConfig:      { ...MODEL_CONFIG, ...overrides },
    txChar:           mock.txChar,
    readNotification: mock.readNotification.bind(mock),
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await airohaBle.pullFromDevice(details, 0);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  assert.ok(result.filters.length === 10, `should return 10 filters, got ${result.filters.length}`);
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await airohaBle.pullFromDevice(details, 0);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP'];
  result.filters.forEach((f, i) => {
    assert.ok(VALID.includes(f.type), `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number' && f.freq >= 0, `filter[${i}].freq should be >= 0`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
    assert.ok(typeof f.q   === 'number' && f.q > 0,    `filter[${i}].q should be > 0`);
  });
}

export async function test_pullFromDevice_gainsWithinRange(assert) {
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await airohaBle.pullFromDevice(details, 0);
  result.filters.forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within [-12, 12]`);
  });
}

export async function test_pullFromDevice_decodesKnownValues(assert) {
  // Band 6 (index 5): 1000 Hz, +5.00 dB, Q = 1.00
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await airohaBle.pullFromDevice(details, 0);
  const b6 = result.filters[5];
  assert.ok(Math.abs(b6.gain - 5.0) < 0.05, `band6 gain should be ~+5.0 dB, got ${b6.gain}`);
  assert.ok(Math.abs(b6.freq - 1000) < 1,   `band6 freq should be 1000 Hz, got ${b6.freq}`);
  assert.ok(Math.abs(b6.q   - 1.0)  < 0.05, `band6 Q should be ~1.0, got ${b6.q}`);
  assert.ok(b6.type === 'PK',                `band6 type should be PK, got ${b6.type}`);
}

export async function test_pullFromDevice_slot1(assert) {
  // Verify the wildcard exchange also matches slot 1
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await airohaBle.pullFromDevice(details, 1);
  assert.ok(Array.isArray(result.filters) && result.filters.length === 10,
    `slot 1 pull should return 10 filters, got ${result.filters.length}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await airohaBle.pullFromDevice(details, 0);
  mock.resetHistory();
  let threw = false;
  try { await airohaBle.pushToDevice(details, null, 0, 0, pulled.filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}

export async function test_pushToDevice_sendsOnePacket(assert) {
  // Airoha writes all 10 bands in a single BLE command
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await airohaBle.pullFromDevice(details, 0);
  mock.resetHistory();
  await airohaBle.pushToDevice(details, null, 0, 0, pulled.filters);
  assert.ok(mock.sendCount === 1, `push should send 1 packet, sent ${mock.sendCount}`);
}

export async function test_pushToDevice_packetStartsWithAirohaHeader(assert) {
  const mock = await loadBleCapture('../captures/audeze_maxwell_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await airohaBle.pullFromDevice(details, 0);
  mock.resetHistory();
  await airohaBle.pushToDevice(details, null, 0, 0, pulled.filters);
  const pkt = mock._sentPackets[0];
  assert.ok(pkt && pkt[0] === 0x05 && pkt[1] === 0x5A && pkt[2] === 0xBD,
    `push packet should start with 05 5A BD, got ${pkt?.slice(0,3).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
}
