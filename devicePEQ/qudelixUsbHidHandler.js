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
    // Basic commands
    ReqInitData: 0x0001,
    
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
    
    console.log('Qudelix HID: Initializing reports from collections:', collections);
    console.log('Qudelix HID: Total collections found:', collections?.length);
    
    // Debug all collections first
    if (collections?.length) {
      collections.forEach((info, collectionIndex) => {
        console.log(`Collection ${collectionIndex}:`);
        console.log(`  usagePage: 0x${info.usagePage?.toString(16)}`);
        console.log(`  usage: 0x${info.usage?.toString(16)}`);
        console.log(`  featureReports: ${info.featureReports?.length || 0}`);
        console.log(`  inputReports: ${info.inputReports?.length || 0}`);
        console.log(`  outputReports: ${info.outputReports?.length || 0}`);
      });
    }
    
    if (collections?.length) {
      collections.forEach((info, collectionIndex) => {
        console.log(`Processing collection ${collectionIndex}: usagePage=0x${info.usagePage?.toString(16)}`);
        
        // Only process vendor-defined collections (0xFF00)
        if (info.usagePage !== 0xFF00) {
          console.log(`Skipping collection ${collectionIndex} - not vendor-defined (0xFF00)`);
          return;
        }
        // Process feature reports
        info.featureReports?.forEach((report) => {
          const reportId = report.reportId;
          const reportSize = report.items?.[0]?.reportCount || 64; // Default to 64 if not specified
          hidReportInfo.push({ type: 'feature', id: reportId, size: reportSize });
          console.log(`Found feature report: ID=${reportId}, size=${reportSize}`);
        });
        
        // Process input reports
        info.inputReports?.forEach((report) => {
          const reportId = report.reportId;
          const reportSize = report.items?.[0]?.reportCount || 64;
          hidReportInfo.push({ type: 'in', id: reportId, size: reportSize });
          console.log(`Found input report: ID=${reportId}, size=${reportSize}`);
        });
        
        // Process output reports
        info.outputReports?.forEach((report) => {
          const reportId = report.reportId;
          const reportSize = report.items?.[0]?.reportCount || 64;
          hidReportInfo.push({ type: 'out', id: reportId, size: reportSize });
          console.log(`Found output report: ID=${reportId}, size=${reportSize}`);
        });
      });
    }
    
    console.log('Qudelix HID: All found reports:', hidReportInfo);
    
    // Find the best report ID for sending (try qx_hostToDevice first, fallback to qx_out)
    sendReportId = HID_REPORT_ID.QX_HOST_TO_DEVICE;
    sendReportSize = getReportSize(sendReportId);
    
    if (sendReportSize === 0) {
      sendReportId = HID_REPORT_ID.QX_OUT;
      sendReportSize = getReportSize(sendReportId);
    }
    
    // If still no size found, use the first available output report
    if (sendReportSize === 0) {
      const firstOutputReport = hidReportInfo.find(r => r.type === 'out');
      if (firstOutputReport) {
        sendReportId = firstOutputReport.id;
        sendReportSize = firstOutputReport.size;
        console.log(`Qudelix HID: Using first available output report: ID=${sendReportId}, size=${sendReportSize}`);
      } else {
        // Last resort: use a reasonable default
        sendReportId = 7;
        sendReportSize = 64;
        console.log(`Qudelix HID: No reports found, using defaults: ID=${sendReportId}, size=${sendReportSize}`);
      }
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

  // Send command using Qudelix protocol (matches Qudelix.command.send)
  async function sendCommand(device, cmdType, payload = []) {
    // Create command packet: [cmdMSB, cmdLSB, ...payload]
    const cmdPayload = new Uint8Array(2 + payload.length);
    cmdPayload[0] = utils.msb8(cmdType);
    cmdPayload[1] = utils.lsb8(cmdType);
    
    for (let i = 0; i < payload.length; i++) {
      cmdPayload[i + 2] = payload[i];
    }
    
    console.log(`Qudelix USB: Sending command 0x${cmdType.toString(16).padStart(4, '0')}:`, [...cmdPayload].map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Send via the HID send_cmd method (this will add the HID packet wrapper)
    await sendHidCommand(device, cmdPayload);
    
    // Add a small delay to avoid overwhelming the device
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  // Send HID command with proper packet wrapping (matches AppUsbHid.send_cmd)
  async function sendHidCommand(device, payload) {
    // Create HID packet: length + 0x80 + payload
    const packet = new Uint8Array(sendReportSize);
    packet.fill(0);
    
    // The length field should be: command (1 byte) + payload length
    packet[0] = payload.length + 1; // 0x80 command + payload
    packet[1] = 0x80; // HID command identifier
    packet.set(payload, 2); // Copy payload starting at index 2
    
    console.log(`Qudelix HID: Sending packet (len=${packet[0]}, cmd=0x${packet[1].toString(16)}):`, [...packet.slice(0, packet[0] + 1)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    await device.sendReport(sendReportId, packet);
  }

  // Pull EQ settings from the device
  async function pullFromDevice(deviceDetails, slot) {
    const device = deviceDetails.rawDevice;
    const maxBands = deviceDetails.modelConfig.maxFilters || 10;
    const filters = [];

    try {
      // Debug: Show device info
      console.log('Qudelix USB: Device info:', {
        productName: device.productName,
        vendorId: '0x' + device.vendorId.toString(16),
        productId: '0x' + device.productId.toString(16),
        collectionsCount: device.collections?.length
      });

      // Initialize HID reports if not done already
      if (hidReportInfo.length === 0) {
        initHidReports(device);
      }

      // If we don't have the vendor-defined interface, this is the wrong device interface
      if (hidReportInfo.length === 0) {
        console.error('Qudelix USB: WRONG INTERFACE! This appears to be the consumer control interface.');
        console.error('Qudelix USB: You need to select the vendor-defined HID interface when connecting.');
        console.error('Qudelix USB: Look for the interface with usagePage=0xFF00 in the browser device picker.');
        
        return { 
          filters: [], 
          globalGain: 0, 
          error: 'Wrong HID interface selected. Please reconnect and choose the vendor-defined interface.' 
        };
      }

      // First, let's just listen for any data the device might be sending
      console.log('Qudelix USB: Setting up listeners to detect any device activity...');
      
      // Try a very simple approach - just listen for any input reports for 2 seconds
      return new Promise((resolve, reject) => {
        let timeout = null;
        let anyDataReceived = false;
        
        const universalHandler = function(event) {
          anyDataReceived = true;
          const reportId = event.reportId;
          const data = new Uint8Array(event.data.buffer);
          
          console.log(`Qudelix USB: DETECTED DATA! Report ID ${reportId}, length ${data.length}, data:`, [...data].map(b => b.toString(16).padStart(2, '0')).join(' '));
          
          // Try to parse any data we receive
          if (data.length > 2) {
            const cmd = (data[0] << 8) | data[1];
            console.log(`Qudelix USB: Possible command response: 0x${cmd.toString(16).padStart(4, '0')}`);
          }
        };
        
        device.addEventListener('inputreport', universalHandler);
        
        // Set a shorter timeout to see if device sends anything spontaneously
        timeout = setTimeout(() => {
          device.removeEventListener('inputreport', universalHandler);
          
          if (anyDataReceived) {
            console.log('Qudelix USB: Device is sending data! Check logs above.');
            resolve({ filters: [], globalGain: 0, message: 'Device communicating but need to decode protocol' });
          } else {
            console.log('Qudelix USB: No data received. Trying to send initialization commands...');
            // If no spontaneous data, try sending commands
            tryInitialization(device, resolve, reject);
          }
        }, 2000); // Wait 2 seconds for any spontaneous data
      });

    } catch (error) {
      console.error("Error pulling EQ from Qudelix:", error);
      return { filters: [], globalGain: 0 };
    }
  }

  // Try initialization commands if no spontaneous data
  async function tryInitialization(device, resolve, reject) {
    console.log('Qudelix USB: Trying initialization sequence...');
    
    try {
      let timeout = null;
      let receivedData = false;
      const filters = [];
      let preGain = 0;

      const responseHandler = function(event) {
        receivedData = true;
        const reportId = event.reportId;
        const data = new Uint8Array(event.data.buffer);

        console.log(`Qudelix USB: Response received! Report ID ${reportId}, length ${data.length}, data:`, [...data].map(b => b.toString(16).padStart(2, '0')).join(' '));

        // Try to parse as HID packet format
        if (data.length >= 3) {
          const len = data[0];
          const cmd = (data[1] << 8) | data[2];
          console.log(`Qudelix USB: HID packet - len=${len}, cmd=0x${cmd.toString(16).padStart(4, '0')}`);
        }

        // For now, just return success if we get any response
        if (timeout) clearTimeout(timeout);
        device.removeEventListener('inputreport', responseHandler);
        resolve({ 
          filters, 
          globalGain: preGain, 
          message: `Got response on report ID ${reportId}` 
        });
      };

      device.addEventListener('inputreport', responseHandler);

      // Try different communication methods
      await testCommunication(device);

      // Set timeout
      timeout = setTimeout(() => {
        device.removeEventListener('inputreport', responseHandler);
        if (receivedData) {
          resolve({ filters, globalGain: preGain });
        } else {
          reject(new Error("No response from device after initialization"));
        }
      }, 3000);

    } catch (error) {
      reject(error);
    }
  }

  // Test different communication approaches
  async function testCommunication(device) {
    console.log('Qudelix USB: Testing different packet formats...');
    
    // Test 1: Try direct ReqDevConfig with HID wrapper
    console.log('Qudelix USB: Test 1 - ReqDevConfig with HID wrapper');
    await sendCommand(device, APP_CMD.ReqDevConfig, []);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test 2: Try raw packet without 0x80 wrapper
    console.log('Qudelix USB: Test 2 - Raw ReqDevConfig packet');
    const rawPacket = new Uint8Array(sendReportSize);
    rawPacket.fill(0);
    rawPacket[0] = 0x00; // MSB of ReqDevConfig (0x0003)
    rawPacket[1] = 0x03; // LSB of ReqDevConfig
    console.log(`Qudelix USB: Sending raw packet:`, [...rawPacket.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    await device.sendReport(sendReportId, rawPacket);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test 3: Try different report ID (7)
    if (sendReportId !== 7) {
      console.log('Qudelix USB: Test 3 - Trying report ID 7');
      const packet7 = new Uint8Array(64); // Assume size 64 for report 7
      packet7.fill(0);
      packet7[0] = 0x00;
      packet7[1] = 0x03;
      console.log(`Qudelix USB: Sending on report ID 7:`, [...packet7.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '));
      await device.sendReport(7, packet7);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Test 4: Try feature reports (might be needed for initialization)
    console.log('Qudelix USB: Test 4 - Trying feature report ID 4');
    try {
      const featurePacket = new Uint8Array(3); // Feature report ID 4, size 3
      featurePacket[0] = 0x00;
      featurePacket[1] = 0x03;
      featurePacket[2] = 0x00;
      console.log(`Qudelix USB: Sending feature report:`, [...featurePacket].map(b => b.toString(16).padStart(2, '0')).join(' '));
      await device.sendFeatureReport(4, featurePacket);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.log('Qudelix USB: Feature report failed:', error.message);
    }
    
    // Test 5: Try a simple "ping" or status request
    console.log('Qudelix USB: Test 5 - Simple status request on report ID 1');
    const statusPacket = new Uint8Array(65); // Report ID 1, size 65
    statusPacket.fill(0);
    statusPacket[0] = 0x00; // Simple status request
    statusPacket[1] = 0x01;
    console.log(`Qudelix USB: Sending status request:`, [...statusPacket.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    await device.sendReport(1, statusPacket);
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
