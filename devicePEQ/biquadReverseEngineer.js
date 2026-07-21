// Extract filter parameters (freq, Q, gain) from quantized biquad coefficients
// Reverse-engineers the computeIIRFilter function

export function extractFilterFromBiquadBytes(biquadBytes, sampleRate = 96000) {
  if (biquadBytes.length < 20) {
    throw new Error("Biquad data must be at least 20 bytes");
  }

  // Read 5 coefficients as little-endian 32-bit signed integers
  const coeff = [];
  for (let i = 0; i < 5; i++) {
    const offset = i * 4;
    let value =
      biquadBytes[offset] |
      (biquadBytes[offset + 1] << 8) |
      (biquadBytes[offset + 2] << 16) |
      (biquadBytes[offset + 3] << 24);

    // Convert to signed 32-bit
    if (value > 0x7FFFFFFF) {
      value = value - 0x100000000;
    }

    coeff.push(value);
  }

  // Dequantize: divide by 2^30 (the quantizer multiplied by this)
  const QUANTIZER_SCALE = 1073741824; // 2^30
  const b0 = coeff[0] / QUANTIZER_SCALE;
  const b1 = coeff[1] / QUANTIZER_SCALE;
  const b2 = coeff[2] / QUANTIZER_SCALE;
  const a1_negated = coeff[3] / QUANTIZER_SCALE;
  const a2_negated = coeff[4] / QUANTIZER_SCALE;

  const a1 = -a1_negated;
  const a2 = -a2_negated;

  // Check for disabled filter (all zeros)
  if (Math.abs(b0) < 1e-10 && Math.abs(b1) < 1e-10 && Math.abs(b2) < 1e-10 &&
      Math.abs(a1) < 1e-10 && Math.abs(a2) < 1e-10) {
    return {
      freq: 0,
      q: 0,
      gain: 0,
      disabled: true,
      coefficients: { b0, b1, b2, a1, a2 }
    };
  }

  // --- Extract Frequency from a1/b1 ---
  // For a peak filter: a1 = b1 = -2*cos(w0)
  // So: cos(w0) = -a1/2
  const cosW0 = -a1 / 2;
  // Clamp to [-1, 1] to avoid NaN from acos
  const cosW0Clamped = Math.max(-1, Math.min(1, cosW0));
  const w0 = Math.acos(cosW0Clamped);
  const freq = Math.round((w0 * sampleRate) / (2 * Math.PI));

  // --- Extract Gain and Q from normalized coefficients ---
  // The coefficients were normalized by: d6 = α/A + 1
  // Where α = sin(w0)/(2Q) and A = 10^(gain/40)

  // From the biquad equations:
  // a2_normalized = (1 - α/A) / (α/A + 1)
  // b0_normalized = (α*A + 1) / (α/A + 1)

  // Solving for A:
  // A^2 = (2*b0 - a2 - 1) / (1 - a2)

  const numerator = 2 * b0 - a2 - 1;
  const denominator = 1 - a2;

  let A = 1; // default for gain = 0
  let gain = 0;

  if (Math.abs(denominator) > 1e-10) {
    const A_squared = numerator / denominator;
    if (A_squared > 0) {
      A = Math.sqrt(A_squared);
      gain = Math.round(40 * Math.log10(A) * 100) / 100;
    }
  }

  // --- Extract Q ---
  // α = sin(w0) / (2*Q)
  // Q = sin(w0) / (2*α)
  // Also: α/A = (1 - a2) / (a2 + 1)

  const sinW0 = Math.sin(w0);
  const alpha_over_A = (1 - a2) / (a2 + 1);
  const alpha = alpha_over_A * A;

  let q = 0;
  if (Math.abs(alpha) > 1e-10) {
    q = Math.round((sinW0 / (2 * alpha)) * 100) / 100;
  }

  return {
    freq,
    q,
    gain,
    disabled: false,
    coefficients: { b0, b1, b2, a1, a2 },
    debug: {
      w0: w0.toFixed(6),
      sinW0: sinW0.toFixed(6),
      cosW0: cosW0.toFixed(6),
      alpha: alpha.toFixed(6),
      A: A.toFixed(6)
    }
  };
}

// Helper: extract all filters from a response packet
export function extractAllFiltersFromResponse(responseBytes, sampleRate = 96000) {
  // Response structure:
  // [0-5]: header
  // [6]: padding
  // [7-26]: biquad for filter (20 bytes)
  // [27-28]: frequency (but might be 0xFF for unset)
  // [29-30]: Q
  // [31-32]: gain
  // [33]: type

  const filters = [];

  // For now, extract the first filter (at index 0)
  // Full response usually contains one filter per packet
  const biquadBytes = responseBytes.slice(7, 27); // 20 bytes at correct offset

  const result = extractFilterFromBiquadBytes(biquadBytes, sampleRate);

  // Check if the metadata bytes confirm it's unset
  const freq_byte1 = responseBytes[26];
  const freq_byte2 = responseBytes[27];

  if (freq_byte1 === 0xFF && freq_byte2 === 0xFF) {
    result.metadata_confirms_unset = true;
  } else {
    // Try to read the stored frequency from the metadata (for comparison)
    const storedFreq = freq_byte1 | (freq_byte2 << 8);
    result.metadata_freq = storedFreq;
  }

  return result;
}
