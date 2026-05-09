// qudelixUsbHidHandler.js
// Pragmatic Audio - Handler for Qudelix 5K USB HID EQ Control
//
// Protocol reverse-engineered from q5K-chrome-plugin.js (webpack bundle).
//
// HID framing (QCC / legacy 5K):
//   TX: [payload_len+1, 0x80, cmd_hi, cmd_lo, data...]  padded to report size
//   RX: [payload_len, cmd_hi, cmd_lo, data...]  payload_len = 2 + data_bytes
//
// EQ parameter encoding (legacy sendEqParam):
//   payload = [group, ch_mask, band_index, value_hi, value_lo]
//   gain × 10, Q × 1024, freq raw Hz (int16 big-endian, two's complement)

export const qudelixUsbHidHandler = (function () {

  // HID report IDs (from Qudelix plugin source: Ft enum)
  const REPORT_ID = {
    QX_HOST_TO_DEVICE: 8,  // primary TX report ID
    QX_OUT:            7,  // fallback TX report ID
    QX_DEVICE_TO_HOST: 9,  // RX report ID
    RESPONSE:          1,  // RX report ID (legacy)
  };

  // Command IDs (Tt enum, 16-bit big-endian in packet)
  const CMD = {
    ReqInitData:    0x0100,  // 256
    ReqDevStatus:   0x0110,  // 272  arg = Yc bitmask: 0x04=conn
    ReqDevConfig:   0x0120,  // 288  arg = hy bitmask: 0x3C=playTime|batt|mic|dac, 0xC0=sys2|eq
    ReqEqPreset:    0x0123,  // 291  arg = bitmask: 1=usr, 2=spk, 3=both
    RspInitData:    0x0101,  // 257
    RspDevConfig:   0x0121,  // 289
    RspEqPreset:    0x0128,  // 296
    RspEqPreset_L:  0x0124,  // 292
    RspEqPreset_H:  0x0125,  // 293
    Notification:   0xFF00,  // 65280
    Disconnect:     0x0107,  // 263

    SetEqEnable:    0x0700,  // 1792  legacy payload: [group, enable]
    SetEqType:      0x0701,  // 1793  legacy payload: [group, type] (1=PEQ)
    SetEqPreGain:   0x0703,  // 1795  via sendEqParam
    SetEqGain:      0x0704,  // 1796  via sendEqParam
    SetEqQ:         0x0705,  // 1797  via sendEqParam
    SetEqFilter:    0x0706,  // 1798  via sendEqParam (app filter enum)
    SetEqFreq:      0x0707,  // 1799  via sendEqParam
    SaveEqPreset:   0x0708,  // 1800  arg = preset index
    LoadEqPreset:   0x0709,  // 1801  arg = preset index
    SetEqBandParam: 0x070F,  // 1807  legacy payload: [group, ch_mask, band, filter, freq_hi, freq_lo, gain_hi, gain_lo, q_hi, q_lo]
    SetEqMute:      0x0710,  // 1808
    SetEqInvert:    0x0711,  // 1809
  };

  // Filter type app enum (_y enum — used in legacy sendEqParam)
  const FILTER = {
    Bypass: 0,
    LPF:    1,  // 2nd order LPF
    HPF:    2,  // 2nd order HPF
    LS:     3,  // Low Shelf
    HS:     4,  // High Shelf
    Peak:   5,  // Parametric EQ
  };

  // Value scaling (from Iy class constants)
  const GAIN_SCALE = 10;    // gain dB × 10 → int16
  const Q_SCALE    = 1024;  // Q factor × 1024 → int16

  // EQ group (by enum)
  const GROUP_USR = 0;  // user (headphone) EQ
  const CH_MASK_BOTH = 0x03;  // set both L and R channels

  // HID state (set during initHidReports)
  let sendReportId   = REPORT_ID.QX_HOST_TO_DEVICE;
  let sendReportSize = 64;

  // --- HID report discovery ---

  function initHidReports(device) {
    let foundSize = 0;
    let hasVendorCollection = false;

    for (const col of (device.collections || [])) {
      if (col.usagePage !== 0xFF00) continue;  // vendor-defined only
      hasVendorCollection = true;

      for (const r of (col.outputReports || [])) {
        const sz = r.items?.[0]?.reportCount || 0;
        if (r.reportId === REPORT_ID.QX_HOST_TO_DEVICE && sz > 0) {
          sendReportId   = REPORT_ID.QX_HOST_TO_DEVICE;
          sendReportSize = sz;
          console.log(`Qudelix: TX report ID=${sendReportId}, size=${sz}`);
          return;
        }
        if (r.reportId === REPORT_ID.QX_OUT && sz > 0 && foundSize === 0) {
          foundSize = sz;
        }
      }
    }

    if (foundSize > 0) {
      sendReportId   = REPORT_ID.QX_OUT;
      sendReportSize = foundSize;
      console.log(`Qudelix: TX report ID=${sendReportId}, size=${sendReportSize}`);
      return;
    }

    if (!hasVendorCollection) {
      // No vendor-defined HID collection — this is the wrong interface (e.g. the
      // USB audio / consumer-control HID interface, not the PEQ control interface).
      sendReportId = null;
      console.warn(`Qudelix: no vendor HID collection found on "${device.productName}". ` +
        `This is probably the audio interface — disconnect and select the PEQ control interface instead.`);
      return;
    }

    console.log(`Qudelix: TX report ID=${sendReportId}, size=${sendReportSize}`);
  }

  // --- Packet helpers ---

  function msb8(v) { return (v >> 8) & 0xFF; }
  function lsb8(v) { return v & 0xFF; }

  // Two's complement signed int16 → Uint8 pair [hi, lo]
  function int16Bytes(v) {
    const u = ((Math.round(v) & 0xFFFF) >>> 0);
    return [msb8(u), lsb8(u)];
  }

  // Build and send a command: TX packet = [payload_len+1, 0x80, cmd_hi, cmd_lo, ...data]
  async function sendCommand(device, cmdId, data = new Uint8Array(0)) {
    if (sendReportId === null) {
      throw new Error(
        `Qudelix: "${device.productName}" has no vendor HID interface — ` +
        `please disconnect and reconnect selecting the PEQ control interface (not the audio interface).`
      );
    }
    const cmdPayload = new Uint8Array(2 + data.length);
    cmdPayload[0] = msb8(cmdId);
    cmdPayload[1] = lsb8(cmdId);
    cmdPayload.set(data, 2);

    const packet = new Uint8Array(sendReportSize);
    packet[0] = cmdPayload.length + 1;  // +1 for the 0x80 flag byte
    packet[1] = 0x80;
    packet.set(cmdPayload, 2);

    console.log(`Qudelix TX 0x${cmdId.toString(16).padStart(4,'0')}:`,
      [...cmdPayload].map(b => b.toString(16).padStart(2,'0')).join(' '));

    await device.sendReport(sendReportId, packet);
    await waitMs(15);
  }

  // sendEqParam: legacy per-band parameter command
  // payload = [group, ch_mask, band_index, value_hi, value_lo]
  async function sendEqParam(device, cmdId, bandIndex, scaledValue) {
    const [hi, lo] = int16Bytes(scaledValue);
    await sendCommand(device, cmdId, new Uint8Array([GROUP_USR, CH_MASK_BOTH, bandIndex, hi, lo]));
  }

  // send_8: legacy single-byte parameter command
  // payload = [group, value]
  async function send8(device, cmdId, value) {
    await sendCommand(device, cmdId, new Uint8Array([GROUP_USR, value]));
  }

  // Map our public filter type → Qudelix app enum
  function toQudelixFilter(type) {
    switch (type) {
      case 'PK':  return FILTER.Peak;
      case 'LSQ': return FILTER.LS;
      case 'HSQ': return FILTER.HS;
      case 'LPF': return FILTER.LPF;
      case 'HPF': return FILTER.HPF;
      default:    return FILTER.Peak;
    }
  }

  // Map Qudelix app filter enum → our public type
  function fromQudelixFilter(v) {
    switch (v) {
      case FILTER.Peak:   return 'PK';
      case FILTER.LS:     return 'LSQ';
      case FILTER.HS:     return 'HSQ';
      case FILTER.LPF:    return 'LPF';
      case FILTER.HPF:    return 'HPF';
      default:            return 'PK';
    }
  }

  function waitMs(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Bitstream decoder ─────────────────────────────────────────────────────
  // Qudelix preset data is a packed bitstream, LSB-first within each byte.

  // Extract numBits from buffer starting at bitOffset (LSB-first within each byte)
  function readBits(buffer, bitOffset, numBits) {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      if ((buffer[(bitOffset + i) >> 3] >> ((bitOffset + i) & 7)) & 1)
        value |= (1 << i);
    }
    return value;
  }

  function signExtend16(v) { return (v << 16) >> 16; }
  function signExtend10(v) { return (v << 22) >> 22; }  // d10ToInt16 from Qudelix source

  // Parse the 88-byte V3 user-EQ preset buffer (Qudelix 5K headphone EQ).
  //
  // Layout (from Qudelix q5K-chrome-plugin.js fromArray_v3, nCh=1, nBand=10):
  //   [1]   preset type           (ignore)
  //   [14]  impedance             (ignore)
  //   [11]  sensitivity           (ignore)
  //   [6]   crossfeed             (ignore)
  //   [16]  preGain ch0 (int16, ÷ GAIN_SCALE dB)
  //   [16]  preGain ch1           (ignore)
  //   [16×2×10]  freq[ch0..1][band0..9]  (uint16, raw Hz)
  //   [32×10]    per band:
  //     [4]   filter type (Qudelix _y enum)
  //     [10]  gain (signed d10, ÷ GAIN_SCALE dB)
  //     [14]  Q   (unsigned, ÷ Q_SCALE)
  //     [4]   reserved
  function parseUserEqPreset(buffer) {
    let off = 0;
    const r = (n) => { const v = readBits(buffer, off, n); off += n; return v; };

    r(1); r(14); r(11); r(6);           // header fields (ignore)

    const preGain0 = signExtend16(r(16));
    r(16);                               // ch1 pre-gain (ignore — same EQ on both ears)

    // Frequencies: 2 channels × 10 bands
    const freqs = Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => r(16)));

    // Filter params: only 1 channel stored (nCh=1 for user EQ)
    const DEFAULT_FREQ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const filters = [];
    for (let b = 0; b < 10; b++) {
      const typeRaw = r(4);
      const gainRaw = r(10);
      const qRaw    = r(14);
      r(4);  // reserved
      const freq = freqs[0][b] > 0 ? freqs[0][b] : DEFAULT_FREQ[b];
      const q    = qRaw > 0 ? qRaw / Q_SCALE : 1.0;
      filters.push({
        type:     fromQudelixFilter(typeRaw),
        freq,
        gain:     signExtend10(gainRaw) / GAIN_SCALE,
        q:        Math.max(0.1, Math.round(q * 100) / 100),
        disabled: typeRaw === FILTER.Bypass
      });
    }

    return { filters, globalGain: preGain0 / GAIN_SCALE };
  }

  // Collect segmented RspEqPreset packets and resolve with assembled buffer.
  // Packet data layout (after parseResponse strips [len, cmdHi, cmdLo]):
  //   [0]  EQ group  (0 = user/headphone)
  //   [1]  (totalPkts<<4) | pktIdx  — last packet when pktIdx==totalPkts
  //   [2-3] reserved
  //   [4-5] offset in preset buffer (big-endian uint16)
  //   [6+]  chunk payload
  function waitForPreset(device, timeoutMs = 500) {
    return new Promise((resolve) => {
      const buf = new Uint8Array(128);  // 88 bytes for user EQ, 128 for safety
      let timer;
      const handler = (event) => {
        const raw = new Uint8Array(event.data.buffer);
        const rsp = parseResponse(raw);
        if (!rsp || rsp.cmdId !== CMD.RspEqPreset) return;
        const d = rsp.data;
        if (d.length < 7) return;
        if (d[0] !== GROUP_USR) return;   // only user (headphone) EQ
        const totalPkts = d[1] >> 4;
        const pktIdx    = d[1] & 0x0F;
        const offset    = (d[4] << 8) | d[5];
        const chunk     = d.slice(6);
        if (offset + chunk.length <= buf.length) buf.set(chunk, offset);
        if (pktIdx === totalPkts) {        // last segment received
          device.removeEventListener('inputreport', handler);
          clearTimeout(timer);
          resolve(buf);
        }
      };
      timer = setTimeout(() => {
        device.removeEventListener('inputreport', handler);
        resolve(null);
      }, timeoutMs);
      device.addEventListener('inputreport', handler);
    });
  }

  // ── RX framing ─────────────────────────────────────────────────────────────

  // Parse a raw RX report into { cmdId, data }
  // RX format: [payload_len, cmd_hi, cmd_lo, data...] (reportId already stripped by WebHID)
  function parseResponse(buf) {
    if (buf.length < 3) return null;
    const len   = buf[0];
    const cmdId = (buf[1] << 8) | buf[2];
    const data  = buf.slice(3, len + 1);  // len = 2 (cmd bytes) + data bytes
    return { cmdId, data };
  }

  // Wait for a specific command response, with timeout
  function waitForResponse(device, expectedCmdId, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let timer;
      const handler = (event) => {
        const buf = new Uint8Array(event.data.buffer);
        const rsp = parseResponse(buf);
        if (!rsp) return;
        console.log(`Qudelix RX 0x${rsp.cmdId.toString(16).padStart(4,'0')}:`,
          [...rsp.data].map(b => b.toString(16).padStart(2,'0')).join(' '));
        if (rsp.cmdId === expectedCmdId) {
          clearTimeout(timer);
          device.removeEventListener('inputreport', handler);
          resolve(rsp.data);
        }
      };
      timer = setTimeout(() => {
        device.removeEventListener('inputreport', handler);
        resolve(null);
      }, timeoutMs);
      device.addEventListener('inputreport', handler);
    });
  }

  // --- Public interface ---

  async function getCurrentSlot(deviceDetails) {
    return 0;  // preset index 0 = active working preset on 5K
  }

  async function pullFromDevice(deviceDetails, slot = 0) {
    const device = deviceDetails.rawDevice;

    try {
      initHidReports(device);

      // Set up preset segment collector BEFORE sending any commands so we don't
      // miss a proactive RspEqPreset the device might send on init.
      const presetPromise = waitForPreset(device, 2000);

      // Init handshake — device responds with RspInitData containing version info
      await Promise.race([
        waitForResponse(device, CMD.RspInitData, 3000),
        sendCommand(device, CMD.ReqInitData).then(() => null),
      ]);

      // Exact sequence from Qudelix plugin (Oy.connected):
      //   ReqDevConfig 0x3C = playTime|batt|mic|dac
      //   ReqDevConfig 0xC0 = sys2|eq  ← the eq(0x80) bit is required before RspEqPreset
      //   ReqDevStatus 0x04 = conn
      //   ReqEqPreset  0x03 = usr|spk
      await sendCommand(device, CMD.ReqDevConfig,  new Uint8Array([0x3C]));
      await sendCommand(device, CMD.ReqDevConfig,  new Uint8Array([0xC0]));
      await sendCommand(device, CMD.ReqDevStatus,  new Uint8Array([0x04]));
      await sendCommand(device, CMD.ReqEqPreset,   new Uint8Array([0x03]));

      // Wait for all RspEqPreset segments (or timeout → fall back to defaults).
      // NOTE: The Qudelix 5K's USB HID interface is write-only on macOS via WebHID —
      // the device lists input report IDs in its HID descriptor but never sends them
      // over USB. EQ reads are only possible over BLE (not yet implemented here).
      // The decoder (parseUserEqPreset) is fully implemented and will work if BLE
      // support is added or if a firmware update enables USB input reports.
      const presetBuf = await presetPromise;

      if (presetBuf) {
        const decoded = parseUserEqPreset(presetBuf);
        console.log(`Qudelix: decoded preset — ${decoded.filters.length} bands, globalGain=${decoded.globalGain} dB`);
        return decoded;
      }

      // USB HID input reports not available — return flat defaults so the UI is usable.
      // Push (writing EQ to device) works correctly.
      const filters = Array.from({ length: 10 }, (_, i) => ({
        type: 'PK', freq: [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i],
        q: 1.0, gain: 0, disabled: false
      }));
      return { filters, globalGain: 0 };

    } catch (err) {
      console.error('Qudelix: pullFromDevice error:', err);
      return { filters: [], globalGain: 0 };
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, preamp, filters) {
    const device = deviceDetails.rawDevice;

    try {
      initHidReports(device);

      // Enable EQ and set type to PEQ
      await send8(device, CMD.SetEqEnable, 1);
      await send8(device, CMD.SetEqType, 1);  // 1 = PEQ

      // PreGain: scaled by GAIN_SCALE, sent as sendEqParam (band index ignored)
      const preGainScaled = Math.round(preamp * GAIN_SCALE);
      await sendEqParam(device, CMD.SetEqPreGain, 0, preGainScaled);

      // Set each band using SetEqBandParam (all params in one packet)
      // Legacy payload (10 bytes):
      //   [group, ch_mask, band, filter_app_enum, freq_hi, freq_lo, gain_hi, gain_lo, q_hi, q_lo]
      const maxBands = deviceDetails.modelConfig?.maxFilters || 10;

      for (let i = 0; i < Math.min(filters.length, maxBands); i++) {
        const f       = filters[i];
        const filter  = f.disabled ? FILTER.Bypass : toQudelixFilter(f.type || 'PK');
        const freq    = Math.round(Math.max(20, Math.min(20000, f.freq || 1000)));
        const gain    = Math.round((f.gain || 0) * GAIN_SCALE);
        const q       = Math.round((f.q || 1.0) * Q_SCALE);

        const [fhi, flo] = [msb8(freq), lsb8(freq)];
        const [ghi, glo] = int16Bytes(gain);
        const [qhi, qlo] = int16Bytes(q);

        const payload = new Uint8Array([GROUP_USR, CH_MASK_BOTH, i, filter,
                                        fhi, flo, ghi, glo, qhi, qlo]);
        await sendCommand(device, CMD.SetEqBandParam, payload);
      }

      // Save to preset if a writable slot is specified
      const firstWritable = deviceDetails.modelConfig?.firstWritableEQSlot ?? -1;
      const saveSlot = (slot >= 0 && firstWritable >= 0) ? slot : -1;
      if (saveSlot >= 0) {
        await sendCommand(device, CMD.SaveEqPreset, new Uint8Array([saveSlot]));
      }

      return false;  // no disconnect needed

    } catch (err) {
      console.error('Qudelix: pushToDevice error:', err);
      throw err;
    }
  }

  async function enablePEQ(deviceDetails, enabled, slotId) {
    const device = deviceDetails.rawDevice;
    try {
      initHidReports(device);
      await send8(device, CMD.SetEqEnable, enabled ? 1 : 0);
      if (enabled && slotId >= 0) {
        await sendCommand(device, CMD.LoadEqPreset, new Uint8Array([slotId]));
      }
    } catch (err) {
      console.error('Qudelix: enablePEQ error:', err);
    }
  }

  return { getCurrentSlot, pullFromDevice, pushToDevice, enablePEQ };
})();
