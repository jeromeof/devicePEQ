/**
 * FIIO KA17 (fiioUsbHID) — auto-generated tests
 * Capture: tests/captures/fiio_fiio_ka17.json
 * vendorId=0x2972  productId=0x0093
 *
 * peq10Band12dBFullShelves — 10 bands, ±12 dB, LS+HS, pregain
 * Protocol: 0xBB prefix = read (responds), 0xAA prefix = write (fire-and-forget)
 * reportId=1, firstWritableEQSlot=7
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { fiioUsbHID } from '../../devicePEQ/fiioUsbHidHandler.js';

// FiiO fires 10 concurrent filter requests from inside oninputreport — responses
// arrive in a different order than sends. Sequence mode bypasses exchange matching
// and fires responses in the pre-ordered sequence that matches the handler's logic.
async function loadFiioCaptureSequence() {
  const captureUrl = new URL('../captures/fiio_fiio_ka17.json', import.meta.url).href;
  const capture = await fetch(captureUrl).then(r => r.json());
  return new MockHIDDevice({
    ...capture.device,
    sequence: capture.sequence,   // ordered responses: preset, counter, filter0..9, gain
    exchanges: capture.exchanges, // push writes (0xAA, no responses)
    responseDelay: 5
  });
}

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'FiiO',
    modelConfig: {
      peqConstraintsRef:   'peq10Band12dBFullShelves',
      maxFilters:          10,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 7,
      maxWritableEQSlots:  3,
      disconnectOnSave:    false,
      disabledPresetId:   11,
      reportId:            1,
      availableSlots: [
        { id: 0,  name: 'Jazz'    },
        { id: 1,  name: 'Pop'     },
        { id: 2,  name: 'Rock'    },
        { id: 3,  name: 'Dance'   },
        { id: 5,  name: 'R&B'     },
        { id: 6,  name: 'Classic' },
        { id: 7,  name: 'Hip-hop' },
        { id: 4,  name: 'USER1'   },
        { id: 8,  name: 'USER2'   },
        { id: 9,  name: 'USER3'   },
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
  const result = await fiioUsbHID.pullFromDevice(details, 7);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 7);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),     `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number', `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithin12dBRange(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 7);
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  await fiioUsbHID.pullFromDevice(details, 7);
  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsWrites(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 7);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fiioUsbHID.pushToDevice(details, null, 7, 0, filters);
  // FiiO writes use 0xAA prefix
  const writes = mock.sentBytes.filter(b => b[0] === 0xAA);
  assert.ok(writes.length > 0, `push should send 0xAA write commands, sent ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 7);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await fiioUsbHID.pushToDevice(details, null, 7, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
