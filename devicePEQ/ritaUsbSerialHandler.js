// ritaUsbSerialHandler.js
// Pragmatic Audio - Handler for Tanchjim Rita Headphones (Classic Bluetooth SPP)
// Protocol reverse-engineered from the Android app source
//
// Frame format:
//   TX: FF A1 <len> <cmd> [data...]  AA (terminator)
//   RX: FF A2 <len> <cmd> [data...]
//   where len = 1 (cmd) + data bytes
//
// Read EQ:  CMD_GET_ALL_EQ = FF A1 01 0B AA
//   Response: FF A2 56 0B 0C [12×7 bytes = 84 bytes]  (89 bytes total)
//
// Write EQ: FF A1 56 2B 0C [12×7 bytes = 84 bytes] AA  (90 bytes total)
//
// Per-band encoding (7 bytes): [filterType, gainHi, gainLo, freqHi, freqLo, qHi, qLo]
//   gain  = signed int16 big-endian × 100 → dB  (two's-complement for negative)
//   freq  = uint16 big-endian Hz
//   Q     = uint16 big-endian × 100

export const ritaUsbSerial = (function () {

  const RITA = {
    NUM_BANDS: 12,
    CMD_GET_ALL_EQ:  new Uint8Array([0xFF, 0xA1, 0x01, 0x0B, 0xAA]),
    CMD_RESET_EQ:    new Uint8Array([0xFF, 0xA1, 0x01, 0x2D, 0xAA]),
    SET_EQ_HEADER:   new Uint8Array([0xFF, 0xA1, 0x56, 0x2B, 0x0C]),
    RESPONSE_START:  [0xFF, 0xA2],
    EQ_RESPONSE_CMD: 0x0B,
    EQ_RESPONSE_LEN: 89,   // total bytes: 3 header + 86 payload
  };

  // Encode one 7-byte band block
  function encodeBand(gainDb, freqHz, q, filterType = 0x01) {
    const rawGain = (gainDb >= 0)
      ? Math.round(gainDb * 100)
      : (65536 + Math.round(gainDb * 100)) & 0xFFFF;
    const rawFreq = Math.round(freqHz) & 0xFFFF;
    const rawQ    = Math.max(1, Math.round(q * 100)) & 0xFFFF;
    return [
      filterType,
      (rawGain >> 8) & 0xFF, rawGain & 0xFF,
      (rawFreq >> 8) & 0xFF, rawFreq & 0xFF,
      (rawQ   >> 8) & 0xFF, rawQ   & 0xFF,
    ];
  }

  // Decode one 7-byte band block
  function decodeBand(bytes) {
    const filterType = bytes[0];
    const rawGain    = (bytes[1] << 8) | bytes[2];
    const gainDb     = (bytes[1] < 0x80)
      ? rawGain / 100
      : -(65536 - rawGain) / 100;
    const freqHz     = (bytes[3] << 8) | bytes[4];
    const rawQ       = (bytes[5] << 8) | bytes[6];
    const q          = rawQ / 100;
    return { filterType, gainDb, freqHz, q };
  }

  // Scan buffer for a complete FF A2 response frame
  function extractResponse(buf) {
    for (let i = 0; i < buf.length - 3; i++) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xA2) {
        const len   = buf[i + 2];
        const total = 3 + len;           // header(3) + payload(len)
        if (buf.length >= i + total) {
          return { bytes: buf.slice(i, i + total), end: i + total };
        }
      }
    }
    return null;
  }

  // Read from device until a complete response frame is assembled or timeout
  async function readResponse(device, timeoutMs = 8000) {
    const buf      = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { value, done } = await device.readable.read();
      if (done) break;
      if (value) {
        for (const b of value) buf.push(b);
        const result = extractResponse(buf);
        if (result) {
          return result.bytes;
        }
      }
    }
    return null;
  }

  // ── Public interface ───────────────────────────────────────────────────────

  async function getCurrentSlot(deviceDetails) {
    // Rita does not have preset slots; single-slot device
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log('Rita SPP: reading EQ from device');

    await deviceDetails.writable.write(RITA.CMD_GET_ALL_EQ);

    const resp = await readResponse(deviceDetails, 8000);
    if (!resp || resp.length < RITA.EQ_RESPONSE_LEN) {
      throw new Error(
        `Rita SPP: expected ${RITA.EQ_RESPONSE_LEN}-byte EQ response, got ${resp ? resp.length : 0}`
      );
    }

    const filters = [];
    for (let i = 0; i < RITA.NUM_BANDS; i++) {
      const off  = 5 + i * 7;   // response: FF A2 56 0B 0C [bands...]
      const band = decodeBand(resp.slice(off, off + 7));
      filters.push({
        freq: band.freqHz,
        gain: Math.round(band.gainDb * 100) / 100,
        q:    Math.round(band.q * 100) / 100,
        type: 'PK',
        // preserve original filter type byte for write-back
        _ritaFilterType: band.filterType,
      });
    }

    console.log(`Rita SPP: pulled ${filters.length} bands`);
    return { filters, globalGain: 0, profileId: 0 };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Rita SPP: writing ${filters.length} bands to device`);

    // Pad or trim to exactly 12 bands
    const bands = [];
    for (let i = 0; i < RITA.NUM_BANDS; i++) {
      const f = filters[i] || { freq: 1000, gain: 0, q: 1.0 };
      bands.push({
        gainDb:     f.gain ?? 0,
        freqHz:     f.freq ?? 1000,
        q:          f.q ?? 1.0,
        filterType: f._ritaFilterType ?? 0x01,
      });
    }

    const body = bands.flatMap(b =>
      encodeBand(b.gainDb, b.freqHz, b.q, b.filterType)
    );

    const packet = new Uint8Array([...RITA.SET_EQ_HEADER, ...body, 0xAA]);
    await deviceDetails.writable.write(packet);

    console.log('Rita SPP: EQ write command sent');
  }

  async function enablePEQ(device, enabled, slotId) {
    // Rita does not expose a separate EQ on/off command via this protocol
    console.log('Rita SPP: EQ enable/disable not supported');
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
