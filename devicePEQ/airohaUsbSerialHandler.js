// airohaUsbSerialHandler.js
// Pragmatic Audio - Handler for Airoha-based Bluetooth Headphones
// Note: Many Airoha-based third-party apps have bugs with Connect Status (0x03)
// that cause infinite retry loops with malformed checksums.

export const airohaUsbSerial = (function () {

  const AIROHA = {
    NUM_BANDS: 10,
    RESPONSE_HEADER: [0x05, 0x5B, 0xBD],
    READ_RESPONSE_LENGTH: 193
  };

  function buildReadPresetCommand(preset) {
    return new Uint8Array([0x05, 0x5A, 0x06, 0x00, 0x00, 0x0A, preset & 0xFF, 0xEF, 0xE8, 0x03]);
  }

  function buildWritePEQCommandFull(presetNum, filters) {
    if (presetNum < 0 || presetNum > 3) {
      throw new Error('Preset must be 0-3');
    }
    if (filters.length !== AIROHA.NUM_BANDS) {
      throw new Error(`Must provide exactly ${AIROHA.NUM_BANDS} filters`);
    }

    const cmd = [];

    // Header: 05 5A 4F
    cmd.push(0x05, 0x5A, 0x4F);

    // Length placeholder (will fill later)
    const lengthPos = cmd.length;
    cmd.push(0x00, 0x00);

    // Subcommand: 03 0E 00 (not part of length)
    cmd.push(0x03, 0x0E, 0x00);

    // Preset index (4 bytes, little-endian)
    const presetBytes = new Uint8Array(new Uint32Array([presetNum]).buffer);
    cmd.push(...presetBytes);

    // Number of sections (6 from capture)
    cmd.push(0x06);

    const sampleRates = [44100, 48000, 88200, 96000, 44100, 48000];
    for (const sampleRate of sampleRates) {
      // Sample rate section header
      cmd.push(0x00, 0x67, 0x00, 0x0A, 0x00);

      // Sample rate value (4 bytes, little-endian)
      const srBytes = new Uint8Array(new Uint32Array([sampleRate]).buffer);
      cmd.push(...srBytes);

      for (const band of filters) {
        const filterType = band.filterType !== undefined ? band.filterType : 2;

        // Filter header: 01 [type]
        cmd.push(0x01, filterType);

        // Frequency (4 bytes: Hz × 100, as 2-byte int + 2 zero bytes)
        const freqVal = Math.round(band.freqHz * 100);
        cmd.push(freqVal & 0xFF, (freqVal >> 8) & 0xFF, 0x00, 0x00);

        // Gain (4 bytes: dB × 100, signed little-endian)
        const gainVal = Math.round(band.gainDb * 100);
        const gainBytes = new Uint8Array(new Int32Array([gainVal]).buffer);
        cmd.push(...gainBytes);

        // Q factor (4 bytes: Q × 100, little-endian)
        const qVal = Math.round(band.qValue * 100);
        const qBytes = new Uint8Array(new Uint32Array([qVal]).buffer);
        cmd.push(...qBytes);

        // Type/flags (4 bytes)
        cmd.push(0xC8, 0x00, 0x00, 0x00);
      }
    }

    const payloadLen = cmd.length - 3;
    cmd[lengthPos] = payloadLen & 0xFF;
    cmd[lengthPos + 1] = (payloadLen >> 8) & 0xFF;

    return new Uint8Array(cmd);
  }

  function parsePEQResponse(data) {
    if (data.length < AIROHA.READ_RESPONSE_LENGTH) {
      return null;
    }

    if (data[0] !== AIROHA.RESPONSE_HEADER[0] ||
        data[1] !== AIROHA.RESPONSE_HEADER[1] ||
        data[2] !== AIROHA.RESPONSE_HEADER[2]) {
      return null;
    }

    const result = {
      numBands: data[5],
      eqEnabled: data[8] === 1,
      filters: []
    };

    const filterStart = 13;
    for (let i = 0; i < Math.min(AIROHA.NUM_BANDS, result.numBands); i++) {
      const offset = filterStart + (i * 18);
      if (offset + 18 > data.length) break;

      const freqRaw = data[offset + 2] | (data[offset + 3] << 8) |
        (data[offset + 4] << 16) | (data[offset + 5] << 24);
      const freqHz = freqRaw / 100.0;

      let gainRaw = ((data[offset + 6] | (data[offset + 7] << 8) |
        (data[offset + 8] << 16) | (data[offset + 9] << 24)) >>> 0);
      if (gainRaw > 0x7FFFFFFF) gainRaw -= 0x100000000;
      const gainDb = gainRaw / 100.0;

      const qRaw = data[offset + 14] | (data[offset + 15] << 8) |
        (data[offset + 16] << 16) | (data[offset + 17] << 24);
      const qValue = qRaw / 100.0;

      result.filters.push({
        freq: freqHz,
        gain: gainDb,
        q: qValue,
        type: "PK"
      });
    }

    return result;
  }

  function normalizeFilters(filters, targetCount) {
    const normalized = [];
    for (const filter of filters) {
      normalized.push({
        freqHz: filter.freq,
        gainDb: filter.gain,
        qValue: filter.q,
        filterType: filter.type === "LSQ" ? 3 : filter.type === "HSQ" ? 4 : 2
      });
      if (normalized.length >= targetCount) break;
    }

    while (normalized.length < targetCount) {
      normalized.push({
        freqHz: 1000.0,
        gainDb: 0.0,
        qValue: 1.0,
        filterType: 2
      });
    }

    return normalized;
  }

  async function writePacket(device, packet) {
    const writer = device.writable;
    await writer.write(packet);
  }

  async function readPEQPacket(device, timeoutMs = 5000) {
    const startTime = Date.now();
    let buffer = [];

    while (Date.now() - startTime < timeoutMs) {
      const { value, done } = await device.readable.read();
      if (done || !value) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }

      buffer.push(...Array.from(value));

      const headerIndex = buffer.indexOf(AIROHA.RESPONSE_HEADER[0]);
      if (headerIndex > 0) {
        buffer = buffer.slice(headerIndex);
      }

      if (buffer.length >= AIROHA.READ_RESPONSE_LENGTH) {
        const packet = buffer.slice(0, AIROHA.READ_RESPONSE_LENGTH);
        const parsed = parsePEQResponse(new Uint8Array(packet));
        if (parsed) {
          return parsed;
        }
        buffer = buffer.slice(1);
      }
    }

    return null;
  }

  async function getCurrentSlot(deviceDetails) {
    console.log('Airoha USB Serial: defaulting to slot 0');
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log(`Airoha USB Serial: pulling EQ from slot ${slot}`);

    try {
      const command = buildReadPresetCommand(slot);
      await writePacket(deviceDetails, command);

      const response = await readPEQPacket(deviceDetails, 5000);
      if (!response) {
        throw new Error('No response from device when reading PEQ');
      }

      console.log(`Airoha USB Serial: pulled ${response.filters.length} filters from slot ${slot}`);
      return {
        filters: response.filters,
        globalGain: 0,
        profileId: slot
      };
    } catch (error) {
      console.error('Airoha USB Serial: pullFromDevice failed:', error);
      return { filters: [], globalGain: 0 };
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Airoha USB Serial: pushing ${filters.length} filters to slot ${slot}`);

    try {
      const normalized = normalizeFilters(filters, AIROHA.NUM_BANDS);
      const command = buildWritePEQCommandFull(slot, normalized);

      await writePacket(deviceDetails, command);

      console.log('Airoha USB Serial: PEQ write command sent');
      return true;
    } catch (error) {
      console.error('Airoha USB Serial: pushToDevice failed:', error);
      throw error;
    }
  }

  async function enablePEQ(device, enabled, slotId) {
    console.log(`Airoha USB Serial: enable/disable not supported (requested ${enabled} for slot ${slotId})`);
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
