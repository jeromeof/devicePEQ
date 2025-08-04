// qudelixUsbHidHandler.js
// Pragmatic Audio - Handler for Qudelix 5K USB HID EQ Control

export const qudelixUsbHidHandler = (function () {
  // HID Report IDs from Qudelix protocol
  const HID_REPORT_ID = {
    DATA_TRANSFER: 1,
    RESPONSE: 2,
    COMMAND: 3,
    CONTROL: 4,
    UPGRADE_DATA_TRANSFER: 5,
    UPGRADE_RESPONSE: 6,
    QX_OUT: 7,
    QX_HOST_TO_DEVICE: 8,
    QX_DEVICE_TO_HOST: 9
  };

  // Qudelix EQ filter types
  const FILTER_TYPES = {
    BYPASS: 0,
    LPF: 7,     // 2nd order LPF
    HPF: 8,     // 2nd order HPF
    PEQ: 13,    // Parametric EQ
    LS: 10,     // 2nd order Low Shelf
    HS: 11      // 2nd order High Shelf
  };

  // HID communication state
  let hidReportInfo = [];
  let sendReportId = 0;
  let sendReportSize = 0;

  // App command definitions from qxApp_proto.ts
  const APP_CMD = {
    // Request commands
    ReqDevConfig: 0x0003,
    ReqEqPreset: 0x0004,
    ReqEqPresetName: 0x0005,

    // Set commands
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
    SetEqPresetName: 0x010E,

    // Additional commands
    SaveEqPreset: 0x0202
  };

  // Notification types from Qudelix app
  const NOTIFY_EQ = {
    Enable: 0x01,
    Type: 0x02,
    Headroom: 0x03,
    PreGain: 0x04,
    Gain: 0x05,
    Q: 0x06,
    Filter: 0x07,
    Freq: 0x08,
    Preset: 0x09,
    PresetName: 0x0A,
    Mode: 0x0B,
    ReceiverInfo: 0x0C,
    Band: 0x0D
  };

  // Utility functions
  const utils = {
    // Convert to signed 16-bit integer
    toInt16: function(value) {
      return (value << 16) >> 16;
    },

    // Extract 16-bit value from array at offset
    d16: function(array, offset) {
      return (array[offset] << 8) | array[offset + 1];
    },

    // Get MSB of value
    msb8: function(value) {
      return (value >> 8) & 0xFF;
    },

    // Get LSB of value
    lsb8: function(value) {
      return value & 0xFF;
    },

    // Convert value to little-endian bytes
    toLittleEndianBytes: function(value) {
      return [this.msb8(value), this.lsb8(value)];
    },

    // Convert to signed little-endian bytes with scaling
    toSignedLittleEndianBytes: function(value, scale = 1) {
      let v = Math.round(value * scale);
      if (v < 0) v += 0x10000; // Convert to unsigned 16-bit
      return [this.msb8(v), this.lsb8(v)];
    }
  };

  // Initialize HID report information (similar to AppUsbHid.init_reportInfo)
  function initHidReports(device) {
    hidReportInfo = [];
    const collections = device.collections;
    
    if (collections?.length) {
      collections.forEach((info) => {
        if (info.usagePage === 0xFF00) { // Vendor specification
          // Process feature reports
          info.featureReports?.forEach((report) => {
            const reportId = report.reportId;
            const reportSize = report.items?.[0]?.reportCount || 0;
            hidReportInfo.push({ type: 'feature', id: reportId, size: reportSize });
          });
          
          // Process input reports
          info.inputReports?.forEach((report) => {
            const reportId = report.reportId;
            const reportSize = report.items?.[0]?.reportCount || 0;
            hidReportInfo.push({ type: 'in', id: reportId, size: reportSize });
          });
          
          // Process output reports
          info.outputReports?.forEach((report) => {
            const reportId = report.reportId;
            const reportSize = report.items?.[0]?.reportCount || 0;
            hidReportInfo.push({ type: 'out', id: reportId, size: reportSize });
          });
        }
      });
    }
    
    // Find the best report ID for sending (try qx_hostToDevice first, fallback to qx_out)
    sendReportId = HID_REPORT_ID.QX_HOST_TO_DEVICE;
    sendReportSize = getReportSize(sendReportId);
    
    if (sendReportSize === 0) {
      sendReportId = HID_REPORT_ID.QX_OUT;
      sendReportSize = getReportSize(sendReportId);
    }
    
    console.log(`Qudelix HID: Using report ID ${sendReportId}, size ${sendReportSize}`);
  }
  
  // Get report size for a given ID
  function getReportSize(reportId) {
    const report = hidReportInfo.find(r => r.id === reportId);
    return report?.size || 0;
  }

  // Map filter type from our PEQ format to Qudelix format
  function mapFilterTypeToQudelix(filterType) {
    switch (filterType) {
      case "PK": return FILTER_TYPES.PEQ;
      case "LSQ": return FILTER_TYPES.LS;
      case "HSQ": return FILTER_TYPES.HS;
      case "LPF": return FILTER_TYPES.LPF;
      case "HPF": return FILTER_TYPES.HPF;
      default: return FILTER_TYPES.PEQ;
    }
  }

  // Map Qudelix filter type to our PEQ format
  function mapQudelixToFilterType(filterValue) {
    switch (filterValue) {
      case FILTER_TYPES.PEQ: return "PK";
      case FILTER_TYPES.LS: return "LSQ";
      case FILTER_TYPES.HS: return "HSQ";
      case FILTER_TYPES.LPF: return "LPF";
      case FILTER_TYPES.HPF: return "HPF";
      default: return "PK";
    }
  }

  // Get current EQ slot
  async function getCurrentSlot(deviceDetails) {
    try {
      // For Qudelix 5K, usually slot 101 is the main custom slot
      return 101;
    } catch (error) {
      console.error("Error getting current Qudelix EQ slot:", error);
      return 101; // Return default slot on error
    }
  }

  // Send HID command using proper Qudelix protocol
  async function sendCommand(device, cmdType, payload = []) {
    const cmdPayload = new Uint8Array(2 + payload.length);
    cmdPayload[0] = utils.msb8(cmdType);
    cmdPayload[1] = utils.lsb8(cmdType);
    
    for (let i = 0; i < payload.length; i++) {
      cmdPayload[i + 2] = payload[i];
    }
    
    // Create HID packet: length + 0x80 command + payload
    const packet = new Uint8Array(sendReportSize);
    packet.fill(0);
    
    packet[0] = cmdPayload.length + 1; // HID command + payload length
    packet[1] = 0x80; // HID command
    packet.set(cmdPayload, 2);
    
    console.log(`Qudelix USB: Sending command 0x${cmdType.toString(16).padStart(4, '0')}:`, [...packet].map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    await device.sendReport(sendReportId, packet);
    
    // Add a small delay to avoid overwhelming the device
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  // Pull EQ settings from the device
  async function pullFromDevice(deviceDetails, slot) {
    const device = deviceDetails.rawDevice;
    const maxBands = deviceDetails.modelConfig.maxFilters || 10;
    const filters = [];

    try {
      // Initialize HID reports if not done already
      if (hidReportInfo.length === 0) {
        initHidReports(device);
      }

      // First, request the current preset data
      await requestPresetData(device);

      return new Promise((resolve, reject) => {
        let receivedData = false;
        let preGain = 0;
        let timeout = null;

        const responseHandler = function(event) {
          const reportId = event.reportId;
          const data = new Uint8Array(event.data.buffer);

          console.log(`Qudelix USB: Received report ID ${reportId}, length ${data.length}`);

          // Check if this is a response report (ID 2 or 9)
          if (reportId === HID_REPORT_ID.RESPONSE || reportId === HID_REPORT_ID.QX_DEVICE_TO_HOST) {
            // Parse HID packet: length + command + data
            if (data.length < 3) return;
            
            const len = data[0]; // Length of command + data
            const cmdType = (data[1] << 8) | data[2]; // Command type
            const cmdData = data.slice(3, len + 1); // Command data
            
            console.log(`Qudelix USB: Received command 0x${cmdType.toString(16).padStart(4, '0')}, data length: ${cmdData.length}`);

            // Look for EQ preset data responses
            if (cmdType === 0x8004 || // RspEqPreset
                cmdType === 0x8006 || // RspEqPreset_L
                cmdType === 0x8007) { // RspEqPreset_H

              receivedData = true;

              // Parse EQ data from cmdData
              let offset = 0;

              // Parse global pre-gain and bands
              for (let i = 0; i < maxBands && offset + 6 < cmdData.length; i++) {
                // Extract filter parameters
                const filterType = cmdData[offset++];
                const freqBytes = [cmdData[offset++], cmdData[offset++]];
                const gainBytes = [cmdData[offset++], cmdData[offset++]];
                const qBytes = [cmdData[offset++], cmdData[offset++]];

                const freq = (freqBytes[0] << 8) | freqBytes[1];
                const gainRaw = (gainBytes[0] << 8) | gainBytes[1];
                const gain = utils.toInt16(gainRaw) / 10; // Scale by 10
                const q = ((qBytes[0] << 8) | qBytes[1]) / 100; // Scale by 100

                // Skip empty/unused bands
                if (freq === 0 && gain === 0 && q === 0) continue;

                filters.push({
                  type: mapQudelixToFilterType(filterType),
                  freq: freq,
                  gain: gain,
                  q: q,
                  disabled: false
                });
              }

              // Extract PreGain if available
              if (offset + 2 <= cmdData.length) {
                const preGainRaw = (cmdData[offset] << 8) | cmdData[offset + 1];
                preGain = utils.toInt16(preGainRaw) / 10;
              }

              // Clean up and resolve
              if (timeout) clearTimeout(timeout);
              device.removeEventListener('inputreport', responseHandler);
              resolve({ filters, globalGain: preGain });
            }
          }
        };

        // Setup timeout
        timeout = setTimeout(() => {
          device.removeEventListener('inputreport', responseHandler);
          if (!receivedData) {
            reject(new Error("Timeout waiting for device response"));
          } else {
            resolve({ filters, globalGain: preGain });
          }
        }, 5000);

        // Add the event listener
        device.addEventListener('inputreport', responseHandler);
      });

    } catch (error) {
      console.error("Error pulling EQ from Qudelix:", error);
      return { filters: [], globalGain: 0 };
    }
  }

  // Helper function to request preset data
  async function requestPresetData(device) {
    // Request the current EQ preset (similar to ReqEqPreset in TS code)
    await sendCommand(device, APP_CMD.ReqEqPreset, [0x01]); // Request user preset
  }

  // Push EQ settings to the device
  async function pushToDevice(deviceDetails, slot, preamp, filters) {
    const device = deviceDetails.rawDevice;

    try {
      // Initialize HID reports if not done already
      if (hidReportInfo.length === 0) {
        initHidReports(device);
      }

      // Step 1: Enable EQ
      await sendCommand(device, APP_CMD.SetEqEnable, [1]);

      // Step 2: Set PreGain (global gain)
      const preGainScaled = Math.round(preamp * 10); // Scale by 10
      const preGainBytes = utils.toSignedLittleEndianBytes(preGainScaled);

      // Set the same value for both channels
      await sendCommand(device, APP_CMD.SetEqPreGain, [
        preGainBytes[0], preGainBytes[1], // Left channel
        preGainBytes[0], preGainBytes[1]  // Right channel (same value)
      ]);

      // Step 3: Set each filter band
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        if (i >= deviceDetails.modelConfig.maxFilters) break;

        if (filter.disabled) continue;

        const filterType = mapFilterTypeToQudelix(filter.type);
        const freqScaled = Math.round(filter.freq);
        const gainScaled = Math.round(filter.gain * 10);
        const qScaled = Math.round(filter.q * 100);

        const freqBytes = utils.toLittleEndianBytes(freqScaled);
        const gainBytes = utils.toSignedLittleEndianBytes(gainScaled);
        const qBytes = utils.toLittleEndianBytes(qScaled);

        // Set filter parameters one by one
        await sendCommand(device, APP_CMD.SetEqFilter, [i, filterType]);
        await sendCommand(device, APP_CMD.SetEqFreq, [i, freqBytes[0], freqBytes[1]]);
        await sendCommand(device, APP_CMD.SetEqGain, [i, gainBytes[0], gainBytes[1]]);
        await sendCommand(device, APP_CMD.SetEqQ, [i, qBytes[0], qBytes[1]]);
      }

      // Step 4: Save to preset
      if (slot > 0) {
        await sendCommand(device, APP_CMD.SaveEqPreset, [slot]);
      }

      return false; // Generally no need to disconnect for Qudelix
    } catch (error) {
      console.error("Error pushing EQ to Qudelix:", error);
      throw error;
    }
  }

  // Enable/disable EQ
  async function enablePEQ(deviceDetails, enabled, slotId) {
    try {
      const device = deviceDetails.rawDevice;
      
      // Initialize HID reports if not done already
      if (hidReportInfo.length === 0) {
        initHidReports(device);
      }

      // Enable/disable EQ
      await sendCommand(device, APP_CMD.SetEqEnable, [enabled ? 1 : 0]);

      // If enabled and a valid slot ID is provided, switch to that preset
      if (enabled && slotId > 0) {
        await sendCommand(device, APP_CMD.SetEqPreset, [slotId]);
      }
    } catch (error) {
      console.error("Error setting Qudelix EQ state:", error);
    }
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
