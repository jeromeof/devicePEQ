/**
 * JadeAudio JA11 (fiioUsbHID) — auto-generated tests
 * Capture: tests/captures/fiio_jadeaudio_ja11.json
 * vendorId=0x2972  productId=0x0102
 *
 * peq5Band12dBFullShelves — 5 bands, ±12 dB, LS+HS, pregain
 * reportId=2, firstWritableEQSlot=3 (USER1), disconnectOnSave=true
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { fiioUsbHID } from '../../devicePEQ/fiioUsbHidHandler.js';

async function loadFiioCaptureSequence() {
  const captureUrl = new URL('../captures/fiio_jadeaudio_ja11.json', import.meta.url).href;
  const capture = await fetch(captureUrl).then(r => r.json());
  return new MockHIDDevice({
    ...capture.device,
    sequence: capture.sequence,
    exchanges: capture.exchanges,
    responseDelay: 5
  });
}

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'JadeAudio',
    modelConfig: {
      peqConstraintsRef:   'peq5Band12dBFullShelves',
      maxFilters:           5,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 3,
      maxWritableEQSlots:  1,
      disconnectOnSave:    true,
      disabledPresetId:    4,
      reportId:            2,
      availableSlots: [
        { id: 0, name: 'Vocal'   },
        { id: 1, name: 'Classic' },
        { id: 2, name: 'Bass'    },
        { id: 3, name: 'USER1'   }
      ],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 3);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 3);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 5, 'JadeAudio JA11 should return 5 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 3);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),     `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number' && f.freq >= 0, `filter[${i}].freq should be >= 0`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithinRange(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 3);
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsWrites(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 3);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fiioUsbHID.pushToDevice(details, null, 3, 0, filters);
  const writes = mock.sentBytes.filter(b => b[0] === 0xAA);
  assert.ok(writes.length > 0, `push should send 0xAA write commands, sent ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 3);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await fiioUsbHID.pushToDevice(details, null, 3, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
