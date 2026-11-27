/**
 * CS43198-SGM8262-TFT-BLE (WalkPlay SchemeNo16, firmware 1.5)
 * Capture: tests/captures/walkplay_schemeno16_cs43198_sgm8262_tft_ble.json
 *   (read-only; recorded by running walkplayHidHandler against the real dongle via node-hid)
 * vendorId=0x3302  productId=0x4333  manufacturer string "TTGK Technology"
 *
 * WalkPlay product/detail API reports SchemeNo 16, ChannelNum 10. The vendor app shows
 * 10 bands (31 Hz … 16 kHz, Q 0.75, PK), five DAC filters, Class-H/Class-AB, Low/High gain,
 * L/R balance and a microphone tab — the same feature set as Protocol Max.
 */

import { loadCapture, MockHIDDevice } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';
import { usbHidDeviceHandlerConfig } from '../../devicePEQ/usbDeviceConfig.js';

const CAPTURE = '../captures/walkplay_schemeno16_cs43198_sgm8262_tft_ble.json';
const REPORT_ID = 75;

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'WalkPlay',
    modelConfig: {
      peqConstraintsRef: 'peq10Band10dBFullShelves',
      schemeNo: 16,
      maxFilters: 10,
      minGain: -10,
      maxGain: 10,
      minQ: 0.1,
      maxQ: 10.0,
      firstWritableEQSlot: 101,
      maxWritableEQSlots: 1,
      deviceHandlesPregain: false,
      availableSlots: [{ id: 101, name: 'Custom' }],
      ...overrides
    }
  };
}

async function openCapture() {
  const mock = await loadCapture(CAPTURE);
  await mock.open();
  return mock;
}

// ── config resolution ────────────────────────────────────────────────────────

export async function test_productId_resolvesToSchemeNo16(assert) {
  const vendor = usbHidDeviceHandlerConfig.find(v => v.vendorIds.includes(0x3302) && v.manufacturer === 'WalkPlay');
  assert.ok(vendor, 'WalkPlay vendor entry should include 0x3302');
  const groups = Object.entries(vendor.deviceGroups)
    .filter(([, g]) => [...(g.productIds || []), ...(g.additionalProductIds || [])].includes(0x4333))
    .map(([name]) => name);
  assert.equal(groups[0], 'SchemeNo16', `0x4333 should first match SchemeNo16, matched ${JSON.stringify(groups)}`);
  assert.equal(vendor.deviceGroups.SchemeNo16.modelConfig.peqConstraintsRef, 'peq10Band10dBFullShelves');
}

// ── pull ─────────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_matchesVendorAppDefaults(assert) {
  const mock = await openCapture();
  const details = makeDeviceDetails(mock);
  const slot = await walkplayUsbHID.getCurrentSlot(details);
  const result = await walkplayUsbHID.pullFromDevice(details, slot);
  const filters = result.filters.filter(Boolean);
  assert.equal(filters.length, 10, 'should return 10 bands');
  assert.equal(JSON.stringify(filters.map(f => f.freq)),
    JSON.stringify([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]), 'band frequencies');
  filters.forEach((f, i) => {
    assert.equal(f.type, 'PK', `band ${i} type`);
    assert.equal(f.gain, 0, `band ${i} gain`);
    assert.ok(Math.abs(f.q - 0.75) < 0.01, `band ${i} q ${f.q} ≈ 0.75`);
  });
  assert.equal(details.version, 1.5, 'firmware version 1.5');
}

export async function test_noUnmatchedSends(assert) {
  const mock = await openCapture();
  const details = makeDeviceDetails(mock);
  const slot = await walkplayUsbHID.getCurrentSlot(details);
  await walkplayUsbHID.pullFromDevice(details, slot);
  assert.equal(mock.unmatchedCount ?? mock._unmatchedSends.length, 0, 'every send should be in the capture');
}

// ── extras (captured from device) ───────────────────────────────────────────

export async function test_readDacFilter_fastLL(assert) {
  const mock = await openCapture();
  assert.equal(await walkplayUsbHID.readDacFilter(makeDeviceDetails(mock)), 'FAST-LL');
}

// Capture state: Class-H (0) and High gain (true), as set on the device at capture time.
export async function test_readDacWorkMode_classH(assert) {
  const mock = await openCapture();
  assert.equal(await walkplayUsbHID.readDacWorkMode(makeDeviceDetails(mock)), 0);
}

export async function test_readGainMode_high(assert) {
  const mock = await openCapture();
  assert.equal(await walkplayUsbHID.readGainMode(makeDeviceDetails(mock)), true);
}

export async function test_readMicGain_lengthByteFormat(assert) {
  // This firmware replies [0x80, 0x02, 0x02, lo, hi]; capture raw 0xFD00 = -768 → -0.35 dB.
  // (The old decoder read the length byte and returned ~0 dB.)
  const mock = await openCapture();
  assert.equal(await walkplayUsbHID.readMicGain(makeDeviceDetails(mock)), -0.35);
}

export async function test_readDacBalance_centered(assert) {
  const mock = await openCapture();
  const bal = await walkplayUsbHID.readDacBalance(makeDeviceDetails(mock));
  assert.equal(JSON.stringify(bal), JSON.stringify({ left: 0, right: 0 }));
}

// ── readDacBalance channel mapping (observed on hardware) ────────────────────
// setDacBalance(4, 0) → ch1 reads 4 ; setDacBalance(0, 6) → ch0 reads 6

function balanceMock(ch0, ch1) {
  return new MockHIDDevice({
    vendorId: 0x3302, productId: 0x4333, productName: 'CS43198-SGM8262-TFT-BLE',
    exchanges: [0, 1].map(ch => ({
      send: { reportId: REPORT_ID, data: [0x80, 0x16, 0x02, ch, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x16, 0x02, ch, 0x00, ch ? ch1 : ch0, 0x00] }]
    }))
  });
}

export async function test_readDacBalance_leftBoost(assert) {
  const mock = balanceMock(0, 4); await mock.open();
  const bal = await walkplayUsbHID.readDacBalance(makeDeviceDetails(mock));
  assert.equal(JSON.stringify(bal), JSON.stringify({ left: 4, right: 0 }));
}

export async function test_readDacBalance_rightBoost(assert) {
  const mock = balanceMock(6, 0); await mock.open();
  const bal = await walkplayUsbHID.readDacBalance(makeDeviceDetails(mock));
  assert.equal(JSON.stringify(bal), JSON.stringify({ left: 0, right: 6 }));
}

// ── DAC reconfiguration settle window ────────────────────────────────────────
// On hardware a PEQ push 50–300 ms after a DAC filter / work-mode change lost bands.

export async function test_pushAfterDacFilterChange_waitsForSettle(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x4333, productName: 'CS43198-SGM8262-TFT-BLE' });
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.setDacFilter(details, 'SLOW-LL');
  const changedAt = Date.now();
  const filters = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(freq => ({ freq, gain: 1, q: 1, type: 'PK' }));
  await walkplayUsbHID.pushToDevice(details, {}, 101, 0, filters);
  const firstBand = mock._sentReports.find(r => r.bytes[0] === 0x01 && r.bytes[1] === 0x09);
  assert.ok(firstBand, 'first band write should be sent');
  assert.ok(firstBand.ts - changedAt >= 600,
    `first band write should wait for DAC settle, waited ${firstBand.ts - changedAt} ms`);
}

export async function test_pushWithoutDacChange_isNotDelayed(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x4333, productName: 'CS43198-SGM8262-TFT-BLE' });
  await mock.open();
  const details = makeDeviceDetails(mock);
  const start = Date.now();
  await walkplayUsbHID.pushToDevice(details, {}, 101, 0, [{ freq: 100, gain: 1, q: 1, type: 'PK' }]);
  const firstBand = mock._sentReports.find(r => r.bytes[0] === 0x01 && r.bytes[1] === 0x09);
  assert.ok(firstBand.ts - start < 100, `no settle wait expected, waited ${firstBand.ts - start} ms`);
}

// ── detectFilterCount (band count isn't fixed per SchemeNo) ──────────────────

function bandResponse(idx, freq, { q = 0.75, type = 2, coeffSeed = freq } = {}) {
  const d = new Array(63).fill(0);
  d[0] = 0x80; d[1] = 0x09; d[4] = idx;
  for (let k = 10; k < 27; k++) d[k] = (coeffSeed * (k + 1)) & 0xFF;
  d[27] = freq & 0xFF; d[28] = freq >> 8;
  const q8 = Math.round(q * 256); d[29] = q8 & 0xFF; d[30] = q8 >> 8;
  d[33] = type;
  return d;
}

function bandMock(responsesByIndex) {
  return new MockHIDDevice({
    vendorId: 0x3302, productId: 0xB301, productName: 'USB AI ENC with BLE',
    exchanges: Object.entries(responsesByIndex).map(([i, data]) => ({
      send: { reportId: REPORT_ID, data: [0x80, 0x09, 0x00, 0x00, Number(i), 0x00] },
      responses: data ? [{ reportId: REPORT_ID, data }] : []
    }))
  });
}

const FREQS_8 = [50, 200, 500, 1000, 2500, 5000, 10000, 15000];

export async function test_detectFilterCount_cappedAtSchemeCount(assert) {
  // CS43198-SGM8262-TFT-BLE (10 bands) answers bands 10-15 with a valid-looking
  // factory-default table, so detection must never exceed the scheme's maxFilters.
  const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const map = Object.fromEntries(freqs.map((f, i) => [i, bandResponse(i, f, { coeffSeed: f + 7 })]));
  [31, 62, 125, 250, 500, 1000].forEach((f, k) => { map[10 + k] = bandResponse(10 + k, f); });
  const mock = bandMock(map); await mock.open();
  assert.equal(await walkplayUsbHID.detectFilterCount(makeDeviceDetails(mock)), 10);
}

export async function test_detectFilterCount_junkAfter8(assert) {
  // CB1300 with BLE: band 8 silent, 9+ junk (Q 0, freq 192, type 0)
  const map = Object.fromEntries(FREQS_8.map((f, i) => [i, bandResponse(i, f)]));
  map[8] = bandResponse(8, 192, { q: 0, type: 0 });
  const mock = bandMock(map); await mock.open();
  assert.equal(await walkplayUsbHID.detectFilterCount(makeDeviceDetails(mock)), 8);
}

export async function test_detectFilterCount_noAnswerAfter8(assert) {
  const map = Object.fromEntries(FREQS_8.map((f, i) => [i, bandResponse(i, f)]));
  const mock = bandMock(map); await mock.open();
  assert.equal(await walkplayUsbHID.detectFilterCount(makeDeviceDetails(mock)), 8);
}
