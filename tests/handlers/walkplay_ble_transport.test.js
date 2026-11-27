/**
 * WalkPlay BLE transport — USB-HID command → BLE frame translation.
 * Frame format from the WalkPlay Android app (com.walkplay.sdk.cube01), verified on
 * CB1300 with BLE (USB 0x3302:0xB301) on 2026-11-11: a PEQ push over BLE was read back
 * over USB, and restored.
 */

import { hidToBleFrame, bleToHidReport, buildBleFrame, walkplayBle } from '../../devicePEQ/walkplayBleHandler.js';

const hex = (a) => Array.from(a ?? []).map(b => b.toString(16).padStart(2, '0')).join(' ');

export async function test_frame_isPaddedTo64_withLengthByte(assert) {
  const f = buildBleFrame(0x01, 0x0A, [0]);
  assert.equal(f.length, 64);
  assert.equal(hex(f.slice(0, 5)), '4b 01 0a 03 00');
}

export async function test_writeOnly_slot_and_pull_send_no_ble_reads(assert) {
  const dev = { modelConfig: { writeOnly: true, firstWritableEQSlot: 101 } };
  assert.equal(await walkplayBle.getCurrentSlot(dev), 101);
  const result = await walkplayBle.pullFromDevice(dev, 101);
  assert.equal(result.writeOnly, true);
  assert.equal(result.unsupported, true);
  assert.equal(result.filters.length, 0);
}

export async function test_dangerousUsbCommitCommands_areNeverSent(assert) {
  // USB push sends [01 05 00] and [01 17 00]; over BLE 0x05 = ERASE_FLASH, 0x17 = RESTORE_FACTORY.
  assert.equal(hidToBleFrame([0x01, 0x05, 0x00]), null, '0x05 must be dropped');
  assert.equal(hidToBleFrame([0x01, 0x17, 0x00]), null, '0x17 must be dropped');
}

export async function test_unknownCommands_areNotForwarded(assert) {
  assert.equal(hidToBleFrame([0x01, 0x42, 0x01, 0x00]), null);
  assert.equal(hidToBleFrame([0x01, 0x16, 0x04, 0x01, 0x00, 0x05, 0x00]), null, 'balance unmapped');
}

export async function test_commit_mapsToApplyThenSave(assert) {
  assert.equal(hex(hidToBleFrame([0x01, 0x0A, 0x04, 0x00, 0x00, 0xFF, 0xFF, 0x00]).slice(0, 5)), '4b 01 0a 03 00', 'TEMP_WRITE → apply [0]');
  assert.equal(hex(hidToBleFrame([0x01, 0x01, 0x01, 0x00]).slice(0, 5)), '4b 01 04 03 00', 'FLASH → save offsets+EQ [0]');
  assert.equal(hidToBleFrame([0x01, 0x01, 0x00, 0x65, 0x00]), null, 'PEQ disable has no BLE equivalent');
}

export async function test_peqBandWrite_keepsUsbPayload_withBleLength(assert) {
  // Real USB packet for band 6, 4 kHz +1 dB PK (coefficients identical to what the app stores)
  const usb = [0x01, 0x09, 0x18, 0x00, 0x06, 0x00, 0x00,
    0xa1, 0x08, 0x18, 0x41, 0xe0, 0x29, 0xae, 0x95, 0xab, 0xf1, 0xf9, 0x2c, 0x20, 0xd6, 0x51, 0x6a, 0xb4, 0x05, 0xee, 0xd1,
    0xa0, 0x0f, 0xc0, 0x00, 0x00, 0x01, 0x02, 0x00, 0x65, 0x00];
  const f = hidToBleFrame(usb);
  assert.equal(f.length, 64);
  assert.equal(hex(f.slice(0, 6)), '4b 01 09 3c 00 06', 'len 0x3C (58-byte EQ group), band index at frame[5]');
  assert.equal(hex(f.slice(8, 28)), hex(usb.slice(7, 27)), 'biquad coefficients unchanged');
  assert.equal(f[28] | (f[29] << 8), 4000, 'freq at frame[28]');
  assert.equal(f[34], 2, 'type PK at frame[34]');
  assert.equal(f[36], 0x65, 'slot at frame[36]');
}

export async function test_pushOverBle_sendsAppSequence(assert) {
  const sent = [];
  const ch = { properties: { write: true, notify: true }, addEventListener() {}, removeEventListener() {},
    writeValueWithResponse: async (f) => { sent.push(Array.from(f)); } };
  const dev = { rawDevice: { id: 'test' }, model: 'Audio_BLE', txChar: ch, rxChar: ch, notifyChars: [ch],
    modelConfig: { maxFilters: 8, deviceHandlesPregain: false } };
  const filters = [31, 62, 125, 250, 500, 1000, 2000, 4000].map(freq => ({ freq, gain: 1, q: 0.75, type: 'PK' }));
  await walkplayBle.pushToDevice(dev, {}, 101, 0, filters);
  const cmds = sent.map(f => f[2]);
  assert.equal(cmds.filter(c => c === 0x09).length, 8, '8 band writes');
  assert.ok(!cmds.includes(0x05) && !cmds.includes(0x17), 'no erase / restore-factory');
  assert.equal(JSON.stringify(cmds.slice(8)), JSON.stringify([0x03, 0x0A, 0x04]), 'then gain offset, apply, save');
  assert.ok(sent.every(f => f.length === 64 && f[0] === 0x4B), 'all frames 64 bytes with 0x4B');
}

export async function test_rejectedWrite_doesNotBlockLaterWrites(assert) {
  // CS43198-SGM8262-TFT-BLE rejects ENC (0x31) with a GATT error; later writes must still go out.
  const sent = [];
  const ch = { properties: { write: true, notify: true }, addEventListener() {}, removeEventListener() {},
    writeValueWithResponse: async (f) => { if (f[2] === 0x31) throw new Error('GATT Protocol Error: Out of Range'); sent.push(f[2]); } };
  const dev = { rawDevice: { id: 'reject-test' }, model: 'HiFi Audio TFT-BLE', txChar: ch, rxChar: ch, notifyChars: [ch],
    modelConfig: { maxFilters: 10, deviceHandlesPregain: false } };
  let failed = false;
  try { await walkplayBle.setDenoiseEnabled(dev, true); } catch (_) { failed = true; }
  assert.ok(failed, 'rejected command reports failure');
  await walkplayBle.setDacFilter(dev, 'FAST-PC');
  assert.equal(JSON.stringify(sent), JSON.stringify([0x11]), 'next write still sent');
}

// Mappings below were verified against CS43198-SGM8262-TFT-BLE on 2026-11-11 by writing on
// one link and reading on the other (USB↔BLE).

export async function test_remappedWrites(assert) {
  assert.equal(hex(hidToBleFrame([0x01, 0x11, 0x01, 0x02]).slice(0, 5)), '4b 01 11 03 01', 'FAST-PC: USB 2 → BLE 1 (USB read FAST-PC)');
  assert.equal(hex(hidToBleFrame([0x01, 0x19, 0x01, 0x01]).slice(0, 5)), '4b 01 18 03 02', 'High gain → DAC gain level 2 (USB read High)');
  assert.equal(hex(hidToBleFrame([0x01, 0x19, 0x01, 0x00]).slice(0, 5)), '4b 01 18 03 00', 'Low gain → 0');
  assert.equal(hex(hidToBleFrame([0x01, 0x1B, 0x01, 0x01]).slice(0, 5)), '4b 01 31 03 00', 'denoise on → ENC 0x31 value 0');
  assert.equal(hex(hidToBleFrame([0x01, 0x03, 0x02, 0x00, 0xFE]).slice(0, 6)), '4b 01 03 04 00 fe', 'DAC gain offset -2 dB (BLE read matched USB)');
}

export async function test_dacWorkMode_notSentOverBle(assert) {
  // BLE 0x20 "work mode" didn't change USB 0x1D when written — different setting.
  assert.equal(hidToBleFrame([0x01, 0x1D, 0x01, 0x01]), null);
  assert.equal(hidToBleFrame([0x80, 0x1D]), null);
}

export async function test_staleReads_notSentOverBle(assert) {
  // BLE replies for DAC filter / gain level didn't follow USB changes.
  assert.equal(hidToBleFrame([0x80, 0x11]), null);
  assert.equal(hidToBleFrame([0x80, 0x19, 0x00]), null);
  assert.equal(typeof walkplayBle.readDacFilter, 'undefined');
  assert.equal(typeof walkplayBle.readGainMode, 'undefined');
}

export async function test_micGain_rawPassthrough(assert) {
  // USB +3 dB (raw 0x1999) — same register/raw value seen over BLE
  assert.equal(hex(hidToBleFrame([0x01, 0x02, 0x02, 0x99, 0x19]).slice(0, 6)), '4b 01 02 04 99 19');
  const r = bleToHidReport(Uint8Array.from([0x4b, 0x80, 0x02, 0x04, 0x00, 0xfd, 0, 0]));
  assert.equal(hex(r), '80 02 02 00 fd', 'reply in newer-firmware USB layout');
}

export async function test_bleHandler_isWriteOnlyForExtras(assert) {
  // BLE extras replies were stale in testing (mic read +2.99 dB while USB showed -0.35 dB).
  const reads = Object.keys(walkplayBle).filter(k => k.startsWith('read'));
  assert.equal(JSON.stringify(reads), '[]', `no read* extras over BLE, found ${reads}`);
}

// ── LP / HP coefficients (shared by USB and BLE) ─────────────────────────────
// Port of the WalkPlay app's WpCBBaseEQFilter.computeLowpass/computeHighpass + quantizer.
function vendorPass(type, freq, q) {
  const w = (6.283185307179586 * freq) / 96000.0, s = Math.sin(w) / (q * 2.0), d5 = s + 1.0, c = Math.cos(w);
  const a = [1.0, (c * -2.0) / d5, (1.0 - s) / d5];
  const b = type === 'LP'
    ? [((1.0 - c) / 2.0) / d5, (1.0 - c) / d5, ((1.0 - c) / 2.0) / d5]
    : [((c + 1.0) / 2.0) / d5, (-(c + 1.0)) / d5, ((c + 1.0) / 2.0) / d5];
  const qz = x => Math.round(x * 1.073741824e9);
  const ints = [qz(b[0]), qz(b[1]), qz(b[2]), -qz(a[1]), -qz(a[2])];
  return ints.flatMap(v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]);
}

async function pushedCoeffs(filter) {
  const sent = [];
  const fake = { opened: true, addEventListener() {}, removeEventListener() {}, async sendReport(id, d) { sent.push(Array.from(d)); } };
  const { walkplayUsbHID } = await import('../../devicePEQ/walkplayHidHandler.js');
  await walkplayUsbHID.pushToDevice({ rawDevice: fake, modelConfig: { maxFilters: 1, deviceHandlesPregain: true } }, {}, 101, 0, [filter]);
  const p = sent.find(x => x[1] === 0x09);
  return { coeffs: p.slice(7, 27), type: p[33] };
}

export async function test_lowPass_matchesVendorCoefficients(assert) {
  const { coeffs, type } = await pushedCoeffs({ type: 'LP', freq: 8000, gain: 0, q: 0.707 });
  assert.equal(type, 4, 'type byte LP = 4');
  assert.equal(hex(coeffs), hex(vendorPass('LP', 8000, 0.707)));
}

export async function test_highPass_matchesVendorCoefficients(assert) {
  const { coeffs, type } = await pushedCoeffs({ type: 'HP', freq: 40, gain: 0, q: 0.707 });
  assert.equal(type, 5, 'type byte HP = 5');
  assert.equal(hex(coeffs), hex(vendorPass('HP', 40, 0.707)));
}

// ── Identity over BLE: CHIP_ID → USB VID/PID → same scheme config as USB ─────
// Replies captured 2026-11-11: first CHIP_ID reply is all zeros, the second has the ID.

function chipIdDevice(pidLo, pidHi) {
  const listeners = new Set();
  let n = 0;
  const ch = { properties: { write: true, notify: true },
    addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f),
    writeValueWithResponse: async (f) => {
      if (f[2] !== 0x0E) return;
      const id = n++ === 0 ? [0, 0, 0, 0] : [0x02, 0x33, pidLo, pidHi];
      const reply = Uint8Array.from([0x4b, 0x80, 0x27, 0x06, ...id, 0, 0]);
      setTimeout(() => listeners.forEach(l => l({ target: { value: { buffer: reply.buffer } } })), 5);
    } };
  return { rawDevice: { id: `chip-${pidHi}${pidLo}` }, model: 'Audio_BLE', txChar: ch, rxChar: ch, notifyChars: [ch],
    modelConfig: { peqConstraintsRef: 'walkplayPeq8Band10dBFullShelves', peqConstraintsOverride: { supportsRead: false },
      maxFilters: 8, experimental: true, dacWorkMode: { supported: false }, dacBalance: { supported: false } } };
}

export async function test_chipId_readsUsbIds_afterZeroWarmup(assert) {
  const { readWalkplayBleChipId } = await import('../../devicePEQ/walkplayBleHandler.js');
  const id = await readWalkplayBleChipId(chipIdDevice(0x33, 0x43));
  assert.equal(JSON.stringify(id), JSON.stringify({ vid: 0x3302, pid: 0x4333 }));
}

export async function test_onConnected_cs43198_resolvesSchemeNo16(assert) {
  const dev = chipIdDevice(0x33, 0x43);
  await walkplayBle.onConnected(dev);
  assert.equal(dev.deviceGroup, 'SchemeNo16');
  assert.equal(dev.modelConfig.schemeNo, 16);
  assert.equal(dev.modelConfig.writeOnly, true, 'transport remains write-only after USB model resolution');
  assert.equal(dev.modelConfig.peqConstraintsOverride.supportsRead, false, 'still write-only over BLE');
  assert.equal(dev.modelConfig.dacWorkMode.supported, false, 'BLE restrictions kept');
}

export async function test_onConnected_cb1300_usesBandCountLearnedOverUsb(assert) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } } });
  try {
    const { rememberBandCount } = await import('../../devicePEQ/walkplayDeviceIdentity.js');
    rememberBandCount(0x3302, 0xB301, 8);   // what USB detection found on this model
    const dev = chipIdDevice(0x01, 0xB3);
    await walkplayBle.onConnected(dev);
    assert.equal(dev.deviceGroup, 'SchemeNo13');
    assert.equal(dev.modelConfig.peqConstraintsOverride.maxFilters, 8, 'remembered 8, not SchemeNo13\'s 10');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
}
