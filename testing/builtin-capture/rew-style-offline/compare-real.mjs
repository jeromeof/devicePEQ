import { devicePeqRows, readDevicePeqJson, readRewText, compareCurves } from './fixtures.mjs';

const downloads = process.argv[2] || '/Users/joflaherty/Downloads';
const rew = readRewText(`${downloads}/tp13-export-rew.txt`);
const names = process.argv.slice(3).length ? process.argv.slice(3) : [
  'devicepeq-verification.json',
  'devicepeq-verification (1).json',
  'devicepeq-verification (2).json',
  'devicepeq-verification (5).json',
];

for (const name of names) {
  const payload = readDevicePeqJson(`${downloads}/${name}`);
  const result = compareCurves(rew, devicePeqRows(payload.baseline.fr));
  console.log(JSON.stringify({
    file: name,
    source: payload.baseline.metadata?.source,
    noiseSubtracted: payload.baseline.metadata?.noiseSubtracted,
    bins: payload.baseline.fr.magnitude.length,
    validBand: [payload.baseline.fr.validStartFreq, payload.baseline.fr.validEndFreq],
    broadbandOffsetDb: Number(result.offsetDb.toFixed(3)),
    rmseDb: Number(result.rmseDb.toFixed(3)),
    maxAbsDb: Number(result.maxAbsDb.toFixed(3)),
  }));
}
