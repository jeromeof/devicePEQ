/**
 * Topping DX1 II — WebHID PEQ Handler Tests
 * Vendor ID: 0x152A, Product ID: 0x8750
 * Protocol: Command-response with echo-based reads
 *
 * Test Coverage:
 * - Band frequency, gain, Q factor encoding/decoding
 * - Pregain fixed-point encoding
 * - Write commands generation
 * - Read via echo collection
 */

import { MockHIDDevice } from '../MockHIDDevice.js';
import { toppingUsbHidHandler } from '../../devicePEQ/toppingUsbHidHandler.js';

function makeDeviceDetails(mock) {
  return {
    rawDevice: mock,
    model: 'DX1 II',
    manufacturer: 'Topping',
    modelConfig: {
      peqConstraintsRef: 'peq10Band12dBFullShelves',
      maxFilters: 10,
      minGain: -12,
      maxGain: 12,
      minQ: 0.1,
      maxQ: 10.0,
      firstWritableEQSlot: 0,
      maxWritableEQSlots: 1,
      disconnectOnSave: false,
      deviceHandlesPregain: true,
      availableSlots: [{ id: 0, name: 'Custom' }]
    }
  };
}


// ──────────────────────────────────────────────────────────────────────────
// Encoding Tests (verify internal encoding functions)
// ──────────────────────────────────────────────────────────────────────────

export function test_encodeFrequency_1000Hz(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encFreq(1000);
  assert.equal(encoded, 1000, '1000 Hz should encode as 1000');
}

export function test_encodeFrequency_20000Hz(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encFreq(20000);
  assert.equal(encoded, 20000, '20000 Hz should encode as 20000');
}

export function test_encodeFrequency_clampsToMin1(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encFreq(0);
  assert.equal(encoded, 1, '0 Hz should clamp to 1');
}

export function test_encodeGainSteps_positiveGain(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encGainSteps(3.5); // 7 half-dB steps
  assert.equal(encoded, 7, '+3.5 dB should encode as 7 (dB*2)');
}

export function test_encodeGainSteps_negativeGain(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encGainSteps(-6); // -12 half-dB steps
  // Signed 16-bit encoding of -12
  const signed16 = ((encoded << 16) >> 16);
  assert.equal(signed16, -12, '-6 dB should encode as -12 (dB*2)');
}

export function test_encodeGainSteps_zeroGain(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encGainSteps(0);
  assert.equal(encoded, 0, '0 dB should encode as 0');
}

export function test_encodeQ_Q1(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encQ(1.0);
  assert.equal(encoded, 10000, 'Q=1.0 should encode as 10000 (Q*10000)');
}

export function test_encodeQ_Q2(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encQ(2.0);
  assert.equal(encoded, 20000, 'Q=2.0 should encode as 20000 (Q*10000)');
}

export function test_encodeQ_Q0Point5(assert) {
  const internal = toppingUsbHidHandler._internal;
  const encoded = internal.encQ(0.5);
  assert.equal(encoded, 5000, 'Q=0.5 should encode as 5000 (Q*10000)');
}

// ──────────────────────────────────────────────────────────────────────────
// Write Filter Tests
// ──────────────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsEnableCommand(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 6, q: 1.0, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // First band enable should be 0x96 (0x90 + 0x06), data = 1
  const sentReports = mock.sentBytes;
  const enableCmd = sentReports.find(r => r[0] === 0x96);
  assert.ok(enableCmd, 'Should send band 0 enable command (0x96)');
  assert.equal(enableCmd[1], 1, 'Enable command data should be 1');
}

export async function test_pushToDevice_sendsFrequencyCommand(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 5000, gain: 0, q: 1.0, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Frequency for band 0 should be 0x97 (0x90 + 0x07), data = 5000
  const sentReports = mock.sentBytes;
  const freqCmd = sentReports.find(r => r[0] === 0x97);
  assert.ok(freqCmd, 'Should send band 0 frequency command (0x97)');

  const view = new DataView(new ArrayBuffer(4));
  view.setUint8(0, freqCmd[1]);
  view.setUint8(1, freqCmd[2]);
  view.setUint8(2, freqCmd[3]);
  view.setUint8(3, freqCmd[4]);
  const freq = view.getUint32(0, true); // little-endian
  assert.equal(freq, 5000, 'Frequency should encode as 5000');
}

export async function test_pushToDevice_sendsGainCommand(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 6, q: 1.0, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Gain for band 0 should be 0x98 (0x90 + 0x08), data = 12 (6*2)
  const sentReports = mock.sentBytes;
  const gainCmd = sentReports.find(r => r[0] === 0x98);
  assert.ok(gainCmd, 'Should send band 0 gain command (0x98)');

  const view = new DataView(new ArrayBuffer(4));
  view.setUint8(0, gainCmd[1]);
  view.setUint8(1, gainCmd[2]);
  view.setUint8(2, gainCmd[3]);
  view.setUint8(3, gainCmd[4]);
  const gain = view.getInt32(0, true); // little-endian, signed
  assert.equal(gain, 12, 'Gain should encode as 12 (6 dB * 2)');
}

export async function test_pushToDevice_sendsQCommand(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 0, q: 0.7, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Q for band 0 should be 0x99 (0x90 + 0x09), data = 7000 (0.7*10000)
  const sentReports = mock.sentBytes;
  const qCmd = sentReports.find(r => r[0] === 0x99);
  assert.ok(qCmd, 'Should send band 0 Q command (0x99)');

  const view = new DataView(new ArrayBuffer(4));
  view.setUint8(0, qCmd[1]);
  view.setUint8(1, qCmd[2]);
  view.setUint8(2, qCmd[3]);
  view.setUint8(3, qCmd[4]);
  const q = view.getUint32(0, true); // little-endian
  assert.equal(q, 7000, 'Q should encode as 7000 (0.7 * 10000)');
}

export async function test_pushToDevice_sendsApplyCommand(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 0, q: 1.0, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Apply for band 0 should be 0x9A (0x90 + 0x0A), data = 1
  const sentReports = mock.sentBytes;
  const applyCmd = sentReports.find(r => r[0] === 0x9A);
  assert.ok(applyCmd, 'Should send band 0 apply command (0x9A)');
  assert.equal(applyCmd[1], 1, 'Apply command data should be 1');
}

export async function test_pushToDevice_disabledFilter(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 0, q: 1.0, disabled: true }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Disabled filter should send enable=0
  const sentReports = mock.sentBytes;
  const enableCmd = sentReports.find(r => r[0] === 0x96);
  assert.ok(enableCmd, 'Should send band 0 enable command');
  assert.equal(enableCmd[1], 0, 'Disabled filter should send enable data=0');
}

export async function test_pushToDevice_multipleBands(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { type: 'PK', freq: 1000, gain: 6, q: 1.0, disabled: false },
    { type: 'LSQ', freq: 100, gain: 3, q: 0.7, disabled: false },
    { type: 'HSQ', freq: 10000, gain: -3, q: 0.7, disabled: false }
  ];

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // Band 1 enable should be 0x97 (0x91 + 0x06)
  const sentReports = mock.sentBytes;
  const band1Enable = sentReports.find(r => r[0] === 0x97);
  assert.ok(band1Enable, 'Should send band 1 enable command (0x97)');

  // Band 2 enable should be 0x98 (0x92 + 0x06)
  const band2Enable = sentReports.find(r => r[0] === 0x98);
  assert.ok(band2Enable, 'Should send band 2 enable command (0x98)');
}

// ──────────────────────────────────────────────────────────────────────────
// Pregain Tests
// ──────────────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsPregain(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [];
  const globalGain = 3.0; // +3 dB

  await toppingUsbHidHandler.pushToDevice(details, {}, 0, globalGain, filters);

  // Should send pregain A SET (0x9C), data = 3.0 * 65536 = 196608
  const sentReports = mock.sentBytes;
  const pregainCmd = sentReports.find(r => r[0] === 0x9C);

  assert.ok(pregainCmd, 'Should send pregain SET_A command (0x9C)');
}

// ──────────────────────────────────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────────────────────────────────

export async function test_getCurrentSlot_returnsZero(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);
  const slot = await toppingUsbHidHandler.getCurrentSlot(details);
  assert.equal(slot, 0, 'getCurrentSlot should return 0 (placeholder)');
}

export async function test_enablePEQ_completes(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x152A,
    productId: 0x8750,
    productName: 'Topping DX1 II',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Should complete without error
  await toppingUsbHidHandler.enablePEQ(mock);
  assert.ok(true, 'enablePEQ should complete without error');
}

