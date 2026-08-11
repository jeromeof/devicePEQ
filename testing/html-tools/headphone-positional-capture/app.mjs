// Headphone positional capture — application wiring.
//
// Layout of this file:
//   1. Bootstrap        loading the capture backend and shared helpers
//   2. State            everything mutable, in one place
//   3. Preferences      persistence, restore, collapsible panels, summaries
//   4. Audio route      permissions, device enumeration
//   5. Calibration      input calibration file and whether it is remembered
//   6. Target & shaping normalisation, tilt, preference bounds
//   7. Chart model      turning state into something the chart can draw
//   8. Workflow         the five positions, step boxes, capture
//   9. Export           JPG / REW / project JSON
//  10. Wiring           event handlers and start-up
//
// Rendering lives in chart.mjs; everything reusable lives in ../common/audio/.

import { $, value, number, checked, setStatus, setHtml, on } from '../common/audio/dom.mjs';
import { createChart } from './chart.mjs';
import { POSITION_DEFS, STORAGE_KEY } from './positions.mjs';
import * as targets from '../common/audio/target-catalogue.mjs';
import { createZip } from '../common/audio/zip.mjs';
import { FULL_RANGE_OCTAVES, formatHz } from '../common/audio/axis.mjs';
import { ALIGN_BAND, tiltDbAt, targetDbAt, levelMatchOffset, centreEnvelope } from '../common/audio/target-shaping.mjs';
import { parseFrequencyPairs, interpolateLog, applyCalibration, peakDifference } from '../common/audio/frequency-response.mjs';
import { exportRewMeasurement } from '../common/audio/rew.mjs';
import { downloadText, downloadBlob } from '../common/audio/files.mjs';
import { createPreferenceStore } from '../common/audio/storage.mjs';
import { microphonePermissionState, fillDeviceSelect, createRouteMemory, describeSuggestion } from '../common/audio/audio-route.mjs';

// ─────────────────────────────────────────────────────────── 1. Bootstrap

const PATH_DEFAULTS = { devicePEQBase: '../../../devicePEQ/' };
let paths = PATH_DEFAULTS;
try {
  const r = await fetch('./config.json', { cache: 'no-store' });
  if (r.ok) paths = { ...PATH_DEFAULTS, ...(await r.json()) };
} catch { /* config.json is optional */ }

const captureBase = paths.devicePEQBase.endsWith('/') ? paths.devicePEQBase : `${paths.devicePEQBase}/`;
// Resolved against the page, not this module, so the config path stays page-relative.
const { BuiltinCaptureBackend, enumerateAudioDevices, suggestAudioRouting, smoothResponse, averageResponses } =
  await import(new URL(`${captureBase}builtin-capture/index.mjs`, document.baseURI).href);

const preferences = createPreferenceStore(STORAGE_KEY);

// ─────────────────────────────────────────────────────────────── 2. State

const prefs = preferences.read();
const panels = { ...(prefs.panels || {}) };

const measurements = new Map();   // position id -> response (offsets only)
const center = [];                // repeated centre captures, averaged for display

let devices = { inputs: [], outputs: [] };
let micPermission = 'unknown';
let calibration = null;
let target = null, targetName = '';
let builtinTargets = [], boundsConfig = null, prefBounds = null;
let currentPosition = 'center', pendingCenterReset = false, busy = false, storageBroken = false;

const backend = new BuiltinCaptureBackend({ status: (text) => { $('captureStatus').textContent = text; } });
const chart = createChart({ canvas: $('chart'), getModel: buildChartModel, onViewChange: updateViewControls });

const positionDef = (id) => POSITION_DEFS.find((p) => p.id === id);
const centerRepeats = () => number('centerRepeats', 2);
const activeCenter = () => (center.length ? averageResponses(center) : null);

/** Every captured position in draw order, centre first. */
function allCurves() {
  const list = [];
  if (activeCenter()) list.push({ def: POSITION_DEFS[0], response: activeCenter() });
  for (const def of POSITION_DEFS.slice(1)) if (measurements.has(def.id)) list.push({ def, response: measurements.get(def.id) });
  return list;
}

// ───────────────────────────────────────────────────────── 3. Preferences

/** Controls whose value is restored verbatim on the next visit. */
const PERSISTED_CONTROLS = [
  'startHz', 'endHz', 'durationSec', 'warmupMs', 'tailSec', 'noiseFloorSec', 'outputLevelDb',
  'centerRepeats', 'inputChannel', 'smoothing', 'viewMode', 'targetPreset', 'boundDb', 'boundsMode',
  'targetTilt', 'tiltPreset', 'normMode',
];

function persist() {
  // Only once devices exist: before scanning the selects hold a placeholder, not an id.
  if (routeReady()) routeMemory.write({ inputId: value('inputDevice'), outputId: value('outputDevice') });
  prefs.configured = true;
  const controls = Object.fromEntries(PERSISTED_CONTROLS.map((id) => [id, value(id)]));
  const writeResult = preferences.write({
    ...prefs, ...controls,
    configured: true,
    panels,
    inputId: value('inputDevice'),
    outputId: value('outputDevice'),
    timingReference: checked('timingReference'),
    rememberCal: keepCalibration(),
    // Honouring the checkbox here is what makes unticking it genuinely forget.
    calibrationName: keepCalibration() ? (prefs.calibrationName || '') : '',
    calibrationText: keepCalibration() ? (prefs.calibrationText || '') : '',
    customTargetName: prefs.customTargetName || '',
    customTargetText: prefs.customTargetText || '',
  });
  reportStorage(writeResult);
  updateSummaries();
}

/**
 * Everything above is pointless if the browser refused the write, so say so
 * loudly rather than letting a remembered file quietly vanish on reload.
 */
function reportStorage(result) {
  const warning = $('storageWarning');
  // A cached older build of the storage module returns undefined here; treat
  // that as "no news" rather than crashing the save path.
  if (!result || result.ok) {
    if (!storageBroken) { warning.style.display = 'none'; }
    return;
  }
  storageBroken = true;
  warning.style.display = '';
  warning.className = 'hint';
  warning.style.borderLeftColor = '#f07178';
  warning.textContent = `Settings could not be saved in this browser (${result.error?.name || 'storage error'}: ${result.error?.message || 'unknown'}). `
    + 'Calibration, targets and capture options will be lost when the page reloads. '
    + (location.protocol === 'file:'
      ? 'This page is open from a file:// path — serve it over http://localhost instead, which is also required for the microphone permission to stick.'
      : 'Private browsing or a full storage quota are the usual causes.');
}

function restore() {
  for (const id of PERSISTED_CONTROLS) if (prefs[id] != null) $(id).value = prefs[id];
  if (prefs.timingReference != null) $('timingReference').checked = prefs.timingReference;
  if (prefs.rememberCal != null) $('rememberCal').checked = prefs.rememberCal;
  if (prefs.boundsMode == null && prefs.showBounds === false) $('boundsMode').value = 'none';
  if (prefs.calibrationText) {
    try { calibration = parseFrequencyPairs(prefs.calibrationText); reportCalibration(); } catch { /* stored file unreadable */ }
  }
  if (prefs.targetPreset && prefs.targetPreset !== 'none') loadPresetTarget(prefs.targetPreset);
  syncTiltControls(false);
}

/**
 * Returning users have working defaults, so the detail panels start folded away.
 * An explicit open/close is recorded on click (never from the toggle event, which
 * also fires for the state we apply here) and wins from then on.
 */
function applyPanelState() {
  const configured = prefs.configured === true;
  for (const id of ['captureCard', 'calCard']) $(id).open = panels[id] != null ? panels[id] : !configured;
  $('routeCard').open = panels.routeCard != null ? panels.routeCard : !routeReady();
  updateSummaries();
}

/** One-line digests shown on the collapsed panel headers. */
function updateSummaries() {
  const smooth = value('smoothing') === '0' ? 'raw bins' : `1/${Number(value('smoothing'))} oct`;
  const cal = calibration ? (prefs.calibrationName || 'calibration loaded') : 'no calibration';
  $('captureSummary').textContent = [
    `${number('startHz', 20)}–${number('endHz', 20000)} Hz`,
    `${number('durationSec', 6)} s sweep`,
    `${number('outputLevelDb', -12)} dBFS`,
    smooth,
    `${value('inputChannel')} channel`,
    `${value('centerRepeats')}× center`,
    cal,
  ].join(' · ');

  const tgt = targetName || (value('targetPreset') === 'none' ? 'no target' : $('targetPreset').selectedOptions[0]?.textContent) || 'no target';
  $('calSummary').textContent = [
    `norm ${normLabel()}`,
    `${tgt}${tilt() ? ` ${tilt()} dB/oct` : ''}`,
    boundsSummary(),
    { raw: 'absolute view', slope: 'deviation, slope shown', target: 'deviation, flattened' }[value('viewMode')],
  ].join(' · ');

  updateBoundsHint();
  updateTiltHint();
}

// ──────────────────────────────────────────────────────────── 4. Audio route

const routeMemory = createRouteMemory('devicepeq-headphone');
const routeReady = () => micPermission === 'granted' && devices.inputs.length > 0;

/** Populate silently when access was already granted; only a first visit needs the button. */
async function autoScanIfPermitted() {
  micPermission = await microphonePermissionState();
  if (micPermission !== 'granted') {
    setStatus('routeStatus', 'Grant microphone access once and this step stays collapsed on future visits.');
    return;
  }
  await scanDevices();
}

async function scanDevices() {
  setStatus('routeStatus', 'Requesting microphone permission and scanning…');
  try {
    devices = await enumerateAudioDevices();
    micPermission = await microphonePermissionState();
    renderDevices();
    if (devices.permissionError) setStatus('routeStatus', `Permission warning: ${devices.permissionError.message}; labels may be limited.`, true);
  } catch (e) {
    setStatus('routeStatus', e.message, true);
  }
}

function renderDevices() {
  const remembered = routeMemory.read();
  fillDeviceSelect($('inputDevice'), devices.inputs, remembered.inputId || prefs.inputId);
  fillDeviceSelect($('outputDevice'), devices.outputs, remembered.outputId || prefs.outputId);

  const suggestion = suggestAudioRouting({ devices });
  if (!value('inputDevice')) $('inputDevice').value = suggestion.inputId;
  if (!value('outputDevice')) $('outputDevice').value = suggestion.outputId;

  setStatus('routeStatus', `${devices.inputs.length} input(s), ${devices.outputs.length} output(s) found.`);
  $('routeHint').textContent = `Automatic suggestion — ${describeSuggestion(suggestion)}. Your selections are remembered after you change them.`;
  updateRouteSummary();
  updateCaptureButton();
}

function updateRouteSummary() {
  const name = (id) => $(id).selectedOptions[0]?.textContent || 'not selected';
  $('routeSummary').textContent = routeReady() ? `in: ${name('inputDevice')} · out: ${name('outputDevice')}` : 'microphone access not granted yet';
  $('scanBtn').textContent = routeReady() ? '🔄 Re-scan devices' : '🎙️ Request permission & scan';
}

// ──────────────────────────────────────────────────────────── 5. Calibration

const keepCalibration = () => checked('rememberCal');

/** One place decides what is stored *and* what the user is told, so they cannot disagree. */
function reportCalibration() {
  if (!calibration) return setStatus('calStatus', 'No calibration loaded');
  const name = prefs.calibrationName || 'calibration file';
  const state = keepCalibration() ? 'remembered on this browser' : 'not remembered — tick the box to keep it';
  setStatus('calStatus', `${name} (${calibration.length} points) — ${state}`);
}

async function loadCalibration(file) {
  try {
    const text = await file.text();
    calibration = parseFrequencyPairs(text);
    prefs.calibrationText = text;
    prefs.calibrationName = file.name;
    persist();
    reportCalibration();
    chart.render();
  } catch (e) {
    setStatus('calStatus', e.message, true);
  }
}

// ─────────────────────────────────────────────────── 6. Target and shaping

// CrinGraph normalises at a single frequency (1 kHz default, 500 Hz per IEC). The
// same point anchors the target level match and the tilt hinge, so the two can
// never disagree; band mode hinges on the band's geometric mean.
const normIsBand = () => value('normMode') === 'band';
const normFreqHz = () => (normIsBand() ? Math.sqrt(ALIGN_BAND.lo * ALIGN_BAND.hi) : Number(value('normMode')) || 1000);
function normLabel() {
  const f = normFreqHz();
  if (normIsBand()) return `${ALIGN_BAND.lo} Hz–${ALIGN_BAND.hi / 1000} kHz average`;
  return f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`;
}

const tilt = () => number('targetTilt', 0);
// Two readings of the same target: the published curve, and the same curve with
// the user's tilt applied. Which one the graph compensates against decides
// whether the tilt shows up as a slope or is flattened away.
const baseTargetAt = (f) => targetDbAt(target, f, 0, normFreqHz());
const targetAt = (f) => targetDbAt(target, f, tilt(), normFreqHz());
const selectedTargetEntry = () => builtinTargets.find((t) => t.id === value('targetPreset')) || null;

function syncTiltControls(fromPreset) {
  if (fromPreset && value('tiltPreset') !== 'custom') $('targetTilt').value = value('tiltPreset');
  else if (!fromPreset) {
    const known = [...$('tiltPreset').options].some((o) => o.value === String(tilt()));
    $('tiltPreset').value = known ? String(tilt()) : 'custom';
  }
  $('targetTilt').disabled = value('tiltPreset') !== 'custom';
}

function updateTiltHint() {
  const t = tilt();
  const df = selectedTargetEntry()?.diffuseField;
  $('tiltHint').textContent = !t
    ? 'A downward tilt is the usual way to make a diffuse-field target read like a real listening curve.'
    : `${t} dB/oct (${(t * FULL_RANGE_OCTAVES).toFixed(1)} dB over 20 Hz–20 kHz), hinged at ${normLabel()}.`
      + (df ? '' : ' This target is not diffuse-field based, so a tilt may double-count shaping it already has.');
}

/** True for DF-based targets, and for an uploaded rig target whose basis we cannot know. */
function targetTakesPrefBounds() {
  const entry = selectedTargetEntry();
  return entry ? !!entry.diffuseField : value('targetPreset') === 'custom';
}

/**
 * The bounds are dB offsets over a diffuse field. Over a target that already
 * carries preference shaping they double-count, producing an envelope that does
 * not even contain its own target — so fall back to the flat window instead.
 */
function effectiveBoundsMode() {
  const mode = value('boundsMode');
  if (mode === 'pref' && (!prefBounds || !targetTakesPrefBounds())) return 'flat';
  if (mode === 'pref-centred' && !prefBounds) return 'flat';
  return mode;
}

function boundsDeltaAt(f) {
  const mode = effectiveBoundsMode();
  if (mode === 'none') return null;
  if (mode === 'flat') { const d = number('boundDb', 1.5); return { hi: d, lo: -d }; }
  const envelope = { hi: interpolateLog(prefBounds.upper, f), lo: interpolateLog(prefBounds.lower, f) };
  // Centred mode keeps the width but drops the published offset — a readability
  // choice, since that offset is itself the finding.
  return mode === 'pref-centred' ? centreEnvelope(envelope) : envelope;
}

const boundsVisible = () => !!target?.length && boundsDeltaAt(1000) !== null;

function boundsSummary() {
  const mode = effectiveBoundsMode();
  if (mode === 'pref') return 'preference bounds';
  if (mode === 'pref-centred') return 'preference bounds (centred)';
  return mode === 'flat' ? `±${number('boundDb', 1.5)} dB` : 'no bounds';
}

function updateBoundsHint() {
  const mode = value('boundsMode'), hint = $('boundsHint');
  $('boundDb').disabled = effectiveBoundsMode() !== 'flat';
  hint.style.display = mode === 'none' ? 'none' : '';
  if (mode === 'none') return;
  hint.className = 'hint';
  if (mode === 'flat') {
    hint.textContent = 'A fixed tolerance window around the target — useful for judging positional spread rather than listener preference.';
  } else if (mode === 'pref-centred') {
    hint.textContent = 'The preference envelope keeps its width but is re-centred on the target. Easier to read as a tolerance, but it discards the published offset — the real bounds sit above a diffuse field in the bass (+3 to +9 dB at 20 Hz) and below it in the treble.';
  } else if (!target?.length) {
    hint.textContent = 'Select a target curve to draw the preference envelope around it.';
  } else if (targetTakesPrefBounds()) {
    hint.className = 'hint good';
    hint.textContent = `Preference bounds are drawn as dB offsets over ${targetName}, the diffuse-field style target they are defined against — wide in the bass, narrowing through the mids, widening again in the treble.`;
  } else {
    hint.textContent = `Preference bounds are dB offsets over a diffuse field, and ${targetName || 'this target'} already carries its own preference shaping — applying them would put the envelope off the target entirely. Showing the ±${number('boundDb', 1.5)} dB window instead; pick a diffuse-field target to use the real bounds.`;
  }
}

async function loadTargetCatalogue() {
  ({ targets: builtinTargets, boundsConfig } = await targets.loadCatalogue());
  const options = [new Option('None', 'none'), ...builtinTargets.map((t) => new Option(t.label, t.id))];
  options.push(new Option(prefs.customTargetName ? `My rig — ${prefs.customTargetName}` : 'My own rig target (upload below)', 'custom'));
  $('targetPreset').replaceChildren(...options);
}

async function ensurePrefBounds() {
  if (prefBounds || !boundsConfig) return;
  try { prefBounds = await targets.loadPrefBounds(boundsConfig); }
  catch (e) { prefBounds = null; setStatus('targetStatus', `Preference bounds unavailable: ${e.message}`, true); }
}

function useTarget(points, name, status) {
  target = points;
  targetName = name;
  setStatus('targetStatus', status);
  chart.render();
  updateSummaries();
}

async function loadPresetTarget(kind) {
  if (kind === 'none') return useTarget(null, '', 'No target loaded');
  if (kind === 'custom') {
    if (!prefs.customTargetText) return setStatus('targetStatus', 'Upload a target file for your rig below.', true);
    try {
      const points = parseFrequencyPairs(prefs.customTargetText);
      return useTarget(points, prefs.customTargetName || 'my rig target', `${prefs.customTargetName || 'Remembered target'} (${points.length} points)`);
    } catch (e) { return setStatus('targetStatus', e.message, true); }
  }
  const entry = builtinTargets.find((t) => t.id === kind);
  if (!entry) return setStatus('targetStatus', `Unknown target "${kind}".`, true);
  try {
    const points = await targets.loadTargetPoints(entry);
    useTarget(points, entry.label, `${entry.label} loaded (${points.length} points)`);
  } catch (e) {
    setStatus('targetStatus', `Could not load ${entry.file}: ${e.message}`, true);
  }
}

async function loadTargetFile(file) {
  try {
    const text = await file.text();
    const points = parseFrequencyPairs(text);
    prefs.customTargetText = text;
    prefs.customTargetName = file.name;
    await loadTargetCatalogue();
    $('targetPreset').value = 'custom';
    useTarget(points, file.name, `${file.name} loaded (${points.length} points) and remembered for next time`);
    persist();
  } catch (e) {
    setStatus('targetStatus', e.message, true);
  }
}

// ─────────────────────────────────────────────────────────── 7. Chart model

/** Captured dB minus the tilted, level-matched target — the compensated view. */
function compensate(response, referenceAt, shift) {
  const magnitude = new Float32Array(response.magnitude.length);
  for (let i = 0; i < magnitude.length; i++) {
    magnitude[i] = response.magnitude[i] - referenceAt(response.startFreq + i * response.freqStep) - shift;
  }
  return { ...response, magnitude };
}

/** Everything the chart needs to draw one frame, derived from the current state. */
function buildChartModel() {
  const mode = value('viewMode');
  const hasTarget = !!target?.length;
  const deviation = mode !== 'raw';
  // Speaker-style: compensate against the published target only, so the tilt
  // stays on screen as the straight line the response is meant to follow.
  const slopeShown = mode === 'slope' && !!tilt();
  const referenceAt = slopeShown ? baseTargetAt : targetAt;

  const shift = hasTarget
    ? levelMatchOffset(allCurves()[0]?.response, referenceAt, { atHz: normFreqHz(), band: normIsBand() })
    : 0;

  const compensated = deviation && hasTarget;
  const curves = allCurves().map((c) => ({ ...c, response: compensated ? compensate(c.response, referenceAt, shift) : c.response }));
  const centerCurve = curves.find((c) => c.def.id === 'center')?.response ?? null;

  // In slope mode the tilt itself is the target line; otherwise the target is the
  // flat 0 dB reference (deviation) or the curve itself (absolute).
  const slopeAt = (f) => tiltDbAt(f, tilt(), normFreqHz());
  const targetLine = !deviation && hasTarget ? (f) => targetAt(f) + shift
    : slopeShown ? slopeAt
    : null;
  const boundsBase = !deviation ? (f) => targetAt(f) + shift : slopeShown ? slopeAt : () => 0;

  const axisLabel = (!deviation
    ? 'Calibrated response (dB)'
    : slopeShown
      ? `Deviation from ${targetName || 'target'} (dB) — follow the ${tilt()} dB/oct target slope`
      : `Deviation from ${targetName || 'target'}${tilt() ? ` ${tilt()} dB/oct` : ''} (dB) — the tilted target is the 0 dB line`)
    + (hasTarget && shift ? ` — normalised at ${normLabel()}` : '');

  const model = {
    curves,
    centerCurve,
    axisLabel,
    spanDb: manualSpanDb(),
    targetLine,
    zeroLine: deviation && hasTarget && !slopeShown,
    bounds: boundsVisible() ? { at: boundsDeltaAt, base: boundsBase } : null,
    emptyRange: deviation ? { ymin: -15, ymax: 15, step: 5 } : { ymin: -20, ymax: 100, step: 10 },
  };
  renderLegend(model, { deviation, slopeShown });
  renderChips(curves, centerCurve);
  updateExportButtons(curves.length, !!model.targetLine);
  return model;
}

function renderLegend(model, { deviation, slopeShown }) {
  const swatch = (color, label, cls = '') => `<span><i class="${cls}" style="background:${color}"></i>${label}</span>`;
  const parts = model.curves.map((c) =>
    swatch(c.def.color, `${c.def.label}${c.def.id !== 'center' && model.centerCurve ? ' + spread vs centre' : ''}`));
  if (target?.length) {
    const label = slopeShown ? `${tilt()} dB/oct target slope over ${targetName || 'target'}`
      : `${targetName || 'Target'}${tilt() ? ` ${tilt()} dB/oct` : ''}${deviation ? ' — 0 dB reference' : ''}`;
    parts.push(swatch('#f5c542', label));
  }
  if (model.bounds) parts.push(swatch('#f5c542', boundsSummary(), 'swatch-fill'));
  setHtml('legend', parts.join(''));
}

function renderChips(curves, centerCurve) {
  setHtml('measurementChips', POSITION_DEFS.map((p) => {
    const head = `<strong style="color:${p.color}">${p.label}</strong>`;
    if (p.id === 'center') return `<div class="measurement-chip">${head}${center.length} capture(s), averaged</div>`;
    const curve = curves.find((c) => c.def.id === p.id);
    if (!curve || !centerCurve) return `<div class="measurement-chip">${head}${measurements.has(p.id) ? '1 capture' : 'not captured'}</div>`;
    const { peak, at } = peakDifference(centerCurve, curve.response);
    return `<div class="measurement-chip">${head}${peak >= 0 ? '+' : ''}${peak.toFixed(1)} dB peak vs centre<br><span class="small">at ${formatHz(at)}</span></div>`;
  }).join(''));
}

const manualSpanDb = () => (value('dbSpan') === 'auto' ? 0 : Number(value('dbSpan')) || 0);

function updateViewControls() {
  const { view } = chart;
  const match = [...$('zoomPreset').options].find((o) => o.value === `${Math.round(view.fMin)},${Math.round(view.fMax)}`);
  $('zoomPreset').value = match ? match.value : 'custom';
  $('zoomOut').disabled = chart.isFullSpan();
  $('resetZoom').disabled = chart.isDefaultView() && value('dbSpan') === 'auto';
}

// ────────────────────────────────────────────────────────────── 8. Workflow

const isCaptured = (id) => (id === 'center' ? center.length >= centerRepeats() : measurements.has(id));

/** First offset still missing; null once every position has a measurement. */
const nextPosition = () => POSITION_DEFS.find((p) => p.id !== 'center' && !measurements.has(p.id))?.id ?? null;

// Where the earcup sits for each position, in fixture units. Roughly one
// measurement ring, so the drawing matches the offset the rings are used to set.
const CUP_OFFSET = { center: [0, 0], forward: [68, 0], backward: [-68, 0], up: [0, -68], down: [0, 68] };

/** Highlight the selected position and slide the headphone there. */
function renderRig(centerDone) {
  for (const g of $('rigOverlay').querySelectorAll('g[data-pos]')) {
    const id = g.dataset.pos;
    const done = id === 'center' ? centerDone : measurements.has(id);
    g.classList.toggle('done', done);
    g.classList.toggle('active', id === currentPosition && !done);
  }
  const target = currentPosition && CUP_OFFSET[currentPosition] ? currentPosition : 'center';
  const [dx, dy] = CUP_OFFSET[target];
  const cup = $('headphoneCup');
  cup.style.transform = `translate(${dx}px, ${dy}px)`;
  cup.style.color = positionDef(target).color;
}

function renderSteps() {
  const repeats = centerRepeats(), centerDone = center.length >= repeats;
  renderRig(centerDone);

  setHtml('positionSteps', POSITION_DEFS.map((p) => {
    const count = p.id === 'center' ? center.length : (measurements.has(p.id) ? 1 : 0);
    const done = p.id === 'center' ? centerDone : count > 0;
    const state = p.id === 'center' ? `${count}/${repeats} captures` : done ? 'captured' : 'waiting';
    const hint = done ? 'Click to re-measure and replace this capture' : 'Click to measure this position next';
    // Only the initial letter carries the position colour, so the word stays readable.
    return `<div class="step ${done ? 'done' : ''} ${p.id === currentPosition ? 'active' : ''}" data-pos="${p.id}" role="button" tabindex="0" title="${hint}">`
      + `<strong class="mark"><span style="color:${p.color}">${p.label.slice(0, 1)}</span>${p.label.slice(1)}</strong>`
      + `${done ? `<span class="tick" style="color:${p.color}">✓</span>` : ''}<small>${state}</small></div>`;
  }).join(''));

  const next = positionDef(currentPosition);
  if (!next) {
    $('positionNote').innerHTML = '<strong>All five positions captured.</strong> Click any box above to re-measure it — the new sweep replaces the old one.';
    $('captureBtn').textContent = '🎙️ All positions captured';
    return;
  }
  const redo = isCaptured(next.id) || (next.id === 'center' && pendingCenterReset);
  const step = next.id === 'center' && !redo && center.length < repeats ? ` (capture ${center.length + 1} of ${repeats})` : '';
  $('positionNote').innerHTML = `<strong style="color:${next.color}">Move the headphone to ${next.label}${step}</strong> — ${next.description} `
    + `Follow the highlighted arrow on the fixture, let it settle, then capture.${redo ? ' This replaces the existing capture.' : ''}`;
  $('captureBtn').textContent = next.id === 'center' && !redo
    ? `🎙️ Capture Center ${Math.min(center.length + 1, repeats)}/${repeats}`
    : `🎙️ ${redo ? 'Re-capture' : 'Capture'} ${next.label}`;
}

/**
 * Jump to any position, including one already captured. Choosing a finished Centre
 * restarts its repeat sequence so the average is never a mix of two seatings.
 */
function selectPosition(id) {
  if (busy) return;
  currentPosition = id;
  pendingCenterReset = id === 'center' && center.length >= centerRepeats();
  setStatus('captureStatus', `${positionDef(id).label} selected${pendingCenterReset ? ' — the next capture starts a fresh centre average' : ''}.`);
  updateCaptureButton();
}

function updateCaptureButton() {
  $('captureBtn').disabled = busy || !currentPosition || !value('inputDevice') || !value('outputDevice');
  renderSteps();
}

const showShield = (text) => { $('shieldWhat').textContent = text; $('measureShield').style.display = 'flex'; };
const hideShield = () => { $('measureShield').style.display = 'none'; };

function captureSettings() {
  return {
    inputDeviceId: value('inputDevice'),
    outputDeviceId: value('outputDevice'),
    inputChannel: value('inputChannel'),
    startHz: number('startHz', 20),
    endHz: number('endHz', 20000),
    durationSec: number('durationSec', 6),
    leadInSec: checked('timingReference') ? 0.1 : 0,
    tailSec: number('tailSec', 0.8),
    noiseFloorSec: number('noiseFloorSec', 2),
    warmupMs: number('warmupMs', 500),
    outputLevelDb: number('outputLevelDb', -12),
  };
}

/** Apply calibration and smoothing to the raw sweep result. */
function processCapture(raw) {
  let response = value('inputChannel') === 'right' ? raw.right : raw.left;
  if (calibration) response = applyCalibration(response, calibration);
  const smooth = Number(value('smoothing'));
  return smooth ? smoothResponse(response, { fractionalOctave: 1 / smooth, passes: 1 }) : response;
}

function storeCapture(def, response) {
  if (def.id !== 'center') {
    measurements.set(def.id, response);
    currentPosition = nextPosition();
    return;
  }
  if (pendingCenterReset) { center.length = 0; pendingCenterReset = false; }
  center.push(response);
  if (center.length >= centerRepeats()) currentPosition = nextPosition() ?? 'center';
}

async function capturePosition() {
  if (busy) return;
  const def = positionDef(currentPosition) || POSITION_DEFS[0];
  busy = true;
  updateCaptureButton();
  showShield(`Preparing ${def.label} capture…`);
  try {
    const raw = await backend.captureMeasurement(captureSettings());
    showShield(`${def.label}: processing response…`);
    storeCapture(def, processCapture(raw));
    const noise = raw.metadata?.noiseFloorDbfs;
    setStatus('captureStatus', `${def.label} captured.`
      + (noise != null ? ` Noise floor ${noise.toFixed(1)} dBFS.` : '')
      + (currentPosition ? ` Next: ${positionDef(currentPosition).label}.` : ' All positions captured.'));
    chart.render();
    renderSteps();
    persist();
  } catch (e) {
    setStatus('captureStatus', e.message, true);
  } finally {
    hideShield();
    busy = false;
    updateCaptureButton();
  }
}

function resetMeasurements() {
  center.length = 0;
  measurements.clear();
  currentPosition = 'center';
  pendingCenterReset = false;
  setStatus('captureStatus', 'Measurements reset.');
  chart.render();
  renderSteps();
}

// ──────────────────────────────────────────────────────────────── 9. Export

const capturedResponse = (id) => (id === 'center' ? activeCenter() : measurements.get(id));

function updateExportButtons(curveCount, hasTarget) {
  $('jpgBtn').disabled = curveCount === 0 && !hasTarget;
  $('rewBtn').disabled = curveCount === 0;
  $('jsonBtn').disabled = curveCount === 0;
}

function projectJson() {
  return {
    format: 'headphone-positional-capture-v1',
    exportedAt: new Date().toISOString(),
    settings: {
      ...captureSettings(),
      viewMode: value('viewMode'),
      normalisation: normLabel(),
      tiltDbPerOctave: tilt(),
      targetName,
      calibrationName: prefs.calibrationName || '',
    },
    measurements: Object.fromEntries(POSITION_DEFS
      .map((p) => [p.id, capturedResponse(p.id)])
      .filter(([, r]) => r)
      .map(([id, r]) => [id, { ...r, magnitude: Array.from(r.magnitude) }])),
  };
}

/**
 * REW imports one measurement per file, so each position becomes its own .txt.
 * A single capture downloads as plain text; a set is zipped, because five
 * simultaneous downloads get throttled and prompted by the browser.
 */
function exportRew() {
  const files = POSITION_DEFS
    .map((p) => [p, capturedResponse(p.id)])
    .filter(([, r]) => r)
    .map(([p, r]) => ({
      name: `Headphone positional - ${p.label}.txt`,
      text: exportRewMeasurement(r, { name: `Headphone positional - ${p.label}` }),
    }));
  if (!files.length) return;
  if (files.length === 1) return downloadText(files[0].name, files[0].text, 'text/plain');
  downloadBlob('headphone-positional-measurements.zip', createZip(files));
  setStatus('captureStatus', `Exported ${files.length} REW measurements — one .txt per position inside the zip.`);
}

function exportJpg() {
  const link = document.createElement('a');
  link.download = 'headphone-positional-response.jpg';
  // The snapshot excludes the hover crosshair, which the visible canvas may carry.
  link.href = chart.snapshot().toDataURL('image/jpeg', 0.94);
  link.click();
}

// ──────────────────────────────────────────────────────────────── 10. Wiring

/** Controls that only need to re-persist and refresh the capture button. */
const CAPTURE_CONTROLS = ['inputDevice', 'outputDevice', 'startHz', 'endHz', 'durationSec', 'warmupMs',
  'tailSec', 'noiseFloorSec', 'outputLevelDb', 'centerRepeats', 'inputChannel', 'smoothing', 'timingReference'];

/** Controls that change how the graph is drawn. */
const RENDER_CONTROLS = [['viewMode', 'change'], ['boundDb', 'input'], ['targetTilt', 'input'], ['normMode', 'change']];

function wireEvents() {
  on('scanBtn', 'click', scanDevices);
  on('captureBtn', 'click', capturePosition);
  on('resetBtn', 'click', resetMeasurements);

  // Step boxes double as a picker, so any position can be re-measured.
  const stepFromEvent = (e) => e.target.closest('[data-pos]');
  on('positionSteps', 'click', (e) => { const box = stepFromEvent(e); if (box) selectPosition(box.dataset.pos); });
  on('positionSteps', 'keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const box = stepFromEvent(e);
    if (box) { e.preventDefault(); selectPosition(box.dataset.pos); }
  });

  on('calFile', 'change', (e) => e.target.files[0] && loadCalibration(e.target.files[0]));
  on('rememberCal', 'change', () => { persist(); reportCalibration(); });
  on('targetFile', 'change', (e) => e.target.files[0] && loadTargetFile(e.target.files[0]));
  on('targetPreset', 'change', () => { loadPresetTarget(value('targetPreset')); persist(); });
  on('boundsMode', 'change', async () => {
    if (value('boundsMode').startsWith('pref')) await ensurePrefBounds();
    chart.render();
    persist();
  });
  on('tiltPreset', 'change', () => { syncTiltControls(true); chart.render(); persist(); });
  for (const [id, event] of RENDER_CONTROLS) on(id, event, () => { chart.render(); persist(); });
  for (const id of CAPTURE_CONTROLS) on(id, 'change', () => { persist(); updateRouteSummary(); updateCaptureButton(); });

  // Panel state is recorded on the summary click, never on the toggle event —
  // that also fires for the state applied programmatically at load.
  for (const id of ['captureCard', 'calCard', 'routeCard']) {
    $(id).querySelector('summary').addEventListener('click', () => { panels[id] = !$(id).open; persist(); });
  }

  on('zoomPreset', 'change', () => {
    if (value('zoomPreset') === 'custom') return;
    const [fMin, fMax] = value('zoomPreset').split(',').map(Number);
    chart.setView({ fMin, fMax });
  });
  on('dbSpan', 'change', () => chart.clearDbLock());
  on('zoomIn', 'click', () => chart.zoom(0.6));
  on('zoomOut', 'click', () => chart.zoom(1 / 0.6));
  on('resetZoom', 'click', () => { $('dbSpan').value = 'auto'; chart.reset(); });

  on('jpgBtn', 'click', exportJpg);
  on('rewBtn', 'click', exportRew);
  on('jsonBtn', 'click', () => downloadText('headphone-positional-project.json', JSON.stringify(projectJson(), null, 2), 'application/json'));
}

async function start() {
  if (location.protocol === 'file:') {
    reportStorage({ ok: false, error: new Error('file:// pages do not keep localStorage or microphone permission between visits') });
  }
  await loadTargetCatalogue();
  await ensurePrefBounds();
  restore();
  await autoScanIfPermitted();
  applyPanelState();
  wireEvents();
  renderSteps();
  chart.render();
  updateViewControls();
}

await start();
