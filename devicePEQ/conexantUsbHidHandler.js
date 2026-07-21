//
// Copyright 2024 : Pragmatic Audio
//
// Conexant Freeman DSP USB HID Handler
// ────────────────────────────────────
// Supports: Moondrop FreeDSP (Conexant Freeman DSP via USB-C)
//
// Protocol: Custom packet packing with per-sample-rate biquad coefficients
// Report ID: 0x01
// Bands: 9 fixed (31, 62, 125, 250, 500, 1k, 2k, 4k, 8k Hz)
// Sample Rates: 44.1k, 48k, 96k, 192k (all 4 variants written per filter)
//

import { logHidTx, logHidRx } from './deviceDebugLog.js';

export const conexantUsbHidHandler = (function () {
  const REPORT_ID = 0x01;
  const PACKET_SIZE = 61;
  const HEADER_BYTES = [1, 1, 0];
  const MAGIC_NUMBER = 0xB307B0;  // 3006079744 in decimal

  // Packet IDs for different operations
  const PACKET_ID_SAVE = 220;
  const PACKET_ID_RAM = 190;
  const PACKET_ID_MODE = 90;

  // Sample rate mapping
  const SAMPLE_RATES = [
    { idx: 0x04, rate: 44100 },
    { idx: 0x05, rate: 48000 },
    { idx: 0x06, rate: 96000 },
    { idx: 0x07, rate: 192000 }
  ];

  // Fixed band frequencies for Conexant (9 bands)
  const FIXED_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000];

  function getCurrentSlot(deviceDetails) {
    // Conexant devices use preset slot 0 by default
    return Promise.resolve(0);
  }

  async function pullFromDevice(deviceDetails) {
    // Conexant devices don't support reading current settings
    // Return empty filters with fixed frequencies
    const filters = FIXED_FREQUENCIES.map((freq, idx) => ({
      index: idx,
      freq: freq,
      gain: 0,
      q: 1.0,
      type: 'PK',
      enabled: true,
      disabled: false
    }));

    return {
      filters: filters,
      globalGain: 0,
      currentSlot: 0,
      complete: true
    };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;

    try {
      // Write each filter with all 4 sample-rate variants
      for (let i = 0; i < filters.length && i < FIXED_FREQUENCIES.length; i++) {
        const filter = filters[i];
        console.log(`USB Device PEQ: Conexant writing filter ${i}: freq=${filter.freq}, gain=${filter.gain}, q=${filter.q}`);

        // Write to flash (save mode)
        await writeFilterToFlash(device, i + 1, filter);
      }

      // Apply the EQ profile
      await applyEQMode(device, 0);

      console.log(`USB Device PEQ: Conexant pushed ${filters.length} filters successfully`);
      return false;
    } catch (error) {
      console.error('USB Device PEQ: Conexant pushToDevice failed:', error);
      throw error;
    }
  }

  async function enablePEQ(deviceDetails, enable, slotId) {
    const device = deviceDetails.rawDevice;
    if (!enable) {
      await applyEQMode(device, 0);  // Disable
    }
  }

  /**
   * Pack data array into Conexant protocol packet
   * Format:
   *   [1, 1, 0,                              // Header
   *    length | (packetId << 16),            // Length + packet ID
   *    ...,                                  // length/id high bytes
   *    MAGIC_NUMBER (4 bytes LE),            // Magic number
   *    data[0] as 32-bit LE,                 // Data elements
   *    data[1] as 32-bit LE,
   *    ...]
   */
  function packPacket(packetId, dataArray) {
    const packet = new Uint8Array(PACKET_SIZE);
    let offset = 0;

    // Header
    for (const byte of HEADER_BYTES) {
      packet[offset++] = byte;
    }

    // Pack length and packet ID
    const length = dataArray.length;
    const packed = length | ((packetId & 0xFFF) << 16);
    packet[offset++] = packed & 0xFF;
    packet[offset++] = (packed >> 8) & 0xFF;
    packet[offset++] = (packed >> 16) & 0xFF;
    packet[offset++] = (packed >> 24) & 0xFF;

    // Magic number (4 bytes, little-endian)
    packet[offset++] = MAGIC_NUMBER & 0xFF;
    packet[offset++] = (MAGIC_NUMBER >> 8) & 0xFF;
    packet[offset++] = (MAGIC_NUMBER >> 16) & 0xFF;
    packet[offset++] = (MAGIC_NUMBER >> 24) & 0xFF;

    // Data array (each element as 32-bit little-endian)
    for (const value of dataArray) {
      packet[offset++] = value & 0xFF;
      packet[offset++] = (value >> 8) & 0xFF;
      packet[offset++] = (value >> 16) & 0xFF;
      packet[offset++] = (value >> 24) & 0xFF;
    }

    return packet;
  }

  async function writeFilterToFlash(device, bandNumber, filter) {
    // Part 1: Write config frame
    const configData = [
      0,                                    // data[0]
      bandNumber,                           // data[1] - band 1-9
      filter.freq,                          // data[2] - frequency
      Math.round(filter.q * 256),           // data[3] - Q fixed-point
      convertFromFilterType(filter.type),   // data[4] - filter type
      Math.round(filter.gain * 256)         // data[5] - gain fixed-point
    ];

    const configPacket = packPacket(PACKET_ID_SAVE, configData);
    logHidTx('Conexant', REPORT_ID, configPacket);
    console.log(`[Conexant] Writing config for band ${bandNumber}: ${JSON.stringify(configData)}`);
    await device.sendReport(REPORT_ID, configPacket);
    await new Promise(resolve => setTimeout(resolve, 15));

    // Part 2: Write biquad coefficients for each sample rate
    for (const sampleRateInfo of SAMPLE_RATES) {
      const biquad = computeBiquadForRate(filter.type, filter.freq, filter.gain, filter.q, sampleRateInfo.rate);

      const biquadData = [
        sampleRateInfo.idx,                 // data[0] - sample rate index
        bandNumber,                         // data[1] - band 1-9
        3,                                  // data[2] - biquad marker
        biquad[0],                          // data[3] - b0
        biquad[1],                          // data[4] - b1
        biquad[2],                          // data[5] - b2
        biquad[3],                          // data[6] - a1 (negated)
        biquad[4]                           // data[7] - a2 (negated)
      ];

      const biquadPacket = packPacket(PACKET_ID_SAVE, biquadData);
      logHidTx('Conexant', REPORT_ID, biquadPacket);
      console.log(`[Conexant] Writing biquad for band ${bandNumber} @ ${sampleRateInfo.rate}Hz`);
      await device.sendReport(REPORT_ID, biquadPacket);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }

  /**
   * Compute biquad coefficients for a specific sample rate
   * Returns [b0, b1, b2, -a1, -a2] quantized at 2^30
   */
  function computeBiquadForRate(type, freq, gain, q, sampleRate) {
    const A = Math.pow(10, gain / 40);      // Amplitude ratio
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const sin_w0 = Math.sin(w0);
    const cos_w0 = Math.cos(w0);
    const alpha = sin_w0 / (2 * q);

    let b0, b1, b2, a1, a2;

    switch (type) {
      case 'PK':  // Peak filter
        b0 = 1 + alpha * A;
        b1 = -2 * cos_w0;
        b2 = 1 - alpha * A;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha / A;
        break;

      case 'LSQ':  // Low shelf
        {
          const sqrt_A = Math.sqrt(A);
          const two_sqrt_A_alpha = 2 * sqrt_A * alpha;
          b0 = A * ((A + 1) - (A - 1) * cos_w0 + two_sqrt_A_alpha);
          b1 = 2 * A * ((A - 1) - (A + 1) * cos_w0);
          b2 = A * ((A + 1) - (A - 1) * cos_w0 - two_sqrt_A_alpha);
          a1 = -2 * ((A - 1) + (A + 1) * cos_w0);
          a2 = (A + 1) - (A - 1) * cos_w0 - two_sqrt_A_alpha;
        }
        break;

      case 'HSQ':  // High shelf
        {
          const sqrt_A = Math.sqrt(A);
          const two_sqrt_A_alpha = 2 * sqrt_A * alpha;
          b0 = A * ((A + 1) + (A - 1) * cos_w0 + two_sqrt_A_alpha);
          b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0);
          b2 = A * ((A + 1) + (A - 1) * cos_w0 - two_sqrt_A_alpha);
          a1 = 2 * ((A - 1) - (A + 1) * cos_w0);
          a2 = (A + 1) + (A - 1) * cos_w0 - two_sqrt_A_alpha;
        }
        break;

      default:
        b0 = 1;
        b1 = 0;
        b2 = 0;
        a1 = 0;
        a2 = 0;
    }

    // Normalize by a0 (which is always 1 + alpha / A for peak)
    const a0_norm = 1 + alpha / A;
    b0 /= a0_norm;
    b1 /= a0_norm;
    b2 /= a0_norm;
    a1 /= a0_norm;
    a2 /= a0_norm;

    // Quantize at 2^30
    const QUANTIZER = 1073741824;  // 2^30
    return [
      Math.round(b0 * QUANTIZER),
      Math.round(b1 * QUANTIZER),
      Math.round(b2 * QUANTIZER),
      Math.round(-a1 * QUANTIZER),  // Store negated for protocol
      Math.round(-a2 * QUANTIZER)   // Store negated for protocol
    ];
  }

  async function applyEQMode(device, modeIndex) {
    const modeData = [90, modeIndex];
    const modePacket = packPacket(PACKET_ID_MODE, modeData);
    logHidTx('Conexant', REPORT_ID, modePacket);
    console.log(`[Conexant] Applying EQ mode: ${modeIndex}`);
    await device.sendReport(REPORT_ID, modePacket);
  }

  function convertFromFilterType(filterType) {
    const mapping = {
      'PK': 0,
      'LSQ': 1,
      'HSQ': 2
    };
    return mapping[filterType] || 0;
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
