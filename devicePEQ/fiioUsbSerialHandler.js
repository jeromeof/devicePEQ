// fiioUsbSerialHandler.js
// Pragmatic Audio - Handler for FiiO USB Serial EQ Control

// Header constants - matching fiioUsbHidHandler.js for compatibility
const SET_HEADER1 = 0xAA;
const SET_HEADER2 = 0x0A;
const GET_HEADER1 = 0xBB;
const GET_HEADER2 = 0x0B;
const END_HEADERS = 0xEE;

// PEQ command constants - matching fiioUsbHidHandler.js for compatibility
const PEQ_FILTER_COUNT = 0x18; // 24 in hex
const PEQ_GLOBAL_GAIN = 0x17; // 23 in hex
const PEQ_FILTER_PARAMS = 0x15; // 21 in hex
const PEQ_PRESET_SWITCH = 0x16; // 22 in hex
const PEQ_SAVE_TO_DEVICE = 0x19; // 25 in hex
const PEQ_RESET_DEVICE = 0x1B; // 27 in hex
const PEQ_RESET_ALL = 0x1C; // 28 in hex

// Note these have different headers
const PEQ_FIRMWARE_VERSION = 0x0B; // 11 in hex
const PEQ_NAME_DEVICE = 0x30; // 48 in hex

class SerialDeviceError extends Error {}

export const fiioUsbSerial = (function () {

  // Helper function to send data and listen for response using device streams
  let __serialIsSending = false;
  async function sendReportAndListen(device, data, endByte = END_HEADERS) {
    if (__serialIsSending) throw new Error("Port is busy");
    __serialIsSending = true;

    const port = device.rawDevice;
    if (!port || !port.readable || !port.writable) {
      __serialIsSending = false;
      throw new Error("Serial port not available");
    }

    let writer = null;
    let reader = null;
    const buffer = [];
    const overallTimeoutMs = 5000;
    const startedAt = Date.now();
    let timerId = null;

    // Track expected total frame length once we have the header and LEN byte
    let expectedTotal = null; // bytes

    try {
      // Acquire writer per call, write, then release (replicating reference write())
      writer = port.writable.getWriter();
      await writer.write(data);
      try { writer.releaseLock(); } catch (_) {}

      // Acquire reader per call and read until done/terminator/timeout (replicating reference read())
      reader = port.readable.getReader();

      await Promise.all([
        Promise.resolve(),
        (async () => {
          while (true) {
            const elapsed = Date.now() - startedAt;
            if (elapsed >= overallTimeoutMs) return; // stop reading on overall timeout

            const remaining = overallTimeoutMs - elapsed;
            const race = await Promise.race([
              reader.read(),
              new Promise((_, reject) => {
                timerId = setTimeout(() => {
                  // cancel in-flight read to unblock
                  reader.cancel().catch(() => {});
                  reject(new Error("Timeout"));
                }, remaining);
              })
            ]);

            const { value, done } = race;
            if (done) break;
            const chunk = Array.from(value || []);
            if (chunk.length > 0) {
              buffer.push(...chunk);

              // Determine expected total frame length once we have at least 6 bytes
              if (expectedTotal == null && buffer.length >= 6) {
                const len = buffer[5] || 0; // LEN field
                // Frame layout: [H1,H2,0,0,CMD,LEN, (LEN data...), 0, END]
                expectedTotal = 6 + len + 2; // bytes
              }

              // If we already know how long the frame should be, only stop once all bytes are in
              if (expectedTotal != null && buffer.length >= expectedTotal) {
                // Only accept if the last byte is the terminator; otherwise keep reading
                if (buffer[expectedTotal - 1] === endByte) {
                  // Trim any extra bytes beyond expectedTotal (shouldn't happen often)
                  buffer.splice(expectedTotal);
                  return;
                }
              }
            }
            clearTimeout(timerId); // clear per-iteration timer
            timerId = null;
          }
        })()
      ]);

      return buffer.length > 0 ? new Uint8Array(buffer) : new Uint8Array(0);
    } catch (e) {
      if (e && e.message === "Timeout") {
        // On timeout, return empty buffer like original
        return new Uint8Array(0);
      }
      throw e;
    } finally {
      if (timerId) clearTimeout(timerId);
      try { if (reader) reader.releaseLock(); } catch (_) {}
      __serialIsSending = false;
    }
  }


  // Helper function to create command bytes
  function createCommandPacket(header1, header2, command, data = []) {
    const packet = [header1, header2, 0, 0, command];
    if (data.length > 0) {
      packet.push(data.length);
      packet.push(...data);
      // Reserved byte before terminator in examples
      packet.push(0);
    } else {
      packet.push(0, 0);
    }
    packet.push(END_HEADERS); // End header
    return new Uint8Array(packet);
  }

  // Helper function to convert string to byte array
  function stringToByteArray(str) {
    return Array.from(str, char => char.charCodeAt(0));
  }

  // Command functions for FiiO USB protocol - matching HID handler constants
  const createGetEqCountCmd = () => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_FILTER_COUNT);
  const createSetEqBandWithNameCmd = (bandIndex, name) => createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_NAME_DEVICE, [bandIndex, ...stringToByteArray(name.padEnd(8, "\0").slice(0, 8))]);
  const createGetEqBandCmd = bandIndex => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_FILTER_PARAMS, [bandIndex]);
  const createSetEqBandCmd = bandIndex => createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_FILTER_PARAMS, [bandIndex]);
  const createGetEqPresetCmd = () => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_PRESET_SWITCH);
  const createGetGlobalGainCmd = () => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_GLOBAL_GAIN);
  const createSetGlobalGainCmd = gain => {
    // Encode gain in tenths (0.1 dB) as two bytes (signed big-endian)
    const value = Math.round(gain * 10);
    const v16 = ((value % 0x10000) + 0x10000) % 0x10000;
    const hi = (v16 >> 8) & 0xFF;
    const lo = v16 & 0xFF;
    return createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_GLOBAL_GAIN, [hi, lo]);
  };
  const createSetEqPresetCmd = presetValue => createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_PRESET_SWITCH, [presetValue & 0xFF]);
  const createGetEqStatusCmd = () => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_FILTER_COUNT);
  const createGetDeviceInfoCmd = () => createCommandPacket(GET_HEADER1, GET_HEADER2, PEQ_FIRMWARE_VERSION);
  const createResetEqCmd = () => createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_RESET_DEVICE);

  // Helper functions for data parsing
  function parseGain(byte1, byte2) {
    // Signed 16-bit big-endian, tenths (0.1 dB units)
    let v = ((byte1 << 8) | byte2) & 0xFFFF;
    if (v & 0x8000) v = v - 0x10000;
    return v / 10.0;
  }

  function parseQValue(byte1, byte2) {
    // Unsigned 16-bit big-endian, hundredths
    const v = ((byte1 << 8) | byte2) & 0xFFFF;
    return v / 100.0;
  }

  // Encoding helpers
  function encodeSignedHundredths(value) {
    // For gain: device uses tenths (0.1 dB)
    const v = Math.round(value * 10);
    const v16 = ((v % 0x10000) + 0x10000) % 0x10000;
    return [(v16 >> 8) & 0xFF, v16 & 0xFF];
  }
  function encodeUnsignedHundredths(value) {
    const v = Math.round(value * 100);
    const v16 = v & 0xFFFF;
    return [(v16 >> 8) & 0xFF, v16 & 0xFF];
  }

  // Full-band set command: [index, gain_hi, gain_lo, freq_hi, freq_lo, q_hi, q_lo, type]
  function createSetEqBandCommand(bandIndex, frequency, gain, qValue, filterType) {
    const [gHi, gLo] = encodeSignedHundredths(gain);
    const freq = Math.round(frequency) & 0xFFFF;
    const fHi = (freq >> 8) & 0xFF;
    const fLo = freq & 0xFF;
    const [qHi, qLo] = encodeUnsignedHundredths(qValue);
    const data = [bandIndex & 0xFF, gHi, gLo, fHi, fLo, qHi, qLo, (filterType ?? 0) & 0xFF];
    return createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_FILTER_PARAMS, data);
  }

  // EQ switch (on/off)
  const createSetEqSwitchCommand = (enabled) => createCommandPacket(SET_HEADER1, SET_HEADER2, 0x1A, [enabled ? 1 : 0]);

  // Set preset (pre = 0x16)
  const createSetEqPreCommand = (presetValue) => createCommandPacket(SET_HEADER1, SET_HEADER2, PEQ_PRESET_SWITCH, [presetValue & 0xFF]);

  // Main handler functions
  async function getCurrentSlot(deviceDetails) {
    try {
      // Get current EQ preset
      const cmd = createGetEqPresetCmd();
      try { console.debug('[FiiO Serial] SEND get preset:', Array.from(cmd)); } catch (_) {}
      const response = await sendReportAndListen(deviceDetails, cmd);
      try { console.debug('[FiiO Serial] RECV get preset:', Array.from(response)); } catch (_) {}
      if (response.length > 6) {
        return response[6]; // Assuming preset ID is at byte 6
      }
      return 0;
    } catch (error) {
      console.error("Failed to get current slot:", error);
      throw error;
    }
  }

  async function pullFromDevice(deviceDetails, slot) {
    try {
      // Get EQ count
      const countResponse = await sendReportAndListen(deviceDetails, createGetEqCountCmd());
      let eqCount = 0;
      if (countResponse.length > 6) {
        eqCount = countResponse[6];
        if (eqCount === 0) {
          throw new Error("No PEQ band found.");
        }
      }

      // Get global gain
      const gainResponse = await sendReportAndListen(deviceDetails, createGetGlobalGainCmd());
      let eqGlobalGain = 0;
      if (gainResponse.length > 7) {
        eqGlobalGain = parseGain(gainResponse[6], gainResponse[7]);
      }

      // Get EQ bands
      const filters = [];
      for (let i = 0; i < eqCount; i++) {
        const bandResponse = await sendReportAndListen(deviceDetails, createGetEqBandCmd(i));
        if (bandResponse.length >= 14) {
          // Data layout: [index, gain_hi, gain_lo, freq_hi, freq_lo, q_hi, q_lo, type]
          const gain = parseGain(bandResponse[7], bandResponse[8]);
          const frequency = (bandResponse[9] << 8) | bandResponse[10];
          const qValue = parseQValue(bandResponse[11], bandResponse[12]);
          const filterType = bandResponse[13];

          // Convert FiiO filter type to standard format
          let type = "PK";
          switch (filterType) {
            case 0: type = "PK"; break;
            case 1: type = "LSQ"; break;
            case 2: type = "HSQ"; break;
            default: type = "PK"; break;
          }

          filters.push({
            freq: frequency,
            gain: gain,
            q: qValue,
            type: type
          });
        }
      }

      // Sort filters by frequency
      filters.sort((a, b) => a.freq - b.freq);

      return {
        filters: filters,
        globalGain: eqGlobalGain
      };

    } catch (error) {
      console.error("Failed to pull data from FiiO device:", error);
      throw error;
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    try {
      // Set global gain
      await sendReportAndListen(deviceDetails, createSetGlobalGainCmd(globalGain));

      // Set each EQ band
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];

        // Convert filter type to FiiO format
        let filterType = 0; // Default to peaking (PK)
        switch (filter.type) {
          case "PK": filterType = 0; break;
          case "LSQ": filterType = 1; break;
          case "HSQ": filterType = 2; break;
        }

        await sendReportAndListen(deviceDetails,
          createSetEqBandCommand(i, filter.freq, filter.gain, filter.q, filterType)
        );
      }

      console.log("FiiO settings applied successfully");
      // Return whether we should disconnect after saving, mirroring HID handler behavior
      return !!(deviceDetails && deviceDetails.modelConfig && deviceDetails.modelConfig.disconnectOnSave);

    } catch (error) {
      console.error("Failed to push data to FiiO device:", error);
      throw error;
    }
  }

  async function enablePEQ(deviceDetails, enable, slotId) {
    try {
      if (enable) {
        // Enable EQ and set to specified slot/preset
        await sendReportAndListen(deviceDetails, createSetEqSwitchCommand(1));
        if (slotId !== undefined) {
          await sendReportAndListen(deviceDetails, createSetEqPreCommand(slotId));
        }
      } else {
        // Disable EQ
        await sendReportAndListen(deviceDetails, createSetEqSwitchCommand(0));
      }

      console.log(`FiiO EQ ${enable ? 'enabled' : 'disabled'}`);

    } catch (error) {
      console.error("Failed to enable/disable FiiO EQ:", error);
      throw error;
    }
  }

  // Return the handler interface
  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
