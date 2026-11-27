// Source-derived Tandem framing and PRESET_EQ codec. No device connection.
export const SERVICES = Object.freeze({
  tableSet1: '96cc203e-5068-46ad-b32d-e316f5e069ba',
  tableSet2: '956c7b26-d49a-4ba8-b03f-b17d393cb6e2',
});
const octet = n => Number.isInteger(n) && n >= 0 && n <= 255;
export function frame(payload, sequence = 0, dataType = 0x0c) {
  if (!(payload instanceof Uint8Array) || ![0, 1].includes(sequence) || !octet(dataType)) throw new TypeError('Invalid frame input');
  const body = new Uint8Array(7 + payload.length);
  body.set([dataType, sequence]);
  new DataView(body.buffer).setUint32(2, payload.length, false);
  body.set(payload, 6);
  body[body.length - 1] = body.reduce((sum, b) => sum + b, 0) & 255;
  const escaped = [0x3e];
  for (const b of body) {
    if (b >= 0x3c && b <= 0x3e) escaped.push(0x3d, b & 0xef);
    else escaped.push(b);
  }
  return Uint8Array.from([...escaped, 0x3c]);
}
export function ack(receivedSequence) {
  if (![0, 1].includes(receivedSequence)) throw new RangeError('Invalid sequence');
  return frame(new Uint8Array(), 1 - receivedSequence, 1);
}
// Supply exactly one complete frame; a transport must buffer fragmented reads.
export function decodeFrame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x3e || bytes.at(-1) !== 0x3c) throw new Error('Missing frame delimiters');
  const out = [];
  for (let i = 1; i < bytes.length - 1; i++) {
    let b = bytes[i];
    if (b === 0x3d) {
      b = bytes[++i];
      if (i >= bytes.length - 1 || ![0x2c, 0x2d, 0x2e].includes(b)) throw new Error('Invalid escape');
      b |= 0x10;
    } else if (b === 0x3c || b === 0x3e) throw new Error('Unescaped delimiter');
    out.push(b);
  }
  const body = Uint8Array.from(out);
  if (body.length < 7) throw new Error('Truncated frame');
  const length = new DataView(body.buffer).getUint32(2, false);
  if (body.length !== length + 7) throw new Error('Invalid length');
  if ((body.slice(0, -1).reduce((sum, b) => sum + b, 0) & 255) !== body.at(-1)) throw new Error('Invalid checksum');
  if (![0, 1].includes(body[1])) throw new Error('Invalid sequence');
  return { dataType: body[0], sequence: body[1], payload: body.slice(6, -1) };
}
export const getEqParameters = () => Uint8Array.of(0x56, 1);
export const getEqCapabilities = () => Uint8Array.of(0x50, 1, 1); // English = 1
export const getEqBandInfo = () => Uint8Array.of(0x5a, 1);
export function parseEqParameters(payload) {
  if (!(payload instanceof Uint8Array) || payload.length < 4 || ![0x57, 0x59].includes(payload[0]) || payload[1] !== 1 || payload.length !== 4 + payload[3]) throw new Error('Expected PRESET_EQ parameter response/notification');
  return { presetId: payload[2], steps: Array.from(payload.slice(4)) };
}
export function parseEqCapabilities(payload) {
  if (!(payload instanceof Uint8Array) || payload.length < 5 || payload[0] !== 0x51 || payload[1] !== 1) throw new Error('Expected PRESET_EQ capability response');
  const presets = [];
  let offset = 5;
  for (let i = 0; i < payload[4]; i++) {
    if (offset + 2 > payload.length) throw new Error('Truncated preset');
    const id = payload[offset++], length = payload[offset++];
    if (offset + length > payload.length) throw new Error('Truncated preset name');
    presets.push({ id, nameBytes: payload.slice(offset, offset + length) });
    offset += length;
  }
  if (offset !== payload.length || !payload[2] || !payload[3]) throw new Error('Invalid capability data');
  return { bandCount: payload[2], levelSteps: payload[3], presets };
}
export function stepsToLevels(steps, levelSteps) {
  if (!Number.isInteger(levelSteps) || levelSteps < 1 || levelSteps > 255 || !Array.isArray(steps) || steps.some(s => !Number.isInteger(s) || s < 0 || s >= levelSteps)) throw new RangeError('Invalid level steps');
  return steps.map(s => s - Math.floor((levelSteps - 1) / 2));
}
// Caller supplies preset semantics explicitly: v1 band editing uses FF,
// whereas v2 Dh.h.n passes the selected preset ID. Never silently pick a slot.
export function setEqSteps(presetId, steps, capability) {
  if (!octet(presetId) || !Array.isArray(steps) || steps.length !== capability.bandCount || !steps.length || steps.length > 255) throw new RangeError('Invalid preset or band count');
  stepsToLevels(steps, capability.levelSteps);
  return Uint8Array.from([0x58, 1, presetId, steps.length, ...steps]);
}
