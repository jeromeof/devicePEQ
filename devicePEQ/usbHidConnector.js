//
// Copyright 2024 : Pragmatic Audio
//
// Declare UsbHIDConnector and attach it to the global window object

export const UsbHIDConnector = ( async function () {
    let config = {};
    let devices = [];
    let currentDevice = null;

    // Dynamically import manufacturer specific handlers for their unique devices
    const {fiioUsbHID} = await import('./fiioUsbHidHandler.js');
    const {walkplayUsbHID} = await import('./walkplayHidHandler.js');
    const {moondropUsbHID} = await import('./moondropHidHandler.js');

    // Map a usb devicename to a specific manufacturer handler
    const deviceHandlers = {
        "FiiO": {
            "JadeAudio JA11": fiioUsbHID,
            "FIIO KA17": fiioUsbHID,
            "FIIO Q7": fiioUsbHID,
            "FIIO BTR13": fiioUsbHID,
            "FIIO KA15": fiioUsbHID,
            "RETRO NANO": fiioUsbHID
        },
        "WalkPlay" : {
          "Hi-MAX": walkplayUsbHID,
        },
        "Moondrop" : {
          "ECHO-B": moondropUsbHID,
        },
        // Add more manufacturers and models as needed
    };

    const getDeviceConnected = async () => {
        try {
            const vendorToManufacturer = [
                { vendorId: 10610, manufacturer: "FiiO" },
                { vendorId: 2578, manufacturer: "FiiO" },    // Snowsky
                { vendorId: 13058, manufacturer: "WalkPlay" },
                {vendorId: 13784, manufacturer: "Moondrop" },

            ];

            // Request devices matching the filters
            const selectedDevices = await navigator.hid.requestDevice({ filters: vendorToManufacturer });

            if (selectedDevices.length > 0) {
                const rawDevice = selectedDevices[0];
                const manufacturer = vendorToManufacturer.find(entry => entry.vendorId === rawDevice.vendorId).manufacturer;
                const model = rawDevice.productName;

                // Check if already connected
                const existingDevice = devices.find(d => d.rawDevice === rawDevice);
                if (existingDevice) {
                    console.log("Device already connected:", existingDevice.model);
                    currentDevice = existingDevice;
                    return currentDevice;
                }

                // Open the device if not already open
                if (!rawDevice.opened) {
                    await rawDevice.open();
                }
                let handler = getDeviceHandler(manufacturer, model);
                let deviceDetails = handler.getModelConfig(rawDevice);
                currentDevice = {
                    rawDevice: rawDevice,
                    manufacturer: manufacturer,
                    model: model,
                    handler: handler,
                    deviceDetails: deviceDetails
                };

                if (currentDevice.handler) {
                    await currentDevice.handler.connect(rawDevice);
                } else {
                    console.error(`No handler found for ${manufacturer} ${model}`);
                    return null;
                }

                devices.push(currentDevice);
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
                devices = devices.filter(d => d !== currentDevice);
                currentDevice = null;
            } catch (error) {
                console.error("Failed to disconnect device:", error);
            }
        }
    };
    const checkDeviceConnected = async (device) => {
        const devices = await navigator.hid.getDevices();
        var connected =  devices.some(d => d === device);
        if (!connected) {
            console.error("Device disconnected?");
            alert('Device disconnected?');
            return false;
        }
        return true;
    };

    const pushToDevice = async (device, slot, preamp, filters) => {
        if (!await checkDeviceConnected(device.rawDevice)) {
            throw Error("Device Disconnected");
        }
        if (device && device.handler) {
            return await device.handler.pushToDevice(device.rawDevice, slot, preamp, filters);
        } else {
            console.error("No device handler available for pushing.");
        }
        return true;   // Disconnect anyway
    };

    // Helper Function to Get Available 'Custom' Slots Based on the Device that we can write too
    const  getAvailableSlots = async (device) => {
        return device.deviceDetails.availableSlots;
    };

    const getCurrentSlot = async (device) => {
        if (device && device.handler) {
            return await device.handler.getCurrentSlot(device.rawDevice)
        }{
            console.error("No device handler available for querying");
            return -2;
        }
    };

    const pullFromDevice = async (device, slot) => {
        if (!await checkDeviceConnected(device.rawDevice)) {
            throw Error("Device Disconnected");
        }
        if (device && device.handler) {
            return await device.handler.pullFromDevice(device.rawDevice, slot);
        } else {
            console.error("No device handler available for pulling.");
            return { filters: [], deviceDetails: {} };
        }
    };

    const enablePEQ = async (device, enabled, slotId) => {
        if (device && device.handler) {
            return await device.handler.enablePEQ(device.rawDevice, enabled, slotId);
        } else {
            console.error("No device handler available for enabling.");
        }
    };


    const getDeviceHandler = (manufacturer, model) => {
        return deviceHandlers[manufacturer]?.[model] || null;
    };

    const getCurrentDevice = () => currentDevice;

    return {
        config,
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
