// AudioWorklet input collector. It posts bounded stereo blocks to the main
// thread; the main thread owns the measurement buffers and lifecycle.
class BuiltinCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options?.processorOptions?.blockSize || 2048;
    this.blockSize = Math.max(128, requested);
    this.left = new Float32Array(this.blockSize);
    this.right = new Float32Array(this.blockSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input?.[0]) return true;
    const left = input[0];
    const right = input[1] || left;
    for (let i = 0; i < left.length; i++) {
      this.left[this.offset] = left[i];
      this.right[this.offset] = right[i] ?? left[i];
      this.offset++;
      if (this.offset === this.blockSize) {
        this.port.postMessage({ left: this.left, right: this.right }, [this.left.buffer, this.right.buffer]);
        this.left = new Float32Array(this.blockSize);
        this.right = new Float32Array(this.blockSize);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('devicepeq-builtin-capture', BuiltinCaptureProcessor);

