const moondropUsbHID = (function() {
  const SET_REPORT = 0x09;
  const GET_REPORT = 0x01;
  const REPORT_ID = 1;
  const EQ_SLOT_READ = 0x03;
  const EQ_SLOT_WRITE = 0x04;

  async function connect(device) {
    try {
      if (!device.opened) {
        await device.open();
      }
      console.log("Moondrop Device connected");
    } catch (error) {
      console.error("Failed to connect to Moondrop Device:", error);
      throw error;
    }
  }

  async function getCurrentSlot(device) {
    try {
      let currentSlot = -99;
      const requestData = new Uint8Array([REPORT_ID, GET_REPORT, EQ_SLOT_READ]);
      const reportId = device.collections[0].outputReports[0].reportId;

      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] === REPORT_ID && data[1] === GET_REPORT) {
          currentSlot = data[3];
        }
      };

      await device.sendReport(reportId, requestData);

      return await waitForResponse(() => currentSlot > -99, device, 5000, () => currentSlot);
    } catch (error) {
      console.error("Failed to retrieve current EQ slot:", error);
      throw error;
    }
  }

  async function pullFromDevice(device, slot) {
    try {
      const filters = [];
      let globalGain = 0;
      let peqCount = 0;

      const requestData = new Uint8Array([REPORT_ID, GET_REPORT, EQ_SLOT_READ, slot]);
      const reportId = device.collections[0].outputReports[0].reportId;

      device.oninputreport = async (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] === REPORT_ID && data[1] === GET_REPORT) {
          peqCount = data[3];
          globalGain = data[4];
          for (let i = 0; i < peqCount; i++) {
            filters.push(parseFilterData(data.slice(5 + i * 6, 11 + i * 6)));
          }
        }
      };

      await device.sendReport(reportId, requestData);
      return await waitForResponse(() => filters.length === peqCount, device, 5000, () => ({ filters, globalGain }));
    } catch (error) {
      console.error("Failed to retrieve filters from Moondrop Device:", error);
      throw error;
    }
  }

  async function pushToDevice(device, slot, globalGain, filters) {
    try {
      const reportId = device.collections[0].outputReports[0].reportId;
      const requestData = new Uint8Array([REPORT_ID, SET_REPORT, EQ_SLOT_WRITE, slot, globalGain, filters.length, ...encodeFilters(filters)]);
      await device.sendReport(reportId, requestData);
      console.log("Filters pushed successfully");
    } catch (error) {
      console.error("Failed to push filters to Moondrop Device:", error);
      throw error;
    }
  }

  function parseFilterData(data) {
    return {
      freq: (data[0] << 8) | data[1],
      gain: (data[2] << 8) | data[3],
      q: (data[4] << 8) | data[5]
    };
  }

  function encodeFilters(filters) {
    let encoded = [];
    for (const filter of filters) {
      encoded.push(filter.freq >> 8, filter.freq & 0xFF, filter.gain >> 8, filter.gain & 0xFF, filter.q >> 8, filter.q & 0xFF);
    }
    return encoded;
  }

  function waitForResponse(condition, device, timeout, callback) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!condition()) {
          console.warn("Timeout waiting for response");
          reject(callback());
        } else {
          resolve(callback());
        }
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
    pushToDevice
  };
})();
