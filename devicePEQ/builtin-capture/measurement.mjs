import { AudioSession } from './audio-session.mjs';
import { deconvolve } from './deconvolution.mjs';
import { toVerificationResponse } from './response.mjs';
import { renderLogSweep, withLeadIn, sweepEndFor, validSweepBand, DEFAULT_FADE_FRACTION } from './sweep.mjs';
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
      durationSec: 6, leadInSec: 0.1, tailSec: 0.5, noiseFloorSec: 2, warmupMs: 300, outputLevelDb: -12,
      outputChannels: 'both', floorDb: -300, ...options,
    });
    if (this.running) throw new Error('a built-in capture is already running');
    this.running = true;
    this.session = this.sessionFactory({ status: this.status });
    // Clipping during the sweep is the hard safety mechanism and stays strict:
    // one full-scale sample aborts. What must NOT abort is a transient outside the
    // sweep signal. Two windows produce those and say nothing about sweep level:
    //   * warm-up and the noise-floor listen, e.g. a DSP being reprogrammed;
    //   * the sweep's silent lead-in, when the output stream starts and the sink
    //     switch pops — this one lands *inside* play(), which is why a boundary
    //     drawn at play() alone is not enough.
    // Both are recorded in the metadata instead of aborting, so they stay
    // diagnosable. `clippedSamples` is cumulative since the last reset, so the
    // count at the end of the guard is subtracted before judging the sweep.
    let phase = 'pre-sweep';
    let guardSamples = 0;
    let sweepClipping = null, startupClipping = null, clippedBeforeSweep = null;
    this.session.onCapture = (stats) => {
      if (phase !== 'sweep') {
        if (stats.clippedSamples > 0 && !startupClipping) {
          startupClipping = { ...stats, when: phase === 'pre-sweep' ? 'before playback' : 'after the sweep ended' };
        }
        return;
      }
      if (stats.samples <= guardSamples) {
        if (stats.clippedSamples > 0 && !startupClipping) startupClipping = { ...stats, when: 'during the silent lead-in' };
        return;
      }
      if (clippedBeforeSweep === null) clippedBeforeSweep = stats.clippedSamples;
      const sweepClipped = stats.clippedSamples - clippedBeforeSweep;
      if (sweepClipped > 0 && !sweepClipping) {
        sweepClipping = { ...stats, clippedSamples: sweepClipped };
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
      // Sweep past the requested end so the whole requested band is valid; the
      // metadata reports the band the result can be trusted over.
      const sweepEndHz = sweepEndFor(config.endHz, sampleRate);
      const fadeFraction = config.fadeFraction ?? DEFAULT_FADE_FRACTION;
      const rendered = renderLogSweep({ ...config, endHz: sweepEndHz, fadeFraction, sampleRate, levelDb: config.outputLevelDb });
      const validBand = validSweepBand({ startHz: config.startHz, endHz: config.endHz, sweepEndHz, fadeFraction });
      const leadInSamples = Math.round(config.leadInSec * sampleRate);
      const played = withLeadIn(rendered.samples, leadInSamples);
      await this.session.wait(config.warmupMs);
      await this.session.resetCaptured();
      await this.session.wait(config.noiseFloorSec * 1000);
      const noiseCapture = this.session.takeCaptured(Math.max(1, Math.round(config.noiseFloorSec * sampleRate)));
      const noiseSamplesLeft = noiseCapture.left;
      const noiseSamplesRight = noiseCapture.right;
      const noiseFloorDbfsByChannel = {
        left: rmsDbfs(noiseSamplesLeft),
        right: rmsDbfs(noiseSamplesRight),
      };
      this.session.resetCaptured();
      // Sample counts restart at the reset above, so the guard is simply the
      // silent lead-in plus a margin for the output stream actually starting.
      guardSamples = leadInSamples + Math.round(0.05 * sampleRate);
      phase = 'sweep';
      this.status(`capturing ${config.startHz}–${config.endHz}Hz sweep…`);
      await this.session.play(rendered.samples, { outputChannels: config.outputChannels, leadInSamples });
      // Playback is over: freeze the count now, so a pop as the output stream
      // stops during the tail wait cannot be blamed on the sweep.
      const clippedAtEnd = this.session.getCaptureStats?.()?.clippedSamples ?? 0;
      phase = 'after-sweep';
      if (sweepClipping) throw new Error(`measurement aborted: input clipping during the sweep reached ${(sweepClipping.peak * 100).toFixed(1)}% full scale (${sweepClipping.clippedSamples} samples)`);
      await this.session.wait(config.tailSec * 1000);
      const expectedSamples = played.length + Math.round(config.tailSec * sampleRate);
      await this.session.waitForSamples?.(expectedSamples, 1000);
      const captured = this.session.takeCaptured(expectedSamples);
      const stats = this.session.getCaptureStats?.();
      const sweepClipped = Math.max(0, clippedAtEnd - (clippedBeforeSweep ?? 0));
      if (sweepClipped > 0) throw new Error(`measurement aborted: input clipping during the sweep reached ${(stats.peak * 100).toFixed(1)}% full scale (${sweepClipped} samples)`);
      if (startupClipping) {
        const ms = (startupClipping.clippedSamples / sampleRate) * 1000;
        this.status(`ignored a ${ms.toFixed(1)}ms full-scale transient ${startupClipping.when} (likely an output/DSP pop) — the sweep itself was clean`);
      }
      if (captured.left.length < played.length) {
        throw new Error(`capture ended early: received ${captured.left.length} samples, expected at least ${played.length}`);
      }
      const sweepLeadIn = {
        left: captured.left.slice(0, Math.min(leadInSamples, captured.left.length)),
        right: captured.right.slice(0, Math.min(leadInSamples, captured.right.length)),
      };
      const noiseFloorDbfsBySweepChannel = {
        left: rmsDbfs(sweepLeadIn.left),
        right: rmsDbfs(sweepLeadIn.right),
      };
      const selectedChannel = config.inputChannel === 'right' ? 'right' : 'left';
      const noiseFloorDbfs = noiseFloorDbfsBySweepChannel[selectedChannel];
      // `subtractNoise: false` keeps the noise listen (its level is still reported)
      // but leaves the response untouched — a steady room tone can otherwise be
      // over-subtracted into a narrow notch, which REW-style processing never shows.
      const subtractNoise = config.subtractNoise !== false;
      const left = toVerificationResponse(deconvolve(captured.left, played, sampleRate, { noise: noiseSamplesLeft, subtractNoise }), { floorDb: config.floorDb });
      const right = toVerificationResponse(deconvolve(captured.right, played, sampleRate, { noise: noiseSamplesRight, subtractNoise }), { floorDb: config.floorDb });
      return {
        left, right,
        // validStartHz/validEndHz bound what the result can be trusted over. The
        // sweep itself runs past the requested end (sweepEndFor), so that band
        // reaches the requested end frequency instead of stopping 10% short.
        metadata: { source: 'builtin', sampleRate, outputLevelDb: config.outputLevelDb, inputDeviceId: config.inputDeviceId || '', outputDeviceId: config.outputDeviceId || '', inputChannel: selectedChannel, captureStats: stats || null, preSweepTransient: startupClipping ? { peak: startupClipping.peak, clippedSamples: startupClipping.clippedSamples, approxMs: (startupClipping.clippedSamples / sampleRate) * 1000, when: startupClipping.when } : null, sampleCount: captured.left.length, expectedSampleCount: expectedSamples, noiseSampleCount: noiseSamplesLeft.length, noiseFloorDbfs, noiseFloorDbfsByChannel, noiseFloorDbfsBySweepChannel, noiseSubtracted: subtractNoise, noiseEstimate: 'averaged FFT power across independent segments per channel', ...validBand, sweep: { startHz: config.startHz, endHz: sweepEndHz, requestedEndHz: config.endHz, fadeFraction, durationSec: rendered.durationSec } },
      };
    } finally {
      try { await this.session.close(); } finally { this.session = null; this.running = false; }
    }
  }

  async stop() { await this.session?.close(); }
}
