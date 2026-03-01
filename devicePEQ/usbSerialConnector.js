// Copyright 2024 : Pragmatic Audio
// Declare UsbSerialConnector and attach it to the global window object

export const UsbSerialConnector = (async function () {
  let devices = [];
  let currentDevice = null;

  const { usbSerialDeviceHandlerConfig } = await import('./usbSerialDeviceConfig.js');

  /**
   * When multiple device configs share the same Bluetooth SPP UUID, show a small
   * modal so the user can pick which device they actually connected.
   * Returns the chosen config object, or null if the user cancelled.
   */
  function pickDeviceFromList(configs) {
    return new Promise(resolve => {
      // Build overlay + dialog
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';

      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#222;border-radius:8px;padding:24px;max-width:360px;width:90%;font-family:sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.3)';

      const title = document.createElement('p');
      title.style.cssText = 'margin:0 0 12px;font-weight:bold;font-size:1rem';
      title.textContent = 'Multiple devices share this Bluetooth profile. Which device did you connect?';

      const select = document.createElement('select');
      select.style.cssText = 'width:100%;padding:8px;margin-bottom:16px;border:1px solid #ccc;border-radius:4px;font-size:.95rem';
      configs.forEach((cfg, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${cfg.entry.manufacturer} – ${cfg.name}`;
        select.appendChild(opt);
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:8px 16px;border:1px solid #ccc;border-radius:4px;cursor:pointer;background:#f5f5f5';

      const okBtn = document.createElement('button');
      okBtn.textContent = 'Connect';
      okBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:#1a73e8;color:#fff;font-weight:bold';

      btnRow.append(cancelBtn, okBtn);
      box.append(title, select, btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const cleanup = () => document.body.removeChild(overlay);

      cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
      okBtn.addEventListener('click', () => { cleanup(); resolve(configs[parseInt(select.value, 10)]); });
    });
  }

  const getDeviceConnected = async () => {
    try {
      // Build filters for device selection - support both USB and Bluetooth SPP
      const filters = [];

      // Add USB vendor ID filters for traditional USB devices
      for (const entry of usbSerialDeviceHandlerConfig) {
        if (entry.vendorId) {
          filters.push({ usbVendorId: entry.vendorId });
        }
        // Add Bluetooth SPP filters for enhanced filtering
        if (entry.filters && entry.filters.allowedBluetoothServiceClassIds) {
          for (const serviceId of entry.filters.allowedBluetoothServiceClassIds) {
            filters.push({ bluetoothServiceClassId: serviceId });
          }
        }
      }

      const requestOptions = {};
      if (filters.length > 0) {
        requestOptions.filters = filters;
      }

      // Also add allowedBluetoothServiceClassIds for Nothing devices
      const bluetoothServiceIds = [];
      for (const entry of usbSerialDeviceHandlerConfig) {
        if (entry.filters && entry.filters.allowedBluetoothServiceClassIds) {
          bluetoothServiceIds.push(...entry.filters.allowedBluetoothServiceClassIds);
        }
      }
      if (bluetoothServiceIds.length > 0) {
        requestOptions.allowedBluetoothServiceClassIds = bluetoothServiceIds;
      }

      const rawDevice = await navigator.serial.requestPort(requestOptions);
      const info = rawDevice.getInfo();
      const productId = info.usbProductId;
      const bluetoothServiceClassId = info.bluetoothServiceClassId;

      // Collect ALL matching configs (USB exact-match or BT SPP UUID match)
      const matchingConfigs = [];
      for (const entry of usbSerialDeviceHandlerConfig) {
        // USB vendor + product ID — exact, no ambiguity
        if (entry.vendorId && entry.vendorId === info.usbVendorId) {
          for (const [name, model] of Object.entries(entry.devices)) {
            if (model.usbProductId === productId) {
              matchingConfigs.push({ entry, name, model });
              break;
            }
          }
          continue; // USB match found for this entry; no need to check BT filters
        }

        // Bluetooth SPP UUID match — potentially ambiguous across multiple entries
        if (entry.filters) {
          const svc = (bluetoothServiceClassId || '').toLowerCase();
          const cfgSingle = (entry.filters.bluetoothServiceClassId || '').toLowerCase();
          const cfgList = Array.isArray(entry.filters.allowedBluetoothServiceClassIds)
            ? entry.filters.allowedBluetoothServiceClassIds.map(x => String(x).toLowerCase())
            : [];
          if (svc && (svc === cfgSingle || cfgList.includes(svc))) {
            for (const [name, model] of Object.entries(entry.devices)) {
              matchingConfigs.push({ entry, name, model });
            }
          }
        }
      }

      // If multiple BT SPP devices share the same UUID, ask the user to disambiguate
      let chosen = null;
      if (matchingConfigs.length === 1) {
        chosen = matchingConfigs[0];
      } else if (matchingConfigs.length > 1) {
        chosen = await pickDeviceFromList(matchingConfigs);
        if (!chosen) return { cancelled: true };
      }

      let vendorConfig = chosen ? chosen.entry  : null;
      let modelName    = chosen ? chosen.name   : null;
      var modelConfig  = chosen ? (chosen.model.modelConfig || {}) : {};
      var handler      = chosen ? chosen.entry.handler : null;

      if (!vendorConfig) {
        const deviceId = productId ? `0x${productId.toString(16)}` : bluetoothServiceClassId || 'Unknown';
        document.getElementById('status').innerText =
          `Status: Unsupported Device (${deviceId})`;
        return;
      }

      // Open device with appropriate baud rate.
      // Always prefer modelConfig.baudRate when specified; fall back to 9600 for BT SPP, 115200 for USB.
      const defaultBaud = bluetoothServiceClassId ? 9600 : 115200;
      const baudRate = (modelConfig && modelConfig.baudRate) ? modelConfig.baudRate : defaultBaud;
      await rawDevice.open({ baudRate });

      // Set up readable and writable shim helpers for handlers expecting simple read()/write()
      // Important: do NOT hold reader/writer locks persistently to avoid blocking other handlers (e.g., FiiO)
      let readable = null;
      let writable = null;
      try {
        if (rawDevice.readable && typeof rawDevice.readable.getReader === 'function') {
          readable = {
            async read() {
              const r = rawDevice.readable.getReader();
              try {
                const res = await r.read();
                return res;
              } finally {
                try { r.releaseLock(); } catch (_) {}
              }
            }
          };
        }
        if (rawDevice.writable && typeof rawDevice.writable.getWriter === 'function') {
          writable = {
            async write(data) {
              const w = rawDevice.writable.getWriter();
              try {
                await w.write(data);
              } finally {
                try { w.releaseLock(); } catch (_) {}
              }
            }
          };
        }
      } catch (e) {
        console.warn('UsbSerialConnector: Failed to set up read/write shims:', e);
      }

      const model = vendorConfig.model || modelName || "Unknown Serial Device";

      currentDevice = {
        rawDevice: rawDevice,
        info,
        manufacturer: vendorConfig.manufacturer,
        model,
        handler,
        modelConfig,
        // Backward-compatibility for handlers (e.g., Nothing) that call device.readable.read() / device.writable.write()
        readable,
        writable
      };

      devices.push(currentDevice);
      return currentDevice;
    } catch (error) {
      // When the user cancels the port chooser, browsers typically throw NotFoundError
      if (error && (error.name === 'NotFoundError' || error.code === 8)) {
        console.log('Serial port chooser cancelled by user.');
        return { cancelled: true };
      }
      console.error("Failed to connect to Serial device:", error);
      return null;
    }
  };

  const disconnectDevice = async () => {
    if (currentDevice && currentDevice.rawDevice) {
      try {
        // Release reader/writer if we created them
        try {
          if (currentDevice.readable && typeof currentDevice.readable.releaseLock === 'function') {
            currentDevice.readable.releaseLock();
          }
        } catch (e) {
          console.warn('UsbSerialConnector: releasing readable lock failed', e);
        }
        try {
          if (currentDevice.writable && typeof currentDevice.writable.releaseLock === 'function') {
            currentDevice.writable.releaseLock();
          }
        } catch (e) {
          console.warn('UsbSerialConnector: releasing writable lock failed', e);
        }

        await currentDevice.rawDevice.close();
        devices = devices.filter(d => d !== currentDevice);
        currentDevice = null;
        console.log("Serial device disconnected.");
      } catch (error) {
        console.error("Failed to disconnect serial device:", error);
      }
    }
  };

  const pushToDevice = async (device, phoneObj, slot, preamp, filters) => {
    if (!device || !device.handler) return;
    return await device.handler.pushToDevice(device, phoneObj, slot, preamp, filters);
  };

  const pullFromDevice = async (device, slot) => {
    if (!device || !device.handler) return { filters: [] };
    return await device.handler.pullFromDevice(device, slot);
  };

  const getAvailableSlots = async (device) => {
    return device.modelConfig.availableSlots;
  };

  const getCurrentSlot = async (device) => {
    if (device && device.handler) return await device.handler.getCurrentSlot(device);
    return -2;
  };

  const enablePEQ = async (device, enabled, slotId) => {
    if (device && device.handler) return await device.handler.enablePEQ(device, enabled, slotId);
  };

  const getCurrentDevice = () => currentDevice;

  return {
    getDeviceConnected,
    getAvailableSlots,
    disconnectDevice,
    pushToDevice,
    pullFromDevice,
    getCurrentDevice,
    getCurrentSlot,
    enablePEQ,
  };
})();
