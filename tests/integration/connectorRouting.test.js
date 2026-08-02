/**
 * Connector Routing Integration Tests
 *
 * These tests verify that usbHidConnector.js correctly:
 *   1. Routes vendorId/productId to the right handler
 *   2. Merges defaultModelConfig + device/group overrides
 *   3. Resolves peqConstraints (maxFilters, minGain etc.) into modelConfig
 *
 * This catches regressions where:
 *   - A wrong handler is selected (e.g. WalkPlay matching a KT Micro device)
 *   - peqConstraints fields are missing after a refactor
 *   - Device-specific overrides (compensate2X, schemeNo, etc.) are lost
 *   - A new entry in usbDeviceConfig.js breaks an existing device's lookup
 */

import { MockHIDDevice } from '../MockHIDDevice.js';
import { UsbHIDConnector } from '../../devicePEQ/usbHidConnector.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Temporarily replace navigator.hid.requestDevice with one that returns
 * a MockHIDDevice, call fn(), then restore the original.
 */
async function withMockDevice(spec, fn) {
  const orig = navigator.hid.requestDevice.bind(navigator.hid);
  const mock = new MockHIDDevice({ ...spec, responseDelay: 0 });
  navigator.hid.requestDevice = async () => [mock];
  try {
    return await fn(mock);
  } finally {
    navigator.hid.requestDevice = orig;
  }
}

async function connectMock(spec) {
  const connector = await UsbHIDConnector;
  // Always disconnect first — the connector caches currentDevice and returns
  // it on subsequent calls to getDeviceConnected() without invoking requestDevice.
  try { await connector.disconnectDevice(); } catch (_) {}

  let connected = null;
  await withMockDevice(spec, async () => {
    connected = await connector.getDeviceConnected();
  });
  // Clean up after test
  try { await connector.disconnectDevice(); } catch (_) {}
  return connected;
}

// ── WalkPlay devices ──────────────────────────────────────────────────────────

export async function test_jm98max_walkplay_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x0661, productId: 0x0881, productName: 'JM98MAX' });
  assert.ok(device, 'should connect successfully');
  assert.equal(device.modelConfig.maxFilters, 8,       'JM98MAX maxFilters should be 8 (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.minGain, -10,        'JM98MAX minGain should be -10 dB (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.maxGain, 10,         'JM98MAX maxGain should be 10 dB (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.schemeNo, 10,        'schemeNo should be 10');
  assert.ok(device.handler,                            'handler should be assigned');
}

export async function test_jm98max_2_walkplay_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x2972, productId: 0x0104, productName: 'JM98MAX 2' });
  assert.ok(device, 'should connect successfully');
  assert.equal(device.modelConfig.maxFilters, 8,       'JM98MAX 2 maxFilters should be 8 (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.minGain, -10,        'JM98MAX 2 minGain should be -10 dB (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.maxGain, 10,         'JM98MAX 2 maxGain should be 10 dB (WalkPlay SchemeNo10)');
  assert.equal(device.modelConfig.schemeNo, 10,        'schemeNo should be 10');
  assert.ok(device.handler,                            'handler should be assigned');
}

export async function test_walkplay_schemeNo16_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x3302, productId: 0x4367, productName: 'TANCHJIM-SPACE PRO' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 10,      'TANCHJIM-SPACE PRO maxFilters should be 10');
  assert.equal(device.modelConfig.minGain, -10,        'TANCHJIM-SPACE PRO minGain should be -10');
  assert.equal(device.modelConfig.maxGain, 10,         'TANCHJIM-SPACE PRO maxGain should be 10');
  assert.equal(device.modelConfig.schemeNo, 16,        'TANCHJIM-SPACE PRO should still use SchemeNo16 commands');
  assert.equal(device.modelConfig.supportsLSFilter, false, 'TANCHJIM-SPACE PRO published/app PEQ is peak-only');
  assert.equal(device.modelConfig.supportsHSFilter, false, 'TANCHJIM-SPACE PRO published/app PEQ is peak-only');
}

export async function test_walkplay_schemeNo15_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x3302, productId: 0x4357, productName: 'ddHiFi DSP Cable - Memory' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 8,       'SchemeNo15 maxFilters should be 8');
  assert.equal(device.modelConfig.minGain, -10,        'SchemeNo15 minGain should be -10');
  assert.equal(device.modelConfig.maxGain, 10,         'SchemeNo15 maxGain should be 10');
}

// ── KT Micro devices ──────────────────────────────────────────────────────────

export async function test_ktmicro_bunny_dsp_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x31B2, productId: 0x1112, productName: 'TANCHJIM BUNNY DSP' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 5,       'KT Micro maxFilters should be 5');
  assert.equal(device.modelConfig.compensate2X, false, 'BUNNY DSP compensate2X should be false');
  assert.equal(device.modelConfig.deviceHandlesPregain, false, 'BUNNY DSP deviceHandlesPregain should be false (host writes pregain)');
}

export async function test_ktmicro_one_dsp_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x31B2, productId: 0x0111, productName: 'TANCHJIM-ONE DSP' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 5,       'KT Micro maxFilters should be 5');
  assert.equal(device.modelConfig.compensate2X, false, 'ONE DSP compensate2X should be false');
  assert.equal(device.modelConfig.baseRegisterOffset, 0x26, 'ONE DSP baseRegisterOffset should be 0x26');
}

export async function test_ktmicro_chu2_dsp_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x31B2, productId: 0x0113, productName: 'Chu2 DSP' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 5,       'KT Micro maxFilters should be 5');
  assert.equal(device.modelConfig.compensate2X, false, 'Chu2 DSP compensate2X should be false');
}

export async function test_ktmicro_not_matched_as_walkplay(assert) {
  // Critical regression: vendorId 0x31B2 must NOT match WalkPlay (was a bug)
  const device = await connectMock({ vendorId: 0x31B2, productId: 0x0111, productName: 'TANCHJIM-ONE DSP' });
  assert.ok(device, 'should connect');
  // WalkPlay devices have schemeNo; KT Micro does not
  assert.ok(device.modelConfig.schemeNo == null || device.modelConfig.compensate2X !== undefined,
    'KT Micro device should not be routed through WalkPlay (has compensate2X, not schemeNo)');
  assert.equal(device.modelConfig.maxFilters, 5, 'KT Micro has 5 bands, not 8 (WalkPlay default)');
}

// ── FiiO devices ──────────────────────────────────────────────────────────────

export async function test_fiio_ka17_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x2972, productId: 0x0093, productName: 'FIIO KA17' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 10,    'KA17 maxFilters should be 10');
  assert.equal(device.modelConfig.minGain, -12,      'KA17 minGain should be -12 (Z1 exception)');
  assert.equal(device.modelConfig.maxGain, 12,       'KA17 maxGain should be 12');
  assert.equal(device.modelConfig.supportsLPFilter, true, 'KA17 supports LP (not in M6 exceptions)');
  assert.equal(device.modelConfig.supportsHPFilter, true, 'KA17 supports HP');
  assert.equal(device.modelConfig.supportsBPFilter, true, 'KA17 supports BP');
  assert.equal(device.modelConfig.supportsAllPassFilter, true, 'KA17 supports AP');
}

export async function test_fiio_k19_wide_gain_range(assert) {
  const device = await connectMock({ vendorId: 0x2972, productId: 0x0093, productName: 'FIIO K19' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.maxFilters, 31,    'K19 maxFilters should be 31');
  assert.equal(device.modelConfig.minGain, -24,      'K19 minGain should be -24 (FiiO default, not in Z1 exceptions)');
  assert.equal(device.modelConfig.maxGain, 12,       'K19 maxGain should be 12');
  assert.equal(device.modelConfig.supportsLPFilter, false, 'K19 has no LP (in M6 exceptions: PK/LS/HS only)');
}

export async function test_fiio_default_wide_gain_range(assert) {
  // Devices not in Z1 gain exceptions use the wide -24/+12 range
  const device = await connectMock({ vendorId: 0x2972, productId: 0x0093, productName: 'FIIO Q7' });
  assert.ok(device, 'should connect');
  assert.equal(device.modelConfig.minGain, -24,      'Q7 should use wide -24 dB floor (FiiO default)');
  assert.equal(device.modelConfig.maxGain, 12,       'Q7 maxGain should be 12');
  assert.equal(device.modelConfig.supportsLPFilter, true, 'Q7 supports all 7 filter types');
}

// ── Fosi Audio devices ────────────────────────────────────────────────────────

export async function test_fosi_audio_ds3_routes_correctly(assert) {
  const device = await connectMock({ vendorId: 0x152A, productId: 0x88DB, productName: 'Fosi Audio DS3' });
  assert.ok(device, 'should connect');
  // 8, not 10: the DS3 exposes 8 bands (32 only on firmware >= 1.4.15, and
  // factory presets are 8 regardless) and rejects any index past that.
  assert.equal(device.modelConfig.maxFilters, 8,       'Fosi Audio maxFilters should be 8');
  assert.equal(device.modelConfig.reportId, 1,         'Fosi Audio reportId should be 1');
  assert.equal(device.modelConfig.deviceHandlesPregain, true, 'Fosi Audio handles pregain on-device');
}

// ── peqConstraints resolution ─────────────────────────────────────────────────
// These test that the connector merges peqConstraints into modelConfig.
// If this step is broken, handlers will receive undefined maxFilters/minGain etc.

export async function test_peqConstraints_maxFilters_always_present(assert) {
  const devices = [
    { vendorId: 0x0661, productId: 0x0881, productName: 'JM98MAX' },
    { vendorId: 0x3302, productId: 0x4367, productName: 'TANCHJIM-SPACE PRO' },
    { vendorId: 0x31B2, productId: 0x0113, productName: 'Chu2 DSP' },
    { vendorId: 0x152A, productId: 0x88DB, productName: 'Fosi Audio DS3' },
  ];
  for (const spec of devices) {
    const device = await connectMock(spec);
    assert.ok(typeof device.modelConfig.maxFilters === 'number' && device.modelConfig.maxFilters > 0,
      `${spec.productName} modelConfig.maxFilters should be a positive number, got ${device.modelConfig.maxFilters}`);
  }
}

export async function test_peqConstraints_gainRange_always_present(assert) {
  const devices = [
    { vendorId: 0x0661, productId: 0x0881, productName: 'JM98MAX' },
    { vendorId: 0x3302, productId: 0x4367, productName: 'TANCHJIM-SPACE PRO' },
  ];
  for (const spec of devices) {
    const device = await connectMock(spec);
    assert.ok(typeof device.modelConfig.minGain === 'number',
      `${spec.productName} modelConfig.minGain should be a number`);
    assert.ok(typeof device.modelConfig.maxGain === 'number',
      `${spec.productName} modelConfig.maxGain should be a number`);
    assert.ok(device.modelConfig.maxGain > device.modelConfig.minGain,
      `${spec.productName} maxGain should be greater than minGain`);
  }
}

export async function test_peqConstraints_filterSupport_flags_present(assert) {
  const device = await connectMock({ vendorId: 0x0661, productId: 0x0881, productName: 'JM98MAX' });
  // These flags must be present or the UI won't know what to grey out
  ['supportsLSFilter', 'supportsHSFilter', 'supportsLPFilter', 'supportsHPFilter',
   'supportsBPFilter', 'deviceHandlesPregain'].forEach(flag => {
    assert.ok(flag in device.modelConfig,
      `modelConfig.${flag} should be present after connector resolves peqConstraints`);
  });
}

export async function test_pushToDevice_truncatesToEnabledFiltersFirst(assert) {
  const connector = await UsbHIDConnector;
  const rawDevice = new MockHIDDevice({
    vendorId: 0x31B2,
    productId: 0x0111,
    productName: 'TANCHJIM-ONE DSP',
    responseDelay: 0
  });
  await rawDevice.open();

  const originalGetDevices = navigator.hid.getDevices.bind(navigator.hid);
  navigator.hid.getDevices = async () => [rawDevice];

  const received = {};
  const device = {
    rawDevice,
    model: rawDevice.productName,
    modelConfig: {
      maxFilters: 3,
      supportsLSFilter: true,
      supportsHSFilter: true,
      deviceHandlesPregain: false,
      defaultResetFiltersValues: [{ type: 'PK', freq: 100, q: 1, gain: 0, disabled: false }]
    },
    handler: {
      pushToDevice: async (_device, _phoneObj, _slot, _preamp, filters) => {
        received.filters = filters;
        return false;
      }
    }
  };

  try {
    await connector.pushToDevice(device, null, 0, 0, [
      { type: 'PK', freq: 20, q: 1, gain: 0, disabled: true },
      { type: 'PK', freq: 100, q: 1, gain: 1, disabled: false },
      { type: 'PK', freq: 200, q: 1, gain: 0, disabled: true },
      { type: 'PK', freq: 300, q: 1, gain: 2, disabled: false },
      { type: 'PK', freq: 400, q: 1, gain: 3, disabled: false }
    ]);
  } finally {
    navigator.hid.getDevices = originalGetDevices;
  }

  assert.deepEqual(received.filters.map(f => f.freq), [100, 300, 400],
    'when truncating, connector should keep enabled filters before disabled rows');
}
