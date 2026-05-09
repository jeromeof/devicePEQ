/**
 * SNOWSKY Melody (fiioUsbHID) — auto-generated tests
 * Capture: tests/captures/fiio_snowsky_melody.json
 * vendorId=0x2972  productId=0x0126
 *
 * peq10Band12dBWideAllFilters — 10 bands, -24/+12 dB, all FiiO filter types
 * Protocol: 0xBB prefix = read, 0xAA prefix = write (pipelined ACKs, fire-and-forget)
 * reportId=7 (default). Device includes an incrementing counter byte at data[3].
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { fiioUsbHID } from '../../devicePEQ/fiioUsbHidHandler.js';

async function loadFiioCaptureSequence() {
  const captureUrl = new URL('../captures/fiio_snowsky_melody.json', import.meta.url).href;
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
    manufacturer: 'FiiO',
    modelConfig: {
      peqConstraintsRef:   'peq10Band12dBWideAllFilters',
      maxFilters:          10,
      minGain:            -24,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 1,
      maxWritableEQSlots:  1,
      disconnectOnSave:    false,
      disabledPresetId:    240,
      reportId:            7,
      availableSlots: [
        { id: 0,   name: 'Jazz'    },
        { id: 1,   name: 'Pop'     },
        { id: 2,   name: 'Rock'    },
        { id: 3,   name: 'Dance'   },
        { id: 5,   name: 'R&B'     },
        { id: 6,   name: 'Classic' },
        { id: 7,   name: 'Hip-hop' },
        { id: 160, name: 'USER1'   },
        { id: 161, name: 'USER2'   },
        { id: 162, name: 'USER3'   },
        { id: 240, name: 'BYPASS'  }
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
  const result = await fiioUsbHID.pullFromDevice(details, 1);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns10Bands(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 1);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 10, 'SNOWSKY Melody should return 10 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 1);
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
  const result = await fiioUsbHID.pullFromDevice(details, 1);
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(f.gain >= -24 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within [-24, +12]`);
  });
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsWrites(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 1);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fiioUsbHID.pushToDevice(details, null, 1, 0, filters);
  const writes = mock.sentBytes.filter(b => b[0] === 0xAA);
  assert.ok(writes.length > 0, `push should send 0xAA write commands, sent ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 1);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await fiioUsbHID.pushToDevice(details, null, 1, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
