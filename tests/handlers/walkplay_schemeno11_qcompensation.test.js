/**
 * WalkPlay SchemeNo11 — centre-frequency and Q compensation.
 *
 * These parts design their biquads for ~49152 Hz while running at 48000, which
 * shows up twice on a measurement:
 *
 *   - every band lands ~2.3% low            -> freqCompensation ratio 0.9775
 *   - realised Q falls off towards Nyquist  -> qCompensation cosNyquist designFs 49152
 *
 * The Q law is cos(pi*f/fs) with no fitted constants — see compensation.js for
 * where it comes from. It is ~1.0 through the midrange and only bites above a
 * few kHz, so the assertions below deliberately test BOTH ends: a band at 1 kHz
 * must come out essentially untouched, and a band at 12 kHz must be visibly
 * corrected.
 *
 * The existing per-device SchemeNo11 suites only assert that a push does not
 * throw, so without this file the compensation is not covered by anything.
 */

import { loadCapture } from '../MockHIDDevice.js';
import { walkplayUsbHID } from '../../devicePEQ/walkplayHidHandler.js';

const CAPTURE = '../captures/walkplay_schemeno11_epz_tp13.json';
const DESIGN_FS = 49152;   // the device's own biquad design rate, not any stream rate
const FREQ_FACTOR = 0.9775;

function makeDeviceDetails(mock, overrides = {}) {
  return {
    rawDevice: mock,
    model: mock.productName,
    manufacturer: 'WalkPlay',
    modelConfig: {
      peqConstraintsRef:   'walkplayPeq8Band10dBLsLowpass',
      schemeNo:             11,
      maxFilters:           8,
      minGain:             -10,
      maxGain:              10,
      minQ:                0.1,
      maxQ:               10.0,
      firstWritableEQSlot: 101,
      maxWritableEQSlots:    1,
      disconnectOnSave:    false,
      deviceHandlesPregain: false,
      availableSlots: [{ id: 101, name: 'Custom' }],
      freqCompensation: { model: 'ratio', factor: 0.9775 },
      qCompensation:    { model: 'cosNyquist', designFs: DESIGN_FS },
      ...overrides
    }
  };
}

// The handler writes Q as 8.8 fixed point at bytes 29/30 of each PEQ_VALUES
// packet, and the requested frequency (already frequency-compensated) at 27/28.
function decodeWrittenBands(mock) {
  const out = [];
  for (const bytes of mock.sentBytes) {
    if (!bytes || bytes.length < 34) continue;
    if (bytes[0] !== 0x01 || bytes[1] !== 0x09) continue;   // WRITE, CMD.PEQ_VALUES
    out.push({
      index: bytes[4],
      freq:  bytes[27] | (bytes[28] << 8),
      q:    (bytes[29] | (bytes[30] << 8)) / 256,
    });
  }
  return out;
}

// Keyed off the frequency actually written, which is why no stream rate appears
// anywhere in this file: requested -> /0.9775 -> that is what the device sees.
const qLaw = (requestedFreq) => Math.cos(Math.PI * (requestedFreq / FREQ_FACTOR) / DESIGN_FS);

async function pushOne(details, mock, filter) {
  const bands = [filter, ...Array.from({ length: 7 }, () => ({ disabled: true }))];
  await walkplayUsbHID.pushToDevice(details, null, 101, 0, bands);
  // sentBytes accumulates across pushes, so take the LAST band-0 write — with
  // find() every call in a loop would keep re-reading the first push.
  const band0 = decodeWrittenBands(mock).filter((b) => b.index === 0);
  return band0[band0.length - 1];
}

// ── the law is applied on write ───────────────────────────────────────────────

export async function test_highFrequencyBandGetsHigherQThanRequested(assert) {
  const mock = await loadCapture(CAPTURE);
  await mock.open();
  const details = makeDeviceDetails(mock);
  const written = await pushOne(details, mock, { freq: 12000, gain: 6, q: 2, type: 'PK' });
  assert.ok(written, 'band 0 should have been written');
  // The device is sent 12000/0.9775 = 12276 Hz and realises cos(pi*12276/49152)
  // = 0.707 of the Q it is told, so to land on Q=2 it must be sent ~2.83.
  const expected = 2 / qLaw(12000);
  assert.ok(Math.abs(written.q - expected) < 0.02,
    `12 kHz Q=2 should be sent as ~${expected.toFixed(2)}, got ${written.q}`);
  assert.ok(written.q > 2.5, `sent Q should be well above the requested 2, got ${written.q}`);
}

export async function test_midrangeBandIsEssentiallyUntouched(assert) {
  const mock = await loadCapture(CAPTURE);
  await mock.open();
  const details = makeDeviceDetails(mock);
  const written = await pushOne(details, mock, { freq: 1000, gain: 6, q: 2, type: 'PK' });
  // ~0.998 at 1 kHz — a midrange band must not be meaningfully moved,
  // or this law would be silently altering filters it has no evidence about.
  assert.ok(Math.abs(written.q - 2) < 0.02,
    `1 kHz Q=2 should be sent essentially unchanged, got ${written.q}`);
}

export async function test_compensationGrowsWithFrequency(assert) {
  const mock = await loadCapture(CAPTURE);
  await mock.open();
  const details = makeDeviceDetails(mock);
  const sent = [];
  for (const freq of [1000, 5000, 8000, 12000, 16000]) {
    const w = await pushOne(details, mock, { freq, gain: 6, q: 2, type: 'PK' });
    sent.push({ freq, q: w.q });
  }
  for (let i = 1; i < sent.length; i++) {
    assert.ok(sent[i].q > sent[i - 1].q,
      `sent Q should rise with frequency: ${sent[i - 1].freq}Hz->${sent[i - 1].q.toFixed(3)} ` +
      `vs ${sent[i].freq}Hz->${sent[i].q.toFixed(3)}`);
  }
}

// ── and undone on read ────────────────────────────────────────────────────────

export async function test_pullReportsTheQThatWillBeHeard(assert) {
  const mock = await loadCapture(CAPTURE);
  await mock.open();
  const details = makeDeviceDetails(mock);
  const withComp = await walkplayUsbHID.pullFromDevice(details, 101);

  const plainMock = await loadCapture(CAPTURE);
  await plainMock.open();
  const plain = await walkplayUsbHID.pullFromDevice(
    makeDeviceDetails(plainMock, { qCompensation: undefined, freqCompensation: undefined }), 101);

  // Same stored bytes, so any difference is the read-side correction. It must
  // report a LOWER Q than the raw value: the device realises less than it stores.
  let compared = 0;
  for (let i = 0; i < withComp.filters.length; i++) {
    const a = withComp.filters[i], b = plain.filters[i];
    if (!a || !b || !(b.q > 0) || !(b.freq > 0)) continue;
    compared++;
    assert.ok(a.q <= b.q + 1e-9,
      `band ${i} (${b.freq}Hz): compensated read ${a.q} should not exceed raw ${b.q}`);
  }
  assert.ok(compared > 0, 'should have compared at least one populated band');
}

export async function test_writeThenReadRoundTripsUnchanged(assert) {
  // The correction must be exactly invertible, or a pull -> push cycle would
  // compound it and drift the user's filters a little further every save.
  const { compensateQForWrite, decompensateQFromRead } =
    await import('../../devicePEQ/compensation.js');
  const modelConfig = { qCompensation: { model: 'cosNyquist', designFs: DESIGN_FS }, minQ: 0.1, maxQ: 20 };

  for (const freq of [100, 1000, 5000, 8000, 12000, 16000]) {
    for (const q of [0.5, 1, 2, 5]) {
      const written = freq / FREQ_FACTOR;   // what the handler actually sends
      const sent = compensateQForWrite(q, 6, 'PK', modelConfig, { freq: written });
      if (sent >= modelConfig.maxQ - 1e-9) continue;   // clamped, not expected to invert
      const back = decompensateQFromRead(sent, 6, 'PK', modelConfig, { freq: written });
      assert.ok(Math.abs(back - q) < 1e-9,
        `${freq}Hz Q=${q}: round trip returned ${back}`);
    }
  }
}

export async function test_verificationBypassDisablesIt(assert) {
  const C = await import('../../devicePEQ/compensation.js');
  const modelConfig = { qCompensation: { model: 'cosNyquist', designFs: DESIGN_FS }, minQ: 0.1, maxQ: 20 };
  try {
    C.setCompensationEnabledForVerification(false);
    assert.equal(C.compensateQForWrite(2, 6, 'PK', modelConfig, { freq: 16000 }), 2,
      'with the verification bypass on, Q must be written raw');
  } finally {
    C.setCompensationEnabledForVerification(true);
  }
  assert.ok(C.compensateQForWrite(2, 6, 'PK', modelConfig, { freq: 16000 }) > 2,
    'and restored afterwards');
}
