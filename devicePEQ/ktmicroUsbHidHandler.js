export const ktmicroUsbHidHandler = (function () {
  const FILTER_COUNT = 10;
  const REPORT_ID = 0x4b;
  const COMMAND_READ = 0x52;
  const COMMAND_WRITE = 0x57;
  const COMMAND_COMMIT = 0x53;

  function buildReadPacket(filterFieldToRequest) {
    return new Uint8Array([filterFieldToRequest, 0x00, 0x00, 0x00, COMMAND_READ, 0x00, 0x00, 0x00, 0x00]);
  }

  function decodeGainFreqResponse(data) {
    const gainRaw = data[6] | (data[7] << 8);
    const gain = gainRaw > 0x7FFF ? gainRaw - 0x10000 : gainRaw; // signed 16-bit
    const freq = data[8] + (data[9] << 8);
    return { gain: gain / 10.0, freq };
  }

  function decodeQResponse(data) {
    const q = (data[6] + (data[7] << 8)) / 1000.0;
    return { q };
  }

  async function getCurrentSlot() {
    return 101; // Tanchjim has only 1 slot - lets make up a value
  }

  async function readFullFilter(device, filterIndex) {
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
        console.log("Raw slot report received:", [...data]);
        if (data[4] !== COMMAND_READ) return;

        if (data[0] === gainFreqId) {
          Object.assign(result, decodeGainFreqResponse(data));
        } else if (data[0] === qId) {
          Object.assign(result, decodeQResponse(data));
        }

        if ('gain' in result && 'freq' in result && 'q' in result) {
          clearTimeout(timeout);
          device.removeEventListener('inputreport', onReport);
          result.type = "PK";
          resolve(result);
        }
      };

      device.addEventListener('inputreport', onReport);
      await device.sendReport(REPORT_ID, requestGainFreq);
      await device.sendReport(REPORT_ID, requestQ);
    });
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const filters = [];
    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      const filter = await readFullFilter(device, i);
      filters.push(filter);
    }
    return { filters, globalGain: 0 };
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

  function buildQPacket(filterId, q) {
    const qBytes = toLittleEndianBytes(q, 1000);
    return new Uint8Array([
      filterId, 0x00, 0x00, 0x00, COMMAND_WRITE, 0x00, qBytes[0], qBytes[1], 0x00, 0x00
    ]);
  }

  function buildCommit() {
    return new Uint8Array([
      0x00, 0x00, 0x00, 0x00, COMMAND_COMMIT, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;
    for (let i = 0; i < filters.length; i++) {
      if (i >= deviceDetails.modelConfig.maxFilters) break;

      const filterId = 0x26 + i * 2;
      const writeGainFreq = buildWritePacket(filterId, filters[i].freq, filters[i].gain);
      const writeQ = buildQPacket(filterId + 1, filters[i].q);

      // We should verify it is saved correctly but for now lets assume once command is accepted it has worked
      await device.sendReport(REPORT_ID, writeGainFreq);
      await device.sendReport(REPORT_ID, writeQ);
    }
    const commit = buildCommit();
    await device.sendReport(REPORT_ID, commit);
    if (deviceDetails.modelConfig.disconnectOnSave) {
      return true;    // Disconnect
    }
    return false;
  }

  return {
    getCurrentSlot,
    pushToDevice,
    pullFromDevice,
    enablePEQ: async () => {}, // Not applicable for Tanchjim
  };
})();
