//
// Copyright 2024 : Pragmatic Audio
//
// Define the shared logic for Walkplay devices
//
// Many thanks to ma0shu for providing a dump

const REPORT_ID = 0x4B;  // Report ID
const READ_VALUE = 0x80;  // From capture provided
const WRITE_VALUE = 0x01; //
const END_HEADER = 0x00;
const PEQ_VALUES = 0x09;  // Read or write PEQ - read is current slot / write contains
const RESET_DEVICE = 0x23;
const RESET_EQ_DEFAULT = 0x05;
const FIRMWARE_VERSION = 0x0C;
const TEMP_WRITE = 0x0A;
const FLASH_EQ = 0x01;

// These are probably not suitable for this plugin - but here because ma0shu provided the capture
const ADC_OFFSET = 0x02;
const DAC_OFFSET = 0x03;
const DAC_WORKING_MODE = 0x1D; // 0 ->  "Class-H"  1 ->  "Class-AB"
const ENC_STATUS = 0x1B;  // environment noise cancellation ??  Microphone ??
const FILTER_MODE = 0x11;   // FAST-LL etc
const HIGH_LOW_GAIN = 0x19; // 0 = LOW 1 = HIGH

// Different WalkPlay devices with PEQ and their configurations
const modelConfiguration = {
  "default": {
    minGain: -12,
    maxGain: 12,
    maxFilters: 10,
    firstWritableEQSlot: -1,
    maxWritableEQSlots: 0,
    disconnectOnSave: true,
    disabledPresetId: -1,
    availableSlots: []
  },
  "Hi-MAX": {
    minGain: -12,
    maxGain: 12,
    maxFilters: 10,
    firstWritableEQSlot: -1,
    maxWritableEQSlots: 0,
    disconnectOnSave: true,
    disabledPresetId: -1,
    availableSlots: []
  }
};


export const walkplayUsbHID = (function() {
  let config = {}; // Configuration storage

  // Set configuration dynamically
  const setConfig = (newConfig) => {
    config = newConfig;
    console.log("New configuration applied to walkplayUsbHID:", config);
  };

  // Connect to Walkplay USB-HID device
  const connect = async (device) => {
    try {
      if (!device.opened) {
        await device.open();
      }
      console.log("Walkplay Device connected");
    } catch (error) {
      console.error("Failed to connect to Walkplay Device:", error);
      throw error;
    }
  };

  // Get the currently selected EQ slot
  const getCurrentSlot = async (device) => {
    try {
      let currentSlot = -99;

      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data.length >= 37) {
          currentSlot = data[36]; // Extract current slot from response
          console.log("Current EQ Slot:", currentSlot);
        }
      };

      await sendCommand(device, [READ_VALUE, PEQ_VALUES, END_HEADER]); // Read EQ slot command

      // Wait at most 10 seconds for data
      return await waitForResponse(() => currentSlot > -99, device, 10000, () => currentSlot);
    } catch (error) {
      console.error("Failed to get EQ slot from Walkplay Device:", error);
      throw error;
    }
  };

  // Push PEQ settings to Walkplay device
  const pushToDevice = async (device, slot, preamp_gain, filters) => {
    try {
      console.log("Pushing PEQ settings to Walkplay device...");

      // Iterate through each filter and send update command
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        const bArr = computeIIRFilter(i, filter.freq, filter.gain, filter.q);

        const packet = [
          WRITE_VALUE, PEQ_VALUES, 0x18, i, 0x00, 0x00,
          ...bArr,
          ...convertToByteArray(filter.freq, 2),
          ...convertToByteArray(Math.round(filter.q * 256), 2),
          ...convertToByteArray(Math.round(filter.gain * 256), 2),
          0x02,  // Offset
          slot  // EQ Index
        ];

        await sendCommand(device, packet);
      }

      // Apply EQ settings (temporary until saved)
      await sendCommand(device, [WRITE_VALUE, TEMP_WRITE, 0x04, 0x00, 0x00, 0xFF, 0xFF]);

      // Next we would need to save the values

      console.log("PEQ filters pushed successfully.");
    } catch (error) {
      console.error("Failed to push data to Walkplay Device:", error);
      throw error;
    }
  };

  // Pull PEQ settings from Walkplay device
  const pullFromDevice = async (device, slot) => {
    try {
      let currentSlot = -1;
      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data.length >= 37) {
          currentSlot = data[36]; // Extract current slot
          console.log("Current EQ Slot:", currentSlot);
        }
      };

      await sendCommand(device, [READ_VALUE, PEQ_VALUES, END_HEADER]); // Read EQ slot

      const result = await waitForResponse(() => currentSlot > -1, device, 10000, () => ({
        currentSlot
      }));

      console.log("PEQ data pulled:", result);
      return result;
    } catch (error) {
      console.error("Failed to pull data from Walkplay Device:", error);
      throw error;
    }
  };

  // Enable or disable PEQ by selecting a slot
  const enablePEQ = async (device, enable, slotId) => {
    if (enable) {
      await sendCommand(device, [WRITE_VALUE, FLASH_EQ, 0x00, slotId]); // Save EQ to Flash
    } else {
      await sendCommand(device, [WRITE_VALUE, RESET_EQ_DEFAULT, 0x01, 0x04]); // Reset EQ to Default
    }
  };


  return {
    setConfig,  // Allow top-level configuration injection
    connect,
    pushToDevice,
    pullFromDevice,
    getCurrentSlot,
    getModelConfig,
    enablePEQ,
  };
})();

function getModelConfig(device) {
  const configuration = modelConfiguration[device.productName];
  return configuration || modelConfiguration["default"];
}
// **Helper Functions**

// Send command to device
async function sendCommand(device, packet) {
  const data = new Uint8Array(packet);
  console.log("Sending command:", data);
  const reportId = REPORT_ID;
  await device.sendReport(reportId, data);
}

// Compute IIR filter for Walkplay PEQ
function computeIIRFilter(i, freq, gain, q) {
  let bArr = new Array(20).fill(0);
  let sqrt = Math.sqrt(Math.pow(10, gain / 20));
  let d3 = (freq * 6.283185307179586) / 96000;
  let sin = Math.sin(d3) / (2 * q);
  let d4 = sin * sqrt;
  let d5 = sin / sqrt;
  let d6 = d5 + 1;
  let quantizerData = quantizer(
    [1, (Math.cos(d3) * -2) / d6, (1 - d5) / d6],
    [(d4 + 1) / d6, (Math.cos(d3) * -2) / d6, (1 - d4) / d6]
  );

  let index = 0;
  for (let value of quantizerData) {
    bArr[index] = value & 0xFF;
    bArr[index + 1] = (value >> 8) & 0xFF;
    bArr[index + 2] = (value >> 16) & 0xFF;
    bArr[index + 3] = (value >> 24) & 0xFF;
    index += 4;
  }

  return bArr;
}

// Convert values to byte array
function convertToByteArray(value, length) {
  let arr = [];
  for (let i = 0; i < length; i++) {
    arr.push((value >> (8 * i)) & 0xFF);
  }
  return arr;
}

// Quantizer function for IIR filter
function quantizer(dArr, dArr2) {
  let iArr = dArr.map(d => Math.round(d * 1073741824));
  let iArr2 = dArr2.map(d => Math.round(d * 1073741824));
  return [iArr2[0], iArr2[1], iArr2[2], -iArr[1], -iArr[2]];
}

// Wait for a response based on a condition
function waitForResponse(condition, device, timeout, callback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!condition()) {
        console.warn("Timeout reached before data returned?");
        reject(callback(device));
      } else {
        resolve(callback(device));
      }
    }, timeout);

    const interval = setInterval(() => {
      if (condition()) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(callback(device));
      }
    }, 100);
  });
}
