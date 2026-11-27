//
// Copyright 2024 : Pragmatic Audio
//
// Wifiman Lossless Network Handler.
//
// Talks to the local API of the Wifiman Lossless Mac app (loopback only):
//   GET  /v1/state  -> { enabled, active, preamp, filters:[{type,freq,gain,q,disabled}], maxFilters, defaultOutput }
//   PUT  /v1/peq    -> { enabled, preamp, filters }
//
// The app answers CORS preflights (including Private Network Access), so unlike WiiM this
// handler can both push and pull. The first write from a site needs approval in the app:
// the app shows a prompt and the push fails with "approval_required" until it is accepted.
//

const DEFAULT_PORT = 47811;
const TIMEOUT_MS = 4000;

export const wifimanNetworkHandler = (function () {

  function baseUrl(device) {
    const host = typeof device === 'string' ? device : (device?.ip || '127.0.0.1');
    return `http://${host.includes(':') ? host : `${host}:${DEFAULT_PORT}`}`;
  }

  async function request(device, method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl(device)}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch (_) { /* no body */ }
      if (!response.ok) {
        if (data?.error === 'approval_required') {
          throw new Error('Wifiman Lossless is asking you to approve this website. Click Allow in the app, then try again.');
        }
        throw new Error(data?.message || data?.error || `Wifiman Lossless returned HTTP ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Wifiman Lossless did not respond. Is the app running on this Mac?');
      }
      if (error instanceof TypeError) {
        throw new Error('Cannot reach Wifiman Lossless. Start the app and, if Chrome asks, allow local network access for this site.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pullFromDevice(device, slot) {
    const state = await request(device, 'GET', '/v1/state');
    const filters = (state.filters || []).map(f => ({
      type: f.type, freq: f.freq, q: f.q, gain: f.gain, disabled: !!f.disabled,
    }));
    return {
      filters,
      globalGain: state.preamp ?? 0,
      currentSlot: 0,
      deviceDetails: { maxFilters: state.maxFilters ?? 15, active: !!state.active, defaultOutput: state.defaultOutput },
    };
  }

  async function pushToDevice(device, phoneObj, slot, preamp, filters, modelConfig) {
    const max = modelConfig?.maxFilters ?? 15;
    const payload = {
      enabled: true,
      preamp: Number(preamp) || 0,
      filters: (Array.isArray(filters) ? filters : []).slice(0, max).map(f => ({
        type: f.type,
        freq: Number(f.freq),
        gain: Number(f.gain ?? 0),
        q: Number(f.q ?? 1),
        disabled: !!f.disabled,
      })),
    };
    const state = await request(device, 'PUT', '/v1/peq', payload);
    if (state && state.active === false) {
      console.warn('Wifiman: EQ saved, but Wifiman Lossless is not the current Mac output, so it has no effect until you select it.');
    }
    return false; // no device restart needed
  }

  async function enablePEQ(device, enabled, slotId) {
    const state = await request(device, 'GET', '/v1/state');
    await request(device, 'PUT', '/v1/peq', {
      enabled: !!enabled,
      preamp: state.preamp ?? 0,
      filters: state.filters || [],
    });
  }

  async function getCurrentSlot(device) {
    return 0;
  }

  // One "slot"; its label doubles as a status line (is Wifiman the current output?).
  async function getAvailableSlots(device) {
    try {
      const state = await request(device, 'GET', '/v1/state');
      const name = state.active
        ? 'Wifiman Lossless (current output)'
        : `Wifiman Lossless (not current output${state.defaultOutput?.name ? ': ' + state.defaultOutput.name : ''})`;
      return [{ id: 0, name }];
    } catch (error) {
      return [{ id: 0, name: 'Wifiman Lossless (not reachable)' }];
    }
  }

  return { pullFromDevice, pushToDevice, enablePEQ, getCurrentSlot, getAvailableSlots };
})();
