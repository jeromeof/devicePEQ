/**
 * Qudelix-5K USB DAC 48KHz (qudelixUsbHidHandler) — auto-generated tests
 * Capture: tests/captures/qudelix_qudelix_5k.json
 * vendorId=0x0A12  productId=0x4005
 *
 * peq10Band12dBAllFilters — 10 bands, ±12 dB, all filter types
 * Protocol: fully fire-and-forget HID output reports (reportId=8).
 * Responses arrive via inputreport events but the binary preset format is not
 * yet decoded — pullFromDevice returns 10 flat default bands (gain=0) until
 * the Qudelix preset decoder is implemented.
 */

import { loadCapture } from '../MockHIDDevice.js';
import { qudelixUsbHidHandler } from '../../devicePEQ/qudelixUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Qudelix',
    modelConfig: {
      peqConstraintsRef:   'peq10Band12dBAllFilters',
      maxFilters:          10,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 0,
      maxWritableEQSlots:  10,
      disconnectOnSave:    false,
      availableSlots: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Custom ${i + 1}` })),
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await qudelixUsbHidHandler.pullFromDevice(details, 0);
  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  assert.ok(result.filters.length > 0, `should return at least one filter, got ${result.filters.length}`);
}

export async function test_pullFromDevice_returns10Bands(assert) {
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await qudelixUsbHidHandler.pullFromDevice(details, 0);
  assert.equal(result.filters.length, 10, 'should return 10 default bands');
}

export async function test_pullFromDevice_returnsDefaultFlatBandsOnTimeout(assert) {
  // The mock fires no inputreport events so waitForPreset times out (500ms) and
  // pullFromDevice returns flat defaults. This tests the fallback path.
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const result = await qudelixUsbHidHandler.pullFromDevice(details, 0);
  result.filters.forEach((f, i) => {
    assert.equal(f.gain, 0, `filter[${i}].gain should be 0 (flat default on timeout)`);
    assert.ok(typeof f.freq === 'number' && f.freq > 0, `filter[${i}].freq should be positive`);
  });
}

export async function test_presetDecoder_decodesGainCorrectly(assert) {
  // Build a synthetic 88-byte preset buffer with a known gain on band 0
  // and verify parseUserEqPreset returns the correct value.
  // We exercise the decoder directly by firing a synthetic inputreport event.
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Build a synthetic RspEqPreset packet: one segment, group=0, pktIdx=totalPkts=0
  // Data layout after parseResponse strips [len,cmdHi,cmdLo]:
  //   [0]=group(0), [1]=0x00 (totalPkts=0,pktIdx=0), [2-3]=0, [4-5]=offset(0), [6+]=preset bytes
  // Build the 88-byte user EQ preset with band 0 gain = +1.0 dB (raw=10, d10 encoded)
  // Bit layout: skip 32 header bits + 32 preGain bits + 320 freq bits = 384 bits
  // Then band 0: 4-bit type(5=Peak) + 10-bit gain(10) + 14-bit Q(1024) + 4-bit reserved
  const preset = new Uint8Array(88);
  // Write band 0 params at bit offset 384:
  // type=5 (Peak) in bits [384..387], gain=10 in bits [388..397], Q=1024 in bits [398..411]
  function writeBits(buf, bitOffset, numBits, value) {
    for (let i = 0; i < numBits; i++) {
      const byteIdx = (bitOffset + i) >> 3;
      const bitIdx  = (bitOffset + i) & 7;
      if ((value >> i) & 1) buf[byteIdx] |=  (1 << bitIdx);
      else                  buf[byteIdx] &= ~(1 << bitIdx);
    }
  }
  // freq for band 0: 1000 Hz (so we can verify it comes back)
  writeBits(preset, 64,  16, 1000);  // ch0 band0 freq at bit 64 (after 32+32 header bits)
  // Write default freqs for bands 1-9 too (ch0 only)
  const FREQS = [32,64,125,250,500,1000,2000,4000,8000,16000];
  for (let b = 1; b < 10; b++) writeBits(preset, 64 + b*16, 16, FREQS[b]);
  // ch1 freqs (bits 224-383): write defaults
  for (let b = 0; b < 10; b++) writeBits(preset, 224 + b*16, 16, FREQS[b]);
  // Band 0 filter params start at bit 384
  writeBits(preset, 384,  4, 5);    // type=Peak(5)
  writeBits(preset, 388, 10, 10);   // gain=10 → +1.0 dB
  writeBits(preset, 398, 14, 1024); // Q=1024 → 1.0

  // Build the HID inputreport packet: [len, 0x01, 0x28, group=0, pktInfo=0, 0, 0, 0, 0, ...preset]
  const cmdHi = 0x01, cmdLo = 0x28;
  const packetData = new Uint8Array(6 + 88);
  packetData[0] = 0;     // group = GROUP_USR
  packetData[1] = 0x00;  // totalPkts=0, pktIdx=0
  packetData[2] = 0;     // reserved
  packetData[3] = 0;     // reserved
  packetData[4] = 0;     // offsetHi
  packetData[5] = 0;     // offsetLo
  packetData.set(preset, 6);
  const payloadLen = 2 + packetData.length;  // cmd bytes + data
  const fullBuf = new Uint8Array(1 + 2 + packetData.length);
  fullBuf[0] = payloadLen;
  fullBuf[1] = cmdHi;
  fullBuf[2] = cmdLo;
  fullBuf.set(packetData, 3);

  // Start pullFromDevice, then fire the synthetic inputreport
  const pullPromise = qudelixUsbHidHandler.pullFromDevice(details, 0);
  // Fire inputreport event on the mock device after a tick
  setTimeout(() => mock.fireInputReport(8, fullBuf), 10);

  const result = await pullPromise;
  assert.ok(result.filters.length === 10, 'should return 10 bands');
  assert.equal(result.filters[0].type, 'PK',  'band 0 type should be PK');
  assert.equal(result.filters[0].gain, 1.0,   'band 0 gain should be +1.0 dB');
  assert.equal(result.filters[0].freq, 1000,  'band 0 freq should be 1000 Hz');
}

export async function test_pullFromDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  let threw = false;
  try { await qudelixUsbHidHandler.pullFromDevice(details, 0); }
  catch (e) { threw = true; console.warn('Pull threw:', e.message); }
  assert.ok(!threw, 'pullFromDevice should complete without throwing');
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_sendsBandWrites(assert) {
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await qudelixUsbHidHandler.pullFromDevice(details, 0);
  mock.resetHistory();
  await qudelixUsbHidHandler.pushToDevice(details, null, 0, 0, pulled.filters);
  // SetEqBandParam commands: packet[0]=13, cmd bytes [7,15]=0x070F
  const bandWrites = mock.sentBytes.filter(b => b[0] === 13 && b[2] === 7 && b[3] === 15);
  assert.equal(bandWrites.length, details.modelConfig.maxFilters,
    `should send one SetEqBandParam per band (${details.modelConfig.maxFilters}), got ${bandWrites.length}`);
}

export async function test_pushToDevice_gainEncoding(assert) {
  // Verify gain × 10 big-endian int16 encoding: gain=1.0 → bytes [0, 10]
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const filters = [{ type: 'PK', freq: 1000, q: 1.0, gain: 1.0 }];
  mock.resetHistory();
  await qudelixUsbHidHandler.pushToDevice(details, null, 0, 0, filters);
  const bandWrite = mock.sentBytes.find(b => b[0] === 13 && b[2] === 7 && b[3] === 15);
  assert.ok(bandWrite, 'should have sent a SetEqBandParam packet');
  // payload: [group, ch_mask, band, filter, freq_hi, freq_lo, gain_hi, gain_lo, q_hi, q_lo]
  // gain=1.0 * 10 = 10 → [0, 10]
  const gainHi = bandWrite[8], gainLo = bandWrite[9];
  assert.equal(gainHi, 0,  'gain_hi should be 0 for +1.0 dB');
  assert.equal(gainLo, 10, 'gain_lo should be 10 for +1.0 dB (gain × 10)');
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/qudelix_qudelix_5k.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await qudelixUsbHidHandler.pullFromDevice(details, 0);
  mock.resetHistory();
  let threw = false;
  try { await qudelixUsbHidHandler.pushToDevice(details, null, 0, 0, pulled.filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should complete without throwing');
}
