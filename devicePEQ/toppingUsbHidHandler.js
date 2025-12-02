export const toppingUsbHidHandler = (function () {
  // ===== Known scheme from logs =====
  // Band page: base = 0x90 + bandIndex (0-based; band 0 => 0x90, band 1 => 0x91, band 2 => 0x92, ...)
  // Write ops (per band):
  //   enable: base+0x06  (data: 0/1)
  //   freq:   base+0x07  (data: Hz, integer)
  //   gain:   base+0x08  (data: dB*2, half-dB steps, signed)
  //   q:      base+0x09  (data: Q*10000, integer)
  //   apply:  base+0x0A  (data: 1)
  //
  // NOTE: Report format on your device appears to be [cmd, data] in the HID payload; we keep REPORT_ID=1.

  const REPORT_ID = 0x01;

  // Helpers -------------------------------------------------------
  const bandBase = (filterIndex) => (0x90 + filterIndex) & 0xFF;

  // Clamp & encoders (defensive)
  const encFreq = (hz) => Math.max(1, Math.round(hz));
  const encGainSteps = (db) => {
    // half-dB steps, signed 16-bit safe
    const v = Math.round(db * 2);
    // device accepted small positives; keep as 16-bit signed range
    return ((v << 16) >> 16); // ensure JS -> signed 16
  };
  const encQ = (q) => Math.max(1, Math.round(q * 10000));

  // Send a single 2-byte command (cmd + data as 16/32?). Your logs show small integers.
  // WebHID sendReport takes (reportId, data: BufferSource)
  // We'll serialize as little-endian Uint32 for data to be safe; adjust if your device expects 16-bit.
  function makePacket(cmd, data) {
    // [cmd (1B), data (4B LE)]
    const buf = new ArrayBuffer(5);
    const view = new DataView(buf);
    view.setUint8(0, cmd & 0xFF);
    view.setUint32(1, data >>> 0, true);
    return new Uint8Array(buf);
  }

  async function sendCmd(device, cmd, data) {
    const pkt = makePacket(cmd, data);
    await device.sendReport(REPORT_ID, pkt);
  }

  // Public API stubs that we can safely implement now ------------------------

  async function getCurrentSlot(_deviceDetails) {
    // Unknown in logs; keep placeholder.
    console.log("USB Device PEQ: Topping getCurrentSlot called - not implemented (default 0).");
    return 0;
  }


// Small helper: wait for echoed state packets and resolve what we need.
  function collectEchoes(device, wantedCmds, ms = 120) {
    return new Promise((resolve) => {
      const found = new Map();
      const onReport = (e) => {
        // Expect reportId === REPORT_ID; ignore others defensively
        if (e.reportId !== REPORT_ID) return;
        const dv = e.data;
        if (dv.byteLength < 5) return;
        const cmd = dv.getUint8(0);
        if (!wantedCmds.includes(cmd)) return;
        const val = dv.getUint32(1, true);
        found.set(cmd, val);
      };
      device.addEventListener("inputreport", onReport);
      const t = setTimeout(() => {
        device.removeEventListener("inputreport", onReport);
        resolve(found);
      }, ms);
      // If you want a manual cancel, return t, but not needed here.
    });
  }

// Translate a single echoed field (cmd,value) into our filter fields
  function decodeFilterResponse(cmd, value) {
    // Identify band index from cmd high nibble: 0x90..0x99
    const page = cmd & 0xF0;        // 0x90 for bands, 0x9C for pregain page
    const low  = cmd & 0x0F;        // field within the page
    const out = {};

    if (page >= 0x90 && page <= 0x99) {
      // Per-band fields we've seen:
      // base+0x06 enable (0/1)
      // base+0x07 freq (Hz)
      // base+0x08 gainSteps (dB * 2)
      // base+0x09 qScaled (Q * 10000)
      if (low === 0x06) out.disabled = (value === 0);
      else if (low === 0x07) out.freq = value;
      else if (low === 0x08) out.gain = value / 2.0;
      else if (low === 0x09) out.q = value / 10000.0;
    }
    return out;
  }

// Best-effort per-band read: poke APPLY then harvest echoes for freq/gain/q/enabled
  async function readFullFilter(device, filterIndex) {
    const base = (0x90 + filterIndex) & 0xFF;

    // 1) Trigger an "echo" of current band state without changing fields:
    //    send APPLY (base+0x0A, data=1). Your logs show the device then echoes 07/08/09 and often 06.
    await sendCmd(device, (base + 0x0A) & 0xFF, 1);

    // 2) Collect echoes for a short window
    const want = [(base + 0x06) & 0xFF, (base + 0x07) & 0xFF, (base + 0x08) & 0xFF, (base + 0x09) & 0xFF];
    const echoes = await collectEchoes(device, want, 150); // ~150ms harvest window

    // 3) Fold them into a filter object with safe defaults
    let freq = 1000;
    let gain = 0;
    let q = 1.0;
    let disabled = false;

    for (const [cmd, val] of echoes.entries()) {
      const partial = decodeFilterResponse(cmd, val);
      if (partial.freq != null) freq = partial.freq;
      if (partial.gain != null) gain = partial.gain;
      if (partial.q != null) q = partial.q;
      if (partial.disabled != null) disabled = partial.disabled;
    }

    return { type: "PK", freq, q, gain, disabled };
  }

// ---------- Pregain (best-guess 16.16 fixed) ----------

  const PREG_PAGE = 0x9C;
  const PREG_SET_A = 0x9C01; // value
  const PREG_TRIG_A = 0x9C02; // 1
  const PREG_SET_B = 0x9C03; // value (repeat/mirror)
  const PREG_TRIG_B = 0x9C04; // 1

// Encode/Decode pregain as signed 16.16 fixed (best guess; tweak if your echoes disagree)
  function encPregainFixed(dB) {
    // clamp to a sensible range to avoid overflow (e.g. -60..+20 dB)
    const clamped = Math.max(-60, Math.min(20, dB));
    // Convert to signed 32-bit
    let fixed = Math.round(clamped * 65536);
    // Bring to unsigned 32 for packing
    return fixed >>> 0;
  }
  function decPregainFixed(val) {
    // Interpret as signed 32
    const signed = (val & 0x80000000) ? (val - 0x100000000) : val;
    return signed / 65536.0;
  }

  async function readPregain(device) {
    // We don't know a "request" opcode; mimic the band trick:
    // send the "trigger" and collect any 0x9C01/0x9C03 echoes briefly.
    // If nothing arrives, return 0 dB.
    await sendCmd(device, PREG_TRIG_A & 0xFF, 1);
    const want = [PREG_SET_A & 0xFF, PREG_SET_B & 0xFF];
    const echoes = await collectEchoes(device, want, 150);

    // Prefer the most-recent SET value we saw (B over A)
    const vB = echoes.get(PREG_SET_B & 0xFF);
    const vA = echoes.get(PREG_SET_A & 0xFF);
    if (vB != null) return decPregainFixed(vB);
    if (vA != null) return decPregainFixed(vA);

    // Fallback: no echo seen
    return 0;
  }

  async function writePregain(device, dB) {
    const fixed = encPregainFixed(dB);
    // Mirror sequence seen in logs (value → trigger → value → trigger)
    await sendCmd(device, PREG_SET_A & 0xFF, fixed);
    await sendCmd(device, PREG_TRIG_A & 0xFF, 1);
    await sendCmd(device, PREG_SET_B & 0xFF, fixed);
    await sendCmd(device, PREG_TRIG_B & 0xFF, 1);
  }

  async function pullFromDevice(deviceDetails) {
    console.log("USB Device PEQ: Topping pullFromDevice (reads mostly placeholders).");
    const device = deviceDetails.rawDevice;
    const filters = [];
    for (let i = 0; i < deviceDetails.modelConfig.maxFilters; i++) {
      filters.push(await readFullFilter(device, i));
    }
    const globalGain = await readPregain(device);
    return { filters, globalGain };
  }

  // NEW: encode + write one filter using the discovered scheme
  async function writeFilter(device, filterIndex, filter) {
    const base = bandBase(filterIndex);
    const enabled = filter.disabled ? 0 : 1;

    // Enable/disable (base+0x06)
    await sendCmd(device, (base + 0x06) & 0xFF, enabled);

    // Frequency (base+0x07) – integer Hz
    if (Number.isFinite(filter.freq)) {
      await sendCmd(device, (base + 0x07) & 0xFF, encFreq(filter.freq));
    }

    // Gain (base+0x08) – half-dB steps
    if (Number.isFinite(filter.gain)) {
      await sendCmd(device, (base + 0x08) & 0xFF, encGainSteps(filter.gain));
    }

    // Q (base+0x09) – Q * 10000
    if (Number.isFinite(filter.q)) {
      await sendCmd(device, (base + 0x09) & 0xFF, encQ(filter.q));
    }

    // Apply/commit (base+0x0A)
    await sendCmd(device, (base + 0x0A) & 0xFF, 1);
  }

  // Build packet function kept for API completeness (we now stream field-wise)
  function buildWritePacket(_filterIndex, _f) {
    // Sending happens per-field; there isn't a single combined packet in this protocol.
    return new Uint8Array([0x00]);
  }

  function buildSavePacket() {
    // Unknown "save-to-flash" opcode; your logs show per-band APPLY (0x..0A). Keeping a no-op.
    return new Uint8Array([0x00]);
  }

  async function pushToDevice(deviceDetails, phoneObj, _slot, globalGain, filters) {
    console.log("USB Device PEQ: Topping pushToDevice (using discovered per-band scheme).");
    const device = deviceDetails.rawDevice;
    const max = Math.min(filters.length, deviceDetails.modelConfig.maxFilters || filters.length);

    for (let i = 0; i < max; i++) {
      const f = filters[i];
      // default to peaking if unspecified
      await writeFilter(device, i, {
        type: f.type ?? "PK",
        freq: f.freq,
        gain: f.gain,
        q: f.q,
        disabled: !!f.disabled,
      });
    }

    // Global pregain (left as a no-op until we finalize 0x9Cxx mapping)
    if (Number.isFinite(globalGain)) {
      await writePregain(device, globalGain);
    }

    // Optional save/commit-to-flash is unknown; per-band commit already sent.
    return false; // don't force disconnect
  }

  async function enablePEQ(_device) {
    // Not observed yet as a single global switch; bands have their own enable flags + per-band apply.
    console.log("USB Device PEQ: Topping enablePEQ - no separate global opcode observed; enabling bands instead.");
  }

  async function readVersion(_device) {
    console.log("USB Device PEQ: Topping readVersion - not yet implemented.");
    return "unknown";
  }

  return {
    getCurrentSlot,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
    readVersion,
    // optionally expose these for advanced use / tests
    _internal: { bandBase, encFreq, encGainSteps, encQ, writeFilter },
  };
})();
