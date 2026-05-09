/**
 * DevicePEQ Capture Helper
 * ────────────────────────
 * Patches navigator.hid.requestDevice so every returned HIDDevice is
 * instrumented for recording. Returns the REAL HIDDevice objects (mutated
 * in-place) so Chrome's WebIDL brand-checks on vendorId/productId etc. pass.
 *
 * Console / skill workflow
 * ────────────────────────
 *   // Injected automatically by cdp.mjs inject — no manual step needed.
 *   // After connecting device and pulling, stopCapture() is called by cdp.mjs stop.
 *   startCapture()   // starts recording on the most recently connected device
 *   await stopCapture()  // returns capture JSON and saves to localStorage
 */

(function install() {
  if (!('hid' in navigator)) {
    console.warn('[capture] WebHID not available.');
    return;
  }
  if (navigator.hid.__captureHelperInstalled) {
    console.log('[capture] Already installed.');
    return;
  }

  let _lastDevice = null;
  const _allInstrumented = [];  // track every instrumented device instance

  // ── instrument a real HIDDevice in-place ────────────────────────────────────
  // We patch sendReport and oninputreport directly on the instance so the
  // original HIDDevice object is returned to callers — brand-checks pass.

  function instrumentDevice(real) {
    if (real.__captureWrapped) return real;

    const exchanges   = [];
    let pendingEntry  = null;
    let captureActive = false;

    // Patch sendReport (event-based protocol — responses arrive via inputreport events)
    const origSend = real.sendReport.bind(real);
    let sendSeq = 0;
    const inFlight = [];   // ordered list of exchanges awaiting a response

    real.sendReport = async function(reportId, data) {
      const bytes = Array.from(data instanceof Uint8Array ? data : new Uint8Array(data));
      if (captureActive) {
        const entry = { send: { reportId, data: bytes }, responses: [], _seq: sendSeq++ };
        exchanges.push(entry);
        inFlight.push(entry);
        pendingEntry = entry;
        console.log(`[capture] → send reportId=${reportId}`, bytes);
      }
      return origSend(reportId, data instanceof Uint8Array ? data : new Uint8Array(data));
    };

    // Patch sendFeatureReport + receiveFeatureReport (polling protocol — Fosi Audio etc.)
    // Each sendFeatureReport creates an exchange; the paired receiveFeatureReport fills it.
    if (typeof real.sendFeatureReport === 'function') {
      const origSendFeature = real.sendFeatureReport.bind(real);
      let lastFeatureEntry = null;

      real.sendFeatureReport = async function(reportId, data) {
        const bytes = Array.from(data instanceof Uint8Array ? data : new Uint8Array(data));
        if (captureActive) {
          lastFeatureEntry = { featureReport: true, send: { reportId, data: bytes }, responses: [], _seq: sendSeq++ };
          exchanges.push(lastFeatureEntry);
          console.log(`[capture] → sendFeatureReport reportId=${reportId}`, bytes);
        }
        return origSendFeature(reportId, data instanceof Uint8Array ? data : new Uint8Array(data));
      };

      const origReceiveFeature = real.receiveFeatureReport.bind(real);
      real.receiveFeatureReport = async function(reportId) {
        const result = await origReceiveFeature(reportId);
        if (captureActive && lastFeatureEntry) {
          const bytes = Array.from(new Uint8Array(result.buffer));
          lastFeatureEntry.responses.push({ reportId, data: bytes });
          console.log(`[capture] ← receiveFeatureReport reportId=${reportId}`, bytes);
          lastFeatureEntry = null;
        }
        return result;
      };
    }

    // Intercept oninputreport by calling through to the native prototype setter
    // so Chrome still registers the handler, while we also capture the response.
    const proto       = Object.getPrototypeOf(real);
    const nativeDesc  = Object.getOwnPropertyDescriptor(proto, 'oninputreport');
    const nativeSetter = nativeDesc?.set;
    let _userHandler  = null;

    function makeWrapped(userFn) {
      return function captureWrapper(event) {
        if (captureActive) {
          const bytes = Array.from(new Uint8Array(event.data.buffer));
          // Match to oldest in-flight exchange that has no response yet
          const target = inFlight.shift() ?? pendingEntry;
          if (target) target.responses.push({ reportId: event.reportId, data: bytes });
          console.log(`[capture] ← recv reportId=${event.reportId}`, bytes);
        }
        if (userFn) userFn.call(this, event);
      };
    }

    // Passive addEventListener listener captures responses that arrive via the
    // EventTarget path (e.g. KT Micro handler uses addEventListener, not oninputreport).
    real.addEventListener('inputreport', function(event) {
      if (!captureActive) return;
      const bytes = Array.from(new Uint8Array(event.data.buffer));
      const target = inFlight.shift() ?? pendingEntry;
      if (target) target.responses.push({ reportId: event.reportId, data: bytes });
    });

    if (nativeSetter) {
      // Also intercept oninputreport assignments for handlers that use that path.
      // Note: we do NOT pre-register via nativeSetter(null) here — doing so caused
      // KT Micro write ACKs to be swallowed before the handler's own listener ran.
      Object.defineProperty(real, 'oninputreport', {
        get() { return _userHandler; },
        set(handler) {
          _userHandler = handler;
          nativeSetter.call(real, makeWrapped(handler));
        },
        configurable: true
      });
    }

    // Capture control API on the real device
    real.__captureWrapped  = true;
    real._captureExchanges = exchanges;
    _allInstrumented.push(real);

    real._captureStart = function() {
      exchanges.length = 0;
      pendingEntry = null;
      captureActive = true;
      console.log(`[capture] Recording "${real.productName}" — Pull/Push/change slots, then stopCapture().`);
    };

    real._captureStop = async function() {
      captureActive = false;
      const capture = {
        device: {
          vendorId:    real.vendorId,
          productId:   real.productId,
          productName: real.productName,
        },
        capturedAt: new Date().toISOString(),
        exchanges: [...exchanges]
      };
      const json = JSON.stringify(capture, null, 2);
      console.log(`[capture] Done — ${exchanges.length} exchange(s).`);
      try {
        await navigator.clipboard.writeText(json);
        console.log('[capture] ✓ Copied to clipboard.');
      } catch (_) {}
      return capture;
    };

    return real;
  }

  // ── patch navigator.hid.requestDevice ──────────────────────────────────────

  const origRequestDevice = navigator.hid.requestDevice.bind(navigator.hid);
  navigator.hid.requestDevice = async function(options) {
    const devices = await origRequestDevice(options);
    devices.forEach(d => {
      instrumentDevice(d);
      _lastDevice = d;
      // Also restart capture on any previously-instrumented instance of the same
      // physical device (different JS object, same vendorId/productId) — the
      // connector may reuse the old object if currentDevice was already set.
      _allInstrumented.forEach(prev => {
        if (prev !== d && prev.vendorId === d.vendorId && prev.productId === d.productId) {
          prev._captureStart();
        }
      });
      d._captureStart();  // auto-start recording as soon as device is selected
    });
    return devices;  // return REAL devices, not proxies
  };

  // Also instrument devices already granted (getDevices)
  const origGetDevices = navigator.hid.getDevices.bind(navigator.hid);
  navigator.hid.getDevices = async function() {
    const devices = await origGetDevices();
    devices.forEach(d => {
      instrumentDevice(d);
      // If this matches the active capture device, ensure capture is running on
      // this JS object too — usbHidConnector.checkDeviceConnected may swap
      // device.rawDevice to this new object, so it must have captureActive=true.
      if (_lastDevice && d.vendorId === _lastDevice.vendorId && d.productId === _lastDevice.productId) {
        if (d !== _lastDevice && _lastDevice._captureExchanges) {
          // Redirect: share the same exchanges array and activate capture
          d._captureExchanges = _lastDevice._captureExchanges;
          const origStart = d._captureStart;
          d._captureStart = function() {
            _lastDevice._captureStart?.call(_lastDevice);
            origStart?.call(d);
          };
          // Activate immediately since the parent capture is already running
          d._captureStart();
        }
        _lastDevice = d;
      } else if (!_lastDevice && devices.length > 0) {
        _lastDevice = devices[devices.length - 1];
      }
    });
    return devices;
  };

  Object.defineProperty(navigator.hid, '__captureHelperInstalled', { value: true });

  // ── global API ─────────────────────────────────────────────────────────────

  window.startCapture = function() {
    if (!_lastDevice?._captureStart) {
      console.warn('[capture] No instrumented device yet — connect your device first, then startCapture() is called automatically.');
      return;
    }
    _lastDevice._captureStart();
  };

  window.stopCapture = async function() {
    // Pick the instrumented device with the most exchanges (handles the case
    // where the connector reused an old JS object while we instrumented a new one).
    const best = _allInstrumented.reduce((winner, d) => {
      const dCount = d._captureExchanges?.length ?? 0;
      const wCount = winner?._captureExchanges?.length ?? 0;
      return dCount > wCount ? d : winner;
    }, _lastDevice);
    if (!best?._captureStop) {
      console.warn('[capture] No device to capture from.');
      return null;
    }
    return best._captureStop();
  };

  console.log('[capture] Ready. Connect your device — capture starts automatically on connect.');
})();
