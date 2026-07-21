/**
 * Luxsin X9 network handler — tests with a mocked fetch (no real device).
 * Handler: devicePEQ/luxsinNetworkHandler.js
 *
 * Luxsin uses plain HTTP with a CUSTOM base64 alphabet for both request and
 * response bodies (/dev/info.cgi). These tests:
 *   - pull: GET syncData + syncPeq (custom-encoded JSON), decode + map filters
 *   - push: GET syncData then POST custom-encoded JSON; verify the encoded payload
 *           (existing slot uses stringified filters; "new" uses a raw array)
 *
 * The device codec is replicated here so the mock can encode responses and decode
 * the POST body the handler sends.
 */

import { luxsinNetworkHandler } from '../../devicePEQ/luxsinNetworkHandler.js';
import { MockFetch, textResponse, jsonResponse } from '../MockNetwork.js';

const DEVICE = { ip: '192.168.1.77' };

// ── Luxsin custom base64 codec (mirrors the handler's private RC/PC alphabets) ──
const RC = 'KLMPQRSTUVWXYZABCGHdefIJjkNOlmnopqrstuvwxyzabcghiDEF34501289+67/';
const PC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeCustom(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  let out = '';
  for (const ch of base64) {
    const idx = PC.indexOf(ch);
    out += idx !== -1 ? RC.charAt(idx) : ch;
  }
  return out;
}

function decodeCustom(encoded) {
  let base64 = '';
  for (const ch of encoded) {
    const idx = RC.indexOf(ch);
    base64 += idx !== -1 ? PC.charAt(idx) : ch;
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Decode the POST body the handler sent (a URLSearchParams with a `json` field). */
function decodePostedPayload(call) {
  const body = call.options.body;
  const encoded = typeof body.get === 'function' ? body.get('json') : new URLSearchParams(body).get('json');
  return JSON.parse(decodeCustom(encoded));
}

function makeDeviceData() {
  return {
    peqSelect: 0,
    peqEnable: 1,
    peq: [
      { name: 'Flat', preamp: 0, canDel: 0, filters: '[]' },
      {
        name: 'Custom', preamp: -3, canDel: 1,
        filters: JSON.stringify([
          { type: 4, fc: 100, gain: 3, q: 1.0 },   // PK
          { type: 5, fc: 80, gain: -2, q: 0.7 },    // LSQ (low-shelf)
          { type: 6, fc: 9000, gain: 4, q: 0.7 },   // HSQ (high-shelf)
        ]),
      },
    ],
  };
}

async function withMock(fn) {
  const net = new MockFetch().install();
  try { return await fn(net); }
  finally { net.restore(); }
}

// ── pull ─────────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_decodesAndMapsFilters(assert) {
  await withMock(async (net) => {
    net.on('action=syncData', () => textResponse(encodeCustom(JSON.stringify(makeDeviceData()))));
    // syncPeq selects profile 1 (Custom) — exercises the merge over syncData.
    net.on('action=syncPeq', () => textResponse(encodeCustom(JSON.stringify({ peqSelect: 1, peqEnable: 1 }))));

    const result = await luxsinNetworkHandler.pullFromDevice(DEVICE, 0);

    assert.equal(result.currentSlot, 1, 'currentSlot follows syncPeq.peqSelect (merged)');
    assert.equal(result.globalGain, -3, 'preamp from the selected profile');
    assert.equal(result.filters.length, 3, 'three filters in the Custom profile');
    assert.deepEqual(result.filters.map(f => f.type), ['PK', 'LSQ', 'HSQ'],
      'Luxsin type codes 4/5/6 map to PK/LSQ/HSQ');
    assert.deepEqual(result.filters.map(f => f.freq), [100, 80, 9000], 'fc → freq');
    assert.deepEqual(result.filters.map(f => f.gain), [3, -2, 4], 'gains preserved');
  });
}

export async function test_pullFromDevice_exposesProfilesIncludingNew(assert) {
  await withMock(async (net) => {
    net.on('action=syncData', () => textResponse(encodeCustom(JSON.stringify(makeDeviceData()))));
    net.on('action=syncPeq', () => textResponse(encodeCustom(JSON.stringify({ peqSelect: 0 }))));

    const result = await luxsinNetworkHandler.pullFromDevice(DEVICE, 0);
    const names = result.deviceDetails.profiles.map(p => p.name);
    assert.deepEqual(names, ['Flat', 'Custom', 'New'], 'profiles list ends with synthetic "New"');
  });
}

// ── push ─────────────────────────────────────────────────────────────────────

export async function test_pushToDevice_updateExistingSlotSendsStringifiedFilters(assert) {
  await withMock(async (net) => {
    net.on('action=syncData', () => textResponse(encodeCustom(JSON.stringify(makeDeviceData()))));
    net.on(u => u.endsWith('/dev/info.cgi'), () => jsonResponse({}));   // POST

    const filters = [
      { type: 'PK', freq: 120, q: 1.1, gain: 2 },
      { type: 'HSQ', freq: 8000, q: 0.7, gain: -1 },
    ];
    const result = await luxsinNetworkHandler.pushToDevice(DEVICE, null, 1, -4, filters);

    assert.equal(result, false, 'push returns false (no restart)');
    const post = net.calls.find(c => (c.options.method || 'GET') === 'POST');
    assert.ok(post, 'a POST was made to /dev/info.cgi');

    const payload = decodePostedPayload(post);
    assert.ok(Array.isArray(payload.peq), 'existing-slot update uses the `peq` array key');
    assert.equal(payload.peq[0].index, 1, 'targets slot index 1');
    assert.equal(payload.peq[0].preamp, -4, 'preamp passed through');
    assert.equal(typeof payload.peq[0].filters, 'string', 'filters are a JSON STRING for updates');

    const parsed = JSON.parse(payload.peq[0].filters);
    assert.deepEqual(parsed.map(f => f.type), [4, 6], 'PK→4, HSQ→6 (Luxsin codes)');
    assert.deepEqual(parsed.map(f => f.fc), [120, 8000], 'freq → fc');
  });
}

export async function test_pushToDevice_newPresetSendsRawArray(assert) {
  await withMock(async (net) => {
    net.on('action=syncData', () => textResponse(encodeCustom(JSON.stringify(makeDeviceData()))));
    net.on(u => u.endsWith('/dev/info.cgi'), () => jsonResponse({}));

    const filters = [{ type: 'LSQ', freq: 60, q: 0.7, gain: 5 }];
    await luxsinNetworkHandler.pushToDevice(DEVICE, { fileName: 'MyTuning' }, 'new', 0, filters);

    const post = net.calls.find(c => (c.options.method || 'GET') === 'POST');
    const payload = decodePostedPayload(post);
    assert.ok(payload.peqChange, 'new preset uses the `peqChange` key');
    assert.equal(payload.peqChange.name, 'MyTuning', 'preset name from phoneObj.fileName');
    assert.ok(Array.isArray(payload.peqChange.filters), 'filters are a RAW ARRAY for new presets');
    assert.equal(payload.peqChange.filters[0].type, 5, 'LSQ → 5');
  });
}

// ── enable / slots ─────────────────────────────────────────────────────────────

export async function test_enablePEQ_postsPeqEnableAndSelect(assert) {
  await withMock(async (net) => {
    net.on(u => u.endsWith('/dev/info.cgi'), () => jsonResponse({}));

    await luxsinNetworkHandler.enablePEQ(DEVICE, true, 2);
    const post = net.calls.find(c => (c.options.method || 'GET') === 'POST');
    const payload = decodePostedPayload(post);
    assert.equal(payload.peqEnable, 1, 'peqEnable set to 1');
    assert.equal(payload.peqSelect, 2, 'peqSelect carries the slot id');
  });
}

export async function test_getCurrentSlot_readsPeqSelect(assert) {
  await withMock(async (net) => {
    net.on('action=syncPeq', () => textResponse(encodeCustom(JSON.stringify({ peqSelect: 3 }))));
    const slot = await luxsinNetworkHandler.getCurrentSlot(DEVICE);
    assert.equal(slot, 3, 'getCurrentSlot returns peqSelect');
  });
}

export async function test_getAvailableSlots_listsProfilesPlusNew(assert) {
  await withMock(async (net) => {
    net.on('action=syncPeq', () => textResponse(encodeCustom(JSON.stringify(makeDeviceData()))));
    const slots = await luxsinNetworkHandler.getAvailableSlots(DEVICE);
    assert.deepEqual(slots.map(s => s.name), ['Flat', 'Custom', 'New'], 'slots include synthetic "New"');
    assert.equal(slots[slots.length - 1].id, 'new', 'last slot id is "new"');
  });
}
