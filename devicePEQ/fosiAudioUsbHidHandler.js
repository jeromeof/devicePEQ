//
// Copyright 2025 : Pragmatic Audio
//
// Fosi Audio USB HID Protocol Handler
// Protocol based on actual packet captures from Fosi Audio DS3 webapp
//
// Packet structure: [0x77, CMD, INDEX, ...zeros to 63 bytes]
// Commands observed:
// - 0x91 (145): Initial handshake
// - 0x8B (139): Query mode/band
// - 0x8E (142): Final/commit command
//
// EQ enable (0x9D / 0x9E) is separate, persistent device state: writing and
// saving a preset does not switch EQ on. The app's "EQ Switch" toggle sends
// [0x77, 0x9D, enable] as an output report on report 1 and reads the ack back
// off the feature report as [0x77, 0x9D, status, enable, mode]; 0x9E reads the
// current state as [0x77, 0x9E, enable, mode].
//

import { logHidTx, logHidRx } from './deviceDebugLog.js';
import {
  compensateQForWrite, decompensateQFromRead,
  compensateFreqForWrite, decompensateFreqFromRead,
} from './compensation.js';

export const fosiAudioUsbHID = (function () {

  // Protocol constants
  const HEADER = 0x77; // 119 decimal - constant header byte
  const CMD = {
    // Core PEQ commands (from official Fosi Audio command set)
    SET_EQ_MODE: 0x8A,           // 138 - Switch preset/mode
    GET_EQ_MODE: 0x8B,           // 139 - Query mode
    SET_EQ_PARAMS: 0x8D,         // 141 - Set band parameters
    GET_EQ_PARAMS: 0x8E,         // 142 - Get band parameters (also used as commit)
    RESET_EQ_PARAMS: 0x90,       // 144 - Reset EQ
    GET_EQ_MODE_COUNT: 0x91,     // 145 - Get mode count (also INIT handshake)
    SET_AND_SAVE_EQ_MODE: 0x92,  // 146 - Save mode (also GET_PRESET)
    SET_EQ_ENABLE: 0x9D,         // 157 - Enable/disable EQ
    GET_EQ_ENABLE: 0x9E,         // 158 - Get EQ enable status

    // Additional device commands
    SET_VOLUME: 0x93,            // 147
    GET_VOLUME: 0x94,            // 148
    GET_SAMPLE_FORMAT: 0x9F,     // 159 - current DSP sample rate + DSD mode
    GET_FIRMWARE_VERSION: 0xA6,  // 166
  };

  const GET_ALL_BANDS = 0xFF; // 255 - Special index for GET_EQ_MODE to retrieve all bands

  const REPORT_ID = 0x01;
  const PACKET_SIZE = 63;

  // Band count is not fixed. The app's own getEqBandCount() returns 8, or 32 on
  // firmware >= 1.4.15, and factory presets are always 8 regardless. The device
  // rejects any band index past its current limit, so 8 is the only value safe
  // without reading the firmware version (0xA6) first.
  const DEFAULT_BAND_COUNT = 8;

  // Preset mapping (based on Custom 1 = 7)
  const PRESET_MAP = {
    0: "Bypass",
    7: "Custom 1",
    8: "Custom 2", // Assumed
    9: "Custom 3", // Assumed
    10: "Custom 4", // Assumed
    11: "Custom 5", // Assumed
  };

  // Helper to create a command packet with proper padding
  function makePacket(cmd, index = 0) {
    const packet = new Uint8Array(PACKET_SIZE);
    packet[0] = HEADER;
    packet[1] = cmd;
    packet[2] = index;
    // Rest is zeros (already initialized by Uint8Array)
    return packet;
  }

  // Device filter type codes, taken from the Fosi app's own filterTypeOptions
  // table — these values are written verbatim into byte 4 of SET_EQ_PARAMS.
  const FILTER_TYPE = {
    BYPASS: 0,
    ALL_PASS: 1,
    PEAKING: 2,
    LOW_PASS: 3,
    HIGH_PASS: 4,
    BAND_PASS: 5,
    BAND_STOP: 6,
    NOTCH: 7,
    CONSTANT_Q: 8,
    LOW_SHELF: 9,
    HIGH_SHELF: 10,
  };

  // Convert filter type to device format
  function convertFromFilterType(filterType) {
    const mapping = {
      "PK": FILTER_TYPE.PEAKING,
      "LSQ": FILTER_TYPE.LOW_SHELF,
      "HSQ": FILTER_TYPE.HIGH_SHELF,
    };
    return mapping[filterType] !== undefined ? mapping[filterType] : FILTER_TYPE.PEAKING;
  }

  function convertToFilterType(value) {
    switch (value) {
      case FILTER_TYPE.LOW_SHELF: return "LSQ";
      case FILTER_TYPE.HIGH_SHELF: return "HSQ";
      case FILTER_TYPE.PEAKING:
      case FILTER_TYPE.CONSTANT_Q: return "PK";  // constant-Q is a peak the API has no separate name for
      case FILTER_TYPE.BYPASS: return "PK";      // an off band; the disabled flag carries the meaning
      default:
        // The device supports pass/stop/notch shapes the public filter API has
        // no representation for. Say so rather than silently calling them peaks.
        console.warn(`USB Device PEQ: Fosi Audio filter type ${value} has no PK/LSQ/HSQ equivalent, reporting as PK`);
        return "PK";
    }
  }

  // ── Q compensation ───────────────────────────────────────────────────────
  // Shared with the FiiO handler — see compensation.js. The DS3 is configured
  // with the SAME law as the FiiO parts:
  //
  //     qCompensation: { model: 'rbjGain' }        // realised Q = requested / A
  //
  // It first looked like a flat 0.701 scale, because the verification tool pins
  // its Q cases to one gain (stdGain = 6dB) and 1/A(6dB) = 0.7079 sits 1% away.
  // A run with a constant 0.701 applied settled it — the corrected device then
  // passed at +/-6 dB and failed at +/-12 dB, which a genuinely constant ratio
  // cannot do. Unwinding that run's compensation gives the device's own ratio:
  //
  //     gain      measured    1/A      constant 0.701
  //      6 dB       0.714     0.708        0.701
  //     12 dB       0.537     0.501        0.701
  //
  // 5.7% mean error against 1/A versus 16.6% against a constant. The ratio
  // clearly falls with gain, so 0.701 was an artefact of the test plan's single
  // operating point, not a property of the device.
  //
  // Worth noting for the next device: this is now the same law on two unrelated
  // vendors (FiiO's own measurements are in fiioUsbHidHandler.js), which makes
  // it look less like a firmware quirk and more like a common DSP convention —
  // so 'rbjGain' is a reasonable first hypothesis when a new device's Q reads
  // wide, rather than fitting a constant to whatever gain happened to be tested.
  //
  // One case still fails and is expected to: Q=10 at 6 dB needs 14.1 sent,
  // beyond the device's maxQ of 10, so it clamps. That is a range limit, not a
  // failure of the law, and compensateQForWrite warns with the realised width.
  //
  // PEAKING ONLY, for the same reason FiiO restricts it: every DS3 case this
  // law was fitted from is a PK filter, and the estimator produced no Q ratio
  // at all for the shelves. The DS3's shelves do fail (rmse 0.49-2.24), but
  // nothing yet says they fail by THIS law — FiiO's shelves follow a different
  // one entirely — and correcting them on a guess would make the shelf results
  // uninterpretable, since a residual could then be the device or the guess.
  // Leave shelves uncompensated until a shelf sweep says otherwise.
  const Q_COMP_TYPES = ['PK'];

  // The app always writes a real bandwidth here; this handler has always sent 0.
  // Configurable so the "is 1/sqrt(2) actually a bandwidth misread?" question
  // can be answered by measurement rather than argument. Default 0 keeps the
  // existing behaviour.
  function bandwidthValue(modelConfig) {
    const bw = Number(modelConfig?.bandwidthValue);
    return Number.isFinite(bw) ? bw : 0;
  }

  // Encode filter parameters into SET_EQ_PARAMS packet
  // Packet format: [HEADER, CMD, presetId, bandIndex, filterType, freq(float32), q(float32), bandwidth(float32), gain(float32), ...zeros]
  function encodeBandParams(presetId, bandIndex, filter, modelConfig, fs) {
    const packet = new Uint8Array(PACKET_SIZE);
    const view = new DataView(packet.buffer);

    packet[0] = HEADER;
    packet[1] = CMD.SET_EQ_PARAMS;
    packet[2] = presetId;
    packet[3] = bandIndex;
    packet[4] = convertFromFilterType(filter.type || "PK");

    const gain = filter.gain || 0;
    const qToWrite = compensateQForWrite(
      filter.q || 1.0, gain, filter.type, modelConfig,
      { label: 'Fosi Audio', types: Q_COMP_TYPES });
    // Shelf corner placement is corrected here too — see compensation.js. It is
    // a no-op for peaking filters, so this needs no branch of its own.
    const freqToWrite = compensateFreqForWrite(filter.freq || 1000, modelConfig,
      { label: 'Fosi Audio', gainDb: gain, filterType: filter.type, fs });

    // Float32 values in little-endian
    view.setFloat32(5, freqToWrite, true);                  // Frequency
    view.setFloat32(9, qToWrite, true);                     // Q factor
    view.setFloat32(13, bandwidthValue(modelConfig), true); // Bandwidth
    view.setFloat32(17, filter.gain || 0, true);            // Gain

    return packet;
  }

  // Parse band parameters from response
  // NOTE: WebHID responses include reportId as byte 0, so actual data starts at byte 1
  function parseBandParams(data, modelConfig, fs) {
    if (data.length < 22) return null;

    const view = new DataView(data.buffer, data.byteOffset);

    // Check header at byte 1 (byte 0 is reportId)
    if (data[1] !== HEADER) return null;

    const cmd = data[2];
    const presetId = data[3];
    const bandIndex = data[4];
    const filterType = data[5];

    // Parse Float32 values (offset by 1 due to reportId)
    const freq = view.getFloat32(6, true);
    const q = view.getFloat32(10, true);
    const bandwidth = view.getFloat32(14, true);
    const gain = view.getFloat32(18, true);

    const type = convertToFilterType(filterType);

    return {
      presetId,
      bandIndex,
      type,
      freq: decompensateFreqFromRead(freq, modelConfig, { gainDb: gain, filterType: type, fs }),
      // Report the Q that will actually be heard, not the compensated value we
      // wrote — otherwise every pull -> push cycle would compound the factor.
      q: decompensateQFromRead(q, gain, type, modelConfig, { types: Q_COMP_TYPES }),
      bandwidth,
      gain,
      // A band the device has set to Bypass is off regardless of its stored
      // freq/gain, so treat that as authoritative alongside the all-zero case.
      disabled: filterType === FILTER_TYPE.BYPASS || (gain === 0 && freq === 0)
    };
  }

  // Send command to device using Feature Report
  async function sendCommand(device, reportId, cmd, index = 0, delay = 0) {
    const packet = makePacket(cmd, index);
    console.log(`USB Device PEQ: Fosi Audio sending feature [0x${packet[0].toString(16)}, 0x${packet[1].toString(16)}, ${packet[2]}]`);
    logHidTx('FosiAudio', reportId, packet);
    await device.sendFeatureReport(reportId, packet);
    if (delay > 0) {
      await waitMs(delay);
    }
  }

  // Receive response using Feature Report
  async function receiveFeatureReport(device, reportId) {
    try {
      const dataView = await device.receiveFeatureReport(reportId);
      logHidRx('FosiAudio', new Uint8Array(dataView.buffer));
      console.log(`USB Device PEQ: Fosi Audio received feature report:`, Array.from(new Uint8Array(dataView.buffer).slice(0, 25)));
      return dataView;
    } catch (e) {
      console.error("USB Device PEQ: Fosi Audio receiveFeatureReport failed:", e);
      return null;
    }
  }

  // WebHID hands back the report ID as byte 0 on numbered reports. Fosi's own
  // app strips it before parsing, so do the same and always return a view whose
  // byte 0 is the 0x77 header.
  function normalizeFeatureReport(dataView, reportId) {
    if (!dataView || dataView.byteLength < 2) return null;
    if (dataView.getUint8(0) === reportId && dataView.getUint8(1) === HEADER) {
      return new DataView(dataView.buffer, dataView.byteOffset + 1, dataView.byteLength - 1);
    }
    return dataView;
  }

  // Every command is acked on the feature report. The app treats a missing or
  // mismatched ack as a failed write, so a send that returns is not on its own
  // proof the device did anything.
  async function readAck(device, reportId, expectedCmd) {
    const raw = await receiveFeatureReport(device, reportId);
    const view = normalizeFeatureReport(raw, reportId);
    if (!view || view.getUint8(0) !== HEADER) return null;
    const cmd = view.getUint8(1);
    if (expectedCmd !== undefined && cmd !== expectedCmd) {
      console.warn(`USB Device PEQ: Fosi Audio expected ack 0x${expectedCmd.toString(16)}, got 0x${cmd.toString(16)}`);
      return null;
    }
    return view;
  }

  // GET_SAMPLE_FORMAT response: [0x77, 0x9F, sampleRate(u32 LE), dsdMode]
  //
  // The DSP follows the stream on this device, so the rate has to be read
  // rather than configured: measurements showed a 44.1kHz stream fitting far
  // better than 48k at 8-10kHz, and the shelf prewarp is exactly where an
  // assumed rate goes wrong. Returns null on any failure so the caller falls
  // back to the configured value rather than writing a wrong frequency.
  async function readSampleRate(device, reportId) {
    try {
      const packet = makePacket(CMD.GET_SAMPLE_FORMAT);
      logHidTx('FosiAudio', reportId, packet);
      await device.sendReport(reportId, packet);
      const view = await readAck(device, reportId, CMD.GET_SAMPLE_FORMAT);
      if (!view || view.byteLength < 6) return null;
      const rate = view.getUint32(2, true);
      // Sanity-check: a garbled read must not silently reshape every filter.
      if (!(rate >= 8000 && rate <= 768000)) {
        console.warn(`USB Device PEQ: Fosi Audio implausible sample rate ${rate}, ignoring`);
        return null;
      }
      return rate;
    } catch (e) {
      console.warn('USB Device PEQ: Fosi Audio could not read sample rate:', e.message);
      return null;
    }
  }

  // GET_EQ_ENABLE response: [0x77, 0x9E, enable, mode]
  async function readEqEnable(device, reportId) {
    const packet = makePacket(CMD.GET_EQ_ENABLE);
    logHidTx('FosiAudio', reportId, packet);
    await device.sendReport(reportId, packet);
    const view = await readAck(device, reportId, CMD.GET_EQ_ENABLE);
    if (!view || view.byteLength < 4) return null;
    return { enabled: view.getUint8(2) === 1, mode: view.getUint8(3) };
  }

  // Send commit for specific band (using GET_EQ_PARAMS as commit)
  async function sendBandCommit(device, reportId, presetId, bandIndex) {
    const packet = new Uint8Array(PACKET_SIZE);
    packet[0] = HEADER;
    packet[1] = CMD.GET_EQ_PARAMS; // 0x8E also serves as commit
    packet[2] = presetId;
    packet[3] = bandIndex;
    console.log(`USB Device PEQ: Fosi Audio commit band ${bandIndex} of preset ${presetId}`);
    logHidTx('FosiAudio', reportId, packet);
    await device.sendReport(reportId, packet);
  }

  // Wait for response from device
  function waitForResponse(device, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        device.removeEventListener("inputreport", handler);
        reject(new Error(`Timeout waiting for response after ${timeout}ms`));
      }, timeout);

      const handler = (event) => {
        clearTimeout(timer);
        device.removeEventListener("inputreport", handler);
        const data = new Uint8Array(event.data.buffer);
        logHidRx('FosiAudio', data);
        console.log(`USB Device PEQ: Fosi Audio received:`, Array.from(data.slice(0, 10)));
        resolve(data);
      };

      device.addEventListener("inputreport", handler);
    });
  }

  // Parse response data based on command type
  function parseResponse(data) {
    if (data.length < 3) return null;

    // Check header
    if (data[0] !== HEADER) {
      console.warn("USB Device PEQ: Fosi Audio unexpected header:", data[0]);
      return null;
    }

    const cmd = data[1];
    const index = data[2];

    // Parse based on command type
    // This will need adjustment based on actual response format
    const result = {
      cmd,
      index,
      raw: data
    };

    console.log(`USB Device PEQ: Fosi Audio parsed response cmd=0x${cmd.toString(16)} index=${index}`);
    return result;
  }

  // Public API

  async function getCurrentSlot(deviceDetails) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;

    console.log("USB Device PEQ: Fosi Audio getCurrentSlot - returning Custom 1 (7)");
    // Return Custom 1 as default active slot
    return 7;
  }

  async function pullFromDevice(deviceDetails, slot = 0) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;
    const maxFilters = deviceDetails.modelConfig?.maxFilters || DEFAULT_BAND_COUNT;

    try {
      console.log(`USB Device PEQ: Fosi Audio pulling from device (mode ${slot})...`);
      // Read once per operation, not per band: the rate cannot change mid-pull
      // and eight extra round trips would only slow the pull down.
      const deviceFs = await readSampleRate(device, reportId);
      if (deviceFs) console.log(`USB Device PEQ: Fosi Audio DSP sample rate ${deviceFs} Hz`);

      // Setup listener to collect all band responses
      const filters = [];
      let responseCount = 0;

      const responseHandler = (event) => {
        const data = new Uint8Array(event.data.buffer);
        logHidRx('FosiAudio', data);
        console.log(`USB Device PEQ: Fosi Audio RAW RESPONSE:`, Array.from(data.slice(0, 25)));
        console.log(`USB Device PEQ: Fosi Audio Response - Header: 0x${data[0]?.toString(16)}, Cmd: 0x${data[1]?.toString(16)}, Byte2: ${data[2]}, Byte3: ${data[3]}`);

        const parsed = parseBandParams(data, deviceDetails.modelConfig, deviceFs);
        console.log(`USB Device PEQ: Fosi Audio Parsed:`, parsed);

        if (parsed && parsed.bandIndex !== undefined && parsed.bandIndex < maxFilters) {
          filters[parsed.bandIndex] = {
            type: parsed.type,
            freq: parsed.freq,
            q: parsed.q,
            gain: parsed.gain,
            disabled: parsed.disabled
          };
          responseCount++;
          console.log(`USB Device PEQ: Fosi Audio band ${parsed.bandIndex}: ${parsed.freq}Hz ${parsed.gain}dB Q=${parsed.q}`);
        } else {
          console.warn(`USB Device PEQ: Fosi Audio Failed to parse or invalid band index`);
        }
      };

      device.addEventListener("inputreport", responseHandler);

      // Read sequence using Feature Reports (request/response)
      // 1. Switch to the preset we want to read
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slot);

      // 2. Request each band's parameters individually and receive response
      for (let i = 0; i < maxFilters; i++) {
        // Create GET_EQ_PARAMS packet for this band
        const packet = new Uint8Array(PACKET_SIZE);
        packet[0] = HEADER;
        packet[1] = CMD.GET_EQ_PARAMS;
        packet[2] = slot;  // preset ID
        packet[3] = i;     // band index

        console.log(`USB Device PEQ: Fosi Audio requesting band ${i} of preset ${slot}`);
        logHidTx('FosiAudio', reportId, packet);
        await device.sendFeatureReport(reportId, packet);

        // Receive response immediately
        const response = await receiveFeatureReport(device, reportId);
        if (response) {
          const data = new Uint8Array(response.buffer);
          const parsed = parseBandParams(data, deviceDetails.modelConfig, deviceFs);

          if (parsed && parsed.bandIndex === i) {
            filters[i] = {
              type: parsed.type,
              freq: parsed.freq,
              q: parsed.q,
              gain: parsed.gain,
              disabled: parsed.disabled
            };
            responseCount++;
            console.log(`USB Device PEQ: Fosi Audio band ${i}: ${parsed.freq}Hz ${parsed.gain}dB Q=${parsed.q}`);
          }
        }

        await waitMs(20); // Small delay between band requests
      }

      device.removeEventListener("inputreport", responseHandler);

      console.log(`USB Device PEQ: Fosi Audio received ${responseCount} band responses`);

      // Fill in any missing bands with defaults
      for (let i = 0; i < maxFilters; i++) {
        if (!filters[i]) {
          filters[i] = {
            type: "PK",
            freq: 1000,
            q: 1.0,
            gain: 0,
            disabled: true
          };
        }
      }

      return { filters, globalGain: 0 };
    } catch (error) {
      console.error("USB Device PEQ: Fosi Audio pullFromDevice failed:", error);
      throw error;
    }
  }

  async function pushToDevice(deviceDetails, phoneObj, slot, globalGain, filters) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;
    const maxFilters = Math.min(filters.length, deviceDetails.modelConfig?.maxFilters || DEFAULT_BAND_COUNT);

    try {
      console.log(`USB Device PEQ: Fosi Audio pushing ${maxFilters} filters to preset ${slot} (${PRESET_MAP[slot] || 'Unknown'})...`);
      const deviceFs = await readSampleRate(device, reportId);
      if (deviceFs) console.log(`USB Device PEQ: Fosi Audio DSP sample rate ${deviceFs} Hz`);

      // Send initial handshake (GET_EQ_MODE_COUNT doubles as INIT)
      await sendCommand(device, reportId, CMD.GET_EQ_MODE_COUNT, 0, 50);

      // Switch to the target preset
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slot, 30);

      // Write each band's parameters followed by per-band commit
      for (let i = 0; i < maxFilters; i++) {
        const filter = filters[i];
        const filterToWrite = filter.disabled
          ? { type: "PK", freq: 1000, q: 1.0, gain: 0 }
          : filter;

        // Send SET_EQ_PARAMS command using Feature Report
        const packet = encodeBandParams(slot, i, filterToWrite, deviceDetails.modelConfig, deviceFs);
        console.log(`USB Device PEQ: Fosi Audio writing band ${i}: freq=${filterToWrite.freq}Hz gain=${filterToWrite.gain}dB q=${filterToWrite.q}`);
        logHidTx('FosiAudio', reportId, packet);
        await device.sendFeatureReport(reportId, packet);
        await waitMs(20);

        // Commit this band
        await sendBandCommit(device, reportId, slot, i);
        await waitMs(20);
      }

      // Send final global commit/save
      await sendCommand(device, reportId, CMD.SET_AND_SAVE_EQ_MODE, slot, 50);

      // Writing bands is inaudible while the EQ switch is off. That switch
      // (0x9D) is separate, persistent device state and is not implied by
      // writing or saving a preset — the Fosi app drives it from its own
      // toggle. Without this a push reports success and changes nothing.
      await enablePEQ(deviceDetails, true, slot);

      console.log("USB Device PEQ: Fosi Audio push complete");
      return deviceDetails.modelConfig?.disconnectOnSave || false;
    } catch (error) {
      console.error("USB Device PEQ: Fosi Audio pushToDevice failed:", error);
      throw error;
    }
  }

  async function enablePEQ(deviceDetails, enable, slotId) {
    const device = deviceDetails.rawDevice;
    const reportId = deviceDetails.modelConfig?.reportId || REPORT_ID;

    console.log(`USB Device PEQ: Fosi Audio ${enable ? 'enabling' : 'disabling'} PEQ (preset ${slotId})`);

    // No handshake here — the Fosi app's own EQ switch sends this on its own,
    // and a queued response from an unrelated query would be read back as this
    // command's ack.
    //
    // SET_EQ_ENABLE: [0x77, 0x9D, enable] as an output report.
    const enablePacket = makePacket(CMD.SET_EQ_ENABLE, enable ? 1 : 0);
    logHidTx('FosiAudio', reportId, enablePacket);
    await device.sendReport(reportId, enablePacket);

    // Ack: [0x77, 0x9D, status, enable, mode]. status 0 = accepted.
    const ack = await readAck(device, reportId, CMD.SET_EQ_ENABLE);
    if (ack && ack.byteLength >= 5) {
      const status = ack.getUint8(2);
      console.log(`USB Device PEQ: Fosi Audio EQ switch status=${status} enable=${ack.getUint8(3)} mode=${ack.getUint8(4)}`);
      if (status !== 0) {
        console.warn(`USB Device PEQ: Fosi Audio EQ switch rejected (status ${status})`);
      }
    }
    await waitMs(30);

    if (enable && slotId !== undefined) {
      // Preset selection is separate state from the enable switch.
      await sendCommand(device, reportId, CMD.SET_EQ_MODE, slotId, 30);
    }

    // Read back what the device actually thinks the switch is, so a silently
    // ignored write shows up in the log instead of as "no sound".
    const state = await readEqEnable(device, reportId);
    if (state) {
      console.log(`USB Device PEQ: Fosi Audio EQ enable readback: ${state.enabled ? 'ON' : 'OFF'} (mode ${state.mode})`);
      if (state.enabled !== !!enable) {
        console.warn(`USB Device PEQ: Fosi Audio EQ switch did not take: asked ${!!enable}, device reports ${state.enabled}`);
      }
    }

    console.log(`USB Device PEQ: Fosi Audio switched to preset ${enable ? slotId : 0} (${PRESET_MAP[enable ? slotId : 0] || 'Unknown'})`);
    return state ? state.enabled : undefined;
  }

  // Helper delay function
  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ
  };
})();
