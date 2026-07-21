import { extractFilterFromBiquadBytes } from '../devicePEQ/biquadReverseEngineer.js';

// Simulate the biquad computation (from walkplayHidHandler.js)
function computeIIRFilter(freq, gain, q, sampleRate = 96000) {
  let bArr = new Array(20).fill(0);
  let sqrt = Math.sqrt(Math.pow(10, gain / 20));
  let d3 = (freq * 6.283185307179586) / sampleRate;
  let sin = Math.sin(d3) / (2 * q);
  let d4 = sin * sqrt;
  let d5 = sin / sqrt;
  let d6 = d5 + 1;
  let quantizerData = quantizer(
    [1, (Math.cos(d3) * -2) / d6, (1 - d5) / d6],
    [(d4 + 1) / d6, (Math.cos(d3) * -2) / d6, (1 - d4) / d6]
  );

  let index = 0;
  for (let value of quantizerData) {
    bArr[index] = value & 0xFF;
    bArr[index + 1] = (value >> 8) & 0xFF;
    bArr[index + 2] = (value >> 16) & 0xFF;
    bArr[index + 3] = (value >> 24) & 0xFF;
    index += 4;
  }

  return bArr;
}

function quantizer(dArr, dArr2) {
  let iArr = dArr.map(d => Math.round(d * 1073741824));
  let iArr2 = dArr2.map(d => Math.round(d * 1073741824));
  return [iArr2[0], iArr2[1], iArr2[2], -iArr[1], -iArr[2]];
}

// Test cases
const testCases = [
  { freq: 1000, gain: 2, q: 1.0, name: "Peak 1kHz +2dB Q=1" },
  { freq: 5000, gain: 4, q: 0.7, name: "Peak 5kHz +4dB Q=0.7" },
  { freq: 100, gain: -2, q: 2.0, name: "Peak 100Hz -2dB Q=2" },
  { freq: 10000, gain: 0.5, q: 1.5, name: "Peak 10kHz +0.5dB Q=1.5" },
  { freq: 0, gain: 0, q: 0, name: "Disabled filter" }
];

console.log('🧪 BIQUAD REVERSE ENGINEER TEST\n');
console.log('═'.repeat(80));

for (const testCase of testCases) {
  console.log(`\n📝 Test: ${testCase.name}`);
  console.log(`   Input: freq=${testCase.freq}, gain=${testCase.gain}, q=${testCase.q}`);

  // Compute biquad coefficients
  const biquadBytes = computeIIRFilter(testCase.freq, testCase.gain, testCase.q);

  // Extract parameters back
  const extracted = extractFilterFromBiquadBytes(biquadBytes);

  // Check accuracy
  const freqMatch = Math.abs(extracted.freq - testCase.freq) <= 1; // Allow 1 Hz tolerance
  const gainMatch = Math.abs(extracted.gain - testCase.gain) <= 0.1; // Allow 0.1 dB tolerance
  const qMatch = Math.abs(extracted.q - testCase.q) <= 0.05; // Allow 0.05 tolerance

  const allMatch = freqMatch && gainMatch && qMatch;
  const status = allMatch ? '✅' : '❌';

  console.log(`   ${status} Extracted: freq=${extracted.freq}, gain=${extracted.gain}, q=${extracted.q}`);

  if (!allMatch) {
    console.log(`   ⚠️  Errors: ${!freqMatch ? `freq off by ${Math.abs(extracted.freq - testCase.freq)}Hz` : ''} ${!gainMatch ? `gain off by ${Math.abs(extracted.gain - testCase.gain)}dB` : ''} ${!qMatch ? `q off by ${Math.abs(extracted.q - testCase.q)}` : ''}`);
    if (extracted.debug) {
      console.log(`   Debug: w0=${extracted.debug.w0}, A=${extracted.debug.A}, alpha=${extracted.debug.alpha}`);
    }
  }
}

console.log('\n' + '═'.repeat(80));
console.log('✅ Test complete!\n');
