// Shared WebHID device session management for the capability-test scripts.
//
// Key fact this is built around: even though WebHID *permission* persists per
// origin in the browser profile, actually re-establishing an open connection
// after a Chrome restart OR a physical unplug/replug of the DAC seems to
// require a fresh, user-gestured requestDevice() handshake — confirmed by the
// official WalkPlay web app (peq.szwalkplay.com) showing its native HID
// chooser every time this happens, even though it lists the device as
// "Paired". So needing a manual reconnect click is a NORMAL, recurring event
// here, not a one-off setup step or an error condition — every script in this
// folder should expect it and prompt for it gracefully rather than crash.
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const { startServer } = require('./static-server');

const PORT = 5183;
const HARNESS_URL = `http://127.0.0.1:${PORT}/testing/rew-peq-capability-test/harness.html`;
const PROFILE_DIR = path.join(__dirname, '.pw-profile');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function openHarness(context) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
  // The harness module uses a top-level await (resolving usbHidConnector.js's
  // async-IIFE export) before it defines window.harness — domcontentloaded can
  // fire before that finishes, so wait for it explicitly.
  await page.waitForFunction(() => !!window.harness, { timeout: 15000 });
  return page;
}

async function waitForManualPairing(page, { timeoutMs = 120000, pollMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const modelConfig = await page.evaluate(() => window.harness.getModelConfig());
    if (modelConfig) return modelConfig;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for manual pairing/reconnect click.`);
}

// context.close() has been observed to hang indefinitely on this machine
// (reproduced even with no device ever opened — a Playwright/Chromium issue,
// not device-specific). If it doesn't resolve, force-kill any Chromium
// process tied to our profile dir rather than leave an orphaned process
// holding the port (or the device) for the next run.
async function closeHarness(context, page) {
  try { if (page) await withTimeout(page.evaluate(() => window.harness.disconnect()), 5000); } catch (_) {}
  try {
    await withTimeout(context.close(), 8000);
  } catch (_) {
    console.warn('context.close() timed out — force-killing leftover Chromium process(es)...');
    await new Promise((resolve) => execFile('pkill', ['-f', PROFILE_DIR], () => resolve()));
  }
}

// Connects to the device, trying a silent reconnect first and falling back to
// a manual (headed, user-click) reconnect whenever that doesn't work — for
// ANY reason: never paired before, browser restarted, device unplugged and
// replugged, or a stale HID handle. Always headed: headless Chromium was
// tried and could not see real WebHID hardware at all on this machine.
async function connectDevice() {
  await startServer(PORT);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false });
  const page = await openHarness(context);

  const connected = await page.evaluate(() => window.harness.silentConnect());
  if (connected) {
    return { context, page, modelConfig: connected.modelConfig };
  }

  console.log(`\nSilent reconnect didn't find an active device — this is normal after a`);
  console.log(`Chrome restart or an unplug/replug, not an error. In the browser window,`);
  console.log(`click "Pair Device (manual, one-time)" and select your device from the`);
  console.log(`native chooser (it will show "Paired" even though a click is still needed).`);
  console.log(`Waiting up to 2 minutes...`);
  const modelConfig = await waitForManualPairing(page);
  return { context, page, modelConfig };
}

module.exports = { connectDevice, closeHarness, withTimeout, PROFILE_DIR, PORT, HARNESS_URL };
