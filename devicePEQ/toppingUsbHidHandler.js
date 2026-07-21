import { logHidTx, logHidRx } from './deviceDebugLog.js';

export const toppingUsbHidHandler = (function () {
  // ===== Topping Official Protocol =====
  // Frame-based request-response with async inputreport listeners
  // Frame: [0x00] [0x22] [0x33] [protocolType] [totalFrameLen] [curFrame] [cmdHi] [cmdLo] [data..] [CRC] [0x66] [0x77]

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

  // Command IDs (16-bit big-endian)
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

    // E50II/E2x2/E4x4 commands (used during init)
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
    buffer[6] = (options.cmd >> 8) & 0xff;
    buffer[7] = options.cmd & 0xff;

    // Data as 32-bit big-endian
    const data = options.data >>> 0;
    buffer[8] = (data >> 24) & 0xff;
    buffer[9] = (data >> 16) & 0xff;
    buffer[10] = (data >> 8) & 0xff;
    buffer[11] = data & 0xff;

    // CRC over bytes 3-11
    const crc = calculateCRC16(buffer, 3, 11);
    buffer[12] = (crc >> 8) & 0xff;
    buffer[13] = crc & 0xff;

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

    return {
      protocolType: view[3],
      totalFrameLen: view[4],
      curFrame: view[5],
      cmd: (view[6] << 8) | view[7],
      data: (view[8] << 24) | (view[9] << 16) | (view[10] << 8) | view[11],
      crc: (view[12] << 8) | view[13],
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

  // Read from device with async inputreport listener
  async function readFromDevice(device, commandId, timeoutMs = 1000) {
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
              // For multi-frame, reassemble (simplified for now)
              resolve(frameMap);
            }
          }
        } catch (err) {
          console.error('Error parsing frame:', err.message);
        }
      };

      const timeoutId = setTimeout(() => {
        device.removeEventListener('inputreport', handler);
        reject(new Error(`Read timeout for command 0x${commandId.toString(16)}`));
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

      // Query EQ enable state
      try {
        const eqState = await readFromDevice(device, Commands.mcuEqEnableState, 500);
        console.log('USB Device PEQ: Topping EQ state:', eqState);
      } catch (err) {
        console.warn('USB Device PEQ: Topping - could not read EQ state:', err.message);
      }

      console.log('USB Device PEQ: Topping initialization complete');
    } catch (err) {
      console.error('USB Device PEQ: Topping initialization failed:', err.message);
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

  // ── Public API ────────────────────────────────────────────────────────

  async function getCurrentSlot(_deviceDetails) {
    console.log('USB Device PEQ: Topping getCurrentSlot called (returns 0).');
    return 0;
  }

  async function pullFromDevice(deviceDetails) {
    console.log('USB Device PEQ: Topping pullFromDevice - device does not support read.');
    // Return empty filters - device is write-only
    const filters = Array(deviceDetails.modelConfig.maxFilters).fill(null).map(() => ({
      type: 'PK',
      freq: 1000,
      q: 1.0,
      gain: 0,
      disabled: true
    }));
    return { filters, globalGain: 0 };
  }

  async function pushToDevice(deviceDetails, _phoneObj, _slot, globalGain, filters) {
    console.log('USB Device PEQ: Topping pushToDevice - write-only device.');
    const device = deviceDetails.rawDevice;

    // Initialize device on first write
    try {
      await initializeDevice(device);
      startHeartbeat(device);
    } catch (err) {
      console.warn('USB Device PEQ: Topping - initialization warning:', err.message);
      // Continue anyway
    }

    // TODO: Implement actual EQ filter writing
    // The exact command structure for eqPreview (0x111b) and band parameters
    // needs to be reverse-engineered from USB captures or APK analysis
    console.log('USB Device PEQ: Topping - EQ write not yet implemented (awaiting protocol discovery)');
    console.log('Filters to write:', filters.length);

    return false; // don't force disconnect
  }

  async function enablePEQ(_device) {
    console.log('USB Device PEQ: Topping enablePEQ - no separate global opcode.');
  }

  async function readVersion(_device) {
    console.log('USB Device PEQ: Topping readVersion - not yet implemented.');
    return 'unknown';
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
      Commands,
      ProtocolType,
      readFromDevice,
      writeCommand,
      initializeDevice
    }
  };
})();
