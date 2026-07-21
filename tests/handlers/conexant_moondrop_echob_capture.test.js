/**
 * Moondrop ECHO-B (Conexant Freeman DSP) — capture-based integration tests
 * Device: Moondrop ECHO-B (conexantUsbHidHandler)
 * vendorId=0x35D8  productId=0x149B
 * Capture: tests/captures/moondrop_echob_conexant.json
 *
 * peq9Band12dBFullShelves — 9 bands, ±12 dB, LS+HS, write-only
 * Protocol: Custom packet packing (Report ID 0x01, magic number 0xB307B0)
 * Per-sample-rate biquad coefficients (44.1k, 48k, 96k, 192k)
 */

import { MockHIDDevice, loadCapture } from '../MockHIDDevice.js';
import { conexantUsbHidHandler } from '../../devicePEQ/conexantUsbHidHandler.js';

async function loadConexantCapture() {
  const captureUrl = new URL('../captures/moondrop_echob_conexant.json', import.meta.url).href;
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

export async function test_conexantECHOB_pullReturnsDefaults(assert) {
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

export async function test_conexantECHOB_pushSends16Packets(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { freq: 100, gain: 3.5, q: 0.9, type: 'PK' },
    { freq: 250, gain: -2, q: 1.2, type: 'LSQ' },
    { freq: 4000, gain: 4, q: 0.8, type: 'HSQ' }
  ];

  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  // 3 filters × (1 config + 4 biquad) + 1 mode = 16 packets
  assert.ok(mock._sentReports.length >= 16,
    `should send at least 16 packets for 3 filters, got ${mock._sentReports.length}`);
}

export async function test_conexantECHOB_supports3FilterTypes(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [
    { freq: 100, gain: 1, q: 1.0, type: 'PK' },
    { freq: 500, gain: -1, q: 0.9, type: 'LSQ' },
    { freq: 4000, gain: 2, q: 1.1, type: 'HSQ' }
  ];

  let error;
  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    error = e;
  }

  assert.ok(!error, 'should support PK, LSQ, HSQ without error');
}

export async function test_conexantECHOB_allPacketsAre61Bytes(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{ freq: 100, gain: 1, q: 1.0, type: 'PK' }];
  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  mock._sentReports.forEach((report, idx) => {
    assert.equal(report.bytes.length, 61,
      `packet ${idx} should be 61 bytes, got ${report.bytes.length}`);
  });
}

export async function test_conexantECHOB_reportIdIs1(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{ freq: 100, gain: 0, q: 1.0, type: 'PK' }];
  await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);

  mock._sentReports.forEach((report, idx) => {
    assert.equal(report.reportId, 1,
      `packet ${idx} should use report ID 0x01, got ${report.reportId}`);
  });
}

export async function test_conexantECHOB_gainRangeSupported(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Test edge gains: -12, 0, +12
  const filters = [
    { freq: 100, gain: -12, q: 1.0, type: 'PK' },
    { freq: 500, gain: 0, q: 1.0, type: 'PK' },
    { freq: 1000, gain: 12, q: 1.0, type: 'PK' }
  ];

  let error;
  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    error = e;
  }

  assert.ok(!error, 'should support full ±12 dB range');
}

export async function test_conexantECHOB_qRangeSupported(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Test edge Q values: 0.1, 1.0, 10.0
  const filters = [
    { freq: 100, gain: 0, q: 0.1, type: 'PK' },
    { freq: 500, gain: 0, q: 1.0, type: 'PK' },
    { freq: 1000, gain: 0, q: 10.0, type: 'PK' }
  ];

  let error;
  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    error = e;
  }

  assert.ok(!error, 'should support full 0.1-10.0 Q range');
}

export async function test_conexantECHOB_writeOnlyNoRead(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Pull should return defaults without querying device
  const initialReportCount = mock._sentReports.length;
  const result = await conexantUsbHidHandler.pullFromDevice(details);
  const afterPullCount = mock._sentReports.length;

  // Should not have sent packets for read operation
  assert.equal(afterPullCount, initialReportCount,
    'pull should not send packets to write-only device');

  // Verify all returned as defaults
  result.filters.forEach(f => {
    assert.equal(f.gain, 0, 'should return default (0 gain)');
  });
}

export async function test_conexantECHOB_currentSlotReturnsZero(assert) {
  const mock = await loadConexantCapture();
  await mock.open();
  const details = makeDeviceDetails(mock);

  const slot = await conexantUsbHidHandler.getCurrentSlot(details);

  assert.equal(slot, 0, 'should return slot 0 for write-only device');
}
