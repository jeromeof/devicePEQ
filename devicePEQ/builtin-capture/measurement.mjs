import { AudioSession } from './audio-session.mjs';
import { deconvolve } from './deconvolution.mjs';
import { toVerificationResponse } from './response.mjs';
import { renderLogSweep, withLeadIn } from './sweep.mjs';
import { validateCaptureOptions } from './backend-contract.mjs';

function rmsDbfs(samples) {
  if (!samples?.length) return null;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export class BuiltinCaptureBackend {
  constructor({ sessionFactory = (options) => new AudioSession(options), status = () => {} } = {}) {
    this.sessionFactory = sessionFactory;
    this.status = status;
    this.session = null;
    this.running = false;
  }

  async captureMeasurement(options = {}) {
    const config = validateCaptureOptions({
      durationSec: 6, leadInSec: 0.1, tailSec: 0.5, noiseFloorSec: 2, warmupMs: 300,
      outputChannels: 'both', floorDb: -300, ...options,
    });
    if (this.running) throw new Error('a built-in capture is already running');
    this.running = true;
    this.session = this.sessionFactory({ status: this.status });
    let clipping = null;
    this.session.onCapture = (stats) => {
      if (!clipping && stats.clippedSamples > 0) {
        clipping = stats;
        this.status(`clipping detected at ${(stats.peak * 100).toFixed(1)}% full scale — aborting measurement`);
        this.session.abortPlayback?.();
      }
    };
    try {
      this.status('opening selected input and output…');
      const opened = await this.session.open(config);
      const sampleRate = opened.inputSampleRate;
      if (opened.outputSampleRate !== sampleRate && !config.allowResampling) {
        throw new Error(`input/output sample-rate mismatch (${sampleRate}Hz vs ${opened.outputSampleRate}Hz); set both Chrome devices to the same rate before measuring`);
      }
      const rendered = renderLogSweep({ ...config, sampleRate });
      const leadInSamples = Math.round(config.leadInSec * sampleRate);
      const played = withLeadIn(rendered.samples, leadInSamples);
      await this.session.wait(config.warmupMs);
      await this.session.resetCaptured();
      await this.session.wait(config.noiseFloorSec * 1000);
      const noiseCapture = this.session.takeCaptured(Math.max(1, Math.round(config.noiseFloorSec * sampleRate)));
      const noiseSamplesLeft = noiseCapture.left;
      const noiseSamplesRight = noiseCapture.right;
      this.session.resetCaptured();
      this.status(`capturing ${config.startHz}–${config.endHz}Hz sweep…`);
      await this.session.play(rendered.samples, { outputChannels: config.outputChannels, leadInSamples });
      if (clipping) throw new Error(`measurement aborted: input clipping reached ${(clipping.peak * 100).toFixed(1)}% full scale (${clipping.clippedSamples} samples)`);
      await this.session.wait(config.tailSec * 1000);
      const expectedSamples = played.length + Math.round(config.tailSec * sampleRate);
      await this.session.waitForSamples?.(expectedSamples, 1000);
      const captured = this.session.takeCaptured(expectedSamples);
      const stats = this.session.getCaptureStats?.();
      if (stats?.clippedSamples > 0) throw new Error(`measurement aborted: input clipping reached ${(stats.peak * 100).toFixed(1)}% full scale (${stats.clippedSamples} samples)`);
      if (captured.left.length < played.length) {
        throw new Error(`capture ended early: received ${captured.left.length} samples, expected at least ${played.length}`);
      }
      const noiseFloorDbfs = rmsDbfs(captured.left.slice(0, Math.min(leadInSamples, captured.left.length)));
      const left = toVerificationResponse(deconvolve(captured.left, played, sampleRate, { noise: noiseSamplesLeft }), { floorDb: config.floorDb });
      const right = toVerificationResponse(deconvolve(captured.right, played, sampleRate, { noise: noiseSamplesRight }), { floorDb: config.floorDb });
      return {
        left, right,
        // The final part of a swept-sine deconvolution is not reliable: the
        // sweep is approaching its stop frequency while the inverse filter is
        // running out of useful energy. Keep a deliberately wider guard band
        // than the mathematical endpoint so the tail cannot dominate fits or
        // graphs (especially at the common 20kHz setting).
        metadata: { source: 'builtin', sampleRate, inputDeviceId: config.inputDeviceId || '', outputDeviceId: config.outputDeviceId || '', captureStats: stats || null, sampleCount: captured.left.length, expectedSampleCount: expectedSamples, noiseSampleCount: noiseSamplesLeft.length, noiseFloorDbfs, noiseSubtracted: true, noiseEstimate: 'averaged FFT power across independent segments per channel', validStartHz: config.startHz * 1.02, validEndHz: config.endHz * 0.90, sweep: { startHz: config.startHz, endHz: config.endHz, durationSec: rendered.durationSec } },
      };
    } finally {
      try { await this.session.close(); } finally { this.session = null; this.running = false; }
    }
  }

  async stop() { await this.session?.close(); }
}
