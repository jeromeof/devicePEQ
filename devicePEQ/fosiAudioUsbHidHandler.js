//
// Copyright 2025 : Pragmatic Audio
//
// Fosi Audio USB HID Protocol Handler
// Protocol based on actual packet captures from Fosi Audio DS3 webapp
//
// Packet structure: [0x77, CMD, INDEX, ...zeros to 63 bytes]
// Commands observed:
// - 0x91 (145): Initial handshake
// - 0x8B (139): Query mode/band (index 0-9 for 10 bands)
// - 0x8E (142): Final/commit command
//

export const fosiAudioUsbHID = (function () {

  // Protocol constants
  const HEADER = 0x77; // 119 decimal - constant header byte
  const CMD = {
    // Core PEQ commands (from official Fosi Audio command set)
    SET_EQ_MODE: 0x8A,           // 138 - Switch preset/mode
    GET_EQ_MODE: 0x8B,           // 139 - Query mode
    SET_EQ_PARAMS: 0x8D,         // 141 - Set band parameters
    GET_EQ_PARAMS: 0x8E,         // 142 - Get band parameters (also used as commit)
    RESET_EQ_PARAMS: 0x90,       // 144 - Reset EQ
    GET_EQ_MODE_COUNT: 0x91,     // 145 - Get mode count (also INIT handshake)
    SET_AND_SAVE_EQ_MODE: 0x92,  // 146 - Save mode (also GET_PRESET)
    SET_EQ_ENABLE: 0x9D,         // 157 - Enable/disable EQ
    GET_EQ_ENABLE: 0x9E,         // 158 - Get EQ enable status

    // Additional device commands
    SET_VOLUME: 0x93,            // 147
    GET_VOLUME: 0x94,            // 148
    GET_FIRMWARE_VERSION: 0xA6,  // 166
  };

  const GET_ALL_BANDS = 0xFF; // 255 - Special index for GET_EQ_MODE to retrieve all bands

  const REPORT_ID = 0x01;
  const PACKET_SIZE = 63;

  // Preset mapping (based on Custom 1 = 7)
  const PRESET_MAP = {
    0: "Bypass",
    7: "Custom 1",
    8: "Custom 2", // Assumed
    9: "Custom 3", // Assumed
    10: "Custom 4", // Assumed
    11: "Custom 5", // Assumed
  };

  // Helper to create a command packet with proper padding
  function makePacket(cmd, index = 0) {
    const packet = new Uint8Array(PACKET_SIZE);
    packet[0] = HEADER;
    packet[1] = cmd;
    packet[2] = index;
    // Rest is zeros (already initialized by Uint8Array)
    return packet;
  }

  // Convert filter type to device format
  function convertFromFilterType(filterType) {
    const mapping = { "PK": 2, "LSQ": 1, "HSQ": 3 };
    return mapping[filterType] !== undefined ? mapping[filterType] : 2;
  }

  function convertToFilterType(value) {
    switch (value) {
      case 1: return "LSQ";
      case 2: return "PK";
      case 3: return "HSQ";
      default: return "PK";
    }
  }

  // Encode filter parameters into SET_EQ_PARAMS packet
  // Packet format: [HEADER, CMD, presetId, bandIndex, filterType, freq(float32), q(float32), bandwidth(float32), gain(float32), ...zeros]
  function encodeBandParams(presetId, bandIndex, filter) {
    const packet = new Uint8Array(PACKET_SIZE);
    const view = new DataView(packet.buffer);

    packet[0] = HEADER;
    packet[1] = CMD.SET_EQ_PARAMS;
    packet[2] = presetId;
    packet[3] = bandIndex;
    packet[4] = convertFromFilterType(filter.type || "PK");

    // Float32 values in little-endian
    view.setFloat32(5, filter.freq || 1000, true);      // Frequency
    view.setFloat32(9, filter.q || 1.0, true);          // Q factor
    view.setFloat32(13, 0, true);                        // Bandwidth (unused, set to 0)
    view.setFloat32(17, filter.gain || 0, true);        // Gain

    return packet;
  }

  // Parse band parameters from response
  // NOTE: WebHID responses include reportId as byte 0, so actual data starts at byte 1
  function parseBandParams(data) {
    if (data.length < 22) return null;

    const view = new DataView(data.buffer, data.byteOffset);

    // Check header at byte 1 (byte 0 is reportId)
    if (data[1] !== HEADER) return null;

    const cmd = data[2];
    const presetId = data[3];
    const bandIndex = data[4];
    const filterType = data[5];

    // Parse Float32 values (offset by 1 due to reportId)
    const freq = view.getFloat32(6, true);
    const q = view.getFloat32(10, true);
    const bandwidth = view.getFloat32(14, true);
    const gain = view.getFloat32(18, true);

    return {
      presetId,
      bandIndex,
      type: convertToFilterType(filterType),
      freq,
      q,
      bandwidth,
      gain,
      disabled: (gain === 0 && freq === 0)
    };
  }

  // Send command to device using Feature Report
  async function sendCommand(device, reportId, cmd, index = 0, delay = 0) {
    const packet = makePacket(cmd, index);
    console.log(`USB Device PEQ: Fosi Audio sending feature [0x${packet[0].toString(16)}, 0x${packet[1].toString(16)}, ${packet[2]}]`);
    await device.sendFeatureReport(reportId, packet);
    if (delay > 0) {
      await waitMs(delay);
    }
  }

  // Receive response using Feature Report
  async function receiveFeatureReport(device, reportId) {
    try {
      const dataView = await device.receiveFeatureReport(reportId);
      console.log(`USB Device PEQ: Fosi Audio received feature report:`, Array.from(new Uint8Array(dataView.buffer).slice(0, 25)));
      return dataView;
    } catch (e) {
      console.error("USB Device PEQ: Fosi Audio receiveFeatureReport failed:", e);
      return null;
    }
  }

  // Send commit for specific band (using GET_EQ_PARAMS as commit)
  async function sendBandCommit(device, reportId, presetId, bandIndex) {
    const packet = new Uint8Array(PACKET_SIZE);
    packet[0] = HEADER;
    packet[1] = CMD.GET_EQ_PARAMS; // 0x8E also serves as commit
    packet[2] = presetId;
    packet[3] = bandIndex;
    console.log(`USB Device PEQ: Fosi Audio commit band ${bandIndex} of preset ${presetId}`);
    await device.sendReport(reportId, packet);
  }

  // Wait for response from device
  function waitForResponse(device, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        device.removeEventListener("inputreport", handler);
        reject(new Error(`Timeout waiting for response after ${timeout}ms`));
      }, timeout);

      const handler = (event) => {
        clearTimeout(timer);
        device.removeEventListener("inputreport", handler);
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: Fosi Audio received:`, Array.from(data.slice(0, 10)));
        resolve(data);
      };

      device.addEventListener("inputreport", handler);
    });
  }

  // Parse response data based on command type
  function parseResponse(data) {
    if (data.length < 3) return null;

    // Check header
    if (data[0] !== HEADER) {
      console.warn("USB Device PEQ: Fosi Audio unexpected header:", data[0]);
      return null;
    }

    const cmd = data[1];
    const index = data[2];

    // Parse based on command type
    // This will need adjustment based on actual response format
    const result = {
      cmd,
      index,
      raw: data
    };

    console.log(`USB Device PEQ: Fosi Audio parsed response cmd=0x${cmd.toString(16)} index=${index}`);
    return result;
  }

  // Public API

  async function getCurrentSlot(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;

    console.log("USB Device PEQ: Fosi Audio getCurrentSlot - returning Custom 1 (7)");
    // Return Custom 1 as default active slot
    return 7;
  }

  async function pullFromDevice(deviceDetails, slot = 0) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;
    const maxFilters = deviceDetails.modelConfig?.maxFilters || 10;

    try {
      console.log(`USB Device PEQ: Fosi Audio pulling from device (mode ${slot})...`);

      // Setup listener to collect all band responses
      const filters = [];
      let responseCount = 0;

      const responseHandler = (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: Fosi Audio RAW RESPONSE:`, Array.from(data.slice(0, 25)));
        console.log(`USB Device PEQ: Fosi Audio Response - Header: 0x${data[0]?.toString(16)}, Cmd: 0x${data[1]?.toString(16)}, Byte2: ${data[2]}, Byte3: ${data[3]}`);

        const parsed = parseBandParams(data);
        console.log(`USB Device PEQ: Fosi Audio Parsed:`, parsed);

        if (parsed && parsed.bandIndex !== undefined && parsed.bandIndex < maxFilters) {
          filters[parsed.bandIndex] = {
            type: parsed.type,
            freq: parsed.freq,
            q: parsed.q,
            gain: parsed.gain,
            disabled: parsed.disabled
          };
          responseCount++;
          console.log(`USB Device PEQ: Fosi Audio band ${parsed.bandIndex}: ${parsed.freq}Hz ${parsed.gain}dB Q=${parsed.q}`);
        } else {
          console.warn(`USB Device PEQ: Fosi Audio Failed to parse or invalid band index`);
        }
      };

      device.addEventListener("inputreport", responseHandler);

      // Read sequence using Feature Reports (request/response)
      // 1. Switch to the preset we want to read
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slot);

      // 2. Request each band's parameters individually and receive response
      for (let i = 0; i < maxFilters; i++) {
        // Create GET_EQ_PARAMS packet for this band
        const packet = new Uint8Array(PACKET_SIZE);
        packet[0] = HEADER;
        packet[1] = CMD.GET_EQ_PARAMS;
        packet[2] = slot;  // preset ID
        packet[3] = i;     // band index

        console.log(`USB Device PEQ: Fosi Audio requesting band ${i} of preset ${slot}`);
        await device.sendFeatureReport(reportId, packet);

        // Receive response immediately
        const response = await receiveFeatureReport(device, reportId);
        if (response) {
          const data = new Uint8Array(response.buffer);
          const parsed = parseBandParams(data);

          if (parsed && parsed.bandIndex === i) {
            filters[i] = {
              type: parsed.type,
              freq: parsed.freq,
              q: parsed.q,
              gain: parsed.gain,
              disabled: parsed.disabled
            };
            responseCount++;
            console.log(`USB Device PEQ: Fosi Audio band ${i}: ${parsed.freq}Hz ${parsed.gain}dB Q=${parsed.q}`);
          }
        }

        await waitMs(20); // Small delay between band requests
      }

      device.removeEventListener("inputreport", responseHandler);

      console.log(`USB Device PEQ: Fosi Audio received ${responseCount} band responses`);

      // Fill in any missing bands with defaults
      for (let i = 0; i < maxFilters; i++) {
        if (!filters[i]) {
          filters[i] = {
            type: "PK",
            freq: 1000,
            q: 1.0,
            gain: 0,
            disabled: true
          };
        }
      }

      return { filters, globalGain: 0 };
    } catch (error) {
      console.error("USB Device PEQ: Fosi Audio pullFromDevice failed:", error);
      throw error;
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;
    const maxFilters = Math.min(filters.length, deviceDetails.modelConfig?.maxFilters || 10);

    try {
      console.log(`USB Device PEQ: Fosi Audio pushing ${maxFilters} filters to preset ${slot} (${PRESET_MAP[slot] || 'Unknown'})...`);

      // Send initial handshake (GET_EQ_MODE_COUNT doubles as INIT)
      await sendCommand(device, reportId, CMD.GET_EQ_MODE_COUNT, 0, 50);

      // Switch to the target preset
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slot, 30);

      // Write each band's parameters followed by per-band commit
      for (let i = 0; i < maxFilters; i++) {
        const filter = filters[i];
        const filterToWrite = filter.disabled
          ? { type: "PK", freq: 1000, q: 1.0, gain: 0 }
          : filter;

        // Send SET_EQ_PARAMS command using Feature Report
        const packet = encodeBandParams(slot, i, filterToWrite);
        console.log(`USB Device PEQ: Fosi Audio writing band ${i}: freq=${filterToWrite.freq}Hz gain=${filterToWrite.gain}dB q=${filterToWrite.q}`);
        await device.sendFeatureReport(reportId, packet);
        await waitMs(20);

        // Commit this band
        await sendBandCommit(device, reportId, slot, i);
        await waitMs(20);
      }

      // Send final global commit/save
      await sendCommand(device, reportId, CMD.SET_AND_SAVE_EQ_MODE, slot, 50);

      console.log("USB Device PEQ: Fosi Audio push complete");
      return deviceDetails.modelConfig?.disconnectOnSave || false;
    } catch (error) {
      console.error("USB Device PEQ: Fosi Audio pushToDevice failed:", error);
      throw error;
    }
  }

  async function enablePEQ(deviceDetails, enable, slotId) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;

    console.log(`USB Device PEQ: Fosi Audio ${enable ? 'enabling' : 'disabling'} PEQ (preset ${slotId})`);

    // Send initial handshake
    await sendCommand(device, reportId, CMD.GET_EQ_MODE_COUNT, 0, 30);

    // Use SET_EQ_ENABLE command if just toggling, or SET_EQ_MODE to switch presets
    if (enable) {
      // Switch to the specified preset
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slotId, 30);
    } else {
      // Disable or switch to bypass (preset 0)
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, 0, 30);
    }

    console.log(`USB Device PEQ: Fosi Audio switched to preset ${enable ? slotId : 0} (${PRESET_MAP[enable ? slotId : 0] || 'Unknown'})`);
  }

  // Helper delay function
  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
