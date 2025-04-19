// qudelixUsbHidHandler.js
// Pragmatic Audio - Handler for Qudelix 5K USB HID EQ Control

export const qudelixUsbHidHandler = (function () {
  // Command constants based on the provided code
  const REPORT_ID = 0x4b; // Assuming standard HID report ID, adjust if needed

  // Command types (from the 'hy' enum in the original code)
// Update CMD constants to match eAppCmd from Qudelix code
  const CMD = {
    // Request commands
    ReqInitData: 0x0001,
    ReqDevStatus: 0x0002,
    ReqDevConfig: 0x0003,
    ReqEqPreset: 0x0004,
    ReqEqPresetName: 0x0005,
    ReqBattLogData: 0x0006,

    // Set commands
    SetDevConfig: 0x0101,
    SetEqEnable: 0x0102,
    SetEqType: 0x0103,
    SetEqHeadroom: 0x0104,
    SetEqPreGain: 0x0105,
    SetEqGain: 0x0106,
    SetEqFilter: 0x0107,
    SetEqFreq: 0x0108,
    SetEqQ: 0x0109,
    SetEqBandParam: 0x010A,
    SetEqPreset: 0x010B,
    SetEqPreset_L: 0x010C,
    SetEqPreset_H: 0x010D,
    SetEqPresetName: 0x010E,

    // Response commands
    RspInitData: 0x8001,
    RspDevStatus: 0x8002,
    RspDevConfig: 0x8003,
    RspEqPreset: 0x8004,
    RspEqPresetName: 0x8005,
    RspEqPreset_L: 0x8006,
    RspEqPreset_H: 0x8007,

    // Additional commands
    LoadEqPreset: 0x0201,
    SaveEqPreset: 0x0202
  };

  // Filter types (from context of the converter functions)
  const FILTER_TYPES = {
    PK: 0, // Peaking EQ
    LSQ: 1, // Low Shelf
    HSQ: 2, // High Shelf
    LPF: 3, // Low Pass Filter
    HPF: 4, // High Pass Filter
    BPF: 5, // Band Pass Filter
    NOTCH: 6 // Notch Filter
  };

  // Utility functions similar to 'wt' in the original code
  const utils = {
    toInt16: function(value) {
      return (value << 16) >> 16; // Convert to signed 16-bit
    },

    d16: function(array, offset) {
      return (array[offset] << 8) | array[offset + 1];
    },

    msb8: function(value) {
      return (value >> 8) & 0xFF;
    },

    lsb8: function(value) {
      return value & 0xFF;
    },

    toLittleEndianBytes: function(value) {
      return [value >> 8 & 0xFF, value & 0xFF];
    },

    toSignedLittleEndianBytes: function(value) {
      let v = Math.round(value);
      if (v < 0) v += 0x10000; // Convert to unsigned 16-bit
      return [v >> 8 & 0xFF, v & 0xFF];
    }
  };

  // Function to convert filter type strings to Qudelix filter type values
  function mapFilterTypeToQudelix(filterType) {
    switch (filterType) {
      case "PK": return FILTER_TYPES.PK;
      case "LSQ": return FILTER_TYPES.LSQ;
      case "HSQ": return FILTER_TYPES.HSQ;
      case "LPF": return FILTER_TYPES.LPF;
      case "HPF": return FILTER_TYPES.HPF;
      default: return FILTER_TYPES.PK; // Default to PK if unknown
    }
  }

  // Function to convert Qudelix filter type values to filter type strings
  function mapQudelixToFilterType(filterValue) {
    switch (filterValue) {
      case FILTER_TYPES.PK: return "PK";
      case FILTER_TYPES.LSQ: return "LSQ";
      case FILTER_TYPES.HSQ: return "HSQ";
      case FILTER_TYPES.LPF: return "LPF";
      case FILTER_TYPES.HPF: return "HPF";
      case FILTER_TYPES.BPF: return "BPF";
      case FILTER_TYPES.NOTCH: return "NOTCH";
      default: return "PK"; // Default to PK if unknown
    }
  }

  // Get current EQ slot
  async function getCurrentSlot(deviceDetails) {
    try {
      // Request current preset
      const device = deviceDetails.rawDevice;

      // For Qudelix, we'll request the preset information
      // and rely on a response handler to get the current slot
      let currentSlot = 101; // Default to custom slot

      // Here we'd implement a function to query the current preset
      // This is just a placeholder - actual implementation would send the appropriate report
      // and wait for a response

      return currentSlot;
    } catch (error) {
      console.error("Error getting current slot:", error);
      return 101; // Return default slot on error
    }
  }

  // Pull EQ settings from the device
  async function pullFromDevice(deviceDetails, slot) {
    try {
      const device = deviceDetails.rawDevice;
      const maxBands = deviceDetails.modelConfig.maxFilters || 10;

      // First, request the current preset data
      await requestPresetData(device);

      return new Promise((resolve, reject) => {
        let filters = [];
        let globalGain = 0;
        let receivedData = false;

        const responseHandler = function(event) {
          const data = new Uint8Array(event.data.buffer);

          // Check command type from the first 2 bytes
          const cmdType = data[0] << 8 | data[1];

          if (cmdType === CMD.RspEqPreset ||
            cmdType === CMD.RspEqPreset_L ||
            cmdType === CMD.RspEqPreset_H) {
            receivedData = true;

            // Parse EQ preset data according to the format in the original code
            // This is a simplified version - you'll need to adapt based on your exact needs
            let offset = 2; // Skip command bytes

            if (!deviceDetails.isV2) {
              const group = data[offset++];
              const flag = data[offset++];
              // Parse remaining data as in rspPreset function
            } else {
              // For V2 devices, handle as in the V2 section of rspPreset
            }

            // Process the preset data to extract filters
            for (let i = 0; i < maxBands; i++) {
              const filterType = data[offset + 0];
              const freq = utils.d16(data, offset + 1);
              const gain = utils.toInt16(utils.d16(data, offset + 3)) / 10;
              const q = utils.d16(data, offset + 5) / 100;

              filters.push({
                type: mapQudelixToFilterType(filterType),
                freq: freq,
                gain: gain,
                q: q,
                disabled: gain === 0
              });

              offset += 7; // Move to next filter
            }

            // Extract global gain (PreGain)
            globalGain = utils.toInt16(utils.d16(data, offset)) / 10;
          }

          if (receivedData) {
            device.removeEventListener('inputreport', responseHandler);
            resolve({ filters, globalGain });
          }
        };

        device.addEventListener('inputreport', responseHandler);

        // Set timeout
        setTimeout(() => {
          if (!receivedData) {
            device.removeEventListener('inputreport', responseHandler);
            reject(new Error("Timeout waiting for device response"));
          }
        }, 5000);
      });
    } catch (error) {
      console.error("Error pulling EQ from Qudelix:", error);
      return { filters: [], globalGain: 0 };
    }
  }

// Helper function to request preset data
  async function requestPresetData(device) {
    // Send ReqEqPreset command similar to how reqPreset() works in the original code
    const data = new Uint8Array([
      CMD.ReqEqPreset >> 8,
      CMD.ReqEqPreset & 0xFF,
      0x01 // Group mask for usr group - adjust if needed
    ]);

    await device.sendReport(REPORT_ID, data);
  }

  // Push EQ settings to the device
  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    try {
      const device = deviceDetails.rawDevice;
      const isV2 = deviceDetails.isV2 || false;

      // Enable EQ
      await sendCommand(device, CMD.SetEqEnable, [1]);

      // Set PreGain (global gain)
      const gainValue = Math.round(globalGain * 10);
      const gainBytes = utils.toSignedLittleEndianBytes(gainValue);

      if (isV2) {
        // For V2 devices, use the format from v2_sendEqParam16x2
        await sendCommand(device, CMD.SetEqPreGain, [
          gainBytes[0], gainBytes[1], // Left channel
          gainBytes[0], gainBytes[1]  // Right channel (same value)
        ]);
      } else {
        // For non-V2 devices, use the format from sendEqParam
        await sendCommand(device, CMD.SetEqPreGain, [
          0, // Group (usr)
          0x01, // Channel mask for left channel
          0, // Band (unused for preGain)
          gainBytes[0], gainBytes[1]
        ]);
      }

      // Set each filter band
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        if (i >= deviceDetails.modelConfig.maxFilters) break;

        const freqBytes = utils.toLittleEndianBytes(filter.freq);
        const gainBytes = utils.toSignedLittleEndianBytes(filter.gain * 10);
        const qBytes = utils.toLittleEndianBytes(filter.q * 100);
        const filterType = mapFilterTypeToQudelix(filter.type);

        if (isV2) {
          // For V2 devices, use separate commands for each parameter
          const band = i;
          await sendCommand(device, CMD.SetEqFilter, [band, filterType]);
          await sendCommand(device, CMD.SetEqFreq, [band, freqBytes[0], freqBytes[1]]);
          await sendCommand(device, CMD.SetEqGain, [band, gainBytes[0], gainBytes[1]]);
          await sendCommand(device, CMD.SetEqQ, [band, qBytes[0], qBytes[1]]);
        } else {
          // For non-V2 devices, use setBandParam approach
          await sendCommand(device, CMD.SetEqBandParam, [
            0, // Group (usr)
            0x01, // Channel mask for left channel
            i, // Band index
            filterType,
            freqBytes[0], freqBytes[1],
            gainBytes[0], gainBytes[1],
            qBytes[0], qBytes[1]
          ]);
        }
      }

      // Save to preset if needed
      if (slot > 0) {
        await sendCommand(device, CMD.SaveEqPreset, [slot]);
      }

      return true;
    } catch (error) {
      console.error("Error pushing EQ to Qudelix:", error);
      throw error;
    }
  }

// Helper function to send commands with proper formatting
  async function sendCommand(device, cmdType, payload) {
    // Format: [cmdMSB, cmdLSB, ...payload]
    const data = new Uint8Array(2 + payload.length);
    data[0] = cmdType >> 8;
    data[1] = cmdType & 0xFF;
    data.set(payload, 2);

    await device.sendReport(REPORT_ID, data);

    // Add a small delay to avoid overwhelming the device
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  // Helper function to send enable command
  async function sendEnableCommand(device, enable) {
    const data = new Uint8Array([
      CMD.Enable, // command
      enable ? 1 : 0 // value
    ]);
    await device.sendReport(REPORT_ID, data);
  }

  // Helper function to send PreGain command
  async function sendPreGainCommand(device, gainValue) {
    // Convert gain to two int16 values (left and right channel)
    const gainBytes = utils.toSignedLittleEndianBytes(gainValue);

    const data = new Uint8Array([
      CMD.PreGain, // command
      gainBytes[0], gainBytes[1], // left channel
      gainBytes[0], gainBytes[1]  // right channel (same value)
    ]);
    await device.sendReport(REPORT_ID, data);
  }

  // Helper function to send a complete band configuration
  async function sendBandCommand(device, bandIndex, filterType, freq, gain, q) {
    const freqBytes = utils.toLittleEndianBytes(freq);
    const gainBytes = utils.toSignedLittleEndianBytes(gain);
    const qBytes = utils.toLittleEndianBytes(q);

    const data = new Uint8Array([
      CMD.Band, // command
      bandIndex, // band index
      filterType, // filter type
      freqBytes[0], freqBytes[1], // frequency
      gainBytes[0], gainBytes[1], // gain
      qBytes[0], qBytes[1] // Q
    ]);
    await device.sendReport(REPORT_ID, data);
  }

  // Helper function to save to a preset
  async function sendSaveToPresetCommand(device, presetIndex) {
    const data = new Uint8Array([
      CMD.Preset, // command
      presetIndex // preset index
    ]);
    await device.sendReport(REPORT_ID, data);
  }

  // Enable/disable EQ
  async function enablePEQ(deviceDetails, enabled, slotId) {
    const device = deviceDetails.rawDevice;

    // Enable/disable EQ
    await sendEnableCommand(device, enabled);

    // Set preset if enabled and slotId is valid
    if (enabled && slotId > 0) {
      await sendSaveToPresetCommand(device, slotId);
    }
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
