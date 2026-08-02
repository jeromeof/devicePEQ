/**
 * FIIO QX13 (fiioUsbHID) — auto-generated tests
 * Capture: tests/captures/fiio_fiio_qx13.json
 * vendorId=0x2972  productId=0x0128
 *
 * peq10Band12dBWideAllFilters — 10 bands, -24/+12 dB, all FiiO filter types, pregain
 * Protocol: 0xBB prefix = read (responds), 0xAA prefix = write (fire-and-forget)
 * reportId=7 (default), firstWritableEQSlot=160
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { fiioUsbHID, compensateQForWrite, decompensateQFromRead } from '../../devicePEQ/fiioUsbHidHandler.js';

// FiiO fires 10 concurrent filter requests from inside oninputreport — responses
// arrive in a different order than sends. Sequence mode bypasses exchange matching
// and fires responses in the pre-ordered sequence that matches the handler's logic.
async function loadFiioCaptureSequence() {
  const captureUrl = new URL('../captures/fiio_fiio_qx13.json', import.meta.url).href;
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
      firstWritableEQSlot: 160,
      maxWritableEQSlots:  10,
      disconnectOnSave:    false,
      disabledPresetId:    240,
      reportId:            7,
      availableSlots: [
        { id: 0,   name: 'Jazz'    },
        { id: 1,   name: 'Pop'     },
        { id: 2,   name: 'Rock'    },
        { id: 3,   name: 'Dance'   },
        { id: 4,   name: 'R&B'     },
        { id: 5,   name: 'Classic' },
        { id: 6,   name: 'Hip-hop' },
        { id: 8,   name: 'Retro'   },
        { id: 160, name: 'USER1'   },
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
  const result = await fiioUsbHID.pullFromDevice(details, 160);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns10Bands(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 160);
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.equal(defined.length, 10, 'FIIO QX13 should return 10 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await fiioUsbHID.pullFromDevice(details, 160);
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
  const result = await fiioUsbHID.pullFromDevice(details, 160);
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
  const pulled = await fiioUsbHID.pullFromDevice(details, 160);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fiioUsbHID.pushToDevice(details, null, 160, 0, filters);
  const writes = mock.sentBytes.filter(b => b[0] === 0xAA);
  assert.ok(writes.length > 0, `push should send 0xAA write commands, sent ${writes.length}`);
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadFiioCaptureSequence();
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

export async function test_pushToDevice_writesRequestedNegativePreamp(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x2972,
    productId: 0x0093,
    productName: 'FIIO QX13',
    reportId: 7,
    responseDelay: 0
  });
  await mock.open();
  const details = makeDeviceDetails(mock);
  const filters = [{ type: 'PK', freq: 100, q: 1, gain: 0, disabled: false }];

  await fiioUsbHID.pushToDevice(details, null, 160, -2.7, filters);

  const gainWrite = mock.sentBytes.find(b => b[0] === 0xAA && b[4] === 0x17);
  assert.ok(gainWrite, 'push should send a global gain write');
  assert.equal(gainWrite[6], 0xFF, 'negative preamp high byte should be signed');
  assert.equal(gainWrite[7], 0xE5, 'preamp -2.7 dB should encode as -27 tenths, not 0 or +9.3 dB');
}

// ── gain-dependent Q compensation ─────────────────────────────────────────────
// Measured on this model against REW: a PEAKING filter realises
// Q_realised = Q_requested / 10^(|gain|/40), so the handler pre-multiplies Q on
// write and divides it back on read. See fiioUsbHidHandler.js for the data.

function freshMock() {
  return new MockHIDDevice({
    vendorId: 0x2972, productId: 0x0093, productName: 'FIIO QX13',
    reportId: 7, responseDelay: 0
  });
}

// Q is bytes 11/12 of a 0xAA filter-params (0x15) write, x100 and BIG-endian —
// splitUnsignedValue() returns [high, low] despite the handler naming the pair
// qFactorLow/qFactorHigh.
function qSentFor(mock, filterIndex = 0) {
  const w = mock.sentBytes.find(b => b[0] === 0xAA && b[4] === 0x15 && b[6] === filterIndex);
  return w ? ((w[11] << 8) | w[12]) / 100 : null;
}

export async function test_qCompensation_scalesPeakingQByGain(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'PK', freq: 1000, q: 1, gain: 12, disabled: false }]);
  // 10^(12/40) = 1.9953 -> round(199.53) = 200 -> 2.00
  assert.equal(qSentFor(mock), 2.0,
    'Q 1 at +12dB should be sent as 2.00 so the device realises Q 1');
}

export async function test_qCompensation_usesAbsoluteGain(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'PK', freq: 1000, q: 1, gain: -12, disabled: false }]);
  assert.equal(qSentFor(mock), 2.0,
    'cut and boost of equal magnitude should get the same Q compensation');
}

export async function test_qCompensation_leavesShelvesAlone(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'LSQ', freq: 200, q: 1, gain: 12, disabled: false }]);
  assert.equal(qSentFor(mock), 1.0,
    'shelves follow a different, unmeasured relationship and must not be compensated');
}

export async function test_qCompensation_noopAtZeroGain(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'PK', freq: 1000, q: 2.5, gain: 0, disabled: false }]);
  assert.equal(qSentFor(mock), 2.5, '10^0 = 1, so 0dB should pass Q through unchanged');
}

export async function test_qCompensation_offByDefault(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock); // no compensateQForGain
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'PK', freq: 1000, q: 1, gain: 12, disabled: false }]);
  assert.equal(qSentFor(mock), 1.0,
    'compensation must stay opt-in — it is confirmed on this model only');
}

export async function test_qCompensation_clampsToDeviceMaxQ(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  // Q 10 at -24dB would need 39.8 sent; the device accepts at most 10.
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'PK', freq: 1000, q: 10, gain: -24, disabled: false }]);
  assert.equal(qSentFor(mock), 10.0,
    'compensated Q must be clamped to maxQ rather than sent as an unstorable value');
}

export async function test_qCompensation_roundTripIsStable(assert) {
  const mock = await loadFiioCaptureSequence();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  const pulled = await fiioUsbHID.pullFromDevice(details, 160);
  const stored = pulled.filters
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f != null && f.type === 'PK' && Math.abs(f.gain) > 0);
  mock.resetHistory();
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    pulled.filters.filter(f => f != null));
  // Pull decompensates, push recompensates — a round trip must not drift, or
  // repeated pull/push cycles would widen every filter a little each time.
  for (const { f, i } of stored) {
    const sent = qSentFor(mock, i);
    const expected = f.q * Math.pow(10, Math.abs(f.gain) / 40);
    assert.ok(Math.abs(sent - expected) <= 0.02,
      `filter[${i}] round trip: sent Q ${sent}, expected ~${expected.toFixed(2)}`);
  }
}

// ── shelf slope compensation ──────────────────────────────────────────────────
// The device reuses the PEAKING alpha for shelves, so a requested shelf Q lands
// at slope S = 1/(1 + (1/Q^2 - 2)/(A + 1/A)). Sending 1/sqrt((A+1/A)(1/S-1)+2)
// instead makes it realise the slope actually asked for.

export async function test_shelfCompensation_sendsDerivedQ(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateShelfQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'LSQ', freq: 200, q: 1, gain: 6, disabled: false }]);
  // S=1 -> radicand = 2 -> Q_send = 1/sqrt(2) = 0.7071 -> 0.71 after x100 rounding
  assert.equal(qSentFor(mock), 0.71,
    'shelf slope 1 should be sent as Q 1/sqrt(2)');
}

export async function test_shelfCompensation_matchesMeasuredSlope(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateShelfQForGain: true });
  // Guards the derivation itself: an UNCOMPENSATED Q of 1 was measured to
  // realise S ~= 1.89 (1.885/1.887/1.891/1.897 over two REW runs), so pushing
  // slope 1.8925 must reproduce that same Q=1 on the wire.
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'HSQ', freq: 8000, q: 1.8925, gain: 6, disabled: false }]);
  assert.equal(qSentFor(mock), 1.0,
    'the slope measured for an uncompensated Q of 1 must round-trip back to Q 1');
}

export async function test_shelfCompensation_offByDefault(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'LSQ', freq: 200, q: 1, gain: 6, disabled: false }]);
  assert.equal(qSentFor(mock), 1.0,
    'the peaking flag alone must not alter shelves — they need their own opt-in');
}

export async function test_shelfCompensation_clampsUnreachableSlope(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateShelfQForGain: true });
  // At gain 6dB the radicand goes negative beyond S ~= 17.6 — physically
  // unreachable, so it must clamp rather than emit NaN.
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'LSQ', freq: 200, q: 50, gain: 6, disabled: false }]);
  const sent = qSentFor(mock);
  assert.ok(Number.isFinite(sent) && sent >= 0.1 && sent <= 10,
    `unreachable shelf slope must clamp into the device range, got ${sent}`);
}

// Reachable slopes only. The steepest shelf a device can produce FALLS as gain
// rises — the radicand (A+1/A)(1/S-1)+2 goes negative past S = 1/(1 - 2/(A+1/A)),
// which is S < 17.6 at 6dB but only S < 1.90 at 24dB. Asking for slope 2 at
// -24dB is not a round-trip bug, it is a filter the hardware cannot make.
function maxReachableSlope(gainDb) {
  const A = Math.pow(10, Math.abs(gainDb) / 40);
  return 1 / (1 - 2 / (A + 1 / A));
}

export async function test_shelfCompensation_roundTripIsStable(assert) {
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateShelfQForGain: true });
  let checked = 0;
  for (const gain of [6, 12, -24]) {
    for (const s of [0.5, 1, 2]) {
      if (s >= maxReachableSlope(gain)) continue;
      const sent = compensateRoundTrip(details.modelConfig, s, gain);
      assert.ok(Math.abs(sent - s) < 1e-6,
        `slope ${s} at ${gain}dB should survive a write/read round trip, got ${sent}`);
      checked++;
    }
  }
  assert.ok(checked >= 7, `expected most combinations to be reachable, checked ${checked}`);
}

export async function test_shelfCompensation_slopeCeilingFallsWithGain(assert) {
  // Documents the constraint above, so a future change that silently widens or
  // narrows the reachable range gets caught.
  assert.ok(maxReachableSlope(6) > 17 && maxReachableSlope(6) < 18,
    `at 6dB the ceiling should be ~17.6, got ${maxReachableSlope(6).toFixed(2)}`);
  assert.ok(maxReachableSlope(24) > 1.8 && maxReachableSlope(24) < 2.0,
    `at 24dB the ceiling should be ~1.90, got ${maxReachableSlope(24).toFixed(2)}`);
  const mock = freshMock();
  await mock.open();
  const details = makeDeviceDetails(mock, { compensateShelfQForGain: true });
  await fiioUsbHID.pushToDevice(details, null, 160, 0,
    [{ type: 'LSQ', freq: 200, q: 2, gain: -24, disabled: false }]);
  const sent = qSentFor(mock);
  assert.ok(Number.isFinite(sent) && sent >= 0.1,
    `an unreachable slope must still emit a valid Q, got ${sent}`);
}

// write-then-read through the handler's own two conversions
function compensateRoundTrip(modelConfig, s, gain) {
  return decompensateQFromRead(
    compensateQForWrite(s, gain, 'LSQ', modelConfig), gain, 'LSQ', modelConfig);
}
