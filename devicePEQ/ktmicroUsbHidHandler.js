export const ktmicroUsbHidHandler = (function () {
  const FILTER_COUNT = 10;
  const REPORT_ID = 0x4b;
  const COMMAND_READ = 0x52;
  const COMMAND_WRITE = 0x57;
  const COMMAND_COMMIT = 0x53;
  const COMMAND_CLEAR = 0x43;

  function buildReadPacket(filterFieldToRequest) {
    return new Uint8Array([filterFieldToRequest, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildReadGlobalPacket() {
    return new Uint8Array([0x66, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildWriteGlobalPacket() {
    return new Uint8Array([0x66, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, 0x00, 0x00, 0x00]);
  }

  function buildEnableEQPacket(slotId) {
    return new Uint8Array([0x24, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, slotId, 0x00, 0x00, 0x00]);
  }
  function buildReadEQPacket(enable) {
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
    return new Promise(async (resolve, reject) => {
      const request = buildReadEQPacket();

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading slot");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: KTMicro onInputReport received slot data:`, data);

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);

        const slotId = data[6];  //

        console.log(`USB Device PEQ: KTMicro read slot value: ${slotId}`);
        resolve(slotId);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readPregain command:`, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function readFullFilter(device, filterIndex, compensate2X) {
    const gainFreqId = 0x26 + filterIndex * 2;
    const qId = gainFreqId + 1;

    const requestGainFreq = buildReadPacket(gainFreqId);
    const requestQ = buildReadPacket(qId);

    return new Promise(async (resolve, reject) => {
      const result = {};
      const timeout = setTimeout(() => {
        device.removeEventListener('inputreport', onReport);
        reject("Timeout reading filter");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: KTMicro onInputReport received data:`, data);
        if (data[4] !== COMMAND_READ) return;

        if (data[0] === gainFreqId) {
          const gainFreqData = decodeGainFreqResponse(data, compensate2X);
          console.log(`USB Device PEQ: KTMicro filter ${filterIndex} gain/freq decoded:`, gainFreqData);
          Object.assign(result, gainFreqData);
        } else if (data[0] === qId) {
          const qData = decodeQResponse(data);
          console.log(`USB Device PEQ: KTMicro filter ${filterIndex} Q decoded:`, qData);
          Object.assign(result, qData);
        }

        if ('gain' in result && 'freq' in result && 'q' in result && 'type' in result) {
          clearTimeout(timeout);
          device.removeEventListener('inputreport', onReport);
          console.log(`USB Device PEQ: KTMicro filter ${filterIndex} complete:`, result);
          resolve(result);
        }
      };

      device.addEventListener('inputreport', onReport);
      console.log(`USB Device PEQ: KTMicro sending gain/freq request for filter ${filterIndex}:`, requestGainFreq);
      await device.sendReport(REPORT_ID, requestGainFreq);
      console.log(`USB Device PEQ: KTMicro sendReport gain/freq for filter ${filterIndex} sent`);

      console.log(`USB Device PEQ: KTMicro sending Q request for filter ${filterIndex}:`, requestQ);
      await device.sendReport(REPORT_ID, requestQ);

      console.log(`USB Device PEQ: KTMicro sendReport Q for filter ${filterIndex} sent`);
    });
  }

  async function readPregain(device) {
    return new Promise(async (resolve, reject) => {
      const request = buildReadGlobalPacket();

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading pregain");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: KTMicro onInputReport received pregain data:`, data);

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);

        const rawPregain = data[6];  //
        var pregain = 0;
        if (rawPregain > 127) {
          pregain = rawPregain - 256;
        } else {
          pregain = rawPregain;
        }

        console.log(`USB Device PEQ: KTMicro pregain value: ${pregain}`);
        resolve(pregain);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readPregain command:`, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writePregain(device, value) {
    const request = buildWriteGlobalPacket();

    let processedGlobalGain = Math.round(value); // Ensure it's a whole number
    if (processedGlobalGain < 0) {
      processedGlobalGain = processedGlobalGain & 0xFF;
    }

    request[6] = processedGlobalGain;

    console.log(`USB Device PEQ: Moondrop sending writePregain command:`, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const compensate2X = deviceDetails.modelConfig.compensate2X;
    const filters = [];
    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      const filter = await readFullFilter(device, i, compensate2X);
      filters.push(filter);
    }

    const pregain = readPregain(device);

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
    await device.sendReport(REPORT_ID, clear);
    console.log(`USB Devic  e PEQ: KTMicro sendReport clear sent`);

    await new Promise(resolve => setTimeout(resolve, 200)); // Added 100ms delay
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

        const filterId = 0x26 + i * 2;
        var freqToWrite = filters[i].freq;
        if (deviceDetails.modelConfig.compensate2X) { // Most older KTMicro devices set the wrong frequency
          freqToWrite = filters[i].freq / 2;  // 100Hz seems to end up as 200Hz
        }
        var gain = filters[i].gain;
        if (filters[i].disabled) {
          gain = 0;
        }
        const writeGainFreq = buildWritePacket(filterId, freqToWrite, gain);
        const writeQ = buildQPacket(filterId + 1, filters[i].q, filters[i].type);

        // We should verify it is saved correctly but for now lets assume once command is accepted it has worked
        console.log(`USB Device PEQ: KTMicro sending gain/freq for filter ${i}:`, filters[i], writeGainFreq);
        await device.sendReport(REPORT_ID, writeGainFreq);
        console.log(`USB Device PEQ: KTMicro sendReport gain/freq for filter ${i} sent`);

        console.log(`USB Device PEQ: KTMicro sending Q for filter ${i}:`, filters[i].q, writeQ);
        await device.sendReport(REPORT_ID, writeQ);
        console.log(`USB Device PEQ: KTMicro sendReport Q for filter ${i} sent`);
      }
    } catch (e) {
      console.log(`USB Device PEQ: KTMicro Error`, e);
      throw e;
    }

    if (deviceDetails.modelConfig.supportsPregain) {
      writePregain(device, globalGain);
    }

    const commit = buildCommand (COMMAND_COMMIT);
    console.log(`USB Device PEQ: KTMicro sending commit command:`, commit);
    await device.sendReport(REPORT_ID, commit);
    console.log(`USB Device PEQ: KTMicro sendReport commit sent`);

    await new Promise(resolve => setTimeout(resolve, 1000)); // Added 100ms delay

    console.log(`USB Device PEQ: KTMicro successfully pushed ${filters.length} filters to device`);
    if (deviceDetails.modelConfig.disconnectOnSave) {
      return true;    // Disconnect
    }
    return false;
  }

  const enablePEQ = async (deviceDetails, enable, slotId) => {

    // KT micro - has issue if device is PEQ was disabled we try to enable it
    var device = deviceDetails.rawDevice

    if (slotId === deviceDetails.modelConfig.disabledPresetId || enable === false) {
      slotId = deviceDetails.modelConfig.disabledPresetId; // Disable
      //await pushClearToDevice(device);
    }

    const enableEQPacket = buildEnableEQPacket(slotId);

    console.log(`USB Device PEQ: KTMicro enable PEQ request`, enableEQPacket);
    await device.sendReport(REPORT_ID, enableEQPacket);

  }

  return {
    getCurrentSlot,
    pushToDevice,
    pullFromDevice,
    enablePEQ,
  };
})();
