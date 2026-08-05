import fs from 'node:fs';

export function parseRewText(text) {
  const rows = text.split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length >= 2 && Number.isFinite(row[0]) && Number.isFinite(row[1]));
  if (!rows.length) throw new Error('REW export contained no frequency-response rows');
  return rows.map(([frequency, db, phase]) => ({ frequency, db, phase }));
}

export function readRewText(path) { return parseRewText(fs.readFileSync(path, 'utf8')); }

export function readDevicePeqJson(path) {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!payload.baseline?.fr?.magnitude) throw new Error('DevicePEQ export has no baseline frequency response');
  return payload;
}

export function devicePeqRows(response) {
  return response.magnitude.map((db, index) => ({ frequency: response.startFreq + index * response.freqStep, db }));
}

export function nearestRows(rows, frequencies) {
  return frequencies.map((frequency) => {
    let best = rows[0];
    for (const row of rows) if (Math.abs(Math.log(row.frequency / frequency)) < Math.abs(Math.log(best.frequency / frequency))) best = row;
    return { frequency, db: best.db };
  });
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

export function compareCurves(referenceRows, candidateRows, { minHz = 30, maxHz = 18000, count = 200 } = {}) {
  const frequencies = Array.from({ length: count }, (_, i) => minHz * Math.pow(maxHz / minHz, i / (count - 1)));
  const reference = nearestRows(referenceRows, frequencies);
  const candidate = nearestRows(candidateRows, frequencies);
  const offset = median(reference.map((r, i) => r.db - candidate[i].db));
  const errors = reference.map((r, i) => candidate[i].db + offset - r.db);
  return {
    count,
    offsetDb: offset,
    rmseDb: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    maxAbsDb: Math.max(...errors.map(Math.abs)),
    points: frequencies.map((frequency, i) => ({ frequency, referenceDb: reference[i].db, candidateDb: candidate[i].db + offset, errorDb: errors[i] })),
  };
}
