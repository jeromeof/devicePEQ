/**
 * WiiM network handler — tests with a mocked fetch (no real device).
 * Handler: devicePEQ/wiimNetworkHandler.js
 *
 * WiiM uses the Linkplay HTTP API over HTTPS with mode:"no-cors", so in a real
 * browser the responses are OPAQUE (status 0, body unreadable):
 *   - pushToDevice tolerates opaque (it only checks status === 0) → works.
 *   - pullFromDevice cannot read an opaque body → throws a CORS error.
 * We test both, plus the parse path when a CORS-enabled proxy returns readable JSON.
 */

import { wiimNetworkHandler } from '../../devicePEQ/wiimNetworkHandler.js';
import { MockFetch, jsonResponse, opaqueResponse, parseWiimCommandUrl } from '../MockNetwork.js';

const DEVICE = { ip: '10.0.0.50' };

async function withMock(fn) {
  const net = new MockFetch().install();
  try { return await fn(net); }
  finally { net.restore(); }
}

// ── push ───────────────────────────────────────────────────────────────────────

export async function test_pushToDevice_worksThroughOpaqueResponses(assert) {
  await withMock(async (net) => {
    net.on('EQSetLV2SourceBand', () => opaqueResponse());
    net.on('EQSourceSave', () => opaqueResponse());

    const filters = [{ type: 'PK', freq: 100, q: 1, gain: 3 }];
    const result = await wiimNetworkHandler.pushToDevice(DEVICE, null, 0, 0, filters);

    assert.equal(result, false, 'push returns false (no restart needed)');
    assert.equal(net.callsMatching('EQSetLV2SourceBand').length, 1, 'sends one EQSet command');
    assert.equal(net.callsMatching('EQSourceSave').length, 1, 'sends one preset-save command');
  });
}

export async function test_pushToDevice_buildsTenBandsWithProvidedFiltersFirst(assert) {
  await withMock(async (net) => {
    net.on('EQSetLV2SourceBand', () => opaqueResponse());
    net.on('EQSourceSave', () => opaqueResponse());

    const filters = [
      { type: 'PK', freq: 100, q: 1.0, gain: 3 },
      { type: 'LSQ', freq: 200, q: 0.7, gain: -2 },
      { type: 'HSQ', freq: 8000, q: 0.7, gain: 4 },
    ];
    await wiimNetworkHandler.pushToDevice(DEVICE, null, 0, 0, filters);

    const setCall = net.callsMatching('EQSetLV2SourceBand')[0];
    const { payload } = parseWiimCommandUrl(setCall.url);
    assert.equal(payload.EQStat, 'On', 'EQ is enabled');
    assert.equal(payload.channelMode, 'Stereo', 'stereo channel mode');

    // Index params by name for easy assertions.
    const byName = Object.fromEntries(payload.EQBand.map(p => [p.param_name, p.value]));

    // Band a (provided, PK) → mode 1, freq/q/gain echoed
    assert.equal(byName['a_mode'], 1, 'band a is Peak (mode 1)');
    assert.equal(byName['a_freq'], 100, 'band a freq');
    assert.equal(byName['a_gain'], 3, 'band a gain');
    // Band b (LSQ → 0), c (HSQ → 2)
    assert.equal(byName['b_mode'], 0, 'band b is Low-Shelf (mode 0)');
    assert.equal(byName['c_mode'], 2, 'band c is High-Shelf (mode 2)');

    // Bands d..j must be reset: mode -1 (Off), gain 0
    for (const band of ['d', 'e', 'f', 'g', 'h', 'i', 'j']) {
      assert.equal(byName[`${band}_mode`], -1, `band ${band} disabled`);
      assert.equal(byName[`${band}_gain`], 0, `band ${band} gain reset to 0`);
    }

    // 10 bands worth of 4 params each = 40 entries
    assert.equal(payload.EQBand.length, 40, '10 bands × 4 params = 40 EQBand entries');
  });
}

export async function test_pushToDevice_disabledFilterMapsToOff(assert) {
  await withMock(async (net) => {
    net.on('EQSetLV2SourceBand', () => opaqueResponse());
    net.on('EQSourceSave', () => opaqueResponse());

    const filters = [{ type: 'PK', freq: 100, q: 1, gain: 3, disabled: true }];
    await wiimNetworkHandler.pushToDevice(DEVICE, null, 0, 0, filters);

    const { payload } = parseWiimCommandUrl(net.callsMatching('EQSetLV2SourceBand')[0].url);
    const byName = Object.fromEntries(payload.EQBand.map(p => [p.param_name, p.value]));
    assert.equal(byName['a_mode'], -1, 'disabled filter → mode -1 (Off)');
  });
}

// ── pull ─────────────────────────────────────────────────────────────────────

export async function test_pullFromDevice_throwsOnOpaqueCors(assert) {
  await withMock(async (net) => {
    net.on('EQGetLV2SourceBandEx', () => opaqueResponse());
    let threw = null;
    try { await wiimNetworkHandler.pullFromDevice(DEVICE, 0); }
    catch (e) { threw = e; }
    assert.ok(threw, 'pull should throw on an opaque (CORS-blocked) response');
    assert.ok(/CORS|mixed-content|proxy/i.test(threw.message),
      `error should explain the CORS/proxy limitation, got: ${threw && threw.message}`);
  });
}

export async function test_pullFromDevice_parsesReadableResponse(assert) {
  await withMock(async (net) => {
    // Simulate a CORS-enabled proxy returning a readable JSON body.
    net.on('EQGetLV2SourceBandEx', () => jsonResponse({
      status: 'OK',
      EQBand: [
        { param_name: 'a_mode', value: 1 },   // Peak
        { param_name: 'a_freq', value: 120 },
        { param_name: 'a_q', value: 1.2 },
        { param_name: 'a_gain', value: 3.5 },
        { param_name: 'b_mode', value: 0 },    // Low-Shelf
        { param_name: 'b_freq', value: 80 },
        { param_name: 'b_q', value: 0.7 },
        { param_name: 'b_gain', value: -2 },
      ],
    }));

    const result = await wiimNetworkHandler.pullFromDevice(DEVICE, 0);
    assert.equal(result.filters.length, 2, 'parses two bands');
    assert.equal(result.filters[0].type, 'Peak', 'band a type Peak');
    assert.equal(result.filters[0].freq, 120, 'band a freq');
    assert.equal(result.filters[0].gain, 3.5, 'band a gain');
    assert.equal(result.filters[1].type, 'Low-Shelf', 'band b type Low-Shelf');
    assert.equal(result.filters[1].disabled, false, 'band b not disabled');
  });
}

// ── enable / disable ───────────────────────────────────────────────────────────

export async function test_enablePEQ_usesChangeAndOffCommands(assert) {
  await withMock(async (net) => {
    net.on('httpapi.asp', () => opaqueResponse());

    await wiimNetworkHandler.enablePEQ(DEVICE, true, 0);
    await wiimNetworkHandler.enablePEQ(DEVICE, false, 0);

    assert.equal(net.callsMatching('EQChangeSourceFX').length, 1, 'enable → EQChangeSourceFX');
    assert.equal(net.callsMatching('EQSourceOff').length, 1, 'disable → EQSourceOff');
  });
}
