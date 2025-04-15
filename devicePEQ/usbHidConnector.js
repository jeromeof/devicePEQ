//
// Copyright 2024 : Pragmatic Audio
//
// Declare UsbHIDConnector and attach it to the global window object

export const UsbHIDConnector = ( async function () {
    let currentDevice = null;

    const {usbHidDeviceHandlerConfig} = await import('./usbDeviceConfig.js');

    const getDeviceConnected = async () => {
        try {
            // Build filters from your configuration
            // (Assuming each configuration has a unique vendorId)
            const vendorToManufacturer = usbHidDeviceHandlerConfig.map(entry => ({
              vendorId: entry.vendorId,
              // You could also include productId if needed
            }));

            // Request devices matching the filters
            const selectedDevices = await navigator.hid.requestDevice({ filters: vendorToManufacturer });

            if (selectedDevices.length > 0) {
                const rawDevice = selectedDevices[0];
                // Find the vendor configuration matching the selected device
                const vendorConfig = usbHidDeviceHandlerConfig.find(entry => entry.vendorId === rawDevice.vendorId);

                if (!vendorConfig) {
                  console.error("No configuration found for vendor:", rawDevice.vendorId);
                  return;
                }

                const model = rawDevice.productName;

                // Look up the model-specific configuration from the vendor config.
                // If no specific model configuration exists, fall back to a default if provided.
                let deviceDetails = vendorConfig.devices[model] || {};
                let modelConfig = Object.assign(
                  {},
                  vendorConfig.defaultModelConfig || {},
                  deviceDetails.modelConfig || {}
                );

                const manufacturer = deviceDetails.manufacturer | vendorConfig.manufacturer;
                let handler = deviceDetails.handler ||  vendorConfig.handler;

                // Check if already connected
                if (currentDevice != null) {
                  return currentDevice;
                }

                // Open the device if not already open
                if (!rawDevice.opened) {
                    await rawDevice.open();
                }
                currentDevice = {
                    rawDevice: rawDevice,
                    manufacturer: manufacturer,
                    model: model,
                    handler: handler,
                    modelConfig: modelConfig
                };

                return currentDevice;
            } else {
                console.log("No device found.");
                return null;
            }
        } catch (error) {
            console.error("Failed to connect to HID device:", error);
            return null;
        }
    };

    const disconnectDevice = async () => {
        if (currentDevice && currentDevice.rawDevice) {
            try {
                await currentDevice.rawDevice.close();
                console.log("Device disconnected:", currentDevice.model);
                currentDevice = null;
            } catch (error) {
                console.error("Failed to disconnect device:", error);
            }
        }
    };
    const checkDeviceConnected = async (device) => {
        var rawDevice = device.rawDevice;
        const rawDevices = await navigator.hid.getDevices();
        var matchingRawDevice =  rawDevices.find(d => d.vendorId === rawDevice.vendorId && d.productId == rawDevice.productId);
        if (typeof matchingRawDevice == 'undefined' || matchingRawDevice == null ) {
            console.error("Device disconnected?");
            alert('Device disconnected?');
            return false;
        }
        // But lets check if we are still open otherwise we need to open the device again
        if (!matchingRawDevice.opened) {
          await matchingRawDevice.open();
          device.rawDevice = matchingRawDevice; // Swap the device over
        }
        return true;
    };

    const pushToDevice = async (device, slot, preamp, filters) => {
        if (!await checkDeviceConnected(device)) {
            throw Error("Device Disconnected");
        }
        if (device && device.handler) {
            return await device.handler.pushToDevice(device, slot, preamp, filters);
        } else {
            console.error("No device handler available for pushing.");
        }
        return true;   // Disconnect anyway
    };

    // Helper Function to Get Available 'Custom' Slots Based on the Device that we can write too
    const  getAvailableSlots = async (device) => {
        return device.modelConfig.availableSlots;
    };

    const getCurrentSlot = async (device) => {
        if (device && device.handler) {
            return await device.handler.getCurrentSlot(device)
        }{
            console.error("No device handler available for querying");
            return -2;
        }
    };

    const pullFromDevice = async (device, slot) => {
        if (!await checkDeviceConnected(device)) {
            throw Error("Device Disconnected");
        }
        if (device && device.handler) {
            return await device.handler.pullFromDevice(device, slot);
        } else {
            console.error("No device handler available for pulling.");
            return { filters: [] }; // Empty filters
        }
    };

    const enablePEQ = async (device, enabled, slotId) => {
        if (device && device.handler) {
            return await device.handler.enablePEQ(device, enabled, slotId);
        } else {
            console.error("No device handler available for enabling.");
        }
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
