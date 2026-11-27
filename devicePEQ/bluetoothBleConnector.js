// bluetoothBleConnector.js
// Copyright 2024 : Pragmatic Audio

export const BluetoothBleConnector = (async function () {
  let currentDevice = null;

  const { bluetoothBleDeviceHandlerConfig } = await import('./bluetoothBleDeviceConfig.js');
  const { resolveConstraints, loadPeqConstraintsConfig } = await import('./peqConstraints.js');
  const { buildExtras } = await import('./deviceExtras.js');

  function buildRequestOptions() {
    const filters = [];
    const optionalServices = new Set();

    for (const entry of bluetoothBleDeviceHandlerConfig) {
      const filter = {};
      if (entry.filters?.namePrefix) {
        filter.namePrefix = entry.filters.namePrefix;
      }
      if (Array.isArray(entry.filters?.services) && entry.filters.services.length > 0) {
        entry.filters.services.forEach(service => optionalServices.add(service));
        if (entry.filters.anyService && !filter.namePrefix) {
          // Devices that advertise one of several services under a generic name
          // (WalkPlay "Audio_BLE" → 0xFF16 or 0xFF17): one filter per service.
          entry.filters.services.forEach(service => filters.push({ services: [service] }));
        } else {
          filter.services = entry.filters.services;
        }
      }
      if (Object.keys(filter).length > 0) {
        filters.push(filter);
      }
      if (entry.gatt?.serviceUuid) {
        optionalServices.add(entry.gatt.serviceUuid);
      }
      (entry.gatt?.optionalServices || []).forEach(service => optionalServices.add(service));
    }

    const requestOptions = filters.length > 0 ? { filters } : { acceptAllDevices: true };
    if (optionalServices.size > 0) {
      requestOptions.optionalServices = Array.from(optionalServices);
    }
    return requestOptions;
  }

  function matchConfigEntry(deviceName) {
    const byName = deviceName && bluetoothBleDeviceHandlerConfig.find(entry => {
      if (entry.filters?.namePrefix && deviceName.startsWith(entry.filters.namePrefix)) {
        return true;
      }
      if (entry.devices && Object.prototype.hasOwnProperty.call(entry.devices, deviceName)) {
        return true;
      }
      return false;
    });
    if (byName) return byName;
    // Service-matched entries (anyService) are confirmed after connecting, by their
    // gatt.discover() succeeding — Web Bluetooth doesn't say which filter matched.
    return bluetoothBleDeviceHandlerConfig.find(entry => entry.filters?.anyService) || null;
  }

  async function resolveModelConfig(entry, deviceName) {
    const deviceDetails = entry.devices?.[deviceName] || entry.devices?.[Object.keys(entry.devices || {})[0]] || {};
    const modelConfig = Object.assign({}, entry.defaultModelConfig || {}, deviceDetails.modelConfig || {});

    // Resolve peqConstraints and merge into modelConfig so handlers can read
    // maxFilters, supportsLSFilter etc. from deviceDetails.modelConfig directly.
    await loadPeqConstraintsConfig().catch(() => {});
    const resolvedBleConstraints = resolveConstraints(modelConfig);
    if (resolvedBleConstraints) Object.assign(modelConfig, resolvedBleConstraints);

    return modelConfig;
  }

  function createNotificationQueue(rxChar) {
    const queue = [];
    const waiters = [];

    rxChar.addEventListener('characteristicvaluechanged', event => {
      const value = new Uint8Array(event.target.value.buffer);
      if (waiters.length > 0) {
        const resolver = waiters.shift();
        resolver(value);
      } else {
        queue.push(value);
      }
    });

    return async function readNotification(timeoutMs = 5000) {
      if (queue.length > 0) {
        return queue.shift();
      }
      return await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        waiters.push(value => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    };
  }

  const getDeviceConnected = async () => {
    try {
      const requestOptions = buildRequestOptions();
      const rawDevice = await navigator.bluetooth.requestDevice(requestOptions);

      const entry = matchConfigEntry(rawDevice.name || '');
      if (!entry) {
        console.error('Bluetooth BLE: No configuration found for device:', rawDevice.name);
        return { unsupported: true };
      }

      if (currentDevice) {
        return currentDevice;
      }

      const server = await rawDevice.gatt.connect();
      let txChar, rxChar, notifyChars;
      if (typeof entry.gatt?.discover === 'function') {
        // Handler-specific discovery (characteristic UUIDs vary between firmware).
        try {
          ({ txChar, rxChar, notifyChars } = await entry.gatt.discover(server));
        } catch (e) {
          console.error('Bluetooth BLE: GATT discovery failed for', rawDevice.name, e);
          try { rawDevice.gatt.disconnect(); } catch (_) {}
          return { unsupported: true };
        }
      } else {
        const serviceUuid = entry.gatt?.serviceUuid || entry.filters?.services?.[0];
        const service = await server.getPrimaryService(serviceUuid);
        txChar = await service.getCharacteristic(entry.gatt.txCharacteristicUuid);
        rxChar = await service.getCharacteristic(entry.gatt.rxCharacteristicUuid);
        await rxChar.startNotifications();
      }
      const readNotification = createNotificationQueue(rxChar);

      const modelConfig = await resolveModelConfig(entry, rawDevice.name || '');
      const model = rawDevice.name || 'Bluetooth Device';

      const deviceEntry = entry.devices?.[rawDevice.name]
        || entry.devices?.[Object.keys(entry.devices || {})[0]]
        || {};
      currentDevice = {
        rawDevice,
        manufacturer:    entry.manufacturer || 'Bluetooth',
        model,
        modelConfig,
        handler:         entry.handler,
        txChar,
        rxChar,
        notifyChars,
        readNotification,
        measurementName: deviceEntry.measurementName || null,
        audioOutputName: deviceEntry.audioOutputName  || null,
      };

      if (typeof entry.handler?.onConnected === 'function') {
        await entry.handler.onConnected(currentDevice);
      }
      currentDevice.extras = buildExtras(entry.handler, currentDevice);

      rawDevice.addEventListener('gattserverdisconnected', () => {
        currentDevice = null;
      });

      return currentDevice;
    } catch (error) {
      if (error && error.name === 'NotFoundError') {
        console.log('Bluetooth device chooser cancelled by user.');
        return { cancelled: true };
      }
      console.error('Failed to connect to Bluetooth BLE device:', error);
      return null;
    }
  };

  const disconnectDevice = async () => {
    if (currentDevice && currentDevice.rawDevice?.gatt?.connected) {
      try {
        await currentDevice.rawDevice.gatt.disconnect();
        currentDevice = null;
      } catch (error) {
        console.error('Failed to disconnect BLE device:', error);
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

  return {
    getAvailableSlots,
    getCurrentSlot,
    getDeviceConnected,
    disconnectDevice,
    pushToDevice,
    pullFromDevice,
    enablePEQ,
  };
})();
