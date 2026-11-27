import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRead, buildWrite, buildBluetrumWrite, buildAirohaStorage, parseGaia, decodeBands, oldEdge } from './codec.mjs';

const bands = [
  { frequency: 100, q: 1, type: 13, gain: -3 },
  { frequency: 1000, q: 0.707, type: 13, gain: 2.5 },
];

test('GAIA V3 read uses QTIL vendor, music-processing feature and command 5', () => {
  const p = buildRead(0, 4);
  assert.deepEqual([...p], [0, 0x1d, 0x0a, 5, 0, 4]);
  assert.deepEqual(parseGaia(p), { vendor: 29, commandValue: 0x0a05, feature: 5, type: 0, command: 5, payload: Uint8Array.from([0, 4]) });
});

test('normal write has contiguous 7-byte records', () => {
  const p = buildWrite(0, bands);
  assert.deepEqual([...p], [0, 0x1d, 0x0a, 6, 0, 1, 0, 100, 0x10, 0, 13, 0xff, 0x4c, 3, 0xe8, 0x0b, 0x4f, 13, 0, 150]);
});

test('Bluetrum and Airoha storage prepend total gain and use command 6/7', () => {
  assert.equal(parseGaia(buildBluetrumWrite(0, -1, bands)).command, 6);
  assert.equal(parseGaia(buildAirohaStorage(0, -1, bands)).command, 7);
  assert.deepEqual([...parseGaia(buildBluetrumWrite(0, -1, bands)).payload.slice(0, 4)], [0, 1, 0xff, 0xc4]);
});

test('configuration response decoding reverses BandInfo scaling', () => {
  const payload = parseGaia(buildBluetrumWrite(3, -1, bands)).payload;
  const decoded = decodeBands(payload, true);
  assert.equal(decoded.start, 3);
  assert.equal(decoded.totalGain, -1);
  assert.equal(decoded.bands[1].frequency, 1000);
  assert.equal(decoded.bands[0].gain, -3);
});

test('old Edge custom SPP envelope is visibly different from GAIA', () => {
  assert.deepEqual([...oldEdge.frame(5, [0, 4])], [0xff, 4, 0, 2, 0, 0x1d, 0x0a, 5, 0, 4]);
});
