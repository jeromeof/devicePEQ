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
    heartbeat: 0x111a,
    eqPreview: 0x111b,      // Save/apply EQ
    eqPreviewState: 0x111c,
    agreementConfig: 0x1120,
    hardwareVersion: 0x1201,
    softwareVersion: 0x1202,
    deviceId: 0x1203,
    mcuEqEnableState: 0x1204,
    mcuEqCurrentConfig: 0x1206, // bulk multiframe config read
    usbSerial: 0x1207,
    configSwitch: 0x9e01,       // apply/recompute live EQ DSP after writes - DOES echo an ack

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

  // Filter type enum (confirmed via UI i18n label order: Peak, Low Shelf,
  // High Shelf, Low Pass, High Pass)
  const FilterType = {
    1: 'PK',
    2: 'LSQ',
    3: 'HSQ',
    4: 'LPF',
    5: 'HPF'
  };
  const FilterTypeCode = { PK: 1, LSQ: 2, HSQ: 3, LPF: 4, HPF: 5 };

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
  function startHeartbeat(device) {
    return setInterval(async () => {
      try {
        await sendCommand(device, Commands.heartbeat, 1, { waitForResponse: false });
      } catch (err) {
        console.warn('USB Device PEQ: Topping - heartbeat error:', err.message);
      }
    }, 1000);
  }

  // ── EQ Band Encoding/Decoding ──────────────────────────────────────────
  // gain: raw signed byte, dB * 10 (range -120..120 for +/-12dB)
  // freq: raw Hz, direct 32-bit value (range 20-20000)
  // Q: raw *10000 (range 0.1-20, default 0.707)
  // type: 1=Peak(PK), 2=LowShelf(LSQ), 3=HighShelf(HSQ), 4=LowPass, 5=HighPass

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
  // The device continuously (and automatically, without us requesting it)
  // streams the entire EQ configuration as a repeating multiframe broadcast
  // on cmd 0x1106 ("upload"). Reconstructed and verified against real
  // capture data (topping_capture.json, live-edited session): a full cycle
  // is `totalFrameLen` frames (typically 78), indexed by `curFrame`:
  //   [0-3]   name (4 x 32-bit words)
  //   [4]     enabledL (global EQ on/off, left)
  //   [5]     preampGainL (raw lookup-table encoded value - NOT linear dB;
  //           decoding this precisely requires the device's own gain table,
  //           which hasn't been extracted, so it is exposed as raw data)
  //   [6]     enabledR
  //   [7]     preampGainR
  //   [8..40] 11 left bands x 3 words (packed, freq, Q)
  //   [41..73] 11 right bands x 3 words (packed, freq, Q), mirrors left
  //   [74..77] trailing name/footer bytes
  // packed = enabled(bits0-7==1) | type(bits8-15) | gain(bits16-23, signed, /10)

  const UPLOAD_BAND_L_OFFSET = 8;
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

  // Collects one full cycle of the 0x1106 multiframe broadcast and decodes
  // the 11 left-channel bands from it. Does not send anything itself - the
  // device streams this on its own once connected/initialized.
  async function readBandsViaUploadStream(device, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const buffer = new Map();
      let frameLen = null;

      const finish = (result, err) => {
        device.removeEventListener('inputreport', handler);
        clearTimeout(timeoutId);
        if (err) reject(err); else resolve(result);
      };

      const handler = (event) => {
        try {
          const view = new Uint8Array(event.data.buffer);
          if (view.every(byte => byte === 0)) return;

          const frame = parseHidFrame(view);
          if (frame.cmd !== Commands.upload || frame.totalFrameLen < UPLOAD_MIN_FRAME_LEN) return;

          if (frameLen === null) frameLen = frame.totalFrameLen;
          buffer.set(frame.curFrame, frame.dataUnsigned);

          // A full cycle collected once we have every index from 0 to frameLen-1
          if (buffer.size >= frameLen) {
            let complete = true;
            for (let i = 0; i < frameLen; i++) {
              if (!buffer.has(i)) { complete = false; break; }
            }
            if (complete) {
              const bandsL = [];
              for (let i = 0; i < 11; i++) {
                const base = UPLOAD_BAND_L_OFFSET + i * UPLOAD_BAND_STRIDE;
                bandsL.push(decodePackedBand(
                  buffer.get(base) || 0,
                  buffer.get(base + 1) || 0,
                  buffer.get(base + 2) || 0
                ));
              }
              finish(bandsL);
            }
          }
        } catch (err) {
          // ignore parse errors from unrelated traffic
        }
      };

      const timeoutId = setTimeout(() => {
        finish(null, new Error(`Timed out waiting for full upload config cycle after ${timeoutMs}ms`));
      }, timeoutMs);

      device.addEventListener('inputreport', handler);
    });
  }

  async function writeBand(device, bandIndex, filter) {
    const typeCode = FilterTypeCode[filter.type] || FilterTypeCode.PK;
    const freq = Math.max(20, Math.min(20000, Math.round(filter.freq || 1000)));
    const gainByte = encodeGainByte(filter.gain);
    const qRaw = Math.round((filter.q || 0.707) * 10000);
    const enabled = filter.disabled ? 0 : 1;

    // Left channel
    await writeBandParam(device, bandIndex, BandSub.typeL, typeCode);
    await writeBandParam(device, bandIndex, BandSub.freqL, freq);
    await writeBandParam(device, bandIndex, BandSub.gainL, gainByte);
    await writeBandParam(device, bandIndex, BandSub.qL, qRaw);
    await writeBandParam(device, bandIndex, BandSub.enabledL, enabled);

    // Right channel (mirrored - headphone EQ is not per-channel in the UI)
    await writeBandParam(device, bandIndex, BandSub.typeR, typeCode);
    await writeBandParam(device, bandIndex, BandSub.freqR, freq);
    await writeBandParam(device, bandIndex, BandSub.gainR, gainByte);
    await writeBandParam(device, bandIndex, BandSub.qR, qRaw);
    await writeBandParam(device, bandIndex, BandSub.enabledR, enabled);

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

  async function getCurrentSlot(_deviceDetails) {
    console.log('USB Device PEQ: Topping - getCurrentSlot (returns 0)');
    return 0;
  }

  async function pullFromDevice(deviceDetails) {
    return withIoLock(() => pullFromDeviceInternal(deviceDetails));
  }

  async function pullFromDeviceInternal(deviceDetails) {
    console.log('USB Device PEQ: Topping - reading EQ state...');
    const device = deviceDetails.rawDevice;
    const maxFilters = 11; // Topping DX1 II has 11 bands

    try {
      try {
        await initializeDevice(device);
      } catch (err) {
        console.warn('USB Device PEQ: Topping - initialization warning:', err.message);
      }

      // Set up the collector BEFORE triggering the dump - the device streams
      // the multiframe broadcast continuously once running, but requesting
      // it explicitly guarantees a cycle starts promptly.
      const bandsPromise = readBandsViaUploadStream(device);
      await sendCommand(device, Commands.upload, 0, {
        protocolType: ProtocolType.readNack,
        waitForResponse: false
      });

      const filters = await bandsPromise;
      filters.forEach((band, i) => {
        console.log(`  Band ${i + 1}: freq=${band.freq}, gain=${band.gain}, q=${band.q}, type=${band.type}, enabled=${!band.disabled}`);
      });

      console.log(`USB Device PEQ: Topping - read ${filters.length} bands successfully`);
      return { filters, globalGain: 0 };
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
    }
  }

  async function pushToDevice(deviceDetails, _phoneObj, _slot, _globalGain, filters) {
    return withIoLock(() => pushToDeviceInternal(deviceDetails, _phoneObj, _slot, _globalGain, filters));
  }

  async function pushToDeviceInternal(deviceDetails, _phoneObj, _slot, _globalGain, filters) {
    console.log('USB Device PEQ: Topping - writing EQ configuration...');
    const device = deviceDetails.rawDevice;

    try {
      await initializeDevice(device);
      const heartbeat = startHeartbeat(device);

      try {
        for (let bandIndex = 0; bandIndex < Math.min(filters.length, 11); bandIndex++) {
          const filter = filters[bandIndex];
          try {
            await writeBand(device, bandIndex, filter);
            console.log(`  Band ${bandIndex + 1}: freq=${filter.freq}, gain=${filter.gain}, q=${filter.q}, type=${filter.type}`);
          } catch (err) {
            console.warn(`  Band ${bandIndex + 1} write failed:`, err.message);
          }

          await new Promise(r => setTimeout(r, 30));
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

  async function enablePEQ(deviceDetails) {
    console.log('USB Device PEQ: Topping - enabling PEQ');
    const device = deviceDetails.rawDevice ? deviceDetails.rawDevice : deviceDetails;
    try {
      await sendCommand(device, Commands.mcuEqEnableState, 1);
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
  // the value; see readBandsViaUploadStream's note on why that's unsafe).
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
      readBandsViaUploadStream,
      decodePackedBand,
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
