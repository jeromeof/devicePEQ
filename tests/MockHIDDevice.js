/**
 * MockHIDDevice — browser-compatible mock of the Web HID API HIDDevice interface.
 *
 * Usage modes
 * ───────────
 * 1. Exchange-based (recommended for captures)
 *    Pass `exchanges` — each entry describes bytes the handler sends and the
 *    bytes the device fires back via oninputreport.
 *    Commands are matched by exact byte comparison; use `null` in `send.data`
 *    to act as a wildcard for that position.
 *
 * 2. Sequence-based (for ordered scripts)
 *    Pass `sequence` — responses are fired in insertion order regardless of
 *    what command triggered each one. Useful for devices whose responses are
 *    always in a fixed order.
 *
 * Recording real captures
 * ───────────────────────
 * Wrap a real device with MockHIDDevice.record(realDevice) to capture live
 * exchanges and call .exportCapture() to get the JSON for a captures/ file.
 */
export class MockHIDDevice {
  /**
   * @param {object} opts
   * @param {number}   opts.vendorId
   * @param {number}   opts.productId
   * @param {string}   opts.productName
   * @param {number}   [opts.reportId=75]   - default HID report ID
   * @param {Array}    [opts.exchanges=[]]  - pattern-matched exchanges
   * @param {Array}    [opts.sequence=[]]   - ordered response queue (overrides exchanges)
   * @param {number}   [opts.responseDelay=5] - ms between sendReport and oninputreport
   * @param {boolean}  [opts.verbose=false]
   */
  constructor({ vendorId, productId, productName, reportId = 75,
                exchanges = [], sequence = [],
                responseDelay = 5, verbose = false }) {
    this.vendorId    = vendorId;
    this.productId   = productId;
    this.productName = productName;
    this.opened      = false;
    this.oninputreport = null;

    this._reportId     = reportId;
    this._exchanges    = exchanges;
    this._sequence     = [...sequence];        // consumed FIFO
    this._responseDelay = responseDelay;
    this._verbose      = verbose;

    // Observability
    this._sentReports         = [];   // all sendReport() calls recorded
    this._firedResponses      = [];   // all oninputreport firings recorded
    this._unmatchedSends      = [];   // sends with no matching exchange
    this._featureResponseQueue = [];  // queued responses for receiveFeatureReport

    // EventTarget-style listeners (handlers use both oninputreport AND addEventListener)
    this._eventListeners = {};
  }

  // ── EventTarget interface ──────────────────────────────────────────────────

  addEventListener(type, listener) {
    if (!this._eventListeners[type]) this._eventListeners[type] = [];
    if (!this._eventListeners[type].includes(listener))
      this._eventListeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    if (!this._eventListeners[type]) return;
    this._eventListeners[type] = this._eventListeners[type].filter(l => l !== listener);
  }

  // ── Web HID interface ──────────────────────────────────────────────────────

  async open()  { this.opened = true;  }
  async close() { this.opened = false; }

  // Feature Report support (polling protocol — Fosi Audio etc.)
  // sendFeatureReport queues the pre-recorded response; receiveFeatureReport dequeues it.
  async sendFeatureReport(reportId, data) {
    const bytes = Array.from(data instanceof Uint8Array ? data : new Uint8Array(data));
    this._sentReports.push({ type: 'feature', reportId, bytes, ts: Date.now() });
    if (this._verbose) console.log('[MockHID] sendFeatureReport', reportId, bytes);

    const match = this._findExchange(reportId, bytes, true);
    if (match) {
      this._featureResponseQueue.push(...match.responses);
    } else {
      this._unmatchedSends.push({ type: 'feature', reportId, bytes });
      if (this._verbose) console.warn('[MockHID] no feature exchange matched for', bytes);
    }
  }

  async receiveFeatureReport(reportId) {
    const response = this._featureResponseQueue.shift();
    if (!response) {
      if (this._verbose) console.warn('[MockHID] receiveFeatureReport: queue empty');
      return new DataView(new ArrayBuffer(64));
    }
    if (this._verbose) console.log('[MockHID] receiveFeatureReport', response.data);
    const raw = response.data instanceof Uint8Array
      ? response.data : new Uint8Array(response.data);
    return new DataView(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }

  async sendReport(reportId, data) {
    const bytes = Array.from(data instanceof Uint8Array ? data : new Uint8Array(data));
    this._sentReports.push({ reportId, bytes, ts: Date.now() });
    if (this._verbose) console.log('[MockHID] sendReport', reportId, bytes);

    // Sequence mode takes priority
    if (this._sequence.length > 0) {
      const next = this._sequence.shift();
      await this._fire(next);
      return;
    }

    // Exchange pattern mode
    const match = this._findExchange(reportId, bytes);
    if (match) {
      for (const resp of match.responses) {
        await this._fire(resp);
      }
    } else {
      this._unmatchedSends.push({ reportId, bytes });
      if (this._verbose) console.warn('[MockHID] no exchange matched for', bytes);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _findExchange(reportId, bytes, featureReport = false) {
    return this._exchanges.find(ex => {
      // Match by exchange type (regular vs feature report)
      if (!!ex.featureReport !== featureReport) return false;
      if (ex.send.reportId != null && ex.send.reportId !== reportId) return false;
      if (!ex.send.data) return true;   // wildcard — matches anything
      if (ex.send.data.length !== bytes.length) return false;
      return ex.send.data.every((b, i) => b === null || b === bytes[i]);
    });
  }

  async _fire(response) {
    const hasOninputreport = !!this.oninputreport;
    const listeners = this._eventListeners['inputreport'] ?? [];
    if (!hasOninputreport && listeners.length === 0) return;

    const delay = response.delay ?? this._responseDelay;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    const raw = response.data instanceof Uint8Array
      ? response.data
      : new Uint8Array(response.data);

    const event = {
      reportId: response.reportId ?? this._reportId,
      data: new DataView(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
    };
    this._firedResponses.push({ ...event, bytes: Array.from(raw), ts: Date.now() });
    if (this._verbose) console.log('[MockHID] inputreport', Array.from(raw));

    // Dispatch to oninputreport attribute handler
    if (this.oninputreport) this.oninputreport(event);

    // Dispatch to addEventListener listeners (handlers may use either or both)
    for (const listener of [...listeners]) listener(event);
  }

  // ── Test helpers ───────────────────────────────────────────────────────────

  /** Fire a synthetic inputreport event — lets tests simulate device responses. */
  async fireInputReport(reportId, data, delay = 0) {
    await this._fire({ reportId, data: data instanceof Uint8Array ? data : new Uint8Array(data), delay });
  }

  // ── Assertion helpers ──────────────────────────────────────────────────────

  /** Returns all bytes sent by the handler across all sendReport calls. */
  get sentBytes() { return this._sentReports.map(r => r.bytes); }

  /** True if the handler sent a report whose bytes match the given pattern. */
  wasSent(pattern) {
    return this._sentReports.some(r =>
      pattern.every((b, i) => b === null || b === r.bytes[i])
    );
  }

  /** Number of times sendReport was called. */
  get sendCount() { return this._sentReports.length; }

  /** Number of unmatched sends (exchanges missing from capture). */
  get unmatchedCount() { return this._unmatchedSends.length; }

  /** Reset call history without changing the exchange/sequence script. */
  resetHistory() {
    this._sentReports          = [];
    this._firedResponses       = [];
    this._unmatchedSends       = [];
    this._featureResponseQueue = [];
  }

  // ── Live capture recording ─────────────────────────────────────────────────

  /**
   * Wraps a real HIDDevice and records all exchanges.
   * Returns a proxy device whose .exportCapture() method produces JSON
   * ready to save as a tests/captures/*.json file.
   */
  static record(realDevice) {
    const recorded = [];

    const proxy = Object.create(realDevice);
    proxy._recorded = recorded;

    proxy.sendReport = async function(reportId, data) {
      const bytes = Array.from(new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)));
      const entry = { send: { reportId, data: bytes }, responses: [] };
      recorded.push(entry);

      // Intercept the next oninputreport firing(s)
      const origHandler = this.oninputreport;
      this.oninputreport = (event) => {
        entry.responses.push({
          reportId: event.reportId,
          data: Array.from(new Uint8Array(event.data.buffer))
        });
        this.oninputreport = origHandler;  // restore after first response
        if (origHandler) origHandler(event);
      };

      return realDevice.sendReport.call(realDevice, reportId,
        data instanceof Uint8Array ? data : new Uint8Array(data));
    };

    proxy.exportCapture = function() {
      return {
        device: {
          vendorId:    realDevice.vendorId,
          productId:   realDevice.productId,
          productName: realDevice.productName,
        },
        capturedAt: new Date().toISOString(),
        exchanges: this._recorded
      };
    };

    return proxy;
  }
}

/**
 * loadCapture — fetch a JSON capture file and return a ready-to-use MockHIDDevice.
 * @param {string} url  - path to the capture JSON file
 * @param {object} [overrides] - override any MockHIDDevice constructor options
 */
export async function loadCapture(url, overrides = {}) {
  // fetch() resolves relative URLs against the PAGE, not the calling module.
  // Always load from the captures/ folder next to this file so that test
  // files can pass any relative path (e.g. '../captures/foo.json') and it
  // still works regardless of where the test file lives.
  const filename = url.split('/').pop();
  const resolvedUrl = new URL('./captures/' + filename, import.meta.url).href;
  const capture = await fetch(resolvedUrl).then(r => {
    if (!r.ok) throw new Error(`loadCapture: ${r.status} ${r.statusText} — ${resolvedUrl}`);
    return r.json();
  });
  return new MockHIDDevice({
    ...capture.device,
    exchanges: capture.exchanges,
    ...overrides
  });
}
