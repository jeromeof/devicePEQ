export const ktmicroUsbHidHandler = (function () {
  const FILTER_COUNT = 10;
  const REPORT_ID = 0x4b;
  const COMMAND_READ = 0x52;
  const COMMAND_WRITE = 0x57;
  const COMMAND_COMMIT = 0x53;
  const COMMAND_CLEAR = 0x43;

  let pendingCommands = [];

  function registerReportHandler(device) {
    if (device._reportHandlerRegistered) return;
    device.addEventListener("inputreport", (event) => {
      const data = new Uint8Array(event.data.buffer);
      const reg = data[0];
      const cmd = data[4];

      const index = pendingCommands.findIndex(p => p.reg === reg && p.cmd === cmd && p.device === device);
      if (index !== -1) {
        const p = pendingCommands.splice(index, 1)[0];
        clearTimeout(p.timeout);
        p.resolve(data);
      }
    });
    device._reportHandlerRegistered = true;
  }

  function waitForResponse(device, reg, cmd, timeoutMs = 1000) {
    registerReportHandler(device);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = pendingCommands.findIndex(p => p.resolve === resolve);
        if (index !== -1) pendingCommands.splice(index, 1);
        reject(new Error(`Timeout waiting for response (Reg: 0x${reg.toString(16)}, Cmd: 0x${cmd.toString(16)})`));
      }, timeoutMs);
      pendingCommands.push({ device, reg, cmd, resolve, reject, timeout });
    });
  }

  async function sendCommandWithResponse(device, packet, timeoutMs = 1000) {
    const reg = packet[0];
    const cmd = packet[4];
    const responsePromise = waitForResponse(device, reg, cmd, timeoutMs);
    await device.sendReport(REPORT_ID, packet);
    return responsePromise;
  }

  function buildReadPacket(filterFieldToRequest) {
    return new Uint8Array([filterFieldToRequest, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildReadGlobalPacket() {
    return new Uint8Array([0x66, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildWriteGlobalPacket() {
    return new Uint8Array([0x66, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildEnableEQPacket(slotId) {
    return new Uint8Array([0x24, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, slotId, 0x00, 0x00, 0x00]);
  }

  function buildReadEQPacket() {
    return new Uint8Array([0x24, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x03, 0x00, 0x00, 0x00]);
  }

  function decodeGainFreqResponse(data,compensate2X) {
    const gainRaw = data[6] | (data[7] << 8);
    const gain = gainRaw > 0x7FFF ? gainRaw - 0x10000 : gainRaw; // signed 16-bit
    var freq = data[8] + (data[9] << 8);
    if (compensate2X) {
      freq = freq * 2;
    }

    return { gain: gain / 10.0, freq };
  }

  function decodeQResponse(data) {
    const q = (data[6] + (data[7] << 8)) / 1000.0;
    let type = "PK"; // Default to Peak filter

    // Read filter type from byte 8
    const filterTypeValue = data[8];
    if (filterTypeValue === 3) {
      type = "LSQ"; // Low Shelf
    } else if (filterTypeValue === 0) {
      type = "PK"; // Peak
    } else if (filterTypeValue === 4) {
      type = "HSQ"; // High Shelf
    }

    return { q, type };
  }

  async function getCurrentSlot (deviceDetails){
    var device = deviceDetails.rawDevice;
    const request = buildReadEQPacket();
    console.log(`USB Device PEQ: KTMicro sending readCurrentSlot command:`, request);
    const data = await sendCommandWithResponse(device, request);
    const slotId = data[6];
    console.log(`USB Device PEQ: KTMicro read slot value: ${slotId}`);
    return slotId;
  }

  // Resolve the (gain/freq, q/type) register pair for a band.
  // Most KT Micro devices lay bands out consecutively from baseRegisterOffset
  // (band i → base+2i, base+2i+1). Some (e.g. KT_1132L, KT_3016L) skip or reorder
  // registers — those provide an explicit modelConfig.bandRegisters map:
  //   bandRegisters: [{ freq: 0x35, q: 0x36 }, ... ]  // indexed by band number
  function bandRegistersFor(modelConfig, filterIndex) {
    const map = modelConfig.bandRegisters;
    if (Array.isArray(map) && map[filterIndex]) {
      return { gainFreqId: map[filterIndex].freq, qId: map[filterIndex].q };
    }
    const base = modelConfig.baseRegisterOffset || 0x26;
    const gainFreqId = base + filterIndex * 2;
    return { gainFreqId, qId: gainFreqId + 1 };
  }

  async function readFullFilter(device, filterIndex, compensate2X, gainFreqId, qId) {
    console.log(`USB Device PEQ: KTMicro reading filter ${filterIndex} (Regs: 0x${gainFreqId.toString(16)}, 0x${qId.toString(16)})`);

    const dataGainFreq = await sendCommandWithResponse(device, buildReadPacket(gainFreqId));
    const gainFreqResult = decodeGainFreqResponse(dataGainFreq, compensate2X);

    const dataQ = await sendCommandWithResponse(device, buildReadPacket(qId));
    const qResult = decodeQResponse(dataQ);

    const result = { ...gainFreqResult, ...qResult };
    console.log(`USB Device PEQ: KTMicro filter ${filterIndex} complete:`, result);
    return result;
  }

  async function readPregain(device) {
    const request = buildReadGlobalPacket();
    console.log(`USB Device PEQ: KTMicro sending readPregain command:`, request);
    const data = await sendCommandWithResponse(device, request);

    const rawPregain = data[6];
    let pregain = rawPregain > 127 ? rawPregain - 256 : rawPregain;

    console.log(`USB Device PEQ: KTMicro pregain value: ${pregain}`);
    return pregain;
  }

  async function writePregain(device, value) {
    const request = buildWriteGlobalPacket();

    let processedGlobalGain = Math.round(value); // Ensure it's a whole number
    if (processedGlobalGain < 0) {
      processedGlobalGain = processedGlobalGain & 0xFF;
    }

    request[6] = processedGlobalGain;

    console.log(`USB Device PEQ: KTMicro sending writePregain command:`, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const compensate2X = deviceDetails.modelConfig.compensate2X;
    const filters = [];
    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      const { gainFreqId, qId } = bandRegistersFor(deviceDetails.modelConfig, i);
      const filter = await readFullFilter(device, i, compensate2X, gainFreqId, qId);
      filters.push(filter);
    }

    const pregain = await readPregain(device);

    return { filters, globalGain: pregain };
  }

  function toLittleEndianBytes(value, scale = 1) {
    const v = Math.round(value * scale);
    return [v & 0xff, (v >> 8) & 0xff];
  }

  function toSignedLittleEndianBytes(value, scale = 1) {
    let v = Math.round(value * scale);
    if (v < 0) v += 0x10000; // Convert to unsigned 16-bit
    return [v & 0xFF, (v >> 8) & 0xFF];
  }

  function buildWritePacket(filterId, freq, gain) {
    const freqBytes = toLittleEndianBytes(freq);
    const gainBytes = toSignedLittleEndianBytes(gain, 10);
    return new Uint8Array([
      filterId, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, gainBytes[0], gainBytes[1], freqBytes[0], freqBytes[1]
    ]);
  }

  function buildQPacket(filterId, q, type) {
    const qBytes = toLittleEndianBytes(q, 1000);
    var filterTypeValue = 0;
    if (type === "LSQ") {
      filterTypeValue = 3; // Low Shelf
    } else if (type === "HSQ") {
      filterTypeValue = 4; // High Shelf
    }

    return new Uint8Array([
      filterId, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, qBytes[0], qBytes[1], filterTypeValue, 0x00
    ]);
  }

  function buildCommand(commandCode) {
    return new Uint8Array([
      0x00, 0x00, 0x00, 0x00, commandCode, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
  }

  async function pushClearToDevice(device) {
    // Send a clear first ( sort of like a reset )
    const clear = buildCommand(COMMAND_CLEAR);
    console.log(`USB Device PEQ: KTMicro sending clear command:`, clear);
    await sendCommandWithResponse(device, clear);
    console.log(`USB Device PEQ: KTMicro clear sent and confirmed`);

    await new Promise(resolve => setTimeout(resolve, 200)); // Added 200ms delay
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;

    // First check if we need to enable PEQ
    const currentSlot = await getCurrentSlot(deviceDetails);
    if (currentSlot === deviceDetails.modelConfig.disabledPresetId) {
      // Use the first of the availableSlots to 'enable' that slot
      slot = deviceDetails.modelConfig.availableSlots[0].id;
      console.log(`USB Device PEQ: KTMicro device is disabled, enabling it first with slot ${slot}`);
      await enablePEQ(deviceDetails, true, slot);
    }

    try {
      // Now write the filters
      for (let i = 0; i < filters.length; i++) {
        if (i >= deviceDetails.modelConfig.maxFilters) break;

        const { gainFreqId, qId } = bandRegistersFor(deviceDetails.modelConfig, i);
        var freqToWrite = filters[i].freq;
        if (deviceDetails.modelConfig.compensate2X) { // Most older KTMicro devices set the wrong frequency
          freqToWrite = filters[i].freq / 2;  // 100Hz seems to end up as 200Hz
        }
        var gain = filters[i].gain;
        if (filters[i].disabled) {
          gain = 0;
        }
        const writeGainFreq = buildWritePacket(gainFreqId, freqToWrite, gain);
        const writeQ = buildQPacket(qId, filters[i].q, filters[i].type);

        // Fire-and-forget writes — KT Micro devices do not all ACK individual register
        // writes (e.g. TANCHJIM-ONE DSP processes silently). The older handler never
        // awaited write ACKs; only the commit requires a confirmed response.
        console.log(`USB Device PEQ: KTMicro sending gain/freq for filter ${i}:`, filters[i], writeGainFreq);
        await device.sendReport(REPORT_ID, writeGainFreq);

        console.log(`USB Device PEQ: KTMicro sending Q for filter ${i}:`, filters[i].q, writeQ);
        await device.sendReport(REPORT_ID, writeQ);
      }
    } catch (e) {
      console.log(`USB Device PEQ: KTMicro Error during push:`, e);
      throw e;
    }

    if (deviceDetails.modelConfig.deviceHandlesPregain === false) {
      await writePregain(device, globalGain);
    }

    const commit = buildCommand(COMMAND_COMMIT);
    console.log(`USB Device PEQ: KTMicro sending commit command:`, commit);
    await device.sendReport(REPORT_ID, commit);
    console.log(`USB Device PEQ: KTMicro commit sent`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`USB Device PEQ: KTMicro successfully pushed ${filters.length} filters to device`);
    if (deviceDetails.modelConfig.disconnectOnSave) {
      return true;    // Disconnect
    }
    return false;
  }

  const enablePEQ = async (deviceDetails, enable, slotId) => {
    // KT micro - has issue if device is PEQ was disabled we try to enable it
    var device = deviceDetails.rawDevice;

    if (slotId === deviceDetails.modelConfig.disabledPresetId || enable === false) {
      slotId = deviceDetails.modelConfig.disabledPresetId; // Disable
    }

    const enableEQPacket = buildEnableEQPacket(slotId);

    console.log(`USB Device PEQ: KTMicro enable PEQ request (Slot: ${slotId})`, enableEQPacket);
    await sendCommandWithResponse(device, enableEQPacket);
  }

  return {
    getCurrentSlot,
    pushToDevice,
    pullFromDevice,
    enablePEQ,
  };
})();
