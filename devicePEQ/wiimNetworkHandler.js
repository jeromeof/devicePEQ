//
// Copyright 2024 : Pragmatic Audio
//
// Define the WiiM Network Handler for PEQ over HTTP API
//

const PLUGIN_URI = "http://moddevices.com/plugins/caps/EqNp";
const SOURCE_NAME = "wifi"; // Input source targeted by EQ commands (wifi, bt, line_in, etc.)

export const wiimNetworkHandler = (function () {

  /**
   * Fetch PEQ settings from the device
   * @param {string} device - The device
   * @param {number} slot - The PEQ slot (currently not used in WiiM API)
   * @returns {Promise<Object>} The parsed EQ settings
   */
  async function pullFromDevice(device, slot) {
    try {
      const payload = {
        source_name: SOURCE_NAME,
        pluginURI: PLUGIN_URI
      };
      const url = `https://${device.ip}/httpapi.asp?command=EQGetLV2SourceBandEx:${encodeURIComponent(JSON.stringify(payload))}`;
      console.log(`Device PEQ: WiiM sending request to fetch EQ data:`, payload);

      const response = await fetch(url, {method: "GET", mode: "no-cors"});

      // no-cors responses are always opaque (status=0, body unreadable).
      // WiiM pull requires CORS headers from the device or a local proxy — see README.
      if (response.type === 'opaque') {
        throw new Error(
          'Cannot read WiiM response: browser CORS/mixed-content restriction. ' +
          'Serve this page over HTTP or use a local proxy (see network-proxy docs).'
        );
      }
      if (!response.ok)
        throw new Error(`Failed to fetch PEQ data: ${response.status}`);

      const data = await response.json();
      if (data.status !== "OK") throw new Error(`PEQ fetch failed: ${JSON.stringify(data)}`);

      console.log("Device PEQ: WiiM received EQ data:", data);

      const filters = parseWiiMEQData(data);
      return {filters, globalGain: 0, currentSlot: slot, deviceDetails: {maxFilters: 10}};

    } catch (error) {
      console.error("Error pulling PEQ settings from WiiM:", error);
      throw error;
    }
  }

  /**
   * Push PEQ settings to the device
   * @param {string} device - The device
   * @param {number} slot - The PEQ slot (currently not used in WiiM API)
   * @param {number} preamp - The preamp gain
   * @param {Array} filters - Array of PEQ filters
   * @returns {Promise<boolean>} Returns true if push was successful
   */
  async function pushToDevice(device, phoneObj, slot, preamp, filters, _modelConfig) {
    try {
      const MAX_BANDS = 10; //fallback to 10

      // Only take up to MAX_BANDS filters
      const effectiveFilters = Array.isArray(filters) ? filters.slice(0, MAX_BANDS) : [];

      // 1) Populate provided filters (a..? up to MAX_BANDS)
      const eqBandData = effectiveFilters.map((filter, index) => ({
        param_name: `${String.fromCharCode(97 + index)}_mode`,
        value: filter.disabled ? -1 : convertToWiimMode(filter.type),
      }));

      effectiveFilters.forEach((filter, index) => {
        const band = String.fromCharCode(97 + index);
        eqBandData.push(
          { param_name: `${band}_freq`, value: filter.freq },
          { param_name: `${band}_q`, value: filter.q },
          { param_name: `${band}_gain`, value: filter.gain }
        );
      });

      // 2) Reset any remaining bands up to MAX_BANDS
      //    This ensures previously-set filters on the device are cleared.
      //    We explicitly set gain to 0 and disable the band (mode -1).
      for (let i = effectiveFilters.length; i < MAX_BANDS; i++) {
        const band = String.fromCharCode(97 + i); // a..j
        eqBandData.push(
          { param_name: `${band}_mode`, value: -1 }, // Off
          { param_name: `${band}_freq`, value: 1000 }, // sensible default (unused when Off)
          { param_name: `${band}_q`, value: 1 },
          { param_name: `${band}_gain`, value: 0 }
        );
      }

      const payload = {
        pluginURI: PLUGIN_URI,           // e.g., "http://moddevices.com/plugins/caps/EqNp"
        source_name: "wifi",             // or "bt", "line_in", etc. Always Wifi for now
        EQBand: eqBandData,
        EQStat: "On",                    // Enable EQ
        channelMode: "Stereo",          // Use stereo mode
      };

      const deviceIp = typeof device === 'string' ? device : device.ip;
      const url = `https://${deviceIp}/httpapi.asp?command=EQSetLV2SourceBand:${encodeURIComponent(JSON.stringify(payload))}`;
      console.log(`Device PEQ: WiiM sending request to set EQ data:`, payload);

      const response = await fetch(url, { method: "GET", mode: "no-cors" });

      if (response.status != 0)
        throw new Error(`Failed to push PEQ data: ${response.status}`);

      if (response.type !== "opaque") {
        const data = await response.json();
        console.log(`Device PEQ: WiiM received response for set EQ:`, data);
        if (data.status !== "OK")
          throw new Error(`PEQ push failed: ${JSON.stringify(data)}`);
      } else {
        console.log("Device PEQ: WiiM cannot read response due to security reasons (CORS)");
      }

      // Now set the Preset Name - ultimately get the headphone name from custom parameters but not for now
      const presetNamePayload = {
        pluginURI: PLUGIN_URI,           // e.g., "http://moddevices.com/plugins/caps/EqNp"
        source_name: "wifi",             // or "bt", "line_in", etc.
        Name: "HeadphoneEQ"             // Custom preset name
      }
      // Optional preset naming hint if API supports it in future
      if (phoneObj && phoneObj.fileName) {
        presetNamePayload.Name = phoneObj.fileName;
      }

      const presetNameUrl = `https://${deviceIp}/httpapi.asp?command=EQSourceSave:${encodeURIComponent(JSON.stringify(presetNamePayload))}`;
      console.log(`Device PEQ: WiiM sending request to save preset name:`, presetNamePayload);

      const presetNameResponse = await fetch(presetNameUrl, { method: "GET", mode: "no-cors" });

      if (presetNameResponse.status != 0)
        throw new Error(`Failed to push PEQ data: ${presetNameResponse.status}`);

      if (presetNameResponse.type !== "opaque") {
        const data = await presetNameResponse.json();
        console.log(`Device PEQ: WiiM received response for preset name:`, data);
        if (data.status !== "OK")
          throw new Error(`PEQ Name push failed: ${JSON.stringify(data)}`);
      } else {
        console.log("Device PEQ: WiiM cannot read preset name response due to security reasons (CORS)");
      }

      console.log("Device PEQ: WiiM settings successfully pushed to device");


      console.log("WiiM PEQ updated successfully");
      return false; // We don't need to restart

    } catch (error) {
      console.error("Error pushing PEQ settings to WiiM:", error);
      throw error;
    }
  }

  /**
   * Enable or disable PEQ
   * @param {string} device - The device
   * @param {boolean} enabled - Whether to enable or disable PEQ
   * @param {number} slotId - The PEQ slot (currently not used in WiiM API)
   * @returns {Promise<void>}
   */
  async function enablePEQ(device, enabled, slotId) {
    try {
      const command = enabled ? "EQChangeSourceFX" : "EQSourceOff";
      const payload = {source_name: SOURCE_NAME, pluginURI: PLUGIN_URI};
      const url = `https://${device.ip}/httpapi.asp?command=${command}:${encodeURIComponent(JSON.stringify(payload))}`;
      // Use no-cors for consistency with push — response will be opaque but the command fires.
      const response = await fetch(url, { method: "GET", mode: "no-cors" });

      if (response.type !== 'opaque') {
        if (!response.ok) throw new Error(`Failed to ${enabled ? "enable" : "disable"} PEQ: ${response.status}`);
        const data = await response.json();
        if (data.status !== "OK") throw new Error(`PEQ ${enabled ? "enable" : "disable"} failed: ${JSON.stringify(data)}`);
      } else {
        console.log(`WiiM PEQ ${enabled ? "enable" : "disable"} sent (response unreadable due to CORS)`);
      }

      console.log(`WiiM PEQ ${enabled ? "enabled" : "disabled"} successfully`);

    } catch (error) {
      console.error("Error toggling WiiM PEQ:", error);
      throw error;
    }
  }

  /**
   * Parse WiiM PEQ JSON response into a standardized format
   * @param {Object} data - The WiiM PEQ data
   * @returns {Array} Formatted PEQ filter list
   */
  function parseWiiMEQData(data) {
    // Group params by band letter (a–j) using param_name so field ordering in
    // the API response doesn't matter. Each band has: mode, freq, q, gain.
    const bands = {};
    for (const param of (data.EQBand || [])) {
      const match = param.param_name?.match(/^([a-j])_(mode|freq|q|gain)$/);
      if (match) {
        const [, letter, field] = match;
        (bands[letter] ??= {})[field] = param.value;
      }
    }

    return Object.keys(bands).sort().map(letter => {
      const b = bands[letter];
      const filterType = convertFromWiimMode(b.mode ?? -1);
      return {
        type: filterType,
        freq: b.freq ?? 1000,
        q: b.q ?? 1,
        gain: b.gain ?? 0,
        disabled: filterType === "Off",
      };
    });
  }

  /**
   * Convert internal filter type to WiiM filter mode
   * @param {string} type - Internal filter type (PK, LSQ, HSQ)
   * @returns {number} WiiM PEQ mode value
   */
  function convertToWiimMode(type) {
    const mapping = {
      "Off":        -1,
      "Low-Shelf":   0, "LSQ": 0,   // low-shelf (long name + app short code)
      "Peak":        1, "PK":  1,   // peaking   (long name + app short code)
      "High-Shelf":  2, "HSQ": 2,   // high-shelf(long name + app short code)
    };
    return mapping[type] !== undefined ? mapping[type] : 1; // default to Peak
  }

  /**
   * Convert WiiM filter mode to internal filter type
   * @param {number} mode - WiiM PEQ mode value
   * @returns {string} Internal filter type
   */
  function convertFromWiimMode(mode) {
    switch (mode) {
      case 0:
        return "Low-Shelf";
      case 1:
        return "Peak";
      case 2:
        return "High-Shelf";
      default:
        return "Off";
    }
  }

  async function getCurrentSlot(device) {
    return 0;
  }

  async function getAvailableSlots(device) {
    const url = `https://${device.ip}/httpapi.asp?command=EQv2GetList:${encodeURIComponent(PLUGIN_URI)}`;
    try {
      const response = await fetch(url, {method: "GET", mode: "no-cors" });
      // Opaque no-cors responses cannot be read; return a placeholder slot.
      // A local proxy is required for real slot enumeration — see network-proxy docs.
      if (response.type === 'opaque' || !response.ok) {
        return [{ id: 0, name: "Default" }];
      }

      return [{ id: 0, name: "Cannot read" }];

    } catch (error) {
      console.error("Error retrieving preset list from WiiM:", error);
      throw error;
    }
  }

  return {
    getCurrentSlot,
    getAvailableSlots,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
