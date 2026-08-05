// Contract shared by the future browser adapter and the existing REW backend.

export const CAPTURE_BACKENDS = Object.freeze({ REW: 'rew', BUILTIN: 'builtin' });

export function assertMeasurementResponse(response) {
  if (!response || !Number.isFinite(response.startFreq) || !Number.isFinite(response.freqStep) || response.freqStep <= 0) {
    throw new TypeError('measurement must contain a positive frequency grid');
  }
  if (!(response.magnitude instanceof Float32Array) && !(response.magnitude instanceof Float64Array)) {
    throw new TypeError('measurement magnitude must be a typed array');
  }
  if (response.magnitude.length < 2) throw new RangeError('measurement must contain at least two points');
  return response;
}

export function validateCaptureOptions(options) {
  const o = { noiseFloorSec: 2, outputLevelDb: -12, ...options };
  if (!Number.isFinite(o.startHz) || o.startHz <= 0) throw new RangeError('startHz must be positive');
  if (!Number.isFinite(o.endHz) || o.endHz <= o.startHz) throw new RangeError('endHz must exceed startHz');
  if (!Number.isFinite(o.durationSec) || o.durationSec < 0.25) throw new RangeError('durationSec must be at least 0.25 seconds');
  if (!Number.isFinite(o.leadInSec) || o.leadInSec < 0) throw new RangeError('leadInSec must be non-negative');
  if (!Number.isFinite(o.tailSec) || o.tailSec < 0) throw new RangeError('tailSec must be non-negative');
  if (!Number.isFinite(o.noiseFloorSec) || o.noiseFloorSec < 0) throw new RangeError('noiseFloorSec must be non-negative');
  if (!Number.isFinite(o.outputLevelDb) || o.outputLevelDb > 0 || o.outputLevelDb < -60) throw new RangeError('outputLevelDb must be between -60 and 0 dBFS');
  return o;
}
