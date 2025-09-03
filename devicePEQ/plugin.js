// Copyright 2024 : Pragmatic Audio

/**
 * Initialise the plugin - passing the content from the extraEQ section so we can both query
 * and update that area and add our UI elements.
 *
 * @param context
 * @returns {Promise<void>}
 */
async function initializeDeviceEqPlugin(context) {
  // Initialize console log history array if it doesn't exist
  if (!window.consoleLogHistory) {
    window.consoleLogHistory = [];

    // Store original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    // Flag to control logging visibility
    window.showDeviceLogs = false;

    // Override console.log to capture logs
    console.log = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[LOG] ${logString}`);

      // Call original method only if showLogs is true or we have an experimental device
      if (window.showDeviceLogs) {
        originalConsoleLog.apply(console, arguments);
      }
    };

    // Override console.error to capture errors
    console.error = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[ERROR] ${logString}`);

      // Always show errors regardless of log settings
      originalConsoleError.apply(console, arguments);
    };

    // Override console.warn to capture warnings
    console.warn = function() {
      // Convert arguments to string and add to history
      const logString = Array.from(arguments).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      window.consoleLogHistory.push(`[WARN] ${logString}`);

      // Always show warnings regardless of log settings
      originalConsoleWarn.apply(console, arguments);
    };

    // Limit history to last 500 entries
    const MAX_LOG_HISTORY = 500;
    setInterval(() => {
      if (window.consoleLogHistory.length > MAX_LOG_HISTORY) {
        window.consoleLogHistory = window.consoleLogHistory.slice(-MAX_LOG_HISTORY);
      }
    }, 10000); // Check every 10 seconds
  }

  // Check if showLogs flag is passed in context
  if (context && context.config && context.config.showLogs === true) {
    window.showDeviceLogs = true;
    console.log("Plugin initialized with showLogs enabled");
  } else {
    console.log("Plugin initialized with context:", context);
  }

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
      this.lastPushTime = 0; // Track when the push button was last clicked

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

      // Check if the push button should still be disabled based on lastPushTime
      const currentTime = Math.floor(Date.now() / 1000);
      const cooldownTime = 0.2; // Cooldown time in seconds (200ms)

      if (currentTime < this.lastPushTime + cooldownTime) {
        // Button is still in cooldown period
        this.pushButton.disabled = true;
        this.pushButton.style.opacity = "0.5";
        this.pushButton.style.cursor = "not-allowed";

        // Set a new timeout for the remaining cooldown time
        const remainingTime = (this.lastPushTime + cooldownTime) - currentTime;
        setTimeout(() => {
          this.pushButton.disabled = false;
          this.pushButton.style.opacity = "";
          this.pushButton.style.cursor = "";
          console.log("Push button re-enabled after cooldown period");
        }, remainingTime * 1000); // Convert seconds to milliseconds
      }
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

  // Function to show toast messages
  // Parameters:
  // - message: The text message to display
  // - type: The type of toast (success, error, warning) with default 'success'
  // - timeout: The time in milliseconds before the toast disappears (default 5000ms)
  // - requireClick: If true, adds a "Continue" button that must be clicked to dismiss the toast (ignores timeout)
  //                 and returns a Promise that resolves when the button is clicked
  //
  // Example usage with await to block execution until user clicks Continue:
  // async function someFunction() {
  //   // Show a toast and wait for user to click Continue
  //   await showToast("Please confirm to continue", "warning", 0, true);
  //   // Code here will only execute after the user clicks Continue
  //   console.log("User clicked Continue");
  // }
  function showToast(message, type = 'success', timeout = 5000, requireClick = false) {
    return new Promise((resolve) => {
      // Create toast element
      const toast = document.createElement('div');
      toast.id = `device-toast-${type}`; // Type-specific ID

      // Create message container
      const messageContainer = document.createElement('div');
      messageContainer.textContent = message;
      toast.appendChild(messageContainer);

      // Set style based on type
      if (type === 'success') {
        toast.style.backgroundColor = '#4CAF50'; // Green
        toast.style.bottom = '80px'; // Bottom position for success
      } else if (type === 'error') {
        toast.style.backgroundColor = '#F44336'; // Red
        toast.style.top = '30px'; // Top position for error
        toast.style.bottom = 'auto'; // Override bottom
      } else if (type === 'warning') {
        toast.style.backgroundColor = '#FF9800'; // Orange
        toast.style.bottom = '30px'; // Bottom position for warning
      }

      // Common styles
      toast.style.color = 'white';
      toast.style.padding = '16px';
      toast.style.borderRadius = '4px';
      toast.style.position = 'fixed';
      toast.style.zIndex = '10000';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%)';
      toast.style.minWidth = '250px';
      toast.style.textAlign = 'center';
      toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';

      // Check for existing toast of the same type
      const existingToast = document.getElementById(`device-toast-${type}`);
      if (existingToast) {
        // Check if the existing toast has a continue button (requireClick=true)
        const continueButton = existingToast.querySelector('button');
        if (continueButton) {
          // If there's an existing toast with a continue button, return early
          // to allow the user to interact with it
          return resolve(); // Resolve immediately since we're not showing a new toast
        }
        document.body.removeChild(existingToast);
      }

      // If requireClick is true, add a continue button
      if (requireClick) {
        // Add a continue button
        const continueButton = document.createElement('button');
        continueButton.textContent = 'Click here to Continue';
        continueButton.style.marginTop = '10px';
        continueButton.style.padding = '5px 15px';
        continueButton.style.backgroundColor = 'white';
        continueButton.style.color = toast.style.backgroundColor;
        continueButton.style.border = 'none';
        continueButton.style.borderRadius = '3px';
        continueButton.style.cursor = 'pointer';
        continueButton.style.fontWeight = 'bold';

        // Add click event to remove the toast and resolve the promise
        continueButton.addEventListener('click', () => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
          resolve(); // Resolve the promise when the button is clicked
        });

        toast.appendChild(continueButton);
      } else {
        // Auto remove after xx seconds if requireClick is false
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
          resolve(); // Resolve the promise when the toast is automatically removed
        }, timeout);
      }

      // Add to document
      document.body.appendChild(toast);
    });
  }

  // Make showToast globally accessible for handlers
  window.showToast = showToast;

  function loadHtml() {
    // Set default values for configuration
    var headingTag = 'h4';

    // Override with context config values if available
    if (context && context.config) {
      if (context.config.devicePEQHeadingTag) {
          headingTag = context.config.devicePEQHeadingTag;
      }
    }
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

        /* Styles to force checkbox visibility */
    #tab-feedback input[type="checkbox"] {
      -webkit-appearance: checkbox; /* Force WebKit browsers to show default checkbox */
      appearance: compat-auto = checkbox;
      width: 16px;  /* Or any desired size */
      height: 16px; /* Or any desired size */
      opacity: 1;
      position: static; /* Ensure it's not positioned off-screen */
      visibility: visible;
      display: inline-block; /* Or block, depending on layout */
    }

        </style>
            <${headingTag}>Device PEQ</${headingTag}>
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
            <h3>About Device PEQ - v0.11</h3>

            <div class="tabs">
              <button class="tab-button active" data-tab="tab-overview">Overview</button>
              <button class="tab-button" data-tab="tab-supported">Supported Devices</button>
              <button class="tab-button" data-tab="tab-howto">How to Use</button>
              <button class="tab-button" data-tab="tab-feedback">Feedback</button>
            </div>

            <div id="tab-overview" class="tab-content active">
              <p>This section lets you connect to a compatible USB or network-connected audio device (such as Moondrop, Tanchjim, JDS Labs, WiiM, or other Walkplay-based products) and interact with its Parametric EQ (PEQ) settings.</p>

              <h4>Supported Brands & Manufacturers</h4>
              <ul>
                <li><strong>FiiO:</strong> JA11, KA15, KA17, FX17, QX13</li>
                <li><strong>Moondrop:</strong> CDSP, Chu II DSP, Quark2, Rays </li>
                <li><strong>Tanchjim:</strong> Bunny DSP, Fission, One DSP, Stargate II </li>
                <li><strong>Truthear</strong> KeyX </li>
                <li><strong>EPZ:</strong> GM20 and TP13</li>
                <li><strong>KiwiEars:</strong> Allegro and Allegro Pro</li>
                <li><strong>JCally:</strong> JM20 Pro, JM12</li>
                <li><strong>Walkplay</strong> Most devices compatible with Walkplay Android APK</li>
                <li><strong>KTMicro</strong> Many KTMicro DSP devices should work </li>
                <li><strong>JDS Labs:</strong> Supporting the Element IV via USB Serial interface</li>
                <li><strong>Nothing:</strong> Headphone (1) via Serial USB or Bluetooth</li>
                <li><strong>WiiM:</strong> Supports limited pushing of parametric EQ over the home network</li>
                <li><strong>Experimental:</strong> Many more device's that have yet to be tested, will be marked as 'Experimental' but may work fine</li>
              </ul>
            </div>

            <div id="tab-supported" class="tab-content">
              <div class="sub-tabs">
                <button class="sub-tab-button active" data-subtab="sub-fiio">FiiO</button>
                <button class="sub-tab-button" data-subtab="sub-walkplay">Walkplay</button>
                <button class="sub-tab-button" data-subtab="sub-tanchjim">KTMicro</button>
                <button class="sub-tab-button" data-subtab="sub-jdslabs">JDS Labs</button>
                <button class="sub-tab-button" data-subtab="sub-nothing">Nothing</button>
                <button class="sub-tab-button" data-subtab="sub-wiim">WiiM</button>
              </div>

              <div id="sub-fiio" class="sub-tab-content active">
                <h5>FiiO / Jade Audio</h5>
                <p>Currently, I have tested the following FiiO devices: </p>
                <ul>
                  <li>JA11</li>
                  <li>KA17</li>
                  <li>KA15</li>
                  <li>FX17 (with usbc adapter)</li>
                  <li>QX13</li>
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
                  <li>Tanchjim Fission (IEM)</li>
                  <li>JCally JM12</li>
                </ul>
                <p>You also use the official Tanchjim Android App for EQ and device configuration.</p>
              </div>

            <div id="sub-jdslabs" class="sub-tab-content">
              <h5>JDS Labs</h5>
              <p>Supports PEQ control over USB Serial for compatible products like the JDS Labs Element IV, basically if it works on JDS Labs excellent <a href="https://core.jdslabs.com.">Core PEQ</a> it should work. You can push and pull filters directly to the device.</p>
              <p>Note: This option is only visible in advanced mode </p>
            </div>

            <div id="sub-nothing" class="sub-tab-content">
              <h5>Nothing</h5>
              <p>Beta support for Nothing Headphone (1) via Serial USB or Bluetooth connection. Supports reading and writing custom EQ profiles with up to 8 parametric filters.</p>
              <ul>
                <li>Nothing Headphone (1) - Beta support</li>
              </ul>
              <p>The Nothing headphones support multiple EQ profiles: Balanced, Voice, More Treble, More Bass, and Custom. Only the Custom profile supports writing parametric EQ filters.</p>
              <p>Note: This is experimental devicePEQ Bluetooth support and requires compatible browser with Web Serial API.</p>
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

            <div id="tab-feedback" class="tab-content">
              <p><strong>Help us improve!</strong> Your feedback is valuable to us. Please let us know about your experience with Device PEQ.</p>

              <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                <input type="checkbox" id="modal-is-working-checkbox" style="margin-right: 8px;">
                <label for="modal-is-working-checkbox" style="font-size: 14px;">
                  Feature is working correctly
                </label>
              </div>

              <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                <input type="checkbox" id="modal-include-logs-checkbox" style="margin-right: 8px;">
                <label for="modal-include-logs-checkbox" style="font-size: 14px;">
                  Include console logs to help diagnose issues
                </label>
              </div>

              <div style="margin-bottom: 10px; text-align: left;">
                <label for="modal-device-name-input" style="font-size: 14px; display: block; margin-bottom: 5px;">
                  Device Name (optional):
                </label>
                <input type="text" id="modal-device-name-input" placeholder="Enter your device name" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
              </div>

              <div style="margin-bottom: 10px; text-align: left;">
                <label for="modal-comments-input" style="font-size: 14px; display: block; margin-bottom: 5px;">
                  Comments (optional):
                </label>
                <textarea id="modal-comments-input" placeholder="Please describe any issues you're experiencing or suggestions you have..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 100px;"></textarea>
              </div>

              <div style="text-align: center; margin-top: 15px;">
                <button id="modal-feedback-button" class="button">Send Feedback</button>
                <div id="modal-feedback-status" style="margin-top: 10px; display: none;"></div>
              </div>
            </div>
          </div>
        </div>
    `;
    // More flexible way to insert HTML into the DOM
    var placement = 'afterend';
    var anchorDiv = '.extra-eq';
    if (context && context.config ) {
        if (context.config.devicePEQPlacement) {
            placement = context.config.devicePEQPlacement;
        }
        if (context.config.devicePEQAnchorDiv) {
            anchorDiv = context.config.devicePEQAnchorDiv;
        }
    }

      // Find the <div class="extra-eq"> element
    const extraEqElement = document.querySelector(anchorDiv);

    if (extraEqElement) {
      // Insert the new HTML below the "extra-eq" div
      extraEqElement.insertAdjacentHTML(placement, deviceEqHTML);
      console.log('Device EQ UI added ' + placement + ' <div class="' + deviceEqHTML + '">');
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

    // Function to collect recent console logs
    function collectConsoleLogs() {
      // Return the last 100 console logs that contain plugin-related keywords
      if (!window.consoleLogHistory) {
        return "No console logs available";
      }

      // Filter logs related to the plugin
      const pluginLogs = window.consoleLogHistory.filter(log =>
        log.includes("Device") ||
        log.includes("PEQ") ||
        log.includes("USB") ||
        log.includes("plugin") ||
        log.includes("connector")
      );

      // Return the last 100 logs or all if less than 100
      return pluginLogs.slice(-100).join("\n");
    }

    // Set up feedback form submission
    document.getElementById("modal-feedback-button").addEventListener("click", () => {
      // Get values from form elements
      const includeLogsCheckbox = document.getElementById("modal-include-logs-checkbox");
      const isWorkingCheckbox = document.getElementById("modal-is-working-checkbox");
      const deviceNameInput = document.getElementById("modal-device-name-input");
      const commentsInput = document.getElementById("modal-comments-input");
      const statusContainer = document.getElementById("modal-feedback-status");

      // If console log is empty, capture it now
      let logs = "";
      if (includeLogsCheckbox && includeLogsCheckbox.checked) {
        logs = collectConsoleLogs();
      }

      // Show status message
      statusContainer.style.display = "block";
      statusContainer.style.padding = "8px";
      statusContainer.style.borderRadius = "4px";
      statusContainer.style.textAlign = "center";
      statusContainer.style.backgroundColor = "#f8f9fa";
      statusContainer.style.color = "#333";
      statusContainer.textContent = "Submitting your feedback...";

      // Submit to Google Form
      submitFeedbackToGoogleForm(
        deviceNameInput && deviceNameInput.value ? deviceNameInput.value : "Not specified",
        commentsInput,
        logs,
        isWorkingCheckbox && isWorkingCheckbox.checked,
        statusContainer
      );
    });

    async function submitFeedbackToGoogleForm(deviceName, comments, logs, isWorking, statusContainer) {
      const formData = new URLSearchParams();
      formData.append('entry.1909598303', deviceName);
      formData.append('entry.1928983035', comments && comments.value ? comments.value : "No comments provided");
      formData.append('entry.466843002', logs || "No logs available");
      formData.append('entry.1088832316', isWorking ? "Working" : "Not Working");

      try {
        const response = await fetch('https://docs.google.com/forms/d/e/1FAIpQLSfSaNpdpAvd39tOupDqzyUW_aFEVawywAz4xls4m1z2_T3BOQ/formResponse', {
          method: 'POST',
          mode: 'no-cors', // Google Forms requires no-cors mode
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });

        // Note: With no-cors mode, we can't access the response details
        // But we can assume it worked if no error was thrown
        console.log("Google Form Submission Completed");

        statusContainer.style.backgroundColor = "#d4edda";
        statusContainer.style.color = "#155724";
        statusContainer.textContent = "Thank you for your feedback!";

        setTimeout(() => {
          statusContainer.style.display = "none";
        }, 3000);

      } catch (error) {
        console.error("Error submitting to Google Form:", error);
        statusContainer.style.backgroundColor = "#f8d7da";
        statusContainer.style.color = "#721c24";
        statusContainer.textContent = "Failed to submit feedback.";
      }
    }
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
                showToast("Please enter a valid IP address.", "error");
                return;
              }
              setCookie("networkDeviceIP", selection.ipAddress, 30); // Save IP for 30 days
              setCookie("networkDeviceType", selection.deviceType, 30); // Store device type for 30 days

              // Connect via Network using the provided IP
              const device = await NetworkDeviceConnector.getDeviceConnected(selection.ipAddress, selection.deviceType);
              if (device?.handler == null) {
                showToast("Sorry, this network device is not currently supported.", "error");
                await NetworkDeviceConnector.disconnectDevice();
                return;
              }
              if (device) {
                deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await NetworkDeviceConnector.getAvailableSlots(device),
                  await NetworkDeviceConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }
              }
            } else if (selection.connectionType == "usb") {
              // Connect via USB and show the HID device picker
              const device = await UsbHIDConnector.getDeviceConnected();
              if (device?.handler == null) {
                showToast("Sorry, this USB device is not currently supported.", "error");
                await UsbHIDConnector.disconnectDevice();
                return;
              }
              if (device) {
                // Check if the device is experimental
                const isExperimental = device.modelConfig?.experimental === true;

                if (isExperimental) {
                  // Enable logs for experimental devices
                  showDeviceLogs = true;
                  console.log(`Enabling detailed logs for experimental device: ${device.model}`);

                  // Show warning popup for experimental devices
                  const proceedWithConnection = await showExperimentalDeviceWarning(device.model);
                  if (!proceedWithConnection) {
                    await UsbHIDConnector.disconnectDevice();
                    return;
                  }
                }

                deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbHIDConnector.getAvailableSlots(device),
                  await UsbHIDConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            } else if (selection.connectionType == "serial") {
              // Connect via USB and show the Serial device picker
              const device = await UsbSerialConnector.getDeviceConnected();
              if (device?.handler == null) {
                showToast("Sorry, this USB Serial device is not currently supported.", "error");
                await UsbSerialConnector.disconnectDevice();
                return;
              }
              if (device) {
                // Check if the device is experimental
                const isExperimental = device.modelConfig?.experimental === true;

                if (isExperimental) {
                  // Enable logs for experimental devices
                  window.showDeviceLogs = true;
                  console.log(`Enabling detailed logs for experimental serial device: ${device.model}`);

                  // Show warning popup for experimental devices
                  const proceedWithConnection = await showExperimentalDeviceWarning(device.model);
                  if (!proceedWithConnection) {
                    await UsbSerialConnector.disconnectDevice();
                    return;
                  }
                }

                deviceEqUI.showConnectedState(
                  device,
                  selection.connectionType,
                  await UsbSerialConnector.getAvailableSlots(device),
                  await UsbSerialConnector.getCurrentSlot(device)
                );

                // Check if device supports fewer filters than currently in context
                const currentFilters = context.elemToFilters(true);
                if (currentFilters.length > device.modelConfig.maxFilters) {
                  console.warn(`Device only supports ${device.modelConfig.maxFilters} PEQ filters but ${currentFilters.length} filters are currently loaded`);
                  if (window.showToast) {
                    await window.showToast(`Warning: This device only supports ${device.modelConfig.maxFilters} PEQ filters, but you currently have ${currentFilters.length} filters loaded. Only the first ${device.modelConfig.maxFilters} will be applied when pushed.`, "warning", 10000, true);
                  }
                }

                device.rawDevice.addEventListener('disconnect', () => {
                  console.log(`Device ${device.rawDevice.productName} disconnected.`);
                  deviceEqUI.showDisconnectedState();
                });
              }
            }
          } catch (error) {
            console.error("Error connecting to device:", error);
            showToast("Failed to connect to the device.", "error");
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

        // Function to show warning for experimental devices
        function showExperimentalDeviceWarning(deviceName) {
          return new Promise((resolve) => {
            const dialogHTML = `
              <div id="experimental-device-dialog" style="
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
                <h3 style="margin-bottom: 10px; color: #d9534f;">Experimental Device Warning</h3>
                <p style="color: black; margin-bottom: 15px;">
                  <strong>${deviceName}</strong> is marked as an experimental device.
                  This means it hasn't been fully tested and while it may work perfectly, it may not work as expected.
                </p>
                <p style="color: black; margin-bottom: 15px;">
                  If the device is working for you please consider submiting feedback below, and we will mark it as not experimental in the next release.
                  If you noticed any issues, please disconnect the device and then come back here and submit feedback below.
                </p>
                <p style="color: black; margin-bottom: 15px;">
                  Would you like to proceed with the connection anyway?
                </p>

                <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                  <button id="proceed-button" style="padding: 8px 15px; background: #5cb85c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Proceed
                  </button>
                  <button id="cancel-button" style="padding: 8px 15px; background: #d9534f; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Cancel
                  </button>
                </div>

                <div style="border-top: 1px solid #eee; padding-top: 15px;">
                  <p style="color: black; margin-bottom: 10px;">
                    <strong>Help us improve!</strong> If you proceed, please consider providing feedback:
                  </p>
                  <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                    <input type="checkbox" id="is-working-checkbox" style="margin-right: 8px;">
                    <label for="is-working-checkbox" style="color: black; font-size: 14px;">
                      Feature is working correctly
                    </label>
                  </div>
                  <div style="margin-bottom: 10px; text-align: left; display: flex; align-items: center;">
                    <input type="checkbox" id="include-logs-checkbox" style="margin-right: 8px;">
                    <label for="include-logs-checkbox" style="color: black; font-size: 14px;">
                      Include console logs to help diagnose issues
                    </label>
                  </div>
                  <div style="margin-bottom: 10px; text-align: left;">
                    <label for="comments-input" style="color: black; font-size: 14px; display: block; margin-bottom: 5px;">
                      Comments (optional):
                    </label>
                    <textarea id="comments-input" placeholder="Please describe any issues you're experiencing..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 60px;"></textarea>
                  </div>
                  <button id="feedback-button" style="padding: 8px 15px; background: #5bc0de; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Send Feedback
                  </button>
                </div>
              </div>
            `;

            // Force checkboxes
            const styleFix = document.createElement("style");
            styleFix.innerHTML = `
              input[type="checkbox"] {
                appearance: auto !important;
                -webkit-appearance: auto !important;
                width: 16px;
                height: 16px;
                vertical-align: middle;
              }
            `;
            document.head.appendChild(styleFix);

            const dialogContainer = document.createElement("div");
            dialogContainer.innerHTML = dialogHTML;
            document.body.appendChild(dialogContainer);

            // Proceed button
            document.getElementById("proceed-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve(true);
            });

            // Cancel button
            document.getElementById("cancel-button").addEventListener("click", () => {
              document.body.removeChild(dialogContainer);
              resolve(false);
            });

            // Function to collect recent console logs
            function collectConsoleLogs() {
              // Return the last 100 console logs that contain plugin-related keywords
              if (!window.consoleLogHistory) {
                return "No console logs available";
              }

              // Filter logs related to the plugin
              const pluginLogs = window.consoleLogHistory.filter(log =>
                log.includes("Device") ||
                log.includes("PEQ") ||
                log.includes("USB") ||
                log.includes("plugin") ||
                log.includes("connector")
              );

              // Return the last 100 logs or all if less than 100
              return pluginLogs.slice(-100).join("\n");
            }

            // Feedback button
            document.getElementById("feedback-button").addEventListener("click", () => {
              // Get values from form elements
              const includeLogsCheckbox = document.getElementById("include-logs-checkbox");
              const isWorkingCheckbox = document.getElementById("is-working-checkbox");
              const commentsInput = document.getElementById("comments-input");

              // If console log is empty, capture it now
              let logs = "";
              if (includeLogsCheckbox && includeLogsCheckbox.checked) {
                logs = collectConsoleLogs();
              }

              // Show status message
              const statusContainer = document.createElement("div");
              statusContainer.style.marginTop = "10px";
              statusContainer.style.padding = "8px";
              statusContainer.style.borderRadius = "4px";
              statusContainer.style.textAlign = "center";
              statusContainer.style.backgroundColor = "#f8f9fa";
              statusContainer.style.color = "#333";
              statusContainer.textContent = "Submitting your feedback...";

              // Add status container after the feedback button
              document.getElementById("feedback-button").insertAdjacentElement('afterend', statusContainer);

              // Submit to Google Form
              submitToGoogleFormProxy(deviceName, commentsInput, logs, isWorkingCheckbox && isWorkingCheckbox.checked, statusContainer);
            });

            async function submitToGoogleFormProxy(deviceName, comments, logs, isWorking, statusContainer) {
              const formData = new URLSearchParams();
              formData.append('entry.1909598303', deviceName);
              formData.append('entry.1928983035', comments && comments.value ? comments.value : "No comments provided");
              formData.append('entry.466843002', logs || "No logs available");
              formData.append('entry.1088832316', isWorking ? "Working" : "Not Working");

              try {
                const response = await fetch('https://docs.google.com/forms/d/e/1FAIpQLSfSaNpdpAvd39tOupDqzyUW_aFEVawywAz4xls4m1z2_T3BOQ/formResponse', {
                  method: 'POST',
                  mode: 'no-cors', // Google Forms requires no-cors mode
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: formData.toString()
                });

                // Note: With no-cors mode, we can't access the response details
                // But we can assume it worked if no error was thrown
                console.log("Google Form Submission Completed");

                statusContainer.style.backgroundColor = "#d4edda";
                statusContainer.style.color = "#155724";
                statusContainer.textContent = "Thank you for your feedback!";

                setTimeout(() => {
                  if (statusContainer.parentNode) {
                    statusContainer.parentNode.removeChild(statusContainer);
                  }
                }, 3000);

              } catch (error) {
                console.error("Error submitting to Google Form Proxy:", error);
                statusContainer.style.backgroundColor = "#f8d7da";
                statusContainer.style.color = "#721c24";
                statusContainer.textContent = "Failed to submit feedback.";
              }
            }
          });
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

        <!-- Selection Buttons (Vertical Layout) -->
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <button id="usb-hid-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #007BFF; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">USB Device</button>
          <button id="usb-serial-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #6f42c1; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">Serial USB or Bluetooth Device</button>
          <button id="network-button" style="margin: 5px 0; padding: 10px 15px; font-size: 14px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; width: 80%;">Network</button>
        </div>

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
                showToast("Please enter a valid IP address.", "error");
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
              await UsbSerialConnector.disconnectDevice();
            }
            deviceEqUI.showDisconnectedState();
          } catch (error) {
            console.error("Error disconnecting:", error);
            showToast("Failed to disconnect.", "error");
          }
        });

        // Pull Button Event Listener
        deviceEqUI.pullButton.addEventListener('click', async () => {
          try {
            const device = deviceEqUI.currentDevice;
            const selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              showToast("No device connected or PEQ slot selected.", "error");
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

            // Check if we have a timeout but still received some filters
            if (result.filters.length > 0) {
              // Normal case - all filters received
              context.filtersToElem(result.filters);
              context.applyEQ();
              showToast("PEQ filters successfully pulled from device.", "success");
            } else {
              showToast("No PEQ filters found on the device.", "warning");
            }
          } catch (error) {
            console.error("Error pulling PEQ filters:", error);
            showToast("Failed to pull PEQ filters from device.", "error");

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
            // Check if the button is in cooldown period
            const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
            const cooldownTime = 0.2; // Cooldown period in seconds (200ms)

            if (currentTime < deviceEqUI.lastPushTime + cooldownTime) {
              const remainingTime = (deviceEqUI.lastPushTime + cooldownTime) - currentTime;
              const remainingMinutes = Math.floor(remainingTime / 60);
              const remainingSeconds = remainingTime % 60;
              return;
            }

            const device = deviceEqUI.currentDevice;
            var selectedSlot = deviceEqUI.peqDropdown.value;
            if (!device || !selectedSlot) {
              showToast("No device connected or PEQ slot selected.", "error");
              return;
            }
            if (typeof selectedSlot === 'string' && !isNaN(parseInt(selectedSlot, 10))) {
              selectedSlot = parseInt(selectedSlot, 10);
            }


            // ✅ Use context to get filters instead of undefined elemToFilters()
            const filters = context.elemToFilters(true);
            if (!filters.length) {
              showToast("Please add at least one filter before pushing.", "error");
              return;
            }
            // Make sure that the phoneObj is set
            if (typeof context.applyEQ === 'function') {
              context.applyEQ();
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
              showToast("PEQ Saved - Restarting", "success");
            } else {
              showToast("PEQ Successfully pushed to device", "success");
            }

            // Set the last push time to current time and disable the button
            deviceEqUI.lastPushTime = Math.floor(Date.now() / 1000);
            deviceEqUI.pushButton.disabled = true;
            deviceEqUI.pushButton.style.opacity = "0.5";
            deviceEqUI.pushButton.style.cursor = "not-allowed";

            // Set a timeout to re-enable the button after the cooldown period
            setTimeout(() => {
              deviceEqUI.pushButton.disabled = false;
              deviceEqUI.pushButton.style.opacity = "";
              deviceEqUI.pushButton.style.cursor = "";
              console.log("Push button re-enabled after cooldown period");
            }, 200); // 200ms timeout as requested
          } catch (error) {
            console.error("Error pushing PEQ filters:", error);
            showToast("Failed to push PEQ filters to device.", "error");

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
            showToast("Failed to update PEQ slot.", "error");
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
