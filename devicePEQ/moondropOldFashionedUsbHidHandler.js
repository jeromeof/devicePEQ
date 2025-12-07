export const oldFashionedUsbHidHandler = (function () {
  const REPORT_ID = 75;
  const EQ_REG_BASE = 38;
  const WRITE_REG = 87;  // 'W'
  const SAVE_REG = 83;   // 'S'
  const READ_REG = 82;   // 'R'

  const PACKET_LEN = 10;
  const SCALE_GAIN = 10;
  const SCALE_Q = 1000;
  const DELAY_MS = 100;

  const ADDR = 0;
  const CMD = 4;
  const DATA_SLOT_GAIN = 6;
  const DATA_SLOT_Q = 6;
  const DATA_SLOT_FREQUENCY = 8;

  function sleep(ms = DELAY_MS) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getFilterRegAddr(filterIndex) {
    return EQ_REG_BASE + filterIndex * 2;
  }

  function createPacket(builder) {
    const buffer = new ArrayBuffer(PACKET_LEN);
    const view = new DataView(buffer);
    builder(view);
    return new Uint8Array(buffer);
  }

  async function readRegister(device, addr) {
    const packet = createPacket(view => {
      view.setUint8(ADDR, addr);
      view.setUint8(CMD, READ_REG);
    });

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading register");
      }, 1000);

      const onReport = (event) => {
        const data = new DataView(event.data.buffer);
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        resolve(data);
      };

      device.addEventListener("inputreport", onReport);
      await device.sendReport(REPORT_ID, packet);
    });
  }

  async function writeRegister(device, addr, dataBuilder) {
    const packet = createPacket(view => {
      view.setUint8(ADDR, addr);
      view.setUint8(CMD, WRITE_REG);
      dataBuilder(view);
    });
    await device.sendReport(REPORT_ID, packet);
  }

  async function readSingleFilter(device, filterIndex) {
    const regAddr = getFilterRegAddr(filterIndex);

    // Read frequency and gain from first register
    const data1 = await readRegister(device, regAddr);
    const freq = data1.getUint16(DATA_SLOT_FREQUENCY, true);
    const gainRaw = data1.getInt8(DATA_SLOT_GAIN);
    const gain = Math.max(-12.8, Math.min(12.7, gainRaw / SCALE_GAIN));

    await sleep();

    // Read Q from second register
    const data2 = await readRegister(device, regAddr + 1);
    const q = data2.getInt16(DATA_SLOT_Q, true) / SCALE_Q;

    return { freq, gain, q, type: "PK" };
  }

  async function pullFromDevice(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const filters = [];
    const filterCount = deviceDetails.modelConfig.maxFilters || 5;

    for (let i = 0; i < filterCount; i++) {
      const filter = await readSingleFilter(device, i);
      filters.push(filter);
      await sleep();
    }

    return { filters, globalGain: 0 };
  }

  async function writeSingleFilter(device, filterIndex, filter) {
    const regAddr = getFilterRegAddr(filterIndex);
    const { freq, gain, q } = filter;

    // Write frequency and gain to first register
    await writeRegister(device, regAddr, view => {
      const gainVal = Math.round(gain * SCALE_GAIN);
      const clampedGain = Math.max(-128, Math.min(127, gainVal));
      view.setInt8(DATA_SLOT_GAIN, clampedGain);
      view.setUint16(DATA_SLOT_FREQUENCY, freq, true);
    });

    await sleep();

    // Write Q to second register
    await writeRegister(device, regAddr + 1, view => {
      const qVal = Math.round(q * SCALE_Q);
      view.setInt16(DATA_SLOT_Q, qVal, true);
    });

    await sleep();
  }

  async function saveToFlash(device) {
    const packet = createPacket(view => {
      view.setUint8(CMD, SAVE_REG);
    });
    await device.sendReport(REPORT_ID, packet);
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;
    const filterCount = deviceDetails.modelConfig.maxFilters || 5;

    for (let i = 0; i < filters.length && i < filterCount; i++) {
      await writeSingleFilter(device, i, filters[i]);
    }

    await saveToFlash(device);
    console.log(`USB Device PEQ: Old Fashioned pushed ${filters.length} filters`);
    return false;
  }

  // Old-Fashioned devices do not expose multiple EQ preset slots (single active bank).
  // Provide a trivial implementation so the UI can treat it as slot 0.
  async function getCurrentSlot(deviceDetails) {
    return 0;
  }

  return {
    pullFromDevice,
    pushToDevice,
    getCurrentSlot,
    enablePEQ: async () => {},
  };
})();
