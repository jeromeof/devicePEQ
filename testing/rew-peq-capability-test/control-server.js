#!/usr/bin/env node
// Keeps a single persistent browser/page/device session alive and exposes it
// over local HTTP, so a human (or an orchestrating script) can drive each
// step individually — connect, check status, push a filter, read it back —
// at whatever pace is actually safe, with room to screenshot/verify between
// steps instead of a monolithic script racing through everything unattended.
//
// Usage: node control-server.js
// Then: curl -X POST http://127.0.0.1:5190/connect
//       curl http://127.0.0.1:5190/status
//       curl -X POST http://127.0.0.1:5190/push -d '{"filters":[...],"globalGain":0,"slot":101}'
//       ...
const http = require('http');
const { connectDevice, closeHarness } = require('./device-session');
const { checkAudioPreflight } = require('./audio-preflight');

const CONTROL_PORT = 5190;

let session = null; // { context, page, modelConfig }

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const routes = {
  'GET /status': async () => {
    if (!session) return { started: false };
    const connected = await session.page.evaluate(() => window.harness.isConnected());
    return { started: true, connected, modelConfig: session.modelConfig };
  },

  // Does REW's requested audio format still match what Core Audio is set to?
  // Worth re-checking after any push that restarts the DAC, since the device
  // re-enumerates and can come back at a different format.
  'GET /audio-preflight': async () => checkAudioPreflight(),

  // Launches the browser (if not already) and tries silentConnect(). Does NOT
  // block waiting for a manual pairing click — check /status afterward, and
  // if connected=false, the browser window is up and ready for a manual
  // "Pair Device" click; call /connect again once you've clicked it.
  'POST /connect': async () => {
    if (!session) {
      const { context, page, modelConfig } = await connectDeviceNonBlocking();
      session = { context, page, modelConfig };
    } else {
      const connected = await session.page.evaluate(() => window.harness.silentConnect());
      if (connected) session.modelConfig = connected.modelConfig;
    }
    const connected = await session.page.evaluate(() => window.harness.isConnected());
    return { connected, modelConfig: session.modelConfig };
  },

  'POST /pull': async (body) => {
    if (!session) throw new Error('not started — call /connect first');
    const slot = body.slot ?? session.modelConfig.firstWritableEQSlot;
    return session.page.evaluate((slot) => window.harness.pullFromDevice(slot), slot);
  },

  'POST /call': async (body) => {
    if (!session) throw new Error('not started — call /connect first');
    return session.page.evaluate(
      ({ methodName, args }) => window.harness.callHandlerMethod(methodName, ...args),
      { methodName: body.method, args: body.args || [] }
    );
  },

  'POST /push': async (body) => {
    if (!session) throw new Error('not started — call /connect first');
    const slot = body.slot ?? session.modelConfig.firstWritableEQSlot;
    return session.page.evaluate(
      ({ filters, globalGain, slot }) => window.harness.pushFilters(filters, globalGain, slot),
      { filters: body.filters, globalGain: body.globalGain ?? 0, slot }
    );
  },

  'POST /enablePEQ': async (body) => {
    if (!session) throw new Error('not started — call /connect first');
    const slot = body.slot ?? session.modelConfig.firstWritableEQSlot;
    return session.page.evaluate(
      ({ enable, slot }) => window.harness.enablePEQ(enable, slot),
      { enable: !!body.enable, slot }
    );
  },

  'POST /shutdown': async () => {
    if (session) {
      await closeHarness(session.context, session.page);
      session = null;
    }
    return { shutdown: true };
  },
};

// Like device-session's connectDevice(), but returns immediately after
// launching + attempting silentConnect(), instead of blocking for up to 2
// minutes polling for a manual pairing click.
async function connectDeviceNonBlocking() {
  const { chromium } = require('playwright');
  const { PROFILE_DIR, HARNESS_URL, PORT } = require('./device-session');
  const { startServer } = require('./static-server');
  await startServer(PORT);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.harness, { timeout: 15000 });
  const connected = await page.evaluate(() => window.harness.silentConnect());
  return { context, page, modelConfig: connected?.modelConfig ?? null };
}

const server = http.createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[key];
  if (!handler) return send(res, 404, { error: `no route for ${key}` });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const result = await handler(body);
    send(res, 200, result);
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(CONTROL_PORT, '127.0.0.1', () => {
  console.log(`Control server listening on http://127.0.0.1:${CONTROL_PORT}`);
});

process.on('SIGTERM', async () => {
  if (session) await closeHarness(session.context, session.page);
  process.exit(0);
});
