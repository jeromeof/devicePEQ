/**
 * WalkPlay mic gain tests — EPZ TP13 AI ENC audio (SchemeNo11)
 * Capture: tests/captures/walkplay_schemeno11_micgain.json
 * vendorId=0x3302  productId=0x13D4
 *
 * Tests readMicGain() and setMicGain() on walkplayUsbHID.
 *
 * Protocol (from walkplay.js source):
 *   readMicGain  → send [0x80, 0x02, 0x00]  (3 bytes)
 *                   response data[2]=LSB, data[3]=MSB of 16-bit unsigned
 *                   gain dB = signed16 * 15 / 32767
 *
 *   setMicGain   → send [0x01, 0x02, 0x02, LSB, MSB]  (fire-and-forget)
 *                   16-bit signed, scaled by 32767/15 per dB, range -15..+15
 *                   Special cases: +15 → 32767, -15 → 32769
 */

import { loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'WalkPlay',
    modelConfig: {
      peqConstraintsRef:    'walkplayPeq8Band10dBLsLowpass',
      schemeNo:              11,
      maxFilters:             8,
      minGain:              -10,
      maxGain:               10,
      minQ:                 0.1,
      maxQ:                10.0,
      firstWritableEQSlot:  101,
      maxWritableEQSlots:     1,
      disconnectOnSave:     false,
      deviceHandlesPregain: false,
      availableSlots: [{ id: 101, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── readMicGain tests ─────────────────────────────────────────────────────────

export async function test_readMicGain_returns_a_number(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const gain = await walkplayUsbHID.readMicGain(details);
  assert.ok(typeof gain === 'number', `readMicGain should return a number, got ${typeof gain}`);
}

export async function test_readMicGain_decodes_16bit_value_to_dB(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const gain = await walkplayUsbHID.readMicGain(details);
  // Capture: LSB=170=0xAA, MSB=42=0x2A → raw=10922 → 10922*15/32767 = 5.0 dB
  assert.equal(gain, 5, `readMicGain should decode LSB=170,MSB=42 as +5 dB, got ${gain}`);
}

export async function test_readMicGain_sends_3byte_command(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.readMicGain(details);
  // Should send exactly [0x80, 0x02, 0x00] (3 bytes — no trailing END byte)
  const sent = mock.sentBytes.find(b => b[0] === 0x80 && b[1] === 0x02);
  assert.ok(sent !== undefined, 'should send a [0x80, 0x02, ...] read command');
  assert.equal(sent.length, 3, `command should be 3 bytes, got ${sent.length}`);
  assert.equal(sent[2], 0x00, 'byte[2] should be 0x00');
}

export async function test_readMicGain_does_not_throw(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  let threw = false;
  try { await walkplayUsbHID.readMicGain(details); }
  catch (e) { threw = true; console.warn('readMicGain threw:', e); }
  assert.ok(!threw, 'readMicGain should complete without throwing');
}

// ── setMicGain tests ──────────────────────────────────────────────────────────

export async function test_setMicGain_encodes_positive_dB_as_16bit(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.setMicGain(details, 5);
  // +5 dB: r = round(5 * 32767/15) = 10922 = 0x2AAA → LSB=0xAA=170, MSB=0x2A=42
  const sent = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x02);
  assert.ok(sent !== undefined, 'should send a [0x01, 0x02, ...] write command');
  assert.equal(sent[2], 0x02, 'byte[2] should be 0x02');
  assert.equal(sent[3], 170, `LSB should be 170 (0xAA) for +5 dB, got ${sent[3]}`);
  assert.equal(sent[4], 42,  `MSB should be 42 (0x2A) for +5 dB, got ${sent[4]}`);
}

export async function test_setMicGain_encodes_negative_dB_as_16bit_twos_complement(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.setMicGain(details, -10);
  // -10 dB: r = round(-10 * 32767/15) = -21845 → t = 43691 = 0xAAAB → LSB=0xAB=171, MSB=0xAA=170
  const sent = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x02);
  assert.ok(sent !== undefined, 'should send a write command for negative gain');
  assert.equal(sent[3], 171, `LSB should be 171 (0xAB) for -10 dB, got ${sent[3]}`);
  assert.equal(sent[4], 170, `MSB should be 170 (0xAA) for -10 dB, got ${sent[4]}`);
}

export async function test_setMicGain_sends_5_bytes(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.setMicGain(details, 5);
  const sent = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x02);
  assert.ok(sent !== undefined, 'should send a write command');
  assert.equal(sent.length, 5, `packet should be 5 bytes [WRITE,CMD,0x02,LSB,MSB], got ${sent.length}`);
}

export async function test_setMicGain_max_positive_encodes_32767(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  await walkplayUsbHID.setMicGain(details, 15);
  // +15 dB special case: t = 32767 = 0x7FFF → LSB=0xFF=255, MSB=0x7F=127
  const sent = mock.sentBytes.find(b => b[0] === 0x01 && b[1] === 0x02);
  assert.ok(sent !== undefined, 'should send write command for max gain');
  assert.equal(sent[3], 255, `LSB should be 255 (0xFF) for +15 dB, got ${sent[3]}`);
  assert.equal(sent[4], 127, `MSB should be 127 (0x7F) for +15 dB, got ${sent[4]}`);
}

export async function test_setMicGain_does_not_throw(assert) {
  const mock = await loadCapture('../captures/walkplay_schemeno11_micgain.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  let threw = false;
  try { await walkplayUsbHID.setMicGain(details, 5); }
  catch (e) { threw = true; console.warn('setMicGain threw:', e); }
  assert.ok(!threw, 'setMicGain should complete without throwing');
}
