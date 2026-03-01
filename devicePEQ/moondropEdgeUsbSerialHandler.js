// moondropEdgeUsbSerialHandler.js
// Pragmatic Audio - Handler for Moondrop Edge ANC (Bluetooth SPP, 5-band PEQ)
//
// Protocol frame format (to device):
//   FF 04 [lenH] [lenL] 00 1D 0A [cmd] [payload...]
//   where len = payload length (not including the 8-byte header)
//
// CMD_ENABLE_EQ  (0x03): payload = [0x01] (enable) / [0x00] (disable)
// CMD_QUERY_EQ   (0x05): payload = [0x00, 0x04]
// CMD_SET_EQ     (0x06): payload = encoded band data (see encodeEQBands)
//
// ── Quirky "shifted" gain encoding ──────────────────────────────────────────
// The gain for band N is stored in the leading 2-byte header of band N+1's
// 7-byte slot (bands 1-4).  The last band's gain sits in a 2-byte padding
// region that follows the five normal band slots.
//
// Band slot layout (first 4 bands, 7 bytes each):
//   [gainPrev_H gainPrev_L  freq_H freq_L  q_H q_L  typeByte]
// Band slot 1 (7 bytes):
//   [0x00 0x00  freq_H freq_L  q_H q_L  typeByte]          (no preceding gain)
// Last band slot (6 bytes, no typeByte):
//   [gainPrev_H gainPrev_L  freq_H freq_L  q_H q_L]
// Padding (3 bytes after all 5 slots):
//   [gainLast_H gainLast_L  0x00]
//
// gain  = signed int16 big-endian × 60 → dB
// freq  = uint16 big-endian Hz
// Q     = uint16 big-endian × 4096 → Q factor

export const moondropEdgeUsbSerial = (function () {

  const MOONDROP = {
    NUM_BANDS:             5,
    PACKET_START:          0xFF,
    PROTOCOL_VERSION:      0x04,
    DEVICE_ID:             [0x00, 0x1D],
    DIRECTION_TO_DEVICE:   0x0A,
    DIRECTION_FROM_DEVICE: 0x0B,
    CMD_ENABLE_EQ:         0x03,
    CMD_QUERY_EQ:          0x05,
    CMD_SET_EQ:            0x06,
  };

  function createPacket(command, payload) {
    const len    = payload.length;
    const packet = new Uint8Array(8 + len);
    packet[0] = MOONDROP.PACKET_START;
    packet[1] = MOONDROP.PROTOCOL_VERSION;
    packet[2] = (len >> 8) & 0xFF;
    packet[3] = len & 0xFF;
    packet[4] = MOONDROP.DEVICE_ID[0];
    packet[5] = MOONDROP.DEVICE_ID[1];
    packet[6] = MOONDROP.DIRECTION_TO_DEVICE;
    packet[7] = command;
    packet.set(payload, 8);
    return packet;
  }

  // Parse the raw payload that follows the 8-byte packet header.
  // Returns an array of { frequency, qFactor, gain } objects (one per band).
  function parseEQData(payload) {
    if (payload.length < 2) return null;
    // payload[0..1] = band count header (always 0x00 0x04 for 5 bands)
    const bandData  = payload.slice(2);
    const bandOffsets = [0, 7, 14, 21, 28];  // byte offsets within bandData

    // First pass: read freq and Q from each band slot
    const bands = [];
    for (let i = 0; i < MOONDROP.NUM_BANDS; i++) {
      const off    = bandOffsets[i];
      const slotLen = (i === MOONDROP.NUM_BANDS - 1) ? 6 : 7;
      if (off + slotLen > bandData.length) return null;
      const bytes   = bandData.slice(off, off + slotLen);
      const freqHz  = (bytes[2] << 8) | bytes[3];
      const qRaw    = (bytes[4] << 8) | bytes[5];
      bands.push({
        rawBytes: Array.from(bytes),
        frequency: freqHz,
        qFactor:   qRaw / 4096.0,
        gain:      null,
      });
    }

    // Second pass: extract shifted gain values
    for (let i = 0; i < bands.length; i++) {
      if (i < MOONDROP.NUM_BANDS - 1) {
        // Gain for band i is in the first 2 bytes of band i+1's slot
        const raw    = (bands[i + 1].rawBytes[0] << 8) | bands[i + 1].rawBytes[1];
        const signed = raw > 32767 ? raw - 65536 : raw;
        bands[i].gain = signed / 60.0;
      } else {
        // Last band gain is in the 2-byte padding that follows all 5 slots
        const paddingOffset = 34; // 2 + 7 + 7 + 7 + 7 + 6 = 36 total; padding at [34..35]
        if (bandData.length >= paddingOffset + 2) {
          const raw    = (bandData[paddingOffset] << 8) | bandData[paddingOffset + 1];
          const signed = raw > 32767 ? raw - 65536 : raw;
          bands[MOONDROP.NUM_BANDS - 1].gain = signed / 60.0;
        } else {
          bands[MOONDROP.NUM_BANDS - 1].gain = 0;
        }
      }
    }

    return bands;
  }

  // Encode 5 bands into the Moondrop payload (including band-count header and padding)
  function encodeEQBands(bands) {
    const payload = [];

    // Band count header (always 0x00 0x04 for 5-band device)
    payload.push(0x00, 0x04);

    // Band 1: no preceding gain → header is 0x00 0x00
    payload.push(0x00, 0x00);
    const f1 = Math.max(0, Math.min(0xFFFF, Math.round(bands[0].freq)));
    payload.push((f1 >> 8) & 0xFF, f1 & 0xFF);
    const q1 = Math.round(bands[0].q * 4096);
    payload.push((q1 >> 8) & 0xFF, q1 & 0xFF);
    payload.push(0x00); // type byte

    // Bands 2 … (NUM_BANDS-1): header = gain of previous band
    for (let i = 1; i < MOONDROP.NUM_BANDS - 1; i++) {
      const prevGainRaw = Math.round(bands[i - 1].gain * 60);
      // Encode as signed int16 big-endian (two's complement)
      const prevGainU16 = prevGainRaw < 0 ? prevGainRaw + 65536 : prevGainRaw;
      payload.push((prevGainU16 >> 8) & 0xFF, prevGainU16 & 0xFF);
      const f = Math.max(0, Math.min(0xFFFF, Math.round(bands[i].freq)));
      payload.push((f >> 8) & 0xFF, f & 0xFF);
      const q = Math.round(bands[i].q * 4096);
      payload.push((q >> 8) & 0xFF, q & 0xFF);
      payload.push(0x00); // type byte
    }

    // Last band (6 bytes, no type byte): header = gain of band 4
    const lastIdx    = MOONDROP.NUM_BANDS - 1;
    const prevIdx    = MOONDROP.NUM_BANDS - 2;
    const prevGainRaw = Math.round(bands[prevIdx].gain * 60);
    const prevGainU16 = prevGainRaw < 0 ? prevGainRaw + 65536 : prevGainRaw;
    payload.push((prevGainU16 >> 8) & 0xFF, prevGainU16 & 0xFF);
    const fLast = Math.max(0, Math.min(0xFFFF, Math.round(bands[lastIdx].freq)));
    payload.push((fLast >> 8) & 0xFF, fLast & 0xFF);
    const qLast = Math.round(bands[lastIdx].q * 4096);
    payload.push((qLast >> 8) & 0xFF, qLast & 0xFF);

    // Padding: gain of last band (2 bytes) + 0x00
    const lastGainRaw = Math.round(bands[lastIdx].gain * 60);
    const lastGainU16 = lastGainRaw < 0 ? lastGainRaw + 65536 : lastGainRaw;
    payload.push((lastGainU16 >> 8) & 0xFF, lastGainU16 & 0xFF);
    payload.push(0x00);

    return new Uint8Array(payload);
  }

  // Read from device until a complete response header is found or timeout
  async function readResponse(device, expectedCmd, timeoutMs = 5000) {
    const buf      = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { value, done } = await device.readable.read();
      if (done) break;
      if (value) {
        for (const b of value) buf.push(b);
        // A complete Moondrop response has at least 8 bytes; check direction byte and command
        if (buf.length >= 8 &&
            buf[0] === 0xFF &&
            buf[6] === MOONDROP.DIRECTION_FROM_DEVICE &&
            buf[7] === expectedCmd) {
          return new Uint8Array(buf);
        }
      }
    }
    return null;
  }

  // ── Public interface ───────────────────────────────────────────────────────

  async function getCurrentSlot(deviceDetails) {
    // Moondrop Edge has a single EQ slot
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log('Moondrop Edge SPP: reading EQ from device');

    const queryPayload = new Uint8Array([0x00, 0x04]);
    const queryPacket  = createPacket(MOONDROP.CMD_QUERY_EQ, queryPayload);
    await deviceDetails.writable.write(queryPacket);

    const resp = await readResponse(deviceDetails, MOONDROP.CMD_QUERY_EQ, 5000);
    if (!resp || resp.length <= 8) {
      throw new Error('Moondrop Edge SPP: no EQ query response received');
    }

    const bands = parseEQData(resp.slice(8));
    if (!bands) {
      throw new Error('Moondrop Edge SPP: failed to parse EQ data from response');
    }

    const filters = bands.map(b => ({
      freq: b.frequency,
      gain: Math.round(b.gain * 100) / 100,
      q:    Math.round(b.qFactor * 1000) / 1000,
      type: 'PK',
    }));

    console.log(`Moondrop Edge SPP: pulled ${filters.length} bands`);
    return { filters, globalGain: 0, profileId: 0 };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Moondrop Edge SPP: writing ${filters.length} bands to device`);

    // Normalise to exactly 5 bands
    const bands = [];
    for (let i = 0; i < MOONDROP.NUM_BANDS; i++) {
      const f = filters[i] || { freq: 1000, gain: 0, q: 1.0 };
      bands.push({
        freq: f.freq ?? 1000,
        gain: f.gain ?? 0,
        q:    f.q ?? 1.0,
      });
    }

    const payload = encodeEQBands(bands);
    const packet  = createPacket(MOONDROP.CMD_SET_EQ, payload);
    await deviceDetails.writable.write(packet);

    console.log('Moondrop Edge SPP: EQ write command sent');
  }

  async function enablePEQ(device, enabled, slotId) {
    console.log(`Moondrop Edge SPP: ${enabled ? 'enabling' : 'disabling'} EQ`);
    const payload = new Uint8Array([enabled ? 0x01 : 0x00]);
    const packet  = createPacket(MOONDROP.CMD_ENABLE_EQ, payload);
    await device.writable.write(packet);
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
