import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBand, encodeEq, decodeWritePacket, defaultFilters, TYPES } from './codec.mjs';
const hex = bytes => Buffer.from(bytes).toString('hex');
test('app default first band: truncates 31.5 Hz and Q, signed master gain', () => {
  assert.equal(hex(encodeEq(defaultFilters())[0]), 'ff04000a001d0e01a1fe98005e00000b330d');
});
test('1000 Hz, -3 dB, Q 1, master -6 dB, band 6', () => {
  const packet = encodeBand(6, { freq: 1000, gain: -3, q: 1, type: 'PEQ' });
  assert.equal(hex(packet), 'ff04000a001d0e01a6fe980bb8ff4c10000d');
  assert.deepEqual(decodeWritePacket(packet), { band: 6, masterGain: -6, freq: 1000, gain: -3, q: 1, type: 'PEQ' });
});
test('unsigned upper frequency and Q; all ten band addresses', () => {
  const packets = encodeEq(defaultFilters().map(f => ({ ...f, freq: 20000, q: 10, gain: 12 })), 6);
  assert.deepEqual(packets.map(p => p[8]), [161,162,163,164,165,166,167,168,169,170]);
  assert.equal(hex(packets[9]), 'ff04000a001d0e01aa0168ea6002d0a0000d');
  assert.equal(decodeWritePacket(packets[9]).q, 10);
});
test('six explicit filter codes and invalid inputs', () => {
  for (const [type, code] of Object.entries(TYPES)) {
    assert.equal(encodeBand(1, { ...defaultFilters()[0], type })[17], code);
  }
  assert.throws(() => encodeEq(defaultFilters().slice(1)));
  for (const patch of [{ q: NaN }, { q: 11 }, { gain: 13 }, { freq: 0 }, { type: 'LS' }]) {
    assert.throws(() => encodeBand(1, { ...defaultFilters()[0], ...patch }));
  }
  assert.throws(() => decodeWritePacket(new Uint8Array(18)));
});
