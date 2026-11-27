import { logHidTx, logHidRx } from './deviceDebugLog.js';

export const toppingUsbHidHandler = (function () {
  // ===== Topping DX1 II / E50 II WebHID Protocol =====
  // Reverse-engineered from the official web app source
  // (~/Downloads/topping-home-js/{0cd599ac99fc4c0c,34c6de754947383b}.js)
  // and verified against a real WebHID capture (topping_capture.json).
  //
  // Frame format (16 bytes):
  //   [0-1]   Sync: 0x22 0x33
  //   [2]     Protocol type: readNack=16, readAck=17, writeNack=32, writeAck=33
  //   [3]     totalFrameLen (multiframe messages only, else 0x01)
  //   [4]     curFrame (multiframe messages only, else 0x01)
  //   [5-6]   Command: 16-bit big-endian
  //   [7-10]  Data: 32-bit big-endian (signed where noted)
  //   [11-12] CRC-16/MODBUS, big-endian (hi byte first). TX sends 0x00 0x00;
  //           device echoes the frame back with the real CRC filled in.
  //   [13-14] Footer: 0x66 0x77
  //   [15]    Padding: 0x00
  //
  // NOTE: an earlier version of this handler assumed a 5-byte data field and
  // treated protocolType/frame-index bytes as fixed 0x01 0x01, which shifted
  // the CRC/footer by one byte and produced frames the device silently
  // ignored (no inputreport ever fired). CRC-16/MODBUS (poly 0xA001,
  // init 0xFFFF) computed over bytes[2..10] matches the device's echoed CRC
  // on every observed frame in the capture.

  const REPORT_ID = 0x00;

  const ProtocolType = {
    readNack: 16,
    readAck: 17,
    writeNack: 32,
    writeAck: 33
  };

  // 16-bit command IDs (from HidUserCommand map in official source)
  const Commands = {
    // System / lifecycle
    connectState: 0x1101,
    upload: 0x1106,
    sampling: 0x1107,
    dataMute: 0x1109,
    heartbeat: 0x111a,          // the DX1 II's; the E50 II's is 0x7136 (the table's heartbeatCommand)
    eqPreview: 0x111b,      // Save/apply EQ
    eqPreviewState: 0x111c,
    agreementConfig: 0x1120,
    hardwareVersion: 0x1201,
    softwareVersion: 0x1202,
    deviceId: 0x1203,
    mcuEqEnableState: 0x1204,
    mcuEqCurrentConfig: 0x1206, // which stored profile is live (0-2)
    switchMcuConfig: 0x110e,    // make a stored profile (0-2) the live one
    usbSerial: 0x1207,
    configSwitch: 0x9e01,       // apply/recompute live EQ DSP after writes - DOES echo an ack

    // Per-profile global EQ (verified on a DX1 II): preamp raw = round(2^25 * 10^(dB/20)), and a global on/off, per channel
    preampL: 0x9c01,
    enableL: 0x9c02,
    preampR: 0x9c03,
    enableR: 0x9c04,

    // DX1 II device controls (0x7100-0x8300 range)
    dx1Standby: 0x7100,
    dx1Mute: 0x7200,
    dx1Filter: 0x7300,          // DAC filter mode, 0-7
    dx1OutputRoute: 0x7400,     // 0=HP, 1=Line, 2=Balanced
    dx1HighGain: 0x7500,
    dx1Volume: 0x7600,          // OR with (target+1): 1=HP,2=Line,3=Balanced
    dx1CPresetSave: 0x7700,     // slot 0-2
    dx1CPresetCall: 0x7800,     // slot 0-2
    dx1AutoStandby: 0x7900,     // sent inverted (+!enabled)
    dx1Brightness: 0x7a00,      // 0-3
    dx1InputSwitch: 0x7b00,     // 0-1
    dx1OptMode: 0x7c00,         // 0-1
    dx1EqFollow: 0x7d00,
    dx1VolumeFollow: 0x7e00,
    dx1FactoryReset: 0x7f00,
    dx1LineoutMode: 0x8101,     // 0-1
    dx1RemoteDisable: 0x8102,
    dx1OptActive: 0x8103,       // read-only
    dx1UsbActive: 0x8104,       // read-only
    dx1UacVersions: 0x8105,     // read-only
    dx1PeqFactoryReset: 0x8106,
    dx1WebFeatureFlag: 0x8107,  // read-only
    dx1ChannelBalance: 0x8108,
    dx1DisplayMode: 0x8109,
    dx1KnobClick: 0x8200,
    dx1KnobDoubleClick: 0x8300
  };

  // Per-band subcommand offsets (OR'd onto the band's base command).
  // Base = 0x9000 | ((bandIndex + 1) << 8), bandIndex 0-10 for the 11 bands.
  const BandSub = {
    typeL: 1,
    freqL: 2,
    gainL: 3,
    qL: 4,
    enabledL: 5,
    typeR: 6,
    freqR: 7,
    gainR: 8,
    qR: 9,
    enabledR: 10
  };

  function bandBaseCmd(bandIndex) {
    return (0x9000 | ((bandIndex + 1) << 8)) >>> 0;
  }

  // Filter type codes, from the official page's own mapping (1 PK, 2 LP, 3 HP, 4 LSC, 5 HSC) and confirmed on a DX1 II: a band the page
  // shows as "High Shelf" reads back as 5. (An earlier version had 2/3 as the shelves and 4/5 as low/high pass, taken from the order of
  // the page's menu, which is not the order of the codes: shelves were written to the device as pass filters.)
  const FilterType = {
    1: 'PK',
    2: 'LPF',
    3: 'HPF',
    4: 'LSQ',
    5: 'HSQ'
  };
  const FilterTypeCode = { PK: 1, LPF: 2, LP: 2, LPQ: 2, HPF: 3, HP: 3, HPQ: 3, LSQ: 4, HSQ: 5 };

  // ── CRC16 Calculation ──────────────────────────────────────────────────
  // CRC-16/MODBUS: poly 0xA001 (reflected form of 0x8005), init 0xFFFF
  // Covers bytes 2-10 of the frame (protocolType/frameLen/frameIdx/cmd/data)

  function calculateCrc16(frame) {
    let crc = 0xffff;

    for (let i = 2; i <= 10; i++) {
      crc ^= frame[i];
      for (let bit = 0; bit < 8; bit++) {
        if (crc & 1) {
          crc = (crc >> 1) ^ 0xa001;
        } else {
          crc >>= 1;
        }
      }
    }

    return crc & 0xffff;
  }

  // ── Frame Building ────────────────────────────────────────────────────
  // Builds a 16-byte HID frame for transmission.
  // `cmd` is a 16-bit command id. `data` is a signed 32-bit integer.

  function buildHidFrame(options) {
    const {
      cmd,
      data = 0,
      protocolType = ProtocolType.writeNack,
      totalFrameLen = 1,
      curFrame = 1
    } = options;

    const frame = new Uint8Array(16);

    frame[0] = 0x22;
    frame[1] = 0x33;
    frame[2] = protocolType & 0xff;
    frame[3] = totalFrameLen & 0xff;
    frame[4] = curFrame & 0xff;

    // Command (5-6), 16-bit big-endian
    frame[5] = (cmd >> 8) & 0xff;
    frame[6] = cmd & 0xff;

    // Data (7-10), 32-bit big-endian
    const dataInt = data | 0; // coerce to int32
    frame[7] = (dataInt >>> 24) & 0xff;
    frame[8] = (dataInt >>> 16) & 0xff;
    frame[9] = (dataInt >>> 8) & 0xff;
    frame[10] = dataInt & 0xff;

    // CRC (11-12) - TX sends 0x00 0x00, device echoes with actual CRC
    frame[11] = 0x00;
    frame[12] = 0x00;

    // Frame footer (13-14) and padding (15)
    frame[13] = 0x66;
    frame[14] = 0x77;
    frame[15] = 0x00;

    return frame;
  }

  // ── Frame Parsing ────────────────────────────────────────────────────

  function parseHidFrame(buffer) {
    const view = new Uint8Array(buffer);

    if (view.byteLength < 15) {
      throw new Error(`Invalid frame length: ${view.byteLength}`);
    }

    if (view[0] !== 0x22 || view[1] !== 0x33) {
      throw new Error(`Invalid frame header: ${view[0].toString(16)} ${view[1].toString(16)}`);
    }

    if (view[13] !== 0x66 || view[14] !== 0x77) {
      throw new Error(`Invalid frame footer: ${view[13].toString(16)} ${view[14].toString(16)}`);
    }

    const dataInt = (view[7] << 24) | (view[8] << 16) | (view[9] << 8) | view[10];

    return {
      protocolType: view[2],
      totalFrameLen: view[3],
      curFrame: view[4],
      cmd: (view[5] << 8) | view[6],
      data: dataInt,
      dataUnsigned: dataInt >>> 0,
      crc: (view[11] << 8) | view[12],
      rawBuffer: view
    };
  }

  // ── Low-level Send/Receive ────────────────────────────────────────────

  async function sendReport(device, frame) {
    logHidTx('Topping', REPORT_ID, frame);
    try {
      await device.sendReport(REPORT_ID, frame);
    } catch (err) {
      console.error('USB Device PEQ: Topping sendReport error:', err.message);
      throw err;
    }
  }

  // Read response from device (echo-ACK pattern). Matches on the full 16-bit
  // command, since a lot of unrelated device telemetry streams in constantly
  // sharing the same low-level protocolType.
  async function readResponse(device, expectedCmd, timeoutMs = 1000) {
    let eventCount = 0;
    return new Promise((resolve, reject) => {
      const handler = (event) => {
        eventCount++;
        try {
          const view = new Uint8Array(event.data.buffer);

          // Skip all-zero frames (device noise)
          if (view.every(byte => byte === 0)) {
            return;
          }

          logHidRx('Topping', view);

          const frame = parseHidFrame(view);

          if (frame.cmd === expectedCmd) {
            device.removeEventListener('inputreport', handler);
            clearTimeout(timeoutId);
            resolve(frame);
          }
        } catch (err) {
          const hexBytes = Array.from(new Uint8Array(event.data.buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          console.warn(`Frame parse error (event #${eventCount}): ${err.message} | bytes: ${hexBytes}`);
        }
      };

      const timeoutId = setTimeout(() => {
        device.removeEventListener('inputreport', handler);
        const cmdHex = `0x${expectedCmd.toString(16).padStart(4, '0')}`;
        console.error(`Read timeout for command ${cmdHex} after ${timeoutMs}ms (${eventCount} events received)`);
        reject(new Error(`Read timeout for command ${cmdHex} after ${timeoutMs}ms`));
      }, timeoutMs);

      device.addEventListener('inputreport', handler);
    });
  }

  // ── Device Communication ──────────────────────────────────────────────

  async function sendCommand(device, cmd, data = 0, options = {}) {
    const { waitForResponse = true, protocolType = ProtocolType.writeNack, timeoutMs = 1500 } = options;

    const frame = buildHidFrame({ cmd, data, protocolType });

    // Set up listener BEFORE sending (avoids missing a fast echo)
    let responsePromise = null;
    if (waitForResponse) {
      responsePromise = readResponse(device, cmd, timeoutMs);
    }

    await sendReport(device, frame);

    if (waitForResponse) {
      return await responsePromise;
    }
  }

  // The device continuously streams a large multiframe "upload"/config
  // broadcast (cmd 0x1106) in the background, unrelated to any command we
  // send. Under a burst of that traffic a single echo can occasionally miss
  // its 1.5s window - retry once before giving up.
  async function sendCommandWithRetry(device, cmd, data = 0, options = {}) {
    try {
      return await sendCommand(device, cmd, data, options);
    } catch (err) {
      console.warn(`USB Device PEQ: Topping - retrying command 0x${cmd.toString(16)} after timeout`);
      return await sendCommand(device, cmd, data, options);
    }
  }

  async function initializeDevice(device) {
    console.log('USB Device PEQ: Topping - initializing device...');
    try {
      await sendCommand(device, Commands.connectState, 1, { waitForResponse: false });
      await new Promise(r => setTimeout(r, 100));

      await sendCommand(device, Commands.agreementConfig, 1, { waitForResponse: false });
      await new Promise(r => setTimeout(r, 100));

      try {
        await sendCommand(device, Commands.mcuEqEnableState, 0, {
          protocolType: ProtocolType.readNack,
          timeoutMs: 300
        });
      } catch (err) {
        // Non-fatal: device doesn't reliably ack this during init, and
        // band reads/writes work fine regardless.
      }

      // Let any in-flight background telemetry settle before hammering
      // the device with band commands.
      await new Promise(r => setTimeout(r, 100));

      console.log('USB Device PEQ: Topping - initialization complete');
    } catch (err) {
      console.error('USB Device PEQ: Topping - initialization failed:', err.message);
      throw err;
    }
  }

  // Start heartbeat to keep device alive (required - device drops connection
  // after ~5s without it)
  function startHeartbeat(device, cmd = Commands.heartbeat) {
    return setInterval(async () => {
      try {
        await sendCommand(device, cmd, 1, { waitForResponse: false });
      } catch (err) {
        console.warn('USB Device PEQ: Topping - heartbeat error:', err.message);
      }
    }, 1000);
  }

  // ── EQ Band Encoding/Decoding ──────────────────────────────────────────
  // gain: raw signed byte, dB * 10 (range -120..120 for +/-12dB)
  // freq: raw Hz, direct 32-bit value (range 20-20000)
  // Q: raw *10000 (range 0.1-20, default 0.707)
  // type: 1=Peak(PK), 2=LowPass, 3=HighPass, 4=LowShelf(LSQ), 5=HighShelf(HSQ)

  function encodeGainByte(gainDb) {
    let g = Number.isFinite(gainDb) ? gainDb : 0;
    g = Math.max(-12, Math.min(12, g));
    let raw = Math.round(g * 10);
    raw = Math.max(-128, Math.min(127, raw));
    return raw;
  }

  function decodeGainByte(raw) {
    const signed = raw > 127 ? raw - 256 : raw;
    return signed / 10;
  }

  function writeBandParam(device, bandIndex, subcmd, value) {
    const cmd = (bandBaseCmd(bandIndex) | subcmd) >>> 0;
    return sendCommandWithRetry(device, cmd, value);
  }

  // ── Full-config Read via the "upload" Multiframe Broadcast ─────────────
  //
  // IMPORTANT: the per-band 0x9XYY commands (BandSub.*) are NOT a read/write
  // pair. There is no passive "give me the current value" query - every
  // send to a 0x9XYY command SETS that parameter and the device echoes back
  // confirmation of what it was just set to. Sending 0 as a "read" probe
  // (as an earlier version of this handler did) actually WRITES ZERO to
  // that parameter - it looks like a successful read (valid echo, right
  // cmd) but silently erases the real EQ setting.
  //
  // The device keeps THREE stored profiles (a DX1 II; the page limits it to 3), each with a name, and streams all of them as a
  // repeating multiframe broadcast on cmd 0x1106 ("upload"): a 2-frame header (frame 0 = how many profiles follow, frame 1 =
  // metadata), then each profile as `totalFrameLen` (78) frames, one after the other, about 1.25 s apiece. Verified on a real
  // device. Each profile's 78 words:
  //   [0-3]   name: 4 words, 4 chars each, first char in the least significant byte
  //   [4]     enabledL (global EQ on/off, left)
  //   [5]     preampGainL: raw = round(2^25 * 10^(dB/20))
  //   [6]     enabledR
  //   [7]     preampGainR
  //   [8..40] 11 left bands x 3 words (packed, freq, Q)
  //   [41..73] 11 RIGHT bands x 3 words: a separate set, NOT a mirror (writing one channel leaves the other alone)
  //   [74..77] trailing words
  // packed = enabled(bits0-7==1) | type(bits8-15) | gain(bits16-23, signed, /10)
  //
  // The stream starts the moment the device receives connectState (re-sending it restarts the pass, header first, 0.17 s later; an
  // upload request alone waits for the next pass, up to 4.5 s). So listen BEFORE initialising: joining mid-pass misses the header and
  // the frames of two profiles get mixed. The per-band commands write the profile that is LIVE (0x1206 says which; 0x110E switches).

  const UPLOAD_BAND_L_OFFSET = 8;
  const UPLOAD_BAND_R_OFFSET = 41;
  const UPLOAD_BAND_STRIDE = 3;
  const UPLOAD_MIN_FRAME_LEN = 70;

  function decodePackedBand(packed, freq, qRaw) {
    const enabled = (packed & 0xff) === 1;
    const typeRaw = (packed >> 8) & 0xff;
    const gainRaw = (packed >> 16) & 0xff;
    return {
      type: FilterType[typeRaw] || 'PK',
      freq: freq >>> 0,
      gain: decodeGainByte(gainRaw),
      q: (qRaw >>> 0) / 10000,
      disabled: !enabled
    };
  }

  // The 11 bands of one channel of one profile's words (a Map or array of index -> word).
  function decodeChannel(words, right = false, count = 11) {
    const get = (i) => (words instanceof Map ? words.get(i) : words[i]) || 0;
    const offset = right ? UPLOAD_BAND_R_OFFSET : UPLOAD_BAND_L_OFFSET;
    const bands = [];
    for (let i = 0; i < count; i++) {
      const base = offset + i * UPLOAD_BAND_STRIDE;
      bands.push(decodePackedBand(get(base), get(base + 1), get(base + 2)));
    }
    return bands;
  }

  // The profile's name: words 0-3, up to the first zero byte.
  function decodeConfigName(words) {
    const get = (i) => (words instanceof Map ? words.get(i) : words[i]) || 0;
    const chars = [];
    for (let w = 0; w < 4; w++) {
      const v = get(w) >>> 0;
      for (let k = 0; k < 4; k++) {
        const c = (v >>> (8 * k)) & 0xff;
        if (c === 0) return chars.join('').trim();
        if (c >= 0x20 && c < 0x7f) chars.push(String.fromCharCode(c));
      }
    }
    return chars.join('').trim();
  }

  // The raw preamp word (2^25 is 0 dB) as dB, to 0.1 dB; 0 for an unset word.
  function decodePreamp(raw) {
    const r = raw >>> 0;
    if (r <= 0) return 0;
    const db = 20 * Math.log10(r / 33554432);
    return Math.max(-12, Math.min(12, Math.round(db * 10) / 10));
  }

  function encodePreamp(gainDb) {
    const g = Math.max(-12, Math.min(12, Number.isFinite(gainDb) ? gainDb : 0));
    return Math.round(33554432 * Math.pow(10, g / 20));
  }

  // Collects the stored profiles from the 0x1106 broadcast, each as a Map of frame index -> word. Does not send anything itself.
  // Falls back to the first full cycle as ONE profile when no header is seen (older firmware); with some profiles complete when the
  // time runs out, those are returned; with none it rejects.
  function readConfigsViaUploadStream(device, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      let headerSeen = false;
      let expected = null;
      const configs = [];
      let current = new Map();
      const buffer = new Map();
      let frameLen = null;

      const finish = () => {
        device.removeEventListener('inputreport', handler);
        clearTimeout(timeoutId);
        if (configs.length === 0) {
          reject(new Error(`Timed out waiting for the upload config after ${timeoutMs}ms`));
        } else {
          resolve(configs);
        }
      };

      const handler = (event) => {
        try {
          const view = new Uint8Array(event.data.buffer);
          if (view.every(byte => byte === 0)) return;

          const frame = parseHidFrame(view);
          if (frame.cmd !== Commands.upload) return;

          if (frame.totalFrameLen === 2) {
            if (frame.curFrame === 0) {
              headerSeen = true;
              expected = frame.dataUnsigned;
              configs.length = 0;
              current = new Map();
              buffer.clear();
            }
            return;
          }
          if (frame.totalFrameLen < UPLOAD_MIN_FRAME_LEN) return;

          if (headerSeen) {
            const len = frame.totalFrameLen;
            if (frame.curFrame === 0) current = new Map();
            current.set(frame.curFrame, frame.dataUnsigned);
            if (frame.curFrame === len - 1 && current.size >= len) {
              configs.push(current);
              current = new Map();
              if (expected > 0 && configs.length >= expected) finish();
            }
            return;
          }

          if (frameLen === null) frameLen = frame.totalFrameLen;
          buffer.set(frame.curFrame, frame.dataUnsigned);
          if (buffer.size >= frameLen) {
            for (let i = 0; i < frameLen; i++) {
              if (!buffer.has(i)) return;
            }
            configs.push(new Map(buffer));
            finish();
          }
        } catch (err) {
          // ignore parse errors from unrelated traffic
        }
      };

      const timeoutId = setTimeout(finish, timeoutMs);
      device.addEventListener('inputreport', handler);
    });
  }

  // Which stored profile is live (0-2), or null when the device does not say.
  async function readLiveIndex(device) {
    try {
      const frame = await sendCommand(device, Commands.mcuEqCurrentConfig, 0, {
        protocolType: ProtocolType.readNack,
        timeoutMs: 300
      });
      if (frame && frame.data >= 0 && frame.data <= 2) return frame.data;
    } catch (err) {
      // not fatal
    }
    return null;
  }

  // The stored profiles as last read, kept for a few seconds so that asking for the live slot, the slot list and one profile (which
  // the UI does in a row) cost one trip through the stream, not three. A push clears it.
  const STORE_MAX_AGE_MS = 6000;
  let storeCache = null;

  async function readStore(device) {
    if (storeCache && storeCache.device === device && Date.now() - storeCache.at < STORE_MAX_AGE_MS) {
      return storeCache;
    }
    const configsPromise = readConfigsViaUploadStream(device);
    configsPromise.catch(() => {}); // it may fail while the init is still waiting; awaiting it later still rejects
    try {
      await initializeDevice(device);
    } catch (err) {
      console.warn('USB Device PEQ: Topping - initialization warning:', err.message);
    }
    // As the page's connect sequence ends (the stream is already running from connectState).
    try {
      await sendCommand(device, Commands.upload, 0, { protocolType: ProtocolType.readNack, waitForResponse: false });
    } catch (err) {
      // not fatal
    }
    const live = await readLiveIndex(device);
    const configs = await configsPromise;
    storeCache = { device, configs, live, at: Date.now() };
    return storeCache;
  }

  // Writes one band: `left` to the left channel and `right` to the right (either may be null: that channel is left alone).
  async function writeBand(device, bandIndex, left, right = left) {
    for (const [offset, filter] of [[0, left], [5, right]]) {
      if (!filter) continue;
      const typeCode = FilterTypeCode[filter.type] || FilterTypeCode.PK;
      const freq = Math.max(20, Math.min(20000, Math.round(filter.freq || 1000)));
      const gainByte = encodeGainByte(filter.gain);
      const qRaw = Math.round((filter.q || 0.707) * 10000);
      const enabled = filter.disabled ? 0 : 1;

      await writeBandParam(device, bandIndex, BandSub.typeL + offset, typeCode);
      await writeBandParam(device, bandIndex, BandSub.freqL + offset, freq);
      await writeBandParam(device, bandIndex, BandSub.gainL + offset, gainByte);
      await writeBandParam(device, bandIndex, BandSub.qL + offset, qRaw);
      await writeBandParam(device, bandIndex, BandSub.enabledL + offset, enabled);
    }

    // Tell the device to recompute/apply the live EQ DSP. The official app
    // sends this after essentially every parameter change (confirmed via
    // capture - it echoes an ack, unlike eqPreview which never does).
    // Without this, band writes land in device memory (readback confirms
    // the values) but may not actually be applied to the live audio path.
    await sendCommandWithRetry(device, Commands.configSwitch, 0);
  }

  // ── Public API ────────────────────────────────────────────────────────

  // Guards against overlapping pull/push calls on the same device (the UI
  // layer has been observed to trigger a pull from two code paths around
  // connect time). Concurrent calls would each register their own
  // 'inputreport' listener, causing every real event to be logged and
  // processed twice.
  let ioInFlight = Promise.resolve();

  async function withIoLock(fn) {
    const previous = ioInFlight;
    let release;
    ioInFlight = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      return await fn();
    } finally {
      release();
    }
  }

  // Per-model settings from the device table: the heartbeat command (E50 II: 0x7136), how many bands (DX1 II 11, E50 II 10; the stream
  // carries 11 of each) and whether 0x110E changes the live profile (a DX1 II does; an E50 II echoes it but nothing changes, so only
  // its live profile can be written).
  const heartbeatCmd = (d) => d?.modelConfig?.heartbeatCommand ?? Commands.heartbeat;
  const bandCount = (d) => Math.max(1, Math.min(11, d?.modelConfig?.bandCount ?? 11));
  const canSwitchProfile = (d) => d?.modelConfig?.profileSwitch !== false;

  function slotIndex(slot) {
    const n = typeof slot === 'string' ? parseInt(slot, 10) : slot;
    return Number.isInteger(n) ? n : -1;
  }

  // The slot (stored profile) that is live now.
  async function getCurrentSlot(deviceDetails) {
    return withIoLock(async () => {
      const device = deviceDetails.rawDevice;
      try {
        await initializeDevice(device);
      } catch (err) {
        console.warn('USB Device PEQ: Topping - initialization warning:', err.message);
      }
      const live = await readLiveIndex(device);
      console.log(`USB Device PEQ: Topping - getCurrentSlot (${live ?? 0})`);
      return live ?? 0;
    });
  }

  // The stored profiles, named as the device names them ("Bass 1"), read from the device the way the official page does. Any of them
  // can be read, and written (a profile that is not live is switched to first). Falls back to the config's list when it cannot read.
  async function getAvailableSlots(deviceDetails) {
    return withIoLock(async () => {
      try {
        const store = await readStore(deviceDetails.rawDevice);
        const names = store.configs.map(decodeConfigName);
        // Profiles that would look alike are numbered; an unnamed one is "Profile N".
        return store.configs.map((words, i) => ({
          id: i,
          name: !names[i] ? `Profile ${i + 1}` : (names.filter(n => n === names[i]).length > 1 ? `${names[i]} ${i + 1}` : names[i]),
          // A device that cannot switch profile can only write the live one
          writable: canSwitchProfile(deviceDetails) || i === (store.live ?? 0)
        }));
      } catch (err) {
        console.warn('USB Device PEQ: Topping - could not read the profile list:', err.message);
        return deviceDetails.modelConfig?.availableSlots || [];
      }
    });
  }

  async function pullFromDevice(deviceDetails, slot) {
    return withIoLock(() => pullFromDeviceInternal(deviceDetails, slot));
  }

  async function pullFromDeviceInternal(deviceDetails, slot) {
    console.log('USB Device PEQ: Topping - reading EQ state...');
    const device = deviceDetails.rawDevice;
    const maxFilters = 11; // Topping DX1 II has 11 bands

    // The official page runs the heartbeat from connect; without it the device drops the link after a few seconds
    const heartbeat = startHeartbeat(device, heartbeatCmd(deviceDetails));
    try {
      const store = await readStore(device);
      const wanted = slotIndex(slot);
      const index = wanted >= 0 && wanted < store.configs.length
        ? wanted
        : (store.live !== null && store.live < store.configs.length ? store.live : 0);
      const words = store.configs[index];
      const count = bandCount(deviceDetails);
      const filters = decodeChannel(words, false, count);
      const right = decodeChannel(words, true, count);
      filters.forEach((band, i) => {
        console.log(`  Band ${i + 1}: freq=${band.freq}, gain=${band.gain}, q=${band.q}, type=${band.type}, enabled=${!band.disabled}`);
      });

      console.log(`USB Device PEQ: Topping - read profile ${index} ("${decodeConfigName(words)}") successfully`);
      const same = filters.every((b, i) => {
        const r = right[i];
        return b.type === r.type && b.freq === r.freq && b.gain === r.gain && b.q === r.q && b.disabled === r.disabled;
      });
      return {
        filters,
        // Only when the right channel really differs: otherwise one set serves both.
        rightFilters: same ? undefined : right,
        globalGain: decodePreamp(words.get ? words.get(5) : words[5]),
        currentSlot: index
      };
    } catch (err) {
      console.error('USB Device PEQ: Topping - pullFromDevice failed:', err.message);
      const filters = Array(maxFilters).fill(null).map(() => ({
        type: 'PK',
        freq: 1000,
        q: 0.707,
        gain: 0,
        disabled: true
      }));
      return { filters, globalGain: 0 };
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function pushToDevice(deviceDetails, _phoneObj, slot, globalGain, filters, rightFilters) {
    return withIoLock(() => pushToDeviceInternal(deviceDetails, slot, globalGain, filters, rightFilters));
  }

  async function pushToDeviceInternal(deviceDetails, slot, globalGain, filters, rightFilters) {
    console.log('USB Device PEQ: Topping - writing EQ configuration...');
    const device = deviceDetails.rawDevice;

    try {
      await initializeDevice(device);
      const heartbeat = startHeartbeat(device, heartbeatCmd(deviceDetails));
      storeCache = null;

      try {
        // The per-band commands always write the profile that is live, so another profile is made live first (verified on a DX1 II:
        // with profile 0 live, a band write changed profile 0 only). The device is left on the profile just written.
        const target = slotIndex(slot);
        if (target >= 0 && target <= 2) {
          const live = await readLiveIndex(device);
          if (live !== null && live !== target) {
            if (!canSwitchProfile(deviceDetails)) {
              throw new Error('This device can only write the profile it is using; choose that one.');
            }
            await sendCommandWithRetry(device, Commands.switchMcuConfig, target);
            await new Promise(r => setTimeout(r, 400));
          }
        }

        const right = rightFilters || filters;
        const count = Math.min(bandCount(deviceDetails), Math.max(filters.length, right.length));
        for (let bandIndex = 0; bandIndex < count; bandIndex++) {
          const left = filters[bandIndex] || null;
          const r = right[bandIndex] || null;
          try {
            await writeBand(device, bandIndex, left, r);
            const f = left || r;
            console.log(`  Band ${bandIndex + 1}: freq=${f.freq}, gain=${f.gain}, q=${f.q}, type=${f.type}`);
          } catch (err) {
            console.warn(`  Band ${bandIndex + 1} write failed:`, err.message);
          }

          await new Promise(r2 => setTimeout(r2, 30));
        }

        // The profile's preamp, per channel, and its global on/off (the page sends the pair together).
        const raw = encodePreamp(globalGain);
        for (const [cmd, value] of [
          [Commands.preampL, raw], [Commands.enableL, 1],
          [Commands.preampR, raw], [Commands.enableR, 1]
        ]) {
          try {
            await sendCommandWithRetry(device, cmd, value);
          } catch (err) {
            console.warn(`  Preamp command 0x${cmd.toString(16)} failed:`, err.message);
          }
        }

        // Final apply, in case the last per-band configSwitch didn't fully
        // settle. eqPreview itself never echoes an ack in any observed
        // capture (including live editing in the official app), so it's
        // sent fire-and-forget rather than waiting on a response that will
        // never arrive.
        console.log('  Applying EQ configuration...');
        await sendCommandWithRetry(device, Commands.configSwitch, 0);
        await sendCommand(device, Commands.eqPreview, 1, { waitForResponse: false });
        // Give the device a moment to actually apply before we return.
        await new Promise(r => setTimeout(r, 100));
      } finally {
        clearInterval(heartbeat);
      }

      console.log('USB Device PEQ: Topping - EQ write complete');
      return true;
    } catch (err) {
      console.error('USB Device PEQ: Topping - pushToDevice failed:', err.message);
      throw err;
    }
  }

  // The page's reading of 0x1204: bit 1 when bit 2 is set, else bit 0 (an E50 II says 0xC1 for on, 0xC0 for off).
  function decodeEnabled(raw) {
    return (raw & 4) !== 0 ? (raw & 2) !== 0 : (raw & 1) !== 0;
  }

  // The EQ selector, as the official page does it: 0x110E with -1 is "no EQ", and with a profile number selects that profile (verified on
  // an E50 II: 0xC0 when off, 0xC1 when on again; on a DX1 II the live profile follows). A model that cannot change its live profile
  // (the E50 II) is simply switched on, its one live profile. (An earlier version ignored `enabled` and always wrote 0x1204 = 1.)
  async function enablePEQ(deviceDetails, enabled = true, slot = 0) {
    console.log(`USB Device PEQ: Topping - ${enabled === false ? 'switching the EQ off' : 'enabling PEQ'}`);
    const device = deviceDetails.rawDevice ? deviceDetails.rawDevice : deviceDetails;
    try {
      const wanted = slotIndex(slot);
      const profile = deviceDetails.rawDevice && !canSwitchProfile(deviceDetails) ? 0 : Math.max(0, Math.min(2, wanted));
      storeCache = null;
      // The device reports the new on/off state a moment after the command (0x1204, volunteered); wait for it so a read right after
      // sees the change.
      const reported = readResponse(device, Commands.mcuEqEnableState, 1500).catch(() => null);
      await sendCommand(device, Commands.switchMcuConfig, enabled === false ? -1 : profile);
      await reported;
    } catch (err) {
      console.warn('USB Device PEQ: Topping - enablePEQ failed:', err.message);
    }
  }

  // ── Extra Capabilities (devicePEQ/deviceExtras.js integration) ─────────
  // Only wired up for capability keys that actually exist in deviceExtras.js
  // (micGain, denoise, dacFilter, dacBalance, dacWorkMode, gainMode,
  // battery, eqEnabled, outputGain) - that set is fixed/closed, so DX1 II
  // features with no matching key (standby, mute, presets, brightness,
  // input source, opt mode, eq/volume follow, lineout mode, channel
  // balance, factory reset) are not exposed here. `deviceDetails` may be
  // either the raw HID device or an object with a `.rawDevice` property.

  function resolveDevice(deviceDetails) {
    return deviceDetails && deviceDetails.rawDevice ? deviceDetails.rawDevice : deviceDetails;
  }

  // dacFilter -> DAC PCM filter mode, 0-7 (device-defined filter curves,
  // see peqConstraintsConfig.json for the labeled options list)
  async function setDacFilter(deviceDetails, filterIndex) {
    const device = resolveDevice(deviceDetails);
    const value = Math.max(0, Math.min(7, Math.floor(filterIndex)));
    await sendCommand(device, Commands.dx1Filter, value, { waitForResponse: false });
  }

  // Device broadcasts its current state (single-frame, cmd=dx1Filter) once
  // automatically right after connect/init - this listens for that rather
  // than actively probing (probing via 0x9XYY-style writes would overwrite
  // the value; see the note above the profile stream on why that's unsafe).
  async function readDacFilter(deviceDetails, timeoutMs = 2000) {
    const device = resolveDevice(deviceDetails);
    const frame = await readResponse(device, Commands.dx1Filter, timeoutMs);
    return frame.data;
  }

  // gainMode -> DX1 II high/low gain toggle
  async function setGainMode(deviceDetails, enabled) {
    const device = resolveDevice(deviceDetails);
    await sendCommand(device, Commands.dx1HighGain, enabled ? 1 : 0, { waitForResponse: false });
  }

  async function readGainMode(deviceDetails, timeoutMs = 2000) {
    const device = resolveDevice(deviceDetails);
    const frame = await readResponse(device, Commands.dx1HighGain, timeoutMs);
    return frame.data === 1;
  }

  // outputGain -> deviceExtras.js special-cases this: it's offered whenever
  // setOutputGain exists, with no config/support flag needed, and no read
  // counterpart. NOTE: the official app encodes volume via a precomputed
  // dB->raw lookup table (same mechanism as EQ preamp gain), not a linear
  // scale, which hasn't been extracted - this sends a best-effort linear
  // approximation to the headphone output (target 0) rather than the true
  // device curve.
  async function setOutputGain(deviceDetails, gainDb) {
    const device = resolveDevice(deviceDetails);
    const cmd = (Commands.dx1Volume | 1) >>> 0; // 1 = headphone target
    await sendCommand(device, cmd, Math.round(gainDb * 10), { waitForResponse: false });
  }

  return {
    // Standard handler interface - matches every other devicePEQ handler
    getCurrentSlot,
    getAvailableSlots,
    pullFromDevice,
    pushToDevice,
    enablePEQ,

    // Extra capabilities, flat top-level methods matching the naming
    // convention other handlers use (see walkplayHidHandler.js) so
    // devicePEQ/deviceExtras.js's capable() lookup finds them
    setDacFilter,
    readDacFilter,
    setGainMode,
    readGainMode,
    setOutputGain,

    // Expose internals for testing
    _internal: {
      buildHidFrame,
      parseHidFrame,
      calculateCrc16,
      sendCommand,
      sendReport,
      readResponse,
      initializeDevice,
      readConfigsViaUploadStream,
      decodeEnabled,
      decodePackedBand,
      decodeChannel,
      decodeConfigName,
      decodePreamp,
      encodePreamp,
      writeBand,
      bandBaseCmd,
      encodeGainByte,
      decodeGainByte,
      Commands,
      ProtocolType,
      BandSub,
      FilterType,
      FilterTypeCode
    }
  };
})();
