// Small iterative radix-2 FFT used by the built-in capture numerical core.
// Forward transform uses exp(-j*w); inverse divides by N.

export function fft(real, imag, inverse = false) {
  if (!(real instanceof Float64Array) || !(imag instanceof Float64Array) || real.length !== imag.length) {
    throw new TypeError('real and imag must be equal-length Float64Arrays');
  }
  const n = real.length;
  if (n < 1 || (n & (n - 1)) !== 0) throw new RangeError('FFT length must be a power of two');

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const sign = inverse ? 1 : -1;
    const step = sign * 2 * Math.PI / len;
    const half = len >> 1;
    for (let base = 0; base < n; base += len) {
      for (let j = 0; j < half; j++) {
        const angle = step * j;
        const wr = Math.cos(angle), wi = Math.sin(angle);
        const k = base + j, p = k + half;
        const tr = wr * real[p] - wi * imag[p];
        const ti = wr * imag[p] + wi * real[p];
        const ur = real[k], ui = imag[k];
        real[k] = ur + tr; imag[k] = ui + ti;
        real[p] = ur - tr; imag[p] = ui - ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
  return { real, imag };
}

