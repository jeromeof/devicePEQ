import { logHidTx, logHidRx } from './deviceDebugLog.js';

export const moondropUsbHidHandler = (function () {
  const FILTER_COUNT = 8;
  const REPORT_ID = 0x4b;
  const COMMAND_WRITE = 1;
  const COMMAND_READ = 128;
  const COMMAND_UPDATE_EQ = 9;
  const COMMAND_UPDATE_EQ_COEFF_TO_REG = 10;
  const COMMAND_SAVE_EQ_TO_FLASH = 1;
  const COMMAND_SAVE_OFFSET_TO_FLASH = 4;
  const COMMAND_SET_DAC_OFFSET = 3;
  const COMMAND_CLEAR_FLASH = 0x05;
  const COMMAND_CHANNEL_BALANCE = 0x16;
  const COMMAND_DAC_GAIN = 0x19;
  const COMMAND_DAC_MODE = 0x1D;
  const COMMAND_PRE_GAIN = 0x23;
  const COMMAND_LED_SWITCH = 0x18;
  const COMMAND_DAC_FILTER = 0x11;
  const COMMAND_VER = 0x0C;
  const COMMAND_RESET_EQ = 0x05;
  const COMMAND_RESET_FLASH = 0x17;
  const COMMAND_UPGRADE = 0xFF;
  const COMMAND_ACTIVE_EQ = 15;

  function buildReadPacket(filterIndex) {
    return new Uint8Array([COMMAND_READ, COMMAND_UPDATE_EQ, 0x18, 0x00, filterIndex, 0x00]);
  }

  function decodeFilterResponse(data) {
    const e = new Int8Array(data.buffer);

    const rawFreq = (e[27] & 0xff) | ((e[28] & 0xff) << 8);
    const freq = rawFreq;

    const q = ((e[30] << 8) | (e[29] & 255)) / 256;  // 16-bit fixed-point
    const gain = ((e[32] << 8) | (e[31] & 255)) / 256;
    const filterType = convertToFilterType(e[33]);
    const valid = freq > 10 && freq < 24000 && !isNaN(gain) && !isNaN(q);

    return {
      type: filterType,
      freq: valid ? freq : 0,
      q: valid ? q : 1.0,
      gain: valid ? gain : 0.0,
      disabled: !valid
    };
  }

  function convertToFilterType(byte) {
    switch (byte) {
      case 1: return "LSQ"; // Low Shelf (if seen in future captures)
      case 2: return "PK"; // Peaking
      case 3: return "HSQ"; // High Shelf (future-proof)
      default: return "PK";
    }
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
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received slot data:`, data);
        if (data[0] !== 0x80 || data[1] !== 0x0F) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        console.log(`USB Device PEQ: Moondrop current slot: ${data[3]}`);
        resolve(data[3]); // slot ID
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending getCurrentSlot command:`, request);
      logHidTx('Moondrop', 0x4B, request);
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
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received filter ${filterIndex} data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_UPDATE_EQ) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const filter = decodeFilterResponse(data);
        console.log(`USB Device PEQ: Moondrop filter ${filterIndex} decoded:`, filter);
        resolve(filter);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readFilter ${filterIndex} command:`, packet);
      logHidTx('Moondrop', REPORT_ID, packet);
      await device.sendReport(REPORT_ID, packet);
    });
  }

  async function readPregain(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_SET_DAC_OFFSET]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading pregain");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received pregain data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_SET_DAC_OFFSET) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);

        const r = new Int8Array(data.buffer);
        const pregain = (r[4] << 8 | r[3] & 255) / 256;

        console.log(`USB Device PEQ: Moondrop pregain value: ${pregain}`);
        resolve(pregain);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readPregain command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writePregain(device, value) {
    const val = Math.round(value * 256);
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_PRE_GAIN, 0, val & 255, (val >> 8) & 255]);
    console.log(`USB Device PEQ: Moondrop sending writePregain command:`, request);
    try {
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    } catch (e) {
      console.warn("USB Device PEQ: Moondrop failed to write pregain:", e);
    }
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const filters = [];

    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      const filter = await readFullFilter(device, i);
      filters.push(filter);
    }

    let globalGain = 0;
    try {
      globalGain = await readPregain(device);
    } catch (e) {
      console.warn("USB Device PEQ: Moondrop failed to read pregain, defaulting to 0:", e);
    }

    return {
      filters,
      globalGain
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

  // type defaults to 'PK' for back-compat with any caller still passing 3 args.
  // LSQ/HSQ previously fell through to this same peaking formula regardless
  // of type — that was a bug: shelf filters need their own coefficients, not
  // a peaking filter tagged with a shelf type byte. See walkplayHidHandler.js's
  // computeIIRFilter() for the full writeup of the shelf-alpha fix applied here
  // (verified against a real WebAudio BiquadFilterNode on real device captures).
  function encodeBiquad(freq, gain, q, type = 'PK') {
    const A = Math.pow(10, gain / 40);
    const w0 = (2 * Math.PI * freq) / 96000;
    const sinW0 = Math.sin(w0);
    const cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * q); // peaking-EQ alpha — correct for PK, NOT for LSQ/HSQ

    let a0, a1, a2, b0, b1, b2;

    if (type === 'LSQ' || type === 'HSQ') {
      const shelfAlpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
      const s = 2 * Math.sqrt(A) * shelfAlpha;
      if (type === 'LSQ') {
        b0 =    A * ((A + 1) - (A - 1) * cosW0 + s);
        b1 =  2*A * ((A - 1) - (A + 1) * cosW0);
        b2 =    A * ((A + 1) - (A - 1) * cosW0 - s);
        a0 =         (A + 1) + (A - 1) * cosW0 + s;
        a1 =    -2 * ((A - 1) + (A + 1) * cosW0);
        a2 =         (A + 1) + (A - 1) * cosW0 - s;
      } else { // HSQ
        b0 =     A * ((A + 1) + (A - 1) * cosW0 + s);
        b1 =  -2*A * ((A - 1) + (A + 1) * cosW0);
        b2 =     A * ((A + 1) + (A - 1) * cosW0 - s);
        a0 =          (A + 1) - (A - 1) * cosW0 + s;
        a1 =      2 * ((A - 1) - (A + 1) * cosW0);
        a2 =          (A + 1) - (A - 1) * cosW0 - s;
      }
    } else { // PK (default) — original formula, unchanged
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
    }

    const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
    return [nb0, nb1, nb2, -na1, -na2].map(c => Math.round(c * 1073741824));
  }

  // Alternate coefficient formula seen in a different vendor's reversed web tool (used there
  // for a Savitech-chipset device, see savitechUsbHidHandler.js). Same peaking-EQ shape but
  // A = 10^(gain/20) instead of 10^(gain/40). NOT wired up anywhere yet - modelConfig.biquadFormula
  // must be explicitly set to "savitechStyle" to opt in, and nothing does that today. Exists so
  // it can be A/B tested against the default formula above without touching working devices.
  // NOTE: peaking-only, same as encodeBiquad() was before its LSQ/HSQ fix above — if this is
  // ever wired up for a device that also uses shelf filters, it needs the same fix, but nothing
  // does today so it's untouched (no real capture data exists to verify a shelf fix against this
  // formula's different A=10^(gain/20) convention).
  function encodeBiquadSavitechStyle(freq, gain, q) {
    const A = Math.pow(10, gain / 20);
    const w0 = (2 * Math.PI * freq) / 96000;
    const alpha = Math.sin(w0) / (2 * q);
    const sqrtA = Math.sqrt(A);
    const alphaA = alpha * sqrtA;
    const alphaOverA = alpha / sqrtA;
    const norm = 1 / (alphaOverA + 1);
    const cosW0 = Math.cos(w0);

    const b0 = (1 + alphaA) * norm;
    const b1 = -2 * cosW0 * norm;
    const b2 = (1 - alphaA) * norm;
    const a1 = 2 * cosW0 * norm;
    const a2 = -(1 - alphaOverA) * norm;

    return [b0, b1, b2, a1, a2].map(c => Math.round(c * 1073741824));
  }

  function encodeBiquadForModel(freq, gain, q, type, modelConfig) {
    return modelConfig?.biquadFormula === "savitechStyle"
      ? encodeBiquadSavitechStyle(freq, gain, q)
      : encodeBiquad(freq, gain, q, type);
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

  function buildWritePacket(filterIndex, { freq, gain, q, type }, modelConfig) {
    const packet = new Uint8Array(63);
    packet[0] = COMMAND_WRITE;
    packet[1] = COMMAND_UPDATE_EQ;
    packet[2] = 0x18; // bLength
    packet[3] = 0x00;
    packet[4] = filterIndex;
    packet[5] = 0x00;
    packet[6] = 0x00;

    const coeffs = encodeToByteArray(encodeBiquadForModel(freq, gain, q, type, modelConfig));
    packet.set(coeffs, 7);

    packet[27] = freq & 0xff;
    packet[28] = (freq >> 8) & 0xff;
    const qVal = Math.round(q * 256);
    packet[29] = qVal & 255;
    packet[30] = (qVal >> 8) & 255;

    const gainVal = Math.round(gain * 256);
    packet[31] = gainVal & 255;
    packet[32] = (gainVal >> 8) & 255;
    packet[33] = convertFromFilterType(type); // 2 by default
    packet[34] = 0;
    packet[35] = 7; // peqIndex

    return packet;
  }

  function convertFromFilterType(filterType) {
    const mapping = {"PK": 2, "LSQ": 1, "HSQ": 3};
    return mapping[filterType] !== undefined ? mapping[filterType] : 2;
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
    return new Uint8Array([COMMAND_WRITE, COMMAND_SAVE_EQ_TO_FLASH]);
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;

    for (let i = 0; i < filters.length && i < deviceDetails.modelConfig.maxFilters; i++) {
      const writeFilter = buildWritePacket(i, filters[i], deviceDetails.modelConfig);
      console.log(`USB Device PEQ: Moondrop sending filter ${i} data:`, filters[i], writeFilter);
      logHidTx('Moondrop', REPORT_ID, writeFilter);
      await device.sendReport(REPORT_ID, writeFilter);

      const enable = buildEnablePacket(i);
      console.log(`USB Device PEQ: Moondrop sending enable command for filter ${i}:`, enable);
      logHidTx('Moondrop', REPORT_ID, enable);
      await device.sendReport(REPORT_ID, enable);
    }

    // Moondrop devices with supportGlobalGain:true (all except Old Fashioned) automatically
    // compute gain headroom from the written biquad coefficients. Writing an explicit pregain
    // on top of that causes double gain reduction. Only write pregain when deviceHandlesPregain
    // is explicitly false (meaning the host must manage it).
    if (globalGain !== 0 && deviceDetails.modelConfig.deviceHandlesPregain === false) {
      await writePregain(device, globalGain);
      console.log(`USB Device PEQ: Moondrop set pregain to ${globalGain}`);
    }

    const save = buildSavePacket();
    console.log(`USB Device PEQ: Moondrop sending save command:`, save);
    logHidTx('Moondrop', REPORT_ID, save);
    await device.sendReport(REPORT_ID, save);

    console.log(`USB Device PEQ: Moondrop successfully pushed ${filters.length} filters to device`);
    return false;
  }

  async function readVer(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_VER]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading version");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received version data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_VER) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const version = `${data[3]}.${data[4]}.${data[5]}`;
        console.log(`USB Device PEQ: Moondrop version: ${version}`);
        resolve(version);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readVer command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function readChannelBalance(device, lr) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_CHANNEL_BALANCE, 0, lr]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading channel balance");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received channel balance data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_CHANNEL_BALANCE) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const balance = data[5];
        console.log(`USB Device PEQ: Moondrop channel balance value: ${balance}`);
        resolve(balance);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readChannelBalance command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writeChannelBalance(device, lr, db) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_CHANNEL_BALANCE, 0, lr, 0, db, 0]);
    console.log(`USB Device PEQ: Moondrop sending writeChannelBalance command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function readDACGain(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_DAC_GAIN, 0]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading DAC gain");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received DAC gain data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_DAC_GAIN) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const gain = data[3];
        console.log(`USB Device PEQ: Moondrop DAC gain value: ${gain}`);
        resolve(gain);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readDACGain command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writeDACGain(device, vl) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_DAC_GAIN, 1, vl]);
    console.log(`USB Device PEQ: Moondrop sending writeDACGain command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function readDACMode(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_DAC_MODE, 0]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading DAC mode");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received DAC mode data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_DAC_MODE) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const mode = data[3];
        console.log(`USB Device PEQ: Moondrop DAC mode value: ${mode}`);
        resolve(mode);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readDACMode command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writeDACMode(device, vl) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_DAC_MODE, 1, vl]);
    console.log(`USB Device PEQ: Moondrop sending writeDACMode command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function readLEDSwitch(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_LED_SWITCH, 0]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading LED switch");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received LED switch data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_LED_SWITCH) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const ledSwitch = data[3];
        console.log(`USB Device PEQ: Moondrop LED switch value: ${ledSwitch}`);
        resolve(ledSwitch);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readLEDSwitch command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writeLEDSwitch(device, vl) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_LED_SWITCH, 1, vl]);
    console.log(`USB Device PEQ: Moondrop sending writeLEDSwitch command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function readDACFilter(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([COMMAND_READ, COMMAND_DAC_FILTER, 0]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading DAC filter");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('Moondrop', data);
        console.log(`USB Device PEQ: Moondrop onInputReport received DAC filter data:`, data);
        if (data[0] !== COMMAND_READ || data[1] !== COMMAND_DAC_FILTER) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        const filter = data[3];
        console.log(`USB Device PEQ: Moondrop DAC filter value: ${filter}`);
        resolve(filter);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Moondrop sending readDACFilter command:`, request);
      logHidTx('Moondrop', REPORT_ID, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

  async function writeDACFilter(device, vl) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_DAC_FILTER, 1, vl]);
    console.log(`USB Device PEQ: Moondrop sending writeDACFilter command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function resetEQ(device) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_RESET_EQ, 1, 4, 0]);
    console.log(`USB Device PEQ: Moondrop sending resetEQ command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function resetFlash(device) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_RESET_FLASH, 0]);
    console.log(`USB Device PEQ: Moondrop sending resetFlash command:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  async function setEQIndex(device, index) {
    const request = new Uint8Array([COMMAND_WRITE, COMMAND_ACTIVE_EQ, index]);
    console.log(`USB Device PEQ: Moondrop sending setEQIndex command for slot ${index}:`, request);
    logHidTx('Moondrop', REPORT_ID, request);
    await device.sendReport(REPORT_ID, request);
  }

  return {
    getCurrentSlot,
    setEQIndex,
    pullFromDevice,
    pushToDevice,
    enablePEQ: async () => {}
  };
})();
