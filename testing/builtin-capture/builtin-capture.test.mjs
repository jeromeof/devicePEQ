import test from 'node:test';
import assert from 'node:assert/strict';
import {
  averageResponses, deconvolve, fft, magnitudeAt, nextPowerOfTwo, smoothResponse,
  renderLogSweep, toVerificationResponse, validateCaptureOptions,
  classifyDevices, enumerateAudioDevices, findDevice, suggestAudioRouting,
  BuiltinCaptureBackend,
} from '../../devicePEQ/builtin-capture/index.mjs';

test('nextPowerOfTwo returns the smallest covering power of two', () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(17), 32);
  assert.throws(() => nextPowerOfTwo(0), /positive/);
});

test('renderLogSweep starts at zero, has the requested duration, and respects the Nyquist limit', () => {
  const sweep = renderLogSweep({ startHz: 20, endHz: 18000, durationSec: 0.1, sampleRate: 48000 });
  assert.equal(sweep.samples.length, 4800);
  assert.equal(sweep.samples[0], 0);
  assert.ok(Math.max(...sweep.samples) <= 1 && Math.min(...sweep.samples) >= -1);
  assert.throws(() => renderLogSweep({ startHz: 20, endHz: 24000, durationSec: 1, sampleRate: 48000 }), /Nyquist/);
});

test('FFT round-trips a short real signal', () => {
  const real = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.7) + i / 20);
  const original = real.slice();
  const imag = new Float64Array(real.length);
  fft(real, imag); fft(real, imag, true);
  for (let i = 0; i < real.length; i++) assert.ok(Math.abs(real[i] - original[i]) < 1e-10);
  assert.ok(imag.every((v) => Math.abs(v) < 1e-10));
});

test('deconvolution recovers a known sample delay with flat magnitude', () => {
  const sampleRate = 48000;
  const source = new Float64Array(1024);
  source[11] = 1;
  const delay = 37;
  const captured = new Float64Array(source.length);
  captured.set(source.subarray(0, source.length - delay), delay);
  const result = deconvolve(captured, source, sampleRate, { fftSize: 1024 });
  const response = toVerificationResponse(result, { startBin: 1 });
  assert.ok(Math.abs(magnitudeAt(response, 1000)) < 0.01, `expected 0dB, got ${magnitudeAt(response, 1000)}`);
});

test('deconvolution cancels output level without double-counting it', () => {
  const sampleRate = 24000;
  const rendered = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.25, sampleRate, levelDb: -12 });
  const unity = toVerificationResponse(deconvolve(rendered.samples, rendered.samples, sampleRate));
  const half = toVerificationResponse(deconvolve(Float64Array.from(rendered.samples, (v) => v * 0.5), rendered.samples, sampleRate));
  assert.ok(Math.abs(magnitudeAt(unity, 1000)) < 0.02);
  assert.ok(Math.abs(magnitudeAt(half, 1000) - 20 * Math.log10(0.5)) < 0.02);
});

test('deconvolution subtracts an independently measured noise spectrum in power', () => {
  const sampleRate = 24000;
  const rendered = renderLogSweep({ startHz: 30, endHz: 9000, durationSec: 0.25, sampleRate });
  const played = rendered.samples;
  const noise = Float64Array.from({ length: 1200 }, (_, i) => 0.002 * Math.sin(i * 1.73));
  const captured = new Float64Array(played.length);
  for (let i = 0; i < captured.length; i++) captured[i] = played[i] * 0.5 + noise[i % noise.length];
  const raw = toVerificationResponse(deconvolve(captured, played, sampleRate, { subtractNoise: false }));
  const correctedResult = deconvolve(captured, played, sampleRate, { noise });
  const corrected = toVerificationResponse(correctedResult);
  const expected = 20 * Math.log10(0.5);
  assert.ok(Math.abs(magnitudeAt(corrected, 1000) - expected) <= Math.abs(magnitudeAt(raw, 1000) - expected));
  assert.equal(correctedResult.noiseSubtracted, true);
});

test('responses average only when their grids match', () => {
  const a = { startFreq: 0, freqStep: 10, magnitude: Float32Array.from([1, 2, 3]) };
  const b = { ...a, magnitude: Float32Array.from([3, 4, 5]) };
  assert.deepEqual(Array.from(averageResponses([a, b]).magnitude), [2, 3, 4]);
  assert.throws(() => averageResponses([{ ...a, freqStep: 11 }, b]), /identical/);
});

test('response smoothing reduces narrow measurement noise without changing the response grid', () => {
  const magnitude = new Float32Array(401);
  for (let i = 0; i < magnitude.length; i++) {
    const freq = i * 10;
    magnitude[i] = (freq >= 900 && freq <= 1100 ? 6 : 0) + (i % 2 ? 1 : -1);
  }
  const response = { startFreq: 0, freqStep: 10, magnitude, sampleRate: 48000, fftSize: 1024 };
  const smoothed = smoothResponse(response, { fractionalOctave: 1 / 12, passes: 2 });
  assert.equal(smoothed.startFreq, response.startFreq);
  assert.equal(smoothed.freqStep, response.freqStep);
  assert.equal(smoothed.magnitude.length, response.magnitude.length);
  assert.ok(Math.abs(smoothed.magnitude[100] - 6) < 0.25);
  assert.ok(Math.abs(smoothed.magnitude[50]) < 0.25);
});

test('capture options reject unsafe or unusable sweep settings', () => {
  const defaults = validateCaptureOptions({ startHz: 20, endHz: 20000, durationSec: 6, leadInSec: 0.1, tailSec: 0.5 });
  assert.equal(defaults.noiseFloorSec, 2);
  assert.deepEqual(validateCaptureOptions({ startHz: 20, endHz: 20000, durationSec: 1, leadInSec: 0.1, tailSec: 0.5 }).endHz, 20000);
  assert.throws(() => validateCaptureOptions({ startHz: 20, endHz: 20000, durationSec: 0.1, leadInSec: 0, tailSec: 0 }), /0.25/);
});

test('device discovery separates inputs and outputs and preserves stable ids', () => {
  const devices = classifyDevices([
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Measurement mic', groupId: 'g1' },
    { kind: 'audiooutput', deviceId: 'dac-1', label: 'Measurement DAC', groupId: 'g1' },
    { kind: 'videoinput', deviceId: 'camera-1' },
  ]);
  assert.equal(devices.inputs.length, 1);
  assert.equal(devices.outputs.length, 1);
  assert.equal(findDevice(devices, 'dac-1', 'output').label, 'Measurement DAC');
  assert.equal(findDevice(devices, 'missing', 'input'), null);
});

test('device discovery still lists devices when permission was denied', async () => {
  const fake = {
    async getUserMedia() { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
    async enumerateDevices() { return [{ kind: 'audioinput', deviceId: 'default', label: '' }]; },
  };
  const result = await enumerateAudioDevices(fake);
  assert.equal(result.permissionError.name, 'NotAllowedError');
  assert.equal(result.inputs[0].id, 'default');
  assert.equal(result.inputs[0].label, 'default');
});

test('routing suggestion prefers an external ADC input and the DUT output', () => {
  const devices = classifyDevices([
    { kind: 'audioinput', deviceId: 'dut-in', label: 'Qudelix 5K' },
    { kind: 'audioinput', deviceId: 'mac-in', label: 'MacBook Pro Microphone' },
    { kind: 'audioinput', deviceId: 'cosmos', label: 'Cosmos ADC Record Interface' },
    { kind: 'audioinput', deviceId: 'usbc', label: 'USB-C Apple Interface' },
    { kind: 'audiooutput', deviceId: 'dut-out', label: 'Qudelix 5K' },
    { kind: 'audiooutput', deviceId: 'mac-out', label: 'MacBook Pro Speakers' },
  ]);
  const suggestion = suggestAudioRouting({ devices, dutNames: ['Qudelix 5K'] });
  assert.equal(suggestion.inputId, 'cosmos');
  assert.equal(suggestion.outputId, 'dut-out');
  assert.equal(suggestion.confidence, 'high');
  assert.match(suggestion.input.reasons.join(' '), /external measurement input/);
  assert.match(suggestion.output.reasons.join(' '), /device under test/);
});

test('routing suggestion does not select a DUT-labelled input when no external ADC is present', () => {
  const devices = classifyDevices([
    { kind: 'audioinput', deviceId: 'dut-in', label: 'USB DAC Qudelix 5K Input' },
    { kind: 'audioinput', deviceId: 'mac-in', label: 'MacBook Pro Microphone' },
  ]);
  const suggestion = suggestAudioRouting({ devices, dutNames: ['Qudelix 5K'] });
  assert.notEqual(suggestion.inputId, 'dut-in');
  assert.equal(suggestion.inputId, 'mac-in');
  assert.equal(suggestion.confidence, 'low');
});

test('built-in backend returns REW-compatible stereo responses and always closes its session', async () => {
  let fakeSession;
  const backend = new BuiltinCaptureBackend({
    sessionFactory: () => {
      fakeSession = {
        captured: null,
        async open() { return { inputSampleRate: 24000, outputSampleRate: 24000 }; },
        async wait() {},
        resetCaptured() { this.captured = null; },
        async play(signal, { leadInSamples }) {
          const played = new Float64Array(leadInSamples + signal.length);
          played.set(signal, leadInSamples);
          this.captured = { left: played, right: Float64Array.from(played, (v) => v * 0.5) };
        },
        takeCaptured() { return this.captured || { left: new Float64Array(6000), right: new Float64Array(6000) }; },
        async close() { this.closed = true; },
      };
      return fakeSession;
    },
  });
  const result = await backend.captureMeasurement({ startHz: 30, endHz: 9000, durationSec: 0.25, leadInSec: 0.02, tailSec: 0 });
  assert.equal(result.metadata.source, 'builtin');
  assert.ok(result.left.startFreq >= 0);
  assert.ok(Math.abs(magnitudeAt(result.left, 1000)) < 0.05);
  assert.ok(Math.abs(magnitudeAt(result.right, 1000) - 20 * Math.log10(0.5)) < 0.05);
  assert.equal(result.metadata.validStartHz, 30 * 1.02);
  assert.equal(result.metadata.validEndHz, 9000 * 0.90);
  assert.equal(fakeSession.closed, true);
  assert.equal(backend.running, false);
});

test('built-in backend rejects input/output clock mismatches by default', async () => {
  let closed = false;
  const backend = new BuiltinCaptureBackend({
    sessionFactory: () => ({
      async open() { return { inputSampleRate: 48000, outputSampleRate: 44100 }; },
      async close() { closed = true; },
    }),
  });
  await assert.rejects(
    backend.captureMeasurement({ startHz: 20, endHz: 18000, durationSec: 0.25, leadInSec: 0, tailSec: 0 }),
    /sample-rate mismatch/,
  );
  assert.equal(closed, true);
  assert.equal(backend.running, false);
});

test('built-in backend aborts when the capture reports clipping', async () => {
  let aborted = false, closed = false;
  const backend = new BuiltinCaptureBackend({
    sessionFactory: () => ({
      onCapture: null,
      async open() { return { inputSampleRate: 24000, outputSampleRate: 24000 }; },
      async wait() {},
      resetCaptured() {},
      async play() { this.onCapture?.({ peak: 1.02, clippedSamples: 4, samples: 100 }); },
      abortPlayback() { aborted = true; },
      getCaptureStats() { return { peak: 1.02, clippedSamples: 4, samples: 100 }; },
      takeCaptured() { return { left: new Float64Array(1), right: new Float64Array(1) }; },
      async close() { closed = true; },
    }),
  });
  await assert.rejects(
    backend.captureMeasurement({ startHz: 20, endHz: 10000, durationSec: 0.25, leadInSec: 0, tailSec: 0 }),
    /clipping reached/,
  );
  assert.equal(aborted, true);
  assert.equal(closed, true);
  assert.equal(backend.running, false);
});
