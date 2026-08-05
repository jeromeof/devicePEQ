// Browser device discovery for the built-in capture backend.
// Kept separate from AudioSession so this can be tested with a fake
// MediaDevices object and so permission failures have one defined policy.

export async function requestAudioPermission(mediaDevices) {
  if (!mediaDevices?.getUserMedia) throw new Error('MediaDevices.getUserMedia is unavailable');
  const stream = await mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks?.() || []) track.stop();
}

export function classifyDevices(devices) {
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput').map(normalizeDevice),
    outputs: devices.filter((d) => d.kind === 'audiooutput').map(normalizeDevice),
  };
}

function normalizeDevice(device) {
  return {
    id: device.deviceId || '',
    label: device.label || device.deviceId || 'Default audio device',
    groupId: device.groupId || '',
    kind: device.kind,
  };
}

/** Permission is requested before enumerateDevices so Chromium exposes labels. */
export async function enumerateAudioDevices(mediaDevices = navigator.mediaDevices, { requestPermission = true } = {}) {
  if (!mediaDevices?.enumerateDevices) throw new Error('MediaDevices.enumerateDevices is unavailable');
  let permissionError = null;
  if (requestPermission) {
    try { await requestAudioPermission(mediaDevices); }
    catch (error) { permissionError = error; }
  }
  const classified = classifyDevices(await mediaDevices.enumerateDevices());
  return { ...classified, permissionError };
}

/** Chromium-only output permission helper; returns false when unsupported. */
export async function requestOutputPermission(mediaDevices = navigator.mediaDevices) {
  if (typeof mediaDevices?.selectAudioOutput !== 'function') return false;
  await mediaDevices.selectAudioOutput();
  return true;
}

export function findDevice(devices, id, kind) {
  const list = kind === 'input' ? devices.inputs : devices.outputs;
  if (!id) return list[0] || null;
  return list.find((device) => device.id === id) || null;
}

const normalize = (value) => String(value || '').toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (text, terms) => terms.find((term) => text.includes(term));

const EXTERNAL_INPUT_TERMS = [
  'cosmos', 'adc', 'record interface', 'recording interface', 'measurement',
  'analyzer', 'line in', 'line-in', 'line input', 'usb c', 'usbc', 'usb audio',
  'focusrite', 'scarlett', 'motu', 'audient', 'rme', 'universal audio',
];
const BUILTIN_TERMS = [
  'built in', 'builtin', 'macbook', 'imac', 'facetime', 'internal microphone',
  'default microphone', 'default mic', 'microphone array', 'communications',
];
const GENERIC_TERMS = ['default', 'system', 'primary', 'aggregate device'];

function nameMatches(label, names) {
  const text = normalize(label);
  return (names || []).some((name) => {
    const candidate = normalize(name);
    return candidate && (text.includes(candidate) || candidate.includes(text));
  });
}

function rankInput(device, dutNames) {
  const text = normalize(device.label);
  const reasons = [];
  let score = 0;
  const preferred = contains(text, EXTERNAL_INPUT_TERMS);
  const builtin = contains(text, BUILTIN_TERMS);
  const generic = contains(text, GENERIC_TERMS);
  if (nameMatches(text, dutNames)) { score -= 1000; reasons.push('looks like the device under test'); }
  if (preferred) { score += 100; reasons.push(`external measurement input (${preferred})`); }
  if (builtin) { score -= 80; reasons.push(`built-in/default interface (${builtin})`); }
  if (generic) { score -= 20; reasons.push(`generic system device (${generic})`); }
  if (!preferred && !builtin && !generic) { score += 10; reasons.push('unclassified audio input'); }
  return { device, score, reasons };
}

function rankOutput(device, dutNames) {
  const text = normalize(device.label);
  const reasons = [];
  let score = 0;
  if (nameMatches(text, dutNames)) { score += 1000; reasons.push('matches the device under test'); }
  const preferred = contains(text, ['usb audio', 'usbc', 'usb c', 'dac', 'headphone', 'line out', 'focusrite', 'motu']);
  const builtin = contains(text, BUILTIN_TERMS);
  if (preferred) { score += 40; reasons.push(`external playback device (${preferred})`); }
  if (builtin) { score -= 40; reasons.push(`built-in/default interface (${builtin})`); }
  if (!preferred && !builtin && score === 0) { score += 5; reasons.push('unclassified audio output'); }
  return { device, score, reasons };
}

/** Suggest a route without silently changing the user's choices. */
export function suggestAudioRouting({ devices, dutNames = [] } = {}) {
  if (!devices) throw new TypeError('devices are required');
  const inputs = devices.inputs.map((d) => rankInput(d, dutNames)).sort((a, b) => b.score - a.score);
  const outputs = devices.outputs.map((d) => rankOutput(d, dutNames)).sort((a, b) => b.score - a.score);
  const input = inputs.find((item) => item.score > -500) || null;
  const output = outputs[0] || null;
  const confidence = input?.score >= 100 && output?.score >= 1000 ? 'high'
    : input?.score >= 50 || output?.score >= 40 ? 'medium' : 'low';
  return {
    inputId: input?.device.id || '', outputId: output?.device.id || '',
    input, output, inputCandidates: inputs, outputCandidates: outputs, confidence,
  };
}
