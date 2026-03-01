// airohaBleHandler.js
// Pragmatic Audio - Handler for Airoha BLE (Audeze Maxwell)

export const airohaBle = (function () {
  const AIROHA = {
    NUM_BANDS: 10,
    RESPONSE_HEADER: [0x05, 0x5B, 0xBD],
    READ_RESPONSE_LENGTH: 193
  };

  function buildReadPresetCommand(preset) {
    return new Uint8Array([0x05, 0x5A, 0x06, 0x00, 0x00, 0x0A, preset & 0xFF, 0xEF, 0xE8, 0x03]);
  }

  function buildWritePEQCommandMirror(presetNum, filters) {
    if (presetNum < 0 || presetNum > 3) {
      throw new Error('Preset must be 0-3');
    }
    if (filters.length !== AIROHA.NUM_BANDS) {
      throw new Error(`Must provide exactly ${AIROHA.NUM_BANDS} filters`);
    }

    const cmd = [];

    // Header: 05 5A BD
    cmd.push(0x05, 0x5A, 0xBD);

    // Length field (2 bytes) - from capture: 00 01
    cmd.push(0x00, 0x01);

    // Header bytes from capture: 0A 00 EF 01 00 00 00 00
    cmd.push(0x0A, 0x00, 0xEF, 0x01, 0x00, 0x00, 0x00, 0x00);

    for (const band of filters) {
      const filterType = band.filterType !== undefined ? band.filterType : 2;

      cmd.push(0x01);
      cmd.push(filterType);

      const freqVal = Math.round(band.freqHz * 100);
      const freqBytes = new Uint8Array(new Uint32Array([freqVal]).buffer);
      cmd.push(...freqBytes);

      const gainVal = Math.round(band.gainDb * 100);
      const gainBytes = new Uint8Array(new Int32Array([gainVal]).buffer);
      cmd.push(...gainBytes);

      const bwVal = 0;
      const bwBytes = new Uint8Array(new Uint32Array([bwVal]).buffer);
      cmd.push(...bwBytes);

      const qVal = Math.round(band.qValue * 100);
      const qBytes = new Uint8Array(new Uint32Array([qVal]).buffer);
      cmd.push(...qBytes);
    }

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

  async function readPEQPacket(device, timeoutMs = 5000) {
    const startTime = Date.now();
    let buffer = [];

    while (Date.now() - startTime < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - startTime);
      const chunk = await device.readNotification(remaining);
      if (!chunk) {
        break;
      }

      buffer.push(...Array.from(chunk));

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

  async function writePacket(device, packet) {
    if (device.txChar.writeValueWithoutResponse) {
      await device.txChar.writeValueWithoutResponse(packet);
    } else {
      await device.txChar.writeValue(packet);
    }
  }

  async function getCurrentSlot(deviceDetails) {
    console.log('Airoha BLE: defaulting to slot 0');
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log(`Airoha BLE: pulling EQ from slot ${slot}`);

    try {
      const command = buildReadPresetCommand(slot);
      await writePacket(deviceDetails, command);

      const response = await readPEQPacket(deviceDetails, 5000);
      if (!response) {
        throw new Error('No response from device when reading PEQ');
      }

      console.log(`Airoha BLE: pulled ${response.filters.length} filters from slot ${slot}`);
      return {
        filters: response.filters,
        globalGain: 0,
        profileId: slot
      };
    } catch (error) {
      console.error('Airoha BLE: pullFromDevice failed:', error);
      return { filters: [], globalGain: 0 };
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Airoha BLE: pushing ${filters.length} filters to slot ${slot}`);

    try {
      const normalized = normalizeFilters(filters, AIROHA.NUM_BANDS);
      const command = buildWritePEQCommandMirror(slot, normalized);

      await writePacket(deviceDetails, command);
      console.log('Airoha BLE: PEQ write command sent');
      return true;
    } catch (error) {
      console.error('Airoha BLE: pushToDevice failed:', error);
      throw error;
    }
  }

  async function enablePEQ(device, enabled, slotId) {
    console.log(`Airoha BLE: enable/disable not supported (requested ${enabled} for slot ${slotId})`);
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
