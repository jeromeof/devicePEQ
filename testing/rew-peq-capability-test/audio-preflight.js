// Pre-run check that REW's requested audio format matches what Core Audio is
// actually set to, so a format mismatch fails fast with an actionable message
// instead of stalling the run behind REW's modal error dialog:
//
//   "Unable to access the replay device due to line with format PCM_SIGNED
//    48000.0 Hz, 24 bit, stereo, 6 bytes/frame, little-endian not supported."
//
// Why this matters here specifically: REW drives its lines through Java
// (javax.sound), which requests ONE exact format rather than negotiating. A
// device left at 16 bit in Audio MIDI Setup refuses REW's 24-bit request. The
// resulting dialog is modal, so it blocks the sweep AND can't be dismissed over
// REW's HTTP API — by the time it appears, an unattended run is already dead.
//
// The device re-enumerating (a KT Micro commit appears to restart the DAC) is
// the usual way a session drifts into this state mid-run: the device comes back
// as a fresh Core Audio device, potentially at a different default format, while
// REW is still holding the settings it had.
//
// Scope: macOS + REW's Java driver only. Under ASIO, or on another platform,
// this reports "skipped" rather than guessing.
const path = require('path');
const { execFile } = require('child_process');

const REW_BASE = 'http://127.0.0.1:4735';
const SWIFT_PROBE = path.join(__dirname, 'coreaudio-format.swift');

async function rewGet(p) {
  const res = await fetch(`${REW_BASE}${p}`);
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status} ${res.statusText}`);
  return res.json();
}

// What REW is configured to ask the OS for.
async function getRewAudioConfig() {
  const [status, driver, samplerate, format, outputDevice, inputDevice, configuration] =
    await Promise.all([
      rewGet('/audio/status'),
      rewGet('/audio/driver'),
      rewGet('/audio/samplerate'),
      rewGet('/audio/java/format'),
      rewGet('/audio/java/output-device'),
      rewGet('/audio/java/input-device'),
      rewGet('/audio/configuration').catch(() => ({})),
    ]);
  return {
    enabled: status.enabled,
    ready: status.ready,
    driver: driver.driver,
    sampleRate: samplerate.value,
    outputBits: format.outputBits,
    inputBits: format.inputBits,
    outputDevice: outputDevice.device,
    inputDevice: inputDevice.device,
    treat32BitAs24Bit: configuration.treat32Bitas24Bit === true,
  };
}

// What Core Audio is actually set to right now. Returns null (rather than
// throwing) when the probe can't run — an unavailable Swift toolchain should
// downgrade the preflight to a warning, never block a test run outright.
function getCoreAudioFormats() {
  return new Promise((resolve) => {
    execFile('swift', [SWIFT_PROBE], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

// REW can be set to the literal alias "Default Device" rather than a named one,
// in which case there is nothing in Core Audio to match by name — resolve it to
// whichever device is currently the system default for that direction.
const DEFAULT_ALIASES = new Set(['Default Device', 'Default Audio Device']);

// Core Audio exposes input and output as separate device objects sharing one
// name (both TANCHJIM entries, for instance), so match on name AND the scope in
// use — never assume the first name match carries the direction we care about.
function findDevice(coreAudio, deviceName, scope) {
  if (DEFAULT_ALIASES.has(deviceName)) {
    const flag = scope === 'output' ? 'isDefaultOutput' : 'isDefaultInput';
    return coreAudio.find((d) => d[flag] && d[scope]) || null;
  }
  return coreAudio.find((d) => d.name === deviceName && d[scope]) || null;
}

function compareOne({ direction, deviceName, rewBits, rewSampleRate, device, treat32BitAs24Bit }) {
  if (!device) {
    return {
      direction,
      ok: false,
      severity: 'error',
      message:
        `REW's ${direction} device "${deviceName}" has no ${direction} stream in Core Audio — ` +
        `it may have been unplugged or re-enumerated since REW was configured. ` +
        `Re-select it in REW > Preferences > Soundcard.`,
    };
  }
  const actual = device[direction];
  // Report the device REW resolved to, not the alias, so the message names
  // something the user can actually find in Audio MIDI Setup.
  const label = DEFAULT_ALIASES.has(deviceName)
    ? `${deviceName} -> "${device.name}"`
    : `"${deviceName}"`;

  const problems = [];
  // 32-bit hardware satisfies a 24-bit request only when REW is set to bridge
  // the two; otherwise it's a genuine mismatch.
  const bitsOk =
    actual.bitsPerChannel === rewBits ||
    (treat32BitAs24Bit && rewBits === 24 && actual.bitsPerChannel === 32);
  if (!bitsOk) {
    problems.push(
      `bit depth: REW wants ${rewBits}-bit, device is set to ${actual.bitsPerChannel}-bit`);
  }
  if (Math.abs(actual.sampleRate - rewSampleRate) > 0.5) {
    problems.push(
      `sample rate: REW wants ${rewSampleRate} Hz, device is set to ${actual.sampleRate} Hz`);
  }

  if (!problems.length) {
    return {
      direction,
      ok: true,
      message: `${direction}: ${label} ${actual.bitsPerChannel}-bit ${actual.sampleRate} Hz — matches REW`,
    };
  }
  return {
    direction,
    ok: false,
    severity: 'error',
    message:
      `${direction} format mismatch on ${label} — ${problems.join('; ')}. ` +
      `REW will fail with "Unable to access the ${direction === 'output' ? 'replay' : 'capture'} device". ` +
      `Fix in Audio MIDI Setup (set the device's format to ${rewBits}-bit ${rewSampleRate} Hz), ` +
      `or change REW > Preferences > Soundcard to match the device.`,
  };
}

// Returns { ok, skipped, reason?, rew?, checks[] } — never throws on a
// mismatch, so the caller decides whether to abort or just warn.
async function checkAudioPreflight() {
  let rew;
  try {
    rew = await getRewAudioConfig();
  } catch (e) {
    return { ok: false, skipped: true, reason: `Could not read REW audio config: ${e.message}` };
  }

  const checks = [];
  if (!rew.enabled || !rew.ready) {
    checks.push({
      direction: 'device',
      ok: false,
      severity: 'error',
      message: `REW reports audio not ready (enabled=${rew.enabled}, ready=${rew.ready}) — ` +
        `open REW > Preferences > Soundcard and confirm the input/output devices are selected.`,
    });
  }

  if (rew.driver !== 'Java') {
    return { ok: checks.every((c) => c.ok), skipped: true, rew, checks,
      reason: `REW driver is "${rew.driver}", not Java — format preflight only covers the Java driver.` };
  }
  if (process.platform !== 'darwin') {
    return { ok: checks.every((c) => c.ok), skipped: true, rew, checks,
      reason: `Core Audio format probe is macOS-only (platform=${process.platform}).` };
  }

  const coreAudio = await getCoreAudioFormats();
  if (!coreAudio) {
    return { ok: checks.every((c) => c.ok), skipped: true, rew, checks,
      reason: `Core Audio probe unavailable (needs the "swift" toolchain from Xcode command line tools).` };
  }

  checks.push(compareOne({
    direction: 'output',
    deviceName: rew.outputDevice,
    rewBits: rew.outputBits,
    rewSampleRate: rew.sampleRate,
    device: findDevice(coreAudio, rew.outputDevice, 'output'),
    treat32BitAs24Bit: rew.treat32BitAs24Bit,
  }));
  checks.push(compareOne({
    direction: 'input',
    deviceName: rew.inputDevice,
    rewBits: rew.inputBits,
    rewSampleRate: rew.sampleRate,
    device: findDevice(coreAudio, rew.inputDevice, 'input'),
    treat32BitAs24Bit: rew.treat32BitAs24Bit,
  }));

  return { ok: checks.every((c) => c.ok), skipped: false, rew, checks };
}

// Convenience wrapper for scripts: prints the outcome and throws on a hard
// mismatch. Pass { strict: false } to warn and carry on regardless.
async function assertAudioPreflight({ strict = true } = {}) {
  const result = await checkAudioPreflight();
  if (result.skipped) {
    console.log(`  audio preflight skipped — ${result.reason}`);
  }
  for (const c of result.checks || []) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.message}`);
  }
  const hardFailures = (result.checks || []).filter((c) => !c.ok && c.severity === 'error');
  if (hardFailures.length && strict) {
    throw new Error(
      `Audio format preflight failed — aborting before REW blocks on a modal dialog:\n` +
      hardFailures.map((c) => `  - ${c.message}`).join('\n'));
  }
  return result;
}

module.exports = {
  checkAudioPreflight,
  assertAudioPreflight,
  getRewAudioConfig,
  getCoreAudioFormats,
};
