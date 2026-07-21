/**
 * Kiwi Ears S-Link (KT Micro / KT_3016L) — auto-generated tests
 * Capture: tests/captures/ktmicro_kiwi_ears_slink.json
 * vendorId=0x31B2  productId=0x3016
 *
 * The S-Link stores its 5 bands OUT OF ORDER in the register file, so it needs an
 * explicit bandRegisters map (not a flat baseRegisterOffset). Matched by productId 0x3016
 * via the KT Micro vendor's deviceGroups. Verified on-device: the map yields ascending
 * band frequencies, and band2's Q is read from 0x3F (0x3E is a phantom that always reads 0.7).
 *
 * Physical register → band: 0x35=band4, 0x37=band0, 0x39=band3, 0x3B=band1, 0x3D=band2.
 * Writes fire-and-forget (no ACK from device).
 */

import { loadCapture } from '../MockHIDDevice.js';
import { ktmicroUsbHidHandler } from '../../devicePEQ/ktmicroUsbHidHandler.js';

const BAND_REGISTERS = [
  { freq: 0x37, q: 0x38 }, // band0
  { freq: 0x3B, q: 0x3C }, // band1
  { freq: 0x3D, q: 0x3F }, // band2 — Q at 0x3F
  { freq: 0x39, q: 0x3A }, // band3
  { freq: 0x35, q: 0x36 }  // band4
];

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Kiwi Ears',
    modelConfig: {
      peqConstraintsRef:   'peq5Band12dBFullShelvesNoPregain',
      maxFilters:           5,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 0x03,
      maxWritableEQSlots:     1,
      disconnectOnSave:    true,
      compensate2X:        false,
      bandRegisters:       BAND_REGISTERS,
      disabledPresetId:   0x02,
      availableSlots: [{ id: 0x03, name: 'Custom' }],
      ...overrides
    }
  };
}

// ── pull tests ────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_returns5Bands(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const result = await ktmicroUsbHidHandler.pullFromDevice(makeDeviceDetails(mock), 0x03);
  const defined = result.filters.filter(f => f != null);
  assert.equal(defined.length, 5, 'should return 5 filter bands');
}

export async function test_pullFromDevice_decodesBandsInAscendingFrequency(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const result = await ktmicroUsbHidHandler.pullFromDevice(makeDeviceDetails(mock), 0x03);
  // The reordered map must reassemble bands in ascending frequency order.
  assert.deepEqual(
    result.filters.map(f => f.freq),
    [101, 231, 379, 4696, 16788],
    'reordered register map should yield ascending band frequencies'
  );
}

export async function test_pullFromDevice_decodesGains(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const result = await ktmicroUsbHidHandler.pullFromDevice(makeDeviceDetails(mock), 0x03);
  assert.deepEqual(
    result.filters.map(f => f.gain),
    [1.1, -2.3, 3.7, -3.4, 5.8],
    'should decode signed gains per band'
  );
}

export async function test_pullFromDevice_band2QReadFrom0x3F(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const result = await ktmicroUsbHidHandler.pullFromDevice(makeDeviceDetails(mock), 0x03);
  // band2 Q is 2.0 (stored at 0x3F). If the handler wrongly read the phantom 0x3E it
  // would get 0.7 — so this pins the 0x3F mapping.
  assert.deepEqual(
    result.filters.map(f => f.q),
    [0.7, 0.7, 2.0, 0.7, 0.7],
    'band2 Q must come from 0x3F (2.0), not the phantom 0x3E (0.7)'
  );
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  await ktmicroUsbHidHandler.pullFromDevice(makeDeviceDetails(mock), 0x03);
  if (mock.unmatchedCount > 0) console.warn('Unmatched:', mock._unmatchedSends);
  assert.equal(mock.unmatchedCount, 0, `unmatched sends should be 0, got ${mock.unmatchedCount}`);
}

// ── push tests ────────────────────────────────────────────────────────────────

export async function test_pushToDevice_writesToReorderedRegisters(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f != null);
  await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters);
  const writeRegs = mock.sentBytes.filter(b => b.length > 4 && b[4] === 0x57).map(b => b[0]);
  // band order 0..4 → (freq,q) pairs from the reordered map
  assert.deepEqual(writeRegs, [0x37,0x38, 0x3B,0x3C, 0x3D,0x3F, 0x39,0x3A, 0x35,0x36],
    'writes must target the KT_3016L reordered register map (band2 Q at 0x3F)');
}

export async function test_pushToDevice_doesNotThrow(assert) {
  const mock = await loadCapture('../captures/ktmicro_kiwi_ears_slink.json');
  await mock.open();
  const details = makeDeviceDetails(mock);
  const pulled = await ktmicroUsbHidHandler.pullFromDevice(details, 0x03);
  mock.resetHistory();
  const filters = pulled.filters.filter(f => f != null);
  let threw = false;
  try { await ktmicroUsbHidHandler.pushToDevice(details, null, 0x03, 0, filters); }
  catch (e) { threw = true; console.warn('Push threw:', e.message); }
  assert.ok(!threw, 'pushToDevice should not throw (fire-and-forget writes)');
}
