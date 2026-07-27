// Thin wrapper around REW's HTTP API. Requires a REW Pro license — the
// /measure/command sweep-trigger endpoint 403s with "A Pro upgrade license is
// required for this action" otherwise. (A GUI-automation fallback using
// osascript/System Events existed for the pre-Pro period; see git history /
// ../../.claude/skills/rew-measurement.md if that's ever needed again.)
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

// PUT /measurements/{id} with {title} renames it — confirmed working against
// REW 5.40 Beta 130. Useful for tagging each measurement with the filter under
// test so the REW measurement list is self-documenting afterwards.
async function renameMeasurement(id, title) {
  return rewPut(`/measurements/${id}`, { title });
}

async function checkRewReachable() {
  try {
    const v = await rewGet('/version');
    return v.message;
  } catch (e) {
    throw new Error(`REW API not reachable at ${REW_BASE} — is REW open with Preferences > API > Enable API checked? (${e.message})`);
  }
}

async function listMeasurementIds() {
  const measurements = await rewGet('/measurements');
  return Object.keys(measurements);
}

async function waitForNewMeasurement(previousIds, { timeoutMs = 30000, pollMs = 1000 } = {}) {
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
async function triggerMeasurement() {
  const before = await listMeasurementIds();
  await rewPost('/measure/command', { command: 'SPL' });
  return waitForNewMeasurement(before);
}

function decodeFloatsBE(base64) {
  const buf = Buffer.from(base64, 'base64');
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatBE(i * 4);
  return out;
}

async function getFrequencyResponse(id) {
  const fr = await rewGet(`/measurements/${id}/frequency-response?smoothing=None`);
  return {
    startFreq: fr.startFreq,
    freqStep: fr.freqStep,
    magnitude: decodeFloatsBE(fr.magnitude),
  };
}

// REW's frequency axis here is LINEAR (freq[i] = startFreq + i*freqStep), confirmed
// from real data: freqStep ≈ sampleRate/fftLength, and startFreq+N*freqStep ≈ endFreq.
function magnitudeAt(fr, freq) {
  const idx = Math.round((freq - fr.startFreq) / fr.freqStep);
  const clamped = Math.max(0, Math.min(fr.magnitude.length - 1, idx));
  return fr.magnitude[clamped];
}

module.exports = {
  checkRewReachable,
  listMeasurementIds,
  triggerMeasurement,
  renameMeasurement,
  getFrequencyResponse,
  magnitudeAt,
};
