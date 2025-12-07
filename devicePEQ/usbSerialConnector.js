// Copyright 2024 : Pragmatic Audio
// Declare UsbSerialConnector and attach it to the global window object

export const UsbSerialConnector = (async function () {
  let devices = [];
  let currentDevice = null;

  const { usbSerialDeviceHandlerConfig } = await import('./usbSerialDeviceConfig.js');

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

      let vendorConfig = null;
      let modelName = null;
      var modelConfig = {};
      var handler = null;

      // Enhanced device matching - support both USB and Bluetooth SPP
      for (const entry of usbSerialDeviceHandlerConfig) {
        let deviceMatched = false;

        // Check USB vendor ID match (traditional method)
        if (entry.vendorId && entry.vendorId === info.usbVendorId) {
          for (const [name, model] of Object.entries(entry.devices)) {
            if (model.usbProductId === productId) {
              vendorConfig = entry;
              modelName = name;
              modelConfig = model.modelConfig || {};
              handler = entry.handler;
              deviceMatched = true;
              break;
            }
          }
        }

        // Check Bluetooth SPP UUID match (enhanced filtering)
        if (!deviceMatched && entry.filters) {
          const svc = (bluetoothServiceClassId || '').toLowerCase();
          const cfgSingle = (entry.filters.bluetoothServiceClassId || '').toLowerCase();
          const cfgList = Array.isArray(entry.filters.allowedBluetoothServiceClassIds)
            ? entry.filters.allowedBluetoothServiceClassIds.map(x => String(x).toLowerCase())
            : [];
          const matchesSingle = svc && cfgSingle && svc === cfgSingle;
          const matchesAny = svc && cfgList.includes(svc);
          if (matchesSingle || matchesAny) {
            // For Bluetooth devices, use the first (and typically only) device entry
            const deviceEntries = Object.entries(entry.devices);
            if (deviceEntries.length > 0) {
              const [name, model] = deviceEntries[0];
              vendorConfig = entry;
              modelName = name;
              modelConfig = model.modelConfig || {};
              handler = entry.handler;
              deviceMatched = true;
            }
          }
        }

        if (deviceMatched) break;
      }

      if (!vendorConfig) {
        const deviceId = productId ? `0x${productId.toString(16)}` : bluetoothServiceClassId || 'Unknown';
        document.getElementById('status').innerText =
          `Status: Unsupported Device (${deviceId})`;
        return;
      }

      // Open device with appropriate baud rate
      // - Bluetooth SPP typically uses 9600
      // - Otherwise default to 115200 unless overridden by modelConfig.baudRate
      const defaultBaud = bluetoothServiceClassId ? 9600 : 115200;
      const baudRate = (modelConfig && modelConfig.baudRate && !bluetoothServiceClassId)
        ? modelConfig.baudRate
        : defaultBaud;
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
