/**
 * MockBLEDevice — browser-compatible mock of a Web Bluetooth GATT device
 * as used by fiioBleHandler (and any future BLE handlers).
 *
 * The handler interface expected:
 *   device.txChar.writeValueWithResponse(Uint8Array)   → Promise<void>
 *   device.txChar.writeValueWithoutResponse(Uint8Array) → Promise<void>
 *   device.txChar.properties.write                     → bool
 *   device.txChar.properties.writeWithoutResponse      → bool
 *   device.readNotification(timeoutMs)                 → Promise<Uint8Array|null>
 *
 * Exchange format (in capture JSON):
 *   { send: [byte,...], response: [byte,...] }
 *
 * Matching: exchanges are matched by command bytes at positions [4] and [5]
 * of the FiiO packet (the 2-byte cmd field). Use null as a wildcard for any
 * position in send[] to match any value there.
 *
 * For push writes where the ACK is always the same regardless of payload,
 * one exchange entry with null-wildcarded payload positions is sufficient.
 */
export class MockBLEDevice {
  /**
   * @param {object} opts
   * @param {string}   opts.productName
   * @param {string}   [opts.manufacturer]
   * @param {Array}    [opts.exchanges=[]]      - pattern-matched { send, response } pairs
   * @param {boolean}  [opts.writeWithResponse=true]  - simulate EH13 (write-with-response)
   * @param {number}   [opts.responseDelay=5]
   * @param {boolean}  [opts.verbose=false]
   */
  constructor({ productName, manufacturer = '', exchanges = [],
                writeWithResponse = true, responseDelay = 5, verbose = false }) {
    this.productName  = productName;
    this.manufacturer = manufacturer;

    this._exchanges    = exchanges;
    this._responseDelay = responseDelay;
    this._verbose      = verbose;

    // Notification queue: handler calls readNotification(), which dequeues here
    this._notificationQueue  = [];
    this._notificationWaiters = [];

    // Observability
    this._sentPackets    = [];
    this._unmatchedSends = [];

    // txChar interface
    const self = this;
    this.txChar = {
      properties: {
        write:                writeWithResponse,
        writeWithoutResponse: !writeWithResponse,
      },
      async writeValueWithResponse(packet) {
        return self._handleWrite(packet);
      },
      async writeValueWithoutResponse(packet) {
        return self._handleWrite(packet);
      },
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async _handleWrite(packet) {
    const bytes = Array.from(packet instanceof Uint8Array ? packet : new Uint8Array(packet));
    this._sentPackets.push(bytes);
    if (this._verbose) console.log('[MockBLE] TX', bytes.map(b => b.toString(16).padStart(2,'0')).join(' '));

    const match = this._findExchange(bytes);
    if (match) {
      if (match.response && match.response.length > 0) {
        const delay = this._responseDelay;
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        this._enqueueNotification(new Uint8Array(match.response));
      }
    } else {
      this._unmatchedSends.push(bytes);
      if (this._verbose) console.warn('[MockBLE] no exchange matched for TX', bytes);
    }
  }

  _findExchange(bytes) {
    return this._exchanges.find(ex => {
      if (!ex.send) return false;
      // Allow null as wildcard for any position
      return ex.send.every((b, i) => b === null || b === bytes[i]);
    });
  }

  _enqueueNotification(data) {
    if (this._notificationWaiters.length > 0) {
      const { resolve, timer } = this._notificationWaiters.shift();
      clearTimeout(timer);
      resolve(data);
    } else {
      this._notificationQueue.push(data);
    }
  }

  // ── Handler interface ───────────────────────────────────────────────────────

  readNotification(timeoutMs = 5000) {
    if (this._notificationQueue.length > 0) {
      if (this._verbose) console.log('[MockBLE] RX (queued)');
      return Promise.resolve(this._notificationQueue.shift());
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this._notificationWaiters = this._notificationWaiters.filter(w => w.resolve !== resolve);
        if (this._verbose) console.warn('[MockBLE] readNotification timeout');
        resolve(null);
      }, timeoutMs);
      this._notificationWaiters.push({ resolve, timer });
    });
  }

  // ── Test helpers ────────────────────────────────────────────────────────────

  get sendCount()      { return this._sentPackets.length; }
  get unmatchedCount() { return this._unmatchedSends.length; }

  resetHistory() {
    this._sentPackets    = [];
    this._unmatchedSends = [];
  }
}

/**
 * loadBleCapture — fetch a JSON BLE capture and return a ready MockBLEDevice.
 * Capture format:
 *   { device: { productName, manufacturer }, exchanges: [{ send, response },...] }
 */
export async function loadBleCapture(url, overrides = {}) {
  const filename    = url.split('/').pop();
  const resolvedUrl = new URL('./captures/' + filename, import.meta.url).href;
  const capture     = await fetch(resolvedUrl).then(r => {
    if (!r.ok) throw new Error(`loadBleCapture: ${r.status} ${r.statusText} — ${resolvedUrl}`);
    return r.json();
  });
  return new MockBLEDevice({
    ...capture.device,
    exchanges: capture.exchanges,
    ...overrides,
  });
}
