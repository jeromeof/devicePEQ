/**
 * Packet Inspector Utility
 * ════════════════════════════════════════════════════════════════════════════
 * Standalone tool for analyzing and verifying USB HID packet structures.
 *
 * Usage:
 *   import { inspectPacket, inspectConexantPacket } from './packetInspector.js';
 *
 *   // Inspect raw packet bytes
 *   const result = inspectPacket(bytes, 'conexant');
 *   console.log(result.summary);
 */

/**
 * Inspect a raw Conexant packet
 * Returns structured analysis with validation
 */
export function inspectConexantPacket(bytes) {
  if (!bytes || bytes.length !== 61) {
    return {
      valid: false,
      error: `Invalid packet size: expected 61, got ${bytes.length}`
    };
  }

  const readU32LE = (offset) =>
    bytes[offset] | (bytes[offset+1] << 8) | (bytes[offset+2] << 16) | (bytes[offset+3] << 24);

  const readS32LE = (offset) => {
    const u32 = readU32LE(offset);
    return u32 > 0x7FFFFFFF ? u32 - 0x100000000 : u32;
  };

  // Header [1, 1, 0]
  const header = [bytes[0], bytes[1], bytes[2]];
  const headerValid = header[0] === 1 && header[1] === 1 && header[2] === 0;

  // Magic number at offset 7-10 (little-endian)
  const magic = readU32LE(7);
  const magicValid = magic === 0xB307B0;

  // Length + PacketID packed at offset 3-6
  const packed = readU32LE(3);
  const length = packed & 0xFFFF;
  const packetId = (packed >> 16) & 0xFFF;

  // Parse data array starting at offset 11
  const dataElements = [];
  for (let i = 0; i < (61 - 11) / 4; i++) {
    dataElements.push(readS32LE(11 + i * 4));
  }

  // Analyze what type of packet this is
  let packetType = 'unknown';
  let analysis = {};

  if (packetId === 220 || packetId === 190) {
    // Could be config or biquad frame
    const data2 = dataElements[2];

    if (data2 === 3) {
      // Biquad frame
      packetType = 'biquad';
      const sampleRateIdx = dataElements[0];
      const sampleRateMap = { 0x04: '44.1kHz', 0x05: '48kHz', 0x06: '96kHz', 0x07: '192kHz' };
      analysis = {
        sampleRateIndex: `0x${sampleRateIdx.toString(16)}`,
        sampleRate: sampleRateMap[sampleRateIdx] || 'unknown',
        bandNumber: dataElements[1],
        biquadMarker: dataElements[2],
        coefficients: {
          b0: `0x${(dataElements[3] >>> 0).toString(16)} (${dataElements[3]})`,
          b1: `0x${(dataElements[4] >>> 0).toString(16)} (${dataElements[4]})`,
          b2: `0x${(dataElements[5] >>> 0).toString(16)} (${dataElements[5]})`,
          'a1_neg': `0x${(dataElements[6] >>> 0).toString(16)} (${dataElements[6]})`,
          'a2_neg': `0x${(dataElements[7] >>> 0).toString(16)} (${dataElements[7]})`
        }
      };
    } else {
      // Config frame
      packetType = 'config';
      const typeMap = { 0: 'PK', 1: 'LSQ', 2: 'HSQ' };
      analysis = {
        data0: dataElements[0],
        bandNumber: dataElements[1],
        frequency: dataElements[2],
        qFixed: dataElements[3],
        q: (dataElements[3] / 256).toFixed(3),
        filterType: typeMap[dataElements[4]] || `unknown(${dataElements[4]})`,
        gainFixed: dataElements[5],
        gain: (dataElements[5] / 256).toFixed(3)
      };
    }
  } else if (packetId === 90) {
    // Mode frame
    packetType = 'mode';
    analysis = {
      modeCmd: dataElements[0],
      modeIndex: dataElements[1]
    };
  }

  return {
    valid: headerValid && magicValid,
    packetType,
    header: {
      bytes: header,
      valid: headerValid
    },
    magic: {
      value: `0x${magic.toString(16)}`,
      valid: magicValid
    },
    lengthPacketId: {
      length,
      packetId,
      raw: `0x${packed.toString(16)}`
    },
    dataElements: dataElements.slice(0, 8), // First 8 elements
    analysis,
    hexDump: bytes.reduce((acc, b, i) => {
      if (i % 16 === 0) acc += `\n${i.toString(16).padStart(2, '0')}: `;
      acc += b.toString(16).padStart(2, '0') + ' ';
      return acc;
    }, '')
  };
}

/**
 * Format inspection result for console output
 */
export function formatPacketInspection(inspection) {
  const lines = [];

  lines.push(`╔═══════════════════════════════════════════════════════════╗`);
  lines.push(`║ Conexant Packet Analysis`);
  lines.push(`╚═══════════════════════════════════════════════════════════╝`);

  if (!inspection.valid) {
    lines.push(`❌ INVALID PACKET: ${inspection.error}`);
    return lines.join('\n');
  }

  lines.push(`✓ Valid packet structure`);
  lines.push(``);

  lines.push(`Header:     [${inspection.header.bytes.join(', ')}] ${inspection.header.valid ? '✓' : '✗'}`);
  lines.push(`Magic:      0x${inspection.magic.value} ${inspection.magic.valid ? '✓' : '✗'}`);
  lines.push(``);

  lines.push(`Length:     ${inspection.lengthPacketId.length}`);
  lines.push(`Packet ID:  ${inspection.lengthPacketId.packetId}`);
  lines.push(`Type:       ${inspection.packetType.toUpperCase()}`);
  lines.push(``);

  if (inspection.packetType === 'config') {
    lines.push(`Config Frame:`);
    lines.push(`  Band:      ${inspection.analysis.bandNumber}`);
    lines.push(`  Frequency: ${inspection.analysis.frequency} Hz`);
    lines.push(`  Q:         ${inspection.analysis.q}`);
    lines.push(`  Gain:      ${inspection.analysis.gain} dB`);
    lines.push(`  Type:      ${inspection.analysis.filterType}`);
  } else if (inspection.packetType === 'biquad') {
    lines.push(`Biquad Frame:`);
    lines.push(`  Sample Rate: ${inspection.analysis.sampleRate}`);
    lines.push(`  Band:        ${inspection.analysis.bandNumber}`);
    lines.push(`  Coefficients:`);
    lines.push(`    b0:   ${inspection.analysis.coefficients.b0}`);
    lines.push(`    b1:   ${inspection.analysis.coefficients.b1}`);
    lines.push(`    b2:   ${inspection.analysis.coefficients.b2}`);
    lines.push(`    -a1:  ${inspection.analysis.coefficients.a1_neg}`);
    lines.push(`    -a2:  ${inspection.analysis.coefficients.a2_neg}`);
  } else if (inspection.packetType === 'mode') {
    lines.push(`Mode Frame:`);
    lines.push(`  Mode Command: ${inspection.analysis.modeCmd}`);
    lines.push(`  Mode Index:   ${inspection.analysis.modeIndex}`);
  }

  lines.push(``);
  lines.push(`Hex Dump:${inspection.hexDump}`);

  return lines.join('\n');
}

/**
 * Verify a sequence of packets represents a complete write operation
 */
export function verifyPacketSequence(packets) {
  if (packets.length === 0) {
    return { valid: false, error: 'No packets provided' };
  }

  const inspections = packets.map(p => inspectConexantPacket(p));

  if (!inspections.every(i => i.valid)) {
    return { valid: false, error: 'One or more invalid packets' };
  }

  // Analyze sequence
  const sequence = inspections.map(i => i.packetType);
  const configs = inspections.filter(i => i.packetType === 'config').length;
  const biquads = inspections.filter(i => i.packetType === 'biquad').length;
  const modes = inspections.filter(i => i.packetType === 'mode').length;

  // Expected pattern: N × (1 config + 4 biquads) + 1 mode
  const expectedBiquads = configs * 4;
  const biquadsValid = biquads === expectedBiquads;

  // Verify biquad sample rates
  const biquadInspections = inspections.filter(i => i.packetType === 'biquad');
  const sampleRates = new Set(
    biquadInspections.map(i => i.analysis.sampleRateIndex)
  );
  const hasAll4Rates = sampleRates.has('0x4') && sampleRates.has('0x5') &&
                       sampleRates.has('0x6') && sampleRates.has('0x7');

  return {
    valid: biquadsValid && modes === 1 && hasAll4Rates,
    configs,
    biquads,
    modes,
    expectedBiquads,
    biquadsValid,
    hasAll4Rates,
    sampleRates: Array.from(sampleRates),
    summary: `${configs} config(s), ${biquads} biquad(s), ${modes} mode(s)`
  };
}

/**
 * Generate a human-readable summary of a packet sequence
 */
export function summaryOfSequence(packets) {
  const verification = verifyPacketSequence(packets);

  if (!verification.valid) {
    return `❌ Invalid sequence: ${verification.error}`;
  }

  const lines = [];
  lines.push(`╔═══════════════════════════════════════════════════════════╗`);
  lines.push(`║ Write Sequence Summary`);
  lines.push(`╚═══════════════════════════════════════════════════════════╝`);

  lines.push(``);
  lines.push(`✓ Valid sequence`);
  lines.push(`  Packet count:  ${packets.length}`);
  lines.push(`  Config frames: ${verification.configs}`);
  lines.push(`  Biquad frames: ${verification.biquads} (${verification.configs} × 4)`);
  lines.push(`  Mode frames:   ${verification.modes}`);
  lines.push(``);

  if (!verification.biquadsValid) {
    lines.push(`⚠ Unexpected biquad count. Expected ${verification.expectedBiquads}, got ${verification.biquads}`);
  }

  if (!verification.hasAll4Rates) {
    lines.push(`⚠ Missing sample rate variants. Found: ${Array.from(verification.sampleRates).join(', ')}`);
  }

  if (verification.valid) {
    lines.push(`✓ All sample-rate variants present`);
    lines.push(`✓ Biquad count matches filter count`);
    lines.push(`✓ Mode activation packet present`);
  }

  return lines.join('\n');
}

/**
 * Compare expected vs actual packet sequences
 */
export function comparePacketSequences(expected, actual) {
  const expInspections = expected.map(p => inspectConexantPacket(p));
  const actInspections = actual.map(p => inspectConexantPacket(p));

  const issues = [];

  if (expInspections.length !== actInspections.length) {
    issues.push(`Packet count mismatch: expected ${expInspections.length}, got ${actInspections.length}`);
  }

  for (let i = 0; i < Math.min(expInspections.length, actInspections.length); i++) {
    const exp = expInspections[i];
    const act = actInspections[i];

    if (exp.packetType !== act.packetType) {
      issues.push(`Packet ${i}: type mismatch (expected ${exp.packetType}, got ${act.packetType})`);
    }

    if (exp.lengthPacketId.packetId !== act.lengthPacketId.packetId) {
      issues.push(`Packet ${i}: packet ID mismatch`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    summary: issues.length === 0 ? '✓ Sequences match' : `❌ ${issues.length} issue(s)`
  };
}
