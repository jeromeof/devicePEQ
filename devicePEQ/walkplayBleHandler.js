//
// Copyright 2026 : Pragmatic Audio
//
// WalkPlay BLE Handler
// ────────────────────
// WalkPlay DSP dongles with a BLE module ("… with BLE" / "…-BLE" products, e.g.
// CB1300 with BLE 0x3302:0xB301 and CS43198-SGM8262-TFT-BLE 0x3302:0x4333) expose the
// same command set over GATT that the USB HID handler speaks. Rather than duplicating
// the PEQ maths (biquads, per-scheme compensation) this handler runs walkplayUsbHID
// unchanged on top of a transport that makes the GATT link look like a HIDDevice.
//
// Source: WalkPlay Android app 2026-10 (com.ttgk.musicbox), package
// com.walkplay.sdk.cube01 (WpCube01BleManager / WpCube01BleDeviceApi), verified
// against a CB1300 with BLE on 2026-11-11.
//
// ── GATT ─────────────────────────────────────────────────────────────────────
//   Advertises service 0xFF16 or 0xFF17 (scan filter — name is usually "Audio_BLE").
//   Data channel: characteristic 0xAB02 (write+notify) if present, else 0xFF20
//   (CB1300: service 0xFF12 / char 0xFF20). The app also enables notify on 0xAB01.
//   0xFF15 reads "FOTA" (BLE-module firmware update — never touched here).
//
// ── Frame (always ≥ 64 bytes, zero padded) ───────────────────────────────────
//   [0x4B, dir, cmd, len = payload.length + 2, payload…]
//   dir: 0x01 write, 0x80 read. Responses use the same layout.
//   USB HID sends the same bytes minus the report ID, but its length byte is
//   inconsistent (0x18 for PEQ writes, 0x00 for most reads) — BLE needs it exact.
//
// ── Differences from USB HID (handled by the transport) ──────────────────────
//   PEQ read (0x09): the bridge drops the read payload, including the band index, and
//     fetches band 0. Each read first returns the previous buffered reply; immediately
//     after a BLE write this can be our own write frame, not a DSP readback. Repeating
//     a read refreshes band 0 but cannot select bands 1..N. Full PEQ read is unsupported.
//     See testing/protocol-docs/walkplay-ble/FINDINGS.md and captures 37–40.
//   Commit: USB push ends with 0x05, 0x17, TEMP_WRITE(0x0A), FLASH(0x01). Over BLE
//     0x05 = ERASE_FLASH and 0x17 = RESTORE_FACTORY, so those are dropped; the app's
//     sequence is APPLY (0x0A [0]) then SAVE_OFFSETS_AND_EQ (0x04 [0]).
//   Command IDs that differ: gain mode 0x19 → 0x18 (DAC gain level, value ×2 as the app
//     writes it: BLE 2 = USB 1 = High; 0x19 is the ADC EQ group over BLE), denoise
//     0x1B → 0x31 (inverted: 0 = on). Mic gain 0x02 is the same register and raw value
//     as USB (the Android app labels it dB×256, but a USB write of +3 dB reads back over
//     BLE as the same raw 0x1980), so it's passed through unscaled.
//   NOT mapped: DAC work mode. The app's BLE "work mode" (0x20) is a different setting —
//     writing it over BLE didn't change USB 0x1D (CS43198-SGM8262-TFT-BLE, 2026-11-11).
//   Extras reads over BLE (DAC filter, gain level, mic) are cached by the BLE module and
//     don't reliably track the device, so only writes are exposed. Writes verified
//     over USB: filter BLE 1 → FAST-PC, gain level BLE 2 → High.
//   DAC filter (0x11) is 0-based over BLE, 1-based over USB (app adds/subtracts 1).
//   Commands a firmware doesn't support are rejected with a GATT error ("Out of Range"
//   on CS43198-SGM8262-TFT-BLE for 0x0C, 0x1D, 0x19, 0x1B, 0x31) — that call fails alone.
//   Balance (0x16) uses a different payload over BLE ([ch, raw16]) — not mapped yet.
//   Firmware version (0x0C) doesn't answer over BLE.
//
// ── Identity ─────────────────────────────────────────────────────────────────
//   CHIP_ID (0x0E, payload [0,0,0,0]) replies with cmd 0x27 and [vidLo, vidHi, pidLo, pidHi]
//   — the USB VID/PID. The first reply after connecting is all zeros, so the app (and we)
//   ask again. Verified: "HiFi Audio TFT-BLE" → 3302:4333, "Audio_BLE" → 3302:B301.
//   onConnected() uses it to pick up the same SchemeNo group config as USB.

import { walkplayUsbHID } from './walkplayHidHandler.js';
import { resolveWalkplayModelConfig, recallBandCount } from './walkplayDeviceIdentity.js';
import { resolveConstraints, loadPeqConstraintsConfig } from './peqConstraints.js';

export const WALKPLAY_BLE_ADVERTISED_SERVICES = [
  '0000ff16-0000-1000-8000-00805f9b34fb',
  '0000ff17-0000-1000-8000-00805f9b34fb',
];
// GATT services that may hold the data channel. Web Bluetooth only exposes services
// listed here. 0xFF12 is verified (CB1300); 0xAB00 is the conventional parent of the
// AB01/AB02 pair the app prefers — unverified, harmless if absent.
export const WALKPLAY_BLE_GATT_SERVICES = [
  '0000ff12-0000-1000-8000-00805f9b34fb',
  '0000ab00-0000-1000-8000-00805f9b34fb',
];
const UUID = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;
const CHAR_AB02 = UUID('ab02');
const CHAR_AB01 = UUID('ab01');
const CHAR_FF20 = UUID('ff20');

const REPORT_ID = 0x4B;
const READ = 0x80;
const WRITE = 0x01;
const FRAME_LEN = 64;
const EQ_GROUP_PAYLOAD = 58;

// USB command → BLE command (only where they differ)
const CMD_FROM_BLE = { 0x31: 0x1B };
const DROPPED_WRITES = new Set([0x05, 0x17]); // ERASE_FLASH / RESTORE_FACTORY on BLE

export function buildBleFrame(direction, cmd, payload = []) {
  const frame = new Uint8Array(Math.max(payload.length + 6, FRAME_LEN));
  frame[0] = REPORT_ID;
  frame[1] = direction;
  frame[2] = cmd;
  frame[3] = (payload.length + 2) & 0xFF;
  frame.set(payload, 4);
  return frame;
}

const pad = (bytes, n) => {
  const out = new Uint8Array(Math.max(bytes.length, n));
  out.set(bytes);
  return out;
};

// Translate one USB-HID-style report (report ID stripped) into a BLE frame, or null
// to drop it. Exported for tests.
export function hidToBleFrame(data) {
  const bytes = Array.from(data);
  const [direction, hidCmd] = bytes;
  const payload = bytes.slice(3);
  const isRead = direction === READ;

  if (!isRead && DROPPED_WRITES.has(hidCmd)) return null;

  switch (hidCmd) {
    case 0x09: // PEQ band read / write — 58-byte EQ group payload
      return buildBleFrame(direction, 0x09, pad(payload, EQ_GROUP_PAYLOAD));
    case 0x0A: // TEMP_WRITE → APPLY_EQ_TO_REGISTERS
      return isRead ? null : buildBleFrame(WRITE, 0x0A, [0]);
    case 0x01: // FLASH_EQ → SAVE_OFFSETS_AND_EQ. enablePEQ(false) has no BLE equivalent.
      if (isRead) return null;
      if (bytes[2] === 0x00) return null; // [01 01 00 …] = PEQ disable on USB
      return buildBleFrame(WRITE, 0x04, [0]);
    case 0x03: // DAC gain offset (s16 dB×256) — same encoding as USB [00, gain]
      return buildBleFrame(direction, 0x03, isRead ? [0, 0] : pad(payload, 2).slice(0, 2));
    case 0x02: // mic / ADC gain — same raw register as USB
      return buildBleFrame(direction, 0x02, isRead ? [0, 0] : [bytes[3] ?? 0, bytes[4] ?? 0]);
    case 0x11: // DAC filter write: USB 1..5 (FAST-LL…NON-OS), BLE 0..4 (app: setCs43131Filter(index - 1))
      return isRead ? null : buildBleFrame(WRITE, 0x11, [Math.max(0, (bytes[3] ?? 1) - 1)]);
    case 0x19: // gain mode write → DAC gain level, ×2 (app: writeOutputMode(i * 2))
      return isRead ? null : buildBleFrame(WRITE, 0x18, [bytes[3] ? 2 : 0]);
    case 0x1D: // DAC work mode — no BLE equivalent (0x20 is a different setting)
      return null;
    case 0x1B: // denoise / ENC — BLE value is inverted (0 = on)
      return buildBleFrame(direction, 0x31, isRead ? [0] : [bytes[3] ? 0 : 1]);
    case 0x0C: case 0x0F: case 0x16: // version (silent on BLE), slot, balance (unmapped)
      return null;
    default:
      return null; // unknown → never forward blindly over BLE
  }
}

// Translate a BLE notification (with 0x4B) into what walkplayUsbHID expects from
// WebHID (report ID stripped, USB command IDs/encodings). Exported for tests.
export function bleToHidReport(frame) {
  const f = Array.from(frame);
  if (f[0] !== REPORT_ID) return null;
  const bleCmd = f[2];
  const len = f[3];
  const payload = f.slice(4, 4 + Math.max(0, len - 2));
  const hidCmd = CMD_FROM_BLE[bleCmd] ?? bleCmd;

  if (bleCmd === 0x31) return new Uint8Array([f[1], hidCmd, 1, payload[0] === 0 ? 1 : 0]);
  // mic: [READ, 0x02, len 2, lo, hi] — the newer-firmware USB layout readMicGain understands
  if (bleCmd === 0x02) return new Uint8Array([f[1], 0x02, 0x02, payload[0] ?? 0, payload[1] ?? 0]);
  return new Uint8Array(f.slice(1));
}

// Minimal HIDDevice look-alike over a GATT characteristic.
class WalkplayBleTransport {
  constructor(device) {
    this.device = device;
    this.opened = true;
    this.productName = device.model;
    this._listeners = new Set();
    this._queue = Promise.resolve();
    this._onNotify = (event) => {
      const report = bleToHidReport(new Uint8Array(event.target.value.buffer));
      if (!report) return;
      const ev = { reportId: REPORT_ID, data: new DataView(report.buffer) };
      for (const l of [...this._listeners]) l(ev);
    };
    for (const ch of device.notifyChars ?? [device.rxChar]) {
      ch?.addEventListener('characteristicvaluechanged', this._onNotify);
    }
  }
  async open() {}
  async close() {}
  addEventListener(type, fn) { if (type === 'inputreport') this._listeners.add(fn); }
  removeEventListener(type, fn) { this._listeners.delete(fn); }
  async sendReport(reportId, data) {
    const frame = hidToBleFrame(data);
    if (!frame) {
      console.log('WalkPlay BLE: not sent over BLE (no BLE equivalent):', Array.from(data).slice(0, 4));
      return;
    }
    // Serialise GATT writes; with-response when the characteristic allows it (as the app does).
    // Some firmware rejects commands it doesn't implement with a GATT error (CS43198-
    // SGM8262-TFT-BLE: firmware version 0x0C, ENC 0x31 → "Out of Range"). That must only
    // fail this call, not every write queued after it.
    const write = this._queue.then(async () => {
      const ch = this.device.txChar;
      if (ch.properties?.write && ch.writeValueWithResponse) await ch.writeValueWithResponse(frame);
      else if (ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(frame);
      else await ch.writeValue(frame);
    });
    this._queue = write.catch(() => {});
    return write;
  }
}

const transports = new WeakMap();
function viaBle(deviceDetails) {
  const key = deviceDetails.rawDevice ?? deviceDetails;
  let t = transports.get(key);
  if (!t) { t = new WalkplayBleTransport(deviceDetails); transports.set(key, t); }
  return { ...deviceDetails, rawDevice: t };
}

// Characteristic discovery, mirroring WpCube01BleManager: prefer AB02, else FF20,
// else the first write+notify characteristic. Called by bluetoothBleConnector.
export async function discoverWalkplayBleGatt(server) {
  let services = [];
  try { services = await server.getPrimaryServices(); } catch (_) { /* fall through */ }
  const chars = [];
  for (const s of services) {
    try { chars.push(...await s.getCharacteristics()); } catch (_) { /* not allowed */ }
  }
  const writeNotify = chars.filter(c => (c.properties.write || c.properties.writeWithoutResponse) && c.properties.notify);
  const data = writeNotify.find(c => c.uuid === CHAR_AB02)
    ?? writeNotify.find(c => c.uuid === CHAR_FF20)
    ?? writeNotify[0];
  if (!data) throw new Error('WalkPlay BLE: no write+notify characteristic (AB02/FF20) found');
  const ab01 = chars.find(c => c.uuid === CHAR_AB01 && c.properties.notify && c !== data);
  const notifyChars = [data, ...(ab01 ? [ab01] : [])];
  for (const c of notifyChars) await c.startNotifications();
  return { txChar: data, rxChar: data, notifyChars };
}

// Read the USB VID/PID over BLE (WpCube01BleDeviceApi.readChipId). Returns null if the
// device doesn't answer with a non-zero ID after a few tries.
export async function readWalkplayBleChipId(device, attempts = 4) {
  const ch = device.txChar;
  const listeners = device.notifyChars ?? [device.rxChar];
  for (let k = 0; k < attempts; k++) {
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => { done(null); }, 1500);
      const on = (event) => {
        const f = new Uint8Array(event.target.value.buffer);
        if (f[0] === REPORT_ID && (f[2] === 0x27 || f[2] === 0x0E) && f[3] >= 6) done(f);
      };
      const done = (v) => { clearTimeout(timer); listeners.forEach(c => c?.removeEventListener('characteristicvaluechanged', on)); resolve(v); };
      listeners.forEach(c => c?.addEventListener('characteristicvaluechanged', on));
      const frame = buildBleFrame(READ, 0x0E, [0, 0, 0, 0]);
      const w = ch.properties?.write && ch.writeValueWithResponse ? ch.writeValueWithResponse(frame) : ch.writeValueWithoutResponse(frame);
      Promise.resolve(w).catch(() => done(null));
    });
    if (reply) {
      const vid = reply[4] | (reply[5] << 8);
      const pid = reply[6] | (reply[7] << 8);
      if (vid || pid) return { vid, pid };
    }
  }
  return null;
}

// Settings that differ over BLE whatever the scheme (see header).
const BLE_RESTRICTIONS = {
  writeOnly: true,
  dacWorkMode: { supported: false },
  dacBalance: { supported: false },
};

export const walkplayBle = {
  // Called by bluetoothBleConnector after GATT discovery, before extras are built.
  async onConnected(device) {
    const id = await readWalkplayBleChipId(device);
    if (!id) {
      console.warn('WalkPlay BLE: chip ID not available — using generic WalkPlay BLE settings');
      return;
    }
    device.usbVendorId = id.vid;
    device.usbProductId = id.pid;
    const resolved = await resolveWalkplayModelConfig(id.vid, id.pid);
    if (!resolved) return;
    const learned = recallBandCount(id.vid, id.pid);
    const override = {
      ...(resolved.modelConfig.peqConstraintsOverride || {}),
      ...(device.modelConfig.peqConstraintsOverride || {}),   // supportsRead: false
      ...(learned ? { maxFilters: learned } : {}),
    };
    const modelConfig = {
      ...device.modelConfig,
      ...resolved.modelConfig,
      ...BLE_RESTRICTIONS,
      peqConstraintsOverride: override,
      experimental: device.modelConfig.experimental,
    };
    await loadPeqConstraintsConfig().catch(() => {});
    const constraints = resolveConstraints(modelConfig);
    if (constraints) Object.assign(modelConfig, constraints);
    device.modelConfig = modelConfig;
    device.deviceGroup = resolved.deviceGroup;
    const hex = (v) => v.toString(16).toUpperCase().padStart(4, '0');
    console.log(`WalkPlay BLE: ${device.model} is ${hex(id.vid)}:${hex(id.pid)} → ${resolved.deviceGroup ?? 'default'}, ` +
      `${modelConfig.maxFilters} bands${learned ? ' (remembered from USB)' : ''}`);
  },

  // Use the writable slot from configuration without reading the PEQ group.
  async getCurrentSlot(deviceDetails) {
    // The returned tag can be stale or name a factory preset (e.g. Pop = 2).
    // Writes target Custom; never use that unreadable active tag as a write slot.
    return deviceDetails.modelConfig?.firstWritableEQSlot ?? 101;
  },
  // Not possible over BLE (see header) — the plugin skips this when supportsRead is false.
  async pullFromDevice(deviceDetails, slot) {
    return { filters: [], globalGain: 0, currentSlot: slot, unsupported: true, writeOnly: true };
  },
  pushToDevice: (d, ...a) => walkplayUsbHID.pushToDevice(viaBle(d), ...a),
  // USB enablePEQ(false) has no known BLE equivalent; enabling = re-saving.
  enablePEQ: (d, ...a) => walkplayUsbHID.enablePEQ(viaBle(d), ...a),
  // Extras are write-only over BLE: without read* methods deviceExtras reports get() as
  // NOT_IMPLEMENTED and the UI skips the read.
  setDacFilter: (d, ...a) => walkplayUsbHID.setDacFilter(viaBle(d), ...a),
  setGainMode: (d, ...a) => walkplayUsbHID.setGainMode(viaBle(d), ...a),
  setDenoiseEnabled: (d, ...a) => walkplayUsbHID.setDenoiseEnabled(viaBle(d), ...a),
  setMicGain: (d, ...a) => walkplayUsbHID.setMicGain(viaBle(d), ...a),
  // No read* for extras: BLE replies are cached by the BLE module and went stale in testing
  // (mic read +2.99 dB while USB showed -0.35 dB). Read extras over USB.
};
