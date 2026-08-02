// Browser ESM port of rew-control.js — same REW HTTP API calls, using
// fetch() directly from the page (confirmed working: REW sends
// Access-Control-Allow-Origin: * on every endpoint we need, including
// preflight for POST/PUT with Content-Type). Requires REW Pro for
// /measure/command; see ../../.claude/skills/rew-measurement.md for the
// pre-Pro GUI-automation fallback if that's ever needed again.
const REW_BASE = 'http://127.0.0.1:4735';

async function rewGet(path) {
  const res = await fetch(`${REW_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function rewPost(path, body) {
  const res = await fetch(`${REW_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return { message: text }; }
}

async function rewPut(path, body) {
  const res = await fetch(`${REW_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return { message: text }; }
}

export async function checkRewReachable() {
  try {
    const v = await rewGet('/version');
    return v.message;
  } catch (e) {
    throw new Error(`REW API not reachable at ${REW_BASE} — is REW open with Preferences > API > Enable API checked? (${e.message})`);
  }
}

// The rate REW is actually playing at, which is the rate the device under test
// is being fed — and therefore the rate its DSP is almost certainly running its
// biquads at. Authoritative in a way the tool's own field is not: that field is
// a hand-typed assumption used only to compute the theoretical curve, and a
// wrong value there shows up as a shape mismatch that looks like a device bug.
export async function getSampleRate() {
  const r = await rewGet('/audio/samplerate');
  return Number(r.value);
}

export async function listMeasurementIds() {
  const measurements = await rewGet('/measurements');
  return Object.keys(measurements);
}

export async function renameMeasurement(id, title) {
  return rewPut(`/measurements/${id}`, { title });
}

export async function waitForNewMeasurement(previousIds, { timeoutMs = 30000, pollMs = 1000 } = {}) {
  const prevSet = new Set(previousIds);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const ids = await listMeasurementIds();
    const fresh = ids.find((id) => !prevSet.has(id));
    if (fresh) return fresh;
  }
  throw new Error(`No new measurement appeared within ${timeoutMs}ms`);
}

// Triggers an SPL sweep directly via the API (requires REW Pro) and returns
// the new measurement id once it appears.
export async function triggerMeasurement() {
  const before = await listMeasurementIds();
  await rewPost('/measure/command', { command: 'SPL' });
  return waitForNewMeasurement(before);
}

// Non-throwing variant of the trigger call — returns false (instead of
// throwing) when the Pro license isn't active, so callers can fall back to
// asking the user to click "Start Measurement" in the REW GUI themselves.
export async function triggerSweepCommand() {
  try {
    await rewPost('/measure/command', { command: 'SPL' });
    return true;
  } catch (e) {
    return false;
  }
}

function decodeFloatsBE(base64) {
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(buf);
  const out = new Float32Array(binary.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, false); // big-endian
  return out;
}

export async function getFrequencyResponse(id) {
  const fr = await rewGet(`/measurements/${id}/frequency-response?smoothing=None`);
  return {
    startFreq: fr.startFreq,
    freqStep: fr.freqStep,
    magnitude: decodeFloatsBE(fr.magnitude),
  };
}

// REW's frequency axis here is LINEAR (freq[i] = startFreq + i*freqStep),
// confirmed from real data: freqStep ≈ sampleRate/fftLength, and
// startFreq+N*freqStep ≈ endFreq.
export function magnitudeAt(fr, freq) {
  const idx = Math.round((freq - fr.startFreq) / fr.freqStep);
  const clamped = Math.max(0, Math.min(fr.magnitude.length - 1, idx));
  return fr.magnitude[clamped];
}
