//
// Copyright 2025 : Pragmatic Audio
//
// Shared Q compensation.
//
// Several devices realise a Q that differs from the one they were told to use.
// The correction is always the same shape — send Q/ratio, report back Q*ratio —
// but the ratio itself follows different LAWS on different hardware, so the law
// is named in modelConfig rather than hardcoded per handler:
//
//   qCompensation: { model: 'rbjGain' }                  // ratio = 1/A(gain)
//   qCompensation: { model: 'constant', ratio: 0.701 }   // flat scale
//   (absent)                                             // no compensation
//
// The ratio is always expressed as REALISED / REQUESTED, i.e. what a
// measurement reports, never its reciprocal. A device whose filters come out
// 29.9% too wide is configured as 0.701, which is exactly the number the REW
// verification tool prints — so nobody has to remember which way to invert it.
//
// Note what this module deliberately does NOT cover: FiiO's shelf correction is
// a slope<->Q transform, not a ratio, and lives in fiioUsbHidHandler.js. Only
// laws that reduce to "multiply the Q by something" belong here.
//

// RBJ peaking amplitude. A + 1/A is invariant under A -> 1/A and the peaking
// law uses |gain|, so cuts and boosts of equal size behave identically — which
// is what the FiiO measurements showed.
export function rbjA(gainDb) {
  return Math.pow(10, Math.abs(gainDb || 0) / 40);
}

export const NO_COMPENSATION = 1.0;

// Every band is rewritten on every save, so an unbounded clamp warning fires
// hundreds of times per run. That is not just noise: with devtools open, a
// console flood is enough to make the page itself crawl.
const warnedKeys = new Set();
function warnOnce(key, message) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}
export function resetCompensationWarnings() { warnedKeys.clear(); }

// ── Verification-only bypass ───────────────────────────────────────────────
// NOT a user-facing feature, and normal devicePEQ operation must never turn this
// off: a device with a configured compensation needs it to produce the filter
// that was asked for, so bypassing it in the plugin would simply write wrong
// filters.
//
// It exists for the REW verification tool alone. A measurement taken with
// compensation on describes handler+device, so answering "what does this DEVICE
// actually do?" — the measurement you need to derive a compensation in the first
// place, and again to check whether a firmware fix has landed — requires
// bypassing it for the duration of a run.
//
// Named accordingly so it cannot be wired into the plugin UI by accident, and
// defaulted ON so any consumer that never calls it behaves normally.
let compensationEnabled = true;

export function setCompensationEnabledForVerification(on) {
  const next = !!on;
  if (next !== compensationEnabled) {
    console.log(`USB Device PEQ: compensation ${next ? 'ENABLED' : 'DISABLED (verification bypass)'} — ` +
      `${next ? 'filters are corrected before writing' : 'writing raw values, measuring the device as-is'}`);
  }
  compensationEnabled = next;
  return compensationEnabled;
}

export function isCompensationEnabled() {
  return compensationEnabled;
}

// Filter types a Q ratio is meaningful for. Pass/stop/notch shapes are excluded:
// their width is defined differently and no measurement backs a correction.
//
// Callers can narrow this. FiiO must: its gain law was measured on PEAKING
// filters only, and its shelves take a separate slope<->Q transform, so letting
// the ratio reach a shelf would double-correct the QX13 and newly mis-correct
// the KA17 (which enables the peaking law but has no shelf flag).
const DEFAULT_TYPES = ['PK', 'LSQ', 'HSQ'];

function appliesTo(filterType, types) {
  const t = (filterType || '').toUpperCase();
  return (types ?? DEFAULT_TYPES).some((x) => x.toUpperCase() === t);
}

// Resolve modelConfig into a compensation spec, tolerating the legacy boolean
// flags so an out-of-tree config keeps working.
//
//   compensateQForGain: true   ->  { model: 'rbjGain' }
//
// An unrecognised model is treated as no compensation and warned about once per
// call site rather than silently guessing — a wrong law is worse than none.
export function resolveQCompensation(modelConfig, { ignoreGlobalSwitch = false } = {}) {
  if (!compensationEnabled && !ignoreGlobalSwitch) return null;
  const spec = modelConfig?.qCompensation;

  if (spec && typeof spec === 'object') {
    if (spec.model === 'rbjGain') return { model: 'rbjGain' };
    if (spec.model === 'constant') {
      const ratio = Number(spec.ratio);
      if (!Number.isFinite(ratio) || ratio <= 0) {
        console.warn(
          `USB Device PEQ: qCompensation model 'constant' needs a positive ratio, got ` +
          `${JSON.stringify(spec.ratio)} — compensation disabled.`);
        return null;
      }
      return ratio === NO_COMPENSATION ? null : { model: 'constant', ratio };
    }
    console.warn(
      `USB Device PEQ: unknown qCompensation model ${JSON.stringify(spec.model)} — ` +
      `compensation disabled. Known models: 'rbjGain', 'constant'.`);
    return null;
  }

  // Legacy flag, still honoured.
  if (modelConfig?.compensateQForGain) return { model: 'rbjGain' };

  return null;
}

// Realised / requested Q for this filter, or 1.0 when nothing applies.
// `types` narrows which filter types the law is allowed to touch.
export function qRealisedRatio(gainDb, filterType, modelConfig, { types } = {}) {
  const spec = resolveQCompensation(modelConfig);
  if (!spec) return NO_COMPENSATION;
  if (!appliesTo(filterType, types)) return NO_COMPENSATION;

  if (spec.model === 'constant') return spec.ratio;
  if (spec.model === 'rbjGain') {
    const A = rbjA(gainDb);
    return A === 0 ? NO_COMPENSATION : 1 / A;
  }
  return NO_COMPENSATION;
}

// Requested Q -> the Q the device must be TOLD to use in order to realise it.
//
// Clamped to the device's range: under the rbjGain law a -24 dB filter needs 4x
// the Q, so a requested 10 would need 39.8 sent, which the device cannot store.
// Warn with the width that will actually result rather than quietly delivering
// a filter several times wider than asked for.
export function compensateQForWrite(q, gainDb, filterType, modelConfig,
                                    { label = 'Device', types } = {}) {
  const ratio = qRealisedRatio(gainDb, filterType, modelConfig, { types });
  if (ratio === NO_COMPENSATION) return q;

  const minQ = modelConfig?.minQ ?? 0.1;
  const maxQ = modelConfig?.maxQ ?? 10;
  const wanted = q / ratio;
  const clamped = Math.min(maxQ, Math.max(minQ, wanted));

  if (Math.abs(clamped - wanted) > 1e-6) {
    warnOnce(`q:${q}:${gainDb}:${filterType}`,
      `USB Device PEQ: ${label} Q compensation clamped — Q ${q} at ${gainDb}dB needs ` +
      `${wanted.toFixed(3)} sent to realise it, but the device range is [${minQ}, ${maxQ}]. ` +
      `Sending ${clamped}; realised Q will be about ${(clamped * ratio).toFixed(2)}, not ${q}.`);
  }
  return clamped;
}

// The largest Q that can actually be REALISED at this gain. Compensation needs
// headroom above the requested value, so a device with maxQ 20 under the
// rbjGain law tops out at 20/A — 14.2 at 6 dB, 10.0 at 12 dB. Asking for more
// than this cannot succeed no matter what is written, so callers that generate
// requests (test plans, UI sliders) should bound themselves by it rather than
// producing a request that is guaranteed to clamp.
export function maxRealisableQ(modelConfig, gainDb, { types } = {}) {
  const maxQ = modelConfig?.maxQ ?? 10;
  const ratio = qRealisedRatio(gainDb, 'PK', modelConfig, { types });
  return ratio === NO_COMPENSATION ? maxQ : maxQ * ratio;
}

// Inverse, so a pull reports the Q that will actually be heard and a
// pull -> push round trip is stable instead of compounding the factor.
export function decompensateQFromRead(q, gainDb, filterType, modelConfig, { types } = {}) {
  const ratio = qRealisedRatio(gainDb, filterType, modelConfig, { types });
  return ratio === NO_COMPENSATION ? q : q * ratio;
}

// ── Centre frequency compensation ──────────────────────────────────────────
// Same convention as Q: the configured factor is REALISED / REQUESTED, i.e.
// what a measurement reports. A device that lands on 200 Hz when told 100 is
// configured with factor 2, and the handler writes freq/2.
//
//   freqCompensation: { model: 'ratio', factor: 2 }
//   compensate2X: true                                // legacy, same thing
//   (absent)                                          // no compensation
//
// This generalises the KT Micro compensate2X flag, which is exactly a ratio of
// 2 and behaves identically under this convention — write freq/2, read freq*2.
// KT Micro's own arithmetic is left where it is; the legacy flag is recognised
// here so that "what is this device correcting?" has a single answer.
// A second model, for a defect that only affects SHELVES:
//
//   freqCompensation: { model: 'shelfSqrtA', fs: 48000 }
//
// A shelf's corner frequency has more than one defensible definition — the
// midpoint (where the response is half the shelf gain) and the edge differ by
// sqrt(A), and the two conventions pull in opposite directions for low and high
// shelves. A device using the other convention lands its shelf at
//
//     realised = requested x A^(+1/2)   for LSQ
//     realised = requested x A^(-1/2)   for HSQ
//
// with A = 10^(|gain|/40), so the error grows with gain and vanishes at 0 dB —
// which is why small shelves pass and large ones fail.
//
// The shift is applied to the ANALOG prototype, so near Nyquist the digital
// corner moves by less than sqrt(A) once bilinear-transformed. Prewarping is
// therefore part of the model, not a refinement: on a DS3 at 48 kHz it is the
// difference between a 10 kHz shelf landing at x0.708 (predicted without) and
// x0.760 (predicted with, measured x0.769).
//
// `fs` is the rate the device's DSP runs at. It only matters above a few kHz —
// at 200 Hz prewarping changes the answer by 0.01% — so a wrong-but-plausible
// value degrades gracefully rather than breaking the correction.
const SHELF_TYPES = new Set(['LSQ', 'HSQ']);
const warp = (f, fs) => Math.tan(Math.PI * f / fs);
const unwarp = (t, fs) => (fs / Math.PI) * Math.atan(t);

// The analog-domain shift, as a direction factor. LSQ moves up, HSQ down.
function shelfDir(gainDb, filterType) {
  if (!SHELF_TYPES.has((filterType || '').toUpperCase())) return null;
  const m = Math.sqrt(rbjA(gainDb));
  return (filterType || '').toUpperCase() === 'LSQ' ? m : 1 / m;
}

// Because the shift happens in the prewarped domain, the DIGITAL multiplier
// depends on the frequency it is applied at — so the inverse is not "divide by
// the multiplier at the target". Both directions have to transform through the
// warp explicitly, or a write/read round trip drifts (8 kHz came back as 8069).
function shelfRealisedFromStored(freq, gainDb, filterType, fs) {
  const dir = shelfDir(gainDb, filterType);
  if (dir == null || !(freq > 0)) return freq;
  if (freq >= fs / 2) return freq * dir;      // past Nyquist the warp is meaningless
  return unwarp(warp(freq, fs) * dir, fs);
}

function shelfStoredForTarget(freq, gainDb, filterType, fs) {
  const dir = shelfDir(gainDb, filterType);
  if (dir == null || !(freq > 0)) return freq;
  if (freq >= fs / 2) return freq / dir;
  return unwarp(warp(freq, fs) / dir, fs);
}

export function resolveFreqCompensation(modelConfig, { ignoreGlobalSwitch = false } = {}) {
  if (!compensationEnabled && !ignoreGlobalSwitch) return null;
  const spec = modelConfig?.freqCompensation;

  if (spec && typeof spec === 'object') {
    if (spec.model === 'shelfSqrtA') {
      const fs = Number(spec.fs);
      return { model: 'shelfSqrtA', fs: Number.isFinite(fs) && fs > 0 ? fs : 48000 };
    }
    if (spec.model === 'ratio') {
      const factor = Number(spec.factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        console.warn(
          `USB Device PEQ: freqCompensation model 'ratio' needs a positive factor, got ` +
          `${JSON.stringify(spec.factor)} — compensation disabled.`);
        return null;
      }
      return factor === NO_COMPENSATION ? null : { model: 'ratio', factor };
    }
    console.warn(
      `USB Device PEQ: unknown freqCompensation model ${JSON.stringify(spec.model)} — ` +
      `compensation disabled. Known models: 'ratio', 'shelfSqrtA'.`);
    return null;
  }

  if (modelConfig?.compensate2X) return { model: 'ratio', factor: 2, legacy: 'compensate2X' };

  return null;
}

// Requested centre frequency -> the frequency to actually write. Clamped to the
// audio band and warned about, since halving or doubling can push a band edge
// outside what the device will accept.
// `fs` overrides the configured rate. It must, for any device whose DSP follows
// the stream: a rate baked into config is wrong the moment the user changes
// their output rate, and the prewarp is exactly where that shows.
export function compensateFreqForWrite(freq, modelConfig,
                                       { label = 'Device', gainDb = 0, filterType = 'PK', fs } = {}) {
  const spec = resolveFreqCompensation(modelConfig);
  if (!spec) return freq;
  const rate = Number.isFinite(fs) && fs > 0 ? fs : spec.fs;

  const wanted = spec.model === 'shelfSqrtA'
    ? shelfStoredForTarget(freq, gainDb, filterType, rate)
    : freq / spec.factor;
  if (wanted === freq) return freq;
  const clamped = Math.min(20000, Math.max(20, wanted));
  if (Math.abs(clamped - wanted) > 1e-6) {
    console.warn(
      `USB Device PEQ: ${label} frequency compensation clamped — ${freq}Hz needs ` +
      `${wanted.toFixed(1)}Hz written to land correctly, which is outside 20-20000Hz. ` +
      `Writing ${clamped.toFixed(1)}Hz; the band will sit at about ` +
      `${(spec.model === 'shelfSqrtA'
          ? shelfRealisedFromStored(clamped, gainDb, filterType, rate)
          : clamped * spec.factor).toFixed(0)}Hz, not ${freq}Hz.`);
  }
  return clamped;
}

// Inverse, so a pull reports where the band actually sits.
export function decompensateFreqFromRead(freq, modelConfig,
                                        { gainDb = 0, filterType = 'PK', fs } = {}) {
  const spec = resolveFreqCompensation(modelConfig);
  if (!spec) return freq;
  const rate = Number.isFinite(fs) && fs > 0 ? fs : spec.fs;
  return spec.model === 'shelfSqrtA'
    ? shelfRealisedFromStored(freq, gainDb, filterType, rate)
    : freq * spec.factor;
}

// ── Shelf SLOPE compensation ───────────────────────────────────────────────
// A third law, and the only one that is not a simple multiplier — which is why
// it lived in fiioUsbHidHandler.js until now. It is configured the same way as
// the others so no handler carries device-specific arithmetic:
//
//   shelfCompensation: { model: 'peakingAlpha' }
//   compensateShelfQForGain: true            // legacy, same thing
//   (absent)                                 // no compensation
//
// Some devices compute a shelf using the PEAKING alpha,
//     alpha_peak  = sin(w0)/(2Q)
// where a proper RBJ shelf needs
//     alpha_shelf = sin(w0)/2 * sqrt((A + 1/A)(1/S - 1) + 2)
// Equating the two gives the slope such a device actually realises:
//
//     S_realised = 1 / (1 + (1/Q^2 - 2)/(A + 1/A))
//
// Measured on a FiiO QX13: at Q=1, 6dB it predicts S=1.8925 and four
// independent measurements gave 1.885-1.897. All four sit at the same operating
// point, so the gain and Q dependence remains a prediction rather than a
// measurement — hence its own switch, separate from the peaking Q law.
export function resolveShelfCompensation(modelConfig, { ignoreGlobalSwitch = false } = {}) {
  if (!compensationEnabled && !ignoreGlobalSwitch) return null;
  const spec = modelConfig?.shelfCompensation;
  if (spec && typeof spec === 'object') {
    if (spec.model === 'peakingAlpha') return { model: 'peakingAlpha' };
    console.warn(
      `USB Device PEQ: unknown shelfCompensation model ${JSON.stringify(spec.model)} — ` +
      `compensation disabled. Known models: 'peakingAlpha'.`);
    return null;
  }
  if (modelConfig?.compensateShelfQForGain) return { model: 'peakingAlpha', legacy: 'compensateShelfQForGain' };
  return null;
}

export function shelfCompensationActive(filterType, modelConfig) {
  return !!resolveShelfCompensation(modelConfig) && SHELF_TYPES.has((filterType || '').toUpperCase());
}

// Q to send so the device's shelf realises the requested slope. Returns null
// when the target slope is unreachable at all (steep shelves drive the radicand
// negative), so the caller can fall back rather than emit a NaN.
export function shelfQToSend(sTarget, gainDb) {
  const A = rbjA(gainDb);
  const radicand = (A + 1 / A) * (1 / sTarget - 1) + 2;
  if (!(radicand > 0)) return null;
  return 1 / Math.sqrt(radicand);
}

export function shelfSRealised(qStored, gainDb) {
  const A = rbjA(gainDb);
  const denom = 1 + (1 / (qStored * qStored) - 2) / (A + 1 / A);
  if (!(denom > 0)) return null;
  return 1 / denom;
}

// ── Reporting ──────────────────────────────────────────────────────────────
// Every correction a device is having applied to it, in a form that can be put
// in front of a user. This matters most during measurement: a compensated run
// is measuring the handler AND the device together, so a result is
// uninterpretable unless you know what was being corrected while it ran.
//
// Reads the config only — no device I/O — so it is safe to call from UI code.
export function describeActiveCompensations(modelConfig, { ignoreGlobalSwitch = false } = {}) {
  const opts = { ignoreGlobalSwitch };
  const out = [];
  if (!modelConfig) return out;

  const q = resolveQCompensation(modelConfig, opts);
  if (q) {
    out.push(q.model === 'constant'
      ? { key: 'q', label: 'Q scaling',
          detail: `constant ${q.ratio} realised/requested — Q sent is divided by ${q.ratio}` }
      : { key: 'q', label: 'Q vs gain',
          detail: 'RBJ gain law: realised Q = requested / 10^(|gain|/40), corrected on write' });
  }

  const sh = resolveShelfCompensation(modelConfig, opts);
  if (sh) {
    out.push({ key: 'shelf', label: 'Shelf slope',
      detail: `device reuses the peaking alpha for shelves${sh.legacy ? ` (${sh.legacy})` : ''}; Q is transformed to hit the requested slope` });
  }

  const f = resolveFreqCompensation(modelConfig, opts);
  if (f) {
    out.push(f.model === 'shelfSqrtA'
      ? { key: 'freq', label: 'Shelf corner frequency',
          detail: `device places shelf corners a factor of sqrt(A) away (A = 10^(|gain|/40)), prewarped at ${f.fs} Hz — corrected on write for LSQ/HSQ only` }
      : { key: 'freq', label: 'Centre frequency',
          detail: `${f.factor}x realised/requested${f.legacy ? ` (${f.legacy})` : ''} — frequency sent is divided by ${f.factor}` });
  }

  const bw = Number(modelConfig.bandwidthValue);
  if ((compensationEnabled || ignoreGlobalSwitch) && Number.isFinite(bw) && bw !== 0) {
    out.push({ key: 'bandwidth', label: 'Bandwidth field',
      detail: `writing ${bw} instead of 0 alongside Q` });
  }

  return out;
}

// What this device WOULD correct, regardless of the runtime switch. Used to
// report "compensation is available but off" rather than "nothing to correct",
// which are very different statements about a measurement.
export function describeConfiguredCompensations(modelConfig) {
  return describeActiveCompensations(modelConfig, { ignoreGlobalSwitch: true });
}
