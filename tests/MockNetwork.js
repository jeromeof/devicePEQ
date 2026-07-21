/**
 * MockNetwork — a tiny routable mock for the global `fetch`, for testing the
 * network device handlers (WiiM, Luxsin X9) without a real device.
 *
 * Usage:
 *   const net = new MockFetch().install();
 *   net.on('EQSetLV2SourceBand', () => opaqueResponse());
 *   ... call handler ...
 *   net.restore();
 *   assert.ok(net.calls.length === 2);
 *
 * Route matching is first-match-wins. A matcher is either a substring of the URL
 * or a predicate (url, options) => boolean. Each route's responder returns a
 * Response-like object (see the helpers below).
 */
export class MockFetch {
  constructor() {
    this.calls = [];     // { url, options }
    this.routes = [];    // { match, respond }
    this._orig = null;
  }

  install() {
    this._orig = globalThis.fetch;
    globalThis.fetch = (url, options = {}) => {
      const u = String(url);
      this.calls.push({ url: u, options });
      for (const r of this.routes) {
        if (r.match(u, options)) return Promise.resolve(r.respond(u, options));
      }
      return Promise.reject(new Error('MockFetch: no route matched ' + u));
    };
    return this;
  }

  restore() {
    if (this._orig) globalThis.fetch = this._orig;
    this._orig = null;
  }

  /** Register a route. `match` is a URL substring or a (url, options) predicate. */
  on(match, respond) {
    const m = typeof match === 'function' ? match : (u) => u.includes(match);
    this.routes.push({ match: m, respond });
    return this;
  }

  get callUrls() { return this.calls.map(c => c.url); }

  /** Calls whose URL contains `substr`. */
  callsMatching(substr) { return this.calls.filter(c => c.url.includes(substr)); }
}

// ── Response-like factories ────────────────────────────────────────────────────

/** A readable JSON response (as a CORS-enabled device or local proxy would give). */
export function jsonResponse(obj, { ok = true, status = 200, type = 'basic' } = {}) {
  return { ok, status, type, json: async () => obj, text: async () => JSON.stringify(obj) };
}

/** A readable text response. */
export function textResponse(str, { ok = true, status = 200, type = 'basic' } = {}) {
  return {
    ok, status, type,
    text: async () => str,
    json: async () => JSON.parse(str),
  };
}

/** An opaque no-cors response: status 0, body unreadable — what WiiM returns in a browser. */
export function opaqueResponse() {
  return {
    ok: false,
    status: 0,
    type: 'opaque',
    json: async () => { throw new Error('opaque response body cannot be read'); },
    text: async () => '',
  };
}

// ── Helpers for parsing requests the handlers make ─────────────────────────────

/**
 * Decode a WiiM Linkplay command URL of the form
 *   https://ip/httpapi.asp?command=<CMD>:<encodeURIComponent(JSON)>
 * Returns { command, payload }.
 */
export function parseWiimCommandUrl(url) {
  const q = url.split('command=')[1] ?? '';
  const colon = q.indexOf(':');
  if (colon === -1) return { command: q, payload: null };
  const command = q.slice(0, colon);
  const rest = q.slice(colon + 1);
  let payload = null;
  try { payload = JSON.parse(decodeURIComponent(rest)); } catch { /* not JSON */ }
  return { command, payload };
}
