//
// Copyright 2024 : Pragmatic Audio
//
// Define the shared logic for Walkplay devices
//
// Many thanks to ma0shu for providing a dump

const REPORT_ID = 0x4B;  // Report ID
const ALT_REPORT_ID = 0x3C;  // Alternative Report ID
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
    availableSlots: [{id: -99, name: "Default"}]
  },
  "Hi-MAX": {
    minGain: -12,
    maxGain: 12,
    maxFilters: 8,
    firstWritableEQSlot: -1,
    maxWritableEQSlots: 0,
    disconnectOnSave: false,
    disabledPresetId: -1,
    availableSlots: [{id: 101, name: "Custom"},{id: 102, name: "Custom 2"},{id: 103, name: "Custom 3"},{id: 104, name: "Custom 4"},{id: 1, name: "Pure"},{id: 2, name: "Pop"},{id: 3, name: "Rock"},{id: 4, name: "Vocal"},{id: 5, name: "Bass"},{id: 6, name: "Flat"},{id: 7, name: "Cinema"},{id: 8, name: "Game"},{id: -99, name: "Default"}]
  },
  "Quark2": {
    minGain: -12,
    maxGain: 12,
    maxFilters: 8,
    firstWritableEQSlot: -1,
    maxWritableEQSlots: 0,
    disconnectOnSave: false,
    disabledPresetId: -1,
    availableSlots: [{id: 101, name: "Custom"},{id: 102, name: "Custom 2"},{id: 103, name: "Custom 3"},{id: 104, name: "Custom 4"},{id: 1, name: "Pure"},{id: 2, name: "Pop"},{id: 3, name: "Rock"},{id: 4, name: "Vocal"},{id: 5, name: "Bass"},{id: 6, name: "Flat"},{id: 7, name: "Cinema"},{id: 8, name: "Game"},{id: -99, name: "Default"}]
  }
};


export const walkplayUsbHID = (function() {
  let device = null;
  let config = {}; // Configuration storage

  // Set configuration dynamically
  const setConfig = (newConfig) => {
    config = newConfig;
    console.log("New configuration applied:", config);
  };

  // Connect to Walkplay USB-HID device
  const connect = async (hidDevice) => {
    try {
      device = hidDevice || (await navigator.hid.requestDevice({ filters: [] }))[0];
      if (!device) throw new Error("No HID device selected.");
      if (!device.opened) await device.open();
      console.log("Walkplay Device connected.");
    } catch (error) {
      console.error("Failed to connect:", error);
      throw error;
    }
  };

  // Get the currently selected EQ slot
  const getCurrentSlot = async () => {
    if (!device) throw new Error("Device not connected.");
    console.log("Fetching current EQ slot...");

    await sendReport(REPORT_ID,[READ_VALUE, PEQ_VALUES, END_HEADER]);
    const response = await waitForResponse();
    const slot = response ? response[35] : -1;

    console.log("Current EQ Slot:", slot);
    return slot;
  };

  // Push PEQ settings to Walkplay device
  const pushToDevice = async (device, slot, preampGain, filters) => {
    if (!device) throw new Error("Device not connected.");
    console.log("Pushing PEQ settings...");
    if (typeof slot === "string" )  // Convert from string
      slot = parseInt(slot, 10);

    var useAltReport = false;

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const bArr = computeIIRFilter(i, filter.freq, filter.gain, filter.q);

      const packet = [
        WRITE_VALUE, PEQ_VALUES, 0x18, 0x00, i, 0x00, 0x00,
        ...bArr,
        ...convertToByteArray(filter.freq, 2),
        ...convertToByteArray(Math.round(filter.q * 256), 2),
        ...convertToByteArray(Math.round(filter.gain * 256), 2),
        0x02,
        0x0,
        slot,
        END_HEADER
      ];
      console.log("Write HID data:", packet);

      await sendReport(useAltReport ? ALT_REPORT_ID : REPORT_ID ,packet);
    }

    // Apply EQ settings temporarily
    await sendReport(REPORT_ID,[WRITE_VALUE, TEMP_WRITE, 0x04, 0x00, 0x00, 0xFF, 0xFF,END_HEADER]);

    // Apply EQ settings temporarily
    await sendReport(REPORT_ID,[WRITE_VALUE, FLASH_EQ, 0x01, END_HEADER]);

    console.log("PEQ filters pushed successfully.");
  };

  // Pull PEQ settings from Walkplay device
  const pullFromDevice = async (device, slot = DEFAULT_EQ_SLOT) => {
    try {
      if (!device) throw new Error("Device not connected.");
      console.log("Pulling PEQ settings...");

      const filters = [];
      let globalGain = 0;
      let currentSlot = -1;
      const expectedFilters = 8; // WalkPlay has 8 filters

      // Set up event listener to process incoming data
      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log("Received HID response:", data);

        // Extract filter data if it's a valid response
        if (data.length >= 32) {
          let filter = parseIndividualPEQPacket(data);
            filters[filter.filterIndex] = filter; // Store at correct index
        }

        // Extract global gain if available
        if (data.length > 40) {
          globalGain = parseGlobalGain(data);
        }

        // Extract EQ slot
        if (data.length >= 37) {
          currentSlot = data[36];
        }
      };

      // Request each filter (0-7) individually
      for (let i = 0; i < expectedFilters; i++) {
        await sendReport(REPORT_ID,[READ_VALUE, PEQ_VALUES, 0x00, 0x00, i, END_HEADER]);  // Read filter `i`
        await delay(50);  // Give time for each request to be processed
      }

      // Wait until all 8 filters are retrieved
      const result = await waitForFilters(() => {
        return filters.filter(f => f !== undefined).length === expectedFilters;
      }, device, 10000, () => ({
        filters: filters,
        globalGain: globalGain,
        currentSlot: currentSlot,
        deviceDetails: getModelConfig(device)
      }));

      console.log("PEQ Data Pulled:", result);
      return result;
    } catch (error) {
      console.error("Failed to pull data from WalkPlay Device:", error);
      throw error;
    }
  };

  // Enable or disable PEQ
  const enablePEQ = async (enable, slotId) => {
    if (!device) throw new Error("Device not connected.");
    if (!enable) slotId = 0x00; // ?? Determine the not enabled
    const packet = [WRITE_VALUE, FLASH_EQ, 0x00, slotId, END_HEADER]
    await sendReport(REPORT_ID, packet);
    console.log(`PEQ ${enable ? "enabled" : "disabled"}.`);
  };


// Send command to HID device
  async function sendReport(reportId, packet) {
    if (!device) throw new Error("Device not connected.");
    const data = new Uint8Array(packet);
    console.log("Sending:", data);
    await device.sendReport(reportId, data);
  }

// Wait for response
  async function waitForResponse(timeout = 5000) {
    return new Promise((resolve, reject) => {
      let response = null;
      const timer = setTimeout(() => reject("Timeout waiting for HID response"), timeout);

      device.oninputreport = (event) => {
        clearTimeout(timer);
        response = new Uint8Array(event.data.buffer);
        console.log("Received:", response);
        resolve(response);
      };
    });
  }

  return {
    setConfig,
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFilters(condition, device, timeout, callback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!condition()) {
        console.warn("Timeout: Filters not fully received.");
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

function parseIndividualPEQPacket(packet) {
  if (packet.length < 32) {
    throw new Error("Packet too short to contain filter data.");
  }
  let filterType = convertToFilterType(packet[26]);
  let filterIndex = packet[4]; // Extract filter index
  let freq = packet[27] | (packet[28] << 8); // Frequency (little-endian)
  let qFactor = (packet[29] | (packet[30] << 8)) / 256; // Q factor (scaled)

  let gainRaw = packet[31] | (packet[32] << 8); // Gain (little-endian)
  if (gainRaw > 32767) gainRaw -= 65536; // Handle negative values
  let gain = gainRaw / 256; // Convert to dB

  return {
    type: filterType,
    filterIndex: filterIndex,
    freq: freq,
    q: qFactor,
    gain: gain,
    disabled: (gain || freq || qFactor) ? false : true // Disable filter if 0 value found
  };
}
function convertToFilterType(datum) {
  switch (datum) {
    case 0:
      return "PK";  // Walkplay only seems to have Peaking filters
    default:
      return "PK";
  }
}

function parseGlobalGain(data) {
  if (data.length < 40) return 0; // No global gain found

  let gainRaw = data[38] | (data[39] << 8); // Extract gain (little-endian)
  if (gainRaw > 32767) gainRaw -= 65536; // Convert to signed integer
  return gainRaw / 256; // Convert to dB
}

// Compute IIR filter
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
