// Copyright 2024 : Pragmatic Audio

import { loadPeqConstraintsConfig, resolveConstraints } from './peqConstraints.js';
import { buildExtras } from './deviceExtras.js';

/**
 * Initialise the Device PEQ plugin.
 *
 * Injects the plugin UI into the page, sets up connection logic for all supported
 * transport types (USB HID, USB Serial / Bluetooth SPP, BLE, and Network), and
 * wires up Pull / Push operations that translate between the host EQ graph and the
 * device-specific wire protocol.
 *
 * Supported connection types (resolved at runtime):
 *  - USB HID       – FiiO dongles, KTMicro, Walkplay-based devices, etc.
 *  - USB Serial / Bluetooth SPP – JDS Labs Element IV, Nothing Headphone (1),
 *                    Tanchjim Rita, Moondrop Edge / Edge ANC, EarFun Tune Pro,
 *                    Edifier ConnectX headphones, Audeze Maxwell (SPP fallback)
 *  - Bluetooth BLE – Audeze Maxwell (Airoha GATT)
 *  - Network       – WiiM (HTTP push), Luxsin X9 (HTTP read+write)
 *
 * @param {object} context - Host page context object.
 * @param {Function} context.elemToFilters - Returns current PEQ filter array from the UI.
 * @param {object}  [context.config]         - Optional plugin configuration flags.
 * @param {boolean} [context.config.advanced] - When true, exposes Serial / BLE / Network
 *                                              connection options in the device picker.
 * @param {boolean} [context.config.showExtras] - When true, shows a "Show Extras" button
 *                                              next to the preset dropdown whenever the
 *                                              connected device has supported extras
 *                                              (DAC filter, balance, gain mode, etc.).
 *                                              Expands an inline panel with per-capability
 *                                              controls; each has an Apply button that
 *                                              writes directly to the device.
 * @returns {Promise<void>}
 */
async function initializeDeviceEqPlugin(context) {
  // Initialize console log history array if it doesn't exist
  if (!window.consoleLogHistory) {
    window.consoleLogHistory = [];

    // Store original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    // Flag to control logging visibility
    window.showDeviceLogs = false;

    // Override console.log to capture logs
    console.log = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[LOG] ${logString}`);

      // Call original method only if showLogs is true or we have an experimental device
      if (window.showDeviceLogs) {
        originalConsoleLog.apply(console, arguments);
      }
    };

    // Override console.error to capture errors
    console.error = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[ERROR] ${logString}`);

      // Always show errors regardless of log settings
      originalConsoleError.apply(console, arguments);
    };

    // Override console.warn to capture warnings
    console.warn = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[WARN] ${logString}`);

      // Always show warnings regardless of log settings
      originalConsoleWarn.apply(console, arguments);
    };

    // Limit history to last 500 entries
    const MAX_LOG_HISTORY = 500;
    setInterval(() => {
      if (window.consoleLogHistory.length > MAX_LOG_HISTORY) {
        window.consoleLogHistory = window.consoleLogHistory.slice(-MAX_LOG_HISTORY);
      }
    }, 10000); // Check every 10 seconds
  }

  // Pre-load the peqConstraints config so it is cached before any device connects.
  loadPeqConstraintsConfig().catch(err => console.warn('peqConstraintsConfig failed to load:', err));

  // Returns a compact ID string for console logs across all transport types.
  // USB HID  : "vendorId=0x2972 productId=0x0001"
  // USB Serial: "vendorId=0x152A productId=0x89D3"
  // BLE      : "serviceClassId=00001101-..."
  // Network  : "" (IP logged separately by the handler)
  function deviceIdStr(device) {
    const raw  = device?.rawDevice;
    const info = device?.info;
    // USB HID – HIDDevice exposes vendorId / productId directly
    if (raw?.vendorId != null && raw?.productId != null) {
      return `vendorId=0x${raw.vendorId.toString(16).toUpperCase().padStart(4,'0')} productId=0x${raw.productId.toString(16).toUpperCase().padStart(4,'0')}`;
    }
    // USB Serial – Web Serial stores IDs in the info object captured at connect time
    if (info?.usbVendorId != null && info?.usbProductId != null) {
      return `vendorId=0x${info.usbVendorId.toString(16).toUpperCase().padStart(4,'0')} productId=0x${info.usbProductId.toString(16).toUpperCase().padStart(4,'0')}`;
    }
    // BLE – no hardware IDs available in the browser
    if (info?.bluetoothServiceClassId) {
      return `serviceClassId=${info.bluetoothServiceClassId}`;
    }
    return '';
  }

  // Check if showLogs flag is passed in context
  if (context && context.config && context.config.showLogs === true) {
    window.showDeviceLogs = true;
    console.log("Plugin initialized with showLogs enabled");
  } else {
    console.log("Plugin initialized with context:", context);
  }

  class DeviceEqUI {
    constructor() {
      this.deviceEqArea = document.getElementById('deviceEqArea');
      this.connectButton = this.deviceEqArea.querySelector('.connect-device');
      this.disconnectButton = this.deviceEqArea.querySelector('.disconnect-device');
      this.deviceNameElem = document.getElementById('deviceName');

      // Pill UI elements
      this.linkArea     = document.getElementById('device-link-area');
      this.linkBtn      = document.getElementById('eq-device-connect-btn');
      this.linkPopup    = document.getElementById('device-link-popup');
      this.devicePill   = document.getElementById('device-pill');
      this.devicePillName = document.getElementById('device-pill-name');
      this.devicePillClose = document.getElementById('device-pill-close');
      this.pillIconSync = this.devicePill?.querySelector('.device-pill-icon-sync');

      this.slotRow      = document.getElementById('peq-slot-row');
      this.peqDropdown  = document.getElementById('device-peq-slot-dropdown');
      this.pullButton   = this.deviceEqArea.querySelector('.pull-filters-fromdevice');
      this.pushButton   = this.deviceEqArea.querySelector('.push-filters-todevice');
      this.settingsBtn  = document.getElementById('peq-settings-btn');
      this.extrasPanel  = document.getElementById('device-extras-panel');
      this.lastPushTime = 0;
      this._extrasExpanded = false;

      this._postConnectSetup    = false;
      this._pullOnConnectPromise = null;

      this.settingsBtn.addEventListener('click', () => {
        this._extrasExpanded = !this._extrasExpanded;
        if (this._extrasExpanded) {
          // Pin the panel width before the first paint so selects can't inflate the container
          const w = this.deviceEqArea.offsetWidth;
          if (w > 0) this.extrasPanel.style.maxWidth = w + 'px';
        } else {
          this.extrasPanel.style.maxWidth = '';
        }
        this.extrasPanel.hidden = !this._extrasExpanded;
        this.settingsBtn.classList.toggle('peq-settings-btn--open', this._extrasExpanded);
        this.settingsBtn.setAttribute('aria-expanded', String(this._extrasExpanded));
        if (this._extrasExpanded && this._pendingExtrasReads) {
          this._pendingExtrasReads();
          this._pendingExtrasReads = null;
        }
      });

      this.useNetwork = false;
      this.currentDevice = null;
      this._onDeviceConnected = context?.onDeviceConnected ?? null;

      this.initializeUI();
    }

    // Register a callback invoked whenever a device successfully connects.
    // Signature: callback(device, peqConstraints, currentPEQValues)
    // peqConstraints  – resolved object from peqConstraintsConfig.json.
    // currentPEQValues – filter array pulled from the device, or null if
    //                    pullValuesOnConnect is false or the pull failed.
    setOnDeviceConnected(callback) {
      this._onDeviceConnected = typeof callback === 'function' ? callback : null;
    }

    setPillState(state, deviceName) {
      const isConnected = state === 'connected';
      const isBusy      = state === 'connecting';
      if (this.linkBtn)   this.linkBtn.hidden   = isConnected || isBusy;
      if (this.devicePill) {
        this.devicePill.hidden = !isConnected && !isBusy;
        this.devicePill.classList.toggle('device-pill--busy', isBusy);
      }
      if (deviceName && this.devicePillName) this.devicePillName.textContent = deviceName;
      // Keep deviceNameElem in sync for any external listeners
      if (this.deviceNameElem) this.deviceNameElem.textContent = deviceName ?? (isConnected ? '' : 'None');
    }

    // Silently pulls filters from the device at connect time and fires _onDeviceConnected
    // with the result. Does NOT apply filters to the EQ UI — that is the caller's decision.
    // Explicit "Pull From Device" button clicks apply filters; this only fetches for the callback.
    async _pullOnConnect(device, peqConstraints, slot) {
      let filters = null;
      const idStr = deviceIdStr(device);
      const tag = `"${device.model}"${idStr ? ` (${idStr})` : ''}`;
      const { UsbHIDConnector, UsbSerialConnector, BluetoothBleConnector, NetworkDeviceConnector } = this._connectors ?? {};

      // Yield to the event loop so the connect button handler fully completes
      // (elemToFilters check, event listener setup, etc.) before we start
      // sending HID/Serial read commands. Without this the pull races against
      // the tail of the connection flow and the device times out mid-response.
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        // -1 is the sentinel used by WalkPlay (and similar) meaning "no fixed slot —
        // use whatever is currently selected". Fall back to the dropdown value which
        // is guaranteed populated because of the setTimeout(0) yield above.
        const selectedSlot = (slot == null || slot === -1) ? this.peqDropdown.value : slot;
        console.log(`[peqConstraints] pullValuesOnConnect: pulling from ${tag} slot=${selectedSlot}`);
        let result = null;
        if (this.connectionType === 'network') {
          result = await NetworkDeviceConnector.pullFromDevice(device, selectedSlot);
        } else if (this.connectionType === 'usb') {
          result = await UsbHIDConnector.pullFromDevice(device, selectedSlot);
        } else if (this.connectionType === 'serial') {
          result = await UsbSerialConnector.pullFromDevice(device, selectedSlot);
        } else if (this.connectionType === 'ble') {
          result = await BluetoothBleConnector.pullFromDevice(device, selectedSlot);
        }
        if (result?.filters?.length > 0) {
          filters = result.filters;
          console.log(`[peqConstraints] pullValuesOnConnect: received ${filters.length} filter(s) from ${tag}`);
        } else {
          console.log(`[peqConstraints] pullValuesOnConnect: no filters returned from ${tag}`);
        }
      } catch (err) {
        console.warn(`[peqConstraints] pullValuesOnConnect: pull failed for ${tag}:`, err);
      }
      // Auto-populate EQ if currently empty and we received filters
      if (filters?.length > 0 && context?.elemToFilters && context?.filtersToElem) {
        const current = context.elemToFilters();
        const isEmpty = !current?.length || current.every(f => !f || Math.abs(f?.gain ?? 0) < 0.01);
        if (isEmpty) {
          this._postConnectSetup = true;
          context.filtersToElem(filters);
          context.applyEQ();
          setTimeout(() => { this._postConnectSetup = false; }, 500);
        }
      }
      try { this._onDeviceConnected(device, peqConstraints, filters, device.extras); }
      catch (e) { console.warn('onDeviceConnected callback error:', e); }
    }

    initializeUI() {
      this.setPillState('disconnected');
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.settingsBtn.hidden = true;
      this.extrasPanel.hidden = true;
      this.extrasPanel.innerHTML = '';
      this._extrasExpanded = false;
      this._pendingExtrasReads = null;
      this._postConnectSetup = false;
    }



    async showConnectedState(device, connectionType, availableSlots, currentSlot) {
      // Ensure constraint config is cached before resolving — handles the race where a device
      // connects before the async JSON fetch completes (would return maxFilters: undefined).
      await loadPeqConstraintsConfig().catch(() => {});
      this.setPillState('connecting', device.model);
      this.currentDevice = device;
      this.connectionType = connectionType;
      window.peqDeviceModelConfig = device.modelConfig || null;
      const peqConstraints = resolveConstraints(device.modelConfig);

      // Build extras if the connector hasn't already attached them (e.g. non-USB connectors).
      if (!device.extras) device.extras = buildExtras(device.handler, device);
      window.peqDeviceExtras = device.extras;

      const idStr = deviceIdStr(device);
      console.log(
        `[peqConstraints] connected: "${device.model}"${idStr ? ` (${idStr})` : ''}` +
        ` ref=${device.modelConfig?.peqConstraintsRef ?? 'inline'}` +
        ` bands=${peqConstraints?.maxFilters} gain=${peqConstraints?.minGain}/${peqConstraints?.maxGain}dB`
      );
      document.dispatchEvent(new CustomEvent('PeqDeviceModelConfigChanged', { detail: window.peqDeviceModelConfig }));
      document.dispatchEvent(new CustomEvent('PeqDeviceExtrasChanged', { detail: window.peqDeviceExtras }));
      // Fire immediately so listeners (e.g. graphtool) can update their UI and apply constraints
      // before the async pull completes.
      document.dispatchEvent(new CustomEvent('PeqDeviceConnected', { detail: { device, peqConstraints } }));

      this.populatePeqDropdown(availableSlots, currentSlot);
      this.setPillState('connected', device.model);
      this.pullButton.hidden = false;
      this.pushButton.hidden = false;
      this.pullButton.textContent = `Load from ${device.model}`;
      this.pushButton.textContent = `Save to ${device.model}`;
      // Show slot row inside settings panel only when there are selectable slots
      if (this.slotRow) this.slotRow.hidden = !(availableSlots && availableSlots.length > 0);
      this.settingsBtn.hidden = false;

      // Fetch device filters for the callback when configured. Filters are NOT applied to
      // the EQ graph here — only the explicit "Pull From Device" button does that.
      if (context?.config?.pullValuesOnConnect === true) {
        this._pullOnConnectPromise = this._pullOnConnect(device, peqConstraints, currentSlot)
          .finally(() => { this._pullOnConnectPromise = null; });
      } else if (this._onDeviceConnected) {
        try { this._onDeviceConnected(device, peqConstraints, null, device.extras); }
        catch (e) { console.warn('onDeviceConnected callback error:', e); }
      }

      // Reset settings panel; build extras rows if configured and available
      this.extrasPanel.hidden = true;
      this._extrasExpanded = false;
      this.settingsBtn.setAttribute('aria-expanded', 'false');
      this.settingsBtn.classList.remove('peq-settings-btn--open');
      // Clear only the extras rows (preserve the slot row via _buildExtrasPanel)
      const slotRowEl = document.getElementById('peq-slot-row');
      this.extrasPanel.innerHTML = '';
      if (slotRowEl) this.extrasPanel.appendChild(slotRowEl);
      this._buildExtrasPanel(device.extras);

      // Auto-load flat EQ phone measurement if configured
      if (device.modelConfig && device.modelConfig.flatEQPhoneMeasurement) {
        console.log(`Device "${device.model}" has flatEQPhoneMeasurement: "${device.modelConfig.flatEQPhoneMeasurement}"`);

        // Check if context and loadPairedPhone method are available
        if (context && typeof context.loadPairedPhone === 'function') {
          const result = context.loadPairedPhone(device.modelConfig.flatEQPhoneMeasurement, 'deviceConnection');

          if (result.success) {
            console.log(`Successfully auto-loaded flat EQ measurement for device "${device.model}"`);
            // Optional success toast (non-blocking, 3 seconds)
            if (typeof window.showToast === 'function') {
              window.showToast(
                `Auto-loaded measurement: ${result.phone.fullName || result.phone.fileName}`,
                'success',
                3000
              );
            }
          } else {
            console.warn(`Failed to auto-load flat EQ measurement for device "${device.model}":`, result.error);
            // Don't show error toast - graceful degradation
          }
        } else {
          console.warn('loadPairedPhone method not available in context');
        }
      }

      // Check if the push button should still be disabled based on lastPushTime
      const currentTime = Math.floor(Date.now() / 1000);
      const cooldownTime = 0.2; // Cooldown time in seconds (200ms)

      if (currentTime < this.lastPushTime + cooldownTime) {
        // Button is still in cooldown period
        this.pushButton.disabled = true;
        this.pushButton.style.opacity = "0.5";
        this.pushButton.style.cursor = "not-allowed";

        // Set a new timeout for the remaining cooldown time
        const remainingTime = (this.lastPushTime + cooldownTime) - currentTime;
        setTimeout(() => {
          this.pushButton.disabled = false;
          this.pushButton.style.opacity = "";
          this.pushButton.style.cursor = "";
          console.log("Push button re-enabled after cooldown period");
        }, remainingTime * 1000); // Convert seconds to milliseconds
      }
    }

    showDisconnectedState() {
      this.connectionType = "usb";  // Assume usb
      this.currentDevice = null;
      window.peqDeviceModelConfig = null;
      window.peqDeviceExtras = null;
      document.dispatchEvent(new CustomEvent('PeqDeviceModelConfigChanged', { detail: null }));
      document.dispatchEvent(new CustomEvent('PeqDeviceExtrasChanged', { detail: null }));
      this.setPillState('disconnected');
      this.peqDropdown.innerHTML = '<option value="-1">PEQ Disabled</option>';
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.pullButton.textContent = 'Load from Device';
      this.pushButton.textContent = 'Save to Device';
      this.settingsBtn.hidden = true;
      this.settingsBtn.classList.remove('peq-settings-btn--open');
      this.settingsBtn.setAttribute('aria-expanded', 'false');
      this.extrasPanel.hidden = true;
      const slotRowEl2 = document.getElementById('peq-slot-row');
      this.extrasPanel.innerHTML = '';
      if (slotRowEl2) this.extrasPanel.appendChild(slotRowEl2);
      this._extrasExpanded = false;
      this._pendingExtrasReads = null;
    }

    _hasAnyExtras(extras) {
      if (!extras) return false;
      return Object.values(extras).some(e => e?.supported === true);
    }

    _buildExtrasPanel(extras) {
      const panel = this.extrasPanel;
      // Preserve the slot row — clear only dynamically-added extras rows
      const slotRow = document.getElementById('peq-slot-row');
      panel.innerHTML = '';
      if (slotRow) panel.appendChild(slotRow);
      this._pendingExtrasReads = null;
      // If no extras to show, the panel still contains the slot row (which may itself be hidden).
      if (!this._hasAnyExtras(extras)) return;
      const deferredReads = [];

      // Section wrapper lets style-alt.css compact-Apply override fire
      const section = document.createElement('div');
      section.className = 'peq-extras-section';
      panel.appendChild(section);

      const makeRow = (label, controlHTML, key) => {
        const row = document.createElement('div');
        row.className = 'extras-row';
        // status comes before Apply to match expected visual order
        row.innerHTML = `
          <span class="extras-label">${label}</span>
          <div class="extras-control">${controlHTML}</div>
          <span class="extras-status" id="extras-status-${key}"></span>
          <button class="extras-apply" data-extra="${key}">Apply</button>
        `;
        return row;
      };

      const setStatus = (key, msg, cls = '') => {
        const el = document.getElementById(`extras-status-${key}`);
        if (!el) return;
        el.textContent = msg;
        el.className = 'extras-status' + (cls ? ' ' + cls : '');
        if (cls === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'extras-status'; }, 2000);
      };

      // Deferred: populate is called when panel first opens (not at connect time)
      const deferRead = (key, getterFn, populate) => {
        if (typeof getterFn !== 'function') return;
        deferredReads.push(async () => {
          console.log(`[extras] Reading ${key}…`);
          setStatus(key, 'Reading…');
          try {
            const val = await getterFn();
            console.log(`[extras] ${key} =`, val);
            populate(val);
            setStatus(key, '');
          } catch (e) {
            console.warn(`[extras] ${key} read failed:`, e?.message ?? e);
            if (e?.code !== 'NOT_IMPLEMENTED') setStatus(key, 'Read failed', 'err');
            else setStatus(key, '');
          }
        });
      };

      // ── DAC Filter ────────────────────────────────────────────────────────
      if (extras.dacFilter?.supported) {
        const opts = (extras.dacFilter.options ?? [])
          .map(o => `<option value="${o}">${o}</option>`).join('');
        const row = makeRow('DAC Filter',
          `<select id="extra-dacFilter" class="extras-select">${opts}</select>`, 'dacFilter');
        section.appendChild(row);
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          const val = document.getElementById('extra-dacFilter').value;
          console.log(`[extras] Setting dacFilter →`, val);
          try { await extras.dacFilter.set(val); setStatus('dacFilter', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] dacFilter set failed:', e?.message); setStatus('dacFilter', 'Error', 'err'); }
        });
        deferRead('dacFilter', extras.dacFilter.get,
          val => { const el = document.getElementById('extra-dacFilter'); if (el) el.value = val; });
      }

      // ── DAC Work Mode ─────────────────────────────────────────────────────
      if (extras.dacWorkMode?.supported) {
        const modes = extras.dacWorkMode.modes ?? [0, 1];
        const labels = extras.dacWorkMode.modeLabels ?? modes.map(m => `Mode ${m}`);
        const opts = modes.map((m, i) => `<option value="${m}">${labels[i] ?? `Mode ${m}`}</option>`).join('');
        const row = makeRow('DAC Work Mode',
          `<select id="extra-dacWorkMode" class="extras-select">${opts}</select>`, 'dacWorkMode');
        section.appendChild(row);
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          const val = parseInt(document.getElementById('extra-dacWorkMode').value, 10);
          console.log(`[extras] Setting dacWorkMode →`, val);
          try { await extras.dacWorkMode.set(val); setStatus('dacWorkMode', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] dacWorkMode set failed:', e?.message); setStatus('dacWorkMode', 'Error', 'err'); }
        });
        deferRead('dacWorkMode', extras.dacWorkMode.get, val => {
          const el = document.getElementById('extra-dacWorkMode');
          if (!el) return;
          const knownModes = extras.dacWorkMode.modes ?? [0, 1];
          if (knownModes.includes(val)) {
            el.value = String(val);
          } else {
            const opt = document.createElement('option');
            opt.value = String(val);
            opt.textContent = `Mode ${val} (current)`;
            el.insertBefore(opt, el.firstChild);
            el.value = String(val);
            setStatus('dacWorkMode', `Read: ${val} (non-standard)`, '');
          }
        });
      }

      // ── Gain Mode (dropdown) ───────────────────────────────────────────────
      if (extras.gainMode?.supported) {
        const gainOpts = extras.gainMode.options ?? [
          { label: 'Low Gain', value: false },
          { label: 'High Gain', value: true },
        ];
        const optionsHtml = gainOpts.map((o, i) =>
          `<option value="${i}">${o.label}</option>`
        ).join('');
        const row = makeRow('Gain Mode',
          `<select id="extra-gainMode" class="extras-select">${optionsHtml}</select>`, 'gainMode');
        section.appendChild(row);
        const sel = row.querySelector('#extra-gainMode');
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          const chosen = gainOpts[parseInt(sel.value, 10)];
          console.log(`[extras] Setting gainMode →`, chosen?.value);
          try { await extras.gainMode.set(chosen?.value); setStatus('gainMode', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] gainMode set failed:', e?.message); setStatus('gainMode', 'Error', 'err'); }
        });
        deferRead('gainMode', extras.gainMode.get, val => {
          const idx = gainOpts.findIndex(o => o.value === val || String(o.value) === String(val));
          sel.value = String(idx >= 0 ? idx : 0);
        });
      }

      // ── Balance ───────────────────────────────────────────────────────────
      // Single slider: negative = boost right, positive = boost left
      if (extras.dacBalance?.supported) {
        const row = makeRow('Balance',
          `<div class="extras-slider-row">
             <span style="font-size:11px">L</span>
             <input type="range" id="extra-dacBalance" class="extras-range extras-balance-slider" min="-20" max="20" step="1" value="0">
             <span style="font-size:11px">R</span>
             <span id="extra-dacBalance-lbl" class="extras-balance-lbl">Center</span>
           </div>`, 'dacBalance');
        section.appendChild(row);
        const slider = row.querySelector('#extra-dacBalance');
        const lbl = row.querySelector('#extra-dacBalance-lbl');
        slider.addEventListener('input', () => {
          const v = parseInt(slider.value, 10);
          lbl.textContent = v === 0 ? 'Center' : v > 0 ? `L +${v}` : `R +${-v}`;
        });
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          const v = parseInt(slider.value, 10);
          console.log(`[extras] Setting dacBalance → L=${v > 0 ? v : 0} R=${v < 0 ? -v : 0}`);
          try {
            await extras.dacBalance.set(v > 0 ? v : 0, v < 0 ? -v : 0);
            setStatus('dacBalance', 'Saved ✓', 'ok');
          } catch (e) { console.warn('[extras] dacBalance set failed:', e?.message); setStatus('dacBalance', 'Error', 'err'); }
        });
        // dacBalance has no get
      }

      // ── Mic Gain ──────────────────────────────────────────────────────────
      if (extras.micGain?.supported) {
        const min = extras.micGain.minDb ?? extras.micGain.min ?? -15;
        const max = extras.micGain.maxDb ?? extras.micGain.max ?? 15;
        const row = makeRow('Mic Gain',
          `<div class="extras-slider-row">
             <input type="range" id="extra-micGain" class="extras-range" min="${min}" max="${max}" step="1" value="0">
             <input type="number" id="extra-micGain-num" class="extras-num-input" min="${min}" max="${max}" step="1" value="0">
             <span class="extras-unit">dB</span>
           </div>`, 'micGain');
        section.appendChild(row);
        const sl = row.querySelector('#extra-micGain');
        const num = row.querySelector('#extra-micGain-num');
        sl.addEventListener('input', () => { num.value = sl.value; });
        num.addEventListener('input', () => { sl.value = num.value; });
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          console.log(`[extras] Setting micGain →`, num.value);
          try { await extras.micGain.set(parseFloat(num.value)); setStatus('micGain', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] micGain set failed:', e?.message); setStatus('micGain', 'Error', 'err'); }
        });
        deferRead('micGain', extras.micGain.get, val => { sl.value = val; num.value = val; });
      }

      // ── Noise Reduction ───────────────────────────────────────────────────
      if (extras.denoise?.supported) {
        const row = makeRow('Noise Reduction',
          `<label class="toggle-switch">
             <input type="checkbox" id="extra-denoise">
             <span class="toggle-knob"></span>
           </label>
           <span id="extra-denoise-lbl" style="font-size:12px;color:#666">Off</span>`, 'denoise');
        section.appendChild(row);
        const cb = row.querySelector('#extra-denoise');
        const lbl = row.querySelector('#extra-denoise-lbl');
        cb.addEventListener('change', () => { lbl.textContent = cb.checked ? 'On' : 'Off'; });
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          console.log(`[extras] Setting denoise →`, cb.checked);
          try { await extras.denoise.set(cb.checked); setStatus('denoise', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] denoise set failed:', e?.message); setStatus('denoise', 'Error', 'err'); }
        });
        deferRead('denoise', extras.denoise.get, val => {
          cb.checked = !!val;
          lbl.textContent = val ? 'On' : 'Off';
        });
      }

      // ── Battery (read-only) ───────────────────────────────────────────────
      if (extras.battery?.supported) {
        const row = document.createElement('div');
        row.className = 'extras-row';
        row.innerHTML = `
          <span class="extras-label">Battery</span>
          <div class="extras-control"><span id="extra-battery-val" style="font-size:13px">—</span></div>
          <span class="extras-status" id="extras-status-battery"></span>
        `;
        section.appendChild(row);
        deferRead('battery', extras.battery.get, val => {
          const el = document.getElementById('extra-battery-val');
          if (el) el.textContent = `${val}%`;
        });
      }

      // ── EQ Enabled ────────────────────────────────────────────────────────
      if (extras.eqEnabled?.supported) {
        const row = makeRow('EQ Enabled',
          `<label class="toggle-switch">
             <input type="checkbox" id="extra-eqEnabled">
             <span class="toggle-knob"></span>
           </label>
           <span id="extra-eqEnabled-lbl" style="font-size:12px;color:#666">Off</span>`, 'eqEnabled');
        section.appendChild(row);
        const cb  = row.querySelector('#extra-eqEnabled');
        const lbl = row.querySelector('#extra-eqEnabled-lbl');
        cb.addEventListener('change', () => { lbl.textContent = cb.checked ? 'On' : 'Off'; });
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          console.log(`[extras] Setting eqEnabled →`, cb.checked);
          try { await extras.eqEnabled.set(cb.checked); setStatus('eqEnabled', 'Saved ✓', 'ok'); }
          catch (e) { console.warn('[extras] eqEnabled set failed:', e?.message); setStatus('eqEnabled', 'Error', 'err'); }
        });
        deferRead('eqEnabled', extras.eqEnabled.get, val => {
          cb.checked = !!val;
          lbl.textContent = val ? 'On' : 'Off';
        });
      }

      // ── Output Gain ───────────────────────────────────────────────────────
      if (extras.outputGain?.supported) {
        const row = makeRow('Output Gain',
          `<div class="extras-slider-row">
             <input type="range" id="extra-outputGain" class="extras-range" min="-10" max="10" step="1" value="0">
             <input type="number" id="extra-outputGain-num" class="extras-num-input" min="-10" max="10" step="1" value="0">
             <span class="extras-unit">dB</span>
           </div>`, 'outputGain');
        section.appendChild(row);
        const sl = row.querySelector('#extra-outputGain');
        const num = row.querySelector('#extra-outputGain-num');
        sl.addEventListener('input', () => { num.value = sl.value; });
        num.addEventListener('input', () => { sl.value = num.value; });
        row.querySelector('.extras-apply').addEventListener('click', async () => {
          console.log(`[extras] Setting outputGain →`, num.value);
          try {
            await extras.outputGain.set(parseFloat(num.value));
            setStatus('outputGain', 'Saved ✓ (overwritten on next Push)', 'ok');
          }
          catch (e) { console.warn('[extras] outputGain set failed:', e?.message); setStatus('outputGain', 'Error', 'err'); }
        });
        // outputGain has no get — Push To Device overwrites this register with preamp delta
      }

      // Schedule reads to fire when the panel first opens (avoids racing with pull-on-connect)
      if (deferredReads.length > 0) {
        this._pendingExtrasReads = () => deferredReads.forEach(fn => fn());
      }
    }

    populatePeqDropdown(slots, currentSlot) {
      // "PEQ Disabled" is only meaningful for devices that have a real bypass/disabled
      // preset slot (e.g. FiiO slot 240 = BYPASS). For devices where disabledPresetId
      // is absent or -1 (the sentinel meaning "no disabled slot") we skip the option
      // entirely and fall back to the first real slot when no match is found.
      const disabledPresetId = this.currentDevice?.modelConfig?.disabledPresetId;
      const hasDisabledPreset = disabledPresetId != null && disabledPresetId !== -1;

      this.peqDropdown.innerHTML = hasDisabledPreset
        ? '<option value="-1">PEQ Disabled</option>'
        : '';

      slots.forEach(slot => {
        const option = document.createElement('option');
        option.value = slot.id;
        option.textContent = slot.name;
        this.peqDropdown.appendChild(option);
      });

      if (hasDisabledPreset && currentSlot === -1) {
        this.peqDropdown.selectedIndex = 0;
      } else {
        const matchingOption = Array.from(this.peqDropdown.options)
          .find(opt => opt.value === String(currentSlot));
        if (matchingOption) {
          this.peqDropdown.value = currentSlot;
        } else {
          // No match — select the first real slot rather than a phantom "PEQ Disabled"
          this.peqDropdown.selectedIndex = 0;
        }
      }
    }
  }

  // Function to show toast messages
  // Parameters:
  // - message: The text message to display
  // - type: The type of toast (success, error, warning) with default 'success'
  // - timeout: The time in milliseconds before the toast disappears (default 5000ms)
  // - requireClick: If true, adds a "Continue" button that must be clicked to dismiss the toast (ignores timeout)
  //                 and returns a Promise that resolves when the button is clicked
  //
  // Example usage with await to block execution until user clicks Continue:
  // async function someFunction() {
  //   // Show a toast and wait for user to click Continue
  //   await showToast("Please confirm to continue", "warning", 0, true);
  //   // Code here will only execute after the user clicks Continue
  //   console.log("User clicked Continue");
  // }
  function showToast(message, type = 'success', timeout = 5000, requireClick = false) {
    return new Promise((resolve) => {
      // Create toast element
      const toast = document.createElement('div');
      toast.id = `device-toast-${type}`; // Type-specific ID

      // Create message container
      const messageContainer = document.createElement('div');
      messageContainer.textContent = message;
      toast.appendChild(messageContainer);

      // Set style based on type
      if (type === 'success') {
        toast.style.backgroundColor = '#4CAF50'; // Green
        toast.style.bottom = '80px'; // Bottom position for success
      } else if (type === 'error') {
        toast.style.backgroundColor = '#F44336'; // Red
        toast.style.top = '30px'; // Top position for error
        toast.style.bottom = 'auto'; // Override bottom
      } else if (type === 'warning') {
        toast.style.backgroundColor = '#FF9800'; // Orange
        toast.style.bottom = '30px'; // Bottom position for warning
      }

      // Common styles
      toast.style.color = 'white';
      toast.style.padding = '16px';
      toast.style.borderRadius = '4px';
      toast.style.position = 'fixed';
      toast.style.zIndex = '10000';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%)';
      toast.style.minWidth = '250px';
      toast.style.textAlign = 'center';
      toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';

      // Check for existing toast of the same type
      const existingToast = document.getElementById(`device-toast-${type}`);
      if (existingToast) {
        // Check if the existing toast has a continue button (requireClick=true)
        const continueButton = existingToast.querySelector('button');
        if (continueButton) {
          // If there's an existing toast with a continue button, return early
          // to allow the user to interact with it
          return resolve(); // Resolve immediately since we're not showing a new toast
        }
        document.body.removeChild(existingToast);
      }

      // If requireClick is true, add a continue button
      if (requireClick) {
        // Add a continue button
        const continueButton = document.createElement('button');
        continueButton.textContent = 'Click here to Continue';
        continueButton.style.marginTop = '10px';
        continueButton.style.padding = '5px 15px';
        continueButton.style.backgroundColor = 'white';
        continueButton.style.color = toast.style.backgroundColor;
        continueButton.style.border = 'none';
        continueButton.style.borderRadius = '3px';
        continueButton.style.cursor = 'pointer';
        continueButton.style.fontWeight = 'bold';

        // Add click event to remove the toast and resolve the promise
        continueButton.addEventListener('click', () => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
          resolve(); // Resolve the promise when the button is clicked
        });

        toast.appendChild(continueButton);
      } else {
        // Auto remove after xx seconds if requireClick is false
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
          resolve(); // Resolve the promise when the toast is automatically removed
        }, timeout);
      }

      // Add to document
      document.body.appendChild(toast);
    });
  }

  // Make showToast globally accessible for handlers
  window.showToast = showToast;

  function loadHtml() {
    // Set default values for configuration
    var headingTag = 'h4';

    // Override with context config values if available
    if (context && context.config) {
      if (context.config.devicePEQHeadingTag) {
          headingTag = context.config.devicePEQHeadingTag;
      }
    }
      // Define the HTML to insert
    const deviceEqHTML = `
        <div class="device-eq disabled" id="deviceEqArea">
        <style>
    .peq-info-btn[hidden] { display: none !important; }

    /* Anchor the container width so the extras panel can't push it wider */
    .device-eq {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }

    /* ── Device link area: pill + connect button ─────────────────────────── */
    .device-link-area { padding: 2px 0 4px; display: flex; flex-direction: column; gap: 0; }
    .device-link-row { display: flex; align-items: center; gap: 6px; }
    .device-link-btn {
      display: flex !important;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
      padding: 12px 18px !important;
      background: var(--background-color, #f5f5f5);
      border: 1px solid var(--background-color-contrast-more, #aaa) !important;
      border-radius: 14px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      color: var(--font-color-primary, #111) !important;
      cursor: pointer;
      text-transform: none !important;
      transition: border-color 150ms ease, color 150ms ease;
    }
    .device-link-btn:hover {
      border-color: var(--accent-color, #1a6ef5) !important;
      color: var(--accent-color, #1a6ef5) !important;
    }
    .device-link-btn[hidden] { display: none !important; }
    .device-link-icon { flex-shrink: 0; opacity: 0.7; }
    .device-link-popup {
      margin-top: 4px;
      background: var(--background-color, #fff);
      border: 1px solid var(--background-color-contrast-more, #ccc);
      border-radius: 12px;
      overflow: hidden;
    }
    .device-link-popup[hidden] { display: none !important; }
    .device-link-popup-item {
      display: block !important;
      width: 100% !important;
      padding: 11px 16px !important;
      background: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      color: var(--font-color-primary, #111) !important;
      font-size: 13px !important;
      font-weight: 400 !important;
      text-align: left !important;
      text-transform: none !important;
      cursor: pointer;
      transition: background-color 100ms ease;
    }
    .device-link-popup-item:hover { background: rgba(0,0,0,0.06) !important; }
    .device-link-popup-divider {
      height: 1px;
      background: var(--background-color-contrast-more, #ccc);
      margin: 0;
      opacity: 0.4;
    }
    /* Connected state pill */
    .device-pill {
      background: var(--background-color, #f5f5f5);
      border: 1px solid var(--background-color-contrast-more, #aaa);
      border-radius: 14px;
      overflow: visible;
      margin-bottom: 4px;
    }
    .device-pill[hidden] { display: none !important; }
    .device-pill--busy { border-color: var(--background-color-contrast-more, #aaa); }
    .device-pill-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 10px 14px;
    }
    .device-pill-icon {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      color: var(--font-color-primary, #111);
      opacity: 0.6;
    }
    .device-pill-icon-link { display: block; }
    .device-pill-icon-sync { display: none; }
    .device-pill--busy .device-pill-icon-link { display: none; }
    .device-pill--busy .device-pill-icon-sync { display: block; }
    @keyframes peqPillSpin { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
    .device-pill--busy .device-pill-icon-sync { animation: peqPillSpin 1s linear infinite; opacity: 0.9; }
    .device-pill-name {
      flex: 1 1 auto;
      font-size: 13px !important;
      font-weight: 400 !important;
      color: var(--font-color-primary, #111) !important;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .device-pill-close {
      flex: none !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      width: 24px !important;
      height: 24px !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      border-radius: 50% !important;
      color: var(--font-color-primary, #111) !important;
      font-size: 18px !important;
      line-height: 1 !important;
      cursor: pointer;
      text-transform: none !important;
      opacity: 0.5;
      transition: opacity 150ms ease;
    }
    .device-pill-close:hover { opacity: 1; }
            .info-button {
      background: none;
      border: none;
      font-size: 1.2em;
      cursor: pointer;
      vertical-align: middle;
      margin-left: 6px;
      color: #555;
    }

    .info-button:hover {
      color: #000;
    }

    .modal.hidden {
      display: none;
    }

    .modal {
      position: fixed;
      z-index: 9999;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .modal-content {
      background-color: #fff;
      padding: 20px 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      position: relative;
    }

    .modal-content .close {
      position: absolute;
      right: 16px;
      top: 12px;
      font-size: 1.4em;
      cursor: pointer;
    }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    .tab-button {
      padding: 6px 12px;
      border: none;
      background-color: #eee;
      cursor: pointer;
      border-radius: 4px;
    }

    .tab-button.active {
      background-color: #ccc;
      font-weight: bold;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .sub-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
      border-bottom: 1px solid #ccc;
    }

    .sub-tab-button {
      padding: 4px 10px;
      border: none;
      background: #eee;
      cursor: pointer;
      border-radius: 4px 4px 0 0;
      font-size: 14px;
    }

    .sub-tab-button.active {
      background: #ccc;
      font-weight: bold;
    }

    .sub-tab-content {
      display: none;
    }

    .sub-tab-content.active {
      display: block;
    }

        /* Styles to force checkbox visibility */
    #tab-feedback input[type="checkbox"] {
      -webkit-appearance: checkbox; /* Force WebKit browsers to show default checkbox */
      appearance: compat-auto = checkbox;
      width: 16px;  /* Or any desired size */
      height: 16px; /* Or any desired size */
      opacity: 1;
      position: static; /* Ensure it's not positioned off-screen */
      visibility: visible;
      display: inline-block; /* Or block, depending on layout */
    }

    /* ── Slot row (inside expanded settings panel) ────────────────────────── */
    .peq-slot-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0 4px;
    }
    .peq-slot-row[hidden] { display: none !important; }
    .peq-slot-row select {
      flex: 1 1 auto;
      min-width: 0;
    }

    /* ── Device Extras panel ─────────────────────────────────────────────── */
    .peq-settings-btn {
      position: relative;
      flex: none !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      padding: 0 !important;
      border: none !important;
      border-radius: 6px !important;
      background: transparent !important;
      cursor: pointer;
      text-transform: none !important;
      overflow: visible !important;
    }
    .peq-settings-btn[hidden] { display: none !important; }
    .peq-settings-btn:hover, .peq-settings-btn.peq-settings-btn--open {
      color: var(--accent-color, #1a6ef5) !important;
    }
    .peq-settings-btn-icon {
      display: block;
      width: 18px;
      height: 18px;
      background-color: currentColor;
      mask: var(--icon-eq-settings, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065'/%3E%3Cpath stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0'/%3E%3C/svg%3E"));
      -webkit-mask: var(--icon-eq-settings, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065'/%3E%3Cpath stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0'/%3E%3C%2Fsvg%3E"));
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
      mask-size: 18px 18px;
      -webkit-mask-size: 18px 18px;
    }
    .peq-settings-btn-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      box-sizing: border-box;
      min-width: 11px;
      height: 11px;
      padding: 0 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      border-radius: 2px;
      background: var(--accent-color, #1a6ef5);
      color: #fff;
      pointer-events: none;
    }
    .peq-settings-btn-badge[hidden] { display: none !important; }

    .device-extras-panel {
      border-top: 1px solid var(--background-color-contrast, #e5e5e5);
      padding: 6px 0 2px;
      margin-top: 4px;
      background: transparent;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }

    .peq-extras-section {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
    }

    .extras-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 0;
      border-bottom: 1px solid var(--background-color-contrast, #ebebeb);
      min-width: 0;
      width: 100%;
    }
    .extras-row:last-child { border-bottom: none; }

    .extras-label {
      min-width: 90px;
      max-width: 90px;
      font-size: 13px;
      font-weight: 500;
      color: var(--accent-color-contrast, #444);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .extras-control {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .extras-select {
      font-size: 13px;
      padding: 2px 4px;
      border: 1px solid var(--background-color-contrast-more, #ccc);
      border-radius: 4px;
      background: var(--background-color, #fff);
      color: var(--accent-color-contrast, #333);
      width: 100%;
      min-width: 0;
    }

    .extras-apply {
      flex: none !important;
      padding: 3px 6px !important;
      font-size: 11px !important;
      border-radius: 4px !important;
      text-transform: none !important;
      white-space: nowrap !important;
      cursor: pointer;
      margin-bottom: 0 !important;
      order: unset !important;
    }

    .extras-status {
      font-size: 11px;
      color: var(--accent-color-contrast-inactive, #888);
      min-width: 0;
      white-space: nowrap;
    }
    .extras-status.ok  { color: #2a7; }
    .extras-status.err { color: #c00; }

    /* Toggle switch */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-knob {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #ccc;
      border-radius: 22px;
      transition: .2s;
    }
    .toggle-knob:before {
      position: absolute;
      content: "";
      height: 16px; width: 16px;
      left: 3px; bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: .2s;
    }
    .toggle-switch input:checked + .toggle-knob { background: #4CAF50; }
    .toggle-switch input:checked + .toggle-knob:before { transform: translateX(18px); }

    .extras-slider-row {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .extras-balance-slider { width: 60px; flex: 1 1 40px; min-width: 0; }
    .extras-balance-lbl { font-size: 12px; min-width: 40px; max-width: 60px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .extras-num-input {
      width: 36px;
      flex-shrink: 0;
      font-size: 13px;
      padding: 2px 4px;
      border: 1px solid var(--background-color-contrast-more, #ccc);
      border-radius: 4px;
      background: var(--background-color, #fff);
      color: var(--accent-color-contrast, #333);
    }
    .extras-range { width: 60px; flex: 1 1 40px; min-width: 0; }
    .extras-unit { font-size: 12px; color: var(--accent-color-contrast-inactive, #666); flex-shrink: 0; }
        </style>
            ${context?.config?.showTitle !== false ? `<${headingTag}>Device PEQ</${headingTag}>` : ''}
            <!-- Hidden internal proxy buttons (backward-compat: external code can set data-connectionType and click these) -->
            <button class="connect-device" hidden style="display:none!important"></button>
            <button class="disconnect-device" hidden style="display:none!important"><span id="deviceName" hidden></span></button>
            <!-- Visible connection UI: pill when connected, link button when disconnected -->
            <div id="device-link-area" class="device-link-area"${context?.config?.showConnectButton === false ? ' hidden' : ''}>
                <div class="device-link-row">
                    <button type="button" id="eq-device-connect-btn" class="device-link-btn"
                            aria-expanded="false" aria-haspopup="menu">
                        <svg class="device-link-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        ${context?.config?.connectButtonLabel ?? 'Link Device'}
                    </button>
                    <div id="device-pill" class="device-pill" hidden>
                        <div class="device-pill-row">
                            <span class="device-pill-icon">
                                <svg class="device-pill-icon-link" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                <svg class="device-pill-icon-sync" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>
                            </span>
                            <span id="device-pill-name" class="device-pill-name"></span>
                            <button type="button" id="device-pill-close" class="device-pill-close" aria-label="Disconnect">×</button>
                        </div>
                    </div>
                    <button id="deviceInfoBtn" class="peq-info-btn" aria-label="Device Help" title="Device Help" ${context?.config?.showInfoButton === false ? 'hidden' : ''}>ℹ️</button>
                </div>
                <div id="device-link-popup" class="device-link-popup" hidden role="menu" aria-label="Connection type"></div>
            </div>
            <div class="filters-button">
                <button class="pull-filters-fromdevice peq-load-btn">Load from Device</button>
                <button class="push-filters-todevice peq-save-btn">Save to Device</button>
                <button type="button" class="peq-settings-btn" id="peq-settings-btn" hidden
                        aria-label="Device settings" title="Device settings" aria-expanded="false">
                    <span class="peq-settings-btn-icon" aria-hidden="true"></span>
                    <span class="peq-settings-btn-badge" aria-hidden="true">i</span>
                </button>
            </div>
            <div class="device-extras-panel" id="device-extras-panel" hidden>
                <div class="peq-slot-row" id="peq-slot-row" hidden>
                    <select name="device-peq-slot" id="device-peq-slot-dropdown">
                        <option value="None" selected>Select PEQ Slot</option>
                    </select>
                </div>
            </div>
        </div>
        <!-- Modal -->
        <div id="deviceInfoModal" class="modal hidden">
          <div class="modal-content">
            <button id="closeModalBtn" class="close" aria-label="Close Modal">&times;</button>
            <h3>About Device PEQ - v0.20</h3>

            <div class="tabs">
              <button class="tab-button active" data-tab="tab-overview">Overview</button>
              <button class="tab-button" data-tab="tab-supported">Supported Devices</button>
              <button class="tab-button" data-tab="tab-howto">How to Use</button>
              <button class="tab-button" data-tab="tab-feedback">Feedback</button>
            </div>

            <div id="tab-overview" class="tab-content active">
              <p>Connect to a compatible audio device and read or write its Parametric EQ (PEQ) settings directly from the browser. Supported connection types: USB HID, USB Serial, Bluetooth BLE, Bluetooth SPP, and Network (HTTP).</p>
              <p><strong>Key features:</strong></p>
              <ul style="margin-top: 4px;">
                <li><strong>Pull &amp; Push PEQ</strong> — read filters from the device, adjust them in the graph, push them back</li>
                <li><strong>Listen via Device</strong> — route audio through the connected device with inverse-EQ compensation so you hear a flat reference while tuning</li>
                <li><strong>Neutral PEQ auto-load</strong> — when a BLE headphone connects, the matching Neutral PEQ measurement is automatically loaded into the graph as a tuning reference</li>
                <li><strong>Device Extras</strong> — access hardware controls such as EQ on/off, gain mode, DAC filter, balance, mic gain, and output level (where supported)</li>
                <li><strong>Multiple EQ slots</strong> — switch between presets/slots directly from the UI</li>
              </ul>
              <details>
                <summary style="cursor: pointer; font-weight: bold; margin-top: 10px;">Supported Brands &amp; Manufacturers <span style="font-weight: normal; color: #666; font-size: 90%;">(click to expand)</span></summary>
                <ul style="margin-top: 8px;">
                  <li><strong>FiiO / Jade Audio:</strong> JA11, KA15, KA17, FX17, QX13 (USB HID)</li>
                  <li><strong>Walkplay-based:</strong> Moondrop Marigold/Chu II DSP/Quark2, Tanchjim Stargate II/Space Pro/One DSP/Bunny DSP, EPZ TP13, KiwiEars Allegro/Allegro Pro, JCally JM98 Max/Hi-Max, DDHiFi DSP Cable, Nicehck Octave, CrinEar Protocol Max, and more</li>
                  <li><strong>KTMicro:</strong> Moondrop CDSP/Chu II DSP, Tanchjim One DSP/Bunny DSP, KiwiEars Allegro Mini/Allegro Pro, KT02H20, and more</li>
                  <li><strong>Fosi Audio:</strong> DS3 (USB HID)</li>
                  <li><strong>JDS Labs:</strong> Element IV (USB Serial)</li>
                  <li><strong>Nothing:</strong> Headphone (1) (USB Serial / Bluetooth SPP)</li>
                  <li><strong>WiiM:</strong> Network push of parametric EQ</li>
                  <li><strong>Luxsin:</strong> X9 — full read + write over local network (HTTP)</li>
                  <li><strong>Audeze:</strong> Maxwell — 10-band PEQ, 4 presets (Bluetooth BLE preferred, SPP fallback)</li>
                  <li><strong>FiiO:</strong> EH11 / EH13 — 10-band PEQ (Bluetooth BLE)</li>
                  <li><strong>Tanchjim:</strong> Rita — 12-band PEQ (Bluetooth SPP)</li>
                  <li><strong>Moondrop:</strong> Edge / Edge ANC — 5-band PEQ (Bluetooth SPP)</li>
                  <li><strong>EarFun:</strong> Tune Pro — 10-band graphic EQ, write only (Bluetooth SPP)</li>
                  <li><strong>Edifier:</strong> W830NB / ConnectX — 4-band PEQ, write only (Bluetooth SPP)</li>
                  <li><em>Experimental:</em> Many more devices that have not been fully tested — marked accordingly but may work fine</li>
                </ul>
              </details>
            </div>

            <div id="tab-supported" class="tab-content">
              <div class="sub-tabs">
                <button class="sub-tab-button active" data-subtab="sub-fiio">FiiO</button>
                <button class="sub-tab-button" data-subtab="sub-walkplay">Walkplay</button>
                <button class="sub-tab-button" data-subtab="sub-ktmicro">KTMicro</button>
                <button class="sub-tab-button" data-subtab="sub-fosi">Fosi Audio</button>
                <button class="sub-tab-button" data-subtab="sub-jdslabs">JDS Labs</button>
                <button class="sub-tab-button" data-subtab="sub-nothing">Nothing</button>
                <button class="sub-tab-button" data-subtab="sub-wiim">WiiM</button>
                <button class="sub-tab-button" data-subtab="sub-luxsin">Luxsin</button>
                <button class="sub-tab-button" data-subtab="sub-bt-headphones">BT Headphones</button>
              </div>

              <div id="sub-fiio" class="sub-tab-content active">
                <h5>FiiO / Jade Audio</h5>
                <p>Tested FiiO USB HID devices:</p>
                <ul>
                  <li>Jade Audio JA11</li>
                  <li>FiiO KA15</li>
                  <li>FiiO KA17</li>
                  <li>FiiO FX17 (with USB-C adapter)</li>
                  <li>FiiO QX13</li>
                  <li><em>Note:</em> Retro Nano has limited compatibility</li>
                </ul>
                <p>If a FiiO device works with <a href="https://fiiocontrol.fiio.com" target="_blank">fiiocontrol.fiio.com</a> it should work here too.</p>
                <p>FiiO EH11 and EH13 Bluetooth headphones are supported via BLE — see the BT Headphones tab.</p>
              </div>

              <div id="sub-walkplay" class="sub-tab-content">
                <h5>Walkplay-Based Devices</h5>
                <p>Walkplay licenses their DSP to many brands. The following are confirmed working:</p>
                <ul>
                  <li>Moondrop Marigold (IEM)</li>
                  <li>Moondrop Chu II DSP (IEM)</li>
                  <li>Moondrop Quark2 DSP (IEM)</li>
                  <li>Tanchjim Stargate II (IEM)</li>
                  <li>Tanchjim Space Pro (IEM)</li>
                  <li>Tanchjim One DSP (IEM)</li>
                  <li>Tanchjim Bunny DSP (IEM)</li>
                  <li>EPZ TP13 (Dongle)</li>
                  <li>KiwiEars Allegro / Allegro Pro (Dongle)</li>
                  <li>JCally JM98 Max / Hi-Max (Dongle)</li>
                  <li>DDHiFi DSP Cable</li>
                  <li>Nicehck Octave</li>
                  <li>CrinEar Protocol Max</li>
                </ul>
                <p>Walkplay also have a web editor at <a href="https://peq.szwalkplay.com" target="_blank">peq.szwalkplay.com</a> and an Android app.</p>
                <p><em>Note:</em> Walkplay's app and website cache EQ state in the cloud, so values pushed here may not appear in their app.</p>
              </div>

              <div id="sub-ktmicro" class="sub-tab-content">
                <h5>KTMicro Devices</h5>
                <p>Confirmed working KTMicro DSP devices:</p>
                <ul>
                  <li>Moondrop CDSP</li>
                  <li>Moondrop Chu II DSP</li>
                  <li>Tanchjim One DSP (IEM)</li>
                  <li>Tanchjim Bunny DSP (IEM)</li>
                  <li>KiwiEars Allegro Mini</li>
                  <li>KiwiEars Allegro Pro</li>
                  <li>KT02H20 HiFi Audio</li>
                  <li>JCally JM12</li>
                </ul>
                <p>Many other KTMicro-based devices should also work — they share the same USB HID protocol.</p>
              </div>

              <div id="sub-fosi" class="sub-tab-content">
                <h5>Fosi Audio</h5>
                <p>Supports USB HID PEQ control for Fosi Audio devices using Feature Reports.</p>
                <ul>
                  <li>Fosi Audio DS3 — 10-band parametric EQ, gain ±12 dB, read + write</li>
                </ul>
                <p>Connect via "USB HID Device". Pull reads all 10 bands; Push writes and commits them in one operation.</p>
              </div>

              <div id="sub-jdslabs" class="sub-tab-content">
                <h5>JDS Labs</h5>
                <p>Supports PEQ control over USB Serial. If it works on <a href="https://core.jdslabs.com" target="_blank">JDS Labs Core PEQ</a> it should work here too. Pull and push supported.</p>
                <ul>
                  <li>JDS Labs Element IV</li>
                </ul>
                <p><em>Note:</em> This option is only visible in advanced mode.</p>
              </div>

              <div id="sub-nothing" class="sub-tab-content">
                <h5>Nothing</h5>
                <p>Beta support for Nothing Headphone (1) via USB Serial or Bluetooth SPP. Up to 8 parametric filters, read + write.</p>
                <ul>
                  <li>Nothing Headphone (1)</li>
                </ul>
                <p>The device has preset slots (Balanced, Voice, More Treble, More Bass, Custom). Only the Custom slot supports writing parametric EQ.</p>
                <p><em>Note:</em> Requires Web Serial API — Chrome or Edge only.</p>
              </div>

              <div id="sub-wiim" class="sub-tab-content">
                <h5>WiiM</h5>
                <p>Network-based PEQ push for WiiM streamers. Requires entering the device's local IP address and selecting the audio source (Wi-Fi, Bluetooth, etc.).</p>
                <p><em>Note:</em> This option is only visible in advanced mode.</p>
              </div>

              <div id="sub-luxsin" class="sub-tab-content">
                <h5>Luxsin X9</h5>
                <p>Full network-based read + write PEQ control via local HTTP. No HTTPS certificate setup needed.</p>
                <ul>
                  <li>Find the X9 IP in the Luxsin/WalkPlay app.</li>
                  <li>Choose Network → Luxsin X9, enter the IP.</li>
                  <li>Optional: click "Test IP" — a new tab should show encoded text at <code>/dev/info.cgi?action=syncData</code>.</li>
                  <li>Pull or Push filters after connecting.</li>
                </ul>
              </div>

              <div id="sub-bt-headphones" class="sub-tab-content">
                <h5>Bluetooth Headphones</h5>
                <p>Use "Bluetooth (BLE) Device" for BLE devices, or "Serial USB or Bluetooth Device" for SPP. Pair your headphones before connecting.</p>
                <ul>
                  <li>
                    <strong>Audeze Maxwell</strong> (BLE preferred, SPP fallback) — Airoha chipset.
                    10-band PEQ, 4 presets. Read + write. Auto-loads Neutral PEQ measurement on connect.
                    Connect via "Bluetooth (BLE) Device".
                  </li>
                  <li>
                    <strong>FiiO EH11 / EH13</strong> (Bluetooth BLE) — FiiO proprietary protocol.
                    10-band PEQ, gain ±20 dB. Read + write.
                    Connect via "Bluetooth (BLE) Device".
                  </li>
                  <li>
                    <strong>Tanchjim Rita</strong> (Bluetooth SPP) — 12-band PEQ.
                    Gain ±15 dB. Read + write.
                    Connect via "Serial USB or Bluetooth Device".
                  </li>
                  <li>
                    <strong>Moondrop Edge / Edge ANC</strong> (Bluetooth SPP) — 5-band PEQ.
                    Gain ±12 dB. Read + write.
                    Connect via "Serial USB or Bluetooth Device".
                  </li>
                  <li>
                    <strong>EarFun Tune Pro</strong> (Bluetooth SPP) — 10-band graphic EQ.
                    Fixed Q; gain ±12 dB. <em>Write only.</em>
                    Connect via "Serial USB or Bluetooth Device".
                  </li>
                  <li>
                    <strong>Edifier W830NB / ConnectX</strong> (Bluetooth SPP) — 4-band PEQ.
                    Gain ±6 dB; frequency snapped to lookup table. <em>Write only.</em>
                    Connect via "Serial USB or Bluetooth Device".
                  </li>
                </ul>
                <p><em>Note:</em> Bluetooth requires Chrome, Edge, or Opera with Web Bluetooth / Web Serial API support.</p>
              </div>
            </div>

            <div id="tab-howto" class="tab-content">
              <h5>USB / HID Devices</h5>
              <ul>
                <li><strong>Connect:</strong> Click "Connect to Device" → "USB HID Device" and select your device from the browser prompt.</li>
                <li><strong>Select slot:</strong> If the device has multiple EQ presets, choose the slot you want to edit.</li>
                <li><strong>Pull:</strong> Click "Pull From Device" to read the current PEQ filters into the graph.</li>
                <li><strong>Edit:</strong> Adjust filters on the graph or in the filter table.</li>
                <li><strong>Push:</strong> Click "Push To Device" to write the filters back. Some devices reboot briefly after a write.</li>
                <li><strong>Disconnect:</strong> Click "Disconnect" to close the connection cleanly.</li>
              </ul>
              <h5 style="margin-top: 10px;">Bluetooth BLE Devices (e.g. Audeze Maxwell, FiiO EH13)</h5>
              <ul>
                <li>Click "Connect to Device" → "Bluetooth (BLE) Device" and select your headphone from the browser Bluetooth picker.</li>
                <li>The device connects, Pull runs automatically, and the Neutral PEQ measurement is loaded into the graph if one is configured.</li>
                <li>Edit filters and click "Push To Device" to apply. The connection stays open — no reboot needed.</li>
                <li>If "Listen via Device" appears, enable it to route audio through the headphone with inverse-EQ compensation for flat-reference monitoring.</li>
              </ul>
              <h5 style="margin-top: 10px;">Bluetooth SPP Devices (e.g. Tanchjim Rita, Moondrop Edge)</h5>
              <ul>
                <li>Pair the headphone with your computer first.</li>
                <li>Click "Connect to Device" → "Serial USB or Bluetooth Device" and select the paired Bluetooth serial port.</li>
                <li>Pull, edit, and Push as with USB devices.</li>
              </ul>
              <h5 style="margin-top: 10px;">Network Devices</h5>
              <p><strong>Luxsin X9:</strong> Choose Network → Luxsin X9, enter the device IP (from the Luxsin/WalkPlay app), optionally click Test IP, then Pull or Push.</p>
              <p><strong>WiiM:</strong> Choose Network → WiiM, accept the self-signed HTTPS certificate if prompted. Push is supported; Pull may be limited by browser security.</p>
              <p>⚠️ Some devices require the official app to enable USB EQ editing before they will respond to this tool.</p>
            </div>

            <div id="tab-feedback" class="tab-content">
              <p><strong>Help us improve!</strong> Your feedback is valuable. Please let us know about your experience with Device PEQ.</p>

              <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                <input type="checkbox" id="modal-is-working-checkbox" style="margin-right: 8px;">
                <label for="modal-is-working-checkbox" style="font-size: 14px;">
                  Feature is working correctly
                </label>
              </div>

              <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                <input type="checkbox" id="modal-include-logs-checkbox" style="margin-right: 8px;">
                <label for="modal-include-logs-checkbox" style="font-size: 14px;">
                  Include console logs to help diagnose issues
                </label>
              </div>

              <div style="margin-bottom: 10px; text-align: left;">
                <label for="modal-device-name-input" style="font-size: 14px; display: block; margin-bottom: 5px;">
                  Device Name (optional):
                </label>
                <input type="text" id="modal-device-name-input" placeholder="Enter your device name" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
              </div>

              <div style="margin-bottom: 10px; text-align: left;">
                <label for="modal-comments-input" style="font-size: 14px; display: block; margin-bottom: 5px;">
                  Comments (optional):
                </label>
                <textarea id="modal-comments-input" placeholder="Please describe any issues you're experiencing or suggestions you have..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 100px;"></textarea>
              </div>

              <div style="text-align: center; margin-top: 15px;">
                <button id="modal-feedback-button" class="button">Send Feedback</button>
                <div id="modal-feedback-status" style="margin-top: 10px; display: none;"></div>
              </div>
            </div>
          </div>
        </div>
    `;
    // More flexible way to insert HTML into the DOM
    var placement = 'afterend';
    var anchorDiv = '.extra-eq';
    if (context && context.config ) {
        if (context.config.devicePEQPlacement) {
            placement = context.config.devicePEQPlacement;
        }
        if (context.config.devicePEQAnchorDiv) {
            anchorDiv = context.config.devicePEQAnchorDiv;
        }
    }

      // Find the <div class="extra-eq"> element
    const extraEqElement = document.querySelector(anchorDiv);

    if (extraEqElement) {
      // Insert the new HTML below the "extra-eq" div
      extraEqElement.insertAdjacentHTML(placement, deviceEqHTML);
      console.log('Device EQ UI added ' + placement + ' <div class="' + deviceEqHTML + '">');
    } else {
      console.error('Element <div class="extra-eq"> not found in the DOM.');
    }
// Open modal
    document.getElementById('deviceInfoBtn').addEventListener('click', () => {
      document.getElementById('deviceInfoModal').classList.remove('hidden');
    });

// Close modal via close button
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.getElementById('deviceInfoModal').classList.add('hidden');
    });

// Optional: close modal when clicking outside content
    document.getElementById('deviceInfoModal').addEventListener('click', (e) => {
      if (e.target.id === 'deviceInfoModal') {
        document.getElementById('deviceInfoModal').classList.add('hidden');
      }
    });

    document.querySelectorAll(".tab-button").forEach(btn => {
      btn.addEventListener("click", () => {
        // Toggle active tab button
        document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        // Show correct tab content
        const tabId = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(tabId).classList.add("active");
      });
    });

    document.querySelectorAll(".sub-tab-button").forEach(button => {
      button.addEventListener("click", () => {
        // Update button state
        document.querySelectorAll(".sub-tab-button").forEach(b => b.classList.remove("active"));
        button.classList.add("active");

        // Show corresponding sub-tab
        const tabId = button.getAttribute("data-subtab");
        document.querySelectorAll(".sub-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(tabId).classList.add("active");
      });
    });

    // Function to collect recent console logs
    function collectConsoleLogs() {
      // Return the last 100 console logs that contain plugin-related keywords
      if (!window.consoleLogHistory) {
        return "No console logs available";
      }

      // Filter logs related to the plugin
      const pluginLogs = window.consoleLogHistory.filter(log =>
        log.includes("Device") ||
        log.includes("PEQ") ||
        log.includes("USB") ||
        log.includes("plugin") ||
        log.includes("connector")
      );

      // Return the last 100 logs or all if less than 100
      return pluginLogs.slice(-100).join("\n");
    }

    // Set up feedback form submission
    document.getElementById("modal-feedback-button").addEventListener("click", () => {
      // Get values from form elements
      const includeLogsCheckbox = document.getElementById("modal-include-logs-checkbox");
      const isWorkingCheckbox = document.getElementById("modal-is-working-checkbox");
      const deviceNameInput = document.getElementById("modal-device-name-input");
      const commentsInput = document.getElementById("modal-comments-input");
      const statusContainer = document.getElementById("modal-feedback-status");

      // If console log is empty, capture it now
      let logs = "";
      if (includeLogsCheckbox && includeLogsCheckbox.checked) {
        logs = collectConsoleLogs();
      }

      // Show status message
      statusContainer.style.display = "block";
      statusContainer.style.padding = "8px";
      statusContainer.style.borderRadius = "4px";
      statusContainer.style.textAlign = "center";
      statusContainer.style.backgroundColor = "#f8f9fa";
      statusContainer.style.color = "#333";
      statusContainer.textContent = "Submitting your feedback...";

      // Submit to Google Form
      submitFeedbackToGoogleForm(
        deviceNameInput && deviceNameInput.value ? deviceNameInput.value : "Not specified",
        commentsInput,
        logs,
        isWorkingCheckbox && isWorkingCheckbox.checked,
        statusContainer
      );
    });

    async function submitFeedbackToGoogleForm(deviceName, comments, logs, isWorking, statusContainer) {
      const formData = new URLSearchParams();
      formData.append('entry.1909598303', deviceName);
      formData.append('entry.1928983035', comments && comments.value ? comments.value : "No comments provided");
      formData.append('entry.466843002', logs || "No logs available");
      formData.append('entry.1088832316', isWorking ? "Working" : "Not Working");

      try {
        const response = await fetch('https://docs.google.com/forms/d/e/1FAIpQLSfSaNpdpAvd39tOupDqzyUW_aFEVawywAz4xls4m1z2_T3BOQ/formResponse', {
          method: 'POST',
          mode: 'no-cors', // Google Forms requires no-cors mode
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });

        // Note: With no-cors mode, we can't access the response details
        // But we can assume it worked if no error was thrown
        console.log("Google Form Submission Completed");

        statusContainer.style.backgroundColor = "#d4edda";
        statusContainer.style.color = "#155724";
        statusContainer.textContent = "Thank you for your feedback!";

        setTimeout(() => {
          statusContainer.style.display = "none";
        }, 3000);

      } catch (error) {
        console.error("Error submitting to Google Form:", error);
        statusContainer.style.backgroundColor = "#f8d7da";
        statusContainer.style.color = "#721c24";
        statusContainer.textContent = "Failed to submit feedback.";
      }
    }
  }

  try {
    // Dynamically import USB and Network connectors
    const UsbHIDConnectorAsync = await import('./usbHidConnector.js').then((module) => module.UsbHIDConnector);
    const UsbHIDConnector = await UsbHIDConnectorAsync;
    console.log('UsbHIDConnector loaded');

    const UsbSerialConnectorAsync = await import('./usbSerialConnector.js').then((module) => module.UsbSerialConnector);
    const UsbSerialConnector = await UsbSerialConnectorAsync;
    console.log('UsbSerialConnector loaded');

    const BluetoothBleConnectorAsync = await import('./bluetoothBleConnector.js').then((module) => module.BluetoothBleConnector);
    const BluetoothBleConnector = await BluetoothBleConnectorAsync;
    console.log('BluetoothBleConnector loaded');

    const NetworkDeviceConnectorAsync = await import('./networkDeviceConnector.js').then((module) => module.NetworkDeviceConnector);
    const NetworkDeviceConnector = await NetworkDeviceConnectorAsync;
    console.log('NetworkDeviceConnector loaded');

    if ('hid' in navigator) { // Only support browsers with HID support for now
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initializeDeviceEQ());
      } else {
        // DOM is already loaded
        initializeDeviceEQ();
      }

      function initializeDeviceEQ() {
        // Dynamically load the HTML we need in the right place
        loadHtml();

        const deviceEqUI = new DeviceEqUI();

        // Inject connector references so _pullOnConnect can reach them.
        // The connectors are const-scoped to this try block; the class method
        // can't close over them directly, so we store them on the instance here.
        deviceEqUI._connectors = { UsbHIDConnector, UsbSerialConnector, BluetoothBleConnector, NetworkDeviceConnector };

        // Show the Connect button if WebHID is supported
        deviceEqUI.deviceEqArea.classList.remove('disabled');

        // ── Pill: build connection-type popup ────────────────────────────────
        const DEFAULT_LINK_TYPES = [
          { label: 'USB',                type: 'usb'    },
          { label: 'Serial / Bluetooth', type: 'serial' },
          { label: 'Bluetooth (BLE)',    type: 'ble'    },
          { label: 'Network',            type: 'network'},
        ];
        const linkTypes = context?.config?.connectionTypes
          ?? DEFAULT_LINK_TYPES.filter(t => t.type !== 'network' || context?.config?.showNetwork === true);

        if (deviceEqUI.linkPopup && context?.config?.advanced && linkTypes.length > 0) {
          linkTypes.forEach((entry, i) => {
            if (i > 0) {
              const sep = document.createElement('div');
              sep.className = 'device-link-popup-divider';
              sep.setAttribute('role', 'separator');
              deviceEqUI.linkPopup.appendChild(sep);
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'device-link-popup-item';
            btn.setAttribute('role', 'menuitem');
            btn.textContent = entry.label;
            btn.dataset.type = entry.type;
            deviceEqUI.linkPopup.appendChild(btn);
          });
        }

        function closeLinkPopup() {
          if (deviceEqUI.linkPopup) deviceEqUI.linkPopup.hidden = true;
          if (deviceEqUI.linkBtn) deviceEqUI.linkBtn.setAttribute('aria-expanded', 'false');
        }

        // Pill link button click — simple: direct USB; advanced: toggle popup
        if (deviceEqUI.linkBtn) {
          deviceEqUI.linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!context?.config?.advanced) {
              deviceEqUI.connectButton.dataset.connectionType = 'usb';
              deviceEqUI.setPillState('connecting');
              deviceEqUI.connectButton.click();
              return;
            }
            const isOpen = deviceEqUI.linkPopup && !deviceEqUI.linkPopup.hidden;
            if (isOpen) { closeLinkPopup(); return; }
            if (deviceEqUI.linkPopup) deviceEqUI.linkPopup.hidden = false;
            deviceEqUI.linkBtn.setAttribute('aria-expanded', 'true');
          });
        }

        // Popup item clicks (non-network close and trigger; network shows dialog first)
        if (deviceEqUI.linkPopup) {
          deviceEqUI.linkPopup.addEventListener('click', async (e) => {
            const item = e.target.closest('.device-link-popup-item');
            if (!item) return;
            e.stopPropagation();
            const type = item.dataset.type;
            closeLinkPopup();
            if (type === 'network') {
              const result = await showNetworkConnectionDialog();
              if (!result) return;
              deviceEqUI.connectButton.dataset.connectionType = 'network';
              deviceEqUI.connectButton.dataset.networkIp = result.ipAddress || '';
              deviceEqUI.connectButton.dataset.networkDeviceType = result.deviceType || 'WiiM';
            } else {
              deviceEqUI.connectButton.dataset.connectionType = type;
            }
            deviceEqUI.setPillState('connecting');
            deviceEqUI.connectButton.click();
          });
          // Click outside device-link-area closes popup
          document.addEventListener('click', (e) => {
            if (deviceEqUI.linkPopup && !deviceEqUI.linkPopup.hidden &&
                deviceEqUI.linkArea && !deviceEqUI.linkArea.contains(e.target)) {
              closeLinkPopup();
            }
          });
        }

        // Pill × button → disconnect
        if (deviceEqUI.devicePillClose) {
          deviceEqUI.devicePillClose.addEventListener('click', () => {
            deviceEqUI.disconnectButton.click();
          });
        }

        // Internal connect button handler (used by pill popup AND external proxy callers)
        deviceEqUI.connectButton.addEventListener('click', async () => {
          try {
            const preselected = deviceEqUI.connectButton.dataset.connectionType;
            let selection;
            if (preselected === 'network') {
              selection = {
                connectionType: 'network',
                ipAddress:      deviceEqUI.connectButton.dataset.networkIp || '',
                deviceType:     deviceEqUI.connectButton.dataset.networkDeviceType || 'WiiM',
              };
              delete deviceEqUI.connectButton.dataset.connectionType;
              delete deviceEqUI.connectButton.dataset.networkIp;
              delete deviceEqUI.connectButton.dataset.networkDeviceType;
            } else if (preselected) {
              selection = { connectionType: preselected };
              delete deviceEqUI.connectButton.dataset.connectionType;
            } else if (context.config.advanced) {
              // Fallback for direct external clicks without preset
              selection = await showConnectionMenu(deviceEqUI.linkBtn ?? deviceEqUI.connectButton);
              if (!selection) return;
            } else {
              selection = { connectionType: 'usb' };
            }

            if (selection.connectionType == "network") {
              if (!selection.ipAddress) {
                showToast("Please enter a valid IP address.", "error");
                return;
              }
              setCookie("networkDeviceIP", selection.ipAddress, 30); // Save IP for 30 days
              setCookie("networkDeviceType", selection.deviceType, 30); // Store device type for 30 days

              // Connect via Network using the provided IP
              const device = await NetworkDeviceConnector.getDeviceConnected(selection.ipAddress, selection.deviceType);
              if (device?.handler == null) {
                showToast("Sorry, this network device is not currently supported.", "error");
                await NetworkDeviceConnector.disconnectDevice();
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device) {
                await deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await NetworkDeviceConnector.getAvailableSlots(device),
                  await NetworkDeviceConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }
              }
            } else if (selection.connectionType == "usb") {
              // Connect via USB and show the HID device picker
              const device = await UsbHIDConnector.getDeviceConnected();
              // If the user cancelled the chooser, just exit silently
              if (device?.cancelled) {
                deviceEqUI.setPillState('disconnected');
                return;
              }
              // If device is explicitly marked unsupported or has no handler, show unsupported toast
              if (device?.unsupported || device?.handler == null) {
                showToast("Sorry, this USB device is not currently supported.", "error");
                await UsbHIDConnector.disconnectDevice();
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device) {
                // Check if the device is experimental
                const isExperimental = device.modelConfig?.experimental === true;

                if (isExperimental) {
                  // Enable logs for experimental devices
                  showDeviceLogs = true;
                  console.log(`Enabling detailed logs for experimental device: ${device.model}`);

                  // Show warning popup for experimental devices
                  const proceedWithConnection = await showExperimentalDeviceWarning(device.model);
                  if (!proceedWithConnection) {
                    await UsbHIDConnector.disconnectDevice();
                    return;
                  }
                }

                await deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbHIDConnector.getAvailableSlots(device),
                  await UsbHIDConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            } else if (selection.connectionType == "serial") {
              // Connect via USB and show the Serial device picker
              const device = await UsbSerialConnector.getDeviceConnected();
              // If the user cancelled the chooser, just exit silently
              if (device?.cancelled) {
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device?.handler == null) {
                showToast("Sorry, this USB Serial device is not currently supported.", "error");
                await UsbSerialConnector.disconnectDevice();
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device) {
                // Check if the device is experimental
                const isExperimental = device.modelConfig?.experimental === true;

                if (isExperimental) {
                  // Enable logs for experimental devices
                  window.showDeviceLogs = true;
                  console.log(`Enabling detailed logs for experimental serial device: ${device.model}`);

                  // Show warning popup for experimental devices
                  const proceedWithConnection = await showExperimentalDeviceWarning(device.model);
                  if (!proceedWithConnection) {
                    await UsbSerialConnector.disconnectDevice();
                    return;
                  }
                }

                await deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbSerialConnector.getAvailableSlots(device),
                  await UsbSerialConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            } else if (selection.connectionType == "ble") {
              const device = await BluetoothBleConnector.getDeviceConnected();
              if (device?.cancelled) {
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device?.unsupported || device?.handler == null) {
                showToast("Sorry, this Bluetooth device is not currently supported.", "error");
                await BluetoothBleConnector.disconnectDevice();
                deviceEqUI.setPillState('disconnected');
                return;
              }
              if (device) {
                const isExperimental = device.modelConfig?.experimental === true;

                if (isExperimental) {
                  window.showDeviceLogs = true;
                  console.log(`Enabling detailed logs for experimental BLE device: ${device.model}`);

                  const proceedWithConnection = await showExperimentalDeviceWarning(device.model);
                  if (!proceedWithConnection) {
                    await BluetoothBleConnector.disconnectDevice();
                    return;
                  }
                }

                await deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await BluetoothBleConnector.getAvailableSlots(device),
                  await BluetoothBleConnector.getCurrentSlot(device)
                );

                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }

                device.rawDevice.addEventListener('gattserverdisconnected', () => {
                  console.log(`Device ${device.model} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            }
          } catch (error) {
            console.error("Error connecting to device:", error);
            showToast("Failed to connect to the device.", "error");
            deviceEqUI.setPillState('disconnected');
          }
        });


        // Cookie functions
        function setCookie(name, value, days) {
          let expires = "";
          if (days) {
            const date = new Date();
            date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
            expires = "; expires=" + date.toUTCString();
          }
          document.cookie = name + "=" + value + "; path=/" + expires;
        }

        function getCookie(name) {
          const nameEQ = name + "=";
          const cookies = document.cookie.split(';');
          for (let i = 0; i < cookies.length; i++) {
            let c = cookies[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
          }
          return null;
        }

        function deleteCookie(name) {
          document.cookie = name + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC";
        }

        // Function to show warning for experimental devices
        function showExperimentalDeviceWarning(deviceName) {
          return new Promise((resolve) => {
            const dialogHTML = `
              <div id="experimental-device-dialog" style="
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: #fff;
                  padding: 20px;
                  border-radius: 8px;
                  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.3);
                  text-align: center;
                  z-index: 10000;
                  min-width: 340px;
                  font-family: Arial, sans-serif;
              ">
                <h3 style="margin-bottom: 10px; color: #d9534f;">Experimental Device Warning</h3>
                <p style="color: black; margin-bottom: 15px;">
                  <strong>${deviceName}</strong> is marked as an experimental device.
                  This means it hasn't been fully tested and while it may work perfectly, it may not work as expected.
                </p>
                <p style="color: black; margin-bottom: 15px;">
                  If the device is working for you please consider submiting feedback below, and we will mark it as not experimental in the next release.
                  If you noticed any issues, please disconnect the device and then come back here and submit feedback below.
                </p>
                <p style="color: black; margin-bottom: 15px;">
                  Would you like to proceed with the connection anyway?
                </p>

                <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                  <button id="proceed-button" style="padding: 8px 15px; background: #5cb85c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Proceed
                  </button>
                  <button id="cancel-button" style="padding: 8px 15px; background: #d9534f; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Cancel
                  </button>
                </div>

                <div style="border-top: 1px solid #eee; padding-top: 15px;">
                  <p style="color: black; margin-bottom: 10px;">
                    <strong>Help us improve!</strong> If you proceed, please consider providing feedback:
                  </p>
                  <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                    <input type="checkbox" id="is-working-checkbox" style="margin-right: 8px;">
                    <label for="is-working-checkbox" style="color: black; font-size: 14px;">
                      Feature is working correctly
                    </label>
                  </div>
                  <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                    <input type="checkbox" id="include-logs-checkbox" style="margin-right: 8px;">
                    <label for="include-logs-checkbox" style="color: black; font-size: 14px;">
                      Include console logs to help diagnose issues
                    </label>
                  </div>
                  <div style="margin-bottom: 10px; text-align: left;">
                    <label for="comments-input" style="color: black; font-size: 14px; display: block; margin-bottom: 5px;">
                      Comments (optional):
                    </label>
                    <textarea id="comments-input" placeholder="Please describe any issues you're experiencing..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 60px;"></textarea>
                  </div>
                  <button id="feedback-button" style="padding: 8px 15px; background: #5bc0de; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Send Feedback
                  </button>
                </div>
              </div>
            `;

            // Force checkboxes
            const styleFix = document.createElement("style");
            styleFix.innerHTML = `
              input[type="checkbox"] {
                appearance: auto !important;
                -webkit-appearance: auto !important;
                width: 16px;
                height: 16px;
                vertical-align: middle;
              }
            `;
            document.head.appendChild(styleFix);

            const dialogContainer = document.createElement("div");
            dialogContainer.innerHTML = dialogHTML;
            document.body.appendChild(dialogContainer);

            // Proceed button
            document.getElementById("proceed-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve(true);
            });

            // Cancel button
            document.getElementById("cancel-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve(false);
            });

            // Function to collect recent console logs
            function collectConsoleLogs() {
              // Return the last 100 console logs that contain plugin-related keywords
              if (!window.consoleLogHistory) {
                return "No console logs available";
              }

              // Filter logs related to the plugin
              const pluginLogs = window.consoleLogHistory.filter(log =>
                log.includes("Device") ||
                log.includes("PEQ") ||
                log.includes("USB") ||
                log.includes("plugin") ||
                log.includes("connector")
              );

              // Return the last 100 logs or all if less than 100
              return pluginLogs.slice(-100).join("\n");
            }

            // Feedback button
            document.getElementById("feedback-button").addEventListener("click", () => {
              // Get values from form elements
              const includeLogsCheckbox = document.getElementById("include-logs-checkbox");
              const isWorkingCheckbox = document.getElementById("is-working-checkbox");
              const commentsInput = document.getElementById("comments-input");

              // If console log is empty, capture it now
              let logs = "";
              if (includeLogsCheckbox && includeLogsCheckbox.checked) {
                logs = collectConsoleLogs();
              }

              // Show status message
              const statusContainer = document.createElement("div");
              statusContainer.style.marginTop = "10px";
              statusContainer.style.padding = "8px";
              statusContainer.style.borderRadius = "4px";
              statusContainer.style.textAlign = "center";
              statusContainer.style.backgroundColor = "#f8f9fa";
              statusContainer.style.color = "#333";
              statusContainer.textContent = "Submitting your feedback...";

              // Add status container after the feedback button
              document.getElementById("feedback-button").insertAdjacentElement('afterend', statusContainer);

              // Submit to Google Form
              submitToGoogleFormProxy(deviceName, commentsInput, logs, isWorkingCheckbox && isWorkingCheckbox.checked, statusContainer);
            });

            async function submitToGoogleFormProxy(deviceName, comments, logs, isWorking, statusContainer) {
              const formData = new URLSearchParams();
              formData.append('entry.1909598303', deviceName);
              formData.append('entry.1928983035', comments && comments.value ? comments.value : "No comments provided");
              formData.append('entry.466843002', logs || "No logs available");
              formData.append('entry.1088832316', isWorking ? "Working" : "Not Working");

              try {
                const response = await fetch('https://docs.google.com/forms/d/e/1FAIpQLSfSaNpdpAvd39tOupDqzyUW_aFEVawywAz4xls4m1z2_T3BOQ/formResponse', {
                  method: 'POST',
                  mode: 'no-cors', // Google Forms requires no-cors mode
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: formData.toString()
                });

                // Note: With no-cors mode, we can't access the response details
                // But we can assume it worked if no error was thrown
                console.log("Google Form Submission Completed");

                statusContainer.style.backgroundColor = "#d4edda";
                statusContainer.style.color = "#155724";
                statusContainer.textContent = "Thank you for your feedback!";

                setTimeout(() => {
                  if (statusContainer.parentNode) {
                    statusContainer.parentNode.removeChild(statusContainer);
                  }
                }, 3000);

              } catch (error) {
                console.error("Error submitting to Google Form Proxy:", error);
                statusContainer.style.backgroundColor = "#f8d7da";
                statusContainer.style.color = "#721c24";
                statusContainer.textContent = "Failed to submit feedback.";
              }
            }
          });
        }

        function injectConnectionMenuCSS() {
          if (document.getElementById('peq-conn-menu-styles')) return;
          const style = document.createElement('style');
          style.id = 'peq-conn-menu-styles';
          style.textContent = `
            /* Fallback styles for devicePEQ connection menu (applied when host CSS is absent) */
            .device-link-popup:not([hidden]) {
              display: block;
              background: #fff;
              border: 1px solid rgba(0,0,0,0.15);
              border-radius: 12px;
              overflow: hidden;
              margin-top: 4px;
            }
            .device-link-popup-item {
              display: block !important;
              width: 100% !important;
              padding: 11px 16px !important;
              background: transparent !important;
              border: none !important;
              border-radius: 0 !important;
              color: inherit !important;
              font-family: inherit;
              font-size: 13px !important;
              font-weight: 400 !important;
              text-align: left !important;
              text-transform: none !important;
              cursor: pointer;
            }
            .device-link-popup-item:hover {
              background-color: rgba(0,0,0,0.06) !important;
            }
            .device-link-popup-divider {
              height: 1px;
              background: rgba(0,0,0,0.12);
              margin: 0;
            }
            .peq-network-form {
              padding: 12px 16px 14px;
              font-size: 13px;
            }
            .peq-network-form p {
              margin: 0 0 8px;
              font-size: 13px;
              font-weight: 500;
            }
            .peq-network-radio-group {
              display: flex;
              gap: 16px;
              margin: 0 0 6px;
            }
            .peq-network-radio-group label {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              cursor: pointer;
              font-weight: normal;
            }
            .peq-network-help {
              font-size: 12px;
              color: #666;
              margin-bottom: 8px;
              min-height: 1em;
            }
            .peq-network-ip-input {
              width: 100%;
              padding: 8px 10px;
              border: 1px solid rgba(0,0,0,0.2);
              border-radius: 6px;
              font-size: 13px;
              box-sizing: border-box;
              margin-bottom: 10px;
            }
            .peq-network-actions {
              display: flex;
              gap: 8px;
            }
            .peq-network-actions button {
              flex: 1;
              padding: 8px;
              border: none;
              border-radius: 6px;
              font-size: 13px;
              cursor: pointer;
              font-family: inherit;
            }
            .peq-network-btn-back {
              background: rgba(0,0,0,0.07);
              color: inherit;
            }
            .peq-network-btn-back:hover { background: rgba(0,0,0,0.12); }
            .peq-network-btn-connect {
              background: #28a745;
              color: #fff;
            }
            .peq-network-btn-connect:hover { background: #218838; }
          `;
          document.head.appendChild(style);
        }

        function showNetworkConnectionDialog() {
          return new Promise((resolve) => {
            const storedIP = getCookie('networkDeviceIP') || '';
            const storedDeviceType = getCookie('networkDeviceType') || 'WiiM';

            const overlay = document.createElement('div');
            overlay.id = 'peq-network-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';

            overlay.innerHTML = `
              <div id="peq-network-dialog" style="
                background:#fff; padding:24px; border-radius:10px;
                box-shadow:0 6px 24px rgba(0,0,0,0.3); text-align:center;
                z-index:10000; min-width:340px; max-width:460px; width:90%;
                font-family:Arial,sans-serif; max-height:90vh; overflow-y:auto;
              ">
                <h3 style="margin:0 0 6px;color:#111;">Network Device</h3>
                <p style="color:#444;margin:0 0 14px;font-size:13px;">Select your device type and enter its local IP address.</p>

                <div style="display:flex;justify-content:center;gap:16px;margin-bottom:10px;">
                  <label style="display:inline-flex;align-items:center;gap:5px;font-weight:bold;color:#111;cursor:pointer;">
                    <input type="radio" name="peq-net-dev" value="WiiM" ${storedDeviceType === 'WiiM' ? 'checked' : ''}
                      style="width:16px;height:16px;appearance:auto!important;-webkit-appearance:radio!important;accent-color:#007BFF;">
                    WiiM
                  </label>
                  <label style="display:inline-flex;align-items:center;gap:5px;font-weight:bold;color:#111;cursor:pointer;">
                    <input type="radio" name="peq-net-dev" value="Luxsin" ${storedDeviceType === 'Luxsin' ? 'checked' : ''}
                      style="width:16px;height:16px;appearance:auto!important;-webkit-appearance:radio!important;accent-color:#007BFF;">
                    Luxsin X9
                  </label>
                  <label style="display:inline-flex;align-items:center;gap:5px;font-weight:bold;color:#888;cursor:default;">
                    <input type="radio" name="peq-net-dev" value="coming-soon" disabled
                      style="width:16px;height:16px;appearance:auto!important;-webkit-appearance:radio!important;">
                    Other (coming soon)
                  </label>
                </div>

                <!-- Per-device help text -->
                <div id="peq-net-help" style="
                  text-align:left;background:#f9f9f9;padding:12px;border-radius:6px;
                  font-size:13px;color:#222;margin-bottom:12px;
                ">
                  <div id="peq-help-wiim">
                    <p style="margin:0 0 6px;"><strong>WiiM</strong></p>
                    <p style="margin:0 0 6px;">WiiM uses HTTPS with a self-signed certificate. Your browser will warn that the connection is not private — this is expected.</p>
                    <p style="margin:0 0 6px;">To proceed, open the device page in a new tab and accept the certificate warning. After that, this tool can push PEQ settings to the device (reading settings is limited by browser security).</p>
                    <p style="margin:0;">Tip: Use the <strong>WiiM Home app</strong> to find the device IP address.</p>
                  </div>
                  <div id="peq-help-luxsin" style="display:none;">
                    <p style="margin:0 0 6px;"><strong>Luxsin X9</strong></p>
                    <p style="margin:0 0 6px;">Luxsin X9 uses a simple HTTP interface — no certificate acceptance required. You can both read (pull) and write (push) PEQ settings.</p>
                    <p style="margin:0 0 6px;">When you test the IP, this tool opens <code>/dev/info.cgi?action=syncData</code> on the device; if correct you'll see encoded text content (expected).</p>
                    <p style="margin:0;">Tip: Use the <strong>Luxsin/WalkPlay app</strong> to find the device IP address.</p>
                  </div>
                </div>

                <input type="text" id="peq-net-ip" placeholder="Enter IP Address (e.g. 192.168.1.50)"
                  value="${storedIP}"
                  style="width:100%;padding:9px 10px;border:1px solid #ccc;border-radius:6px;
                         font-size:13px;box-sizing:border-box;margin-bottom:8px;">

                <button id="peq-test-ip-btn" style="
                  display:none;width:100%;margin-bottom:8px;padding:8px;font-size:13px;
                  background:#ffc107;color:#000;border:none;border-radius:5px;cursor:pointer;
                ">Test IP Address</button>

                <div style="display:flex;gap:8px;margin-top:4px;">
                  <button id="peq-net-cancel" style="
                    flex:1;padding:10px;font-size:13px;background:#aaa;
                    color:#fff;border:none;border-radius:5px;cursor:pointer;
                  ">Cancel</button>
                  <button id="peq-net-connect" style="
                    flex:2;padding:10px;font-size:13px;background:#28a745;
                    color:#fff;border:none;border-radius:5px;cursor:pointer;
                  ">Connect</button>
                </div>
              </div>
            `;

            document.body.appendChild(overlay);

            const ipInput     = overlay.querySelector('#peq-net-ip');
            const testBtn     = overlay.querySelector('#peq-test-ip-btn');
            const helpWiim    = overlay.querySelector('#peq-help-wiim');
            const helpLuxsin  = overlay.querySelector('#peq-help-luxsin');

            function updateHelp(type) {
              helpWiim.style.display   = type === 'WiiM'   ? 'block' : 'none';
              helpLuxsin.style.display = type === 'Luxsin' ? 'block' : 'none';
              if (testBtn.style.display !== 'none') {
                testBtn.textContent = type === 'WiiM' ? 'Open WiiM Status (HTTPS)' : 'Open Luxsin Sync Data (HTTP)';
              }
            }
            updateHelp(storedDeviceType);

            overlay.querySelectorAll('input[name="peq-net-dev"]').forEach(r => {
              try {
                r.style.setProperty('appearance', 'auto', 'important');
                r.style.setProperty('-webkit-appearance', 'radio', 'important');
              } catch(e) {}
              r.addEventListener('change', () => updateHelp(r.value));
            });

            ipInput.addEventListener('input', () => {
              const valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ipInput.value.trim());
              testBtn.style.display = valid ? 'block' : 'none';
              const type = overlay.querySelector('input[name="peq-net-dev"]:checked')?.value || 'WiiM';
              testBtn.textContent = type === 'WiiM' ? 'Open WiiM Status (HTTPS)' : 'Open Luxsin Sync Data (HTTP)';
            });

            testBtn.addEventListener('click', () => {
              const ip = ipInput.value.trim();
              const type = overlay.querySelector('input[name="peq-net-dev"]:checked')?.value || 'WiiM';
              if (type === 'WiiM') {
                if (confirm(`This will open a new tab to https://${ip}.\nIf you see a security warning (ERR_CERT_AUTHORITY_INVALID), click Advanced and accept the self-signed certificate to proceed.`)) {
                  window.open(`https://${ip}/httpapi.asp?command=getStatusEx`, '_blank', 'noopener,noreferrer');
                }
              } else {
                if (confirm(`This will open a new tab to http://${ip}/dev/info.cgi?action=syncData.\nIf the IP is correct you should see encoded text returned by the device.`)) {
                  window.open(`http://${ip}/dev/info.cgi?action=syncData`, '_blank', 'noopener,noreferrer');
                }
              }
            });

            overlay.querySelector('#peq-net-cancel').addEventListener('click', () => {
              document.body.removeChild(overlay);
              resolve(null);
            });

            overlay.querySelector('#peq-net-connect').addEventListener('click', () => {
              const ip = ipInput.value.trim();
              if (!ip) { showToast('Please enter a valid IP address.', 'error'); return; }
              const selectedDevice = overlay.querySelector('input[name="peq-net-dev"]:checked')?.value || 'WiiM';
              document.body.removeChild(overlay);
              resolve({ connectionType: 'network', ipAddress: ip, deviceType: selectedDevice });
            });
          });
        }

        function showConnectionMenu(triggerEl) {
          return new Promise((resolve) => {
            injectConnectionMenuCSS();

            // Toggle: if a menu is already open, close it and bail.
            const existing = document.getElementById('peq-conn-type-menu');
            if (existing) { existing.remove(); resolve(null); return; }

            // Insert the dropdown below the button's containing row, not inside it,
            // so it isn't treated as a flex sibling of the button.
            const rowEl = triggerEl.closest('.settings-row') || triggerEl;
            const popupEl = document.createElement('div');
            popupEl.id = 'peq-conn-type-menu';
            popupEl.className = 'device-link-popup';
            popupEl.setAttribute('role', 'menu');
            rowEl.insertAdjacentElement('afterend', popupEl);

            function closeMenu() {
              document.getElementById('peq-conn-type-menu')?.remove();
              document.removeEventListener('click', handleOutsideClick, true);
            }

            function handleOutsideClick(e) {
              if (!popupEl.contains(e.target) && e.target !== triggerEl) {
                closeMenu();
                resolve(null);
              }
            }

            const DEFAULT_TYPES = [
              { label: 'USB Device',         type: 'usb'     },
              { label: 'Serial / Bluetooth', type: 'serial'  },
              { label: 'Bluetooth (BLE)',     type: 'ble'     },
              { label: 'Network',            type: 'network' },
            ];
            const types = context?.config?.connectionTypes
              ?? DEFAULT_TYPES.filter(t => t.type !== 'network' || context?.config?.showNetwork === true);
            types.forEach((entry, i) => {
              if (i > 0) {
                const sep = document.createElement('div');
                sep.className = 'device-link-popup-divider';
                sep.setAttribute('role', 'separator');
                popupEl.appendChild(sep);
              }
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'device-link-popup-item';
              btn.setAttribute('role', 'menuitem');
              btn.textContent = entry.label;
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenu();
                if (entry.type !== 'network') {
                  resolve({ connectionType: entry.type });
                } else {
                  // Network needs its own detailed modal
                  showNetworkConnectionDialog().then(resolve);
                }
              });
              popupEl.appendChild(btn);
            });

            // Delay attaching outside-click listener to avoid the current click closing the menu
            setTimeout(() => document.addEventListener('click', handleOutsideClick, true), 0);
          });
        }



        // Disconnect Button Event Listener
        deviceEqUI.disconnectButton.addEventListener('click', async () => {
          try {
            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb")  {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial")  {
              await UsbSerialConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "ble")  {
              await BluetoothBleConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          } catch (error) {
            console.error("Error disconnecting:", error);
            showToast("Failed to disconnect.", "error");
          }
        });

        // Pull Button Event Listener
        deviceEqUI.pullButton.addEventListener('click', async () => {
          try {
            const device = deviceEqUI.currentDevice;
            const selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              showToast("No device connected or PEQ slot selected.", "error");
              return;
            }
            var result = null;
            if (deviceEqUI.connectionType == "network") {
              result = await NetworkDeviceConnector.pullFromDevice(device, selectedSlot);
            } else if (deviceEqUI.connectionType == "usb") {
              result = await UsbHIDConnector.pullFromDevice(device, selectedSlot);
            } else if (deviceEqUI.connectionType == "serial") {
              result = await UsbSerialConnector.pullFromDevice(device, selectedSlot);
            } else if (deviceEqUI.connectionType == "ble") {
              result = await BluetoothBleConnector.pullFromDevice(device, selectedSlot);
            }

            // Check if we have a timeout but still received some filters
            if (result.filters.length > 0) {
              context.filtersToElem(result.filters);
              context.applyEQ();
              if (context.config?.showSuccessToasts !== false) showToast("PEQ filters successfully pulled from device.", "success");
            } else {
              showToast("No PEQ filters found on the device.", "warning");
            }
          } catch (error) {
            console.error("Error pulling PEQ filters:", error);
            showToast("Failed to pull PEQ filters from device.", "error");

            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb") {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial") {
              await UsbSerialConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "ble") {
              await BluetoothBleConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          }
        });

        // Push Button Event Listener
        deviceEqUI.pushButton.addEventListener('click', async () => {
          try {
            // Check if the button is in cooldown period
            const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
            const cooldownTime = 0.2; // Cooldown period in seconds (200ms)

            if (currentTime < deviceEqUI.lastPushTime + cooldownTime) {
              const remainingTime = (deviceEqUI.lastPushTime + cooldownTime) - currentTime;
              const remainingMinutes = Math.floor(remainingTime / 60);
              const remainingSeconds = remainingTime % 60;
              return;
            }

            const device = deviceEqUI.currentDevice;
            var selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              showToast("No device connected or PEQ slot selected.", "error");
              return;
            }
            if (typeof selectedSlot === 'string' && !isNaN(parseInt(selectedSlot, 10))) {
              selectedSlot = parseInt(selectedSlot, 10);
            }


            // ✅ Use context to get filters instead of undefined elemToFilters()
            const filters = context.elemToFilters(true);
            if (!filters.length) {
              showToast("Please add at least one filter before pushing.", "error");
              return;
            }
            // Make sure that the phoneObj is set
            if (typeof context.applyEQ === 'function') {
              context.applyEQ();
            }
            const preamp_gain = context.calcEqDevPreamp(filters);
            let disconnect = false;
            // Optional: pass phoneObj (e.g., contains fileName) down to connectors/handlers
            const phoneTargetDetails = (typeof context.getCurrentPhoneTargetNormalisation === 'function')
              ? (await context.getCurrentPhoneTargetNormalisation())
              : null;
            const phoneObj = phoneTargetDetails?.phoneObj;
            if (deviceEqUI.connectionType == "network") {
              disconnect = await NetworkDeviceConnector.pushToDevice(device, phoneObj, selectedSlot, preamp_gain, filters);
            } else if (deviceEqUI.connectionType == "usb") {
              disconnect = await UsbHIDConnector.pushToDevice(device, phoneObj, selectedSlot, preamp_gain, filters);
            } else if (deviceEqUI.connectionType == "serial") {
              disconnect = await UsbSerialConnector.pushToDevice(device, phoneObj, selectedSlot, preamp_gain, filters);
            } else if (deviceEqUI.connectionType == "ble") {
              disconnect = await BluetoothBleConnector.pushToDevice(device, phoneObj, selectedSlot, preamp_gain, filters);
            }

            document.dispatchEvent(new CustomEvent('PeqDeviceSaved', { detail: { filters } }));

            if (disconnect) {
              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.disconnectDevice();
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.disconnectDevice();
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.disconnectDevice();
              }
              deviceEqUI.showDisconnectedState();
              if (context.config?.showSuccessToasts !== false) showToast("PEQ Saved - Restarting", "success");
            } else {
              if (context.config?.showSuccessToasts !== false) showToast("PEQ Successfully pushed to device", "success");
            }

            // Set the last push time to current time and disable the button
            deviceEqUI.lastPushTime = Math.floor(Date.now() / 1000);
            deviceEqUI.pushButton.disabled = true;
            deviceEqUI.pushButton.style.opacity = "0.5";
            deviceEqUI.pushButton.style.cursor = "not-allowed";

            // Set a timeout to re-enable the button after the cooldown period
            setTimeout(() => {
              deviceEqUI.pushButton.disabled = false;
              deviceEqUI.pushButton.style.opacity = "";
              deviceEqUI.pushButton.style.cursor = "";
              console.log("Push button re-enabled after cooldown period");
            }, 200); // 200ms timeout as requested
          } catch (error) {
            console.error("Error pushing PEQ filters:", error);
            showToast("Failed to push PEQ filters to device.", "error");

            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb") {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial") {
              await UsbSerialConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          }
        });

        // PEQ Dropdown Change Event Listener
        deviceEqUI.peqDropdown.addEventListener('change', async (event) => {
          const selectedValue = event.target.value;
          console.log(`PEQ Slot selected: ${selectedValue}`);

          try {
            if (selectedValue === "-1") {
              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              }
              console.log("PEQ Disabled.");
            } else {
              const slotId = parseInt(selectedValue, 10);

              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
              }

              console.log(`PEQ Enabled for slot ID: ${slotId}`);
            }
          } catch (error) {
            console.error("Error updating PEQ slot:", error);
            showToast("Failed to update PEQ slot.", "error");
          }
        });

      }
    }
  } catch (error) {
    console.  error("Error initializing Device EQ Plugin:", error.message);
  }
}

// Export for CommonJS & ES Modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = initializeDeviceEqPlugin;
}

// Export for ES Modules
export default initializeDeviceEqPlugin;
