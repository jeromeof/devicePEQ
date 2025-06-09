//
// Copyright 2024 : Pragmatic Audio
//
// Declare UsbHIDConnector and attach it to the global window object

export const UsbHIDConnector = ( async function () {
    let currentDevice = null;

    const {usbHidDeviceHandlerConfig} = await import('./usbDeviceConfig.js');

    const getDeviceConnected = async () => {
        try {
            const vendorToManufacturer = usbHidDeviceHandlerConfig.flatMap(entry =>
              entry.vendorIds.map(vendorId => ({
                vendorId,
                name: entry.name
              }))
            );
            // Request devices matching the filters
            const selectedDevices = await navigator.hid.requestDevice({ filters: vendorToManufacturer });

            if (selectedDevices.length > 0) {
                const rawDevice = selectedDevices[0];
                // Find the vendor configuration matching the selected device
              const vendorConfig = usbHidDeviceHandlerConfig.find(entry =>
                entry.vendorIds.includes(rawDevice.vendorId)
              );

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

          // Create a copy of the filters array to avoid modifying the original
          const filtersToWrite = [...filters];

          // First, determine if we have LS/HS filters with non-zero gain
          const hasLSHSFilters = filtersToWrite.some(filter =>
            (filter.type === "LSQ" || filter.type === "HSQ") && filter.gain !== 0);

          // Second, determine if we need pregain (only if globalGain is positive)
          const needsPreGain = preamp < 0;

          // Handle LS/HS filters if device doesn't support them
          if (hasLSHSFilters && device.modelConfig.supportsLSHSFilters === false) {
            // Convert LS/HS filters with non-zero gain to PK with gain=0
            for (let i = 0; i < filtersToWrite.length; i++) {
              if ((filtersToWrite[i].type === "LSQ" || filtersToWrite[i].type === "HSQ") && filtersToWrite[i].gain !== 0) {
                console.log(`USB Device PEQ: converting ${filtersToWrite[i].type} filter to PK with gain=0`);
                filtersToWrite[i].type = "PK";
                filtersToWrite[i].gain = 0;
              }
            }
          }

          // Handle warnings based on device capabilities and filter requirements
          if (hasLSHSFilters && device.modelConfig.supportsLSHSFilters === false &&
            needsPreGain && device.modelConfig.supportsPregain === false) {
            // Case 1: Device doesn't support both LSHS filters and pregain
            console.warn("Device doesn't support LS/HS filters and auto pregain - both will be ignored");
            if (window.showToast) {
              window.showToast("Device doesn't support LS/HS filters and auto pregain - both will be ignored", "warning");
            }
          } else if (hasLSHSFilters && device.modelConfig.supportsLSHSFilters === false) {
            // Case 2: Device only doesn't support LSHS filters
            console.warn("Device only supports Peak filters - ignoring LS/HS filters");
            if (window.showToast) {
              window.showToast("Device only supports Peak filters - ignoring LS/HS filters", "warning");
            }
          } else if (needsPreGain && device.modelConfig.supportsPregain === false) {
            // Case 3: Device only doesn't support pregain
            console.warn("Device does not support auto calculated pregain");
            if (window.showToast) {
              window.showToast("Device does not support auto calculated pregain", "warning");
            }
          }

          // If we have fewer filters than maxFilters, fill the rest with defaultResetFiltersValues
          if (filtersToWrite.length < device.modelConfig.maxFilters && device.modelConfig.defaultResetFiltersValues) {
            const defaultFilter = device.modelConfig.defaultResetFiltersValues[0];
            console.log(`USB Device PEQ: filling missing filters with defaults:`, defaultFilter);

            for (let i = filtersToWrite.length; i < device.modelConfig.maxFilters; i++) {
              filtersToWrite.push({...defaultFilter});
            }
          }

          return await device.handler.pushToDevice(device, slot, preamp, filtersToWrite);
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
