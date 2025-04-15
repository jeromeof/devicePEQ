export const moondropUsbHidHandler = (function () {
  const FILTER_COUNT = 8;
  const REPORT_ID = 0x4b;
  const COMMAND_WRITE = 1;
  const COMMAND_READ = 128;
  const COMMAND_UPDATE_EQ = 9;
  const COMMAND_UPDATE_EQ_COEFF_TO_REG = 10;
  const COMMAND_SAVE_EQ_TO_FLASH = 1;
  const COMMAND_SET_DAC_OFFSET = 3;

  function buildReadPacket(filterIndex) {
    return new Uint8Array([COMMAND_READ, COMMAND_UPDATE_EQ, 0, 0, filterIndex]);
  }

  function decodeFilterResponse(data) {
    const e = new Int8Array(data.buffer);

    const freq = (e[28] & 0xff) | ((e[29] & 0xff) << 8);
    const q = (e[30] & 0xff) + (e[29] & 0xff) / 256;
    const gain = e[32] + (e[31] & 0xff) / 256;

    return {
      type: "PK",
      freq,
      q,
      gain,
    };
  }

  async function getCurrentSlot(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const request = new Uint8Array([0x80, 0x0F, 0x00]); // READ, SET_ACTIVE_EQ, bLength = 0

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading current slot");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== 0x80 || data[1] !== 0x0F) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        resolve(data[3]); // slot ID
      };

      device.addEventListener("inputreport", onReport);
      await device.sendReport(0x4B, request);
    });
  }

  async function readFullFilter(device, filterIndex) {
    const packet = buildReadPacket(filterIndex);

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading filter");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_UPDATE_EQ) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        resolve(decodeFilterResponse(data));
      };

      device.addEventListener("inputreport", onReport);
      await device.sendReport(REPORT_ID, packet);
    });
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const filters = [];

    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      const filter = await readFullFilter(device, i);
      filters.push(filter);
    }

    return {
      filters,
      globalGain: 0,
    };
  }

  function toLittleEndianBytes(value, scale = 1) {
    const v = Math.round(value * scale);
    return [v & 0xff, (v >> 8) & 0xff];
  }

  function toSignedLittleEndianBytes(value, scale = 1) {
    let v = Math.round(value * scale);
    if (v < 0) v += 0x10000;
    return [v & 0xff, (v >> 8) & 0xff];
  }

  function encodeBiquad(freq, gain, q) {
    const A = Math.pow(10, gain / 40);
    const w0 = (2 * Math.PI * freq) / 96000;
    const alpha = Math.sin(w0) / (2 * q);
    const cosW0 = Math.cos(w0);
    const norm = 1 + alpha / A;

    const b0 = (1 + alpha * A) / norm;
    const b1 = (-2 * cosW0) / norm;
    const b2 = (1 - alpha * A) / norm;
    const a1 = -b1;
    const a2 = (1 - alpha / A) / norm;

    return [b0, b1, b2, a1, -a2].map(c => Math.round(c * 1073741824));
  }

  function encodeToByteArray(coeffs) {
    const arr = new Uint8Array(20);
    for (let i = 0; i < coeffs.length; i++) {
      const val = coeffs[i];
      arr[i * 4] = val & 0xff;
      arr[i * 4 + 1] = (val >> 8) & 0xff;
      arr[i * 4 + 2] = (val >> 16) & 0xff;
      arr[i * 4 + 3] = (val >> 24) & 0xff;
    }
    return arr;
  }

  function buildWritePacket(filterIndex, { freq, gain, q }) {
    const packet = new Uint8Array(63);
    packet[0] = COMMAND_WRITE;
    packet[1] = COMMAND_UPDATE_EQ;
    packet[2] = 0; // bLength
    packet[3] = 0;
    packet[4] = filterIndex;

    const coeffs = encodeToByteArray(encodeBiquad(freq, gain, q));
    packet.set(coeffs, 7);

    packet[27] = freq & 0xff;
    packet[28] = (freq >> 8) & 0xff;
    packet[29] = Math.round(q % 1 * 256);
    packet[30] = Math.floor(q);
    packet[31] = Math.round(gain % 1 * 256);
    packet[32] = Math.floor(gain);
    packet[33] = 2; // Filter type PEAKING
    packet[34] = 0;
    packet[35] = 7; // peqIndex

    return packet;
  }

  function buildEnablePacket(filterIndex) {
    const packet = new Uint8Array(63);
    packet[0] = COMMAND_WRITE;
    packet[1] = COMMAND_UPDATE_EQ_COEFF_TO_REG;
    packet[2] = filterIndex;
    packet[3] = 0;
    packet[4] = 255;
    packet[5] = 255;
    packet[6] = 255;
    return packet;
  }

  function buildSavePacket() {
    return new Uint8Array([COMMAND_WRITE, COMMAND_SAVE_EQ_TO_FLASH, 0]);
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;

    for (let i = 0; i < filters.length && i < deviceDetails.modelConfig.maxFilters; i++) {
      const writeFilter = buildWritePacket(i, filters[i]);
      await device.sendReport(REPORT_ID, writeFilter);

      const enable = buildEnablePacket(i);
      await device.sendReport(REPORT_ID, enable);
    }

    const save = buildSavePacket();
    await device.sendReport(REPORT_ID, save);

    return false;
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ: async () => {}, // not required for Moondrop
  };
})();
