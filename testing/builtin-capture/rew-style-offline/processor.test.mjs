import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLogSweep } from '../../../devicePEQ/builtin-capture/sweep.mjs';
import { dbAt, processSweep } from './processor.mjs';

function delayedFir(signal, taps, delay = 0) {
  const output = new Float64Array(signal.length + delay + taps.length - 1);
  for (let i = 0; i < signal.length; i++) for (let j = 0; j < taps.length; j++) output[i + delay + j] += signal[i] * taps[j];
  return output;
}

test('offline processor cancels output level and recovers unity response', () => {
  const sampleRate = 24000;
  const sweep = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.5, sampleRate, levelDb: -12, window: false });
  const response = processSweep(sweep.samples, sweep.samples, sampleRate, { startHz: 30, endHz: 9000, durationSec: sweep.durationSec, postWindowSec: 0.5 });
  assert.ok(Math.abs(dbAt(response, 1000)) < 0.1, `unity response was ${dbAt(response, 1000)}dB`);
});

test('offline processor preserves gain and capture latency', () => {
  const sampleRate = 24000, delay = 37;
  const sweep = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.5, sampleRate, levelDb: -12, window: false });
  const captured = delayedFir(sweep.samples, [0.5], delay);
  const response = processSweep(captured, sweep.samples, sampleRate, { startHz: 30, endHz: 9000, durationSec: sweep.durationSec, postWindowSec: 0.5, searchAfterSec: 0.1 });
  assert.equal(response.peakIndex, sweep.samples.length - 1 + delay);
  assert.ok(Math.abs(dbAt(response, 1000) - 20 * Math.log10(0.5)) < 0.1);
});

test('offline processor recovers a frequency-shaped two-tap response', () => {
  const sampleRate = 24000;
  const sweep = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.5, sampleRate, window: false, levelDb: -12 });
  const response = processSweep(delayedFir(sweep.samples, [0.5, 0.25]), sweep.samples, sampleRate, { startHz: 30, endHz: 9000, durationSec: sweep.durationSec, postWindowSec: 0.5 });
  assert.ok(dbAt(response, 1000) > dbAt(response, 8000));
  assert.ok(dbAt(response, 8000) < -5);
});

test('offline processor rejects an unusable capture', () => {
  const sampleRate = 24000;
  const sweep = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.25, sampleRate });
  assert.throws(() => processSweep(new Float64Array(sweep.samples.length), sweep.samples, sampleRate, { startHz: 30, endHz: 9000 }), /no usable/);
});

test('offline processor reports noise without subtracting it into the response', () => {
  const sampleRate = 24000;
  const sweep = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.5, sampleRate, window: false, levelDb: -12 });
  const noise = Float64Array.from({ length: 1200 }, (_, i) => 0.001 * Math.sin(i * 1.73));
  const captured = Float64Array.from(sweep.samples, (sample, i) => sample + noise[i % noise.length]);
  const response = processSweep(captured, sweep.samples, sampleRate, { startHz: 30, endHz: 9000, noise });
  assert.ok(response.noiseFloorDbfs < -50);
  assert.equal(response.clippedSamples, 0);
  assert.ok(Number.isFinite(dbAt(response, 1000)));
});

test('offline processor aborts clipped captures and exposes the valid analysis band', () => {
  const sampleRate = 24000;
  const sweep = renderLogSweep({ startHz: 20, endHz: 10000, durationSec: 0.25, sampleRate, levelDb: -12 });
  const clipped = Float64Array.from(sweep.samples, (sample, i) => i === 100 ? 1 : sample);
  assert.throws(() => processSweep(clipped, sweep.samples, sampleRate, { startHz: 20, endHz: 10000 }), /clipped/);
  const response = processSweep(sweep.samples, sweep.samples, sampleRate, { startHz: 20, endHz: 10000 });
  assert.equal(response.validStartFreq, 30);
  assert.equal(response.validEndFreq, 9000);
});
