// jdsLabsUsbSerialHandler.js
// Pragmatic Audio - Handler for JDS Labs Element IV USB Serial EQ Control

export const jdsLabsUsbSerial = (function () {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const describeCommand = { Product: "JDS Labs Element IV", Action: "Describe" };

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

  async function pullFromDevice(deviceDetails, slot) {
    await sendJsonCommand(deviceDetails, describeCommand);
    const response = await readJsonResponse(deviceDetails);
    if (!response || !response.Configuration || !response.Configuration.DSP) {
      throw new Error("Invalid Describe response for PEQ extraction");
    }

    const headphoneConfig = response.Configuration.DSP.Headphone;
    const filters = [];
    const filterNames = [
      "Lowshelf",
      "Peaking 1", "Peaking 2", "Peaking 3", "Peaking 4",
      "Peaking 5", "Peaking 6", "Peaking 7", "Peaking 8",
      "Highshelf"
    ];

    for (const name of filterNames) {
      const filter = headphoneConfig[name];
      if (!filter) continue;
      filters.push({
        freq: filter.Frequency.Current,
        gain: filter.Gain.Current,
        q: filter.Q.Current
      });
    }

    const preampGain = headphoneConfig.Preamp?.Gain?.Current || 0;
    return { filters, globalGain: preampGain };
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    const makeFilterObj = (filter) => ({
      Gain: filter.gain,
      Frequency: filter.freq,
      Q: filter.q
    });

    const payload = {
      Product: "JDS Labs Element IV",
      FormatOutput: true,
      Action: "Update",
      Configuration: {
        DSP: {
          Headphone: {
            Preamp: { Gain: globalGain, Mode: "AUTO" },
            Lowshelf: makeFilterObj(filters[0]),
            "Peaking 1": makeFilterObj(filters[1]),
            "Peaking 2": makeFilterObj(filters[2]),
            "Peaking 3": makeFilterObj(filters[3]),
            "Peaking 4": makeFilterObj(filters[4]),
            "Peaking 5": makeFilterObj(filters[5]),
            "Peaking 6": makeFilterObj(filters[6]),
            "Peaking 7": makeFilterObj(filters[7]),
            "Peaking 8": makeFilterObj(filters[8]),
            Highshelf: makeFilterObj(filters[9])
          }
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
  };
})();
