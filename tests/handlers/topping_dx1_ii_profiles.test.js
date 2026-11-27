/**
 * Topping DX1 II — stored profiles, left/right channels, preamp and filter-type codes.
 * Vendor ID: 0x152A, Product ID: 0x8750.
 *
 * A mock that behaves like the real device (measured on a DX1 II): it keeps three stored profiles, streams them as a 2-frame
 * header followed by three 78-frame configs the moment it gets connectState, answers a read of 0x1206 with the live profile and
 * 0x110E switches it, and echoes every command. Band writes change the live profile only.
 */

import { toppingUsbHidHandler } from '../../devicePEQ/toppingUsbHidHandler.js';

const I = toppingUsbHidHandler._internal;

const packed = (enabled, type, gain10) => ((enabled ? 1 : 0) | (type << 8) | ((gain10 & 0xff) << 16)) >>> 0;

function nameWords(name) {
  const w = [0, 0, 0, 0];
  for (let i = 0; i < name.length && i < 15; i++) w[i >> 2] |= name.charCodeAt(i) << (8 * (i & 3));
  return w.map(x => x >>> 0);
}

// A profile's 78 words: name, preamp (dB), left bands, right bands ({type, freq, gain, q, enabled} per band; 11 each)
function configWords(name, preampDb, left, right = left) {
  const w = new Array(78).fill(0);
  nameWords(name).forEach((v, i) => { w[i] = v; });
  w[4] = 1; w[6] = 1;
  w[5] = w[7] = I.encodePreamp(preampDb);
  const put = (base, bands) => {
    for (let b = 0; b < 11; b++) {
      const f = bands[b] || { type: 1, freq: 632, gain: 0, q: 0.707, enabled: false };
      w[base + b * 3] = packed(f.enabled, f.type, Math.round(f.gain * 10));
      w[base + b * 3 + 1] = f.freq;
      w[base + b * 3 + 2] = Math.round(f.q * 10000);
    }
  };
  put(8, left);
  put(41, right);
  return w;
}

class ToppingMock extends EventTarget {
  constructor({ configs, live, header = true }) {
    super();
    this.configs = configs;
    this.live = live;
    this.header = header;
    this.sent = [];
    this.opened = true;
  }

  fire(frame) {
    const e = new Event('inputreport');
    e.data = new DataView(new Uint8Array(frame).buffer);
    this.dispatchEvent(e);
  }

  async sendReport(_reportId, data) {
    const f = Array.from(data);
    this.sent.push(f);
    const cmd = (f[5] << 8) | f[6];
    const value = ((f[7] << 24) | (f[8] << 16) | (f[9] << 8) | f[10]) | 0;
    const readAck = 17;
    const frame = (c, d, extra = {}) => I.buildHidFrame({ cmd: c, data: d, protocolType: readAck, ...extra });

    if (cmd === I.Commands.connectState) {
      setTimeout(() => {
        if (this.header) {
          this.fire(frame(I.Commands.upload, this.configs.length, { totalFrameLen: 2, curFrame: 0 }));
          this.fire(frame(I.Commands.upload, 7, { totalFrameLen: 2, curFrame: 1 }));
          this.configs.forEach(words => words.forEach((w, i) => this.fire(frame(I.Commands.upload, w | 0, { totalFrameLen: 78, curFrame: i }))));
        } else {
          this.configs[0].forEach((w, i) => this.fire(frame(I.Commands.upload, w | 0, { totalFrameLen: 78, curFrame: i })));
        }
      }, 2);
    }
    if (cmd === I.Commands.mcuEqCurrentConfig && f[2] === 16) {
      setTimeout(() => this.fire(frame(cmd, this.live)), 1);
      return;
    }
    if (cmd === I.Commands.switchMcuConfig) {
      this.live = value;
      // like the real device: the on/off state follows, volunteered
      setTimeout(() => this.fire(frame(I.Commands.mcuEqEnableState, value < 0 ? 0xc0 : 0xc1, { protocolType: 32 })), 3);
    }
    // a band write changes the live profile
    if ((cmd & 0xf000) === 0x9000 && cmd !== I.Commands.configSwitch && (cmd >> 8 & 0xf) >= 1 && (cmd >> 8 & 0xf) <= 11) {
      const band = ((cmd >> 8) & 0xf) - 1, sub = cmd & 0xff;
      const w = this.configs[this.live];
      const base = (sub <= 5 ? 8 : 41) + band * 3, k = ((sub - 1) % 5);
      if (k === 0 || k === 2) {
        const p = w[base];
        const type = k === 0 ? value : (p >> 8) & 0xff, gain = k === 2 ? value & 0xff : (p >> 16) & 0xff, en = p & 0xff;
        w[base] = ((en) | (type << 8) | (gain << 16)) >>> 0;
      } else if (k === 1) w[base + 1] = value;
      else if (k === 3) w[base + 2] = value;
      else if (k === 4) w[base] = ((w[base] & ~0xff) | (value & 0xff)) >>> 0;
    }
    setTimeout(() => this.fire(frame(cmd, value, { protocolType: f[2] })), 1);
  }

  get commands() { return this.sent.map(f => (f[5] << 8) | f[6]); }
  dataOf(cmd) { return this.sent.filter(f => ((f[5] << 8) | f[6]) === cmd).map(f => ((f[7] << 24) | (f[8] << 16) | (f[9] << 8) | f[10]) | 0); }
}

function details(mock) {
  return { rawDevice: mock, model: 'DX1 II', manufacturer: 'Topping', modelConfig: { availableSlots: [{ id: 0, name: 'Profile 1' }] } };
}

const HS = 5, LS = 4, LP = 2, HP = 3;
function threeProfiles() {
  return [
    configWords('Bass 1', -3, [{ type: LS, freq: 126, gain: 6.9, q: 0.707, enabled: true }]),
    configWords('Airy', -2,
      [{ type: HS, freq: 6483, gain: 3.9, q: 0.307, enabled: true }],
      [{ type: HS, freq: 6697, gain: 2.3, q: 0.307, enabled: true }]),
    configWords('Dynamic', -3, [{ type: 1, freq: 152, gain: -2.4, q: 0.707, enabled: true }, { type: HS, freq: 4000, gain: 2, q: 0.5, enabled: true }])
  ];
}

export function test_filterTypeCodes_matchTheOfficialPage(assert) {
  assert.equal(I.FilterType[1], 'PK');
  assert.equal(I.FilterType[2], 'LPF');
  assert.equal(I.FilterType[3], 'HPF');
  assert.equal(I.FilterType[4], 'LSQ');
  assert.equal(I.FilterType[5], 'HSQ');
  assert.equal(I.FilterTypeCode.LSQ, 4);
  assert.equal(I.FilterTypeCode.HSQ, 5);
  assert.equal(I.FilterTypeCode.LP, 2); // aliases used by other handlers
  assert.equal(I.FilterTypeCode.HP, 3);
  assert.equal(I.decodePackedBand(packed(true, 5, 23), 6697, 3070).type, 'HSQ');
}

export function test_names_and_preamp_decode_as_measured(assert) {
  assert.equal(I.decodeConfigName([0x73736142, 0x00003120, 0, 0]), 'Bass 1');
  assert.equal(I.decodeConfigName([0x616e7944, 0x0063696d, 0, 0]), 'Dynamic');
  assert.equal(I.decodeConfigName([0, 0, 0, 0]), '');
  assert.equal(I.decodePreamp(0x016a77c4), -3.0);
  assert.equal(I.encodePreamp(-1.0), 0x01c8520b);
  assert.equal(I.encodePreamp(0), 0x2000000);
}

export async function test_slots_are_the_devices_profiles_by_name(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 1 });
  const d = details(mock);
  const slots = await toppingUsbHidHandler.getAvailableSlots(d);
  assert.deepEqual(slots.map(s => [s.id, s.name]), [[0, 'Bass 1'], [1, 'Airy'], [2, 'Dynamic']]);
  assert.deepEqual(slots.map(s => s.writable), [true, true, true], 'a DX1 II can switch profile, so all are writable');
  assert.equal(await toppingUsbHidHandler.getCurrentSlot(d), 1);
}

export async function test_any_profile_can_be_read_with_preamp_and_right_channel(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 1 });
  const d = details(mock);
  const bass = await toppingUsbHidHandler.pullFromDevice(d, '0'); // the UI passes the slot as a string
  assert.equal(bass.filters[0].type, 'LSQ');
  assert.equal(bass.filters[0].freq, 126);
  assert.equal(bass.filters[0].gain, 6.9);
  assert.equal(bass.globalGain, -3);
  assert.equal(bass.rightFilters, undefined, 'identical channels: one set serves both');

  const airy = await toppingUsbHidHandler.pullFromDevice(d, 1);
  assert.equal(airy.filters[0].type, 'HSQ');
  assert.equal(airy.filters[0].freq, 6483);
  assert.equal(airy.filters[0].gain, 3.9);
  assert.equal(airy.filters[0].q, 0.307);
  assert.equal(airy.globalGain, -2);
  assert.equal(airy.rightFilters[0].freq, 6697);
  assert.equal(airy.rightFilters[0].gain, 2.3);

  const dyn = await toppingUsbHidHandler.pullFromDevice(d, 2);
  assert.equal(dyn.filters[1].freq, 4000);
  assert.equal(dyn.filters[1].type, 'HSQ');
}

export async function test_a_stream_without_a_header_reads_as_one_profile(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 0, header: false });
  const d = details(mock);
  const r = await toppingUsbHidHandler.pullFromDevice(d, 0);
  assert.equal(r.filters[0].freq, 126);
}

export async function test_push_to_another_profile_switches_first_and_writes_preamp(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 2 });
  const d = details(mock);
  await toppingUsbHidHandler.pushToDevice(d, {}, 0, -4, [
    { type: 'LSQ', freq: 100, gain: 3, q: 0.7, disabled: false },
    { type: 'HSQ', freq: 10000, gain: -3, q: 0.7, disabled: false },
    { type: 'LP', freq: 15000, gain: 0, q: 0.7, disabled: false }
  ]);
  const cmds = mock.commands;
  const sw = cmds.indexOf(I.Commands.switchMcuConfig);
  assert.ok(sw >= 0, 'switches the live profile');
  assert.ok(sw < cmds.indexOf(0x9101), 'before the first band write');
  assert.deepEqual(mock.dataOf(I.Commands.switchMcuConfig), [0]);
  assert.deepEqual(mock.dataOf(0x9101), [4], 'LSQ is code 4 (low shelf)');
  assert.deepEqual(mock.dataOf(0x9201), [5], 'HSQ is code 5 (high shelf)');
  assert.deepEqual(mock.dataOf(0x9301), [2], 'LP is code 2 (low pass)');
  assert.deepEqual(mock.dataOf(I.Commands.preampL), [I.encodePreamp(-4)]);
  assert.deepEqual(mock.dataOf(I.Commands.preampR), [I.encodePreamp(-4)]);
  // the write landed in profile 0 only
  assert.equal(mock.configs[0][9], 100);
  assert.equal(mock.configs[2][9], 152);
}

export async function test_push_to_the_live_profile_does_not_switch(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 1 });
  await toppingUsbHidHandler.pushToDevice(details(mock), {}, 1, 0, [{ type: 'PK', freq: 1000, gain: 1, q: 1, disabled: false }]);
  assert.equal(mock.commands.includes(I.Commands.switchMcuConfig), false);
}

export async function test_right_channel_can_differ_on_push(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 1 });
  await toppingUsbHidHandler.pushToDevice(details(mock), {}, 1, 0,
    [{ type: 'PK', freq: 1000, gain: 1, q: 1, disabled: false }], // left
    [{ type: 'PK', freq: 2000, gain: -2, q: 2, disabled: false }]); // right
  assert.deepEqual(mock.dataOf(0x9102), [1000]);
  assert.deepEqual(mock.dataOf(0x9107), [2000]);
  assert.deepEqual(mock.dataOf(0x9108), [-20]);
}

// ── E50 II: 10 bands, its own heartbeat, and only the live profile can be written ──

function e50Details(mock) {
  return { rawDevice: mock, model: 'E50 II', manufacturer: 'Topping', modelConfig: { bandCount: 10, heartbeatCommand: 0x7136, profileSwitch: false } };
}

export async function test_e50ii_reads_10_bands(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 0 });
  const r = await toppingUsbHidHandler.pullFromDevice(e50Details(mock), 0);
  assert.equal(r.filters.length, 10);
}

export async function test_e50ii_only_the_live_profile_can_be_written(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 1 });
  const d = e50Details(mock);
  const slots = await toppingUsbHidHandler.getAvailableSlots(d);
  assert.deepEqual(slots.map(s => s.writable), [false, true, false]);
  let threw = false;
  try {
    await toppingUsbHidHandler.pushToDevice(d, {}, 0, 0, [{ type: 'PK', freq: 1000, gain: 1, q: 1, disabled: false }]);
  } catch (e) { threw = true; }
  assert.ok(threw, 'a push to another profile is refused');
  assert.equal(mock.commands.includes(I.Commands.switchMcuConfig), false);
  assert.equal(mock.commands.filter(c => (c & 0xf000) === 0x9000).length, 0, 'and writes nothing');
  await toppingUsbHidHandler.pushToDevice(d, {}, 1, 0, [{ type: 'PK', freq: 1000, gain: 1, q: 1, disabled: false }]);
  assert.ok(mock.commands.includes(0x9101));
}

export async function test_e50ii_push_writes_at_most_10_bands_and_uses_its_heartbeat(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 0 });
  const filters = Array.from({ length: 12 }, (_, i) => ({ type: 'PK', freq: 100 * (i + 1), gain: 1, q: 1, disabled: false }));
  await toppingUsbHidHandler.pushToDevice(e50Details(mock), {}, 0, 0, filters);
  assert.equal(mock.commands.filter(c => (c & 0xff00) === 0x9b00).length, 0, 'band 11 is not written');
  assert.ok(mock.commands.includes(0x9a01), 'band 10 is');
}

// ── The EQ selector ──

export async function test_enablePEQ_is_the_pages_eq_selector(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 0 });
  const d = details(mock);
  await toppingUsbHidHandler.enablePEQ(d, true, 2);
  assert.deepEqual(mock.dataOf(I.Commands.switchMcuConfig), [2]);
  await toppingUsbHidHandler.enablePEQ(d, false, 2);
  assert.deepEqual(mock.dataOf(I.Commands.switchMcuConfig), [2, -1], '-1 is "no EQ"');
  assert.equal(mock.commands.includes(I.Commands.mcuEqEnableState), false, 'it no longer writes 0x1204');
}

export async function test_enablePEQ_on_a_model_that_cannot_switch_uses_its_one_profile(assert) {
  const mock = new ToppingMock({ configs: threeProfiles(), live: 0 });
  await toppingUsbHidHandler.enablePEQ(e50Details(mock), true, 2);
  assert.deepEqual(mock.dataOf(I.Commands.switchMcuConfig), [0]);
}

export function test_the_on_off_state_is_decoded_as_the_page_does(assert) {
  assert.equal(I.decodeEnabled(0xc1), true);
  assert.equal(I.decodeEnabled(0xc0), false);
  assert.equal(I.decodeEnabled(7), true);
  assert.equal(I.decodeEnabled(5), false);
}

// ── DX5 II: the same protocol as the DX1 II (11 bands, switchable profiles), as read from a real unit ──

function dx5Details(mock) {
  return { rawDevice: mock, model: 'DX5 II', manufacturer: 'Topping', modelConfig: { bandCount: 11 } };
}

function dx5Profiles() {
  const peng = [24, 35, 57, 170, 300, 430, 640, 1000, 5000].map((freq, i) => ({
    type: 1, freq, gain: [1.8, -0.2, 0.3, -1.0, -0.5, 1.6, -0.5, 0.4, 1.3][i], q: [0.5, 1.9, 2.0, 0.9, 1.5, 2.0, 1.9, 0.7, 0.6][i], enabled: true
  }));
  const pengRight = peng.map((b, i) => (i === 3 ? { ...b, gain: -2.0 } : b)); // the right channel differs
  return [
    configWords('Airy', -2, [{ type: HS, freq: 4000, gain: 0.4, q: 0.5, enabled: true }]),
    configWords('Warm', -3.5, [{ type: LS, freq: 150, gain: 3.0, q: 0.707, enabled: true }]),
    configWords('Peng2', -0.5, peng, pengRight)
  ];
}

export async function test_dx5ii_lists_and_reads_its_profiles(assert) {
  const mock = new ToppingMock({ configs: dx5Profiles(), live: 0 });
  const d = dx5Details(mock);
  const slots = await toppingUsbHidHandler.getAvailableSlots(d);
  assert.deepEqual(slots.map(s => s.name), ['Airy', 'Warm', 'Peng2']);
  assert.deepEqual(slots.map(s => s.writable), [true, true, true], 'a DX5 II switches profile, so any can be written');
  assert.equal(await toppingUsbHidHandler.getCurrentSlot(d), 0);

  const airy = await toppingUsbHidHandler.pullFromDevice(d, 0);
  assert.equal(airy.filters.length, 11);
  assert.equal(airy.filters[0].type, 'HSQ');
  assert.equal(airy.filters[0].freq, 4000);
  assert.equal(airy.globalGain, -2);
  assert.equal(airy.rightFilters, undefined);

  const peng = await toppingUsbHidHandler.pullFromDevice(d, 2);
  assert.equal(peng.globalGain, -0.5);
  assert.equal(peng.filters[3].gain, -1.0);
  assert.equal(peng.rightFilters[3].gain, -2.0, 'the right channel differs from the left');
}

export async function test_dx5ii_push_to_another_profile_switches_first(assert) {
  const mock = new ToppingMock({ configs: dx5Profiles(), live: 0 });
  await toppingUsbHidHandler.pushToDevice(dx5Details(mock), {}, 2, -1, [{ type: 'PK', freq: 1000, gain: 2, q: 1, disabled: false }]);
  assert.deepEqual(mock.dataOf(I.Commands.switchMcuConfig), [2]);
  assert.ok(mock.commands.indexOf(I.Commands.switchMcuConfig) < mock.commands.indexOf(0x9101));
  assert.deepEqual(mock.dataOf(I.Commands.preampL), [I.encodePreamp(-1)]);
}
