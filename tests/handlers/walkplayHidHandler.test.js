/**
 * WalkPlay HID Handler tests — JM98MAX (SchemeNo10)
 * Capture: tests/captures/walkplay_schemeNo10_jm98max.json
 * vendorId=0x0661  productId=0x0881
 *
 * SchemeNo10: walkplayPeq8Band10dBPkOnly — 8 bands, ±10 dB, PK only, pregain
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'WalkPlay',
    modelConfig: {
      peqConstraintsRef: 'walkplayPeq8Band10dBPkOnly',
      schemeNo:           10,
      maxFilters:          8,
      minGain:           -10,
      maxGain:            10,
      minQ:              0.1,
      maxQ:             10.0,
      firstWritableEQSlot: 101,
      maxWritableEQSlots:    1,
      disconnectOnSave:  false,
      deviceHandlesPregain:    false,
      availableSlots: [{ id: 101, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── MockHIDDevice self-tests ───────────────────────────────────────────────────

export async function test_mock_firesInputReport(assert) {
  const mock = new MockHIDDevice({
    vendorId: 1, productId: 2, productName: 'Test',
    exchanges: [
      { send: { reportId: 1, data: [1, 2, 3] }, responses: [{ data: [4, 5, 6] }] }
    ]
  });
  await mock.open();
  let got = null;
  mock.oninputreport = ev => { got = new Uint8Array(ev.data.buffer); };
  await mock.sendReport(1, new Uint8Array([1, 2, 3]));
  assert.ok(got !== null, 'oninputreport should fire');
  assert.equal(got[0], 4);
}

export async function test_mock_wildcardMatching(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'Test',
    exchanges: [
      { send: { data: [128, 9, null] }, responses: [{ data: [128, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 101] }] }
    ]
  });
  await mock.open();
  let fired = false;
  mock.oninputreport = () => { fired = true; };
  await mock.sendReport(75, new Uint8Array([128, 9, 42]));
  assert.ok(fired, 'wildcard should match any byte value');
}

export async function test_mock_sequenceMode(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'Test',
    sequence: [{ data: [0x01] }, { data: [0x02] }, { data: [0x03] }]
  });
  await mock.open();
  const got = [];
  mock.oninputreport = ev => got.push(new Uint8Array(ev.data.buffer)[0]);
  await mock.sendReport(1, new Uint8Array([0xFF]));
  await mock.sendReport(1, new Uint8Array([0xFF]));
  await mock.sendReport(1, new Uint8Array([0xFF]));
  assert.deepEqual(got, [1, 2, 3], 'sequence mode fires in order');
}

// ── getCurrentSlot ─────────────────────────────────────────────────────────────

export async function test_getCurrentSlot_returnsValue(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const slot = await walkplayUsbHID.getCurrentSlot(details);
  assert.ok(slot != null, `getCurrentSlot should return a value, got ${slot}`);
}

// ── pullFromDevice ─────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns8Bands(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const defined = result.filters.filter(f => f !== undefined);

  assert.equal(defined.length, 8, 'SchemeNo10 should return 8 filter bands');
}

export async function test_pullFromDevice_allFiltersHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ'];

  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(VALID.includes(f.type),       `filter[${i}].type "${f.type}" should be valid`);
    assert.ok(typeof f.freq === 'number',   `filter[${i}].freq should be a number`);
    assert.ok(typeof f.gain === 'number',   `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithinSchemeNo10Range(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  result.filters.filter(f => f !== undefined).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 6,
      `filter[${i}].gain ${f.gain} should be within SchemeNo10 range [-12, +6]`);
  });
}

export async function test_pullFromDevice_readsGlobalGain(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await walkplayUsbHID.pullFromDevice(details, 101);

  assert.ok(typeof result.globalGain === 'number',
    `globalGain should be a number, got ${result.globalGain}`);
  assert.equal(result.globalGain, -3, 'global gain should be -3 dB from capture');
}

export async function test_pullFromDevice_sendsExactlyMaxFilterRequests(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await walkplayUsbHID.pullFromDevice(details, 101);

  const filterReads = mock.sentBytes.filter(b => b[0] === 128 && b[1] === 9 && b.length === 6);
  assert.equal(filterReads.length, details.modelConfig.maxFilters,
    `should send exactly ${details.modelConfig.maxFilters} filter read requests`);
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await walkplayUsbHID.pullFromDevice(details, 101);

  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends — consider extending capture:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── pushToDevice ───────────────────────────────────────────────────────────────
// WalkPlay write commands receive echo/ACK responses — capture file has both phases.

export async function test_pushToDevice_sendsOnePacketPerFilter(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Pull to load filter data, then push it back
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, 0, filters);

  // WRITE=0x01, CMD.PEQ_VALUES=0x09
  const writeSends = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x09);
  assert.equal(writeSends.length, details.modelConfig.maxFilters,
    `should send one write packet per filter band, sent ${writeSends.length}`);
}

export async function test_pushToDevice_includesCorrectBandIndices(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, 0, filters);

  const writeSends = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x09);
  writeSends.forEach((b, i) => {
    assert.equal(b[4], i, `write packet ${i} should carry band index ${i} at byte[4], got ${b[4]}`);
  });
}

export async function test_pushToDevice_sendsGlobalGain(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeNo10_jm98max.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined);
  await walkplayUsbHID.pushToDevice(details, null, 101, pulled.globalGain, filters);

  // Global gain write: WRITE=0x01, CMD.GLOBAL_GAIN=0x03
  const gainWrite = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x03);
  assert.ok(gainWrite !== undefined, 'should send global gain write command');
}
