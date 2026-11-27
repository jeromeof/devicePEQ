import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frame, ack, decodeFrame, getEqParameters, getEqCapabilities, parseEqParameters, parseEqCapabilities, stepsToLevels, setEqSteps } from './codec.mjs';
const hex = b => Buffer.from(b).toString('hex');
test('source-derived read, capability and ACK wire examples', () => {
  assert.equal(hex(frame(getEqParameters())), '3e0c00000000025601653c');
  assert.equal(hex(frame(getEqCapabilities())), '3e0c0000000003500101613c');
  assert.equal(hex(ack(0)), '3e010100000000023c');
  assert.equal(hex(ack(1)), '3e010000000000013c');
});
test('escape all reserved bytes and verify framing integrity', () => {
  const bytes = frame(Uint8Array.of(0x3c, 0x3d, 0x3e));
  assert.equal(hex(bytes), '3e0c00000000033d2c3d2d3d2ec63c');
  assert.deepEqual(decodeFrame(bytes).payload, Uint8Array.of(0x3c, 0x3d, 0x3e));
  const broken = bytes.slice(); broken[2] = 1;
  assert.throws(() => decodeFrame(broken), /checksum/);
  assert.throws(() => decodeFrame(bytes.slice(1)), /delimiters/);
});
test('capability supplies band count and level count; parameters are steps', () => {
  const caps = parseEqCapabilities(Uint8Array.of(0x51, 1, 6, 21, 1, 0xa0, 0));
  assert.equal(caps.bandCount, 6); assert.equal(caps.levelSteps, 21);
  const params = parseEqParameters(Uint8Array.of(0x57, 1, 0xa0, 6, 10, 10, 10, 10, 10, 10));
  assert.deepEqual(stepsToLevels(params.steps, caps.levelSteps), [0,0,0,0,0,0]);
  assert.deepEqual(stepsToLevels([0, 7, 10, 20], 21), [-10, -3, 0, 10]);
  assert.equal(hex(setEqSteps(0xff, params.steps, caps)), '5801ff060a0a0a0a0a0a');
  assert.throws(() => setEqSteps(0xff, [0], caps));
  assert.throws(() => setEqSteps(0xff, [10,10,10,10,10,-3], caps));
  assert.throws(() => parseEqParameters(Uint8Array.of(0x53, 1, 1)));
  assert.throws(() => parseEqParameters(Uint8Array.of(0x57, 1, 0xa0, 6, 10)));
  assert.throws(() => parseEqCapabilities(Uint8Array.of(0x51, 1, 6, 21, 1, 0xa0, 5)));
});
