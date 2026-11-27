// Offline reference for EarFun Audio's HP1000 Professional EQ write path.
// Does not connect to hardware or implement a device-read command.
export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
export const TYPES = Object.freeze({
  PEQ: 13, LoShelf1stOrder: 4, HiShelf1stOrder: 5,
  LoPass1stOrder: 1, HiPass1stOrder: 2, AllPass1stOrder: 3,
});
export const DEFAULT_FREQUENCIES = Object.freeze([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export function defaultFilters() {
  return DEFAULT_FREQUENCIES.map(freq => ({ freq, gain: 0, q: 0.7, type: 'PEQ' }));
}
function range(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be in [${min}, ${max}]`);
  }
}
// Kotlin Float multiplication followed by toInt(): float32, truncate toward zero.
function scaled(value, factor) {
  return Math.trunc(Math.fround(Math.fround(value) * factor));
}
export function encodeBand(band, filter, masterGain = -6) {
  if (!Number.isInteger(band) || band < 1 || band > 10) throw new RangeError('band must be 1..10');
  range(masterGain, -12, 6, 'masterGain');
  range(filter.freq, 1, 20000, 'frequency');
  range(filter.gain, -12, 12, 'gain');
  range(filter.q, 0.25, 10, 'Q');
  if (!Object.hasOwn(TYPES, filter.type)) throw new TypeError('Use an explicit EarFun filter type');
  const bytes = new Uint8Array(18);
  bytes.set([0xff, 4, 0, 10, 0, 0x1d, 0x0e, 1, 0xa0 + band]);
  const view = new DataView(bytes.buffer);
  view.setInt16(9, scaled(masterGain, 60), false);
  view.setUint16(11, scaled(filter.freq, 3), false);
  view.setInt16(13, scaled(filter.gain, 60), false);
  view.setUint16(15, scaled(filter.q, 4096), false);
  bytes[17] = TYPES[filter.type];
  return bytes;
}
export function encodeEq(filters, masterGain = -6) {
  if (!Array.isArray(filters) || filters.length !== 10) throw new RangeError('Exactly 10 filters required');
  return filters.map((filter, i) => encodeBand(i + 1, filter, masterGain));
}
// Decode a captured OUTGOING write packet; this is NOT a hardware read response.
export function decodeWritePacket(bytes) {
  const header = [0xff, 4, 0, 10, 0, 0x1d, 0x0e, 1];
  if (!(bytes instanceof Uint8Array) || bytes.length !== 18 || header.some((b, i) => bytes[i] !== b)) {
    throw new TypeError('Expected an 18-byte HP1000 PEQ write packet');
  }
  const band = bytes[8] - 0xa0;
  const type = Object.keys(TYPES).find(key => TYPES[key] === bytes[17]);
  if (band < 1 || band > 10 || !type) throw new RangeError('Unknown band or filter type');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { band, masterGain: view.getInt16(9, false) / 60,
    freq: view.getUint16(11, false) / 3, gain: view.getInt16(13, false) / 60,
    q: view.getUint16(15, false) / 4096, type };
}
