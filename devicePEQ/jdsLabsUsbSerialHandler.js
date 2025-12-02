// jdsLabsUsbSerialHandler.js
// Pragmatic Audio - Handler for JDS Labs Element IV USB Serial EQ Control

class SerialDeviceError extends Error {}

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


  // Helper function to get the filter order (always 12-band)
  function getFilterOrder() {
    return FILTER_12_BAND_ORDER;
  }

  // Helper function to transform JDS Labs filter types to standard format
  function transformFilterType(jdsLabsType) {
    switch (jdsLabsType) {
      case "LOWSHELF":
        return "LSQ";
      case "HIGHSHELF":
        return "HSQ";
      case "PEAKING":
        return "PK";
      default:
        return "PK"; // Default to peaking
    }
  }

  async function pullFromDevice(deviceDetails, slot) {
    await sendJsonCommand(deviceDetails, describeCommand);
    const response = await readJsonResponse(deviceDetails);
    if (!response || !response.Configuration || !response.Configuration.DSP) {
      throw new Error("Invalid Describe response for PEQ extraction");
    }

    console.log(`USB Device PEQ: JDS Labs device (12-band support only)`);

    const headphoneConfig = response.Configuration.DSP.Headphone;
    const filters = [];
    const filterNames = getFilterOrder();

    // Count actual filters available from the device
    let actualFilterCount = 0;
    for (const name of filterNames) {
      if (headphoneConfig[name]) {
        actualFilterCount++;
      }
    }

    // Show toast notification if fewer than 12 filters are detected
    if (actualFilterCount < 12) {
      console.log(`USB Device PEQ: JDS Labs detected only ${actualFilterCount} filters, showing firmware update notification`);
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast(
          `Only ${actualFilterCount} of 12 filters detected. Please update your JDS Labs Element IV firmware to the latest version for full 12-band EQ support.`,
          'warning',
          8000
        );
      }
    }

    for (const name of filterNames) {
      const filter = headphoneConfig[name];
      if (!filter) {
        console.log(`USB Device PEQ: JDS Labs missing filter ${name}, using default values`);
        // Add default values for missing filters
        const defaultType = name.startsWith("Lowshelf") ? "LOWSHELF" :
                           name.startsWith("Highshelf") ? "HIGHSHELF" : "PEAKING";
        filters.push({
          freq: name.startsWith("Lowshelf") ? 80 : name.startsWith("Highshelf") ? 10000 : 1000,
          gain: 0,
          q: 0.707,
          type: transformFilterType(defaultType)
        });
        continue;
      }

      // Use full type names for consistency
      let filterType = "PEAKING"; // Default to PEAKING
      if (filter.Type) {
        filterType = filter.Type.Current || "PEAKING";
      }

      filters.push({
        freq: filter.Frequency.Current,
        gain: filter.Gain.Current,
        q: filter.Q.Current,
        type: transformFilterType(filterType)
      });
    }

    const preampGain = headphoneConfig.Preamp?.Gain?.Current || 0;

    return { filters, globalGain: preampGain };
  }

  // Helper function to group and validate filters for JDS Labs
  function groupAndValidateFilters(filters) {
    const JDS_LIMITS = {
      LSQ: 2,    // 2 Lowshelf filters
      HSQ: 2,    // 2 Highshelf filters
      PK: 8      // 8 Peaking filters
    };

    // Group filters by type
    const grouped = {
      LSQ: filters.filter(f => f.type === 'LSQ'),
      HSQ: filters.filter(f => f.type === 'HSQ'),
      PK: filters.filter(f => f.type === 'PK')
    };

    const warnings = [];
    const validatedFilters = {
      LSQ: [],
      HSQ: [],
      PK: []
    };

    // Validate and truncate each group
    for (const [type, typeFilters] of Object.entries(grouped)) {
      const limit = JDS_LIMITS[type];

      if (typeFilters.length > limit) {
        warnings.push(`Warning: JDS Labs only supports ${limit} ${type === 'LSQ' ? 'Low Shelf' : type === 'HSQ' ? 'High Shelf' : 'Peak'} filters, but ${typeFilters.length} were provided. Only the first ${limit} will be applied.`);
        validatedFilters[type] = typeFilters.slice(0, limit);
      } else {
        validatedFilters[type] = typeFilters;
      }
    }

    // Show warnings if any
    if (warnings.length > 0) {
      warnings.forEach(warning => {
        console.warn(`USB Device PEQ: JDS Labs - ${warning}`);
        if (typeof window !== 'undefined' && window.showToast) {
          window.showToast(warning, "warning", 8000);
        }
      });
    }

    // Create aligned filter array for JDS Labs 12-band structure
    const alignedFilters = [];

    // Add Lowshelf filters (positions 0-1)
    for (let i = 0; i < 2; i++) {
      if (i < validatedFilters.LSQ.length) {
        alignedFilters.push({...validatedFilters.LSQ[i], type: 'LOWSHELF'});
      } else {
        // Add disabled/default lowshelf filter
        alignedFilters.push({freq: 80, gain: 0, q: 0.707, type: 'LOWSHELF'});
      }
    }

    // Add Peaking filters (positions 2-9)
    for (let i = 0; i < 8; i++) {
      if (i < validatedFilters.PK.length) {
        alignedFilters.push({...validatedFilters.PK[i], type: 'PEAKING'});
      } else {
        // Add disabled/default peaking filter
        alignedFilters.push({freq: 1000, gain: 0, q: 0.707, type: 'PEAKING'});
      }
    }

    // Add Highshelf filters (positions 10-11)
    for (let i = 0; i < 2; i++) {
      if (i < validatedFilters.HSQ.length) {
        alignedFilters.push({...validatedFilters.HSQ[i], type: 'HIGHSHELF'});
      } else {
        // Add disabled/default highshelf filter
        alignedFilters.push({freq: 10000, gain: 0, q: 0.707, type: 'HIGHSHELF'});
      }
    }

    return alignedFilters;
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {

    console.log(`USB Device PEQ: JDS Labs building settings for 12-band device`);

    // Group and validate filters according to JDS Labs requirements
    const alignedFilters = groupAndValidateFilters(filters);

    // Create filter object with Type field (always 12-band)
    const makeFilterObj = (filter, defaultType = "PEAKING") => {
      // Device expects full type names, not abbreviated forms
      const currentType = filter.type || defaultType;

      return {
        Gain: filter.gain,
        Frequency: filter.freq,
        Q: filter.q,
        Type: currentType
      };
    };

    // Get the filter order (always 12-band)
    const filterOrder = getFilterOrder();

    // Create the headphone configuration object
    const headphoneConfig = {
      Preamp: { Gain: globalGain, Mode: "AUTO" }
    };

    // Add aligned filters to the configuration (alignedFilters already has correct types and positions)
    filterOrder.forEach((name, index) => {
      if (index < alignedFilters.length) {
        headphoneConfig[name] = makeFilterObj(alignedFilters[index]);
      } else {
        // This shouldn't happen since alignedFilters should always be 12 elements
        console.warn(`USB Device PEQ: JDS Labs missing filter at index ${index}`);
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
    if (response["Status"] === true) {
      console.log("Settings Applied & Saved");
      return response;
    } else {
      throw new SerialDeviceError("Command error updating settings");
    }
  }


  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice, // Kept for backward compatibility
    enablePEQ: async () => {} // Not applicable for JDSLabs
  };
})();

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { jdsLabsUsbSerial };
}
