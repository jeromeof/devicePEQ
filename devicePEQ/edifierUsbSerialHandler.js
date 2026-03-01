// edifierUsbSerialHandler.js
// Pragmatic Audio - Handler for Edifier ConnectX headphones (Bluetooth SPP, 4-band PEQ)
//
// ── WRITE-ONLY ──────────────────────────────────────────────────────────────
// While the Edifier protocol technically supports reading back the EQ
// (CMD_CUSTOM_EQ_GET = 0x43), we intentionally do not implement the read path
// here.  pullFromDevice returns flat defaults so the user has a starting point.
// pushToDevice sends one set-band command per band.
//
// Packet format (TX):
//   AA  EC  [cmd]  [lenH]  [lenL]  [6-byte payload]  [crc]
//   ──  ──  ─────  ──────  ──────  ─────────────────  ───
//   hdr app cmd    length(2)        data               checksum (= sum of all bytes & 0xFF)
//
// CMD_CUSTOM_EQ_SET_BAND (0x44) payload (6 bytes):
//   [bandId  0xA5  freqByte2  freqByte3  gainByte  qByte]
//   bandId:   0xA5, 0xA4, 0xA7, 0xA6 for bands 0-3
//   freq:     2-byte lookup (see FREQ_TABLE — piecewise encoding, not simple formula)
//   gain:     0xA9 + (gainDb × 4)   range: -6 dB to +6 dB, 0.5 dB steps
//   Q:        0x95 + (Q × 14)       range: 0.5 to 5.0
//
// All parameters verified experimentally on Edifier W830NB (January 2026).

export const edifierUsbSerial = (function () {

  const EDIFIER = {
    HEADER_TX:  0xAA,
    APP_CODE:   0xEC,
    CMD_CUSTOM_EQ_SET_BAND: 0x44,

    // Gain encoding: 0xA9 = 0 dB; each unit = 0.25 dB; clamped to -6 … +6 dB
    GAIN_BASELINE: 0xA9,
    GAIN_SCALE:    4,

    // Q encoding: 0x95 = 0; each unit = 1/14 Q; clamped to 0.5 … 5.0
    Q_BASELINE:    0x95,
    Q_SCALE:       14,

    // Band IDs (non-sequential — verified from captures)
    BAND_IDS:      [0xA5, 0xA4, 0xA7, 0xA6],
    NUM_BANDS:     4,

    // Default center frequencies for the 4 bands when returning flat EQ
    DEFAULT_FREQS: [100, 500, 2000, 8000],

    // Frequency lookup table — 21 verified data points (20 Hz – 10 kHz)
    // Complex multi-harmonic encoding; simple polynomial does not fit — use this table.
    FREQ_TABLE: {
      20:    [0xA5, 0xB1],
      50:    [0xA5, 0x97],
      75:    [0xA5, 0xEE],
      76:    [0xA5, 0xE9],
      77:    [0xA5, 0xE8],
      100:   [0xA5, 0xC1],
      150:   [0xA5, 0x33],
      175:   [0xA5, 0x0A],
      200:   [0xA5, 0x6D],
      400:   [0xA4, 0x35],
      500:   [0xA4, 0x51],
      1000:  [0xA6, 0x4D],
      1500:  [0xA0, 0x79],
      2000:  [0xA2, 0x75],
      3000:  [0xAE, 0x1D],
      3078:  [0xA9, 0xA3],
      4000:  [0xAA, 0x05],
      5000:  [0xB6, 0x2D],
      6000:  [0xB2, 0xD5],
      8000:  [0xBA, 0xE5],
      10000: [0x82, 0xB5],
    },
  };

  // ── Encoding helpers ───────────────────────────────────────────────────────

  function calculateCRC(packet) {
    return packet.reduce((sum, b) => (sum + b) & 0xFF, 0);
  }

  function buildCommand(command, payload = []) {
    const len = payload.length;
    const pkt = [
      EDIFIER.HEADER_TX,
      EDIFIER.APP_CODE,
      command,
      (len >> 8) & 0xFF,
      len & 0xFF,
      ...payload,
    ];
    pkt.push(calculateCRC(pkt));
    return new Uint8Array(pkt);
  }

  function encodeGain(gainDb) {
    const clamped = Math.max(-6.0, Math.min(6.0, gainDb));
    return Math.round(EDIFIER.GAIN_BASELINE + clamped * EDIFIER.GAIN_SCALE) & 0xFF;
  }

  function encodeQ(qValue) {
    const clamped = Math.max(0.5, Math.min(5.0, qValue));
    return Math.round(EDIFIER.Q_BASELINE + clamped * EDIFIER.Q_SCALE) & 0xFF;
  }

  function encodeFrequency(freqHz) {
    const tableFreqs = Object.keys(EDIFIER.FREQ_TABLE).map(f => parseInt(f, 10));
    const nearest = tableFreqs.reduce((prev, curr) =>
      Math.abs(curr - freqHz) < Math.abs(prev - freqHz) ? curr : prev
    );
    if (nearest !== freqHz) {
      console.log(`Edifier SPP: frequency ${freqHz} Hz snapped to nearest table entry ${nearest} Hz`);
    }
    return EDIFIER.FREQ_TABLE[nearest];
  }

  // ── Public interface ───────────────────────────────────────────────────────

  async function getCurrentSlot(deviceDetails) {
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot) {
    // Write-only mode: return flat 0 dB EQ at the four default center frequencies.
    console.log('Edifier SPP: write-only mode — returning flat EQ defaults');
    const filters = EDIFIER.DEFAULT_FREQS.map(freq => ({
      freq,
      gain: 0.0,
      q:    1.4,   // Middle of the 0.5–5.0 range, typical Edifier preset value
      type: 'PK',
    }));
    return { filters, globalGain: 0, profileId: 0, writeOnly: true };
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Edifier SPP: writing ${EDIFIER.NUM_BANDS} bands to device`);

    for (let i = 0; i < EDIFIER.NUM_BANDS; i++) {
      const f         = filters[i] || { freq: EDIFIER.DEFAULT_FREQS[i], gain: 0, q: 1.4 };
      const bandId    = EDIFIER.BAND_IDS[i];
      const freqHz    = f.freq ?? EDIFIER.DEFAULT_FREQS[i];
      const gainDb    = f.gain ?? 0;
      const qValue    = f.q   ?? 1.4;

      const [freqB2, freqB3] = encodeFrequency(freqHz);
      const gainByte         = encodeGain(gainDb);
      const qByte            = encodeQ(qValue);

      // 6-byte payload: [bandId, 0xA5, freqByte2, freqByte3, gainByte, qByte]
      const payload = [bandId, 0xA5, freqB2, freqB3, gainByte, qByte];
      const packet  = buildCommand(EDIFIER.CMD_CUSTOM_EQ_SET_BAND, payload);

      await deviceDetails.writable.write(packet);

      // Small inter-band delay to avoid SPP buffer overrun
      await new Promise(r => setTimeout(r, 50));
    }

    console.log('Edifier SPP: all 4 bands written');
  }

  async function enablePEQ(device, enabled, slotId) {
    // Edifier does not expose a separate EQ on/off command in this handler
    console.log('Edifier SPP: EQ enable/disable not supported via this handler');
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
