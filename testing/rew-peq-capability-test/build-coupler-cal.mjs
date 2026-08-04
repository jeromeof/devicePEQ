#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Build a coupler calibration curve from two REW measurements.
//
//   cal(f) = reference(f) - subject(f)      [dB]
//
// Add cal to a measurement made on the SUBJECT coupler and it reads like the
// REFERENCE one. For a clone-vs-genuine 711 that means: measure on the clone,
// load this as the mic/meter cal file, get genuine-711 numbers out.
//
// Sign convention is the thing to get right and the easy thing to get wrong.
// REW ADDS a cal file to the measured response. So the file has to contain
// "what the subject is MISSING relative to the reference" — reference minus
// subject. If the clone reads 3 dB hot at 8 kHz, cal is -3 dB there, which
// pulls it back down. Get it backwards and you double the error instead of
// removing it; the self-check at the end of this script is what catches that.
//
// Usage:
//   node build-coupler-cal.mjs --subject 11 --reference 12 [options]
//
//   --subject <id>     measurement to be corrected      (e.g. Fake Average)
//   --reference <id>   measurement to match             (e.g. Original Average)
//   --subject-runs <ids>    comma-separated run ids to average ourselves
//   --reference-runs <ids>  instead of using a pre-made average measurement
//
// Prefer the --*-runs form. REW's averaged traces do not record which runs went
// into them, and the two sides of a comparison are easy to build from different
// numbers of runs without noticing — verified on a real pair here, where the
// subject average held 5 runs and the reference average held 4, silently. Naming
// the runs on the command line makes the composition part of the command, so it
// ends up in the cal file header and in your shell history.
//
// The averaging is a power (RMS magnitude) average, matching REW's own:
//   dB_avg = 10*log10( mean( 10^(dB_i/10) ) )
// Reproduced against REW's output to 0.00002 dB, so switching to this form does
// not change the result — only who controls which runs are in it.
//   --out <path>       output cal file  (default ./coupler-cal.txt)
//   --smoothing <s>    REW smoothing to request: None, 1/48, 1/24, 1/12, 1/6, 1/3
//                      (default 1/12 — see note below)
//   --min <Hz>         lowest frequency to emit          (default 20)
//   --max <Hz>         highest frequency to emit         (default 20000)
//   --ppo <n>          points per octave in the output   (default 48)
//   --anchor <Hz>      normalise cal to 0 dB here; omit to keep absolute offset
//   --host <url>       REW API base (default http://127.0.0.1:4735)
//
// Smoothing default: the raw curves are ~0.37 Hz linear steps, which at 20 Hz is
// far finer than any coupler difference is real. Differencing two unsmoothed
// curves multiplies the noise of both, and every ripple it invents gets baked
// into the cal and applied to every future measurement. 1/12 octave keeps real
// coupler features (which are broad — leak, volume, tube length) and drops the
// rest. Use --smoothing None only if you want to see what you are throwing away.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const SUBJECT = arg('subject');
const REFERENCE = arg('reference');
const SUBJECT_RUNS = arg('subject-runs');
const REFERENCE_RUNS = arg('reference-runs');
const OUT = arg('out', './coupler-cal.txt');
const SMOOTHING = arg('smoothing', '1/12');
const MIN = Number(arg('min', 20));
const MAX = Number(arg('max', 20000));
const PPO = Number(arg('ppo', 48));
const ANCHOR = arg('anchor') ? Number(arg('anchor')) : null;
const HOST = arg('host', 'http://127.0.0.1:4735');

if (!(SUBJECT || SUBJECT_RUNS) || !(REFERENCE || REFERENCE_RUNS)) {
  console.error('Need --subject <id> or --subject-runs <ids>, and the same for --reference.');
  console.error('Read the header of this file for the full option list.');
  process.exit(1);
}

async function rewGet(path) {
  const res = await fetch(`${HOST}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// REW ships magnitudes as base64 big-endian float32. Same decode as
// rew-client.mjs; duplicated rather than imported so this file can be lifted
// out and run anywhere.
function decodeFloatsBE(b64) {
  const raw = Buffer.from(b64, 'base64');
  const out = new Float32Array(raw.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = raw.readFloatBE(i * 4);
  return out;
}

async function getFr(id) {
  const meta = await rewGet(`/measurements/${id}`);
  const fr = await rewGet(`/measurements/${id}/frequency-response?smoothing=${encodeURIComponent(SMOOTHING)}`);
  // REW returns ONE OF TWO axis descriptions and you have to branch on which:
  //   freqStep → linear axis, freq[i] = startFreq + i*freqStep
  //   ppo      → logarithmic axis, freq[i] = startFreq * 2^(i/ppo)
  // Which one you get is not a property of the request. Asking a plain
  // measurement for 1/12 smoothing returns a log axis with ppo:96; asking one
  // of REW's *averaged* traces for the same thing returns the linear axis. Both
  // echo back "smoothing":"1/12", so the echo tells you nothing. Reading
  // freqStep unconditionally yields NaN for every point of a log-axis response
  // — silently, since NaN propagates through the arithmetic and only shows up
  // as a blank column much later.
  if (fr.freqStep == null && fr.ppo == null) {
    throw new Error(`#${id}: response has neither freqStep nor ppo — cannot place its points on a frequency axis`);
  }
  return {
    id,
    title: meta.title ?? `#${id}`,
    startFreq: fr.startFreq,
    freqStep: fr.freqStep ?? null,
    ppo: fr.ppo ?? null,
    mag: decodeFloatsBE(fr.magnitude),
    unit: fr.unit,
    smoothing: fr.smoothing,
    axis: fr.freqStep != null ? 'linear' : `log (${fr.ppo} ppo)`,
  };
}

// Average several runs ourselves, so the composition of each side is explicit.
//
// Requests smoothing=None deliberately: an individual measurement asked for
// fractional-octave smoothing comes back re-binned onto a LOG axis, while
// averaged traces come back linear, and averaging across that mix silently
// produces nonsense. Fetching unsmoothed puts every run on the same linear grid;
// SMOOTHING is then applied here, identically to all of them.
async function averageRuns(idsCsv, label) {
  const ids = idsCsv.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (ids.length < 2) throw new Error(`${label}: need at least 2 run ids, got "${idsCsv}"`);
  const runs = [];
  for (const id of ids) {
    const meta = await rewGet(`/measurements/${id}`);
    const fr = await rewGet(`/measurements/${id}/frequency-response?smoothing=None`);
    if (fr.freqStep == null) throw new Error(`#${id}: expected a linear axis from smoothing=None`);
    runs.push({ id, title: meta.title, snr: meta.signalToNoisedB, startFreq: fr.startFreq,
                freqStep: fr.freqStep, mag: decodeFloatsBE(fr.magnitude) });
  }
  const g = runs[0];
  for (const r of runs) {
    if (Math.abs(r.freqStep - g.freqStep) > 1e-9 || Math.abs(r.startFreq - g.startFreq) > 1e-9) {
      throw new Error(`#${r.id} is on a different frequency grid than #${g.id} — different FFT length or sample rate`);
    }
  }
  const n = Math.min(...runs.map((r) => r.mag.length));
  const avg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const r of runs) s += Math.pow(10, r.mag[i] / 10);
    avg[i] = 10 * Math.log10(s / runs.length);
  }
  // A run 15+ dB down on its siblings is usually a bad seal or a bumped rig, and
  // it pulls the average it lands in. Worth saying out loud rather than leaving
  // to be discovered in the cal curve.
  const snrs = runs.map((r) => r.snr).filter((v) => Number.isFinite(v));
  if (snrs.length) {
    const best = Math.max(...snrs);
    for (const r of runs) {
      if (Number.isFinite(r.snr) && best - r.snr > 10) {
        console.warn(`  ⚠ #${r.id} "${r.title}" SNR ${r.snr.toFixed(1)} dB is ${(best - r.snr).toFixed(1)} dB below the best run in this group`);
      }
    }
  }
  // Name the group after what the runs are actually called, so the cal file
  // header says "L Fake 711" rather than "subject". A file that does not say
  // which coupler it corrects is unusable six months from now.
  // Collapse internal runs of whitespace before comparing: "L Fake 711" and
  // "L Fake  711" are one coupler typed twice, not two couplers, and treating
  // them as different would put a spurious warning on every honest run.
  const titles = [...new Set(runs.map((r) => (r.title || '').trim().replace(/\s+/g, ' ')).filter(Boolean))];
  const derived = titles.length === 1 ? titles[0]
                : titles.length ? `${titles[0]} (+${titles.length - 1} other title${titles.length > 2 ? 's' : ''})`
                : label;
  if (titles.length > 1) {
    console.warn(`  ⚠ ${label}: runs do not share one title — ${titles.map((s) => `"${s}"`).join(', ')}`);
  }
  return { id: ids.join('+'), title: derived, startFreq: g.startFreq, freqStep: g.freqStep,
           ppo: null, mag: avg, unit: 'SPL', smoothing: `None, averaged then ${SMOOTHING} on read`,
           axis: 'linear', composition: ids, runs };
}

// Fractional-octave power average, applied on the linear grid. Only used for the
// self-averaged path, where the runs were deliberately fetched unsmoothed.
function smoothInPlace(fr, fraction) {
  if (!fraction) return fr;
  const out = new Float64Array(fr.mag.length);
  for (let i = 0; i < fr.mag.length; i++) {
    const f = fr.startFreq + i * fr.freqStep;
    const lo = f * Math.pow(2, -fraction / 2), hi = f * Math.pow(2, fraction / 2);
    let i0 = Math.max(0, Math.ceil((lo - fr.startFreq) / fr.freqStep));
    let i1 = Math.min(fr.mag.length - 1, Math.floor((hi - fr.startFreq) / fr.freqStep));
    if (i1 < i0) { out[i] = fr.mag[i]; continue; }
    let s = 0;
    for (let k = i0; k <= i1; k++) s += Math.pow(10, fr.mag[k] / 10);
    out[i] = 10 * Math.log10(s / (i1 - i0 + 1));
  }
  return { ...fr, mag: out };
}

function smoothingFraction(s) {
  const m = /^1\/(\d+)$/.exec(String(s).trim());
  return m ? 1 / Number(m[1]) : null;
}

// Fractional bin index of a frequency, on whichever axis this response uses.
function binIndex(fr, f) {
  return fr.freqStep != null
    ? (f - fr.startFreq) / fr.freqStep
    : Math.log2(f / fr.startFreq) * fr.ppo;
}

// Interpolate between the two bracketing bins. Clamps at both ends rather than
// extrapolating: past 20 kHz there is no data to justify a trend, and inventing
// one here would put fabricated numbers into a cal file.
function magAt(fr, f) {
  const x = binIndex(fr, f);
  if (!Number.isFinite(x)) return NaN;
  if (x <= 0) return fr.mag[0];
  if (x >= fr.mag.length - 1) return fr.mag[fr.mag.length - 1];
  const i = Math.floor(x);
  const frac = x - i;
  return fr.mag[i] * (1 - frac) + fr.mag[i + 1] * frac;
}

// Log-spaced grid that stops AT max rather than stepping past it. The overshoot
// matters here: magAt() clamps beyond the measured range, so an out-of-range
// point would silently repeat the last real value while looking like data — a
// cal file implying a correction at 20186 Hz when the sweep ended at 19999.9.
function logSpaced(min, max, ppo) {
  const out = [];
  for (let i = 0; ; i++) {
    const f = min * Math.pow(2, i / ppo);
    if (f > max) break;
    out.push(f);
  }
  if (out[out.length - 1] < max) out.push(max);
  return out;
}

const main = async () => {
  const ver = await rewGet('/version');
  console.log(`REW: ${ver.message}`);

  const frac = smoothingFraction(SMOOTHING);
  let subject, reference;
  if (SUBJECT_RUNS) {
    console.log(`averaging subject from runs ${SUBJECT_RUNS}:`);
    subject = smoothInPlace(await averageRuns(SUBJECT_RUNS, 'subject (self-averaged)'), frac);
  } else {
    subject = await getFr(SUBJECT);
  }
  if (REFERENCE_RUNS) {
    console.log(`averaging reference from runs ${REFERENCE_RUNS}:`);
    reference = smoothInPlace(await averageRuns(REFERENCE_RUNS, 'reference (self-averaged)'), frac);
  } else {
    reference = await getFr(REFERENCE);
  }
  // Comparing a 5-run average against a 4-run one is not wrong, but it is rarely
  // what someone intends, and REW's own averaged traces give you no way to see it.
  if (subject.composition && reference.composition &&
      subject.composition.length !== reference.composition.length) {
    console.warn(`\n⚠ Asymmetric: ${subject.composition.length} subject runs vs ${reference.composition.length} reference runs.`);
  }

  console.log(`subject   #${subject.id}  "${subject.title}"  (${subject.unit}, smoothing ${subject.smoothing}, axis ${subject.axis})`);
  console.log(`reference #${reference.id}  "${reference.title}"  (${reference.unit}, smoothing ${reference.smoothing}, axis ${reference.axis})`);
  if (subject.unit !== reference.unit) {
    console.error(`\n✗ Unit mismatch: ${subject.unit} vs ${reference.unit}. Differencing these is meaningless.`);
    process.exit(1);
  }
  // Not an error — the interpolation handles a mixed pair — but if one side is
  // smoothed and the other is not, part of what lands in the cal file is the
  // smoothing difference rather than the coupler difference.
  if (subject.smoothing !== reference.smoothing || (subject.freqStep == null) !== (reference.freqStep == null)) {
    console.warn(`\n⚠ These two responses are not on comparable footing:`);
    console.warn(`    ${subject.title}: ${subject.smoothing}, ${subject.axis}`);
    console.warn(`    ${reference.title}: ${reference.smoothing}, ${reference.axis}`);
    console.warn(`  Some of the resulting cal will be that difference, not the couplers'.`);
  }

  const freqs = logSpaced(MIN, MAX, PPO);
  let cal = freqs.map((f) => reference2(f));
  function reference2(f) { return magAt(reference, f) - magAt(subject, f); }

  // Optional normalisation. A cal file with a big constant offset works, but it
  // silently rescales absolute SPL, which is confusing if you only wanted the
  // SHAPE corrected. Anchoring subtracts the value at one frequency so the cal
  // is 0 dB there and purely relative.
  let anchorOffset = 0;
  if (ANCHOR != null) {
    anchorOffset = reference2(ANCHOR);
    cal = cal.map((v) => v - anchorOffset);
    console.log(`anchored to 0 dB at ${ANCHOR} Hz (removed ${anchorOffset.toFixed(2)} dB constant offset)`);
  }

  // ── What does this correction actually look like? ────────────────────────
  const stats = (() => {
    let min = Infinity, max = -Infinity, minF = 0, maxF = 0, sum = 0;
    cal.forEach((v, i) => {
      if (v < min) { min = v; minF = freqs[i]; }
      if (v > max) { max = v; maxF = freqs[i]; }
      sum += v;
    });
    return { min, minF, max, maxF, mean: sum / cal.length };
  })();

  console.log(`\nCalibration = "${reference.title}" − "${subject.title}"`);
  console.log(`  range   ${stats.min.toFixed(2)} dB @ ${stats.minF.toFixed(0)} Hz  …  ${stats.max.toFixed(2)} dB @ ${stats.maxF.toFixed(0)} Hz`);
  console.log(`  mean    ${stats.mean.toFixed(2)} dB`);
  console.log(`  span    ${(stats.max - stats.min).toFixed(2)} dB peak-to-peak`);

  console.log('\n  octave-band summary of the correction:');
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 3000, 5000, 8000, 10000, 12000, 16000, 20000]) {
    if (f < MIN || f > MAX) continue;
    const v = reference2(f) - anchorOffset;
    const bar = '█'.repeat(Math.min(30, Math.round(Math.abs(v) * 3)));
    console.log(`    ${String(f).padStart(6)} Hz  ${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2).padStart(5)} dB  ${bar}`);
  }

  // ── Self-check: does applying this actually converge? ────────────────────
  // subject + cal should equal reference. If the sign is inverted this comes
  // out at twice the original error instead of ~zero, which is the single most
  // likely way to get this wrong.
  let errBefore = 0, errAfter = 0;
  for (const f of freqs) {
    const before = magAt(subject, f) - magAt(reference, f);
    const after = (magAt(subject, f) + (reference2(f) - anchorOffset)) - magAt(reference, f);
    errBefore += before * before;
    errAfter += after * after;
  }
  const rmsBefore = Math.sqrt(errBefore / freqs.length);
  const rmsAfter = Math.sqrt(errAfter / freqs.length);
  console.log(`\n  self-check: RMS difference vs reference`);
  console.log(`    before cal  ${rmsBefore.toFixed(3)} dB`);
  console.log(`    after cal   ${rmsAfter.toFixed(3)} dB${ANCHOR != null ? '  (residual = the anchor offset you asked to keep)' : ''}`);
  if (rmsAfter > rmsBefore) {
    console.error('\n  ✗ Applying the cal made it WORSE — the sign is inverted. Do not use this file.');
    process.exit(1);
  }
  console.log('  ✓ sign is correct — adding this cal moves subject onto reference');

  // ── Write the file ──────────────────────────────────────────────────────
  // REW cal file format: comment lines start with *, then "freq dB" pairs,
  // whitespace separated, ascending frequency. Phase is a valid optional third
  // column; omitted here because a magnitude-only coupler difference is all
  // these two averages support.
  const header = [
    `* Coupler calibration generated from REW measurements`,
    `* subject   : #${subject.id} "${subject.title}"  (this is what gets corrected)`,
    subject.composition ? `*   built from runs: ${subject.composition.join(', ')}` : null,
    `* reference : #${reference.id} "${reference.title}"  (this is what it will read like)`,
    reference.composition ? `*   built from runs: ${reference.composition.join(', ')}` : null,
    `* cal = reference - subject, so REW ADDS this to a subject measurement`,
    `* smoothing : ${SMOOTHING}   points/octave: ${PPO}   range: ${MIN}-${MAX} Hz`,
    ANCHOR != null ? `* anchored to 0 dB at ${ANCHOR} Hz` : `* absolute offset retained (mean ${stats.mean.toFixed(2)} dB)`,
    `* REW version: ${ver.message}`,
  ].filter(Boolean).join('\n');

  const body = freqs.map((f, i) => `${f.toFixed(4)} ${cal[i].toFixed(4)}`).join('\n');
  const fsp = await import('node:fs/promises');
  await fsp.writeFile(OUT, `${header}\n${body}\n`, 'utf8');
  console.log(`\nWrote ${freqs.length} points to ${OUT}`);
  console.log(`\nTo use it: REW → Preferences → Cal files → load as the mic/meter cal`);
  console.log(`for measurements taken on "${subject.title}"'s coupler.`);
};

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
