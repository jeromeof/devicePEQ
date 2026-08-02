// Browser ESM port of rew-control.js — same REW HTTP API calls, using
// fetch() directly from the page (confirmed working: REW sends
// Access-Control-Allow-Origin: * on every endpoint we need, including
// preflight for POST/PUT with Content-Type). Requires REW Pro for
// /measure/command; see ../../.claude/skills/rew-measurement.md for the
// pre-Pro GUI-automation fallback if that's ever needed again.
const REW_BASE = 'http://127.0.0.1:4735';

// Every REW request goes through one chain, one at a time.
//
// REW's API is a single-threaded GUI app, not a concurrent server, and the
// call sequences here are stateful: "list ids -> trigger sweep -> wait for an
// id that wasn't in the list" is only sound if nothing else triggers a sweep
// in between. Overlapping callers (a retry firing while the first capture is
// still in flight, a second Run click, an insight re-measure) would interleave
// their requests and each could pick up the other's measurement.
//
// A bare fetch() also never times out. If REW stops answering mid-request the
// promise simply never settles, the run loop awaits it forever, and the page
// looks frozen with no error anywhere. Every request below is therefore
// bounded by an AbortController.
const DEFAULT_TIMEOUT_MS = 15000;
let chain = Promise.resolve();
let inFlight = null;

// Raised when a request is aborted on its timeout, so callers can tell "REW
// stopped answering" apart from "REW answered with an error".
export class RewTimeoutError extends Error {
  constructor(method, path, ms) {
    super(`${method} ${path} did not respond within ${ms}ms — REW may be busy, mid-sweep, or not responding`);
    this.name = 'RewTimeoutError';
    this.path = path;
  }
}

// What the queue is currently doing, for the UI's "busy" indicator and for
// diagnosing a stall: a hung request names itself here.
export function rewInFlight() { return inFlight; }

function enqueue(method, path, { body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const run = async () => {
    inFlight = `${method} ${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${REW_BASE}${path}`, {
        method,
        signal: ctl.signal,
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`${method} ${path} -> ${res.status} ${text || res.statusText}`);
        err.status = res.status;
        throw err;
      }
      try { return JSON.parse(text); } catch { return { message: text }; }
    } catch (e) {
      if (e.name === 'AbortError') throw new RewTimeoutError(method, path, timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  };
  // Chain on settlement, not resolution: one failed request must not break the
  // queue for every request after it.
  const result = chain.then(run, run);
  chain = result.then(() => {}, () => {});
  return result;
}

const rewGet = (path, opts) => enqueue('GET', path, opts);
const rewPost = (path, body, opts) => enqueue('POST', path, { ...opts, body: body ?? {} });
const rewPut = (path, body, opts) => enqueue('PUT', path, { ...opts, body: body ?? {} });

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
    const fresh = ids.filter((id) => !prevSet.has(id));
    // More than one new measurement means a sweep this caller did not start
    // also finished — two capture sequences have crossed. Picking one at
    // random would silently attribute someone else's curve to this test case,
    // which is exactly the failure mode that is hardest to spot afterwards.
    if (fresh.length > 1) {
      throw new Error(`${fresh.length} new measurements appeared (${fresh.join(', ')}) where one was expected — a concurrent sweep crossed this capture. Nothing was attributed to this case.`);
    }
    if (fresh.length === 1) return fresh[0];
  }
  throw new Error(`No new measurement appeared within ${timeoutMs}ms`);
}

// Triggers an SPL sweep directly via the API (requires REW Pro) and returns
// the new measurement id once it appears.
export async function triggerMeasurement({ timeoutMs = 60000 } = {}) {
  const before = await listMeasurementIds();
  await rewPost('/measure/command', { command: 'SPL' }, { timeoutMs });
  return waitForNewMeasurement(before, { timeoutMs });
}

// Non-throwing variant of the trigger call — returns false (instead of
// throwing) when the Pro license isn't active, so callers can fall back to
// asking the user to click "Start Measurement" in the REW GUI themselves.
// timeoutMs is the caller's whole-sweep budget, not the default 15s: REW is
// not required to answer this POST before the sweep finishes, and capping it
// at the default would abort a perfectly healthy long sweep.
export async function triggerSweepCommand({ timeoutMs = 60000 } = {}) {
  try {
    await rewPost('/measure/command', { command: 'SPL' }, { timeoutMs });
    return true;
  } catch (e) {
    // Only a refusal by REW means "no Pro licence, ask the user to click it".
    // A timeout or a dropped connection must NOT land here: falling back to the
    // manual prompt would sit waiting for a click that an unattended run never
    // makes, and the run would look hung rather than broken.
    if (e instanceof RewTimeoutError || e.status === undefined) throw e;
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

// Unsmoothed full-resolution curves are the largest payload here and REW has
// to serialise them, so this gets more headroom than a status query.
export async function getFrequencyResponse(id, { timeoutMs = 45000 } = {}) {
  const fr = await rewGet(`/measurements/${id}/frequency-response?smoothing=None`, { timeoutMs });
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
