// fiioSppSerialHandler.js
// Pragmatic Audio - Handler for FiiO EH11 / EH13 (Bluetooth SPP, 10-band PEQ)
//
// Same packet framing as the BLE GATT path — only the transport differs:
//   F1 10 00 LL  CC CC  [payload]  FF
//   where LL (2 bytes big-endian) = total packet length including all bytes
//
// Read EQ   (CMD 03 0D):
//   TX: F1 10 00 0A  03 0D  01 00 09  FF
//   RX: 80-byte response; 9-byte header, 10 × 7-byte band records, trailing FF
//   Per-band:  [gain_hi gain_lo  freq_hi freq_lo  q_hi q_lo  type]
//     gain = signed int16 big-endian ÷ 10 → dB
//     freq = uint16 big-endian → Hz
//     Q    = uint16 big-endian ÷ 100
//     type: 0=Peaking, 1=Low Shelf, 2=High Shelf
//
// Write EQ  (CMD 13 0D):  one packet per band; device ACKs each before next
//   TX: F1 10 00 11  13 0D  01 [idx][idx] [gain_hi gain_lo freq_hi freq_lo q_hi q_lo type]  FF
//
// Ref: FIIO_EH11_BLE_PROTOCOL.md

export const fiioSppSerial = (function () {

  const FIIO = {
    NUM_BANDS: 10,
    GAIN_MIN: -20,
    GAIN_MAX:  20,

    typeToString(t) { return t === 1 ? 'LSQ' : t === 2 ? 'HSQ' : 'PK'; },
    typeFromString(s) { return s === 'LSQ' ? 1 : s === 'HSQ' ? 2 : 0; },
  };

  // ── Protocol helpers ───────────────────────────────────────────────────────

  function buildPacket(cmd1, cmd2, payload = []) {
    const total = 2 + 2 + 2 + payload.length + 1;
    return new Uint8Array([
      0xF1, 0x10,
      (total >> 8) & 0xFF, total & 0xFF,
      cmd1, cmd2,
      ...payload,
      0xFF,
    ]);
  }

  function encGain(db) {
    let raw = Math.round(db * 10);
    if (raw < 0) raw += 0x10000;
    return [(raw >> 8) & 0xFF, raw & 0xFF];
  }

  function decGain(hi, lo) {
    let raw = (hi << 8) | lo;
    if (raw > 0x7FFF) raw -= 0x10000;
    return raw / 10.0;
  }

  function parseEQResponse(data) {
    if (data.length < 80) return null;
    if (data[0] !== 0xF1 || data[1] !== 0x10) return null;
    if (data[4] !== 0x03 || data[5] !== 0x0D) return null;

    const bands = [];
    const base  = 9; // 9-byte response header
    for (let i = 0; i < FIIO.NUM_BANDS; i++) {
      const o = base + i * 7;
      if (o + 7 > data.length - 1) break;
      bands.push({
        gain:    decGain(data[o],     data[o + 1]),
        freqHz:  (data[o + 2] << 8) | data[o + 3],
        q:       ((data[o + 4] << 8) | data[o + 5]) / 100.0,
        rawType: data[o + 6],
      });
    }
    return bands.length === FIIO.NUM_BANDS ? bands : null;
  }

  // ── Serial transport ───────────────────────────────────────────────────────

  /**
   * Accumulate bytes from the serial stream until the FiiO length header
   * (bytes 2-3) is satisfied, or until timeout.
   */
  async function readFiioPacket(device, timeoutMs = 6000) {
    const buf      = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now());
      const timeoutPromise = new Promise(r => setTimeout(() => r({ value: null, done: true }), remaining));
      const { value, done } = await Promise.race([device.readable.read(), timeoutPromise]);
      if (done || !value) break;

      for (const b of value) buf.push(b);

      if (buf.length >= 4) {
        const expected = (buf[2] << 8) | buf[3];
        if (buf.length >= expected) {
          return new Uint8Array(buf.slice(0, expected));
        }
      }
    }
    return null;
  }

  async function sendAndReceive(device, packet, timeoutMs = 4000) {
    await device.writable.write(packet);
    return await readFiioPacket(device, timeoutMs);
  }

  // ── Public interface ───────────────────────────────────────────────────────

  async function getCurrentSlot() {
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log('FiiO SPP: reading EQ from device');

    // Protocol version handshake (best-effort)
    try {
      const verPkt = buildPacket(0x00, 0x02, [0x01]);
      await sendAndReceive(deviceDetails, verPkt, 2000);
    } catch (_) {
      console.log('FiiO SPP: version handshake skipped');
    }

    const readPkt = buildPacket(0x03, 0x0D, [0x01, 0x00, 0x09]);
    const resp    = await sendAndReceive(deviceDetails, readPkt, 6000);

    if (!resp) throw new Error('FiiO SPP: no response to EQ read command');

    const bands = parseEQResponse(resp);
    if (!bands) throw new Error(`FiiO SPP: could not parse EQ response (${resp.length} bytes)`);

    const filters = bands.map(b => ({
      freq:     b.freqHz,
      gain:     b.gain,
      q:        b.q,
      type:     FIIO.typeToString(b.rawType),
      _rawType: b.rawType,
    }));

    console.log(`FiiO SPP: pulled ${filters.length} bands`);
    return { filters, globalGain: 0, profileId: 0 };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`FiiO SPP: writing ${filters.length} bands to device`);

    for (let i = 0; i < FIIO.NUM_BANDS; i++) {
      const f       = filters[i] || { freq: 1000, gain: 0, q: 0.72, type: 'PK' };
      const gainDb  = Math.max(FIIO.GAIN_MIN, Math.min(FIIO.GAIN_MAX, f.gain ?? 0));
      const freqRaw = Math.max(0, Math.min(0xFFFF, Math.round(f.freq ?? 1000)));
      const qRaw    = Math.round((f.q ?? 0.72) * 100);
      const type    = f._rawType ?? FIIO.typeFromString(f.type ?? 'PK');

      const [g_hi, g_lo] = encGain(gainDb);

      const pkt = buildPacket(0x13, 0x0D, [
        0x01, i, i,
        g_hi, g_lo,
        (freqRaw >> 8) & 0xFF, freqRaw & 0xFF,
        (qRaw    >> 8) & 0xFF, qRaw    & 0xFF,
        type,
      ]);

      console.log(`FiiO SPP: band ${i + 1}/${FIIO.NUM_BANDS}: ${f.freq ?? 1000}Hz ${gainDb.toFixed(1)}dB Q${(f.q ?? 0.72).toFixed(2)}`);

      try {
        await sendAndReceive(deviceDetails, pkt, 2000);
      } catch (_) {
        console.log(`FiiO SPP: no ACK for band ${i + 1}, continuing`);
      }

      await new Promise(r => setTimeout(r, 50));
    }

    console.log('FiiO SPP: all EQ bands written');
  }

  async function enablePEQ(device, enabled, slotId) {
    // FiiO EH11/EH13 do not expose an EQ on/off toggle via SPP
    console.log('FiiO SPP: EQ enable/disable not supported');
  }

  return { getCurrentSlot, pullFromDevice, pushToDevice, enablePEQ };
})();
