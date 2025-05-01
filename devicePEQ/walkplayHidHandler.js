//
// Copyright 2024 : Pragmatic Audio
//
// Define the shared logic for Walkplay devices
//
// Many thanks to ma0shu for providing a dump

export const walkplayUsbHID = (function () {
  const REPORT_ID = 0x4B;
  const ALT_REPORT_ID = 0x3C;
  const READ = 0x80;
  const WRITE = 0x01;
  const END = 0x00;
  const CMD = {
    PEQ_VALUES: 0x09,
    VERSION: 0x0C,
    TEMP_WRITE: 0x0A,
    FLASH_EQ: 0x01,
    GET_SLOT: 0x0F,
  };

  const DEFAULT_FILTER_COUNT = 8;

  const getCurrentSlot = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");

    // Get the version number first
    await sendReport(device, REPORT_ID, [READ, CMD.VERSION, END]);
    var response = await waitForResponse(device);
    const versionBytes = response.slice(3, 6);
    const version = String.fromCharCode(...versionBytes);

    console.log("USB Device PEQ: Walkplay firmware version:", version);
    const versionNumber = parseFloat(version);

    if (isNaN(versionNumber)) {
      console.warn("Could not parse firmware version:", versionNumber);
      deviceDetails.version = null;
      return;
    }

    // Save version number to deviceDetails
    deviceDetails.version = versionNumber;

    console.log("Fetching current EQ slot...");

    await sendReport(device, REPORT_ID, [READ, CMD.PEQ_VALUES, END]);
    response = await waitForResponse(device);
    const slot = response ? response[35] : -1;

    console.log("Walkplay current EQ slot:", slot);
    return slot;
  };

  // Push PEQ settings to Walkplay device
  const pushToDevice = async (deviceDetails, slot, preampGain, filters) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log("Pushing PEQ settings...");
    if (typeof slot === "string" )  // Convert from string
      slot = parseInt(slot, 10);

    const useAltReport = false;

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const bArr = computeIIRFilter(i, filter.freq, filter.gain, filter.q);

      const packet = [
        WRITE, CMD.PEQ_VALUES, 0x18, 0x00, i, 0x00, 0x00,
        ...bArr,
        ...convertToByteArray(filter.freq, 2),
        ...convertToByteArray(Math.round(filter.q * 256), 2),
        ...convertToByteArray(Math.round(filter.gain * 256), 2),
        0x02, 0x00,
        slot,
        END
      ];

      await sendReport(device, useAltReport ? ALT_REPORT_ID : REPORT_ID, packet);
    }

    await sendReport(device, REPORT_ID, [WRITE, CMD.TEMP_WRITE, 0x04, 0x00, 0x00, 0xFF, 0xFF, END]);
    await sendReport(device, REPORT_ID, [WRITE, CMD.FLASH_EQ, 0x01, END]);

    console.log("PEQ filters successfully pushed to Walkplay device.");
  };

  const pullFromDevice = async (deviceDetails, slot = -1) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");

    const filters = [];
    let globalGain = 0;
    let currentSlot = -1;

    device.oninputreport = async (event) => {
      const data = new Uint8Array(event.data.buffer);
      console.log(`USB Device PEQ: Walkplay pullFromDevice onInputReport received data:`, data);

      if (data.length >= 32) {
        const filter = parseFilterPacket(data);
        console.log(`USB Device PEQ: Walkplay parsed filter ${filter.filterIndex}:`, filter);
        filters[filter.filterIndex] = filter;
      }

      if (data.length >= 40) {
        globalGain = parseGlobalGain(data);
        console.log(`USB Device PEQ: Walkplay parsed global gain: ${globalGain}dB`);
      }

      if (data.length >= 37) {
        currentSlot = data[36];
        console.log(`USB Device PEQ: Walkplay parsed current slot: ${currentSlot}`);
      }
    };

    // Send requests for each filter with increased delay
    for (let i = 0; i < DEFAULT_FILTER_COUNT; i++) {
      await sendReport(device, REPORT_ID, [READ, CMD.PEQ_VALUES, 0x00, 0x00, i, END]);
      await delay(100); // Increased delay between requests
    }

    // Check for missing filters after initial requests
    await delay(200); // Wait a bit after sending all requests

    // Retry for any missing filters
    const missingIndices = [];
    for (let i = 0; i < DEFAULT_FILTER_COUNT; i++) {
      if (filters[i] === undefined) {
        missingIndices.push(i);
      }
    }

    if (missingIndices.length > 0) {
      console.log(`Retrying missing filters: ${missingIndices.join(', ')}`);
      for (const index of missingIndices) {
        await sendReport(device, REPORT_ID, [READ, CMD.PEQ_VALUES, 0x00, 0x00, index, END]);
        await delay(200); // Even longer delay for retries
      }
    }

    // Wait for filters with increased timeout
    const result = await waitForFilters(() => {
      return filters.filter(f => f !== undefined).length === DEFAULT_FILTER_COUNT;
    }, device, 15000, () => ({  // Increased timeout to 15 seconds
      filters,
      globalGain,
      currentSlot,
      deviceDetails: deviceDetails.modelConfig,
    }));

    console.log("Pulled PEQ filters from Walkplay:", result);
    return result;
  };

  function parseFilterPacket(packet) {
    if (packet.length < 32) {
      throw new Error("Packet too short to contain filter data.");
    }

    const filterIndex = packet[4];

    // Frequency (little-endian 16-bit)
    const freq = packet[27] | (packet[28] << 8);

    // Q factor (8.8 fixed-point)
    const qRaw = packet[29] | (packet[30] << 8);
    const q = Math.round((qRaw / 256) * 10) / 10;

    // Gain (8.8 fixed-point signed)
    let gainRaw = packet[31] | (packet[32] << 8);
    if (gainRaw > 32767) gainRaw -= 65536;
    const gain = Math.round((gainRaw / 256) * 10) / 10;

    // Filter type — Walkplay seems to only use Peaking
    const type = convertToFilterType(packet[26]);

    return {
      filterIndex,
      freq,
      q,
      gain,
      type,
      disabled: !(freq || q || gain)
    };
  }

  function convertToFilterType(byte) {
    switch (byte) {
      case 0: return "PK"; // Peaking
      case 1: return "LSQ"; // Low Shelf (if seen in future captures)
      case 3: return "HSQ"; // High Shelf (future-proof)
      default: return "PK";
    }
  }
  const enablePEQ = async (deviceDetails, enable, slotId) => {
    const device = deviceDetails.rawDevice;
    if (!enable) slotId = 0x00;
    const packet = [WRITE, CMD.FLASH_EQ, 0x00, slotId, END];
    await sendReport(device, REPORT_ID, packet);
  };


// Internal functions
  async function sendReport(device, reportId, packet) {
    if (!device) throw new Error("Device not connected.");
    const data = new Uint8Array(packet);
    console.log(`USB Device PEQ: Walkplay sending report (ID: ${reportId}):`, data);
    await device.sendReport(reportId, data);
  }

// Wait for response
  async function waitForResponse(device, timeout = 5000) {
    return new Promise((resolve, reject) => {
      let response = null;
      const timer = setTimeout(() => {
        console.log(`USB Device PEQ: Walkplay timeout waiting for response after ${timeout}ms`);
        reject("Timeout waiting for HID response");
      }, timeout);

      device.oninputreport = (event) => {
        clearTimeout(timer);
        response = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: Walkplay received response:`, response);
        resolve(response);
      };
    });
  }

  return {
    pushToDevice,
    pullFromDevice,
    getCurrentSlot,
    enablePEQ
  };
})();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFilters(condition, device, timeout, callback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!condition()) {
        console.warn("Timeout: Filters not fully received.");
        // Instead of rejecting with the callback result, create a proper result with partial data
        const result = callback(device);
        // Add information about the timeout to help with debugging
        result.complete = false;
        result.timedOut = true;
        result.receivedCount = result.filters.filter(f => f !== undefined).length;
        result.expectedCount = DEFAULT_FILTER_COUNT;
        // Resolve with partial data instead of rejecting
        resolve(result);
      } else {
        const result = callback(device);
        result.complete = true;
        result.timedOut = false;
        resolve(result);
      }
    }, timeout);

    const interval = setInterval(() => {
      if (condition()) {
        clearTimeout(timer);
        clearInterval(interval);
        const result = callback(device);
        result.complete = true;
        result.timedOut = false;
        resolve(result);
      }
    }, 100);
  });
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
