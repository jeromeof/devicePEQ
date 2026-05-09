#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol client — zero npm dependencies.
 * Uses only Node.js built-in modules (net, crypto, http, fs, path).
 *
 * Usage:
 *   node tests/cdp.mjs find                  → print matching tab info as JSON
 *   node tests/cdp.mjs open <url>            → open URL in a new Chrome tab, print tab JSON
 *   node tests/cdp.mjs inject                → inject captureHelper.js + call startCapture()
 *   node tests/cdp.mjs start                 → call startCapture() on already-injected page
 *   node tests/cdp.mjs stop                  → call stopCapture(), print result JSON to stdout
 *   node tests/cdp.mjs eval "<expression>"   → evaluate arbitrary JS and print result
 *
 * Options:
 *   --port <n>        Chrome debugging port (default: 9222)
 *   --tab <substr>    Match tab by URL/title substring (default: DevicePEQ or index.html)
 *   --out <filepath>  (stop only) save capture JSON to this file instead of printing
 */

import net    from 'net';
import crypto from 'crypto';
import http   from 'http';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';

const __dir  = path.dirname(fileURLToPath(import.meta.url));
const args     = process.argv.slice(2);
// Options may appear anywhere; skip option pairs (--flag value) when finding the command
const optionFlags = new Set(['--port', '--tab', '--out']);
const positional = args.filter((a, i) => !a.startsWith('--') && !optionFlags.has(args[i - 1]));
const cmd      = positional[0] ?? 'find';
const portIdx  = args.indexOf('--port');
const port     = portIdx !== -1 ? parseInt(args[portIdx + 1]) : 9222;
const tabIdx   = args.indexOf('--tab');
const tabSub   = tabIdx !== -1 ? (args[tabIdx + 1] ?? '') : '';
const evalIdx  = positional.indexOf('eval');
const evalExpr = cmd === 'eval' && evalIdx !== -1 ? (positional[evalIdx + 1] ?? '') : '';
const outIdx   = args.indexOf('--out');
const outFile  = outIdx !== -1 ? args[outIdx + 1] : null;
const openIdx  = positional.indexOf('open');
const openUrl  = cmd === 'open' && openIdx !== -1 ? (positional[openIdx + 1] ?? '') : '';

// ── minimal WebSocket client (RFC 6455 client-side only) ──────────────────────

class WSClient {
  constructor(socket) {
    this.socket  = socket;
    this._id     = 1;
    this._pending = new Map();
    this._buf    = Buffer.alloc(0);
    socket.on('data', d => this._recv(d));
    socket.on('error', () => {});
  }

  send(method, params = {}) {
    const id = this._id++;
    return new Promise((res, rej) => {
      this._pending.set(id, { res, rej });
      const payload = Buffer.from(JSON.stringify({ id, method, params }));
      const mask    = crypto.randomBytes(4);
      const len     = payload.length;
      const header  = len < 126 ? Buffer.allocUnsafe(6) : Buffer.allocUnsafe(8);
      header[0] = 0x81;
      if (len < 126) { header[1] = 0x80 | len; mask.copy(header, 2); }
      else            { header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); mask.copy(header, 4); }
      const masked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      this.socket.write(Buffer.concat([header, masked]));
    });
  }

  _recv(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (this._buf.length >= 2) {
      let off   = 0;
      const b1  = this._buf[off++];
      const b2  = this._buf[off++];
      const fin = (b1 & 0x80) !== 0;
      let plen  = b2 & 0x7F;
      if (plen === 126) {
        if (this._buf.length < 4) return;
        plen = this._buf.readUInt16BE(off); off += 2;
      }
      const total = off + plen;
      if (this._buf.length < total) return;
      const text = this._buf.slice(off, total).toString();
      this._buf  = this._buf.slice(total);
      try {
        const msg = JSON.parse(text);
        if (msg.id && this._pending.has(msg.id)) {
          const { res, rej } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        }
      } catch (_) {}
    }
  }

  close() { this.socket.destroy(); }
}

async function connect(wsUrl) {
  // Parse manually — new URL() rejects ws:// on some Node versions
  const m = wsUrl.match(/^wss?:\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (!m) throw new Error(`Cannot parse WebSocket URL: ${wsUrl}`);
  const hostname = m[1];
  const wsPort   = parseInt(m[2] || '80');
  const pathname = m[3] || '/';
  const host     = m[2] ? `${hostname}:${m[2]}` : hostname;
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise((res, rej) => {
    const sock = net.createConnection(wsPort, hostname, () => {
      sock.write([
        `GET ${pathname} HTTP/1.1`,
        `Host: ${host}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${key}`,
        `Sec-WebSocket-Version: 13`,
        '', ''
      ].join('\r\n'));
    });
    let upgraded = false;
    sock.on('data', chunk => {
      if (!upgraded && chunk.toString().includes('\r\n\r\n')) {
        upgraded = true;
        const client = new WSClient(sock);
        res(client);
        // Forward any WS frame bytes that arrived after the HTTP headers in this chunk
        const sep = chunk.indexOf('\r\n\r\n');
        const remaining = chunk.slice(sep + 4);
        if (remaining.length > 0) client._recv(remaining);
      }
    });
    sock.on('error', rej);
    setTimeout(() => rej(new Error('CDP connect timeout')), 5000);
  });
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => {
        try { res(JSON.parse(body)); }
        catch (e) { rej(e); }
      });
    }).on('error', rej);
  });
}

function httpPut(urlPath) {
  return new Promise((res, rej) => {
    const req = http.request({ host: 'localhost', port, path: urlPath, method: 'PUT' }, r => {
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => {
        try { res(JSON.parse(body)); }
        catch (_) { res(body); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

// ── find target tab ────────────────────────────────────────────────────────────

async function findTab(sub) {
  const tabs = await httpGet(`http://localhost:${port}/json`);
  // Exclude DevTools windows — their URL contains the target URL as a query
  // param, causing false matches before the real page tab.
  const real = tabs.filter(t => !t.url?.startsWith('devtools://') && t.type !== 'other');
  const match = sub
    ? real.find(t => t.url?.includes(sub) || t.title?.includes(sub))
    : real.find(t => t.url?.includes('DevicePEQ') || t.url?.includes('index.html') || t.title?.includes('DevicePEQ'));
  if (!match) throw new Error(
    `No matching tab found on port ${port}.\nOpen tabs:\n` +
    tabs.map(t => `  [${t.type}] ${t.title} — ${t.url}`).join('\n')
  );
  return match;
}

// ── evaluate helper ────────────────────────────────────────────────────────────

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result?.exceptionDetails) {
    const e = result.exceptionDetails;
    const desc = e.exception?.description ?? e.text ?? 'JS evaluation error';
    throw new Error(`${desc} [line ${e.lineNumber}:${e.columnNumber}]`);
  }
  return result?.result?.value;
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  // 'open' doesn't need an existing tab — create one and exit
  if (cmd === 'open') {
    if (!openUrl) throw new Error('Usage: cdp.mjs open <url>');
    const tab = await httpPut(`/json/new?${encodeURIComponent(openUrl)}`);
    console.log(JSON.stringify({ ok: true, tabId: tab.id, url: tab.url, title: tab.title }, null, 2));
    return;
  }

  const tab = await findTab(tabSub);

  if (cmd === 'find') {
    console.log(JSON.stringify({ title: tab.title, url: tab.url, id: tab.id }, null, 2));
    return;
  }

  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  try {
    if (cmd === 'inject' || cmd === 'start') {
      const helperSrc  = fs.readFileSync(path.join(__dir, 'captureHelper.js'), 'utf8');
      const captureOut = path.join(__dir, '.capture-result.json');

      // Script injected into the page — wraps stopCapture to also persist
      // captures to a temp file readable by the 'stop' command.
      // Wrap the extra wiring in an IIFE so `const` declarations never conflict
      // when the script is re-evaluated after a page reload.
      const injectSrc = helperSrc + `
        ;(function() {
          window.__captureHelperReady = true;
          const _origStop = window.stopCapture;
          window.stopCapture = async function() {
            const result = await _origStop();
            if (result) {
              window.__peqLastCapture = result;
              localStorage.setItem('__peqCapturePending', JSON.stringify(result));
            }
            return result;
          };
        })();
      `;

      await cdp.send('Page.enable');

      // Inject into the current page immediately
      await evaluate(cdp, injectSrc);

      // ── Daemon: stay connected, re-inject on every navigation ────────────
      // Page.addScriptToEvaluateOnNewDocument is session-scoped and lost
      // when the CDP client disconnects. Instead we listen for load events
      // and re-inject, keeping this process alive until Ctrl-C or 'stop' runs.

      const daemonPidFile = path.join(__dir, '.cdp-daemon.pid');
      fs.writeFileSync(daemonPidFile, String(process.pid));

      console.log(JSON.stringify({ ok: true, action: 'startCapture',
        pid: process.pid, pidFile: daemonPidFile,
        note: 'daemon running — re-injects on every reload. Run cdp.mjs stop to finish.' }));

      // Poll: re-inject whenever the helper disappears (page navigated/reloaded)
      // and flush capture result to file when localStorage has one.
      let lastTitle = '';
      while (true) {
        await new Promise(r => setTimeout(r, 800));

        // Check if stop was requested via sentinel file
        const stopFile = path.join(__dir, '.cdp-stop');
        if (fs.existsSync(stopFile)) {
          fs.unlinkSync(stopFile);
          break;
        }

        try {
          const state = await evaluate(cdp,
            'JSON.stringify({ready: window.__captureHelperReady, title: document.title, pending: localStorage.getItem("__peqCapturePending") ? "yes" : "no"})');
          const s = JSON.parse(state);

          // Flush capture result to file if available
          if (s.pending === 'yes') {
            const raw = await evaluate(cdp, 'localStorage.getItem("__peqCapturePending")');
            fs.writeFileSync(captureOut, raw);
            await evaluate(cdp, 'localStorage.removeItem("__peqCapturePending")');
            process.stderr.write(`[daemon] capture written to ${captureOut}\n`);
          }

          // Re-inject if helper disappeared (page reloaded)
          if (!s.ready) {
            process.stderr.write(`[daemon] page changed ("${s.title}"), re-injecting...\n`);
            try { await evaluate(cdp, injectSrc); }
            catch (_) { /* page still loading, will retry */ }
          }
        } catch (_) { /* CDP briefly unavailable, retry */ }
      }

      if (fs.existsSync(daemonPidFile)) fs.unlinkSync(daemonPidFile);
      console.log(JSON.stringify({ ok: true, action: 'daemonStopped' }));
    }

    else if (cmd === 'stop') {
      const captureOut = path.join(__dir, '.capture-result.json');
      const stopFile   = path.join(__dir, '.cdp-stop');

      // 1. Call stopCapture() in the page (stores result in localStorage)
      const helperAlive = await evaluate(cdp, 'typeof window.stopCapture');
      if (helperAlive === 'function') {
        await evaluate(cdp, 'window.stopCapture()', true);
        await new Promise(r => setTimeout(r, 600));
        // Flush localStorage result to file directly in case daemon isn't running
        const raw = await evaluate(cdp, 'localStorage.getItem("__peqCapturePending")');
        if (raw) {
          fs.writeFileSync(captureOut, raw);
          await evaluate(cdp, 'localStorage.removeItem("__peqCapturePending")');
        }
      }

      // 2. Signal the daemon to stop
      fs.writeFileSync(stopFile, '1');
      await new Promise(r => setTimeout(r, 1000));

      // 3. Read result from file
      if (!fs.existsSync(captureOut)) {
        throw new Error('No capture file found. Make sure you clicked Pull after connecting the device.');
      }
      const capture = JSON.parse(fs.readFileSync(captureOut, 'utf8'));
      fs.unlinkSync(captureOut);
      if (outFile) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(capture, null, 2));
        console.log(JSON.stringify({ ok: true, saved: outFile, device: capture.device, exchanges: capture.exchanges?.length }));
      } else {
        console.log(JSON.stringify(capture));
      }
    }

    else if (cmd === 'eval') {
      const val = await evaluate(cdp, evalExpr, evalExpr.includes('await'));
      console.log(JSON.stringify(val ?? null));
    }

  } finally {
    cdp.close();
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
