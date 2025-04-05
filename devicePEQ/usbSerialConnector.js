// Copyright 2024 : Pragmatic Audio
// Declare UsbSerialConnector and attach it to the global window object

export const UsbSerialConnector = (async function () {
  let devices = [];
  let currentDevice = null;

  const { usbSerialDeviceHandlerConfig } = await import('./usbSerialDeviceConfig.js');

  const getDeviceConnected = async () => {
    try {
      const rawDevice = await navigator.serial.requestPort({
        filters: usbSerialDeviceHandlerConfig.map(entry => ({ usbVendorId: entry.vendorId }))
      });

      const info = rawDevice.getInfo();
      const productId = info.usbProductId;

      let vendorConfig = null;
      let modelName = null;
      var modelConfig = {};
      var handler = null;

      for (const entry of usbSerialDeviceHandlerConfig) {
        if (entry.vendorId === info.usbVendorId) {
          for (const [name, model] of Object.entries(entry.devices)) {
            if (model.usbProductId === productId) {
              vendorConfig = entry;
              modelName = name;
              modelConfig = model.modelConfig || {};
              handler = entry.handler;
              break;
            }
          }
        }
        if (vendorConfig) break;
      }

      if (!vendorConfig) {
        document.getElementById('status').innerText =
          `Status: Unsupported Device (0x${productId.toString(16)})`;
        return;
      }
      await rawDevice.open({ baudRate: 115200 });

      const model = vendorConfig.model || "Unknown Serial Device";

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
