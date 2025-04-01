// jdsLabsUsbSerialHandler.js
// Pragmatic Audio - Handler for JDS Labs Element IV USB Serial EQ Control

export const jdsLabsUsbSerial = (function () {
  let textEncoder = new TextEncoder();
  let textDecoder = new TextDecoder();

  async function connect(deviceDetails) {
    const port = deviceDetails.rawDevice;
    await port.open({ baudRate: 115200 });
    deviceDetails.reader = port.readable.getReader();
    deviceDetails.writer = port.writable.getWriter();
    console.log("Connected to JDS Labs Element IV over Serial");
  }

  async function disconnect(deviceDetails) {
    try {
      deviceDetails.reader?.releaseLock();
      deviceDetails.writer?.releaseLock();
      await deviceDetails.rawDevice.close();
      console.log("Disconnected from JDS Labs Element IV");
    } catch (e) {
      console.error("Error during serial disconnect", e);
    }
  }

  async function sendCommand(device, command) {
    const writer = device.writer;
    const fullCommand = `PEQ:${command}\n`;
    await writer.write(textEncoder.encode(fullCommand));
  }

  async function readResponse(device) {
    const reader = device.reader;
    const { value, done } = await reader.read();
    if (done || !value) return null;
    return textDecoder.decode(value).trim();
  }

  async function getCurrentSlot(deviceDetails) {
    await sendCommand(deviceDetails, "GET_SLOT");
    const response = await readResponse(deviceDetails);
    return parseInt(response.replace("SLOT:", ""));
  }

  async function pullFromDevice(deviceDetails, slot) {
    await sendCommand(deviceDetails, `GET_EQ:${slot}`);
    const response = await readResponse(deviceDetails);
    // Example response: "PEQ:1,100,2.0,0.707;2,500,1.0,1.000"

    if (!response.startsWith("PEQ:")) {
      throw new Error("Unexpected response from device: " + response);
    }

    const filterText = response.substring(4);
    const filters = filterText.split(";").map(f => {
      const [index, freq, gain, q] = f.split(",").map(Number);
      return { freq, gain, q };
    });

    return { filters, globalGain: 0 }; // JDS Labs doesn't expose global gain
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    const filterLines = filters.map((f, i) => `${i},${f.freq},${f.gain},${f.q}`).join(";");
    const command = `SET_EQ:${slot}:${filterLines}`;
    await sendCommand(deviceDetails, command);
    console.log("Filters pushed to JDS Labs Element IV");
  }

  async function enablePEQ(deviceDetails, enable, slotId) {
    await sendCommand(deviceDetails, `SET_SLOT:${enable ? slotId : -1}`);
    const response = await readResponse(deviceDetails);
    console.log("PEQ Enable Response:", response);
  }

  return {
    connect,
    disconnect,
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
