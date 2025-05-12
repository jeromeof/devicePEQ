// jdsLabsUsbSerialHandler.js
// Pragmatic Audio - Handler for JDS Labs Element IV USB Serial EQ Control

export const jdsLabsUsbSerial = (function () {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const describeCommand = { Product: "JDS Labs Element IV", Action: "Describe" };

  // Define 12-band filter order
  const FILTER_12_BAND_ORDER = [
    "Lowshelf 1",
    "Lowshelf 2",
    "Peaking 1",
    "Peaking 2",
    "Peaking 3",
    "Peaking 4",
    "Peaking 5",
    "Peaking 6",
    "Peaking 7",
    "Peaking 8",
    "Highshelf 1",
    "Highshelf 2",
  ];

  // Define 10-band filter order
  const FILTER_10_BAND_ORDER = [
    "Lowshelf",
    "Peaking 1",
    "Peaking 2",
    "Peaking 3",
    "Peaking 4",
    "Peaking 5",
    "Peaking 6",
    "Peaking 7",
    "Peaking 8",
    "Highshelf",
  ];

  async function sendJsonCommand(device, json) {
    const writer = device.writable;
    const jsonString = JSON.stringify(json);
    const payload = textEncoder.encode(jsonString + "\0");
    console.log(`USB Device PEQ: JDS Labs sending command:`, jsonString);
    await writer.write(payload);
  }

  async function readJsonResponse(device) {
    const reader = device.readable;
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      buffer += textDecoder.decode(value);
      if (buffer.includes("\0")) {
        const jsonStr = buffer.split("\0")[0];
        const response = JSON.parse(jsonStr);
        console.log(`USB Device PEQ: JDS Labs received response:`, response);
        return response;
      }
    }
    console.log(`USB Device PEQ: JDS Labs received no response`);
    return null;
  }

  async function getCurrentSlot(deviceDetails) {
    await sendJsonCommand(deviceDetails, describeCommand);
    const response = await readJsonResponse(deviceDetails);
    if (!response || !response.Configuration || !response.Configuration.General) {
      throw new Error("Invalid Describe response for slot extraction");
    }
    const currentInput = response.Configuration.General["Input Mode"]?.Current;
    return currentInput === "USB" ? 0 : 1; // slot 0 for USB, slot 1 for SPDIF
  }

  // Helper function to detect if the device has 12 bands
  function detectDeviceHas12Bands(response) {
    // Check for 12-band structure
    const has12Bands =
      (response?.Configuration?.DSP?.RCA?.["Lowshelf 1"] !== undefined) ||
      (response?.Configuration?.DSP?.RCA?.["Lowshelf 2"] !== undefined) ||
      (response?.Configuration?.DSP?.RCA?.["Highshelf 1"] !== undefined) ||
      (response?.Configuration?.DSP?.RCA?.["Highshelf 2"] !== undefined);

    // Check for 10-band structure
    const has10Bands =
      (response?.Configuration?.DSP?.RCA?.["Lowshelf"] !== undefined) ||
      (response?.Configuration?.DSP?.RCA?.["Highshelf"] !== undefined);

    // If 12-band structure is detected and not 10-band, use 12-band
    return has12Bands && !has10Bands;
  }

  // Helper function to get the filter order based on device capability
  function getFilterOrder(has12Bands) {
    return has12Bands ? FILTER_12_BAND_ORDER : FILTER_10_BAND_ORDER;
  }

  async function pullFromDevice(deviceDetails, slot) {
    await sendJsonCommand(deviceDetails, describeCommand);
    const response = await readJsonResponse(deviceDetails);
    if (!response || !response.Configuration || !response.Configuration.DSP) {
      throw new Error("Invalid Describe response for PEQ extraction");
    }

    // Detect if the device has 12 bands
    const has12Bands = detectDeviceHas12Bands(response);
    console.log(`USB Device PEQ: JDS Labs device has ${has12Bands ? '12' : '10'} bands`);

    const headphoneConfig = response.Configuration.DSP.Headphone;
    const filters = [];
    const filterNames = getFilterOrder(has12Bands);

    for (const name of filterNames) {
      const filter = headphoneConfig[name];
      if (!filter) {
        console.log(`USB Device PEQ: JDS Labs missing filter ${name}, using default values`);
        // Add default values for missing filters
        filters.push({
          freq: name.startsWith("Lowshelf") ? 80 : name.startsWith("Highshelf") ? 10000 : 1000,
          gain: 0,
          q: 0.707,
          // For 12-band devices, also store the filter type
          ...(has12Bands ? {
            type: name.startsWith("Lowshelf") ? "LOWSHELF" :
                  name.startsWith("Highshelf") ? "HIGHSHELF" : "PEAKING"
          } : {})
        });
        continue;
      }

      filters.push({
        freq: filter.Frequency.Current,
        gain: filter.Gain.Current,
        q: filter.Q.Current,
        // For 12-band devices, also store the filter type if available
        ...(has12Bands && filter.Type ? { type: filter.Type.Current } : {})
      });
    }

    const preampGain = headphoneConfig.Preamp?.Gain?.Current || 0;

    // Store the device capability in deviceDetails for later use by pushToDevice
    if (!deviceDetails._deviceCapabilities) {
      deviceDetails._deviceCapabilities = {};
    }
    deviceDetails._deviceCapabilities.has12Bands = has12Bands;

    return { filters, globalGain: preampGain };
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    // Check if we have device capability information
    let has12Bands = deviceDetails._deviceCapabilities?.has12Bands;

    // If we don't have device capability information, try to detect it from the filters
    if (has12Bands === undefined) {
      // Check if any filter has a type property (indicating 12-band)
      const hasTypeProperty = filters.some(filter => filter.type !== undefined);

      if (hasTypeProperty) {
        has12Bands = true;
      } else if (filters.length > 10) {
        // If we have more than 10 filters, assume 12-band
        has12Bands = true;
      } else {
        // If we still don't know, query the device
        try {
          await sendJsonCommand(deviceDetails, describeCommand);
          const response = await readJsonResponse(deviceDetails);
          has12Bands = detectDeviceHas12Bands(response);

          // Store the capability for future use
          if (!deviceDetails._deviceCapabilities) {
            deviceDetails._deviceCapabilities = {};
          }
          deviceDetails._deviceCapabilities.has12Bands = has12Bands;
        } catch (error) {
          console.error("Error detecting device capability:", error);
          // Default to 10-band if detection fails
          has12Bands = false;
        }
      }
    }

    console.log(`USB Device PEQ: JDS Labs pushing to ${has12Bands ? '12' : '10'}-band device`);

    // Create filter object with or without Type field based on device capability
    const makeFilterObj = (filter, defaultType = "PEAKING") => {
      const obj = {
        Gain: filter.gain,
        Frequency: filter.freq,
        Q: filter.q
      };

      // Add Type field for 12-band devices
      if (has12Bands) {
        obj.Type = {
          Elements: ["LOWSHELF", "PEAKING", "HIGHSHELF"],
          Current: filter.type || defaultType
        };
      }

      return obj;
    };

    // Get the appropriate filter order
    const filterOrder = getFilterOrder(has12Bands);

    // Create the headphone configuration object
    const headphoneConfig = {
      Preamp: { Gain: globalGain, Mode: "AUTO" }
    };

    // Add filters to the configuration
    filterOrder.forEach((name, index) => {
      if (index < filters.length) {
        // Determine default type based on filter name
        let defaultType = "PEAKING";
        if (name.startsWith("Lowshelf")) {
          defaultType = "LOWSHELF";
        } else if (name.startsWith("Highshelf")) {
          defaultType = "HIGHSHELF";
        }

        headphoneConfig[name] = makeFilterObj(filters[index], defaultType);
      }
    });

    const payload = {
      Product: "JDS Labs Element IV",
      FormatOutput: true,
      Action: "Update",
      Configuration: {
        DSP: {
          Headphone: headphoneConfig
        }
      }
    };

    await sendJsonCommand(deviceDetails, payload);
    const response = await readJsonResponse(deviceDetails);
    if (response?.Status !== true) {
      throw new Error("Device did not confirm PEQ update");
    }
    console.log("PEQ configuration pushed successfully");
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ: async () => {}, // Not applicable for JDSLabs
    detectDeviceHas12Bands, // Export the function to detect 12-band capability
  };
})();
