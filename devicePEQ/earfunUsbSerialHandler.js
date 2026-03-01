// earfunUsbSerialHandler.js
// Pragmatic Audio - Handler for EarFun Tune Pro (Bluetooth SPP, 10-band graphic EQ)
//
// ── WRITE-ONLY ──────────────────────────────────────────────────────────────
// The EarFun protocol does not provide a command to read back PEQ values.
// pullFromDevice returns a flat (0 dB) EQ at the device's 10 fixed frequencies.
// pushToDevice sends one packet per band.
//
// Packet format per band:
//   EF  20  95  0A  [10-byte payload]  [checksum]  FE
//   ──  ──  ──  ──   ─────────────────  ─────────── ──
//   hdr cat cmd len  data               crc          end
//
// 10-byte payload:
//   [0x0A  bandNum(1-10)  0xFE  0x20  freqH  freqL  gainH  gainL  0x0B  0x33]
//   bandNum: 1-10
//   freq: Math.round(hz × 3) → uint16 big-endian
//   gain: Math.round(dB × 100 / 3) → signed int16 big-endian (two's-complement)
//   Q:    fixed at 0x0B 0x33 (2867 / 100 = 28.67 — device uses a fixed Q)
//
// Checksum: (payloadLength + sum-of-all-payload-bytes) & 0xFF
//   where payloadLength = 0x0A (always)

export const earfunUsbSerial = (function () {

  const EARFUN = {
    NUM_BANDS:       10,
    HEADER:          0xEF,
    CMD_CATEGORY:    0x20,
    CMD_SET_PEQ_BAND: 0x95,
    PAYLOAD_LENGTH:  0x0A,
    Q_FACTOR_H:      0x0B,
    Q_FACTOR_L:      0x33,
    FOOTER:          0xFE,
    // Standard 10-band frequencies used by the EarFun Tune Pro app
    STANDARD_FREQS: [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  };

  function encodeFrequency(hz) {
    const value = Math.round(hz * 3);
    return [(value >> 8) & 0xFF, value & 0xFF];
  }

  function encodeGain(dB) {
    let value = Math.round(dB * 100 / 3);
    if (value < 0) value = 65536 + value; // two's-complement 16-bit
    return [(value >> 8) & 0xFF, value & 0xFF];
  }

  function calculateChecksum(payload) {
    // payload[0] is the length byte (0x0A); checksum = (len + sum(all payload bytes)) & 0xFF
    const sum = payload.reduce((a, b) => a + b, 0);
    return (payload[0] + sum) & 0xFF;
  }

  function buildBandPacket(bandNum, frequencyHz, gainDb) {
    const [freqH, freqL] = encodeFrequency(frequencyHz);
    const [gainH, gainL] = encodeGain(gainDb);

    const payload = [
      EARFUN.PAYLOAD_LENGTH,   // 0x0A
      bandNum,                  // 1-10
      0xFE,                     // fixed byte
      0x20,                     // fixed byte
      freqH, freqL,
      gainH, gainL,
      EARFUN.Q_FACTOR_H,
      EARFUN.Q_FACTOR_L,
    ];

    const checksum = calculateChecksum(payload);

    return new Uint8Array([
      EARFUN.HEADER,
      EARFUN.CMD_CATEGORY,
      EARFUN.CMD_SET_PEQ_BAND,
      EARFUN.PAYLOAD_LENGTH,
      ...payload,
      checksum,
      EARFUN.FOOTER,
    ]);
  }

  // ── Public interface ───────────────────────────────────────────────────────

  async function getCurrentSlot(deviceDetails) {
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    // EarFun Tune Pro does not support reading EQ values back from the device.
    // Return a flat (0 dB) EQ at the 10 standard frequencies so the UI has
    // something sensible to display and edit.
    console.log('EarFun SPP: write-only device — returning flat EQ defaults');
    const filters = EARFUN.STANDARD_FREQS.map(freq => ({
      freq,
      gain: 0.0,
      // Q is fixed in the protocol; expose a human-readable approximation
      q:    1.0,
      type: 'PK',
    }));
    return { filters, globalGain: 0, profileId: 0, writeOnly: true };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`EarFun SPP: writing ${EARFUN.NUM_BANDS} bands to device`);

    for (let i = 0; i < EARFUN.NUM_BANDS; i++) {
      const f      = filters[i] || { freq: EARFUN.STANDARD_FREQS[i], gain: 0 };
      // Use the filter's frequency directly; EarFun accepts any value in its encoding range.
      const freqHz = f.freq ?? EARFUN.STANDARD_FREQS[i];
      const gainDb = f.gain ?? 0;

      const packet = buildBandPacket(i + 1, freqHz, gainDb);
      await deviceDetails.writable.write(packet);

      // Small inter-command delay to avoid overrunning the SPP buffer
      await new Promise(r => setTimeout(r, 50));
    }

    console.log('EarFun SPP: all 10 bands written');
  }

  async function enablePEQ(device, enabled, slotId) {
    // EarFun Tune Pro does not expose an explicit EQ on/off command
    console.log('EarFun SPP: EQ enable/disable not supported');
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
