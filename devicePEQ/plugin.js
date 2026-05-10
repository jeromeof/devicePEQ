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
 * @param {boolean} [context.config.minimalExperience] - When true, hides Pull From Device,
 *                                              Push To Device, and the preset slot dropdown.
 *                                              The Connect button changes to "Save to Device"
 *                                              after a device connects and clicking it pushes
 *                                              the current filters to the device.
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
      this.peqSlotArea = this.deviceEqArea.querySelector('.peq-slot-area');
      this.peqDropdown = document.getElementById('device-peq-slot-dropdown');
      this.pullButton = this.deviceEqArea.querySelector('.pull-filters-fromdevice');
      this.pushButton = this.deviceEqArea.querySelector('.push-filters-todevice');
      this.showExtrasBtn = document.getElementById('show-extras-btn');
      this.extrasPanel = document.getElementById('device-extras-panel');
      this.lastPushTime = 0; // Track when the push button was last clicked
      this._extrasExpanded = false;

      // Linked panel refs (only present when minimalExperience: true)
      this.linkedPanel    = document.getElementById('peq-linked-panel');
      this.linkedLoadBtn  = this.linkedPanel?.querySelector('.peq-load-btn');
      this.linkedSaveBtn  = this.linkedPanel?.querySelector('.peq-save-btn');
      this.linkedSettings = this.linkedPanel?.querySelector('.peq-settings-btn');
      this.linkedSettingsPanel = this.linkedPanel?.querySelector('.peq-settings-panel');
      this.linkedSlotsSection  = this.linkedPanel?.querySelector('.peq-slots-section');
      this.linkedExtrasSection = this.linkedPanel?.querySelector('.peq-extras-section');
      this._linkedState        = 'disconnected'; // disconnected | connecting | idle | loading | saving
      this._eqSynced           = false;
      this._postConnectSetup   = false; // true during the connect/load window, suppresses user-edit detection
      this._pullOnConnectPromise = null; // tracks the in-flight auto-pull so linkedLoadBtn can wait for it

      if (this.linkedLoadBtn) {
        this.linkedLoadBtn.addEventListener('click', async () => {
          if (this._linkedState !== 'idle') return;
          this._linkedState = 'loading';
          this._updateLinkedButtons();
          document.dispatchEvent(new CustomEvent('PeqDeviceLoading'));
          try {
            // If auto-pull-on-connect is still in flight, wait for it to finish
            // before sending our own read commands — concurrent pulls to the same
            // device cause the device to miss responses and hit the 10s timeout.
            if (this._pullOnConnectPromise) {
              console.log('[linkedLoad] waiting for auto-pull to finish…');
              await this._pullOnConnectPromise.catch(() => {});
            }
            const device = this.currentDevice;
            const selectedSlot = this.peqDropdown.value;
            const { UsbHIDConnector, UsbSerialConnector, BluetoothBleConnector, NetworkDeviceConnector } = this._connectors ?? {};
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
              this._postConnectSetup = true;
              context.filtersToElem(result.filters.filter(f => f != null));
              context.applyEQ();
              this._eqSynced = true;
              setTimeout(() => { this._postConnectSetup = false; }, 300);
            }
          } catch (e) {
            console.warn('[linkedLoad] pull failed:', e?.message);
          } finally {
            this._linkedState = 'idle';
            this._updateLinkedButtons();
            document.dispatchEvent(new CustomEvent('PeqDeviceLoadingDone'));
          }
        });
      }
      if (this.linkedSaveBtn) {
        this.linkedSaveBtn.addEventListener('click', () => {
          if (this.linkedSaveBtn.disabled) return;
          this._linkedState = 'saving';
          this._updateLinkedButtons();
          document.dispatchEvent(new CustomEvent('PeqDeviceLoading'));
          this.pushButton.click();
        });
      }
      if (this.linkedSettings) {
        this.linkedSettings.addEventListener('click', () => {
          const open = this.linkedSettingsPanel && !this.linkedSettingsPanel.hidden;
          if (this.linkedSettingsPanel) this.linkedSettingsPanel.hidden = open;
          this.linkedSettings.setAttribute('aria-expanded', String(!open));
          this.linkedSettings.classList.toggle('peq-settings-btn--open', !open);
          if (!open && this._pendingLinkedExtrasReads) {
            this._pendingLinkedExtrasReads();
            this._pendingLinkedExtrasReads = null;
          }
        });
      }

      document.addEventListener('applyEQ', () => {
        if (!this.currentDevice) return;
        // Ignore events during connect/load window or when not idle (loading, saving, etc.)
        if (this._linkedState !== 'idle' || this._postConnectSetup) return;
        // User edited the EQ — mark out of sync
        this._eqSynced = false;
        this._updateLinkedButtons();
      });
      document.addEventListener('PeqDeviceSaved', () => {
        if (!this.currentDevice) return;
        this._eqSynced = true;
        this._linkedState = 'idle';
        this._updateLinkedButtons();
      });

      this.showExtrasBtn.addEventListener('click', () => {
        this._extrasExpanded = !this._extrasExpanded;
        this.extrasPanel.hidden = !this._extrasExpanded;
        this.showExtrasBtn.textContent = this._extrasExpanded ? 'Hide Extras ▴' : 'Show Extras ▾';
        // Fire deferred reads the first time the panel opens
        if (this._extrasExpanded && this._pendingExtrasReads) {
          this._pendingExtrasReads();
          this._pendingExtrasReads = null;
        }
      });

      this.useNetwork = false;
      this.currentDevice = null;
      this._onDeviceConnected = context?.onDeviceConnected ?? null;
      this._minimal = context?.config?.minimalExperience === true;
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
          // Guard the applyEQ listener so it doesn't treat auto-populate as a user edit
          this._postConnectSetup = true;
          context.filtersToElem(filters);
          context.applyEQ();
          this._eqSynced = true;
          this._linkedState = 'idle';
          if (this.linkedPanel) this._updateLinkedButtons();
          setTimeout(() => { this._postConnectSetup = false; }, 500);
        } else {
          // EQ had values — user decides; mark out of sync
          this._eqSynced = false;
          this._linkedState = 'idle';
          if (this.linkedPanel) this._updateLinkedButtons();
        }
      } else if (this._linkedState === 'connecting') {
        // Pull returned no filters — still move to idle so buttons are enabled
        this._eqSynced = false;
        this._linkedState = 'idle';
        if (this.linkedPanel) this._updateLinkedButtons();
      }
      try { this._onDeviceConnected(device, peqConstraints, filters, device.extras); }
      catch (e) { console.warn('onDeviceConnected callback error:', e); }
    }

    initializeUI() {
      this.disconnectButton.hidden = true;
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.peqDropdown.hidden = true;
      this.peqSlotArea.hidden = true;
      this.showExtrasBtn.hidden = true;
      this.extrasPanel.hidden = true;
      this.extrasPanel.innerHTML = '';
      this._extrasExpanded = false;
      this._pendingExtrasReads = null;
      if (this.linkedPanel) {
        this.linkedPanel.hidden = true;
        if (this.linkedSlotsSection) { this.linkedSlotsSection.innerHTML = ''; this.linkedSlotsSection.hidden = true; }
        if (this.linkedExtrasSection) { this.linkedExtrasSection.innerHTML = ''; this.linkedExtrasSection.hidden = true; }
        if (this.linkedSettingsPanel) this.linkedSettingsPanel.hidden = true;
        if (this.linkedSettings) { this.linkedSettings.setAttribute('aria-expanded', 'false'); this.linkedSettings.classList.remove('peq-settings-btn--open'); this.linkedSettings.hidden = true; }
      }
      this._linkedState      = 'disconnected';
      this._eqSynced         = false;
      this._postConnectSetup = false;
    }

    _updateLinkedButtons() {
      if (!this.linkedPanel) return;
      const busy             = this._linkedState === 'loading' || this._linkedState === 'saving' || this._linkedState === 'connecting';
      const isCustomSlot     = this._isCurrentSlotWritable();
      const name             = this.currentDevice?.model ?? 'Device';
      // Load from: available whenever connected and not actively loading/saving/connecting
      if (this.linkedLoadBtn) {
        this.linkedLoadBtn.disabled = busy;
        this.linkedLoadBtn.textContent = 'Load from ' + name;
      }
      // Save to: only enabled once EQ has been modified AND a writable slot is selected
      if (this.linkedSaveBtn) {
        this.linkedSaveBtn.disabled = busy || this._eqSynced || !isCustomSlot;
        this.linkedSaveBtn.textContent = 'Save to ' + name;
      }
    }

    _isCurrentSlotWritable() {
      if (!this.currentDevice) return false;
      const firstWritable = this.currentDevice.modelConfig?.firstWritableEQSlot ?? -1;
      if (firstWritable < 0) return true; // single custom slot or no constraint
      const selectedId = parseInt(this.peqDropdown?.value ?? '-1');
      if (selectedId < 0) return false;
      return selectedId >= firstWritable;
    }

    _showLinkedPanel(device, availableSlots) {
      if (!this.linkedPanel) return;
      this._linkedState = 'connecting';
      this._eqSynced = false;
      this.linkedPanel.hidden = false;
      // Build slots UI
      this._buildLinkedSlotsSection(availableSlots, device.modelConfig);
      // Build extras UI (defer reads until panel opens)
      this._buildLinkedExtrasSection(device.extras);
      // Build settings button tooltip listing what's inside
      this._updateLinkedSettingsTooltip(availableSlots, device.modelConfig, device.extras);
      this._updateLinkedButtons();
    }

    _updateLinkedSettingsTooltip(slots, modelConfig, extras) {
      if (!this.linkedSettings) return;
      const items = [];
      const firstWritable = modelConfig?.firstWritableEQSlot ?? -1;
      const hasMultiSlot  = slots && slots.length > 1;
      if (hasMultiSlot) {
        const presets = firstWritable >= 0 ? slots.filter(s => s.id < firstWritable) : [];
        const custom  = firstWritable >= 0 ? slots.filter(s => s.id >= firstWritable) : slots;
        if (presets.length) items.push(`Presets (${presets.length})`);
        if (custom.length)  items.push(`Custom slots (${custom.length})`);
      }
      if (extras) {
        const extraNames = {
          dacFilter: 'DAC Filter', dacWorkMode: 'DAC Work Mode',
          gainMode: 'Gain Mode', balance: 'Balance',
          battery: 'Battery', eqEnabled: 'EQ Enabled',
          micGain: 'Mic Gain', outputGain: 'Output Gain',
        };
        Object.entries(extraNames).forEach(([k, label]) => {
          if (extras[k]?.supported) items.push(label);
        });
      }
      this.linkedSettings.title = items.length
        ? 'Settings — ' + items.join(', ')
        : 'Device Settings';
      // Show/update the badge count on the button
      let badge = this.linkedSettings.querySelector('.peq-settings-badge');
      if (items.length > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'peq-settings-badge';
          this.linkedSettings.appendChild(badge);
        }
        badge.textContent = '!';
      } else if (badge) {
        badge.remove();
      }
    }

    _buildLinkedSlotsSection(slots, modelConfig) {
      if (!this.linkedSlotsSection) return;
      this.linkedSlotsSection.innerHTML = '';
      if (!slots || slots.length <= 1) {
        this.linkedSlotsSection.hidden = true;
        if (this.linkedSettings) this.linkedSettings.hidden = true;
        return;
      }
      const firstWritable = modelConfig?.firstWritableEQSlot ?? -1;
      const presets = firstWritable >= 0 ? slots.filter(s => s.id < firstWritable) : [];
      const custom  = firstWritable >= 0 ? slots.filter(s => s.id >= firstWritable) : slots;
      const showBoth = presets.length > 0 && custom.length > 0;

      const makeGroup = (label, groupSlots, id) => {
        const row = document.createElement('div');
        row.className = 'peq-slot-group';
        const lbl = document.createElement('span');
        lbl.className = 'peq-slot-group-label';
        lbl.textContent = label;
        const sel = document.createElement('select');
        sel.className = 'peq-slot-select';
        sel.id = id;
        groupSlots.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          if (String(s.id) === String(this.peqDropdown?.value)) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
          if (this.peqDropdown) {
            this.peqDropdown.value = sel.value;
            this.peqDropdown.dispatchEvent(new Event('change', { bubbles: true }));
          }
          // If presets and custom both exist, deselect the other group's selection
          if (showBoth && id === 'peq-linked-presets') {
            const custSel = this.linkedSlotsSection.querySelector('#peq-linked-custom');
            if (custSel) custSel.selectedIndex = -1;
          } else if (showBoth && id === 'peq-linked-custom') {
            const preSel = this.linkedSlotsSection.querySelector('#peq-linked-presets');
            if (preSel) preSel.selectedIndex = -1;
          }
          this._eqSynced = false;
          this._updateLinkedButtons();
        });
        row.appendChild(lbl);
        row.appendChild(sel);
        return row;
      };

      if (presets.length > 0) {
        this.linkedSlotsSection.appendChild(makeGroup(showBoth ? 'Presets' : 'Slot', presets, 'peq-linked-presets'));
      }
      if (custom.length > 0) {
        this.linkedSlotsSection.appendChild(makeGroup(showBoth ? 'Custom' : 'Slot', custom, 'peq-linked-custom'));
      }
      this.linkedSlotsSection.hidden = false;
      if (this.linkedSettings) this.linkedSettings.hidden = false;
    }

    _buildLinkedExtrasSection(extras) {
      if (!this.linkedExtrasSection) return;
      this.linkedExtrasSection.innerHTML = '';
      this._pendingLinkedExtrasReads = null;
      if (!extras || !this._hasAnyExtras(extras)) {
        this.linkedExtrasSection.hidden = true;
        return;
      }
      // Reuse the existing extras panel build logic but target linkedExtrasSection
      const savedPanel = this.extrasPanel;
      this.extrasPanel = this.linkedExtrasSection;
      this._buildExtrasPanel(extras);
      // Move _pendingExtrasReads reference
      this._pendingLinkedExtrasReads = this._pendingExtrasReads;
      this._pendingExtrasReads = null;
      this.extrasPanel = savedPanel;
      this.linkedExtrasSection.hidden = false;
      if (this.linkedSettings) this.linkedSettings.hidden = false;
    }

    async showConnectedState(device, connectionType, availableSlots, currentSlot) {
      // Ensure constraint config is cached before resolving — handles the race where a device
      // connects before the async JSON fetch completes (would return maxFilters: undefined).
      await loadPeqConstraintsConfig().catch(() => {});
      this.connectButton.hidden = true;
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

      this.deviceNameElem.textContent = device.model;
      this.populatePeqDropdown(availableSlots, currentSlot);
      if (this._minimal) {
        this._showLinkedPanel(device, availableSlots);
      } else {
        this.disconnectButton.hidden = false;
        this.pullButton.hidden = false;
        this.pushButton.hidden = false;
        this.peqDropdown.hidden = false;
        this.peqSlotArea.hidden = false;
      }

      // Fetch device filters for the callback when configured. Filters are NOT applied to
      // the EQ graph here — only the explicit "Pull From Device" button does that.
      if (context?.config?.pullValuesOnConnect === true) {
        this._pullOnConnectPromise = this._pullOnConnect(device, peqConstraints, currentSlot)
          .finally(() => { this._pullOnConnectPromise = null; });
      } else if (this._onDeviceConnected) {
        try { this._onDeviceConnected(device, peqConstraints, null, device.extras); }
        catch (e) { console.warn('onDeviceConnected callback error:', e); }
      }

      // Show extras toggle if configured and device has supported extras
      this.showExtrasBtn.hidden = true;
      this.extrasPanel.hidden = true;
      this.extrasPanel.innerHTML = '';
      this._extrasExpanded = false;
      if (context?.config?.showExtras === true && this._hasAnyExtras(device.extras)) {
        this._buildExtrasPanel(device.extras);
        this.showExtrasBtn.textContent = 'Show Extras ▾';
        this.showExtrasBtn.hidden = false;
      }

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
      this._linkedState = 'disconnected';
      if (this.linkedPanel) {
        this.linkedPanel.hidden = true;
        if (this.linkedSettingsPanel) this.linkedSettingsPanel.hidden = true;
      }
      this.connectionType = "usb";  // Assume usb
      this.currentDevice = null;
      window.peqDeviceModelConfig = null;
      window.peqDeviceExtras = null;
      document.dispatchEvent(new CustomEvent('PeqDeviceModelConfigChanged', { detail: null }));
      document.dispatchEvent(new CustomEvent('PeqDeviceExtrasChanged', { detail: null }));
      this.connectButton.hidden = false;
      this.disconnectButton.hidden = true;
      this.deviceNameElem.textContent = 'None';
      this.peqDropdown.innerHTML = '<option value="-1">PEQ Disabled</option>';
      this.peqDropdown.hidden = true;
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.peqSlotArea.hidden = true;
      this.showExtrasBtn.hidden = true;
      this.extrasPanel.hidden = true;
      this.extrasPanel.innerHTML = '';
      this._extrasExpanded = false;
      this._pendingExtrasReads = null;
    }

    _hasAnyExtras(extras) {
      if (!extras) return false;
      return Object.values(extras).some(e => e?.supported === true);
    }

    _buildExtrasPanel(extras) {
      const panel = this.extrasPanel;
      panel.innerHTML = '';
      this._pendingExtrasReads = null;
      const deferredReads = [];

      const makeRow = (label, controlHTML, key) => {
        const row = document.createElement('div');
        row.className = 'extras-row';
        row.innerHTML = `
          <span class="extras-label">${label}</span>
          <div class="extras-control">${controlHTML}</div>
          <button class="extras-apply" data-extra="${key}">Apply</button>
          <span class="extras-status" id="extras-status-${key}"></span>
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
             <span id="extra-dacBalance-lbl" style="font-size:12px;min-width:60px;text-align:center">Center</span>
           </div>`, 'dacBalance');
        panel.appendChild(row);
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
        panel.appendChild(row);
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
    // In minimal experience the host provides its own connect/save UI. We only inject
    // the functional skeleton elements that DeviceEqUI needs internally — nothing visible.
    if (context?.config?.minimalExperience) {
      const anchorDiv = context.config.devicePEQAnchorDiv ?? '.extra-eq';
      const placement = context.config.devicePEQPlacement  ?? 'afterend';
      const anchor = document.querySelector(anchorDiv);
      if (anchor) {
        anchor.insertAdjacentHTML(placement, `
          <div class="device-eq disabled" id="deviceEqArea" style="display:none">
            <button class="connect-device" hidden>Connect to Device</button>
            <button class="disconnect-device" hidden>Disconnect From <span id="deviceName">None</span></button>
            <div class="peq-slot-area" hidden>
              <select name="device-peq-slot" id="device-peq-slot-dropdown">
                <option value="None" selected>Select PEQ Slot</option>
              </select>
              <button class="show-extras-btn" id="show-extras-btn" hidden>Show Extras &#9662;</button>
            </div>
            <div class="device-extras-panel" id="device-extras-panel" hidden></div>
            <div class="filters-button">
              <button class="pull-filters-fromdevice" hidden>Pull From Device</button>
              <button class="push-filters-todevice" hidden>Push To Device</button>
            </div>
          </div>
          <div class="peq-linked-panel" id="peq-linked-panel" hidden>
            <div class="peq-action-row">
              <button class="peq-load-btn" disabled>Load from Device</button>
              <button class="peq-save-btn" disabled>Save to Device</button>
              <button class="peq-settings-btn" aria-label="Device settings" aria-expanded="false" hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
            <div class="peq-settings-panel" hidden>
              <div class="peq-slots-section" hidden></div>
              <div class="peq-extras-section" hidden></div>
            </div>
          </div>`);
      }
      const style = document.createElement('style');
      style.textContent = `/* DevicePEQ linked panel */
.peq-linked-panel { display: block; padding: 0 0 6px; }
.peq-linked-panel[hidden] { display: none !important; }
.peq-action-row { display: flex; align-items: center; gap: 4px; padding: 0 10px 6px; }
.peq-load-btn, .peq-save-btn {
  flex: 1 1 0; min-width: 0; padding: 5px 8px; font-size: 11px; font-weight: 500;
  border-radius: 6px; border: 1px solid var(--background-color-contrast-more, #888);
  background: transparent; color: var(--font-color-primary, #111);
  cursor: pointer; text-align: center; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  transition: border-color 150ms, color 150ms, opacity 150ms;
}
.peq-load-btn:not(:disabled):hover, .peq-save-btn:not(:disabled):hover {
  border-color: var(--accent-color, #1a6ef5); color: var(--accent-color, #1a6ef5);
}
.peq-load-btn:disabled, .peq-save-btn:disabled { opacity: 0.35; cursor: default; }
.peq-settings-btn {
  position: relative; flex: none; display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border-radius: 6px; overflow: visible;
  border: 1px solid var(--background-color-contrast-more, #888);
  background: transparent; color: var(--font-color-primary, #111);
  cursor: pointer; transition: border-color 150ms, color 150ms;
}
.peq-settings-btn[hidden] { display: none !important; }
.peq-settings-btn:not(:disabled):hover, .peq-settings-btn.peq-settings-btn--open {
  border-color: var(--accent-color, #1a6ef5); color: var(--accent-color, #1a6ef5);
}
.peq-settings-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 14px; height: 14px; padding: 0 2px;
  border-radius: 7px; font-size: 9px; font-weight: 700; line-height: 14px;
  text-align: center; pointer-events: none;
  background: var(--accent-color, #1a6ef5); color: #fff;
}
.peq-settings-panel {
  display: flex; flex-direction: column; gap: 10px;
  border-top: 1px solid var(--background-color-contrast-more, #aaa);
  padding: 10px 12px 10px;
}
.peq-settings-panel[hidden] { display: none !important; }
.peq-slots-section { display: flex; flex-direction: column; gap: 6px; }
.peq-slots-section[hidden] { display: none !important; }
.peq-slot-group { display: flex; align-items: center; gap: 8px; }
.peq-slot-group-label { font-size: 11px; font-weight: 500; min-width: 50px; flex-shrink: 0; color: var(--font-color-primary, #111); }
.peq-slot-select { flex: 1; font-size: 11px; padding: 3px 6px; border-radius: 5px; border: 1px solid var(--background-color-contrast-more, #888); background: var(--background-color-inputs, #fff); color: var(--font-color-primary, #111); cursor: pointer; }
/* Extras rendered inside settings panel — compact override of the full-UI extras styles */
.peq-extras-section { display: flex; flex-direction: column; gap: 0; }
.peq-extras-section[hidden] { display: none !important; }
.peq-extras-section .extras-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid var(--background-color-contrast-more, #ccc); flex-wrap: nowrap; }
.peq-extras-section .extras-row:last-child { border-bottom: none; }
.peq-extras-section .extras-label { font-size: 11px; font-weight: 500; min-width: 72px; max-width: 72px; flex-shrink: 0; color: var(--font-color-primary, #111); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.peq-extras-section .extras-control { flex: 1 1 auto; min-width: 0; font-size: 11px; }
.peq-extras-section .extras-control select,
.peq-extras-section .extras-control input[type=range] { width: 100%; font-size: 11px; }
.peq-extras-section .extras-control input[type=number] { width: 48px; font-size: 11px; padding: 1px 4px; }
.peq-extras-section .extras-apply { flex-shrink: 0; padding: 2px 8px !important; font-size: 11px !important; border-radius: 4px !important; min-width: 0; }
.peq-extras-section .extras-status { font-size: 10px; flex-shrink: 0; min-width: 28px; text-align: right; }
/* Slider + number input inline layout */
.extras-slider-row { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; }
.extras-slider-row input[type=range] { flex: 1 1 auto; min-width: 0; }
.extras-slider-row input[type=number] { flex: 0 0 44px; width: 44px; font-size: 11px; padding: 1px 4px; }
.extras-unit { flex: none; font-size: 11px; color: var(--font-color-inputs, #666); }
`;
      document.head.appendChild(style);
      return;
    }

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
    /* Main connect button — matches the "Link Device" pill style */
    .peq-connect-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px 18px;
      background: #f5f5f5;
      border: 1px solid #aaa;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 500;
      color: #111;
      cursor: pointer;
      text-transform: none;
    }
    .peq-connect-btn:hover { border-color: #1a6ef5; color: #1a6ef5; }
    .peq-connect-btn-icon { flex-shrink: 0; opacity: 0.7; }
    .peq-info-btn[hidden] { display: none !important; }
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

    /* ── Device Extras panel ─────────────────────────────────────────────── */
    .show-extras-btn {
      font-size: 12px;
      padding: 3px 10px;
      border: 1px solid #aaa;
      border-radius: 4px;
      background: #f0f0f0;
      cursor: pointer;
      white-space: nowrap;
      vertical-align: middle;
    }
    .show-extras-btn:hover { background: #e0e0e0; }

    .device-extras-panel {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 8px 12px;
      margin-top: 6px;
      background: #f9f9f9;
      width: 100%;
      box-sizing: border-box;
      max-width: 100%;
    }

    .extras-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid #eee;
      flex-wrap: wrap;
    }
    .extras-row:last-child { border-bottom: none; }

    .extras-label {
      min-width: 120px;
      font-size: 13px;
      font-weight: 500;
      color: #444;
    }

    .extras-control {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
    }

    .extras-select {
      font-size: 13px;
      padding: 2px 4px;
      border: 1px solid #ccc;
      border-radius: 4px;
    }

    .extras-apply {
      padding: 3px 10px;
      font-size: 12px;
      border: 1px solid #999;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }
    .extras-apply:hover { background: #eee; }

    .extras-status {
      font-size: 11px;
      color: #888;
      min-width: 55px;
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

    .extras-balance-slider { width: 120px; }
    .extras-num-input { width: 52px; font-size: 13px; padding: 2px 4px; border: 1px solid #ccc; border-radius: 4px; }
    .extras-range { width: 110px; }
        </style>
            <${headingTag}>Device PEQ</${headingTag}>
            <div class="settings-row">
                <button class="connect-device peq-connect-btn">${context?.config?.connectButtonLabel ?? 'Connect to device'}
                  <svg class="peq-connect-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                <button class="disconnect-device">Disconnect From <span id="deviceName">None</span></button>
                <button id="deviceInfoBtn" class="peq-info-btn" aria-label="Device Help" title="Device Help" ${context?.config?.showInfoButton === false ? 'hidden' : ''}>ℹ️</button>
            </div>
            <div class="peq-slot-area">
                <select name="device-peq-slot" id="device-peq-slot-dropdown">
                    <option value="None" selected>Select PEQ Slot</option>
                </select>
                <button class="show-extras-btn" id="show-extras-btn" hidden>Show Extras &#9662;</button>
            </div>
            <div class="device-extras-panel" id="device-extras-panel" hidden></div>
            <div class="filters-button">
                <button class="pull-filters-fromdevice">Pull From Device</button>
                <button class="push-filters-todevice">Push To Device</button>
            </div>
        </div>
        <!-- Modal -->
        <div id="deviceInfoModal" class="modal hidden">
          <div class="modal-content">
            <button id="closeModalBtn" class="close" aria-label="Close Modal">&times;</button>
            <h3>About Device PEQ - v0.18</h3>

            <div class="tabs">
              <button class="tab-button active" data-tab="tab-overview">Overview</button>
              <button class="tab-button" data-tab="tab-supported">Supported Devices</button>
              <button class="tab-button" data-tab="tab-howto">How to Use</button>
              <button class="tab-button" data-tab="tab-feedback">Feedback</button>
            </div>

            <div id="tab-overview" class="tab-content active">
              <p>This section lets you connect to a compatible audio device and interact with its Parametric EQ (PEQ) settings. Supported connection types include USB HID, USB Serial, Bluetooth SPP, Bluetooth BLE, and Network. Compatible devices include USB DAC dongles (FiiO, Moondrop, Tanchjim, JDS Labs, WiiM, Walkplay-based), and Bluetooth headphones (Audeze Maxwell, Tanchjim Rita, Moondrop Edge, FiiO EH11/EH13, EarFun Tune Pro, Edifier ConnectX, Nothing Headphone 1).</p>

              <details>
                <summary style="cursor: pointer; font-weight: bold;">Supported Brands & Manufacturers <span style="font-weight: normal; color: #666; font-size: 90%;">(click to expand)</span></summary>
                <ul style="margin-top: 8px;">
                  <li><strong>CrinEar:</strong> Protocol Max</li>
                  <li><strong>FiiO:</strong> JA11, KA15, KA17, FX17, QX13</li>
                  <li><strong>Moondrop:</strong> CDSP, Chu II DSP, Quark2, Rays, Marigold </li>
                  <li><strong>Tanchjim:</strong> Bunny DSP, Fission, One DSP, Stargate II </li>
                  <li><strong>Truthear</strong> KeyX </li>
                  <li><strong>EPZ:</strong> GM20 and TP13</li>
                  <li><strong>Nicehck:</strong> Octave</li>
                  <li><strong>TRN:</strong> Black Pearl</li>
                  <li><strong>KiwiEars:</strong> Allegro and Allegro Pro</li>
                  <li><strong>JCally:</strong> JM20 Pro, JM12, JM98 Pro</li>
                  <li><strong>Walkplay</strong> Most devices compatible with Walkplay Android APK</li>
                  <li><strong>KTMicro</strong> Many KTMicro DSP devices should work </li>
                  <li><strong>JDS Labs:</strong> Supporting the Element IV via USB Serial interface</li>
                  <li><strong>Nothing:</strong> Headphone (1) via Serial USB or Bluetooth</li>
                  <li><strong>WiiM:</strong> Supports limited pushing of parametric EQ over the home network</li>
                  <li><strong>Luxsin:</strong> X9 supports reading and writing PEQ over your home network (HTTP)</li>
                  <li><strong>Audeze:</strong> Maxwell via Bluetooth BLE or SPP — 10-band PEQ, 4 presets</li>
                  <li><strong>Tanchjim:</strong> Rita via Bluetooth SPP — 12-band parametric EQ, read + write</li>
                  <li><strong>Moondrop:</strong> Edge / Edge ANC via Bluetooth SPP — 5-band parametric EQ, read + write</li>
                  <li><strong>FiiO:</strong> EH11 / EH13 via Bluetooth SPP — 10-band parametric EQ, read + write</li>
                  <li><strong>EarFun:</strong> Tune Pro via Bluetooth SPP — 10-band graphic EQ (write only)</li>
                  <li><strong>Edifier:</strong> W830NB and ConnectX headphones via Bluetooth SPP — 4-band PEQ (write only)</li>
                  <li><strong>Experimental:</strong> Many more device's that have yet to be tested, will be marked as 'Experimental' but may work fine</li>
                </ul>
              </details>
            </div>

            <div id="tab-supported" class="tab-content">
              <div class="sub-tabs">
                <button class="sub-tab-button active" data-subtab="sub-fiio">FiiO</button>
                <button class="sub-tab-button" data-subtab="sub-walkplay">Walkplay</button>
                <button class="sub-tab-button" data-subtab="sub-tanchjim">KTMicro</button>
                <button class="sub-tab-button" data-subtab="sub-jdslabs">JDS Labs</button>
                <button class="sub-tab-button" data-subtab="sub-nothing">Nothing</button>
                <button class="sub-tab-button" data-subtab="sub-wiim">WiiM</button>
                <button class="sub-tab-button" data-subtab="sub-luxsin">Luxsin</button>
                <button class="sub-tab-button" data-subtab="sub-bt-headphones">BT Headphones</button>
              </div>

              <div id="sub-fiio" class="sub-tab-content active">
                <h5>FiiO / Jade Audio</h5>
                <p>Currently, I have tested the following FiiO devices: </p>
                <ul>
                  <li>JA11</li>
                  <li>KA17</li>
                  <li>KA15</li>
                  <li>FX17 (with usbc adapter)</li>
                  <li>QX13</li>
                  <li><em>Note:</em> Retro Nano has limited compatibility</li>
                </ul>
                <p>Mostly if a FiiO device works with their excellent Web-based PEQ editor at <a href="https://fiiocontrol.fiio.com" target="_blank">fiiocontrol.fiio.com</a> it should work here also</p>
              </div>

              <div id="sub-walkplay" class="sub-tab-content">
                <h5>Walkplay-Based Devices</h5>
                <p>Since Walkplay licenses their DSP technology to multiple brands, the following devices are known to work but many other devices might work:</p>
                <ul>
                  <li>Moondrop Quark2 DSP (IEM)</li>
                  <li>Moondrop Echo A (Dongle)</li>
                  <li>JCally JM20-Pro (Dongle)</li>
                  <li>Generic "Hi-Max" (Dongle)</li>
                  <li>EPZ G20 (IEM)</li>
                  <li>EPZ TP13 (Dongle)</li>
                </ul>
                <p>Walkplay also provide an excellent editor at <a href="https://peq.szwalkplay.com" target="_blank">peq.szwalkplay.com</a> and a decent Android App</p>
                <p>Note: One quirk with Walkplay devices is their PEQ WebApp and their Android App 'daches' what it thinks is the current PEQ for a device in the cloud (once you register) so values pushed <b>may not be visible</b> to their Website or Mobile App</p>
              </div>

              <div id="sub-tanchjim" class="sub-tab-content">
                <h5>KTMicro Devices</h5>
                <p>Currently, I have tested the following KTMicro DSP devices but many others should work</p>
                <ul>
                  <li>Moondrop CDSP</li>
                  <li>Moondrop Quark2</li>
                  <li>Tanchjim One DSP (IEM)</li>
                  <li>Tanchjim Bunny DSP (IEM)</li>
                  <li>Tanchjim Fission (IEM)</li>
                  <li>JCally JM12</li>
                </ul>
                <p>You also use the official Tanchjim Android App for EQ and device configuration.</p>
              </div>

            <div id="sub-jdslabs" class="sub-tab-content">
              <h5>JDS Labs</h5>
              <p>Supports PEQ control over USB Serial for compatible products like the JDS Labs Element IV, basically if it works on JDS Labs excellent <a href="https://core.jdslabs.com.">Core PEQ</a> it should work. You can push and pull filters directly to the device.</p>
              <p>Note: This option is only visible in advanced mode </p>
            </div>

            <div id="sub-nothing" class="sub-tab-content">
              <h5>Nothing</h5>
              <p>Beta support for Nothing Headphone (1) via Serial USB or Bluetooth connection. Supports reading and writing custom EQ profiles with up to 8 parametric filters.</p>
              <ul>
                <li>Nothing Headphone (1) - Beta support</li>
              </ul>
              <p>The Nothing headphones support multiple EQ profiles: Balanced, Voice, More Treble, More Bass, and Custom. Only the Custom profile supports writing parametric EQ filters.</p>
              <p>Note: This is experimental devicePEQ Bluetooth support and requires compatible browser with Web Serial API.</p>
            </div>

            <div id="sub-wiim" class="sub-tab-content">
              <h5>WiiM</h5>
              <p>Supports network-based PEQ settings for WiiM devices using HTTP APIs. Requires entering the local IP address of the device and selecting the audio source (e.g., Wi-Fi, Bluetooth).</p>
              <p>Note: This option is only visible in advanced mode </p>
            </div>

            <div id="sub-luxsin" class="sub-tab-content">
              <h5>Luxsin X9</h5>
              <p>Supports full network-based PEQ control for the Luxsin X9 using its local HTTP interface. You can both read (pull) and write (push) PEQ filters.</p>
              <ul>
                <li>Find the X9 IP address in the Luxsin/WalkPlay app.</li>
                <li>Use "Connect to Device" → "Network", select "Luxsin X9", and enter the IP.</li>
                <li>Optional: Use "Test IP" to open <code>/dev/info.cgi?action=syncData</code>; you should see encoded text if the IP is correct.</li>
                <li>After connecting, choose the PEQ slot, then Pull or Push filters as needed.</li>
              </ul>
              <p>Tip: No HTTPS certificate steps are needed; Luxsin uses plain HTTP on the local network.</p>
            </div>

            <div id="sub-bt-headphones" class="sub-tab-content">
              <h5>Bluetooth Headphones</h5>
              <p>The following Bluetooth headphones are supported via Bluetooth SPP (Serial) or BLE. Use "Connect to Device" → "Serial USB or Bluetooth Device" for SPP, or "Bluetooth (BLE) Device" for BLE.</p>
              <ul>
                <li>
                  <strong>Audeze Maxwell</strong> (BLE preferred, SPP fallback) — Airoha-chipset headset.
                  10-band parametric EQ, 4 presets. Read + write supported.
                  Connect via "Bluetooth (BLE) Device".
                </li>
                <li>
                  <strong>Tanchjim Rita</strong> (Bluetooth SPP) — 12-band parametric EQ.
                  Gain ±15 dB. Read + write supported.
                  Connect via "Serial USB or Bluetooth Device".
                </li>
                <li>
                  <strong>Moondrop Edge / Edge ANC</strong> (Bluetooth SPP) — 5-band parametric EQ.
                  Gain ±12 dB. Read + write supported.
                  Connect via "Serial USB or Bluetooth Device".
                </li>
                <li>
                  <strong>FiiO EH11 / EH13</strong> (Bluetooth SPP) — FiiO F1 10 serial protocol.
                  10-band parametric EQ, gain ±20 dB. Read + write supported.
                  Connect via "Serial USB or Bluetooth Device".
                </li>
                <li>
                  <strong>EarFun Tune Pro</strong> (Bluetooth SPP) — 10-band graphic EQ.
                  Fixed Q factor; gain ±12 dB. <em>Write only</em> — device does not return EQ data.
                  Connect via "Serial USB or Bluetooth Device".
                </li>
                <li>
                  <strong>Edifier W830NB / ConnectX headphones</strong> (Bluetooth SPP) — 4-band parametric EQ.
                  Gain ±6 dB; frequency snapped to 21 verified lookup-table entries. <em>Write only.</em>
                  Connect via "Serial USB or Bluetooth Device".
                </li>
              </ul>
              <p>Note: Bluetooth connections require a Chromium-based browser (Chrome, Edge, Opera) with Web Serial or Web Bluetooth API support. Pair your headphones with your computer before connecting.</p>
            </div>
          </div>

            <div id="tab-howto" class="tab-content">
              <ul>
                <li><strong>Connect to Device:</strong> Open USB prompt and choose your device.</li>
                <li><strong>Select PEQ Slot:</strong> If supported, choose which EQ slot to view or modify.</li>
                <li><strong>Pull From Device:</strong> Read and load PEQ filter data into the interface.</li>
                <li><strong>Push To Device:</strong> Apply your PEQ filter settings back to the device.</li>
                <li><strong>Disconnect:</strong> Cleanly close the USB connection.</li>
              </ul>
              <p>⚠️ Please ensure your device is compatible and unlocked. Some may require the official app to enable USB EQ editing.</p>
              <h5 style="margin-top:10px;">Network Devices</h5>
              <p><strong>Luxsin X9:</strong> Choose Network → Luxsin X9, enter the device IP (from the Luxsin/WalkPlay app), and optionally click Test IP. A new tab should show encoded text at <code>/dev/info.cgi?action=syncData</code>. You can Pull and Push PEQ filters after connecting.</p>
              <p><strong>WiiM:</strong> Choose Network → WiiM and accept the self-signed HTTPS certificate in the browser when prompted. Pushing PEQ is supported; pulling may be limited by browser security.</p>
            </div>

            <div id="tab-feedback" class="tab-content">
              <p><strong>Help us improve!</strong> Your feedback is valuable to us. Please let us know about your experience with Device PEQ.</p>

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
        deviceEqUI.connectButton.hidden = false;
        deviceEqUI.disconnectButton.hidden = true;

        // Connect Button Event Listener
        deviceEqUI.connectButton.addEventListener('click', async () => {
          try {
            // A host (e.g. graphtool's dropdown) can pre-select the type via a data attribute,
            // which lets us skip the dialog even in advanced mode.
            const preselected = deviceEqUI.connectButton.dataset.connectionType;
            if (preselected) { delete deviceEqUI.connectButton.dataset.connectionType; }
            let selection = preselected
              ? { connectionType: preselected }
              : { connectionType: "usb" }; // default
            if (!preselected && context.config.advanced) {
              // Show a custom dialog to select Network or USB
              selection = await showDeviceSelectionDialog();
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
                return;
              }
              // If device is explicitly marked unsupported or has no handler, show unsupported toast
              if (device?.unsupported || device?.handler == null) {
                showToast("Sorry, this USB device is not currently supported.", "error");
                await UsbHIDConnector.disconnectDevice();
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
                return;
              }
              if (device?.handler == null) {
                showToast("Sorry, this USB Serial device is not currently supported.", "error");
                await UsbSerialConnector.disconnectDevice();
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
                return;
              }
              if (device?.unsupported || device?.handler == null) {
                showToast("Sorry, this Bluetooth device is not currently supported.", "error");
                await BluetoothBleConnector.disconnectDevice();
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

        function showDeviceSelectionDialog() {
          return new Promise((resolve) => {
            const storedIP = getCookie("networkDeviceIP") || "";
            const storedDeviceType = getCookie("networkDeviceType") || "WiiM";

            const dialogHTML = `
      <div id="device-selection-dialog" style="
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
        <h3 style="margin-bottom: 10px; color: black;">Select Connection Type</h3>
        <p style="color: black;">Choose how you want to connect to your device.</p>

        <!-- Selection Buttons (Vertical Layout) -->
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <button id="usb-hid-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #007BFF; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">USB Device</button>
          <button id="usb-serial-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #6f42c1; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">Serial USB or Bluetooth Device</button>
          <button id="bluetooth-ble-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #17a2b8; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">Bluetooth (BLE) Device</button>
          <button id="network-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">Network</button>
        </div>

        <!-- IP Address Input -->
        <input type="text" id="ip-input" placeholder="Enter IP Address" value="${storedIP}" style="display: none; margin-top: 10px; width: 80%;">
        <!-- Test IP Button (Initially Hidden) -->
        <button id="test-ip-button" style="display: none; margin-top: 10px; padding: 8px 12px; font-size: 13px; background: #ffc107; color: #000; border: none; border-radius: 4px; cursor: pointer;">Test IP Address</button>
        <!-- Network Options -->
        <div id="network-options" style="display: none; margin-top: 15px; text-align: left; background: #f9f9f9; padding: 12px; border-radius: 6px; font-size: 14px; color: #222;">
          <p style="margin-bottom: 10px;"><strong>Network Device Selection</strong></p>
          <p>Select which network device you are using. We recommend using the official apps to find the IP address on your network.</p>
          <ul style="margin: 8px 0 12px 22px; color: #333;">
            <li>WiiM: Use the WiiM Home app to find the device IP</li>
            <li>Luxsin X9: Use the Luxsin/WalkPlay app to find the device IP</li>
          </ul>
          <div style="margin-top: 10px; text-align: center;">
            <label style="display: inline-flex; align-items: center; gap: 5px; margin-right: 15px; font-weight: bold; color: black;">
              <input type="radio" name="network-device" value="WiiM" ${storedDeviceType === "WiiM" ? "checked" : ""} style="width: 18px; height: 18px; appearance: auto !important; -webkit-appearance: radio !important; -moz-appearance: radio !important; accent-color: #007BFF;"> WiiM
            </label>
            <label style="display: inline-flex; align-items: center; gap: 5px; margin-right: 15px; font-weight: bold; color: black;">
              <input type="radio" name="network-device" value="Luxsin" ${storedDeviceType === "Luxsin" ? "checked" : ""} style="width: 18px; height: 18px; appearance: auto !important; -webkit-appearance: radio !important; -moz-appearance: radio !important; accent-color: #007BFF;"> Luxsin X9
            </label>
            <label style="display: inline-flex; align-items: center; gap: 5px; font-weight: bold; color: gray;">
              <input type="radio" name="network-device" value="coming-soon" disabled ${storedDeviceType === "coming-soon" ? "checked" : ""} style="width: 18px; height: 18px; appearance: auto !important; -webkit-appearance: radio !important; -moz-appearance: radio !important; accent-color: #007BFF;"> Other Devices (coming soon)
            </label>
          </div>

          <!-- Device-specific help -->
          <div id="device-help" style="margin-top: 12px; background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 10px;">
            <div id="help-wiim" style="display: none; color: #222;">
              <p><strong>WiiM process</strong></p>
              <p>WiiM uses HTTPS with a self-signed certificate on its local web server. Your browser will likely warn that the connection is not private. This is expected.</p>
              <p>To proceed, open the device page in a new tab and accept the certificate warning. After that, this tool can push PEQ settings to the device (reading settings is limited by browser security and may not work).</p>
              <p>Tip: Use the WiiM Home app to find the device IP address.</p>
            </div>
            <div id="help-luxsin" style="display: none; color: #222;">
              <p><strong>Luxsin X9 process</strong></p>
              <p>Luxsin X9 uses a simple HTTP interface. When you test the IP, this tool opens <code>/dev/info.cgi?action=syncData</code> on the device; if the IP is correct you should see text/plain content that looks like encoded gibberish (this is expected).</p>
              <p>No HTTPS certificate acceptance is required. You can both read (pull) and write (push) PEQ settings.</p>
              <p>Tip: Use the Luxsin/WalkPlay app to find the device IP address. Advanced users can also check <code>/dev/info.cgi?action=syncPeq</code> for current PEQ.</p>
            </div>
          </div>
        </div>
        <!-- Action Buttons -->
        <br>
        <button id="submit-button" style="display: none; margin-top: 10px; padding: 10px 15px; font-size: 14px; background: #28A745; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Connect</button>
        <button id="cancel-button" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; background: gray; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
      </div>
    `;

            const dialogContainer = document.createElement("div");
            dialogContainer.innerHTML = dialogHTML;
            document.body.appendChild(dialogContainer);

            const ipInput = document.getElementById("ip-input");
            const networkOptions = document.getElementById("network-options");
            const submitButton = document.getElementById("submit-button");
            const testIpButton = document.getElementById("test-ip-button");
            const helpWiim = document.getElementById("help-wiim");
            const helpLuxsin = document.getElementById("help-luxsin");
            // Event: USB HID
            document.getElementById("usb-hid-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "usb" });
            });

            // Event: USB Serial
            document.getElementById("usb-serial-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "serial" });
            });

            // Event: Bluetooth BLE
            document.getElementById("bluetooth-ble-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "ble" });
            });

            // Event: Network
            document.getElementById("network-button").addEventListener("click", () => {
              ipInput.style.display = "block";
              networkOptions.style.display = "block";
              submitButton.style.display = "inline-block";
              // Initialize help visibility based on stored device type
              const selectedDevice = document.querySelector('input[name="network-device"]:checked')?.value || "WiiM";
              helpWiim.style.display = selectedDevice === "WiiM" ? "block" : "none";
              helpLuxsin.style.display = selectedDevice === "Luxsin" ? "block" : "none";
            });

            // Watch for IP input to show the Test IP button
            ipInput.addEventListener("input", () => {
              const ip = ipInput.value.trim();
              const isValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip); // basic IPv4 validation
              testIpButton.style.display = isValid ? "inline-block" : "none";
              submitButton.style.display = isValid ? "inline-block" : "none";
            });

            // Switch help text and test button hint when selecting device type
            const deviceRadios = document.querySelectorAll('input[name="network-device"]');
            // Defensive: Force radios to render even if host app CSS sets appearance:none
            deviceRadios.forEach(r => {
              try {
                r.style.setProperty('appearance', 'auto', 'important');
                r.style.setProperty('-webkit-appearance', 'radio', 'important');
                r.style.setProperty('-moz-appearance', 'radio', 'important');
                r.style.setProperty('accent-color', '#007BFF');
                r.type = 'radio'; // ensure input remains radio
              } catch (e) { /* ignore */ }
              r.addEventListener('change', () => {
                const val = document.querySelector('input[name="network-device"]:checked')?.value || 'WiiM';
                helpWiim.style.display = val === 'WiiM' ? 'block' : 'none';
                helpLuxsin.style.display = val === 'Luxsin' ? 'block' : 'none';
                // Update button label hint
                if (testIpButton.style.display !== 'none') {
                  testIpButton.textContent = val === 'WiiM' ? 'Open WiiM Status (HTTPS)' : 'Open Luxsin Sync Data (HTTP)';
                }
              });
            });

            // Handle Test IP Button Click
            testIpButton.addEventListener("click", () => {
              const ip = ipInput.value.trim();
              if (!ip) return;
              const selectedDevice = document.querySelector('input[name="network-device"]:checked')?.value || "WiiM";
              if (selectedDevice === 'WiiM') {
                const confirmProceed = confirm(`This will open a new tab to https://${ip}.\nIf your browser shows technical info, you've already accepted the certificate. If you see a security warning (e.g., ERR_CERT_AUTHORITY_INVALID), accept the self-signed certificate (issued by Linkplay) via Advanced to proceed.`);
                if (confirmProceed) {
                  window.open(`https://${ip}/httpapi.asp?command=getStatusEx`, "_blank", "noopener,noreferrer");
                }
              } else if (selectedDevice === 'Luxsin') {
                const confirmProceed = confirm(`This will open a new tab to http://${ip}/dev/info.cgi?action=syncData.\nIf the IP is correct, you should see encoded text/plain content returned by the device.`);
                if (confirmProceed) {
                  window.open(`http://${ip}/dev/info.cgi?action=syncData`, "_blank", "noopener,noreferrer");
                }
              }
            });

            // Submit Network
            submitButton.addEventListener("click", () => {
              const ip = ipInput.value.trim();
              if (!ip) {
                showToast("Please enter a valid IP address.", "error");
                return;
              }

              const selectedDevice = document.querySelector('input[name="network-device"]:checked')?.value || "WiiM";
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "network", ipAddress: ip, deviceType: selectedDevice });
            });

            // Cancel
            document.getElementById("cancel-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({connectionType: "none"});
            });
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
              // Normal case - all filters received
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
