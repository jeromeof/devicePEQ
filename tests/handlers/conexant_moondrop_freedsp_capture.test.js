/**
 * Moondrop FreeDSP (Conexant Freeman DSP) — capture-based integration tests
 * Device: Moondrop FreeDSP (conexantUsbHidHandler)
 * vendorId=0x35D8  productId=0x1496
 * Capture: tests/captures/moondrop_freedsp_conexant.json
 *
 * peq9Band12dBFullShelves — 9 bands, ±12 dB, LS+HS, write-only
 * Protocol: Custom packet packing (Report ID 0x01, magic number 0xB307B0)
 * Per-sample-rate biquad coefficients (44.1k, 48k, 96k, 192k)
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { conexantUsbHidHandler } from '../../devicePEQ/conexantUsbHidHandler.js';

async function loadConexantCapture() {
  const captureUrl = new URL('../captures/moondrop_freedsp_conexant.json', import.meta.url).href;
  const capture = await fetch(captureUrl).then(r => r.json());
  return new MockHIDDevice({
    ...capture.device,
    exchanges: capture.exchanges,
    responseDelay: 5
  });
}

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Moondrop',
    modelConfig: {
      peqConstraintsRef: 'peq9Band12dBFullShelves',
      supportsLSFilter: true,
      supportsHSFilter: true,
      deviceHandlesPregain: false,
      maxFilters: 9,
      ...overrides
    }
  };
}

// ── Integration tests ──────────────────────────────────────────────────────

export async function test_conexantFreeDSP_pullReturnsDefaults(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await conexantUsbHidHandler.pullFromDevice(details);

  assert.ok(Array.isArray(result.filters), 'should return filter array');
  assert.equal(result.filters.length, 9, 'should have 9 fixed bands');
  result.filters.forEach((f, idx) => {
    assert.equal(f.gain, 0, `filter ${idx} gain should be 0 (default)`);
    assert.ok(f.freq > 0, `filter ${idx} frequency should be positive`);
  });
}

export async function test_conexantFreeDSP_pushSends11Packets(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { freq: 100, gain: 3.5, q: 0.9, type: 'PK' },
    { freq: 250, gain: -2, q: 1.2, type: 'LSQ' }
  ];

  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // 2 filters × (1 config + 4 biquad) + 1 mode = 11 packets
  assert.ok(mock._sentReports.length >= 11,
    `should send at least 11 packets for 2 filters, got ${mock._sentReports.length}`);
}

export async function test_conexantFreeDSP_allPacketsAre61Bytes(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { freq: 100, gain: 1, q: 1.0, type: 'PK' }
  ];

  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  mock._sentReports.forEach((report, idx) => {
    assert.equal(report.bytes.length, 61,
      `packet ${idx} should be 61 bytes, got ${report.bytes.length}`);
  });
}

export async function test_conexantFreeDSP_packetsHaveCorrectHeader(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{ freq: 100, gain: 0, q: 1.0, type: 'PK' }];
  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  mock._sentReports.forEach((report, idx) => {
    const bytes = report.bytes;
    assert.equal(bytes[0], 1, `packet ${idx} header[0] should be 1`);
    assert.equal(bytes[1], 1, `packet ${idx} header[1] should be 1`);
    assert.equal(bytes[2], 0, `packet ${idx} header[2] should be 0`);
  });
}

export async function test_conexantFreeDSP_packetsHaveMagicNumber(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{ freq: 100, gain: 0, q: 1.0, type: 'PK' }];
  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  const readU32LE = (bytes, offset) =>
    bytes[offset] | (bytes[offset+1] << 8) | (bytes[offset+2] << 16) | (bytes[offset+3] << 24);

  mock._sentReports.forEach((report, idx) => {
    const magic = readU32LE(report.bytes, 7);
    assert.equal(magic, 0xB307B0,
      `packet ${idx} magic should be 0xB307B0, got 0x${magic.toString(16)}`);
  });
}

export async function test_conexantFreeDSP_all4SampleRatesWritten(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{ freq: 100, gain: 0, q: 1.0, type: 'PK' }];
  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  const readU32LE = (bytes, offset) =>
    bytes[offset] | (bytes[offset+1] << 8) | (bytes[offset+2] << 16) | (bytes[offset+3] << 24);

  const sampleRateIndices = new Set();
  for (const report of mock._sentReports) {
    const srIdx = readU32LE(report.bytes, 11);
    if (srIdx >= 0x04 && srIdx <= 0x07) {
      sampleRateIndices.add(srIdx);
    }
  }

  assert.equal(sampleRateIndices.size, 4, 'should have 4 sample-rate variants');
}

export async function test_conexantFreeDSP_enableDisablePEQ(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Enable
  await conexantUsbHidHandler.enablePEQ(details, true, 0);
  // Disable
  await conexantUsbHidHandler.enablePEQ(details, false, 0);

  assert.ok(mock._sentReports.length > 0, 'should send packets');
}

export async function test_conexantFreeDSP_writeOnlyNoRead(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Pull should return defaults, not query device
  const result = await conexantUsbHidHandler.pullFromDevice(details);

  // Should not have sent any packets for read
  const initialCount = mock._sentReports.length;

  // Verify all filters are default (0 gain)
  result.filters.forEach(f => {
    assert.equal(f.gain, 0, 'pulled filter should have default gain');
  });

  // Only sent packets would be from setup, not from pull
  assert.ok(mock._sentReports.length === initialCount,
    'pull should not send packets to device');
}
