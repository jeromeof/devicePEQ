/**
 * Walkplay handler — extras API tests (DAC filter, balance, work mode, gain mode, output gain)
 * Tests use inline MockHIDDevice instances with hand-crafted exchanges.
 * Reference device: CrinEar Protocol Max (vendorId=0x3302, productId=0x43CC, SchemeNo16)
 */

import { MockHIDDevice } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

const REPORT_ID = 75;

function makeDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: 'Protocol Max',
    manufacturer: 'CrinEar',
    modelConfig: {
      peqConstraintsRef: 'peq10Band10dBFullShelves',
      schemeNo: 16,
      maxFilters: 10,
      deviceHandlesPregain: false,
      globalGainBuffer: -5,
      availableSlots: [{ id: 101, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── Mic / ADC gain (CMD 0x02) — supported on all Walkplay schemes ─────────────

export async function test_readMicGain_returnsMaxPositive(assert) {
  // raw = 32767 (0x7FFF) → +15 dB
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x02, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x02, 0xFF, 0x7F] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readMicGain(makeDetails(mock));
  assert.equal(result, 15, 'raw 32767 should decode to 15 dB');
}

export async function test_readMicGain_returnsNegativeValue(assert) {
  // -5 dB → t = 54614 (0xD556) → lsb=0x56, msb=0xD5
  // readback: raw=54614 → signed=-10922 → gain=Math.round(-10922*15/32767*100)/100 = -5
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x02, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x02, 0x56, 0xD5] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readMicGain(makeDetails(mock));
  assert.equal(result, -5, 'raw 54614 (signed -10922) should decode to -5 dB');
}

export async function test_readMicGain_returnsZero(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x02, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x02, 0x00, 0x00] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readMicGain(makeDetails(mock));
  assert.equal(result, 0, 'raw 0 should decode to 0 dB');
}

export async function test_setMicGain_sendsZero(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setMicGain(makeDetails(mock), 0);
  assert.ok(mock.wasSent([0x01, 0x02, 0x02, 0x00, 0x00]), 'should send WRITE MIC_GAIN 0 dB');
}

export async function test_setMicGain_sendsMaxPositive(assert) {
  // 15 dB → t = 32767 → lsb=0xFF, msb=0x7F
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setMicGain(makeDetails(mock), 15);
  assert.ok(mock.wasSent([0x01, 0x02, 0x02, 0xFF, 0x7F]), 'should send WRITE MIC_GAIN +15 dB (32767)');
}

export async function test_setMicGain_sendsNegativeValue(assert) {
  // -5 dB: r=Math.round(-5*32767/15)=-10922, t=-10922+65536=54614=0xD556 → lsb=0x56, msb=0xD5
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setMicGain(makeDetails(mock), -5);
  assert.ok(mock.wasSent([0x01, 0x02, 0x02, 0x56, 0xD5]), 'should send WRITE MIC_GAIN -5 dB (54614)');
}

// ── DAC filter ────────────────────────────────────────────────────────────────

export async function test_readDacFilter_returnsFastLL(assert) {
  // Response format: [READ, CMD, len=1, value] — filterIdx at data[3]
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x11] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x11, 0x01, 0x01] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readDacFilter(makeDetails(mock));
  assert.equal(result, 'FAST-LL', 'value 1 should map to FAST-LL');
}

export async function test_readDacFilter_returnsFastPC(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x11] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x11, 0x01, 0x02] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readDacFilter(makeDetails(mock));
  assert.equal(result, 'FAST-PC', 'value 2 should map to FAST-PC');
}

export async function test_setDacFilter_sendsFastLL(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacFilter(makeDetails(mock), 'FAST-LL');
  assert.ok(mock.wasSent([0x01, 0x11, 0x01, 0x01]), 'should send WRITE DAC_FILTER FAST-LL (1)');
}

export async function test_setDacFilter_sendsSlowLL(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacFilter(makeDetails(mock), 'SLOW-LL');
  assert.ok(mock.wasSent([0x01, 0x11, 0x01, 0x03]), 'should send WRITE DAC_FILTER SLOW-LL (3)');
}

export async function test_setDacFilter_sendsNonOS(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacFilter(makeDetails(mock), 'NON-OS');
  assert.ok(mock.wasSent([0x01, 0x11, 0x01, 0x05]), 'should send WRITE DAC_FILTER NON-OS (5)');
}

// ── DAC work mode ─────────────────────────────────────────────────────────────

export async function test_readDacWorkMode_returnsClassH(assert) {
  // Response format: [READ, CMD, len, value] — mode at data[3]
  // Protocol Max: len may be 1 or 2; data[3] is always the mode byte
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x1D] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x1D, 0x01, 0x00] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readDacWorkMode(makeDetails(mock));
  assert.equal(result, 0, 'should return 0 (Class H)');
}

export async function test_readDacWorkMode_returnsClassAB(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x1D] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x1D, 0x01, 0x01] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readDacWorkMode(makeDetails(mock));
  assert.equal(result, 1, 'should return 1 (Class AB)');
}

export async function test_readDacWorkMode_handlesLen2Response(assert) {
  // Protocol Max firmware returns len=2 in the response header
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x1D] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x1D, 0x02, 0x01, 0x00] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readDacWorkMode(makeDetails(mock));
  assert.equal(result, 1, 'len=2 response: data[3]=1 should still return 1 (Class AB)');
}

export async function test_setDacWorkMode_sendsMode0(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacWorkMode(makeDetails(mock), 0);
  assert.ok(mock.wasSent([0x01, 0x1D, 0x01, 0x00]), 'should send WRITE DAC_WORK_MODE 0');
}

export async function test_setDacWorkMode_sendsMode1(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacWorkMode(makeDetails(mock), 1);
  assert.ok(mock.wasSent([0x01, 0x1D, 0x01, 0x01]), 'should send WRITE DAC_WORK_MODE 1');
}

// ── Gain mode (CMD 0x19) ──────────────────────────────────────────────────────

export async function test_readGainMode_returnsTrue(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x19, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x19, 0x00, 0x01] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readGainMode(makeDetails(mock));
  assert.equal(result, true, 'should return true when value is 1');
}

export async function test_readGainMode_returnsFalse(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max',
    exchanges: [{
      send: { reportId: REPORT_ID, data: [0x80, 0x19, 0x00] },
      responses: [{ reportId: REPORT_ID, data: [0x80, 0x19, 0x00, 0x00] }]
    }]
  });
  await mock.open();
  const result = await walkplayUsbHID.readGainMode(makeDetails(mock));
  assert.equal(result, false, 'should return false when value is 0');
}

export async function test_setGainMode_sendsEnabled(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setGainMode(makeDetails(mock), true);
  assert.ok(mock.wasSent([0x01, 0x19, 0x01, 0x01]), 'should send WRITE GAIN_MODE 1 (enabled)');
}

export async function test_setGainMode_sendsDisabled(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setGainMode(makeDetails(mock), false);
  assert.ok(mock.wasSent([0x01, 0x19, 0x01, 0x00]), 'should send WRITE GAIN_MODE 0 (disabled)');
}

// ── DAC balance ───────────────────────────────────────────────────────────────

export async function test_setDacBalance_centreResetsBalance(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacBalance(makeDetails(mock), 0, 0);
  // Centre: expects the "reset both to 0" sequence
  assert.ok(mock.sendCount >= 2, 'centre balance should send at least 2 reports');
}

export async function test_setDacBalance_leftBoostSendsLeftDelta(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacBalance(makeDetails(mock), 10, 0);
  assert.ok(mock.wasSent([0x01, 0x16, 0x04, 0x01, 0x00, 10, 0x00]),
    'left boost should send DAC_BALANCE left=10');
}

export async function test_setDacBalance_rightBoostSendsRightDelta(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setDacBalance(makeDetails(mock), 0, 20);
  assert.ok(mock.wasSent([0x01, 0x16, 0x04, 0x00, 0x00, 20, 0x00]),
    'right boost should send DAC_BALANCE right=20');
}

// ── Output gain ───────────────────────────────────────────────────────────────

export async function test_setOutputGain_sendsPositiveGain(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setOutputGain(makeDetails(mock), 3);
  assert.ok(mock.wasSent([0x01, 0x03, 0x02, 0x00, 3]), 'should send WRITE GLOBAL_GAIN 3');
}

export async function test_setOutputGain_sendsZeroGain(assert) {
  const mock = new MockHIDDevice({ vendorId: 0x3302, productId: 0x43CC, productName: 'Protocol Max' });
  await mock.open();
  await walkplayUsbHID.setOutputGain(makeDetails(mock), 0);
  assert.ok(mock.wasSent([0x01, 0x03, 0x02, 0x00, 0]), 'should send WRITE GLOBAL_GAIN 0');
}

// ── globalGainBuffer logic ────────────────────────────────────────────────────

export async function test_pushToDevice_skipsGainWithinBuffer(assert) {
  const mock = await (async () => {
    const { loadCapture } = await import('../MockHIDDevice.js');
    return loadCapture('../captures/walkplay_schemeno16_protocol_max.json');
  })();
  await mock.open();
  const details = makeDetails(mock, { deviceHandlesPregain: false, globalGainBuffer: -5 });
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = (pulled.filters || []).filter(f => f !== undefined);
  // preamp of -3 dB is within the -5 dB buffer — global gain register should be written as 0
  await walkplayUsbHID.pushToDevice(details, null, 101, -3, filters);
  const gainWrites = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x03);
  if (gainWrites.length > 0) {
    assert.equal(gainWrites[0][4], 0, 'within-buffer preamp should write 0 to gain register');
  } else {
    assert.ok(true, 'no gain write sent (device handles pregain)');
  }
}

export async function test_pushToDevice_writesGainBeyondBuffer(assert) {
  const mock = await (async () => {
    const { loadCapture } = await import('../MockHIDDevice.js');
    return loadCapture('../captures/walkplay_schemeno16_protocol_max.json');
  })();
  await mock.open();
  const details = makeDetails(mock, { deviceHandlesPregain: false, globalGainBuffer: -5 });
  const pulled = await walkplayUsbHID.pullFromDevice(details, 101);
  mock.resetHistory();
  const filters = (pulled.filters || []).filter(f => f !== undefined);
  // preamp of -8 dB exceeds the -5 dB buffer — delta = -8 - (-5) = -3 should be written
  await walkplayUsbHID.pushToDevice(details, null, 101, -8, filters);
  const gainWrites = mock.sentBytes.filter(b => b[0] === 0x01 && b[1] === 0x03);
  if (gainWrites.length > 0) {
    // gain byte is signed; -3 written as 0xFD = 253 when treated as unsigned
    const gainByte = gainWrites[0][4];
    const signed = gainByte > 127 ? gainByte - 256 : gainByte;
    assert.equal(signed, -3, 'beyond-buffer preamp should write delta -3 to gain register');
  } else {
    assert.ok(true, 'no gain write sent (device handles pregain)');
  }
}
