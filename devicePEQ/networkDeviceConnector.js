// networkDeviceConnector.js
// Copyright 2024 : Pragmatic Audio

export const NetworkDeviceConnector = (function () {
    let currentDevice = null;
    const deviceHandlers = {
        "WiiM": null, // Will be dynamically imported
    };

    async function initialize() {
        const { wiimNetworkHandler } = await import('./wiimNetworkHandler.js');
        deviceHandlers["WiiM"] = wiimNetworkHandler;
    }

    async function getDeviceConnected(deviceIP, deviceType) {
        try {
            if (!deviceIP) {
                console.warn("No IP Address provided.");
                return null;
            }

            if (!deviceHandlers[deviceType]) {
                console.warn("Unsupported Device Type.");
                return null;
            }

            currentDevice = {
                ip: deviceIP,
                type: deviceType,
                handler: deviceHandlers[deviceType]
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

    async function pushToDevice(device, slot, preamp, filters) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        return await currentDevice.handler.pushToDevice(currentDevice.ip, slot, preamp, filters);
    }

    async function pullFromDevice(device, slot) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        return await currentDevice.handler.pullFromDevice(currentDevice.ip, slot);
    }

    async function enablePEQ(device, enabled, slotId) {
        if (!currentDevice) {
            console.warn("No network device connected.");
            return;
        }
        return await currentDevice.handler.enablePEQ(currentDevice.ip, enabled, slotId);
    }

    return {
        initialize,
        getDeviceConnected,
        disconnectDevice,
        pushToDevice,
        pullFromDevice,
        enablePEQ,
    };
})();
