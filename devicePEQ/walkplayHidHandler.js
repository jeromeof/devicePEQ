//
// Copyright 2024 : Pragmatic Audio
//
// Walkplay USB HID Handler
// ────────────────────────
// Shared protocol implementation for all Walkplay-chipset USB DAC/dongle devices.
// Used by SchemeNo10, 11, 13, 15, 16, 17, 18, 19, 20, 21 device groups.
//
// Example device: CrinEar Protocol Max (vendorId=0x3302, productId=0x43CC, SchemeNo16)
//   — 10-band PEQ (±10 dB, LS+HS), DAC filter, DAC balance, DAC work mode, gain mode
//   — Capture: tests/captures/walkplay_schemeno16_protocol_max.json
//   — Reference: tests/captures/walkplay_schemeno16_protocol_max_walkplay_site.json
//
// Protocol: reportId=0x4B (75), READ=0x80, WRITE=0x01, END=0x00
// Many thanks to ma0shu for providing a dump
//
// ── Core PEQ API (required by all connectors) ─────────────────────────────────
//   getCurrentSlot(deviceDetails)                       → slot id
//   pullFromDevice(deviceDetails, slot)                 → { filters, globalGain, currentSlot }
//   pushToDevice(deviceDetails, phoneObj, slot, gain, filters)
//   enablePEQ(deviceDetails, enable, slotId)
//
// ── Extras API (exposed via deviceExtras.js / plugin showExtras:true) ─────────
// Extras are scheme-gated in peqConstraintsConfig.json. The plugin renders a
// collapsible "Show Extras" panel that reads current values on first open and
// applies changes via Apply buttons.
//
//   CMD  Name            Schemes      Description
//   0x02 micGain         ALL          ADC/input gain ±15 dB, 16-bit signed (CB1300D hardware).
//                                     Confirmed on SchemeNo11 and SchemeNo16 (Protocol Max)
//                                     via walkplayPreprocessor/walkplay.js analysis.
//                                     setMicGain(deviceDetails, dB) / readMicGain(deviceDetails)
//
//   0x03 outputGain      ALL          DAC output gain register, 1 byte signed.
//                                     Written during pushToDevice when deviceHandlesPregain=false.
//                                     setOutputGain(deviceDetails, gainDb)
//
//   0x11 dacFilter       ALL          DSP interpolation filter algorithm:
//                                       1=FAST-LL  2=FAST-PC  3=SLOW-LL  4=SLOW-PC  5=NON-OS
//                                     setDacFilter(deviceDetails, type) / readDacFilter(deviceDetails)
//
//   0x16 dacBalance      ALL          Left/right channel amplitude trim.
//                                     Pass leftDelta>0 to boost left, rightDelta>0 to boost right,
//                                     both 0 to centre. Units are device-native (0–127).
//                                     setDacBalance(deviceDetails, leftDelta, rightDelta)
//
//   0x19 gainMode        SchemeNo16+  Alternative gain-processing mode (Low Gain / High Gain).
//                                     Boolean: false=Low Gain, true=High Gain.
//                                     setGainMode(deviceDetails, bool) / readGainMode(deviceDetails)
//
//   0x1B denoise         SchemeNo11   ENC/noise-cancellation circuit toggle.
//                                     setDenoiseEnabled(deviceDetails, bool) / readDenoiseEnabled(deviceDetails)
//
//   0x1D dacWorkMode     ALL          DAC operational mode: 0=Class AB, 1=Class H.
//                                     setDacWorkMode(deviceDetails, mode) / readDacWorkMode(deviceDetails)
//
// ── globalGainBuffer ──────────────────────────────────────────────────────────
// Walkplay hardware applies a fixed -5 dB offset at the DAC stage (modelConfig
// globalGainBuffer: -5). During pushToDevice the gain register receives only the
// delta beyond this buffer: Math.min(0, preamp - buffer). So a -3 dB preamp
// writes 0 (hardware covers it), a -7 dB preamp writes -2 (hardware -5 + reg -2).
//

export const walkplayUsbHID = (function () {
  const REPORT_ID = 0x4B;
  const ALT_REPORT_ID = 0x3C;
  const READ = 0x80;
  const WRITE = 0x01;
  const END = 0x00;
  const CMD = {
    FLASH_EQ:    0x01,
    MIC_GAIN:    0x02,  // ADC/input gain, 16-bit signed ±32767 = ±15 dB (available on all schemes)
    GLOBAL_GAIN: 0x03,  // DAC output gain / global EQ offset, 1 byte
    PEQ_VALUES:  0x09,
    TEMP_WRITE:  0x0A,
    VERSION:     0x0C,
    GET_SLOT:    0x0F,
    DAC_FILTER:  0x11,  // DSP filter algorithm: 1=FAST-LL, 2=FAST-PC, 3=SLOW-LL, 4=SLOW-PC, 5=NON-OS
    DAC_BALANCE:  0x16,  // Left/right channel balance
    GAIN_MODE:    0x19,  // Alternative gain-processing mode toggle — boolean (0=off, 1=on). SchemeNo16/Protocol Max confirmed.
    DENOISE:      0x1B,  // ENC/noise-cancellation toggle
    DAC_WORK_MODE: 0x1D, // DAC operational mode (0=normal, 1=alternate)
  };

  const DEFAULT_FILTER_COUNT = 8;

  const getCurrentSlot = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");

    // Register listeners BEFORE sending so responses are never missed.
    // (On real hardware latency is long enough that send-then-listen works,
    // but registering first is the correct pattern and required for testing.)

    // Get the version number first
    const versionResponsePromise = waitForResponse(device, CMD.VERSION);
    await sendReport(device, REPORT_ID, [READ, CMD.VERSION, END]);
    var response = await versionResponsePromise;
    const versionBytes = response.slice(3, 6);
    const version = String.fromCharCode(...versionBytes);

    console.log("USB Device PEQ: Walkplay firmware version:", version);
    const versionNumber = parseFloat(version);

    if (isNaN(versionNumber)) {
      console.warn("Could not parse firmware version:", versionNumber);
      deviceDetails.version = null;
    }

    // Save version number to deviceDetails
    deviceDetails.version = versionNumber;

    console.log("Fetching current EQ slot...");

    const slotResponsePromise = waitForResponse(device, CMD.PEQ_VALUES);
      await sendReport(device, REPORT_ID, [READ, CMD.PEQ_VALUES, END]);
    response = await slotResponsePromise;
    // Slot is at byte 36 in the full HID packet (including report ID).
    // Web HID strips the report ID, so it's at index 35 here.
    const slot = response ? response[35] : -1;

    console.log("Walkplay current EQ slot:", slot);
    return slot;
  };

  // Push PEQ settings to Walkplay device
  const pushToDevice = async (deviceDetails, phoneObj, slot, globalGain, filtersToWrite) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log("Pushing PEQ settings...");
    if (typeof slot === "string" )  // Convert from string
      slot = parseInt(slot, 10);

    const useAltReport = false;

    for (let i = 0; i < filtersToWrite.length; i++) {
      const filter = filtersToWrite[i];
      const bArr = computeIIRFilter(i, filter.freq, filter.gain, filter.q);

      const packet = [
        WRITE, CMD.PEQ_VALUES, 0x18, 0x00, i, 0x00, 0x00,
        ...bArr,
        ...convertToByteArray(filter.freq, 2),
        ...convertToByteArray(Math.round(filter.q * 256), 2),
        ...convertToByteArray(Math.round(filter.gain * 256), 2),
        convertFromFilterType(filter.type),
        0x00,
        (deviceDetails.modelConfig && typeof deviceDetails.modelConfig.defaultIndex !== 'undefined') ? deviceDetails.modelConfig.defaultIndex : slot,
        END
      ];

      await sendReport(device, useAltReport ? ALT_REPORT_ID : REPORT_ID, packet);
      await delay(20); // Add delay between filter writes to prevent overwhelming the device
    }

    // Wait for device to process all filter writes
    await delay(100);

    if (deviceDetails.modelConfig.deviceHandlesPregain === false) {
      const buffer = deviceDetails.modelConfig.globalGainBuffer ?? null;
      // When a fixed hardware buffer exists, write only the delta beyond it (clamped to 0).
      // e.g. preamp=-7dB, buffer=-5dB → write -2dB; preamp=-3dB → write 0 (hardware covers it).
      const gainToWrite = buffer !== null ? Math.min(0, globalGain - buffer) : globalGain;
      await writeGlobalGain(device, gainToWrite);
      console.log(`USB Device PEQ: Walkplay set global gain register to ${gainToWrite} dB (preamp ${globalGain} dB, hardware buffer ${buffer} dB)`);
      await delay(50);
    }

    // Commit sequence matching Walkplay app order:
    // [1, 5, 0] and [1, 23, 0] before TEMP_WRITE, then plain [1, 1, 0] for flash.
    // The slot is already embedded at byte [35] of each filter packet — FLASH_EQ
    // just says "persist registers to flash" and takes no slot argument.
    await sendReport(device, REPORT_ID, [WRITE, 0x05, END]);
    await delay(20);
    await sendReport(device, REPORT_ID, [WRITE, 0x17, END]);
    await delay(20);
    await sendReport(device, REPORT_ID, [WRITE, CMD.TEMP_WRITE, 0x04, 0x00, 0x00, 0xFF, 0xFF, END]);
    await delay(50);
    await sendReport(device, REPORT_ID, [WRITE, CMD.FLASH_EQ, END]);

    console.log("PEQ filters successfully pushed to Walkplay device.");
  };

  // Mic gain range: -15..+15 dB, encoded as 16-bit signed scaled by 32767/15.
  // Special cases from website source: +15 → 32767, -15 → 32769.
  const setMicGain = async (deviceDetails, value) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    let t;
    if (value === 15) {
      t = 32767;
    } else if (value === -15) {
      t = 32769;
    } else {
      let r = Math.round(value * (32767 / 15));
      r = Math.max(-32767, Math.min(32767, r));
      t = r < 0 ? r + 65536 : r;
    }
    const lsb = t & 0xFF;
    const msb = (t >> 8) & 0xFF;
    const request = [WRITE, CMD.MIC_GAIN, 0x02, lsb, msb];
    console.log(`USB Device PEQ: Walkplay set mic gain to ${value}dB (encoded: ${t})`);
    await sendReport(device, REPORT_ID, request);
  };

  const readMicGain = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");

    return new Promise((resolve, reject) => {
      const request = [READ, CMD.MIC_GAIN, 0x00];

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading mic gain");
      }, 1000);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== READ || data[1] !== CMD.MIC_GAIN) return;

        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);

        // 16-bit unsigned little-endian → signed → dB
        const raw = data[2] | (data[3] << 8);
        const signed = raw > 32767 ? raw - 65536 : raw;
        const micGain = Math.round((signed * 15 / 32767) * 100) / 100;
        console.log(`USB Device PEQ: Walkplay mic gain value: ${micGain}dB (raw: ${raw})`);
        resolve(micGain);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Walkplay sending readMicGain command:`, request);
      sendReport(device, REPORT_ID, request).catch(reject);
    });
  };

  function convertFromFilterType(filterType) {
    const mapping = {"PK": 2, "LSQ": 1, "HSQ": 3, "LP": 4, "HP": 5};
    return mapping[filterType] !== undefined ? mapping[filterType] : 2;
  }

  const pullFromDevice = async (deviceDetails, slot = -1) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");

    const filters = [];
    // Use the slot passed in from getCurrentSlot — per-filter responses don't
    // reliably carry the slot at offset 35 (that offset is from the bulk ReadEQ
    // response format, not the per-filter variant).
    const currentSlot = slot;

    const onFilterReport = (event) => {
      const data = new Uint8Array(event.data.buffer);
      console.log(`USB Device PEQ: Walkplay pullFromDevice onInputReport received data:`, data);
      if (data[1] !== CMD.PEQ_VALUES) return; // ignore unrelated reports
      if (data.length >= 32) {
        const filter = parseFilterPacket(data);
        console.log(`USB Device PEQ: Walkplay parsed filter ${filter.filterIndex}:`, filter);
        filters[filter.filterIndex] = filter;
      }
    };

    device.addEventListener('inputreport', onFilterReport);

    // Send requests for each filter with increased delay
    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      await sendReport(device, REPORT_ID, [READ, CMD.PEQ_VALUES, 0x00, 0x00, i, END]);
      await delay(50); // Increased delay between requests
    }

    // Check for missing filters after initial requests
    await delay(100); // Wait a bit after sending all requests

    // Wait for filters with increased timeout
    const result = await waitForFilters(() => {
      return filters.filter(f => f !== undefined).length === deviceDetails.modelConfig.maxFilters;
    }, device, 10000, () => ({  // Increased timeout to 15 seconds
      filters,
      globalGain: 0, // Will be updated after waiting for filters
      currentSlot,
      deviceDetails: deviceDetails.modelConfig,
    }));

    device.removeEventListener('inputreport', onFilterReport);


    // Read global gain after waiting for filters
    let globalGain = 0;
    try {
      globalGain = await readGlobalGain(device);
      console.log(`USB Device PEQ: Walkplay read global gain: ${globalGain}dB`);
      // Update the result with the global gain
      result.globalGain = globalGain;
    } catch (error) {
      console.warn(`USB Device PEQ: Walkplay failed to read global gain: ${error}`);
    }

    console.log("Pulled PEQ filters from Walkplay:", result);
    return result;
  };

  function parseFilterPacket(packet) {
    if (packet.length < 32) {
      throw new Error("Packet too short to contain filter data.");
    }

    const filterIndex = packet[4];

    // Frequency (little-endian 16-bit)
    const freq = packet[27] | (packet[28] << 8);

    // Q factor (8.8 fixed-point)
    const qRaw = packet[29] | (packet[30] << 8);
    const q = Math.round((qRaw / 256) * 100) / 100;

    // Gain (8.8 fixed-point signed)
    let gainRaw = packet[31] | (packet[32] << 8);
    if (gainRaw > 32767) gainRaw -= 65536;
    const gain = Math.round((gainRaw / 256) * 100) / 100;

    // Filter type —
    const type = convertToFilterType(packet[33]);

    return {
      filterIndex,
      freq,
      q,
      gain,
      type,
      disabled: !(freq || q || gain)
    };
  }

  function convertToFilterType(byte) {
    switch (byte) {
      case 1: return "LSQ";
      case 2: return "PK";
      case 3: return "HSQ";
      case 4: return "LP";
      case 5: return "HP";
      default: return "PK";
    }
  }
  const enablePEQ = async (deviceDetails, enable, slotId) => {
    const device = deviceDetails.rawDevice;
    if (!enable) {
      slotId = 0x00;
    }
    const packet = [WRITE, CMD.FLASH_EQ, enable ? 1:0, slotId, END];
    await sendReport(device, REPORT_ID, packet);
  };


// Internal functions
  async function sendReport(device, reportId, packet) {
    if (!device) throw new Error("Device not connected.");
    const data = new Uint8Array(packet);
    console.log(`USB Device PEQ: Walkplay sending report (ID: ${reportId}):`, data);
    await device.sendReport(reportId, data);
  }

// Wait for response matching a specific command byte (data[1] without report ID)
  async function waitForResponse(device, expectedCmd = null, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        console.log(`USB Device PEQ: Walkplay timeout waiting for response after ${timeout}ms`);
        reject("Timeout waiting for HID response");
      }, timeout);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (expectedCmd !== null && data[1] !== expectedCmd) return; // skip unrelated reports
        clearTimeout(timer);
        device.removeEventListener("inputreport", onReport);
        console.log(`USB Device PEQ: Walkplay received response:`, data);
        resolve(data);
      };

      device.addEventListener("inputreport", onReport);
    });
  }

  // Read global gain from device
  async function readGlobalGain(device) {
    return new Promise(async (resolve, reject) => {
      const request = new Uint8Array([READ, CMD.GLOBAL_GAIN, 0x00]);

      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading global gain");
      }, 100);

      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        console.log(`USB Device PEQ: Walkplay onInputReport received global gain data:`, data);
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        if (data[0] !== READ || data[1] !== CMD.GLOBAL_GAIN) return;
        const int8 = new Int8Array([data[4]])[0];
        const globalGain = int8;
        console.log(`USB Device PEQ: Walkplay global gain value: ${globalGain}`);
        resolve(globalGain);
      };

      device.addEventListener("inputreport", onReport);
      console.log(`USB Device PEQ: Walkplay sending readGlobalGain command:`, request);
      await device.sendReport(REPORT_ID, request);
    });
  }

// Write global gain to device
  async function writeGlobalGain(device, value) {
    const gainValue = Math.round(value);
    // Match attached KeyX JS format: [WRITE, GLOBAL_GAIN, 0x02, 0x00, gain]
    const request = new Uint8Array([WRITE, CMD.GLOBAL_GAIN, 0x02, 0x00, gainValue]);
    console.log(`USB Device PEQ: Walkplay sending writeGlobalGain command:`, request);
    await device.sendReport(REPORT_ID, request);
  }

  // DAC_FILTER (0x11): select the DAC's DSP filter algorithm.
  // filterType: 'FAST-LL' | 'FAST-PC' | 'SLOW-LL' | 'SLOW-PC' | 'NON-OS'
  const setDacFilter = async (deviceDetails, filterType) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    const filterMap = { 'FAST-LL': 1, 'FAST-PC': 2, 'SLOW-LL': 3, 'SLOW-PC': 4, 'NON-OS': 5 };
    const filterByte = filterMap[filterType] ?? 1;
    console.log(`USB Device PEQ: Walkplay set DAC filter to ${filterType} (${filterByte})`);
    await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_FILTER, 0x01, filterByte]);
  };

  // DAC_BALANCE (0x16): left/right channel trim in device units (typically 0..127).
  // Pass leftDelta > 0 to boost left, rightDelta > 0 to boost right, both 0 to center.
  const setDacBalance = async (deviceDetails, leftDelta, rightDelta) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    if (leftDelta > 0) {
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x01, 0x00, leftDelta & 0xFF, 0x00]);
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x00, 0x00, 0x00, 0x00]);
    } else if (rightDelta > 0) {
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x01, 0x00, 0x00, 0x00]);
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x00, 0x00, rightDelta & 0xFF, 0x00]);
    } else {
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x00, 0x01, 0x00, 0x00]);
      await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_BALANCE, 0x04, 0x00, 0x00, 0x00, 0x00]);
    }
  };

  // DENOISE (0x1B): enable or disable the ENC/noise-reduction circuit.
  const setDenoiseEnabled = async (deviceDetails, enabled) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log(`USB Device PEQ: Walkplay set denoise ${enabled ? 'on' : 'off'}`);
    await sendReport(device, REPORT_ID, [WRITE, CMD.DENOISE, 0x01, enabled ? 0x01 : 0x00]);
  };

  // Read current ENC/denoise state. Returns true if enabled, false if disabled.
  const readDenoiseEnabled = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading denoise state");
      }, 2000);
      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== READ || data[1] !== CMD.DENOISE) return;
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        resolve(data[3] === 0x01);
      };
      device.addEventListener("inputreport", onReport);
      sendReport(device, REPORT_ID, [READ, CMD.DENOISE, 0x00]).catch(reject);
    });
  };

  // Read the current DAC filter algorithm. Returns the filter name string or null.
  const readDacFilter = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    const filterNames = { 1: 'FAST-LL', 2: 'FAST-PC', 3: 'SLOW-LL', 4: 'SLOW-PC', 5: 'NON-OS' };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading DAC filter");
      }, 2000);
      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== READ || data[1] !== CMD.DAC_FILTER) return;
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        // Response format: [READ, CMD, len, value] — value is at data[3]
        resolve(filterNames[data[3]] ?? null);
      };
      device.addEventListener("inputreport", onReport);
      sendReport(device, REPORT_ID, [READ, CMD.DAC_FILTER]).catch(reject);
    });
  };

  // DAC_WORK_MODE (0x1D): set DAC operational mode. mode: 0 = normal, 1 = alternate.
  const setDacWorkMode = async (deviceDetails, mode) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log(`USB Device PEQ: Walkplay set DAC work mode to ${mode}`);
    await sendReport(device, REPORT_ID, [WRITE, CMD.DAC_WORK_MODE, 0x01, mode & 0xFF]);
  };

  // Read current DAC work mode. Returns 0 or 1.
  const readDacWorkMode = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading DAC work mode");
      }, 2000);
      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== READ || data[1] !== CMD.DAC_WORK_MODE) return;
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        // Response format: [READ, CMD, len, value] — value is at data[3]
        console.log('[walkplay] readDacWorkMode bytes:', Array.from(data.slice(0, 8)).map(b => '0x' + b.toString(16)));
        resolve(data[3]);
      };
      device.addEventListener("inputreport", onReport);
      sendReport(device, REPORT_ID, [READ, CMD.DAC_WORK_MODE]).catch(reject);
    });
  };

  // Public alias for writeGlobalGain — sets the DAC output/EQ offset gain in dB.
  const setOutputGain = async (deviceDetails, gainDb) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log(`USB Device PEQ: Walkplay set output gain to ${gainDb}dB`);
    await writeGlobalGain(device, gainDb);
  };

  // GAIN_MODE (0x19): alternative gain-processing mode — boolean toggle.
  // Confirmed present on SchemeNo16 devices (e.g. Protocol Max).
  // Exact DSP behaviour TBD; treated as a boolean on/off switch.
  const setGainMode = async (deviceDetails, enabled) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    console.log(`USB Device PEQ: Walkplay set gain mode ${enabled ? 'on' : 'off'}`);
    await sendReport(device, REPORT_ID, [WRITE, CMD.GAIN_MODE, 0x01, enabled ? 0x01 : 0x00]);
  };

  const readGainMode = async (deviceDetails) => {
    const device = deviceDetails.rawDevice;
    if (!device) throw new Error("Device not connected.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        reject("Timeout reading gain mode");
      }, 2000);
      const onReport = (event) => {
        const data = new Uint8Array(event.data.buffer);
        if (data[0] !== READ || data[1] !== CMD.GAIN_MODE) return;
        clearTimeout(timeout);
        device.removeEventListener("inputreport", onReport);
        resolve(data[3] === 0x01);
      };
      device.addEventListener("inputreport", onReport);
      sendReport(device, REPORT_ID, [READ, CMD.GAIN_MODE, 0x00]).catch(reject);
    });
  };

  return {
    pushToDevice,
    pullFromDevice,
    getCurrentSlot,
    enablePEQ,
    setMicGain,
    readMicGain,
    setDacFilter,
    readDacFilter,
    setDacBalance,
    setDenoiseEnabled,
    readDenoiseEnabled,
    setDacWorkMode,
    readDacWorkMode,
    setOutputGain,
    setGainMode,
    readGainMode,
  };
})();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFilters(condition, device, timeout, callback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!condition()) {
        console.warn("Timeout: Filters not fully received.");
        // Instead of rejecting with the callback result, create a proper result with partial data
        const result = callback(device);
        // Add information about the timeout to help with debugging
        result.complete = false;
        result.receivedCount = result.filters.filter(f => f !== undefined).length;
        result.expectedCount = device.max;
        // Resolve with partial data instead of rejecting
        resolve(result);
      } else {
        const result = callback(device);
        result.complete = true;
        resolve(result);
      }
    }, timeout);

    const interval = setInterval(() => {
      if (condition()) {
        clearTimeout(timer);
        clearInterval(interval);
        const result = callback(device);
        result.complete = true;
        resolve(result);
      }
    }, 100);
  });
}



// Compute IIR filter
function computeIIRFilter(i, freq, gain, q) {
  let bArr = new Array(20).fill(0);
  let sqrt = Math.sqrt(Math.pow(10, gain / 20));
  let d3 = (freq * 6.283185307179586) / 96000;
  let sin = Math.sin(d3) / (2 * q);
  let d4 = sin * sqrt;
  let d5 = sin / sqrt;
  let d6 = d5 + 1;
  let quantizerData = quantizer(
    [1, (Math.cos(d3) * -2) / d6, (1 - d5) / d6],
    [(d4 + 1) / d6, (Math.cos(d3) * -2) / d6, (1 - d4) / d6]
  );

  let index = 0;
  for (let value of quantizerData) {
    bArr[index] = value & 0xFF;
    bArr[index + 1] = (value >> 8) & 0xFF;
    bArr[index + 2] = (value >> 16) & 0xFF;
    bArr[index + 3] = (value >> 24) & 0xFF;
    index += 4;
  }

  return bArr;
}

// Convert values to byte array
function convertToByteArray(value, length) {
  let arr = [];
  for (let i = 0; i < length; i++) {
    arr.push((value >> (8 * i)) & 0xFF);
  }
  return arr;
}

// Quantizer function for IIR filter
function quantizer(dArr, dArr2) {
  let iArr = dArr.map(d => Math.round(d * 1073741824));
  let iArr2 = dArr2.map(d => Math.round(d * 1073741824));
  return [iArr2[0], iArr2[1], iArr2[2], -iArr[1], -iArr[2]];
}
