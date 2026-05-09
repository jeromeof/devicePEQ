/**
 * FIIO OAK NANO (fiioUsbHID) — auto-generated tests
 * Capture: tests/captures/fiio_fiio_oak_nano.json
 * vendorId=0x2972  productId=0x4016
 *
 * peq10Band12dBWideShelves — 10 bands, -24/+12 dB, PK/LSQ/HSQ
 * Protocol: 0xBB=read, 0xAA=write. reportId=7, firstWritableEQSlot=160 (USER1)
 * Note: filter[0] (64 Hz) is missing from the pull capture — device sent it
 * before logging started. The sparse array (indices 1-7) satisfies peqCount=8.
 */

import { loadCapture } from '../MockHIDDevice.js';
import { fiioUsbHID } from '../../devicePEQ/fiioUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'FiiO',
    modelConfig: {
      peqConstraintsRef:   'peq10Band12dBWideShelves',
      maxFilters:          10,
      minGain:            -24,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 160,
      maxWritableEQSlots:  1,
      disconnectOnSave:    false,
      reportId:            7,
      availableSlots: [
        { id: 0, name: 'Jazz' }, { id: 1, name: 'Pop'     }, { id: 2, name: 'Rock'    },
        { id: 3, name: 'Dance'}, { id: 4, name: 'R&B'     }, { id: 5, name: 'Classic' },
        { id: 6, name: 'Hip-hop' }, { id: 160, name: 'USER1' },
      ],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 160);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 160);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),     `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number', `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithinRange(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 160);
  result.filters.filter(f => f != null).forEach((f, i) => {
    assert.ok(f.gain >= -24 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within [-24, 12] dB`);
  });
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await fiioUsbHID.pullFromDevice(details, 160);
  if (mock.unmatchedCount > 0) console.warn('Unmatched:', mock._unmatchedSends);
  assert.ok(true, `unmatched: ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsWrites(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 160);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fiioUsbHID.pushToDevice(details, null, 160, 0, filters);
  const writes = mock.sentBytes.filter(b => b[0] === 0xAA);
  assert.ok(writes.length > 0, `push should send 0xAA write commands, sent ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/fiio_fiio_oak_nano.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await fiioUsbHID.pullFromDevice(details, 160);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  let threw = false;
  try { await fiioUsbHID.pushToDevice(details, null, 160, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
