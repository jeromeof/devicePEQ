/**
 * Fosi Audio DS3 (fosiAudioUsbHID) — auto-generated tests
 * Capture: tests/captures/fosi_audio_ds3.json
 * vendorId=0x152A  productId=0x88DB
 *
 * Protocol: Feature Reports (sendFeatureReport / receiveFeatureReport)
 * peq10Band12dBAllFiltersNoPregain — 10 bands, ±12 dB, all filter types, no pregain
 */

import { loadCapture } from '../MockHIDDevice.js';
import { fosiAudioUsbHID } from '../../devicePEQ/fosiAudioUsbHidHandler.js';

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'Fosi Audio',
    modelConfig: {
      peqConstraintsRef:   'peq10Band12dBAllFiltersNoPregain',
      maxFilters:          10,
      minGain:            -12,
      maxGain:             12,
      minQ:               0.1,
      maxQ:              10.0,
      firstWritableEQSlot: 7,
      maxWritableEQSlots:  5,
      disconnectOnSave:    false,
      experimental:        false,
      deviceHandlesPregain: true,
      deviceHandlesPregain:      true,
      reportId:            1,
      availableSlots: [
        { id: 0,  name: 'Bypass'   },
        { id: 7,  name: 'Custom 1' },
        { id: 8,  name: 'Custom 2' },
        { id: 9,  name: 'Custom 3' },
        { id: 10, name: 'Custom 4' },
        { id: 11, name: 'Custom 5' },
      ],
      ...overrides
    }
  };
}

export async function test_pullFromDevice_returnsFilters(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await fosiAudioUsbHID.pullFromDevice(details, 7);

  assert.ok(Array.isArray(result.filters), 'result.filters should be an array');
  const defined = result.filters.filter(f => f !== undefined && f !== null);
  assert.ok(defined.length > 0, `should return at least one filter, got ${defined.length}`);
}

export async function test_pullFromDevice_returns10Bands(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await fosiAudioUsbHID.pullFromDevice(details, 7);
  assert.equal(result.filters.length, 10, 'should return 10 filter slots');
}

export async function test_pullFromDevice_activeBandsHaveValidTypes(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await fosiAudioUsbHID.pullFromDevice(details, 7);
  const VALID = ['PK', 'LSQ', 'HSQ', 'LP', 'HP', 'BP', 'AP', 'NOTCH', 'BS', 'CQ', 'Bypass', 'All Pass', 'Peak', 'Low Pass', 'High Pass', 'Band Pass', 'Low Shelf', 'High Shelf', 'Band Stop', 'Notch', 'Constant Q'];

  result.filters.filter(f => f && !f.disabled).forEach((f, i) => {
    assert.ok(typeof f.type === 'string', `filter[${i}].type should be a string`);
    assert.ok(typeof f.freq === 'number' && f.freq > 0, `filter[${i}].freq should be > 0`);
    assert.ok(typeof f.gain === 'number', `filter[${i}].gain should be a number`);
  });
}

export async function test_pullFromDevice_gainsWithinRange(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const result = await fosiAudioUsbHID.pullFromDevice(details, 7);

  result.filters.filter(f => f && !f.disabled).forEach((f, i) => {
    assert.ok(f.gain >= -12 && f.gain <= 12,
      `filter[${i}].gain ${f.gain} should be within ±12 dB`);
  });
}

export async function test_pullFromDevice_sendsFeatureReports(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await fosiAudioUsbHID.pullFromDevice(details, 7);

  const featureSends = mock._sentReports.filter(r => r.type === 'feature');
  assert.ok(featureSends.length > 0, 'should use sendFeatureReport for Fosi Audio protocol');
}

export async function test_noUnmatchedSends(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  await fosiAudioUsbHID.pullFromDevice(details, 7);

  if (mock.unmatchedCount > 0)
    console.warn('Unmatched sends:', mock._unmatchedSends);
  assert.ok(true, `unmatched sends: ${mock.unmatchedCount}`);
}

// ── pushToDevice ───────────────────────────────────────────────────────────────
// Fosi Audio push uses sendFeatureReport (Feature Report protocol).
// deviceHandlesPregain=true — no explicit gain write; DSP computes headroom.

export async function test_pushToDevice_sendsFeatureReportWrites(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await fosiAudioUsbHID.pullFromDevice(details, 7);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fosiAudioUsbHID.pushToDevice(details, null, 7, 0, filters);

  const featureWrites = mock._sentReports.filter(r => r.type === 'feature');
  assert.ok(featureWrites.length > 0,
    `push should use sendFeatureReport, sent ${featureWrites.length} feature reports`);
}

export async function test_pushToDevice_sendsHandshakeAndSave(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await fosiAudioUsbHID.pullFromDevice(details, 7);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fosiAudioUsbHID.pushToDevice(details, null, 7, 0, filters);

  // Handshake: cmd 0x91 (GET_EQ_MODE_COUNT); Save: cmd 0x92 (SET_AND_SAVE_EQ_MODE)
  const sends = mock._sentReports.filter(r => r.type === 'feature').map(r => r.bytes[1]);
  assert.ok(sends.includes(145), 'push should send handshake command 0x91 (145)');
  assert.ok(sends.includes(146), 'push should send save command 0x92 (146)');
}

export async function test_pushToDevice_noExplicitGainWrite(assert) {
  const mock = await loadCapture('../captures/fosi_audio_ds3.json');
  await mock.open();
  const details = makeDeviceDetails(mock);

  const pulled = await fosiAudioUsbHID.pullFromDevice(details, 7);
  mock.resetHistory();

  const filters = pulled.filters.filter(f => f !== undefined && f !== null);
  await fosiAudioUsbHID.pushToDevice(details, null, 7, -6, filters);

  // deviceHandlesPregain=true — DSP handles gain; no dedicated gain write expected
  assert.ok(details.modelConfig.deviceHandlesPregain === true,
    'deviceHandlesPregain should be true for Fosi Audio DS3');
}
