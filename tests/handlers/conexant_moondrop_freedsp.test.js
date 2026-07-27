/**
 * Conexant Freeman DSP (Moondrop FreeDSP Cable) — packet structure tests
 * vendorId=0x35D8  productId=0x1496
 *
 * peq9Band12dBFullShelves — 9 bands, ±12 dB, LS+HS, pregain
 * Protocol: Custom packet packing (Report ID 0x01, magic number 0xB307B0)
 * Multi-part write: config frame + 4× per-sample-rate biquad frames
 */

import { MockHIDDevice } from '../MockHIDDevice.js';
import { conexantUsbHidHandler } from '../../devicePEQ/conexantUsbHidHandler.js';

function makeDeviceDetails(mock) {
  return {
    rawDevice: mock,
    model: 'FreeDSP',
    manufacturer: 'Moondrop',
    modelConfig: {
      peqConstraintsRef: 'peq9Band12dBFullShelves',
      supportsLSFilter: true,
      supportsHSFilter: true,
      deviceHandlesPregain: false,
      maxFilters: 9
    }
  };
}

// ── Packet structure tests ─────────────────────────────────────────────────────

/**
 * Test that all sent packets have correct basic structure:
 * - Header bytes [1, 1, 0]
 * - 4-byte length+ID packed
 * - 4-byte magic number (0xB307B0)
 * - Data elements as 32-bit LE
 * - Total packet size 61 bytes
 */
export async function test_packetStructure_hasCorrectHeader(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  // Create test filter
  const filters = [{
    freq: 100,
    gain: 3.5,
    q: 1.0,
    type: 'PK'
  }];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail on device I/O, but packets will be recorded
  }

  const sentReports = mock._sentReports;
  assert.ok(sentReports.length > 0, `should have sent packets, got ${sentReports.length}`);

  // Check first packet (config frame)
  const configReport = sentReports[0];
  const bytes = configReport.bytes;

  // Verify packet size
  assert.equal(bytes.length, 61, `packet should be 61 bytes, got ${bytes.length}`);

  // Verify header [1, 1, 0]
  assert.equal(bytes[0], 1, `header[0] should be 1, got ${bytes[0]}`);
  assert.equal(bytes[1], 1, `header[1] should be 1, got ${bytes[1]}`);
  assert.equal(bytes[2], 0, `header[2] should be 0, got ${bytes[2]}`);

  // Verify magic number at offset 7-10 (0xB307B0 in little-endian)
  const magic = bytes[7] | (bytes[8] << 8) | (bytes[9] << 16) | (bytes[10] << 24);
  assert.equal(magic, 0xB307B0, `magic number should be 0xB307B0, got 0x${magic.toString(16)}`);
}

/**
 * Test that packet ID is correctly encoded in the packed length+ID field
 */
export async function test_packetStructure_encodesPacketIdCorrectly(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{
    freq: 100,
    gain: 0,
    q: 1.0,
    type: 'PK'
  }];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail
  }

  const sentReports = mock._sentReports;

  // Extract packet IDs from sent packets
  const packetIds = sentReports.map(report => {
    const bytes = report.bytes;
    // Packet ID is encoded in bytes 3-4, shifted left 16 bits
    const packed = bytes[3] | (bytes[4] << 8) | (bytes[5] << 16) | (bytes[6] << 24);
    return (packed >> 16) & 0xFFF;
  });

  // Config/biquad frames should use packet ID 220
  // Mode frame should use packet ID 90
  assert.ok(packetIds.includes(220) || packetIds.includes(190), 'should have config packet ID (220 or 190)');

  // First packet should be config (220 or 190)
  const firstPacketId = packetIds[0];
  assert.ok(firstPacketId === 220 || firstPacketId === 190,
    `first packet ID should be 220 or 190, got ${firstPacketId}`);
}

/**
 * Test filter parameter encoding in config frame
 * Format: [0, bandNumber, freq, q*256, type, gain*256]
 */
export async function test_packetStructure_encodesFilterParameters(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const testFreq = 250;
  const testGain = 6.0;
  const testQ = 0.707;

  const filters = [{
    freq: testFreq,
    gain: testGain,
    q: testQ,
    type: 'PK'
  }];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail
  }

  const sentReports = mock._sentReports;
  const configReport = sentReports[0];
  const bytes = configReport.bytes;

  // Extract data array from packet (starting at byte 11, each element is 4 bytes LE)
  // data[0] = bytes[11-14] (should be 0)
  // data[1] = bytes[15-18] (band number = 1)
  // data[2] = bytes[19-22] (frequency)
  // data[3] = bytes[23-26] (Q * 256)
  // data[4] = bytes[27-30] (type)
  // data[5] = bytes[31-34] (gain * 256)

  const readU32LE = (data, offset) =>
    data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);

  const data0 = readU32LE(bytes, 11);
  const data1 = readU32LE(bytes, 15);
  const data2 = readU32LE(bytes, 19);
  const data3 = readU32LE(bytes, 23);
  const data4 = readU32LE(bytes, 27);
  const data5 = readU32LE(bytes, 31);

  assert.equal(data0, 0, `data[0] should be 0, got ${data0}`);
  assert.equal(data1, 1, `data[1] (band) should be 1, got ${data1}`);
  assert.equal(data2, testFreq, `data[2] (freq) should be ${testFreq}, got ${data2}`);
  assert.equal(Math.round(data3 / 256), Math.round(testQ),
    `data[3] (Q) should be ~${testQ}, got ${data3/256}`);
  assert.equal(data4, 0, `data[4] (type PK) should be 0, got ${data4}`);
  assert.equal(Math.round(data5 / 256), Math.round(testGain),
    `data[5] (gain) should be ~${testGain}, got ${data5/256}`);
}

/**
 * Test biquad coefficient quantization
 * Should be 5 coefficients [b0, b1, b2, -a1, -a2] quantized at 2^30
 */
export async function test_packetStructure_encodesBiquadCoefficients(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{
    freq: 1000,
    gain: 0,
    q: 1.0,
    type: 'PK'
  }];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail
  }

  const sentReports = mock._sentReports;

  // After config frame (index 0), we should have biquad frames for each sample rate
  // Biquad frames at indices 1-4
  assert.ok(sentReports.length >= 5,
    `should have at least 5 reports (config + 4 biquad variants), got ${sentReports.length}`);

  // Check one biquad frame (first biquad after config)
  const biquadReport = sentReports[1];
  const bytes = biquadReport.bytes;

  const readS32LE = (data, offset) => {
    const u32 = data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);
    // Convert from unsigned to signed if needed
    return u32 > 0x7FFFFFFF ? u32 - 0x100000000 : u32;
  };

  // Biquad data structure:
  // data[0] = sample rate index (0x04-0x07)
  // data[1] = band number
  // data[2] = 3 (biquad marker)
  // data[3-7] = b0, b1, b2, -a1, -a2 (5 coefficients)

  const sampleRateIdx = readS32LE(bytes, 11);
  const bandNum = readS32LE(bytes, 15);
  const biquadMarker = readS32LE(bytes, 19);
  const b0 = readS32LE(bytes, 23);
  const b1 = readS32LE(bytes, 27);
  const b2 = readS32LE(bytes, 31);
  const a1_neg = readS32LE(bytes, 35);
  const a2_neg = readS32LE(bytes, 39);

  // Verify structure
  assert.ok(sampleRateIdx >= 0x04 && sampleRateIdx <= 0x07,
    `sample rate index should be 0x04-0x07, got 0x${sampleRateIdx.toString(16)}`);
  assert.equal(bandNum, 1, `band number should be 1, got ${bandNum}`);
  assert.equal(biquadMarker, 3, `biquad marker should be 3, got ${biquadMarker}`);

  // Biquad coefficients should be reasonable magnitude (for flat response they'd be close to 0 or 1<<30).
  // NOTE: `2 << 30` overflows 32-bit signed int arithmetic in JS (wraps to
  // -2147483648), which made this assertion always false regardless of the
  // actual value — use `2 * 2**30` instead.
  const REASONABLE_MAGNITUDE = 2 * 2 ** 30;
  assert.ok(Math.abs(b0) < REASONABLE_MAGNITUDE, `b0 coefficient magnitude should be reasonable, got ${b0}`);
  assert.ok(Math.abs(b1) < REASONABLE_MAGNITUDE, `b1 coefficient magnitude should be reasonable, got ${b1}`);
  assert.ok(Math.abs(b2) < REASONABLE_MAGNITUDE, `b2 coefficient magnitude should be reasonable, got ${b2}`);
}

/**
 * Test that all 4 sample-rate variants are written
 */
export async function test_packetStructure_writes4SampleRateVariants(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  const filters = [{
    freq: 500,
    gain: 2.0,
    q: 0.8,
    type: 'LSQ'
  }];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail
  }

  const sentReports = mock._sentReports;

  // For 1 filter, we expect:
  // 1 config frame + 4 biquad frames (44.1k, 48k, 96k, 192k) + 1 mode frame = 6 reports
  assert.ok(sentReports.length >= 6,
    `should have at least 6 reports for 1 filter, got ${sentReports.length}`);

  // Extract sample rate indices from biquad frames
  const readU32LE = (data, offset) =>
    data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);

  const sampleRateIndices = new Set();
  for (let i = 1; i < sentReports.length - 1; i++) { // Skip config (0) and mode (last)
    const bytes = sentReports[i].bytes;
    const srIdx = readU32LE(bytes, 11);
    if (srIdx >= 0x04 && srIdx <= 0x07) {
      sampleRateIndices.add(srIdx);
    }
  }

  // Should have all 4 sample rate variants
  assert.equal(sampleRateIndices.size, 4,
    `should have 4 sample-rate variants, got ${sampleRateIndices.size}`);
  assert.ok(sampleRateIndices.has(0x04), 'should have 44.1kHz (0x04)');
  assert.ok(sampleRateIndices.has(0x05), 'should have 48kHz (0x05)');
  assert.ok(sampleRateIndices.has(0x06), 'should have 96kHz (0x06)');
  assert.ok(sampleRateIndices.has(0x07), 'should have 192kHz (0x07)');
}

/**
 * Test filter type encoding (PK=0, LSQ=1, HSQ=2)
 */
export async function test_packetStructure_encodesFilterTypesCorrectly(assert) {
  const testCases = [
    { type: 'PK', expected: 0 },
    { type: 'LSQ', expected: 1 },
    { type: 'HSQ', expected: 2 }
  ];

  for (const testCase of testCases) {
    const mock = new MockHIDDevice({
      vendorId: 0x35D8,
      productId: 0x1496,
      productName: 'Moondrop FreeDSP',
      reportId: 0x01,
      exchanges: []
    });
    await mock.open();
    const details = makeDeviceDetails(mock);

    const filters = [{
      freq: 100,
      gain: 0,
      q: 1.0,
      type: testCase.type
    }];

    try {
      await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
    } catch (e) {
      // Expected to fail
    }

    const sentReports = mock._sentReports;
    const configReport = sentReports[0];
    const bytes = configReport.bytes;

    const readU32LE = (data, offset) =>
      data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);

    const filterType = readU32LE(bytes, 27); // data[4] offset
    assert.equal(filterType, testCase.expected,
      `type ${testCase.type} should encode as ${testCase.expected}, got ${filterType}`);
  }
}

/**
 * Test multiple filters are written correctly
 */
export async function test_packetStructure_handlesMultipleFilters(assert) {
  const mock = new MockHIDDevice({
    vendorId: 0x35D8,
    productId: 0x1496,
    productName: 'Moondrop FreeDSP',
    reportId: 0x01,
    exchanges: []
  });
  await mock.open();
  const details = makeDeviceDetails(mock);

  // 3 filters
  const filters = [
    { freq: 100, gain: 2, q: 1.0, type: 'PK' },
    { freq: 500, gain: -1, q: 0.8, type: 'LSQ' },
    { freq: 2000, gain: 3, q: 1.2, type: 'HSQ' }
  ];

  try {
    await conexantUsbHidHandler.pushToDevice(details, {}, 0, 0, filters);
  } catch (e) {
    // Expected to fail
  }

  const sentReports = mock._sentReports;

  // For 3 filters, we expect:
  // 3 × (1 config + 4 biquad) + 1 mode = 18 reports
  const expectedMin = 3 * 5 + 1;
  assert.ok(sentReports.length >= expectedMin,
    `should have at least ${expectedMin} reports for 3 filters, got ${sentReports.length}`);

  // Verify band numbers in config frames are 1, 2, 3
  const readU32LE = (data, offset) =>
    data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);

  const bandNumbers = [];
  for (let i = 0; i < sentReports.length; i++) {
    const bytes = sentReports[i].bytes;
    const data1 = readU32LE(bytes, 15); // Band number at data[1]

    // Check if this looks like a config frame (should have distinct band numbers 1-3)
    if (data1 >= 1 && data1 <= 3) {
      bandNumbers.push(data1);
    }
  }

  // Should have config frames for bands 1, 2, 3
  assert.ok(bandNumbers.includes(1), 'should have config frame for band 1');
  assert.ok(bandNumbers.includes(2), 'should have config frame for band 2');
  assert.ok(bandNumbers.includes(3), 'should have config frame for band 3');
}
