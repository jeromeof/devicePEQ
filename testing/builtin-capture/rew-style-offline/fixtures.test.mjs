import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCurves, devicePeqRows, parseRewText, readDevicePeqJson, readRewText } from './fixtures.mjs';

const DOWNLOADS = '/Users/joflaherty/Downloads';

test('parses the supplied REW export and DevicePEQ export', () => {
  const rew = readRewText(`${DOWNLOADS}/tp13-export-rew.txt`);
  const builtin = readDevicePeqJson(`${DOWNLOADS}/devicepeq-verification (5).json`);
  assert.ok(rew.length > 50000);
  assert.ok(builtin.baseline.fr.magnitude.length > 200000);
  assert.equal(rew[0].frequency > 20, true);
});

test('curve comparator removes only broadband offset and reports shape error', () => {
  const reference = parseRewText('20 90 0\n100 80 0\n1000 70 0\n10000 60 0');
  const candidate = parseRewText('20 80 0\n100 70 0\n1000 60 0\n10000 50 0');
  const result = compareCurves(reference, candidate, { minHz: 20, maxHz: 10000, count: 4 });
  assert.ok(Math.abs(result.offsetDb - 10) < 0.01);
  assert.ok(result.rmseDb < 0.01);
});

test('the supplied TP13 REW and built-in curves can be compared on the valid band', () => {
  const rew = readRewText(`${DOWNLOADS}/tp13-export-rew.txt`);
  const builtin = readDevicePeqJson(`${DOWNLOADS}/devicepeq-verification (5).json`);
  const result = compareCurves(rew, devicePeqRows(builtin.baseline.fr));
  assert.ok(Number.isFinite(result.rmseDb));
  assert.ok(result.points.length === 200);
});
