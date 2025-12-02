// networkDeviceConnector.js
// Copyright 2024 : Pragmatic Audio

const {wiimNetworkHandler} = await import('./wiimNetworkHandler.js');
const {luxsinNetworkHandler} = await import('./luxsinNetworkHandler.js');
const {networkDeviceHandlerConfig} = await import('./networkDeviceConfig.js');

export const NetworkDeviceConnector = (function () {
    let currentDevice = null;
    const deviceHandlers = {
        "WiiM": wiimNetworkHandler,
        "Luxsin": luxsinNetworkHandler,
    };
    async function getDeviceConnected(deviceIP, deviceType) {
        try {
            if (!deviceIP) {
                console.warn("No IP Address provided.");
                return null;
            }

            // Basic IP address validation (IPv4)
            const ipPattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
            if (!ipPattern.test(deviceIP)) {
                console.warn("Invalid IP address format.");
                return null;
            }

            if (!deviceHandlers[deviceType]) {
                console.warn("Unsupported Device Type.");
                return null;
            }

            // Build model information from config
            const deviceConfig = networkDeviceHandlerConfig.devices?.[deviceType] || {};
            const defaultModelConfig = networkDeviceHandlerConfig.defaultModelConfig || {};
            const modelConfig = Object.assign({}, defaultModelConfig, deviceConfig.modelConfig || {});

            currentDevice = {
                ip: deviceIP,
                type: deviceType,
                handler: deviceHandlers[deviceType],
                manufacturer: deviceConfig.manufacturer || deviceType,
                model: deviceConfig.model || `${deviceType} Device`,
                modelConfig: modelConfig,
            };

            console.log(`Connected to ${deviceType} at ${deviceIP}`);
            return currentDevice;
        } catch (error) {
            console.error("Failed to connect to Network Device:", error);
            return null;
        }
    }

    async function disconnectDevice() {
        if (currentDevice) {
            console.log(`Disconnected from ${currentDevice.type} at ${currentDevice.ip}`);
            currentDevice = null;
        }
    }

    async function pushToDevice(device, phoneObj, slot, preamp, filters) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        // Pass modelConfig so handlers can respect device-specific limits (e.g., maxFilters)
        return await currentDevice.handler.pushToDevice(
          currentDevice.ip,
          phoneObj,
          slot,
          preamp,
          filters,
          currentDevice.modelConfig
        );
    }

    async function pullFromDevice(device, slot) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        return await currentDevice.handler.pullFromDevice(currentDevice.ip, slot);
    }
    async function getCurrentSlot(device) {
      if (!deviceHandlers[device.type]) {
        console.warn("Unsupported Device Type.");
        return null;
      }
      return await deviceHandlers[device.type].getCurrentSlot(device.ip);
    }
  async function getAvailableSlots(device) {
    if (!deviceHandlers[device.type]) {
      console.warn("Unsupported Device Type.");
      return null;
    }
    return await deviceHandlers[device.type].getAvailableSlots(device.ip);
  }

    async function enablePEQ(device, enabled, slotId) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        return await currentDevice.handler.enablePEQ(currentDevice.ip, enabled, slotId);
    }

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
