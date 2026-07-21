import { logHidTx, logHidRx } from './deviceDebugLog.js';

export const toppingUsbHidHandler = (function () {
  // ===== Topping Official Protocol =====
  // Frame-based request-response with async inputreport listeners
  // Frame: [0x00] [0x22] [0x33] [protocolType] [totalFrameLen] [curFrame] [cmdLo] [cmdHi] [data..] [CRC] [0x66] [0x77]

  const REPORT_ID = 0x00;

  // Protocol types
  const ProtocolType = {
    readAck: 17,
    readNack: 16,
    rAck: 31,
    writeAck: 33,
    writeNack: 32,
    wAck: 47
  };

  // Command IDs (16-bit little-endian in frames)
  const Commands = {
    // DX1 II specific commands (0x7100-0x8300 range)
    dx1State: 0x7100,
    dx1Mute: 0x7200,
    dx1Filter: 0x7300,
    dx1OutputSwitch: 0x7400,
    dx1HighGain: 0x7500,
    dx1Volume: 0x7600,
    dx1CPresetSave: 0x7700,
    dx1CPresetCall: 0x7800,
    dx1AutoStandby: 0x7900,
    dx1Brightness: 0x7a00,
    dx1InputSwitch: 0x7b00,
    dx1OptMode: 0x7c00,
    dx1EqFollow: 0x7e00,
    dx1VolumeFollow: 0x7e80,
    dx1FactoryReset: 0x7f00,
    dx1LineoutMode: 0x8101,
    dx1RemoteDisable: 0x8102,
    dx1OptActive: 0x8103,
    dx1UsbActive: 0x8104,
    dx1UacVersions: 0x8105,
    dx1PeqFactoryReset: 0x8106,
    dx1WebFeatureFlag: 0x8107,
    dx1ChannelBalance: 0x8108,
    dx1DisplayMode: 0x8109,
    dx1KnobClick: 0x8200,
    dx1KnobDoubleClick: 0x8300,

    // System commands (used during init and EQ read)
    connectState: 0x1101,
    heartbeat: 0x112a,
    eqPreview: 0x111b,
    eqPreviewState: 0x111c,
    agreementConfig: 0x1130,
    upload: 0x110e,
    sampling: 0x110f,
    mcuEqEnableState: 0x1114,
    mcuEqCurrentConfig: 0x1116,
    usbSerial: 0x1117,
    hardwareVersion: 0x1201,
    softwareVersion: 0x1202,
    deviceId: 0x1203
  };

  // ── CRC16 Calculation ──────────────────────────────────────────────────

  function calculateCRC16(buffer, startIdx, endIdx) {
    let crc = 0xffff;
    for (let i = startIdx; i <= endIdx; i++) {
      crc ^= buffer[i];
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

  function buildHidFrame(options) {
    const buffer = new Uint8Array(16);

    buffer[0] = 0x00; // Report ID
    buffer[1] = 0x22; // Sync marker
    buffer[2] = 0x33; // Sync marker
    buffer[3] = options.protocolType || ProtocolType.writeNack;
    buffer[4] = options.totalFrameLen || 1;
    buffer[5] = options.curFrame || 0;
    // Note: Command is little-endian in actual frames
    buffer[6] = options.cmd & 0xff;
    buffer[7] = (options.cmd >> 8) & 0xff;

    // Data as 32-bit little-endian
    const data = options.data >>> 0;
    buffer[8] = data & 0xff;
    buffer[9] = (data >> 8) & 0xff;
    buffer[10] = (data >> 16) & 0xff;
    buffer[11] = (data >> 24) & 0xff;

    // CRC over bytes 3-11
    const crc = calculateCRC16(buffer, 3, 11);
    buffer[12] = crc & 0xff;
    buffer[13] = (crc >> 8) & 0xff;

    buffer[14] = 0x66; // Footer marker
    buffer[15] = 0x77; // Footer marker

    return buffer;
  }

  // ── Frame Parsing ────────────────────────────────────────────────────

  function parseHidFrame(buffer) {
    if (buffer.byteLength < 16) {
      throw new Error(`Invalid frame length: ${buffer.byteLength}`);
    }

    const view = new Uint8Array(buffer);

    // Validate markers
    if (view[1] !== 0x22 || view[2] !== 0x33) {
      throw new Error('Invalid frame header markers');
    }
    if (view[14] !== 0x66 || view[15] !== 0x77) {
      throw new Error('Invalid frame footer markers');
    }

    // Note: Command is little-endian
    const cmd = view[6] | (view[7] << 8);
    // Data is little-endian
    const data = view[8] | (view[9] << 8) | (view[10] << 16) | (view[11] << 24);

    return {
      protocolType: view[3],
      totalFrameLen: view[4],
      curFrame: view[5],
      cmd,
      data: data >>> 0,
      crc: view[12] | (view[13] << 8),
      buffer: view
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

  // Read from device with async inputreport listener (multiframe assembly)
  async function readFromDevice(device, commandId, timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const frameMap = new Map(); // Map of curFrame -> frame data
      let totalFrameLen = 1;
      let receivedFrameCount = 0;

      const handler = (event) => {
        try {
          const view = new Uint8Array(event.data.buffer);
          logHidRx('Topping', view);
          const frame = parseHidFrame(view);

          // Check if this is a response to our command
          if (frame.cmd !== commandId) {
            return; // Not for us
          }

          // First frame sets totalFrameLen
          if (receivedFrameCount === 0) {
            totalFrameLen = frame.totalFrameLen;
          }

          frameMap.set(frame.curFrame, frame.data);
          receivedFrameCount++;

          // If we have all frames, reassemble and resolve
          if (receivedFrameCount >= totalFrameLen) {
            device.removeEventListener('inputreport', handler);
            clearTimeout(timeoutId);

            // For single-frame response, just return the data
            if (totalFrameLen === 1) {
              resolve(frame.data);
            } else {
              // For multi-frame, return the map of all frames
              resolve(frameMap);
            }
          }
        } catch (err) {
          console.error('Error parsing frame:', err.message);
        }
      };

      const timeoutId = setTimeout(() => {
        device.removeEventListener('inputreport', handler);
        reject(new Error(`Read timeout for command 0x${commandId.toString(16)} after ${timeoutMs}ms`));
      }, timeoutMs);

      device.addEventListener('inputreport', handler);

      // Send the read request
      const frame = buildHidFrame({
        protocolType: ProtocolType.readNack,
        cmd: commandId,
        data: 0
      });
      sendReport(device, frame).catch(err => {
        device.removeEventListener('inputreport', handler);
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  // ── Device Communication ──────────────────────────────────────────────

  async function writeCommand(device, commandId, dataValue, protocolType = ProtocolType.writeNack) {
    const frame = buildHidFrame({
      protocolType,
      cmd: commandId,
      data: dataValue
    });
    await sendReport(device, frame);
  }

  async function initializeDevice(device) {
    console.log('USB Device PEQ: Topping initializing device...');
    try {
      // Connect state
      await writeCommand(device, Commands.connectState, 1, ProtocolType.writeNack);
      await new Promise(r => setTimeout(r, 100));

      // Agreement config
      await writeCommand(device, Commands.agreementConfig, 1, ProtocolType.writeNack);
      await new Promise(r => setTimeout(r, 100));

      console.log('USB Device PEQ: Topping initialization complete');
    } catch (err) {
      console.error('USB Device PEQ: Topping initialization failed:', err.message);
      throw err;
    }
  }

  // Start heartbeat to keep device alive
  function startHeartbeat(device) {
    const heartbeatInterval = setInterval(async () => {
      try {
        await writeCommand(device, Commands.heartbeat, 1, ProtocolType.writeNack);
      } catch (err) {
        console.warn('USB Device PEQ: Topping heartbeat failed:', err.message);
        clearInterval(heartbeatInterval);
      }
    }, 1000);

    return heartbeatInterval;
  }

  // ── EQ Data Decoding ──────────────────────────────────────────────────

  // Decode packed band parameters (enabled flag, filter type, gain)
  function decodeBandParams(packedWord) {
    const enabled = (packedWord & 0xff) === 1;
    const filterTypeCode = (packedWord >> 8) & 0xff;
    const gainRaw = (packedWord >> 16) & 0xff;
    // Treat as signed int8
    const gainSigned = gainRaw > 127 ? gainRaw - 256 : gainRaw;
    const gainDb = gainSigned / 10.0;

    const filterTypeMap = { 0: 'PK', 1: 'LSQ', 2: 'HSQ' };
    const filterType = filterTypeMap[filterTypeCode] || 'PK';

    return { enabled, filterType, gainDb };
  }

  // ── Public API ────────────────────────────────────────────────────────

  async function getCurrentSlot(_deviceDetails) {
    console.log('USB Device PEQ: Topping getCurrentSlot called (returns 0).');
    return 0;
  }

  async function pullFromDevice(deviceDetails) {
    console.log('USB Device PEQ: Topping pullFromDevice - reading EQ state...');
    const device = deviceDetails.rawDevice;
    const maxFilters = deviceDetails.modelConfig.maxFilters || 10;

    try {
      // Initialize device if needed
      try {
        await initializeDevice(device);
      } catch (err) {
        console.warn('USB Device PEQ: Topping - initialization warning:', err.message);
      }

      // Read EQ current config (88 frames of data)
      const frameMap = await readFromDevice(device, Commands.mcuEqCurrentConfig, 1200);

      // Simple parsing: collect all data32 values in order
      const frameArray = [];
      for (let i = 0; i < frameMap.size; i++) {
        if (frameMap.has(i)) {
          frameArray.push(frameMap.get(i));
        }
      }

      console.log(`USB Device PEQ: Topping read ${frameArray.length} frames, parsing...`);

      // Parse 10 bands from the frame data
      // Frame structure (simplified): frames contain band data with freq, Q, packed params
      // Each band is roughly: [packedParams][freq][Q] across multiple frames
      const filters = [];

      for (let i = 0; i < maxFilters && i < frameArray.length; i++) {
        const frameData = frameArray[i];

        // Extract from packed 32-bit word
        const { enabled, filterType, gainDb } = decodeBandParams(frameData);

        // Next frames should have frequency and Q (placeholder for now)
        filters.push({
          type: filterType,
          freq: 1000 + i * 1000, // Placeholder
          q: 1.0,
          gain: gainDb,
          disabled: !enabled
        });
      }

      return { filters, globalGain: 0 };
    } catch (err) {
      console.error('USB Device PEQ: Topping pullFromDevice failed:', err.message);
      // Return safe defaults on failure
      const filters = Array(maxFilters).fill(null).map(() => ({
        type: 'PK',
        freq: 1000,
        q: 1.0,
        gain: 0,
        disabled: true
      }));
      return { filters, globalGain: 0 };
    }
  }

  async function pushToDevice(deviceDetails, _phoneObj, _slot, globalGain, filters) {
    console.log('USB Device PEQ: Topping pushToDevice - writing EQ...');
    const device = deviceDetails.rawDevice;

    try {
      // Initialize device
      await initializeDevice(device);
      startHeartbeat(device);

      // TODO: Implement actual EQ filter writing via eqPreview command (0x111b)
      // Need to encode filters into proper multiframe format
      console.log('USB Device PEQ: Topping - EQ write not yet implemented');
      console.log('Filters to write:', filters.length, 'Pregain:', globalGain);

      return false;
    } catch (err) {
      console.error('USB Device PEQ: Topping pushToDevice failed:', err.message);
      throw err;
    }
  }

  async function enablePEQ(device) {
    console.log('USB Device PEQ: Topping enablePEQ - sending EQ enable command.');
    try {
      await writeCommand(device, Commands.mcuEqEnableState, 1);
    } catch (err) {
      console.warn('USB Device PEQ: Topping enablePEQ warning:', err.message);
    }
  }

  async function readVersion(device) {
    console.log('USB Device PEQ: Topping readVersion - querying firmware version...');
    try {
      const version = await readFromDevice(device, Commands.softwareVersion, 500);
      return `v${version}`;
    } catch (err) {
      console.warn('USB Device PEQ: Topping readVersion failed:', err.message);
      return 'unknown';
    }
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
    readVersion,
    // Expose internals for testing
    _internal: {
      buildHidFrame,
      parseHidFrame,
      calculateCRC16,
      decodeBandParams,
      Commands,
      ProtocolType,
      readFromDevice,
      writeCommand,
      initializeDevice
    }
  };
})();
