// nothingUsbSerialHandler.js
// Pragmatic Audio - Handler for Nothing Headphones USB Serial/Bluetooth SPP EQ Control

export const nothingUsbSerial = (function () {

  // Nothing headphone protocol constants
  const PROTOCOL_HEADER = [0x55, 0x60, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00];

  // Command constants from bluetooth-spp-test.html
  // READ_ commands - used to send() values to the SSP port
  const READ_COMMANDS = {
    READ_EQ_MODE: 49183,
    READ_EQ_VALUES: 49229,
    READ_FIRMWARE: 49218
  };

  // WRITE_ commands - used to send() values to the SSP port
  const WRITE_COMMANDS = {
    SET_ADVANCE_CUSTOM_EQ_VALUE: 61520
  };

  // RESPONSE_ commands - used to read the results of either READ_ or WRITE_ operations
  const RESPONSE_COMMANDS = {
    EQ_MODE: 16415, // Response for READ_EQ_MODE command
    FIRMWARE: 16450,
    EQ_VALUES: 16461
  };


  let operationID = 0;
  let operationList = {};

  function crc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
      }
    }
    return crc;
  }

  async function sendCommand(device, command, payload = [], operation = "") {
    let header = [...PROTOCOL_HEADER];
    operationID++;
    header[7] = operationID;

    let commandBytes = new Uint8Array(new Uint16Array([command]).buffer);
    header[3] = commandBytes[0];
    header[4] = commandBytes[1];

    let payloadLength = payload.length;
    header[5] = payloadLength;
    header.push(...payload);

    let byteArray = new Uint8Array(header);
    let crc = crc16(byteArray);
    byteArray = [...byteArray, crc & 0xFF, crc >> 8];

    if (operation !== "") {
      operationList[operationID] = operation;
    }

    console.log(`Nothing USB Serial: sending command ${command}:`, byteArray.map(byte => byte.toString(16).padStart(2, '0')).join(''));

    const writer = device.writable;
    await writer.write(new Uint8Array(byteArray));
  }

  function getCommand(header) {
    let commandBytes = new Uint8Array(header.slice(3, 5));
    let commandInt = new Uint16Array(commandBytes.buffer)[0];
    return commandInt;
  }

  function bytesToFloat(byteArray) {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < 4; i++) {
      view[i] = byteArray[i];
    }
    const dataView = new DataView(buffer);
    return dataView.getFloat32(0, true); // true for little-endian
  }

  function floatToBytes(value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value, true); // true for little-endian
    return new Uint8Array(buffer);
  }

  function toByteArray(value, offset = 0, length = 1) {
    const byteArray = new Uint8Array(length);

    if (length === 1) {
      byteArray[0] = value & 0xFF;
    } else if (length === 2) {
      byteArray[0] = value & 0xFF;
      byteArray[1] = (value >> 8) & 0xFF;
    } else if (length === 4) {
      byteArray[0] = value & 0xFF;
      byteArray[1] = (value >> 8) & 0xFF;
      byteArray[2] = (value >> 16) & 0xFF;
      byteArray[3] = (value >> 24) & 0xFF;
    } else {
      byteArray[0] = value & 0xFF;
    }

    return Array.from(byteArray);
  }

  async function readResponse(device) {
    const reader = device.readable;
    const { value, done } = await reader.read();

    if (done || !value) {
      return null;
    }

    let rawData = new Uint8Array(value.buffer);
    if (rawData[0] !== 0x55 || rawData.length < 8) {
      return null;
    }

    // Use full 8-byte protocol header to align payload offset correctly
    let header = rawData.slice(0, 8);
    let command = getCommand(header);

    return {
      command,
      rawData,
      hexString: rawData.reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '')
    };
  }

  async function readEQMode(device) {
    console.log("Nothing USB Serial: reading current EQ mode");
    await sendCommand(device, READ_COMMANDS.READ_EQ_MODE, [], "readEQMode");

    const response = await readResponse(device);
    if (!response || response.command !== RESPONSE_COMMANDS.EQ_MODE) {
      throw new Error("Failed to read EQ mode from Nothing device");
    }

    // Parse EQ mode response
    const hexArray = response.hexString.match(/.{2}/g).map(byte => parseInt(byte, 16));
    const eqModeValue = hexArray[8]; // EQ mode is typically at offset 8

    return eqModeValue;
  }

  async function getCurrentSlot(deviceDetails) {
    try {
      return await readEQMode(deviceDetails);
    } catch (error) {
      console.error("Nothing USB Serial: failed to read current EQ mode:", error);
      return 0; // Default to Balanced profile
    }
  }

  function getProfileName(deviceDetails, profileId) {
    const slots = deviceDetails?.modelConfig?.availableSlots;
    if (Array.isArray(slots)) {
      const match = slots.find(s => s.id === profileId);
      if (match && match.name) return match.name;
    }
    // Removed hardcoded fallback; rely on config-provided names
    return `Slot ${profileId}`;
  }

  async function pullFromDevice(deviceDetails, slot) {
    console.log(`Nothing USB Serial: pulling EQ from device slot ${slot}`);

    // First, read the current EQ mode to determine which profile is active
    let currentProfile = slot;
    try {
      currentProfile = await readEQMode(deviceDetails);
      console.log(`Nothing USB Serial: detected active profile ${currentProfile}`);
    } catch (error) {
      console.warn(`Nothing USB Serial: could not read EQ mode, using requested slot ${slot}`);
      currentProfile = slot;
    }

    // For profiles that are not the first writable EQ slot, we can only read basic EQ settings
    const firstWritableSlot = deviceDetails?.modelConfig?.firstWritableEQSlot ?? 5;
    // we can only read basic EQ settings - these don't have detailed parametric EQ data
    if (currentProfile !== firstWritableSlot) {
      const profileName = getProfileName(deviceDetails, currentProfile);
      console.log(`Nothing USB Serial: reading basic EQ for profile ${currentProfile} (${profileName})`);

      return {
        filters: [], // Basic profiles don't expose individual filters
        globalGain: 0,
        profileId: currentProfile,
        profileName: profileName,
        isBasicProfile: true
      };
    }

    // For Custom profile (first writable slot), read detailed EQ values
    const customProfileName = getProfileName(deviceDetails, firstWritableSlot);
    console.log(`Nothing USB Serial: reading EQ values for ${customProfileName} profile ${currentProfile}`);
    const payload = toByteArray(0, 0, 1);
    await sendCommand(deviceDetails, READ_COMMANDS.READ_EQ_VALUES, payload, "readEQValues");

    // Read response
    const response = await readResponse(deviceDetails);
    if (!response || response.command !== RESPONSE_COMMANDS.EQ_VALUES) {
      throw new Error("Failed to read EQ values from Nothing device");
    }

    // Parse EQ values response - based on readEQValues() from HTML
    const hexArray = response.hexString.match(/.{2}/g).map(byte => parseInt(byte, 16));

    if (hexArray.length < 10) {
      throw new Error("EQ Values response too short");
    }

    let offset = 8; // Skip 8-byte protocol header

    const profileIndex = hexArray[offset++];
    const numBands = hexArray[offset++];

    // Total gain (4 bytes as float, little-endian)
    const totalGainBytes = hexArray.slice(offset, offset + 4);
    const totalGain = bytesToFloat(totalGainBytes);
    offset += 4;

    const filters = [];

    // Parse each EQ band (13 bytes each)
    for (let i = 0; i < numBands && offset + 12 < hexArray.length; i++) {
      const filterType = hexArray[offset++];

      const gainBytes = hexArray.slice(offset, offset + 4);
      const gain = Math.round(bytesToFloat(gainBytes) * 100)/100;
      offset += 4;

      const freqBytes = hexArray.slice(offset, offset + 4);
      const frequency = bytesToFloat(freqBytes);
      offset += 4;

      const qualityBytes = hexArray.slice(offset, offset + 4);
      const quality = bytesToFloat(qualityBytes);
      const qFactorValue = Math.round(quality * 100)/100;
      offset += 4;

      filters.push({
        freq: frequency,
        gain: gain,
        q: qFactorValue,
        type: filterType === 0 ? "LSQ" : filterType === 2 ? "HSQ" : "PK"
      });
    }

    const profileName = getProfileName(deviceDetails, currentProfile);
    console.log(`Nothing USB Serial: pulled ${filters.length} filters with global gain ${totalGain} for ${profileName}`);
    return {
      filters,
      globalGain: totalGain,
      profileId: currentProfile,
      profileName: profileName,
      isBasicProfile: false
    };
  }

  function createEQDataPacket(profileIndex, eqBands, totalGain = 0.0) {
    // Based on Java obtainDataPacket() method
    const numBands = eqBands ? eqBands.length : 0;
    const packetSize = 1 + 1 + 4 + (numBands * 13); // profileIndex + numBands + totalGain + (bands * 13 bytes each)

    const packet = new Uint8Array(packetSize);
    let offset = 0;

    // Profile index (1 byte)
    packet[offset++] = profileIndex;

    // Number of bands (1 byte)
    packet[offset++] = numBands;

    // Total gain (4 bytes as float, little-endian)
    const totalGainBytes = floatToBytes(totalGain);
    packet.set(totalGainBytes, offset);
    offset += 4;

    // EQ bands data
    if (eqBands) {
        for (const band of eqBands) {
            // Filter type (1 byte)
            packet[offset++] = band.filterType; // Default to PEAK

            // Gain (4 bytes as float)
            const gainBytes = floatToBytes(band.gain || 0.0);
            packet.set(gainBytes, offset);
            offset += 4;

            // Frequency (4 bytes as float)
            const freqBytes = floatToBytes(band.frequency || 1000.0);
            packet.set(freqBytes, offset);
            offset += 4;

            // Quality (4 bytes as float)
            const qualityBytes = floatToBytes(band.quality || 0.707);
            packet.set(qualityBytes, offset);
            offset += 4;
        }
    }

    return packet;
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    console.log(`Nothing USB Serial: pushing ${filters.length} filters to device slot ${slot}`);

    // Only the first writable slot supports writing EQ values
    const firstWritableSlot = deviceDetails?.modelConfig?.firstWritableEQSlot ?? 5;
    if (slot !== firstWritableSlot) {
      const name = getProfileName(deviceDetails, firstWritableSlot);
      throw new Error(`EQ writing only supported for ${name} (slot ${firstWritableSlot}), requested slot: ${slot}`);
    }

    // Convert filters to the format expected by createEQDataPacket
    const eqBands = filters.map(filter => ({
      filterType: filter.type === "LSQ" ? 0 : filter.type === "HSQ" ? 2 : 1, // PEAKING = 1
      gain: filter.gain,
      frequency: filter.freq,
      quality: filter.q
    }));

    // Create EQ data packet using the provided logic
    const packet = createEQDataPacket(0, eqBands, globalGain); // profileIndex 0 for Custom
    const payload = Array.from(packet);

    console.log(`Nothing USB Serial: writing Custom EQ with ${filters.length} filters and global gain ${globalGain}`);
    await sendCommand(deviceDetails, WRITE_COMMANDS.SET_ADVANCE_CUSTOM_EQ_VALUE, payload, "writeEQValues");

    // Wait for response to confirm write was successful
    const response = await readResponse(deviceDetails);
    if (!response) {
      throw new Error("No response received after writing EQ values");
    }

    console.log(`Nothing USB Serial: EQ values written successfully to Custom profile`);
  }

  async function enablePEQ(device, enabled, slotId) {
    // Nothing headphones don't have a separate PEQ enable/disable command
    console.log(`Nothing USB Serial: PEQ enable/disable not applicable`);
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
