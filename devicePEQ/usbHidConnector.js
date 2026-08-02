//
// Copyright 2024 : Pragmatic Audio
//
// Declare UsbHIDConnector and attach it to the global window object

export const UsbHIDConnector = ( async function () {
    let currentDevice = null;

    const {usbHidDeviceHandlerConfig, handlerNameFor} = await import('./usbDeviceConfig.js');
    const { resolveConstraints, loadPeqConstraintsConfig } = await import('./peqConstraints.js');
    const { buildExtras } = await import('./deviceExtras.js');

    const getDeviceConnected = async () => {
        try {
            // If a device is already connected, close it so the picker can select a
            // different one (prevents stale currentDevice blocking KT Micro / Qudelix
            // after switching away from a previously-connected WalkPlay device).
            if (currentDevice != null) {
              try { await currentDevice.rawDevice.close(); } catch (_) {}
              currentDevice = null;
            }

            const vendorToManufacturer = usbHidDeviceHandlerConfig.flatMap(entry =>
              entry.vendorIds.map(vendorId => ({
                vendorId,
                ...(entry.hidUsagePage ? { usagePage: entry.hidUsagePage } : {})
              }))
            );
            // Request devices matching the filters
            const selectedDevices = await navigator.hid.requestDevice({ filters: vendorToManufacturer });

            if (selectedDevices.length > 0) {
                let rawDevice = selectedDevices[0];

                // Some devices (e.g. Qudelix 5K) expose multiple HID interfaces with
                // identical names. The picker may return the consumer-control interface
                // (usagePage=0x0C) instead of the vendor PEQ interface (usagePage≥0xFF00).
                // If that happens, look through previously-granted devices for a sibling
                // with the same vendorId/productId that has vendor HID collections.
                const hasVendorHID = rawDevice.collections?.some(c => c.usagePage >= 0xFF00);
                if (!hasVendorHID) {
                  const granted = await navigator.hid.getDevices();
                  const sibling = granted.find(d =>
                    d !== rawDevice &&
                    d.vendorId  === rawDevice.vendorId &&
                    d.productId === rawDevice.productId &&
                    d.collections?.some(c => c.usagePage >= 0xFF00)
                  );
                  if (sibling) {
                    console.log(`[connector] Swapping to vendor HID interface for "${rawDevice.productName}"`);
                    rawDevice = sibling;
                  }
                }
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
                let matchedGroupName = null;

                // If no productName match, try matching by productId in deviceGroups
                if (!deviceDetails && vendorConfig.deviceGroups) {
                  for (const [groupName, groupConfig] of Object.entries(vendorConfig.deviceGroups)) {
                    // Check if this group has a productIds array matching our device
                    if (Array.isArray(groupConfig.productIds) &&
                        groupConfig.productIds.includes(rawDevice.productId)) {
                      deviceDetails = groupConfig;
                      matchedGroupName = groupName;
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

                // Resolve peqConstraints and merge into modelConfig so handlers
                // can read maxFilters, supportsLSFilter etc. from deviceDetails.modelConfig.
                await loadPeqConstraintsConfig().catch(() => {});
                const resolvedConstraints = resolveConstraints(modelConfig);
                if (resolvedConstraints) Object.assign(modelConfig, resolvedConstraints);

                const manufacturer = deviceDetails.manufacturer || vendorConfig.manufacturer;
                let handler = deviceDetails.handler ||  vendorConfig.handler;

                // Always-on (not gated behind debugLogs) - printed immediately at resolution
                // time, before any handler method runs, so it's available even if the device
                // never responds and a handler call later hangs/times out.
                console.log(
                  `[usbHidConnector] resolved "${model}" -> manufacturer=${manufacturer} ` +
                  `vendorId=0x${rawDevice.vendorId.toString(16).toUpperCase().padStart(4,'0')} ` +
                  `productId=0x${rawDevice.productId.toString(16).toUpperCase().padStart(4,'0')}`
                );

                // Open the device if not already open
                if (!rawDevice.opened) {
                    await rawDevice.open();
                }
                currentDevice = {
                    rawDevice: rawDevice,
                    manufacturer: manufacturer,
                    model: model,
                    modelConfig: modelConfig,
                    handler: handler,
                    // Which implementation is actually driving this device. Kept
                    // on the device rather than re-derived by callers, since only
                    // the resolution above knows which group matched.
                    handlerName: handlerNameFor(handler),
                    deviceGroup: matchedGroupName,
                };
                currentDevice.extras = buildExtras(handler, currentDevice);

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
        // When multiple interfaces share vendorId+productId (e.g. Qudelix 5K),
        // prefer the one whose collections match the currently-held device so we
        // don't accidentally swap back to the consumer-control interface.
        const sameCollectionSig = (a, b) =>
          (a.collections||[]).map(c=>c.usagePage).sort().join() ===
          (b.collections||[]).map(c=>c.usagePage).sort().join();
        var matchingRawDevice = rawDevices.find(d =>
          d.vendorId === rawDevice.vendorId &&
          d.productId === rawDevice.productId &&
          sameCollectionSig(d, rawDevice)
        ) ?? rawDevices.find(d =>
          d.vendorId === rawDevice.vendorId && d.productId === rawDevice.productId
        );
        if (typeof matchingRawDevice == 'undefined' || matchingRawDevice == null ) {
            // NOT alert(). alert() blocks the main thread until it is dismissed,
            // which freezes the whole tab — and if the dialog opens behind
            // another window, or the tab is not focused, it looks exactly like a
            // crash: unresponsive page, 0% CPU, normal memory. That is fatal for
            // an unattended run, where this path can be hit on any of dozens of
            // pushes. Report it and let the caller fail the operation instead.
            console.error("Device disconnected? Not found among granted HID devices.");
            if (window.showToast) window.showToast('Device disconnected — reconnect it and try again.', 'error');
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
          let filtersToWrite = [...filters];

          // Ensure array is at most the maxFilters
          if (filtersToWrite.length > device.modelConfig.maxFilters) {
            console.warn(`USB Device PEQ: Truncating ${filtersToWrite.length} filters to ${device.modelConfig.maxFilters} (device limit)`);
            if (window.showToast) {
              window.showToast(`This device only supports ${device.modelConfig.maxFilters} PEQ filters - applying the first ${device.modelConfig.maxFilters} enabled filters.`, "warning", 10000, true);
            }

            const enabledFilters = filtersToWrite.filter(f => !f.disabled);
            filtersToWrite = enabledFilters.length >= device.modelConfig.maxFilters
              ? enabledFilters.slice(0, device.modelConfig.maxFilters)
              : [
                  ...enabledFilters,
                  ...filtersToWrite.filter(f => f.disabled).slice(0, device.modelConfig.maxFilters - enabledFilters.length)
                ];
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

          // Determine per-type support from granular flags
          const supportsLS = device.modelConfig.supportsLSFilter === true;
          const supportsHS = device.modelConfig.supportsHSFilter === true;
          const supportsLPHP = device.modelConfig.supportsLPHPFilters === true;

          const hasUnsupportedLS = filtersToWrite.some(f => f.type === "LSQ" && f.gain !== 0) && !supportsLS;
          const hasUnsupportedHS = filtersToWrite.some(f => f.type === "HSQ" && f.gain !== 0) && !supportsHS;
          const hasUnsupportedLPHP = filtersToWrite.some(f => (f.type === "LP" || f.type === "HP")) && !supportsLPHP;

          // Second, determine if we need pregain (only if globalGain is positive)
          const needsPreGain = preamp < 0;

          // Convert unsupported filter types to PK with gain=0
          for (let i = 0; i < filtersToWrite.length; i++) {
            const f = filtersToWrite[i];
            if ((f.type === "LSQ" && !supportsLS) ||
                (f.type === "HSQ" && !supportsHS) ||
                ((f.type === "LP" || f.type === "HP") && !supportsLPHP)) {
              console.log(`USB Device PEQ: converting unsupported ${f.type} filter to PK with gain=0`);
              filtersToWrite[i] = {...f, type: "PK", gain: 0};
            }
          }

          // Warn about unsupported filter types
          const hasUnsupportedShelfFilters = hasUnsupportedLS || hasUnsupportedHS;
          if (hasUnsupportedShelfFilters && needsPreGain && device.modelConfig.deviceHandlesPregain === true) {
            console.warn("Device handles pregain internally — host-computed pregain and unsupported shelf filters will be ignored");
            if (window.showToast) {
              window.showToast("Device handles pregain internally — unsupported filters will be ignored", "warning");
            }
          } else if (hasUnsupportedLS && hasUnsupportedHS) {
            console.warn("Device does not support LS or HS filters - ignoring");
            if (window.showToast) {
              window.showToast("Device does not support Low Shelf or High Shelf filters - ignoring", "warning");
            }
          } else if (hasUnsupportedLS) {
            console.warn("Device does not support Low Shelf filters - ignoring");
            if (window.showToast) {
              window.showToast("Device does not support Low Shelf filters - ignoring", "warning");
            }
          } else if (hasUnsupportedHS) {
            console.warn("Device does not support High Shelf filters - ignoring");
            if (window.showToast) {
              window.showToast("Device does not support High Shelf filters - ignoring", "warning");
            }
          } else if (needsPreGain && device.modelConfig.deviceHandlesPregain === true) {
            console.warn("Device handles pregain internally — host-computed pregain will not be written");
            if (window.showToast) {
              window.showToast("Device handles pregain internally — no host pregain applied", "warning");
            }
          }
          if (hasUnsupportedLPHP) {
            console.warn("Device does not support LP/HP filters - ignoring");
            if (window.showToast) {
              window.showToast("Device does not support Low Pass / High Pass filters - ignoring", "warning");
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

    // Returns the extras object for a device (capabilities beyond core PEQ).
    // The same object is already attached as device.extras when the device connects.
    const getExtras = (device) => device?.extras ?? buildExtras(device?.handler, device);

    return {
        getDeviceConnected,
        getAvailableSlots,
        disconnectDevice,
        pushToDevice,
        pullFromDevice,
        getCurrentDevice,
        getCurrentSlot,
        enablePEQ,
        getExtras,
    };
})();
