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
        if (!deviceMatched && entry.filters && entry.filters.bluetoothServiceClassId) {
          if (bluetoothServiceClassId === entry.filters.bluetoothServiceClassId) {
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
      const baudRate = bluetoothServiceClassId ? 9600 : 115200; // Bluetooth SPP typically uses 9600
      await rawDevice.open({ baudRate });

      const model = vendorConfig.model || modelName || "Unknown Serial Device";

      currentDevice = {
        rawDevice: rawDevice,
        info,
        manufacturer: vendorConfig.manufacturer,
        model,
        handler,
        modelConfig,
        readable: rawDevice.readable.getReader(),
        writable: rawDevice.writable.getWriter(),
      };

      devices.push(currentDevice);
      return currentDevice;
    } catch (error) {
      console.error("Failed to connect to Serial device:", error);
      return null;
    }
  };

  const disconnectDevice = async () => {
    if (currentDevice && currentDevice.rawPort) {
      try {
        await currentDevice.readable.releaseLock();
        await currentDevice.writable.releaseLock();
        await currentDevice.rawPort.close();
        devices = devices.filter(d => d !== currentDevice);
        currentDevice = null;
        console.log("Serial device disconnected.");
      } catch (error) {
        console.error("Failed to disconnect serial device:", error);
      }
    }
  };

  const pushToDevice = async (device, slot, preamp, filters) => {
    if (!device || !device.handler) return;
    return await device.handler.pushToDevice(device, slot, preamp, filters);
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
