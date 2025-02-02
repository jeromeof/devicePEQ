// Copyright 2024 : Pragmatic Audio

/**
 * Initialise the plugin - passing the content from the extraEQ section so we can both query
 * and update that area and add our UI elements.
 *
 * @param context
 * @returns {Promise<void>}
 */
async function initializeDeviceEqPlugin(context) {
  console.log("Plugin initialized with context:", context);

  class DeviceEqUI {
    constructor() {
      this.deviceEqArea = document.getElementById('deviceEqArea');
      this.connectButton = this.deviceEqArea.querySelector('.connect-device');
      this.disconnectButton = this.deviceEqArea.querySelector('.disconnect-device');
      this.deviceNameElem = document.getElementById('deviceName');
      this.peqSlotArea = this.deviceEqArea.querySelector('.peq-slot-area');
      this.peqDropdown = document.getElementById('device-peq-slot-dropdown');
      this.pullButton = this.deviceEqArea.querySelector('.pull-filters-fromdevice');
      this.pushButton = this.deviceEqArea.querySelector('.push-filters-todevice');

      this.useNetwork = false;
      this.currentDevice = null;
      this.initializeUI();
    }

    initializeUI() {
      this.disconnectButton.hidden = true;
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.peqDropdown.hidden = true;
      this.peqSlotArea.hidden = true;
    }

    showConnectedState(deviceName, availableSlots, currentSlot) {
      this.connectButton.hidden = true;
      this.disconnectButton.hidden = false;
      this.deviceNameElem.textContent = deviceName;
      this.populatePeqDropdown(availableSlots, currentSlot);
      this.pullButton.hidden = false;
      this.pushButton.hidden = false;
      this.peqDropdown.hidden = false;
      this.peqSlotArea.hidden = false;
    }

    showDisconnectedState() {
      this.useNetwork = false;
      this.currentDevice = null;
      this.connectButton.hidden = false;
      this.disconnectButton.hidden = true;
      this.deviceNameElem.textContent = 'None';
      this.peqDropdown.innerHTML = '<option value="-1">PEQ Disabled</option>';
      this.peqDropdown.hidden = true;
      this.pullButton.hidden = true;
      this.pushButton.hidden = true;
      this.peqSlotArea.hidden = true;
    }

    populatePeqDropdown(slots, currentSlot) {
      // Clear existing options and add the default "PEQ Disabled" option
      this.peqDropdown.innerHTML = '<option value="-1">PEQ Disabled</option>';

      // Populate the dropdown with available slots
      slots.forEach(slot => {
        const option = document.createElement('option');
        option.value = slot.id;
        option.textContent = slot.name;
        this.peqDropdown.appendChild(option);
      });

      // Set the selected option based on currentSlot
      if (currentSlot === -1) {
        // Select "PEQ Disabled"
        this.peqDropdown.selectedIndex = 0;
      } else {
        // Attempt to select the option matching currentSlot
        const matchingOption = Array.from(this.peqDropdown.options).find(option => option.value === String(currentSlot));
        if (matchingOption) {
          this.peqDropdown.value = currentSlot;
        } else {
          // If no matching option, default to "PEQ Disabled"
          this.peqDropdown.selectedIndex = 0;
        }
      }
    }
  }

  function loadHtml() {
    // Define the HTML to insert
    const deviceEqHTML = `
        <div class="device-eq disabled" id="deviceEqArea">
            <h5>Device PEQ</h5>
            <div class="settings-row">
                <button class="connect-device">Connect to Device</button>
                <button class="disconnect-device">Disconnect From <span id="deviceName">None</span></button>
            </div>
            <div class="peq-slot-area">
                <select name="device-peq-slot" id="device-peq-slot-dropdown">
                    <option value="None" selected>Select PEQ Slot</option>
                </select>
            </div>
            <div class="filters-button">
                <button class="pull-filters-fromdevice">Pull From Device</button>
                <button class="push-filters-todevice">Push To Device</button>
            </div>
        </div>
    `;

    // Find the <div class="extra-eq"> element
    const extraEqElement = document.querySelector('.extra-eq');

    if (extraEqElement) {
      // Insert the new HTML below the "extra-eq" div
      extraEqElement.insertAdjacentHTML('afterend', deviceEqHTML);
      console.log('Device EQ UI added below <div class="extra-eq">');
    } else {
      console.error('Element <div class="extra-eq"> not found in the DOM.');
    }
  }

  try {
    // Dynamically import USB and Network connectors
    const UsbHIDConnectorAsync = await import('./usbHidConnector.js').then((module) => module.UsbHIDConnector);
    const UsbHIDConnector = await UsbHIDConnectorAsync;
    console.log('UsbHIDConnector loaded');

    const NetworkDeviceConnectorAsync = await import('./networkDeviceConnector.js').then((module) => module.NetworkDeviceConnector);
    const NetworkDeviceConnector = await NetworkDeviceConnectorAsync;
    console.log('NetworkDeviceConnector loaded');

    if ('hid' in navigator || 'fetch' in window) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initializeDeviceEQ());
      } else {
        // DOM is already loaded
        initializeDeviceEQ();
      }

      function initializeDeviceEQ() {
        // Dynamically load the HTML we need in the right place
        loadHtml();

        const deviceEqUI = new DeviceEqUI();

        // Show the Connect button if WebHID is supported
        deviceEqUI.deviceEqArea.classList.remove('disabled');
        deviceEqUI.connectButton.hidden = false;
        deviceEqUI.disconnectButton.hidden = true;

        // Connect Button Event Listener
        deviceEqUI.connectButton.addEventListener('click', async () => {
          try {
            // Show a custom dialog to select Network or USB
            const selection = await showDeviceSelectionDialog();

            if (selection.useNetwork) {
              if (!selection.ipAddress) {
                alert("Please enter a valid IP address.");
                return;
              }
              setCookie("networkDeviceIP", selection.ipAddress, 30); // Save IP for 30 days
              setCookie("networkDeviceType", selection.deviceType, 30); // Store device type for 30 days

              // Connect via Network using the provided IP
              const device = await NetworkDeviceConnector.getDeviceConnected(selection.ipAddress, selection.deviceType);
              if (device) {
                deviceEqUI.showConnectedState(
                  device.model,
                  await NetworkDeviceConnector.getAvailableSlots(device),
                  await NetworkDeviceConnector.getCurrentSlot(device)
                );
              }
            } else {
              // Connect via USB and show the HID device picker
              const device = await UsbHIDConnector.getDeviceConnected();
              if (device) {
                deviceEqUI.showConnectedState(
                  device.model,
                  await UsbHIDConnector.getAvailableSlots(device),
                  await UsbHIDConnector.getCurrentSlot(device)
                );

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            }
          } catch (error) {
            console.error("Error connecting to device:", error);
            alert("Failed to connect to the device.");
          }
        });


  // Cookie functions
        function setCookie(name, value, days) {
          let expires = "";
          if (days) {
            const date = new Date();
            date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
            expires = "; expires=" + date.toUTCString();
          }
          document.cookie = name + "=" + value + "; path=/" + expires;
        }

        function getCookie(name) {
          const nameEQ = name + "=";
          const cookies = document.cookie.split(';');
          for (let i = 0; i < cookies.length; i++) {
            let c = cookies[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
          }
          return null;
        }

        function deleteCookie(name) {
          document.cookie = name + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC";
        }

        function showDeviceSelectionDialog() {
          return new Promise((resolve) => {
            const storedIP = getCookie("networkDeviceIP") || ""; // Retrieve stored IP
            const storedDeviceType = getCookie("networkDeviceType") || "WiiM"; // Default to WiiM
            // Define the HTML structure for the dialog
            const dialogHTML = `
            <div id="device-selection-dialog" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #fff;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.3);
                text-align: center;
                z-index: 10000;
                min-width: 320px;
                font-family: Arial, sans-serif;
            ">
                <h3 style="margin-bottom: 10px; color: black;">Select Connection Type</h3>
                <p style="color: black;">Choose whether to connect via USB or Network.</p>

                <!-- USB and Network Selection Buttons -->
                <button id="network-button" style="margin: 10px; padding: 10px 15px; font-size: 14px; background: #007BFF; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Network</button>
                <button id="usb-button" style="margin: 10px; padding: 10px 15px; font-size: 14px; background: #007BFF; color: #fff; border: none; border-radius: 4px; cursor: pointer;">USB</button>

                <br>

                <!-- IP Address Field (Initially Hidden) -->
                <input type="text" id="ip-input" placeholder="Enter IP Address" value="${storedIP}" style="display: none; margin-top: 10px; width: 80%;">

                <!-- Network Device Selection (Initially Hidden) -->
                <div id="network-options" style="display: none; margin-top: 15px; text-align: center;">
                <label style="display: inline-flex; align-items: center; gap: 5px; margin-right: 15px; font-weight: bold; color: black;">
                    <input type="radio" name="network-device" value="WiiM" ${storedDeviceType === "WiiM" ? "checked" : ""} style="width: 18px; height: 18px;"> WiiM
                </label>
                <label style="display: inline-flex; align-items: center; gap: 5px; font-weight: bold; color: gray;">
                    <input type="radio" name="network-device" value="coming-soon" disabled ${storedDeviceType === "coming-soon" ? "checked" : ""} style="width: 18px; height: 18px;"> Other Devices Coming Soon
                </label>
            </div>

                <br>
                <button id="submit-button" style="display: none; margin-top: 10px; padding: 10px 15px; font-size: 14px; background: #28A745; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Connect</button>
                <button id="cancel-button" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; background: gray; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
            </div>
        `;

            // Create a container div for the dialog
            const dialogContainer = document.createElement("div");
            dialogContainer.innerHTML = dialogHTML;
            document.body.appendChild(dialogContainer);

            // Get references to elements inside the dialog
            const dialog = document.getElementById("device-selection-dialog");
            const networkButton = document.getElementById("network-button");
            const usbButton = document.getElementById("usb-button");
            const ipInput = document.getElementById("ip-input");
            const networkOptions = document.getElementById("network-options");
            const submitButton = document.getElementById("submit-button");
            const cancelButton = document.getElementById("cancel-button");

            // Handle Network Selection
            networkButton.addEventListener("click", () => {
              ipInput.style.display = "block";  // Show IP input field
              networkOptions.style.display = "block";  // Show radio buttons
              submitButton.style.display = "inline-block"; // Show submit button
            });

            // Handle USB Selection - Immediately resolve and remove the dialog
            usbButton.addEventListener("click", async () => {
              document.body.removeChild(dialogContainer);
              resolve({useNetwork: false}); // Proceed with USB connection
            });

            // Handle Network Connection Submission
            submitButton.addEventListener("click", () => {
              const ipAddress = ipInput.value.trim();
              if (!ipAddress) {
                alert("Please enter a valid IP address.");
                return;
              }

              const selectedDevice = document.querySelector('input[name="network-device"]:checked').value;
              document.body.removeChild(dialogContainer);
              resolve({useNetwork: true, ipAddress: ipAddress, deviceType: selectedDevice});
            });

            // Handle Cancel Button Click
            cancelButton.addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve(null); // User canceled
            });
          });
        }


        // Disconnect Button Event Listener
        deviceEqUI.disconnectButton.addEventListener('click', async () => {
          try {
            if (deviceEqUI.useNetwork) {
              await NetworkDeviceConnector.disconnectDevice();
            } else {
              await UsbHIDConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          } catch (error) {
            console.error("Error disconnecting:", error);
            alert("Failed to disconnect.");
          }
        });

        // Pull Button Event Listener
        deviceEqUI.pullButton.addEventListener('click', async () => {
          try {
            const device = deviceEqUI.currentDevice;
            const selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              alert("No device connected or PEQ slot selected.");
              return;
            }

            const result = await UsbHIDConnector.pullFromDevice(device, selectedSlot);
            if (result.filters.length > 0) {
              context.filtersToElem(result.filters);
              applyEQ();
            } else {
              alert("No PEQ filters found on the device.");
            }
          } catch (error) {
            console.error("Error pulling PEQ filters:", error);
            if (!deviceEqUI.useNetwork) {
              await UsbHIDConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          }
        });

        // Push Button Event Listener
        deviceEqUI.pushButton.addEventListener('click', async () => {
          try {
            const device = deviceEqUI.currentDevice;
            const selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              alert("No device connected or PEQ slot selected.");
              return;
            }

            // ✅ Use context to get filters instead of undefined elemToFilters()
            const filters = context.elemToFilters(true);
            if (!filters.length) {
              alert("Please add at least one filter before pushing.");
              return;
            }

            const preamp_gain = context.calcEqDevPreamp();
            const disconnect = await device.pushToDevice(
              device,
              selectedSlot,
              preamp_gain,
              filters
            );

            if (disconnect) {
              await UsbHIDConnector.disconnectDevice();
              deviceEqUI.showDisconnectedState();
              alert("PEQ Saved - Restarting");
            }
          } catch (error) {

            console.error("Error pushing PEQ filters:", error);
            await UsbHIDConnector.disconnectDevice();
            deviceEqUI.showDisconnectedState();
          }
        });

        // PEQ Dropdown Change Event Listener
        deviceEqUI.peqDropdown.addEventListener('change', async (event) => {
          const selectedValue = event.target.value;
          console.log(`PEQ Slot selected: ${selectedValue}`);

          let device;

          if (useNetwork) {
            device = NetworkDeviceConnector.getCurrentDevice(); // Get the connected network device
          } else {
            device = UsbHIDConnector.getCurrentDevice(); // Get the connected USB HID device
          }

          if (!device) {
            console.error("No device connected.");
            alert("No device connected.");
            return;
          }

          try {
            if (selectedValue === "-1") {
              if (useNetwork) {
                await NetworkDeviceConnector.enablePEQ(device, false, -1);
              } else {
                await UsbHIDConnector.enablePEQ(device, false, -1);
              }
              console.log("PEQ Disabled.");
            } else {
              const slotId = parseInt(selectedValue, 10);

              if (useNetwork) {
                await NetworkDeviceConnector.enablePEQ(device, true, slotId);
              } else {
                await UsbHIDConnector.enablePEQ(device, true, slotId);
              }

              console.log(`PEQ Enabled for slot ID: ${slotId}`);
            }
          } catch (error) {
            console.error("Error updating PEQ slot:", error);
            alert("Failed to update PEQ slot.");
          }
        });

      }
    }
  } catch (error) {
    console.error("Error initializing Device EQ Plugin:", error.message);
  }
}

// Export for CommonJS & ES Modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = initializeDeviceEqPlugin;
}

// Export for ES Modules
export default initializeDeviceEqPlugin;
