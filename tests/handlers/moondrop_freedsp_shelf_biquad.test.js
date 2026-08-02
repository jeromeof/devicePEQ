/**
 * moondropUsbHidHandler.js — biquad coefficient correctness tests.
 *
 * Covers devices in peqConstraintsConfig.json's peq8Band12dBFullShelves
 * profile (LSQ/HSQ-capable): Rays, FreeDSP Pro, MOONRIVER 3, FreeDSP Mini,
 * DAWN PRO2, Echo A, AG Rays, DHA15, Deco Audio System, INN Deco75-DH Audio,
 * ddHiFi DSP IEM - Memory. (Marigold/MOONDROP Marigold use this same handler
 * but peq8Band6dBPkOnly — PK only, never exercises the LSQ/HSQ path below.)
 *
 * Until this file, encodeBiquad() had NO test coverage at all: LSQ/HSQ filters
 * silently got peaking-filter coefficients (the type byte said "shelf", the
 * actual biquad taps said "peak") — see the fix in moondropUsbHidHandler.js
 * and the investigation in testing/rew-peq-capability-test/filter-response.real.test.js.
 */

import { MockHIDDevice } from '../MockHIDDevice.js';
import { moondropUsbHidHandler } from '../../devicePEQ/moondropUsbHidHandler.js';
import { theoreticalMagnitudeDb } from '../../testing/rew-peq-capability-test/filter-response.mjs';

function makeDeviceDetails(mock) {
  return {
    rawDevice: mock,
    model: 'FreeDSP Pro',
    manufacturer: 'Moondrop',
    modelConfig: {
      peqConstraintsRef: 'peq8Band12dBFullShelves',
      supportsLSFilter: true,
      supportsHSFilter: true,
      deviceHandlesPregain: false,
      maxFilters: 8,
      availableSlots: [{ id: 0, name: 'A' }],
    },
  };
}

function makeMock() {
  return new MockHIDDevice({ vendorId: 0x2FC6, productId: 0xF06A, productName: 'FreeDSP Pro', reportId: 0, exchanges: [] });
}

const readS32LE = (data, offset) => {
  const u32 = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
  return u32 | 0; // force 32-bit signed
};

async function pushAndDecodeCoefficients(filterSpec) {
  const mock = makeMock();
  await mock.open();
  const details = makeDeviceDetails(mock);
  try { await moondropUsbHidHandler.pushToDevice(details, {}, 0, 0, [filterSpec]); } catch (e) { /* no real device to ack */ }

  const writeReport = mock._sentReports.find((r) => r.bytes[0] === 1 && r.bytes[1] === 9); // COMMAND_WRITE, COMMAND_UPDATE_EQ
  const bytes = writeReport.bytes;
  const QUANTIZER = 1073741824; // 2^30
  return {
    b0: readS32LE(bytes, 7) / QUANTIZER,
    b1: readS32LE(bytes, 11) / QUANTIZER,
    b2: readS32LE(bytes, 15) / QUANTIZER,
    a1: -readS32LE(bytes, 19) / QUANTIZER, // stored negated on the wire
    a2: -readS32LE(bytes, 23) / QUANTIZER,
    typeByte: bytes[33],
  };
}

// |H(e^jw)| in dB for a normalized biquad (a0=1), evaluated at evalFreq —
// same math as filter-response.js's biquadMagnitudeDb, applied directly to
// the decoded wire coefficients so this test doesn't depend on re-deriving
// them from freq/gain/Q itself.
function biquadMagnitudeDb({ b0, b1, b2, a1, a2 }, evalFreq, fs) {
  const w = (2 * Math.PI * evalFreq) / fs;
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const cos2w = Math.cos(2 * w), sin2w = Math.sin(2 * w);
  const numRe = b0 + b1 * cosw + b2 * cos2w;
  const numIm = -(b1 * sinw + b2 * sin2w);
  const denRe = 1 + a1 * cosw + a2 * cos2w;
  const denIm = -(a1 * sinw + a2 * sin2w);
  return 20 * Math.log10(Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm));
}

async function assertMatchesTheoreticalModel(assert, filterSpec, label) {
  const coeffs = await pushAndDecodeCoefficients(filterSpec);
  const evalFreqs = [20, 50, 100, 200, 500, 1000, 2000, 4000, 8000, 15000, 20000];
  let maxErr = 0;
  for (const f of evalFreqs) {
    const decoded = biquadMagnitudeDb(coeffs, f, 96000);
    const theory = theoreticalMagnitudeDb(filterSpec, f, 96000);
    maxErr = Math.max(maxErr, Math.abs(decoded - theory));
  }
  assert.ok(maxErr < 0.001, `${label}: decoded wire coefficients should match the theoretical RBJ model to <0.001dB, got max error ${maxErr.toFixed(4)}dB`);
  return coeffs;
}

export async function test_PK_biquad_matches_theoretical_model(assert) {
  await assertMatchesTheoreticalModel(assert, { freq: 1000, gain: 6, q: 1.0, type: 'PK' }, 'PK');
}

export async function test_LSQ_biquad_matches_theoretical_model(assert) {
  await assertMatchesTheoreticalModel(assert, { freq: 500, gain: 6, q: 1.0, type: 'LSQ' }, 'LSQ');
}

export async function test_HSQ_biquad_matches_theoretical_model(assert) {
  await assertMatchesTheoreticalModel(assert, { freq: 4000, gain: -6, q: 1.0, type: 'HSQ' }, 'HSQ');
}

// The actual bug this file exists to catch: LSQ/HSQ used to get IDENTICAL
// coefficients to a PK filter with the same freq/gain/Q (the type byte was
// the only thing that changed) because encodeBiquad() never branched on
// type at all. A shelf and a peak are structurally different filters, so a
// real fix must produce different coefficients.
export async function test_LSQ_biquad_differs_from_PK_with_same_params(assert) {
  const shared = { freq: 1000, gain: 6, q: 1.0 };
  const pk = await pushAndDecodeCoefficients({ ...shared, type: 'PK' });
  const lsq = await pushAndDecodeCoefficients({ ...shared, type: 'LSQ' });
  const differs = Math.abs(pk.b0 - lsq.b0) > 1e-6 || Math.abs(pk.b1 - lsq.b1) > 1e-6 || Math.abs(pk.a1 - lsq.a1) > 1e-6;
  assert.ok(differs, `LSQ and PK filters with identical freq/gain/Q should NOT produce identical coefficients — got PK=${JSON.stringify(pk)} LSQ=${JSON.stringify(lsq)}`);
}

export async function test_HSQ_biquad_differs_from_PK_with_same_params(assert) {
  const shared = { freq: 1000, gain: 6, q: 1.0 };
  const pk = await pushAndDecodeCoefficients({ ...shared, type: 'PK' });
  const hsq = await pushAndDecodeCoefficients({ ...shared, type: 'HSQ' });
  const differs = Math.abs(pk.b0 - hsq.b0) > 1e-6 || Math.abs(pk.b1 - hsq.b1) > 1e-6 || Math.abs(pk.a1 - hsq.a1) > 1e-6;
  assert.ok(differs, `HSQ and PK filters with identical freq/gain/Q should NOT produce identical coefficients — got PK=${JSON.stringify(pk)} HSQ=${JSON.stringify(hsq)}`);
}

export async function test_typeByte_encodesCorrectlyForAllThreeTypes(assert) {
  const cases = [{ type: 'PK', expected: 2 }, { type: 'LSQ', expected: 1 }, { type: 'HSQ', expected: 3 }];
  for (const c of cases) {
    const coeffs = await pushAndDecodeCoefficients({ freq: 1000, gain: 3, q: 1.0, type: c.type });
    assert.equal(coeffs.typeByte, c.expected, `type ${c.type} should encode as ${c.expected}, got ${coeffs.typeByte}`);
  }
}
