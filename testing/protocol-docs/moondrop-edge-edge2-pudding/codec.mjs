// Source-derived Moondrop PEQ reference codec.
// The GAIA V3 envelope is: vendor:u16, command:u16, payload.
// All multi-byte values are big-endian, as in BytesUtils used by the APK.

const VENDOR_QTIL_V3 = 0x001d;
const MUSIC_PROCESSING_FEATURE = 5;

const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
const s16 = (n) => u16(n < 0 ? n + 0x10000 : n);
const readU16 = (a, o) => (a[o] << 8) | a[o + 1];
const readS16 = (a, o) => { const n = readU16(a, o); return n & 0x8000 ? n - 0x10000 : n; };
const trunc = (n) => Math.trunc(n);

export function encodeBand(band) {
  const f = trunc(band.frequency ?? band.freq);
  const q = trunc((band.q ?? band.qFactor) * 4096);
  const g = trunc((band.gain ?? 0) * 60);
  return Uint8Array.from([...u16(f), ...u16(q), band.type ?? 13, ...s16(g)]);
}

export function decodeBands(payload, bluetrum = false) {
  const start = payload[0];
  const end = payload[1];
  const count = end - start + 1;
  const base = bluetrum ? 4 : 2;
  if (count < 1 || payload.length < base + count * 7) throw new Error('short or invalid configuration payload');
  const totalGain = bluetrum ? readS16(payload, 2) / 60 : 0;
  const bands = [];
  for (let i = 0; i < count; i++) {
    const o = base + i * 7;
    bands.push({ id: start + i, frequency: readU16(payload, o), q: readU16(payload, o + 2) / 4096, type: payload[o + 4], gain: readS16(payload, o + 5) / 60 });
  }
  return { start, end, totalGain, bands };
}

export function buildGaia(command, payload = [], type = 0) {
  const value = (MUSIC_PROCESSING_FEATURE << 9) | (type << 7) | command;
  return Uint8Array.from([...u16(VENDOR_QTIL_V3), ...u16(value), ...payload]);
}

export function buildRead(start = 0, end = 4) { return buildGaia(5, [start & 255, end & 255]); }

function rangePayload(start, bands, totalGain, bluetrum) {
  const out = [start & 255, (start + bands.length - 1) & 255];
  if (bluetrum) out.push(...s16(trunc(totalGain * 60)));
  for (const band of bands) out.push(...encodeBand(band));
  return out;
}

export function buildWrite(start, bands) { return buildGaia(6, rangePayload(start, bands, 0, false)); }
export function buildBluetrumWrite(start, totalGain, bands) { return buildGaia(6, rangePayload(start, bands, totalGain, true)); }
export function buildAirohaStorage(start, totalGain, bands) { return buildGaia(7, rangePayload(start, bands, totalGain, true)); }

export function parseGaia(bytes) {
  if (bytes.length < 4) throw new Error('short GAIA packet');
  return { vendor: readU16(bytes, 0), commandValue: readU16(bytes, 2), feature: readU16(bytes, 2) >>> 9 & 0x7f, type: readU16(bytes, 2) >>> 7 & 3, command: readU16(bytes, 2) & 0x7f, payload: bytes.slice(4) };
}

export const oldEdge = {
  frame(command, payload) { return Uint8Array.from([0xff, 0x04, payload.length >> 8, payload.length & 255, 0, 0x1d, 0x0a, command, ...payload]); },
};

