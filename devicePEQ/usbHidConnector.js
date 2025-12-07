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
                  return { unsupported: true };
                }

                const model = rawDevice.productName;

                // Look up the model-specific configuration from the vendor config.
                // Try three matching strategies in order of preference:
                // 1. Match by productName in devices
                // 2. Match by productId in deviceGroups
                // 3. Fall back to defaultModelConfig
                let deviceDetails = vendorConfig.devices?.[model];

                // If no productName match, try matching by productId in deviceGroups
                if (!deviceDetails && vendorConfig.deviceGroups) {
                  for (const [groupName, groupConfig] of Object.entries(vendorConfig.deviceGroups)) {
                    // Check if this group has a productIds array matching our device
                    if (Array.isArray(groupConfig.productIds) &&
                        groupConfig.productIds.includes(rawDevice.productId)) {
                      deviceDetails = groupConfig;
                      console.log(`Matched device by productId in group: ${groupName} (0x${rawDevice.productId.toString(16)})`);
                      break;
                    }
                  }
                }

                // Fall back to empty object if still no match
                deviceDetails = deviceDetails || {};

                let modelConfig = Object.assign(
                  {},
                  vendorConfig.defaultModelConfig || {},
                  deviceDetails.modelConfig || {}
                );

                const manufacturer = deviceDetails.manufacturer || vendorConfig.manufacturer;
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
                    modelConfig: modelConfig,
                    handler: handler
                };

                return currentDevice;
            } else {
                // User cancelled the chooser dialog
                console.log("USB HID chooser cancelled by user.");
                return { cancelled: true };
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

    const pushToDevice = async (device, phoneObj, slot, preamp, filters) => {
        if (!await checkDeviceConnected(device)) {
            throw Error("Device Disconnected");
        }
        if (device && device.handler) {

          // Create a copy of the filters array to avoid modifying the original
          const filtersToWrite = [...filters];

          // Ensure array is at most the maxFilters
          if (filtersToWrite.length > device.modelConfig.maxFilters) {
            console.warn(`USB Device PEQ: Truncating ${filtersToWrite.length} filters to ${device.modelConfig.maxFilters} (device limit)`);
            if (window.showToast) {
              await window.showToast(`This device only supports ${device.modelConfig.maxFilters} PEQ filters - only first ${device.modelConfig.maxFilters} will be applied.`, "warning", 10000, true);
            }

            filtersToWrite.splice(device.modelConfig.maxFilters);
          }

          // And do an upfront sanity check on the values
          for (let i = 0 ; i < filtersToWrite.length; i++) {
            // A quick sanity check on the filters
            if (filtersToWrite[i].freq < 20 || filtersToWrite[i].freq > 20000) {
              filtersToWrite[i].freq = 100;
            }
            if (filtersToWrite[i].q < 0.01 || filtersToWrite[i].q > 100) {
              filtersToWrite[i].q = 1;
            }
          }

          // Next, determine if we have LS/HS filters with non-zero gain
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

          return await device.handler.pushToDevice(device, phoneObj, slot, preamp, filtersToWrite);
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
