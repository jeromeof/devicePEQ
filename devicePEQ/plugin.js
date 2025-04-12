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

    showConnectedState(device, connectionType, availableSlots, currentSlot) {
      this.connectButton.hidden = true;
      this.currentDevice = device;
      this.connectionType = connectionType;
      this.disconnectButton.hidden = false;
      this.deviceNameElem.textContent = device.model;
      this.populatePeqDropdown(availableSlots, currentSlot);
      this.pullButton.hidden = false;
      this.pushButton.hidden = false;
      this.peqDropdown.hidden = false;
      this.peqSlotArea.hidden = false;
    }

    showDisconnectedState() {
      this.connectionType = "usb";  // Assume usb
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
        <style>
            .info-button {
      background: none;
      border: none;
      font-size: 1.2em;
      cursor: pointer;
      vertical-align: middle;
      margin-left: 6px;
      color: #555;
    }

    .info-button:hover {
      color: #000;
    }

    .modal.hidden {
      display: none;
    }

    .modal {
      position: fixed;
      z-index: 9999;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .modal-content {
      background-color: #fff;
      padding: 20px 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      position: relative;
    }

    .modal-content .close {
      position: absolute;
      right: 16px;
      top: 12px;
      font-size: 1.4em;
      cursor: pointer;
    }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    .tab-button {
      padding: 6px 12px;
      border: none;
      background-color: #eee;
      cursor: pointer;
      border-radius: 4px;
    }

    .tab-button.active {
      background-color: #ccc;
      font-weight: bold;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .sub-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
      border-bottom: 1px solid #ccc;
    }

    .sub-tab-button {
      padding: 4px 10px;
      border: none;
      background: #eee;
      cursor: pointer;
      border-radius: 4px 4px 0 0;
      font-size: 14px;
    }

    .sub-tab-button.active {
      background: #ccc;
      font-weight: bold;
    }

    .sub-tab-content {
      display: none;
    }

    .sub-tab-content.active {
      display: block;
    }
        </style>
            <h5>Device PEQ</h5>
            <div class="settings-row">
                <button class="connect-device">Connect to Device</button>
                <button class="disconnect-device">Disconnect From <span id="deviceName">None</span></button>
                <!-- Info Button -->
                <button id="deviceInfoBtn" aria-label="Device Help" title="Device Help">ℹ️</button>
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
        <!-- Modal -->
        <div id="deviceInfoModal" class="modal hidden">
          <div class="modal-content">
            <button id="closeModalBtn" class="close" aria-label="Close Modal">&times;</button>
            <h3>About Device PEQ - v0.3</h3>

            <div class="tabs">
              <button class="tab-button active" data-tab="tab-overview">Overview</button>
              <button class="tab-button" data-tab="tab-supported">Supported Devices</button>
              <button class="tab-button" data-tab="tab-howto">How to Use</button>
            </div>

            <div id="tab-overview" class="tab-content active">
              <p>This section lets you connect to a compatible USB or network-connected audio device (such as Moondrop, Tanchjim, JDS Labs, WiiM, or other Walkplay-based products) and interact with its Parametric EQ (PEQ) settings.</p>

              <h4>Supported Brands & Manufacturers</h4>
              <ul>
                <li><strong>FiiO:</strong> Most of their USB dongles including JA11, KA15 and KA17</li>
                <li><strong>Moondrop:</strong> Moondrop CDSP, Chu II DSP, Quark2 and others </li>
                <li><strong>Tanchjim:</strong> Bunny DSP, One DSP and others should work</li>
                <li><strong>Walkplay</strong> Most devices compatible with Walkplay Android APK</li>
                <li><strong>KTMicro</strong> Many KTMicro DSP devices should work </li>
                <li><strong>EPZ:</strong> GM20 and TP13</li>
                <li><strong>JCally:</strong> JM20 Pro and JM12 and possible others</li>
                <li><strong>JDS Labs:</strong> Supporting the Element IV via USB Serial interface</li>
                <li><strong>WiiM:</strong> Supports pushing parametric EQ over the home network</li>
              </ul>
            </div>

            <div id="tab-supported" class="tab-content">
              <div class="sub-tabs">
                <button class="sub-tab-button active" data-subtab="sub-fiio">FiiO</button>
                <button class="sub-tab-button" data-subtab="sub-walkplay">Walkplay</button>
                <button class="sub-tab-button" data-subtab="sub-tanchjim">KTMicro</button>
                <button class="sub-tab-button" data-subtab="sub-jdslabs">JDS Labs</button>
                <button class="sub-tab-button" data-subtab="sub-wiim">WiiM</button>
              </div>

              <div id="sub-fiio" class="sub-tab-content active">
                <h5>FiiO / Jade Audio</h5>
                <p>Currently, I have tested the following FiiO devices: </p>
                <ul>
                  <li>JA11</li>
                  <li>KA17</li>
                  <li>KA15</li>
                  <li><em>Note:</em> Retro Nano has limited compatibility</li>
                </ul>
                <p>Mostly if a FiiO device works with their excellent Web-based PEQ editor at <a href="https://fiiocontrol.fiio.com" target="_blank">fiiocontrol.fiio.com</a> it should work here also</p>
              </div>

              <div id="sub-walkplay" class="sub-tab-content">
                <h5>Walkplay-Based Devices</h5>
                <p>Since Walkplay licenses their DSP technology to multiple brands, the following devices are known to work but many other devices might work:</p>
                <ul>
                  <li>Moondrop Quark2 DSP (IEM)</li>
                  <li>Moondrop Echo A (Dongle)</li>
                  <li>JCally JM20-Pro (Dongle)</li>
                  <li>Generic "Hi-Max" (Dongle)</li>
                  <li>EPZ G20 (IEM)</li>
                  <li>EPZ TP13 (Dongle)</li>
                </ul>
                <p>Walkplay also provide an excellent editor at <a href="https://peq.szwalkplay.com" target="_blank">peq.szwalkplay.com</a> and a decent Android App</p>
                <p>Note: One quirk with Walkplay devices is their PEQ WebApp and their Android App 'daches' what it thinks is the current PEQ for a device in the cloud (once you register) so values pushed <b>may not be visible</b> to their Website or Mobile App</p>
              </div>

              <div id="sub-tanchjim" class="sub-tab-content">
                <h5>KTMicro Devices</h5>
                <p>Currently, I have tested the following KTMicro DSP devices but many others should work</p>
                <ul>
                  <li>Moondrop CDSP</li>
                  <li>Moondrop Quark2</li>
                  <li>Tanchjim One DSP (IEM)</li>
                  <li>Tanchjim Bunny DSP (IEM)</li>
                </ul>
                <p>You also use the official Tanchjim Android App for EQ and device configuration.</p>
              </div>

            <div id="sub-jdslabs" class="sub-tab-content">
              <h5>JDS Labs</h5>
              <p>Supports PEQ control over USB Serial for compatible products like the JDS Labs Element IV, basically if it works on JDS Labs excellent <a href="https://core.jdslabs.com.">Core PEQ</a> it should work. You can push and pull filters directly to the device.</p>
              <p>Note: This option is only visible in advanced mode </p>
            </div>

            <div id="sub-wiim" class="sub-tab-content">
              <h5>WiiM</h5>
              <p>Supports network-based PEQ settings for WiiM devices using HTTP APIs. Requires entering the local IP address of the device and selecting the audio source (e.g., Wi-Fi, Bluetooth).</p>
              <p>Note: This option is only visible in advanced mode </p>
            </div>
          </div>

            <div id="tab-howto" class="tab-content">
              <ul>
                <li><strong>Connect to Device:</strong> Open USB prompt and choose your device.</li>
                <li><strong>Select PEQ Slot:</strong> If supported, choose which EQ slot to view or modify.</li>
                <li><strong>Pull From Device:</strong> Read and load PEQ filter data into the interface.</li>
                <li><strong>Push To Device:</strong> Apply your PEQ filter settings back to the device.</li>
                <li><strong>Disconnect:</strong> Cleanly close the USB connection.</li>
              </ul>
              <p>⚠️ Please ensure your device is compatible and unlocked. Some may require the official app to enable USB EQ editing.</p>
            </div>
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
// Open modal
    document.getElementById('deviceInfoBtn').addEventListener('click', () => {
      document.getElementById('deviceInfoModal').classList.remove('hidden');
    });

// Close modal via close button
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.getElementById('deviceInfoModal').classList.add('hidden');
    });

// Optional: close modal when clicking outside content
    document.getElementById('deviceInfoModal').addEventListener('click', (e) => {
      if (e.target.id === 'deviceInfoModal') {
        document.getElementById('deviceInfoModal').classList.add('hidden');
      }
    });

    document.querySelectorAll(".tab-button").forEach(btn => {
      btn.addEventListener("click", () => {
        // Toggle active tab button
        document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        // Show correct tab content
        const tabId = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(tabId).classList.add("active");
      });
    });

    document.querySelectorAll(".sub-tab-button").forEach(button => {
      button.addEventListener("click", () => {
        // Update button state
        document.querySelectorAll(".sub-tab-button").forEach(b => b.classList.remove("active"));
        button.classList.add("active");

        // Show corresponding sub-tab
        const tabId = button.getAttribute("data-subtab");
        document.querySelectorAll(".sub-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(tabId).classList.add("active");
      });
    });

  }

  try {
    // Dynamically import USB and Network connectors
    const UsbHIDConnectorAsync = await import('./usbHidConnector.js').then((module) => module.UsbHIDConnector);
    const UsbHIDConnector = await UsbHIDConnectorAsync;
    console.log('UsbHIDConnector loaded');

    const UsbSerialConnectorAsync = await import('./usbSerialConnector.js').then((module) => module.UsbSerialConnector);
    const UsbSerialConnector = await UsbSerialConnectorAsync;
    console.log('UsbSerialConnector loaded');

    const NetworkDeviceConnectorAsync = await import('./networkDeviceConnector.js').then((module) => module.NetworkDeviceConnector);
    const NetworkDeviceConnector = await NetworkDeviceConnectorAsync;
    console.log('NetworkDeviceConnector loaded');

    if ('hid' in navigator) { // Only support browsers with HID support for now
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
            let selection =  {connectionType: "usb"}; // Assume usb only by default
            if (context.config.advanced) {
              // Show a custom dialog to select Network or USB
              selection = await showDeviceSelectionDialog();
            }

            if (selection.connectionType == "network") {
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
                  device,
                  selection.connectionType,
                  await NetworkDeviceConnector.getAvailableSlots(device),
                  await NetworkDeviceConnector.getCurrentSlot(device)
                );
              }
            } else if (selection.connectionType == "usb") {
              // Connect via USB and show the HID device picker
              const device = await UsbHIDConnector.getDeviceConnected();
              if (device) {
                deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbHIDConnector.getAvailableSlots(device),
                  await UsbHIDConnector.getCurrentSlot(device)
                );

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            } else if (selection.connectionType == "serial") {
              // Connect via USB and show the Serial device picker
              const device = await UsbSerialConnector.getDeviceConnected();
              if (device) {
                deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbSerialConnector.getAvailableSlots(device),
                  await UsbSerialConnector.getCurrentSlot(device)
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
            const storedIP = getCookie("networkDeviceIP") || "";
            const storedDeviceType = getCookie("networkDeviceType") || "WiiM";

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
          min-width: 340px;
          font-family: Arial, sans-serif;
      ">
        <h3 style="margin-bottom: 10px; color: black;">Select Connection Type</h3>
        <p style="color: black;">Choose how you want to connect to your device.</p>

        <!-- Selection Buttons -->
        <button id="usb-hid-button" style="margin: 10px; padding: 10px 15px; font-size: 14px; background: #007BFF; color: #fff; border: none; border-radius: 4px; cursor: pointer;">USB Device</button>
        <button id="usb-serial-button" style="margin: 10px; padding: 10px 15px; font-size: 14px; background: #6f42c1; color: #fff; border: none; border-radius: 4px; cursor: pointer;">USB Serial Device</button>
        <button id="network-button" style="margin: 10px; padding: 10px 15px; font-size: 14px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Network</button>

        <!-- IP Address Input -->
        <input type="text" id="ip-input" placeholder="Enter IP Address" value="${storedIP}" style="display: none; margin-top: 10px; width: 80%;">
        <!-- Test IP Button (Initially Hidden) -->
        <button id="test-ip-button" style="display: none; margin-top: 10px; padding: 8px 12px; font-size: 13px; background: #ffc107; color: #000; border: none; border-radius: 4px; cursor: pointer;">
          Test IP Address (Open in Browser Tab)
        </button>
        <!-- Network Options -->
        <div id="network-options" style="display: none; margin-top: 15px; text-align: left; background: #f9f9f9; padding: 12px; border-radius: 6px; font-size: 14px; color: #222;">
          <p style="margin-bottom: 10px;"><strong>⚠️ Advanced Network Configuration</strong></p>
          <p>This section requires some basic understanding of networking. Please continue only if you are familiar with concepts like IP addresses and self-signed certificates.</p>

          <p><strong>Why the warning?</strong></p>
          <p>Devices like the <strong>WiiM</strong> expose a local web server for configuration (similar to how home routers work). These devices often use a <em>self-signed certificate</em> to enable HTTPS, which is secure but <b>not trusted</b> by your browser by default.</p>

          <p>As a result, when trying to connect via a web browser, you may see a <strong>security warning</strong> (e.g., "Your connection is not private"). This is normal and expected. If you choose to <b>trust the device</b> and accept the warning, this tool will attempt to access its PEQ API.</p>

          <p>Note: Due to this security restriction I can only push the PEQ filters to the WiiM Device and cannot read them. They will be called HeadphoneEQ when pushed.</p>

          <p>If you're okay proceed you can at least push the PEQ to this device, reading from the device breaks this security and will fail</p>
          <div style="margin-top: 10px; text-align: center;">
            <label style="display: inline-flex; align-items: center; gap: 5px; margin-right: 15px; font-weight: bold; color: black;">
              <input type="radio" name="network-device" value="WiiM" ${storedDeviceType === "WiiM" ? "checked" : ""} style="width: 18px; height: 18px;"> WiiM
            </label>
            <label style="display: inline-flex; align-items: center; gap: 5px; font-weight: bold; color: gray;">
              <input type="radio" name="network-device" value="coming-soon" disabled ${storedDeviceType === "coming-soon" ? "checked" : ""} style="width: 18px; height: 18px;"> Other Devices Coming Soon
            </label>
          </div>
        </div>
        <!-- Action Buttons -->
        <br>
        <button id="submit-button" style="display: none; margin-top: 10px; padding: 10px 15px; font-size: 14px; background: #28A745; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Connect</button>
        <button id="cancel-button" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; background: gray; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
      </div>
    `;

            const dialogContainer = document.createElement("div");
            dialogContainer.innerHTML = dialogHTML;
            document.body.appendChild(dialogContainer);

            const ipInput = document.getElementById("ip-input");
            const networkOptions = document.getElementById("network-options");
            const submitButton = document.getElementById("submit-button");
            const testIpButton = document.getElementById("test-ip-button");
            // Event: USB HID
            document.getElementById("usb-hid-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "usb" });
            });

            // Event: USB Serial
            document.getElementById("usb-serial-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "serial" });
            });

            // Event: Network
            document.getElementById("network-button").addEventListener("click", () => {
              ipInput.style.display = "block";
              networkOptions.style.display = "block";
              submitButton.style.display = "inline-block";
            });

            // Watch for IP input to show the Test IP button
            ipInput.addEventListener("input", () => {
              const ip = ipInput.value.trim();
              const isValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip); // basic IPv4 validation
              testIpButton.style.display = isValid ? "inline-block" : "none";
              submitButton.style.display = isValid ? "inline-block" : "none";
            });

            // Handle Test IP Button Click
            testIpButton.addEventListener("click", () => {
              const ip = ipInput.value.trim();
              if (!ip) return;
              const confirmProceed = confirm(`This will open a new tab to https://${ip}.\nIf your browser shows a page with some information you have already accepted the certificate, if is shows a security warning, typically "ERR_CERT_AUTHORITY_INVALID" then you will need to accept this cerificate to continue. \n\n You should examine this certificate, check that it is issued by LinkpLay and then used the "Advanced" button to accept this self-signed certificate to proceed with secure access. If this is successful you should see a page with technical information`);
              if (confirmProceed) {
                window.open(`https://${ip}/httpapi.asp?command=getStatusEx`, "_blank", "noopener,noreferrer");
              }
            });

            // Submit Network
            submitButton.addEventListener("click", () => {
              const ip = ipInput.value.trim();
              if (!ip) {
                alert("Please enter a valid IP address.");
                return;
              }

              const selectedDevice = document.querySelector('input[name="network-device"]:checked')?.value || "WiiM";
              document.body.removeChild(dialogContainer);
              resolve({ connectionType: "network", ipAddress: ip, deviceType: selectedDevice });
            });

            // Cancel
            document.getElementById("cancel-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve({connectionType: "none"});
            });
          });
        }


        // Disconnect Button Event Listener
        deviceEqUI.disconnectButton.addEventListener('click', async () => {
          try {
            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb")  {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial")  {
              // serial support here
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
            var result = null;
            if (deviceEqUI.connectionType == "network") {
              result = await NetworkDeviceConnector.pullFromDevice(device, selectedSlot);
            } else if (deviceEqUI.connectionType == "usb") {
              result = await UsbHIDConnector.pullFromDevice(device, selectedSlot);
            } else if (deviceEqUI.connectionType == "serial") {
              result = await UsbSerialConnector.pullFromDevice(device, selectedSlot);
            }
            if (result.filters.length > 0) {
              context.filtersToElem(result.filters);
              context.applyEQ();
            } else {
              alert("No PEQ filters found on the device.");
            }
          } catch (error) {
            console.error("Error pulling PEQ filters:", error);
            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb") {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial") {
              await UsbSerialConnector.disconnectDevice();
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

            const preamp_gain = context.calcEqDevPreamp(filters);
            let disconnect = false;
            if (deviceEqUI.connectionType == "network") {
              disconnect = await NetworkDeviceConnector.pushToDevice(device, selectedSlot, preamp_gain, filters);
            } else if (deviceEqUI.connectionType == "usb") {
              disconnect = await UsbHIDConnector.pushToDevice(device, selectedSlot, preamp_gain, filters);
            } else if (deviceEqUI.connectionType == "serial") {
              disconnect = await UsbSerialConnector.pushToDevice(device, selectedSlot, preamp_gain, filters);
            }

            if (disconnect) {
              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.disconnectDevice();
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.disconnectDevice();
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.disconnectDevice();
              }
              deviceEqUI.showDisconnectedState();
              alert("PEQ Saved - Restarting");
            }
          } catch (error) {

            console.error("Error pushing PEQ filters:", error);
            if (deviceEqUI.connectionType == "network") {
              await NetworkDeviceConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "usb") {
              await UsbHIDConnector.disconnectDevice();
            } else if (deviceEqUI.connectionType == "serial") {
              await UsbSerialConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          }
        });

        // PEQ Dropdown Change Event Listener
        deviceEqUI.peqDropdown.addEventListener('change', async (event) => {
          const selectedValue = event.target.value;
          console.log(`PEQ Slot selected: ${selectedValue}`);

          try {
            if (selectedValue === "-1") {
              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.enablePEQ(deviceEqUI.currentDevice, false, -1);
              }
              console.log("PEQ Disabled.");
            } else {
              const slotId = parseInt(selectedValue, 10);

              if (deviceEqUI.connectionType == "network") {
                await NetworkDeviceConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
              } else if (deviceEqUI.connectionType == "usb") {
                await UsbHIDConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
              } else if (deviceEqUI.connectionType == "serial") {
                await UsbSerialConnector.enablePEQ(deviceEqUI.currentDevice, true, slotId);
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
    console.  error("Error initializing Device EQ Plugin:", error.message);
  }
}

// Export for CommonJS & ES Modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = initializeDeviceEqPlugin;
}

// Export for ES Modules
export default initializeDeviceEqPlugin;
