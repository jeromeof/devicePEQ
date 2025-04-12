// qudelixUsbHidHandler.js
// Pragmatic Audio - Handler for Qudelix 5K USB HID EQ Control

export const qudelixUsbHidHandler = (function () {
  // Command constants based on the provided code
  const REPORT_ID = 0x4b; // Assuming standard HID report ID, adjust if needed

  // Command types (from the 'hy' enum in the original code)
  const CMD = {
    Enable: 0x01,
    Headroom: 0x02,
    Preset: 0x03,
    Type: 0x04,
    Mode: 0x05,
    PreGain: 0x06,
    Gain: 0x07,
    Q: 0x08,
    Filter: 0x09,
    Freq: 0x0A,
    PresetName: 0x0B,
    ReceiverInfo: 0x0C,
    Band: 0x0D
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
      return (value << 16) >> 16;
    },

    d16: function(array, offset) {
      const n = (255 & array[offset]) << 8;
      return (n | (255 & array[offset + 1])) & 0xFFFF;
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
      const filters = [];
      const maxBands = deviceDetails.modelConfig.maxFilters || 10; // Default to 10 bands if not specified
      let globalGain = 0;

      // This would be a Promise that builds up the filters array
      // by listening for device responses from our queries

      return new Promise((resolve, reject) => {
        // Set up a handler for device responses
        const responseHandler = function(event) {
          const data = new Uint8Array(event.data.buffer);
          // Process data based on what we know about the Qudelix protocol
          // For each band, we'd expect to receive type, freq, gain, and Q

          // Example processing based on the code you provided:
          if (data.length > 1) {
            const cmdType = data[0];

            switch (cmdType) {
              case CMD.Band:
                const bandIndex = data[1];
                const filterType = data[2];
                const freq = utils.d16(data, 3);
                const gain = utils.toInt16(utils.d16(data, 5));
                const q = utils.d16(data, 7) / 100; // Assuming Q is stored multiplied by 100

                filters[bandIndex] = {
                  type: mapQudelixToFilterType(filterType),
                  freq: freq,
                  gain: gain / 10, // Assuming gain is stored as dB * 10
                  q: q,
                  disabled: gain === 0 // Disable if gain is 0
                };
                break;

              case CMD.PreGain:
                // Extract pre-gain (global gain) values
                const leftGain = utils.toInt16(utils.d16(data, 1));
                const rightGain = utils.toInt16(utils.d16(data, 3));
                // Use the average as the global gain
                globalGain = (leftGain + rightGain) / 20; // Assuming gain is stored as dB * 10
                break;
            }
          }

          // Check if we've received all the data we need
          if (filters.length === maxBands && globalGain !== undefined) {
            device.removeEventListener('inputreport', responseHandler);
            resolve({ filters, globalGain });
          }
        };

        // Set up the event listener for receiving data
        device.addEventListener('inputreport', responseHandler);

        // Query for all the bands and PreGain
        // This is where you'd send the appropriate HID reports to request the data

        // Set a timeout to prevent hanging if we don't receive all the expected data
        setTimeout(() => {
          device.removeEventListener('inputreport', responseHandler);
          // If we have some filters but not all, return what we have
          if (filters.length > 0) {
            resolve({ filters, globalGain });
          } else {
            reject(new Error("Timeout waiting for device response"));
          }
        }, 5000);

        // TODO: Send the actual queries to the device
        // This would involve sending multiple HID reports to request each band's settings
      });
    } catch (error) {
      console.error("Error pulling EQ from Qudelix:", error);
      return { filters: [], globalGain: 0 };
    }
  }

  // Push EQ settings to the device
  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    try {
      const device = deviceDetails.rawDevice;

      // First, enable EQ
      await sendEnableCommand(device, true);

      // Set global gain (PreGain)
      await sendPreGainCommand(device, globalGain * 10);

      // Send each filter band
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        if (i >= deviceDetails.modelConfig.maxFilters) break;

        // We'll use the Band command to set all parameters at once
        await sendBandCommand(
          device,
          i, // band index
          mapFilterTypeToQudelix(filter.type),
          filter.freq,
          filter.gain * 10, // Convert to device format (dB * 10)
          filter.q * 100 // Convert to device format (Q * 100)
        );
      }

      // Save to preset if needed
      if (slot > 0) {
        await sendSaveToPresetCommand(device, slot);
      }

      return deviceDetails.modelConfig.disconnectOnSave || false;
    } catch (error) {
      console.error("Error pushing EQ to Qudelix:", error);
      throw error;
    }
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
