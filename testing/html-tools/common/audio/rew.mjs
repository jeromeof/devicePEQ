// REW interchange. REW imports one measurement per file (File > Import > Import
// frequency response), so a multi-measurement export is a set of files — see
// zip.mjs for packing them into one download.

/** One REW-importable frequency response text file. */
export function exportRewMeasurement(response, { name = 'Measurement', offset = 0 } = {}) {
  const lines = [`* ${name}`, '* Freq(Hz) SPL(dB)'];
  for (let i = 0; i < response.magnitude.length; i++) {
    const frequency = response.startFreq + i * response.freqStep;
    if (frequency < 1) continue;
    lines.push(`${frequency.toFixed(3)}\t${(response.magnitude[i] + offset).toFixed(4)}`);
  }
  return lines.join('\n') + '\n';
}
