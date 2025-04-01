const SET_REPORT = 0x09;
const GET_REPORT = 0x01;
const REPORT_ID = 1;

const CMD_READ_EQ_SLOT = 0x1DD; // corresponds to 477 in decimal
const CMD_WRITE_EQ_SLOT = 0x0DC; // corresponds to 220
const CTRL_CAF_ID = 0x54524C43; // hex for 'CTRL'

// Slot range: 0–8 for Freeman3
const BAND_COUNT = 9;

export const moondropUsbHID = (function () {
  async function connect(deviceDetails) {
    var device = deviceDetails.rawDevice;
    if (!device.opened) {
      await device.open();
    }
    console.log("Moondrop Device connected");
  }

  async function getCurrentSlot(deviceDetails) {
    // For now: return hardcoded slot or extend later with dedicated command
    return 0;
  }

  async function pullFromDevice(deviceDetails, slot = 0) {
    const device = deviceDetails.rawDevice;
    const reportId = device.collections[0].outputReports[0].reportId;

    const filters = [];
    let completedCount = 0;

    device.oninputreport = (event) => {
      const data = new Uint8Array(event.data.buffer);
      if (data.length >= 34 && data[0] === REPORT_ID) {
        const band = data[14];
        const freq = (data[18] << 8) | data[19];
        const gain = ((data[30] << 24) | (data[31] << 16)) >> 16; // sign-extended
        const qRaw = (data[22] << 8) | data[23];
        const qFactor = qRaw / 256;

        filters[band] = { freq, gain, q: qFactor };
        completedCount++;
      }
    };

    for (let band = 1; band <= BAND_COUNT; band++) {
      const cmd = buildCafCmd(CMD_READ_EQ_SLOT, CTRL_CAF_ID, [band]);
      await device.sendReport(reportId, cmd);
    }

    return await waitForResponse(() => completedCount >= BAND_COUNT, device, 2000, () => filters);
  }

  async function pushToDevice(deviceDetails, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;
    const reportId = device.collections[0].outputReports[0].reportId;

    for (let band = 0; band < filters.length; band++) {
      const f = filters[band];
      const data = [
        0, // index 0: reserved or flag
        band + 1,
        f.freq,
        Math.round(f.q * 256),
        0, 0, 0, // unused?
        Math.round(f.gain * 256)
      ];
      const cmd = buildCafCmd(CMD_WRITE_EQ_SLOT, CTRL_CAF_ID, data);
      await device.sendReport(reportId, cmd);
    }

    const saveCmd = buildCafCmd(CMD_WRITE_EQ_SLOT, CTRL_CAF_ID, [0xFF]); // trigger save
    await device.sendReport(reportId, saveCmd);

    console.log("PEQ filters pushed successfully.");
  }

  function buildCafCmd(cmdId, cafId, data = []) {
    const buf = new Uint8Array(64);
    buf[0] = REPORT_ID;
    buf[1] = 0x04; // likely SET_REPORT
    buf[2] = 0x01; // slot or mode?
    buf[3] = cmdId & 0xFF;
    buf[4] = (cmdId >> 8) & 0xFF;
    buf[5] = 0x00;
    buf[6] = cafId & 0xFF;
    buf[7] = (cafId >> 8) & 0xFF;
    buf[8] = (cafId >> 16) & 0xFF;
    buf[9] = (cafId >> 24) & 0xFF;
    for (let i = 0; i < data.length; i++) {
      buf[10 + i * 4] = data[i] & 0xFF;
      buf[11 + i * 4] = (data[i] >> 8) & 0xFF;
      buf[12 + i * 4] = (data[i] >> 16) & 0xFF;
      buf[13 + i * 4] = (data[i] >> 24) & 0xFF;
    }
    return buf;
  }

  function waitForResponse(condition, device, timeout, callback) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout waiting for device response"));
      }, timeout);

      const interval = setInterval(() => {
        if (condition()) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(callback());
        }
      }, 100);
    });
  }

  return {
    connect,
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
  };
})();
