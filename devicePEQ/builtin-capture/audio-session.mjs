import { withLeadIn } from './sweep.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function concatFloat32(chunks) {
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const result = new Float64Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/**
 * Owns one input stream/context and one output context for a single sweep.
 * The class deliberately accepts browser constructors as dependencies, making
 * state/lifecycle behavior testable without opening real audio hardware.
 */
export class AudioSession {
  constructor({ mediaDevices = navigator.mediaDevices, AudioContextClass = globalThis.AudioContext, workletUrl, status = () => {}, onCapture = null, clipThreshold = 0.999 } = {}) {
    this.mediaDevices = mediaDevices;
    this.AudioContextClass = AudioContextClass;
    this.workletUrl = workletUrl || new URL('./worklets/capture-processor.js', import.meta.url);
    this.status = status;
    this.onCapture = onCapture;
    this.clipThreshold = clipThreshold;
    this.inputStream = null;
    this.inputContext = null;
    this.outputContext = null;
    this.captureNode = null;
    this.sourceNode = null;
    this.sinkId = '';
    this.chunks = { left: [], right: [] };
    this.captureStats = { peak: 0, clippedSamples: 0, samples: 0 };
    this.activeSource = null;
  }

  async open({ inputDeviceId = '', outputDeviceId = '', sampleRate } = {}) {
    if (!this.AudioContextClass) throw new Error('AudioContext is unavailable');
    if (!this.mediaDevices?.getUserMedia) throw new Error('getUserMedia is unavailable');
    const audio = {
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (inputDeviceId) audio.deviceId = { exact: inputDeviceId };
    if (sampleRate) audio.sampleRate = { exact: sampleRate };
    this.inputStream = await this.mediaDevices.getUserMedia({ audio });
    const track = this.inputStream.getAudioTracks()[0];
    const actualRate = track?.getSettings?.().sampleRate || sampleRate || 48000;
    this.inputContext = new this.AudioContextClass({ sampleRate: actualRate });
    await this.inputContext.audioWorklet.addModule(this.workletUrl);
    this.captureNode = new AudioWorkletNode(this.inputContext, 'devicepeq-builtin-capture');
    this.captureNode.port.onmessage = ({ data }) => {
      if (data?.left && data?.right) {
        this.chunks.left.push(data.left);
        this.chunks.right.push(data.right);
        for (let i = 0; i < data.left.length; i++) {
          const peak = Math.max(Math.abs(data.left[i]), Math.abs(data.right[i]));
          if (peak > this.captureStats.peak) this.captureStats.peak = peak;
          if (peak >= this.clipThreshold) this.captureStats.clippedSamples++;
          this.captureStats.samples++;
        }
        this.onCapture?.({ ...this.captureStats });
      }
    };
    this.sourceNode = this.inputContext.createMediaStreamSource(this.inputStream);
    const silent = this.inputContext.createGain();
    silent.gain.value = 0;
    this.sourceNode.connect(this.captureNode).connect(silent).connect(this.inputContext.destination);
    if (this.inputContext.state === 'suspended') await this.inputContext.resume();

    this.outputContext = new this.AudioContextClass({ sampleRate: actualRate });
    if (outputDeviceId && typeof this.outputContext.setSinkId === 'function') {
      await this.outputContext.setSinkId(outputDeviceId);
      this.sinkId = outputDeviceId;
    } else if (outputDeviceId) {
      this.status('selected output cannot be routed by this browser');
    }
    if (this.outputContext.state === 'suspended') await this.outputContext.resume();
    return { inputSampleRate: this.inputContext.sampleRate, outputSampleRate: this.outputContext.sampleRate, sinkId: this.sinkId };
  }

  async play(signal, { outputChannels = 'both', leadInSamples = 0 } = {}) {
    if (!this.outputContext) throw new Error('audio session is not open');
    const signalWithLeadIn = withLeadIn(signal, leadInSamples);
    const buffer = this.outputContext.createBuffer(2, signalWithLeadIn.length, this.outputContext.sampleRate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < signalWithLeadIn.length; i++) {
      const value = signalWithLeadIn[i];
      left[i] = outputChannels === 'right' ? 0 : value;
      right[i] = outputChannels === 'left' ? 0 : value;
    }
    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    this.activeSource = source;
    source.connect(this.outputContext.destination);
    source.start();
    try {
      await new Promise((resolve, reject) => { source.onended = resolve; source.onerror = reject; });
    } finally {
      if (this.activeSource === source) this.activeSource = null;
    }
  }

  async wait(ms) { await wait(ms); }

  takeCaptured(maxSamples = Infinity) {
    const left = concatFloat32(this.chunks.left);
    const right = concatFloat32(this.chunks.right);
    if (!Number.isFinite(maxSamples)) return { left, right };
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new RangeError('maxSamples must be a positive integer');
    return { left: left.slice(0, maxSamples), right: right.slice(0, maxSamples) };
  }

  resetCaptured() {
    this.chunks = { left: [], right: [] };
    this.captureStats = { peak: 0, clippedSamples: 0, samples: 0 };
  }

  getCaptureStats() { return { ...this.captureStats }; }

  capturedLength() {
    return this.chunks.left.reduce((total, chunk) => total + chunk.length, 0);
  }

  async waitForSamples(target, timeoutMs = 1000) {
    const deadline = performance.now() + timeoutMs;
    while (this.capturedLength() < target && performance.now() < deadline) await wait(10);
    return this.capturedLength();
  }

  abortPlayback() {
    try { this.activeSource?.stop(); } catch (_) {}
  }

  async close() {
    for (const node of [this.sourceNode, this.captureNode]) { try { node?.disconnect(); } catch (_) {} }
    this.sourceNode = this.captureNode = null;
    this.abortPlayback();
    this.activeSource = null;
    try { this.inputStream?.getTracks?.().forEach((track) => track.stop()); } catch (_) {}
    this.inputStream = null;
    for (const context of [this.inputContext, this.outputContext]) {
      try { await context?.close(); } catch (_) {}
    }
    this.inputContext = this.outputContext = null;
  }
}
