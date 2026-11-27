// USB side of the WalkPlay BLE investigation: talks to the dongle over USB HID with the real DevicePEQ handler
// (devicePEQ/walkplayHidHandler.js) and logs every HID frame both ways.
//
//   node usb_tool.mjs <pid> <log.jsonl> snapshot <out.json>      read every band + settings (raw), for an exact restore
//   node usb_tool.mjs <pid> <log.jsonl> restore  <snapshot.json> write the raw band packets + settings back, then commit
//   node usb_tool.mjs <pid> <log.jsonl> write    <filters.json>  push filters ({freq,gain,q,type}[] + optional "gain")
//   node usb_tool.mjs <pid> <log.jsonl> read                     pull and print the bands as the handler parses them
//   node usb_tool.mjs <pid> <log.jsonl> raw "HEX" …             send raw READ frames (after report id 0x4B), print all replies
//   node usb_tool.mjs <pid> <log.jsonl> commit                   commit only: TEMP_WRITE (0x0A) then FLASH (0x01), no band writes
//
// Needs node-hid (NODE_PATH pointing at a node_modules with it). Bands count = the snapshot's / filters' length.
import { createRequire } from 'module';
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HID = require('node-hid');
const [pidArg, logFile, op, file] = process.argv.slice(2);
const PID = parseInt(pidArg, 16);
const here = path.dirname(fileURLToPath(import.meta.url));
const handlerUrl = new URL('file://' + path.resolve(here, '../../../devicePEQ/walkplayHidHandler.js'));

const info = HID.devices().find(d => d.vendorId === 0x3302 && d.productId === PID);
if (!info) { console.error('device not found'); process.exit(1); }
const dev = new HID.HID(info.path);
const hex = (a) => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join(' ');
const log = (dir, reportId, bytes, note) =>
  appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), link: 'usb', dir, reportId, hex: hex(bytes), ...(note ? { note } : {}) }) + '\n');

const listeners = new Set();
dev.on('data', (buf) => {
  const b = Buffer.from(buf); const data = Array.from(b.slice(1));
  log('rx', b[0], data);
  const ev = { reportId: b[0], data: new DataView(new Uint8Array(data).buffer) };
  for (const l of [...listeners]) l(ev);
});
const raw = {
  productName: info.product, vendorId: info.vendorId, productId: info.productId, opened: true,
  async open() {}, async close() {},
  addEventListener(t, f) { if (t === 'inputreport') listeners.add(f); },
  removeEventListener(t, f) { listeners.delete(f); },
  async sendReport(reportId, data) {
    const bytes = Array.from(data); log('tx', reportId, bytes);
    const p = new Array(64).fill(0); p[0] = reportId; bytes.forEach((v, i) => (p[i + 1] = v));
    dev.write(p);
  },
};
globalThis.window = globalThis;
const quiet = console.log; console.log = () => {};
const { walkplayUsbHID: h } = await import(handlerUrl.href);
const say = (...a) => quiet(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const details = (n) => ({ rawDevice: raw, model: info.product, manufacturer: 'WalkPlay',
  modelConfig: { maxFilters: n, deviceHandlesPregain: false, schemeNo: 13 } });

async function readRawBand(i) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { listeners.delete(on); resolve(null); }, 400);
    const on = (e) => { const d = new Uint8Array(e.data.buffer); if (d[1] === 0x09 && d[4] === i) { clearTimeout(t); listeners.delete(on); resolve(Array.from(d)); } };
    listeners.add(on); raw.sendReport(0x4B, [0x80, 0x09, 0x00, 0x00, i, 0x00]);
  });
}
async function readRaw(cmd, payload) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { listeners.delete(on); resolve(null); }, 400);
    const on = (e) => { const d = new Uint8Array(e.data.buffer); if (d[1] === cmd) { clearTimeout(t); listeners.delete(on); resolve(Array.from(d)); } };
    listeners.add(on); raw.sendReport(0x4B, [0x80, cmd, ...payload]);
  });
}
const s16 = (lo, hi) => { const v = lo | (hi << 8); return v > 32767 ? v - 65536 : v; };
const fmtBand = (d) => d ? `${d[27] | (d[28] << 8)} Hz ${(s16(d[31], d[32]) / 256).toFixed(2)} dB Q${((d[29] | (d[30] << 8)) / 256).toFixed(2)} type ${d[33]} tag ${d[35]}` : '(no reply)';

try {
  if (op === 'snapshot') {
    const n = parseInt(process.env.BANDS || '8', 10);
    const snap = { bands: {}, other: {} };
    for (let i = 0; i < n; i++) { let d = null; for (let k = 0; k < 3 && !d; k++) d = await readRawBand(i); snap.bands[i] = d; say(`band ${i + 1}: ${fmtBand(d)}`); }
    for (const [name, cmd, p] of [['mic', 0x02, [0]], ['globalGain', 0x03, [0]], ['dacFilter', 0x11, []], ['gainMode', 0x19, [0]], ['workMode', 0x1D, []]]) snap.other[name] = await readRaw(cmd, p);
    writeFileSync(file, JSON.stringify(snap)); say('snapshot saved', file);
  } else if (op === 'restore') {
    const snap = JSON.parse(readFileSync(file, 'utf8'));
    for (const d of Object.values(snap.bands)) { if (!d) continue; const b = d.slice(0, 36); b[0] = 0x01; b[2] = 0x18; await raw.sendReport(0x4B, b); await sleep(25); }
    const g = snap.other.globalGain; if (g) await raw.sendReport(0x4B, [0x01, 0x03, 0x02, g[3], g[4]]);
    await sleep(50); await raw.sendReport(0x4B, [0x01, 0x0A, 0x04, 0x00, 0x00, 0xFF, 0xFF, 0x00]); await sleep(50);
    await raw.sendReport(0x4B, [0x01, 0x01, 0x01, 0x00]); await sleep(300);
    say('restored from', file);
  } else if (op === 'write') {
    const spec = JSON.parse(readFileSync(file, 'utf8'));
    await h.pushToDevice(details(spec.filters.length), {}, spec.slot ?? 101, spec.gain ?? 0, spec.filters);
    await sleep(300); say('pushed', spec.filters.length, 'bands over USB');
  } else if (op === 'raw') {
    // node usb_tool.mjs <pid> <log> raw "80 16 02 01 00" ["80 09 00 00 03 00" …]: send each (after report id 0x4B), print every reply for 400 ms
    for (const h of process.argv.slice(5)) {
      const seen = []; const on = (e) => seen.push(hex(new Uint8Array(e.data.buffer).slice(0, 40)));
      listeners.add(on); await raw.sendReport(0x4B, h.split(/\s+/).map(x => parseInt(x, 16))); await sleep(400); listeners.delete(on);
      say(`${h} ->`); for (const r of seen) say('    ', r);
    }
  } else if (op === 'commit') {
    await raw.sendReport(0x4B, [0x01, 0x0A, 0x04, 0x00, 0x00, 0xFF, 0xFF, 0x00]); await sleep(50);
    await raw.sendReport(0x4B, [0x01, 0x01, 0x01, 0x00]); await sleep(300);
    say('committed over USB (0x0A + 0x01)');
  } else if (op === 'read') {
    const n = parseInt(process.env.BANDS || '8', 10);
    for (let i = 0; i < n; i++) { let d = null; for (let k = 0; k < 3 && !d; k++) d = await readRawBand(i); say(`band ${i + 1}: ${fmtBand(d)}`); }
    const g = await readRaw(0x03, [0]); say('global gain', g ? s16(g[3], g[4]) / 256 : '(no reply)', 'dB  raw', g && hex(g.slice(0, 6)));
  }
} finally { dev.close(); }
