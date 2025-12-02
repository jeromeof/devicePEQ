//
// Copyright 2024 : Pragmatic Audio
//
// Define the shared logic for JadeAudio / SnowSky / FiiO devices - Each manufacturer will have slightly
// different code so best to each have a separate 'module'

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

const SET_HEADER1 = 0xAA;
const SET_HEADER2 = 0x0A;
const GET_HEADER1 = 0xBB;
const GET_HEADER2 = 0x0B;
const END_HEADERS = 0xEE;

export const fiioUsbHID = (function () {

  const getCurrentSlot = async (deviceDetails) => {
    var device = deviceDetails.rawDevice;
    var reportId = getFiioReportId(deviceDetails);
    try {
      let currentSlot = -99;

      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: getCurrentSlot() onInputReport received data:`, data);
        if (data[0] === GET_HEADER1 && data[1] === GET_HEADER2) {
          switch (data[4]) {
            case PEQ_PRESET_SWITCH:
              currentSlot = handleEqPreset(data, deviceDetails);
              break;
            default:
              console.log("USB Device PEQ: Unhandled data type:", data[4], data);
          }
        }
      };

      await getPresetPeq(device, reportId);

      // Wait at most 10 seconds for filters to be populated
      const result = await waitForFilters(() => {
        return currentSlot > -99
      }, device, 10000, (device) => (
        currentSlot
      ));

      return result;
    } catch (error) {
      console.error("Failed to pull data from FiiO Device:", error);
      throw error;
    }
  };

  const pushToDevice = async (deviceDetails, phoneObj, slot, preamp_gain, filters) => {
    try {
      var device = deviceDetails.rawDevice;
      var reportId = getFiioReportId(deviceDetails);

      // FiiO devices will automatically cut the max SPL by the maxGain (typically -12)
      // So, we can safely apply a +12 gain - the larged preamp_gain needed
      // .e.g. if we need to +5dB for a filter then we can still make the globalGain 7dB
      await setGlobalGain(device, deviceDetails.modelConfig.maxGain + preamp_gain, reportId);
      const maxFilters = deviceDetails.modelConfig.maxFilters;
      const maxFiltersToUse = Math.min(filters.length, maxFilters);
      await setPeqCounter(device, maxFiltersToUse, reportId);
      await new Promise(resolve => setTimeout(resolve, 100)); // Added 100ms delay

      for (let filterIdx = 0; filterIdx < maxFiltersToUse; filterIdx++) {
        const filter = filters[filterIdx];
        var gain = 0;   // If disabled we still need to reset to 0 gain as previous gain value will
        // still be active
        if (!filter.disabled) {
          gain = filter.gain;
        }
        await setPeqParams(device, filterIdx, filter.freq, gain, filter.q, convertFromFilterType(filter.type), reportId);
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Added 100ms delay

      saveToDevice(device, slot, reportId);

      console.log("PEQ filters pushed successfully.");

      if (deviceDetails.modelConfig.disconnectOnSave) {
        return true;    // Disconnect
      }
      return false;

    } catch (error) {
      console.error("Failed to push data to FiiO Device:", error);
      throw error;
    }
  };

  const pullFromDevice = async (deviceDetails, slot) => {
    try {
      const filters = [];
      let peqCount = 0;
      let globalGain = 0;
      let currentSlot = 0;
      var device = deviceDetails.rawDevice;
      var reportId = getFiioReportId(deviceDetails);

      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: pullFromDevice() onInputReport received data:`, data);
        if (data[0] === GET_HEADER1 && data[1] === GET_HEADER2) {
          switch (data[4]) {
            case PEQ_FILTER_COUNT:
              peqCount = handlePeqCounter(data, device, reportId);
              break;
            case PEQ_FILTER_PARAMS:
              handlePeqParams(data, device, filters);
              break;
            case PEQ_GLOBAL_GAIN:
              globalGain = handleGain(data[6], data[7]);
              console.log(`USB Device PEQ: Global gain received: ${globalGain}dB`);
              break;
            case PEQ_PRESET_SWITCH:
              currentSlot = handleEqPreset(data, deviceDetails);
              break;
            case PEQ_SAVE_TO_DEVICE:
              savedEQ(data, device);
              break;
            default:
              console.log("USB Device PEQ: Unhandled data type:", data[4], data);
          }
        }
      };

      await getPresetPeq(device, reportId);
      await getPeqCounter(device, reportId);
      await getGlobalGain(device, reportId);

      // Wait at most 10 seconds for filters to be populated
      const result = await waitForFilters(() => {
        return filters.length == peqCount
      }, device, 10000, (device) => ({
        filters: filters,
        globalGain: globalGain
      }));

      return result;
    } catch (error) {
      console.error("Failed to pull data from FiiO Device:", error);
      throw error;
    }
  }

  const enablePEQ = async (deviceDetails, enable, slotId) => {

    var device = deviceDetails.rawDevice
    var reportId = getFiioReportId(deviceDetails);

    if (enable) {   // take the slotId we are given and switch to it
      await setPresetPeq(device, slotId, reportId);
    } else {
      await setPresetPeq(device, deviceDetails.modelConfig.maxFilters, reportId);
    }
  }
  return {
    pushToDevice,
    pullFromDevice,
    getCurrentSlot,
    enablePEQ
  };
})();


// Private Helper Functions

/**
 * Gets the appropriate reportId for a FiiO device based on its product name or modelConfig.
 * @param {Object} device - The device object.
 * @param {Object} [deviceDetails] - Optional deviceDetails object containing modelConfig.
 * @returns {number} - The reportId to use for the device.
 */
function getFiioReportId(deviceDetails) {
  // If deviceDetails is provided and has a modelConfig with reportId, use that
  if (deviceDetails && deviceDetails.modelConfig && deviceDetails.modelConfig.reportId !== undefined) {
    console.log(`Using reportId ${deviceDetails.modelConfig.reportId} from modelConfig for ${deviceDetails.model || "unknown device"}`);
    return deviceDetails.modelConfig.reportId;
  }

  // Default reportId for FiiO devices is 7
  console.log(`Using default reportId 7 for ${deviceDetails.model || "unknown device"}`);
  return 7;
}

async function setPeqParams(device, filterIndex, fc, gain, q, filterType, reportId) {
  const [frequencyLow, frequencyHigh] = splitUnsignedValue(fc);
  const [gainLow, gainHigh] = fiioGainBytesFromValue(gain);
  const qFactorValue = Math.round(q * 100);
  const [qFactorLow, qFactorHigh] = splitUnsignedValue(qFactorValue);

  const packet = [
    SET_HEADER1, SET_HEADER2, 0, 0, PEQ_FILTER_PARAMS, 8,
    filterIndex, gainLow, gainHigh,
    frequencyLow, frequencyHigh,
    qFactorLow, qFactorHigh,
    filterType, 0, END_HEADERS
  ];

  const data = new Uint8Array(packet);
  console.log(`USB Device PEQ: setPeqParams() sending filter ${filterIndex} - Freq: ${fc}Hz, Gain: ${gain}dB, Q: ${q}, Type: ${filterType}`, data);
  await device.sendReport(reportId, data);
}

async function setPresetPeq(device, presetId, reportId) { // Default to 0 if not specified
  const packet = [
    SET_HEADER1, SET_HEADER2, 0, 0, PEQ_PRESET_SWITCH, 1,
    presetId, 0, END_HEADERS
  ];

  const data = new Uint8Array(packet);
  console.log(`USB Device PEQ: setPresetPeq() switching to preset ${presetId}`, data);
  await device.sendReport(reportId, data);
}

async function setGlobalGain(device, gain, reportId) {
  const globalGain = Math.round(gain * 10);
  const gainBytes = toBytePair(globalGain);

  const packet = [
    SET_HEADER1, SET_HEADER2, 0, 0, PEQ_GLOBAL_GAIN, 2,
    gainBytes[1], gainBytes[0], 0, END_HEADERS
  ];

  const data = new Uint8Array(packet);
  console.log(`USB Device PEQ: setGlobalGain() setting global gain to ${gain}dB`, data);
  await device.sendReport(reportId, data);
}

async function setPeqCounter(device, counter, reportId) {
  const packet = [
    SET_HEADER1, SET_HEADER2, 0, 0, PEQ_FILTER_COUNT, 1,
    counter, 0, END_HEADERS
  ];

  const data = new Uint8Array(packet);
  console.log(`USB Device PEQ: setPeqCounter() setting filter count to ${counter}`, data);
  await device.sendReport(reportId, data);
}

function convertFromFilterType(filterType) {
  const mapping = {"PK": 0, "LSQ": 1, "HSQ": 2};
  return mapping[filterType] !== undefined ? mapping[filterType] : 0;
}

function convertToFilterType(datum) {
  switch (datum) {
    case 0:
      return "PK";
    case 1:
      return "LSQ";
    case 2:
      return "HSQ";
    default:
      return "PK";
  }
}

function toBytePair(value) {
  return [
    value & 0xFF,
    (value & 0xFF00) >> 8
  ];
}

function splitSignedValue(value) {
  const signedValue = value < 0 ? value + 65536 : value;
  return [
    (signedValue >> 8) & 0xFF,
    signedValue & 0xFF
  ];
}

function splitUnsignedValue(value) {
  return [
    (value >> 8) & 0xFF,
    value & 0xFF
  ];
}

function combineBytes(lowByte, highByte) {
  return (lowByte << 8) | highByte;
}

function getGlobalGain(device, reportId) {
  const packet = [GET_HEADER1, GET_HEADER2, 0, 0, PEQ_GLOBAL_GAIN, 0, 0, END_HEADERS];
  const data = new Uint8Array(packet);
  console.log("getGlobalGain() Send data:", data);
  device.sendReport(reportId, data);
}

function getPeqCounter(device, reportId) {
  const packet = [GET_HEADER1, GET_HEADER2, 0, 0, PEQ_FILTER_COUNT, 0, 0, END_HEADERS];
  const data = new Uint8Array(packet);
  console.log("getPeqCounter() Send data:", data);
  device.sendReport(reportId, data);
}

function getPeqParams(device, filterIndex, reportId) {
  const packet = [GET_HEADER1, GET_HEADER2, 0, 0, PEQ_FILTER_PARAMS, 1, filterIndex, 0, END_HEADERS];
  const data = new Uint8Array(packet);
  console.log("getPeqParams() Send data:", data);
  device.sendReport(reportId, data);
}

function getPresetPeq(device, reportId) {
  const packet = [GET_HEADER1, GET_HEADER2, 0, 0, PEQ_PRESET_SWITCH, 0, 0, END_HEADERS];
  const data = new Uint8Array(packet);
  console.log("getPresetPeq() Send data:", data);
  device.sendReport(reportId, data);
}

function saveToDevice(device, slotId, reportId) {
  const packet = [SET_HEADER1, SET_HEADER2, 0, 0, PEQ_SAVE_TO_DEVICE, 1, slotId, 0, END_HEADERS];
  const data = new Uint8Array(packet);
  console.log(`USB Device PEQ: saveToDevice() using reportId ${reportId} for slot ${slotId}`, data);
  device.sendReport(reportId, data);
}

function handlePeqCounter(data, device, reportId) {
  let peqCount = data[6];
  console.log("***********oninputreport peq counter=", peqCount);
  if (peqCount > 0) {
    processPeqCount(device, peqCount, reportId);
  }
  return peqCount;
}

function processPeqCount(device, peqCount, reportId) {
  console.log("PEQ Counter:", peqCount);

  // Fetch individual PEQ settings based on count
  for (let i = 0; i < peqCount; i++) {
    getPeqParams(device, i, reportId);
  }
}

function handlePeqParams(data, device, filters) {
  const filter = data[6];
  const gain = handleGain(data[7], data[8]);
  const frequency = combineBytes(data[9], data[10]);
  const qFactor = (combineBytes(data[11], data[12])) / 100 || 1;
  const filterType = convertToFilterType(data[13]);

  console.log(`Filter ${filter}: Gain=${gain}, Frequency=${frequency}, Q=${qFactor}, Type=${filterType}`);

  filters[filter] = {
    type: filterType,
    freq: frequency,
    q: qFactor,
    gain: gain,
    disabled: (gain || frequency || qFactor) ? false : true // Disable filter if 0 value found
  };
}


function handleGain(lowByte, highByte) {
  let r = combineBytes(lowByte, highByte);
  const gain = r & 32768 ? (r = (r ^ 65535) + 1, -r / 10) : r / 10;
  return gain;
}

function fiioGainBytesFromValue(e) {
  let t = e * 10;
  t < 0 && (t = (Math.abs(t) ^ 65535) + 1);
  const r = t >> 8 & 255,
    n = t & 255;
  return [r, n]
}

function handleEqPreset(data, deviceDetails) {
  const presetId = data[6];
  console.log("EQ Preset ID:", presetId);

  if (presetId === deviceDetails.modelConfig.disabledPresetId) {
    return -1;      // with JA11 slot 4 == Off
  }
  // Handle preset switch if necessary
  return presetId;
}

function savedEQ(data, device) {
  const slotId = data[6];
  console.log("EQ Slot ID:", slotId);
  // Handle slot enablement if necessary
}


// Utility function to wait for a condition or timeout
function waitForFilters(condition, device, timeout, callback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!condition()) {
        console.warn("Timeout reached before data returned?");
        reject(callback(device));
      } else {
        resolve(callback(device));
      }
    }, timeout);

    // Check every 100 milliseconds if everything is ready based on condition method !!
    const interval = setInterval(() => {
      if (condition()) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(callback(device));
      }
    }, 100);
  });
}
