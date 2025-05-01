//
// Copyright 2024 : Pragmatic Audio
//
// Define the WiiM Network Handler for PEQ over HTTP API
//

const PLUGIN_URI = "http://moddevices.com/plugins/caps/EqNp";

export const wiimNetworkHandler = (function () {

  /**
   * Fetch PEQ settings from the device
   * @param {string} ip - The device IP address
   * @param {number} slot - The PEQ slot (currently not used in WiiM API)
   * @returns {Promise<Object>} The parsed EQ settings
   */
  async function pullFromDevice(ip, slot) {
    try {
      const payload = {
        source_name: SOURCE_NAME,
        pluginURI: PLUGIN_URI
      };
      const url = `https://${ip}/httpapi.asp?command=EQGetLV2SourceBandEx:${encodeURIComponent(JSON.stringify(payload))}`;
      console.log(`Device PEQ: WiiM sending request to fetch EQ data:`, payload);

      const response = await fetch(url, {method: "GET", mode: "no-cors"});

      if (!response.status)
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
   * @param {string} ip - The device IP address
   * @param {number} slot - The PEQ slot (currently not used in WiiM API)
   * @param {number} preamp - The preamp gain
   * @param {Array} filters - Array of PEQ filters
   * @returns {Promise<boolean>} Returns true if push was successful
   */
  async function pushToDevice(ip, slot, preamp, filters) {
    try {
      const eqBandData = filters.map((filter, index) => ({
        param_name: `${String.fromCharCode(97 + index)}_mode`,
        value: filter.disabled ? -1 : convertToWiimMode(filter.type),
      }));

      filters.forEach((filter, index) => {
        eqBandData.push(
          {
            param_name: `${String.fromCharCode(97 + index)}_freq`,
            value: filter.freq
          },
          {
            param_name: `${String.fromCharCode(97 + index)}_q`,
            value: filter.q
          },
          {
            param_name: `${String.fromCharCode(97 + index)}_gain`,
            value: filter.gain
          }
        );
      });

      const payload = {
        pluginURI: PLUGIN_URI,           // e.g., "http://moddevices.com/plugins/caps/EqNp"
        source_name: "wifi",             // or "bt", "line_in", etc. Always Wifi for now
        EQBand: eqBandData,
        EQStat: "On",                    // Enable EQ
        channelMode: "Stereo",          // Use stereo mode
      };

      const url = `https://${ip}/httpapi.asp?command=EQSetLV2SourceBand:${encodeURIComponent(JSON.stringify(payload))}`;
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
      const presetNameUrl = `https://${ip}/httpapi.asp?command=EQSourceSave:${encodeURIComponent(JSON.stringify(presetNamePayload))}`;
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
   * @param {string} ip - The device IP address
   * @param {boolean} enabled - Whether to enable or disable PEQ
   * @param {number} slotId - The PEQ slot (currently not used in WiiM API)
   * @returns {Promise<void>}
   */
  async function enablePEQ(ip, enabled, slotId) {
    try {
      const command = enabled ? "EQChangeSourceFX" : "EQSourceOff";
      const payload = {source_name: SOURCE_NAME, pluginURI: PLUGIN_URI};
      const url = `https://${ip}/httpapi.asp?command=${command}:${encodeURIComponent(JSON.stringify(payload))}`;
      const response = await fetch(url, {method: "GET"});

      if (!response.ok) throw new Error(`Failed to ${enabled ? "enable" : "disable"} PEQ: ${response.status}`);

      const data = await response.json();
      if (data.status !== "OK") throw new Error(`PEQ ${enabled ? "enable" : "disable"} failed: ${JSON.stringify(data)}`);

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
    const eqBands = data.EQBand || [];
    const filters = [];

    for (let i = 0; i < eqBands.length; i += 4) {
      const filterType = convertFromWiimMode(eqBands[i].value);
      const frequency = eqBands[i + 1].value;
      const qFactor = eqBands[i + 2].value;
      const gain = eqBands[i + 3].value;

      filters.push({
        type: filterType,
        freq: frequency,
        q: qFactor,
        gain: gain,
        disabled: filterType === "Off",
      });
    }

    return filters;
  }

  /**
   * Convert internal filter type to WiiM filter mode
   * @param {string} type - Internal filter type (PK, LSQ, HSQ)
   * @returns {number} WiiM PEQ mode value
   */
  function convertToWiimMode(type) {
    const mapping = {"Off": -1, "Low-Shelf": 0, "Peak": 1, "High-Shelf": 2};
    return mapping[type] !== undefined ? mapping[type] : 1;
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

  async function getCurrentSlot(ip) {
    return 0;
  }

  async function getAvailableSlots(ip) {
    const url = `https://${ip}/httpapi.asp?command=EQv2GetList:${encodeURIComponent(PLUGIN_URI)}`;
    try {
      const response = await fetch(url, {method: "GET", mode: "no-cors" });
      if (!response.status == 0) {
        throw new Error(`Failed to fetch preset list: ${response.status}`);
      }

      return [ {id: 0, name: "Cannot read"}];

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
