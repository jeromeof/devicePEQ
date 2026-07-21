/**
 * FIIO EH13 (fiioBle) — BLE handler regression tests
 * Capture: tests/captures/fiio_eh13_ble.json  (synthetic from FIIO_EH11_BLE_PROTOCOL.md)
 * Handler: devicePEQ/fiioBleHandler.js
 */

import { loadBleCapture } from '../MockBLEDevice.js';
import { fiioBle } from '../../devicePEQ/fiioBleHandler.js';

const MODEL_CONFIG = {
  peqConstraintsRef:  'bleExtras',
  minGain:            -20,
  maxGain:             20,
  maxFilters:          10,
  firstWritableEQSlot: 0,
  maxWritableEQSlots:  1,
  disconnectOnSave:    false,
  disabledPresetId:   -1,
  availableSlots: [{ id: 0, name: 'Custom EQ' }],
};

function makeDeviceDetails(mock, overrides = {}) {
  return {
    model:            mock.productName,
    manufacturer:     'FiiO',
    modelConfig:      { ...MODEL_CONFIG, ...overrides },
    txChar:           mock.txChar,
    readNotification: mock.readNotification.bind(mock),
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await fiioBle.pullFromDevice(details, 0);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  assert.ok(result.filters.length === 10, `should return 10 filters, got ${result.filters.length}`);
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await fiioBle.pullFromDevice(details, 0);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP'];
  result.filters.forEach((f, i) => {
    assert.ok(VALID.includes(f.type), `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number' && f.freq >= 0, `filter[${i}].freq should be >= 0`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
    assert.ok(typeof f.q   === 'number' && f.q > 0,    `filter[${i}].q should be > 0`);
  });
}

export async function test_pullFromDevice_gainsWithinRange(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await fiioBle.pullFromDevice(details, 0);
  result.filters.forEach((f, i) => {
    assert.ok(f.gain >= -20 && f.gain <= 20,
      `filter[${i}].gain ${f.gain} should be within [-20, 20]`);
  });
}

export async function test_pullFromDevice_decodesKnownValues(assert) {
  // Band 1 from protocol doc: +6.4 dB, 25 Hz, Q 5.0, PK
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const result = await fiioBle.pullFromDevice(details, 0);
  const b1 = result.filters[0];
  assert.ok(Math.abs(b1.gain - 6.4) < 0.05, `band1 gain should be ~+6.4 dB, got ${b1.gain}`);
  assert.ok(b1.freq === 25,                  `band1 freq should be 25 Hz, got ${b1.freq}`);
  assert.ok(Math.abs(b1.q - 5.0)   < 0.05,  `band1 Q should be ~5.0, got ${b1.q}`);
  assert.ok(b1.type === 'PK',                `band1 type should be PK, got ${b1.type}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await fiioBle.pullFromDevice(details, 0);
  mock.resetHistory();
  let threw = false;
  try { await fiioBle.pushToDevice(details, null, 0, 0, pulled.filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}

export async function test_pushToDevice_sendsAllBands(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await fiioBle.pullFromDevice(details, 0);
  mock.resetHistory();
  await fiioBle.pushToDevice(details, null, 0, 0, pulled.filters);
  // One write per band (10 bands)
  assert.ok(mock.sendCount === 10, `push should send 10 packets, sent ${mock.sendCount}`);
}

export async function test_pushToDevice_allPacketsAreWriteEQ(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const pulled = await fiioBle.pullFromDevice(details, 0);
  mock.resetHistory();
  await fiioBle.pushToDevice(details, null, 0, 0, pulled.filters);
  const writeEQPackets = mock._sentPackets.filter(p => p[4] === 0x13 && p[5] === 0x0D);
  assert.ok(writeEQPackets.length === 10,
    `all 10 packets should be CMD 13 0D, got ${writeEQPackets.length}`);
}

// ── extras tests ──────────────────────────────────────────────────────────────

export async function test_readBattery_returnsPercentage(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const pct = await fiioBle.readBattery(details);
  assert.ok(typeof pct === 'number', `battery should be a number, got ${typeof pct}`);
  assert.ok(pct >= 0 && pct <= 100, `battery ${pct} should be 0-100`);
}

export async function test_readBattery_captureValue(assert) {
  // Capture has 0x48 = 72%
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const pct = await fiioBle.readBattery(details);
  assert.ok(pct === 72, `battery should be 72% from capture, got ${pct}`);
}

export async function test_readEqEnabled_returnsBoolean(assert) {
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const enabled = await fiioBle.readEqEnabled(details);
  assert.ok(typeof enabled === 'boolean', `eqEnabled should be boolean, got ${typeof enabled}`);
}

export async function test_readEqEnabled_captureIsEnabled(assert) {
  // Capture has 0x01 = enabled
  const mock = await loadBleCapture('../captures/fiio_eh13_ble.json');
  const details = makeDeviceDetails(mock);
  const enabled = await fiioBle.readEqEnabled(details);
  assert.ok(enabled === true, `eqEnabled should be true from capture, got ${enabled}`);
}
