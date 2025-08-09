# **DeviceEQ Plugin v0.5 - Pragmatic Audio**

## 📌 Overview
DeviceEQ is a **JavaScript-based plugin** for interacting with **audio devices** that support **Parametric EQ (PEQ)**. It supports **USB HID**, **USB Serial**, and **network-connected** devices, offering full control over EQ filters, slot management, and device communication.

---

## ✨ Key Features
- 🔌 **Cross-Protocol Support:** USB HID, Serial, and HTTP (Network)
- 📡 **Advanced PEQ Push/Pull with Device Sync**
- 🎚 **Real-Time Filter Editing + Preamp Gain Calculation**
- 📦 **Dynamic Slot Discovery & Management**
- 🧠 **Per-Device Handler Logic with Config Models**
- 🎛️ **LSQ/HSQ Filter Support + Global Gain Control for some handlers**
- 📘 **Integrated Modal UI for Info and Help**
- 📝 **Feedback Mechanism for Experimental Devices**

---

## 📂 Project Structure
```
DeviceEQ/
├── plugin.js                  # Main plugin entry point and UI integration
├── usbHidConnector.js         # WebHID connection & handler logic
├── usbSerialConnector.js      # Web Serial handler for devices like JDS Labs
├── networkDeviceConnector.js  # HTTP API logic for networked devices (WiiM)
├── fiioUsbHidHandler.js       # PEQ logic for FiiO devices
├── walkplayHidHandler.js      # PEQ logic for Walkplay-compatible DSPs
├── moondropHidHandler.js      # Moondrop-specific USB HID logic
├── ktmicroUsbHidHandler.js    # Tanchjim & KTMicro USB HID logic
├── qudelixUsbHidHandler.js    # Handler for Qudelix 5K
```

---

## **🛠 Plugin: `plugin.js`**
### **🔹 What it does**
- Loads UI elements dynamically inside a **designated container (`.extra-eq`)**.
- Lets the user **connect to a device (USB HID, Serial, or Network)**.
- Retrieves available **PEQ slots** from the device.
- Provides **"Push" & "Pull" buttons** to transfer PEQ settings
- Handles **disconnections and device switching**.
- Uses **cookies to persist the network device's IP and type**.

### **📌 How it Works**
1. User clicks **Connect**.
2. A **popup asks for USB HID, Serial, or Network**.
3. If **USB HID** → Uses `usbHidConnector.js`.
4. If **Serial (JDS Labs)** → Uses `serialConnector.js`.
5. If **Network** → Prompts for IP & uses `networkDeviceConnector.js`.
6. Loads PEQ slots and editable filters.
7. Users can **push/pull** PEQ settings.
8. **Network device info is saved in cookies**.

---

## **🔌 USB HID Connection: `usbHidConnector.js`**
### **🔹 What it does**
- Uses **WebHID API** to detect and connect to **USB HID audio devices**.
- Implements **handlers** like `fiioUsbHidHandler.js`.
- Supports PEQ slot detection and filter read/write.

### **🔗 How it Works**
1. USB HID picker is shown.
2. Supported device is detected and the handler is loaded.
3. Filter settings are pulled/pushed via HID reports.
4. UI resets if the device disconnects.

---

## **🧭 USB Serial Connection: `serialConnector.js`**
### **🔹 What it does**
- Uses **Web Serial API** to support **JDS Labs devices** over USB.
- Detects compatible serial ports and exchanges PEQ commands.
- Uses `jdslabsSerialHandler.js` to manage filter logic.

### **📌 Supported Devices**
- **JDS Labs Element IV**
- **JDS Labs Atom DAC 3**
- (Any device supporting JDS Core PEQ over serial)
- **Note:** This option is only visible in advanced mode

### **🔗 How it Works**
1. Prompts for serial port selection.
2. Uses line-based text protocol to pull/push PEQ filters.
3. Supports global gain and 12-band PEQ adjustments.
4. Filters are parsed and applied using the same internal model.

---

## **🌍 Network Connection: `networkDeviceConnector.js`**
### **🔹 What it does**
- Manages **network-based PEQ connections** (currently WiiM).
- Uses **HTTP GET requests** with URL-encoded JSON.
- Implements WiiM-specific logic via `wiimNetworkHandler.js`.

### **📌 Supported Devices**
- **WiiM Mini, Pro, Pro Plus, Ultra, Amp**
- **Note:** This option is only visible in advanced mode

### **🔗 How it Works**
1. Prompts for local IP address of the device.
2. Uses WiiM's documented `EQGetLV2BandEx` and `EQSetLV2SourceBand`.
3. Adjusts up to 10 bands with param names like `a_freq`, `a_q`, etc.
4. Stores IP/device type for auto-reconnect.

---

## **🎛 PEQ Handler: `fiioUsbHidHandler.js`**
### **🔹 What it does**
- Manages **FiiO USB HID** devices.
- Sends/receives filter configuration via HID commands.
- Supports slot switching and device-specific quirks.
- Supports **LSQ/HSQ filters** for advanced shelving EQ.
- Implements **global gain control** for overall volume adjustment.

### **📌 Tested Devices**
- **FiiO:** JA11, KA15, KA17 (Retro Nano has limited compatibility)
- **Moondrop:** CDSP, Chu II DSP, Quark2, Echo A
- **Tanchjim:** Bunny DSP, One DSP
- **EPZ:** GM20, TP13
- **Kiwi Ears:** Allegro, Allegro Pro
- **JCally:** JM20 Pro, JM12, and possibly others
- **Other Walkplay-compatible devices**
- **KTMicro DSP devices**

---

## **🎧 PEQ Handler: `qudelixUsbHidHandler.js`**
### **🔹 What it does**
- Manages **Qudelix 5K** USB HID devices.
- Sends/receives filter configuration via HID commands.
- Supports **LSQ/HSQ filters** for advanced shelving EQ.
- Implements **global gain control** for overall volume adjustment.
- Handles device-specific protocol for Qudelix devices.

---

## **🧰 PEQ Handler: `jdslabsSerialHandler.js`**
### **🔹 What it does**
- Sends/receives PEQ data via text-based protocol.
- Mirrors the functionality of **JDS Labs Core PEQ app**.
- Supports **global gain** and **12 PEQ filters**.
- Handles **12-band** device configurations.
- Supports **Lowshelf/Highshelf filters** for advanced shelving EQ.

---

## **📡 PEQ Handler: `wiimNetworkHandler.js`**
### **🔹 What it does**
- Manages WiiM network devices over HTTP.
- Pushes named presets (`name: "HeadphoneEQ"`) and source-specific EQ.
- Supports stereo channel mode and EQStat toggling.

---

## **📌 Usage Instructions**
### **1️⃣ Setup**
- Connect a supported device (USB, Serial, or Network).
- Open the web interface that loads `plugin.js`.

### **2️⃣ Connect to Device**
- Click **"Connect to Device"**.
- Choose:
  - **USB HID** (e.g., FiiO, Tanchjim, Walkplay)
  - **Serial** (e.g., JDS Labs)
  - **Network** (e.g., WiiM)

### **3️⃣ Adjust PEQ**
- Pick a slot if applicable.
- Change filters (freq, gain, Q).
- Use preamp gain calculator for normalization.

### **4️⃣ Push / Pull**
- **Pull** loads device settings.
- **Push** applies new filter values.

### **5️⃣ Persistent Info**
- Device IP and type are saved for future sessions.

### **6️⃣ Experimental Devices**
- Some devices are marked as **experimental**.
- When connecting to an experimental device, a warning dialog appears.
- You can provide feedback about your experience with the device.
- This feedback helps improve compatibility and support for more devices.

---

## **🔧 Bluetooth SPP Test Page & Web Bluetooth**
A standalone utility page, bluetooth-spp-test.html, is included to experiment with:
- Bluetooth Serial Port Profile (Classic RFCOMM) via the Web Serial API (where supported by the OS/browser).
- Bluetooth Low Energy (BLE) via the Web Bluetooth API (GATT-only).
- Discover GATT services (read-only) and list previously granted serial ports.
- Connect to SPP (Nothing UUID or generic) and monitor raw traffic.
- Tabs:
  - Nothing Device Controls: prebuilt commands for a specific vendor protocol.
  - Custom Payload: send arbitrary raw hex bytes.
  - ASCII/AT Prober: send ASCII commands (e.g., AT, ATI, HELP, VERSION) with CR/LF/CRLF line endings and view both HEX and ASCII responses.
Notes for Audeze Maxwell or other headsets: Many headsets do not use public AT commands over SPP. If AT/HELP does not return anything, try the Custom Payload tab or use the vendor app. The page logs non-framed traffic in HEX and ASCII to aid reverse-engineering.

During BLE discovery, the page now also:
- Lists all permitted primary services and enumerates characteristics (with properties) for each.
- Attempts to read common standard characteristics when present:
  - Device Information (0x180A): Manufacturer (0x2A29), Model (0x2A24), Firmware (0x2A26).
  - Generic Access (0x1800): Device Name (0x2A00), Appearance (0x2A01).
  - Battery Service (0x180F): Battery Level (0x2A19).
This helps determine whether the device exposes anything useful over GATT; many headsets keep GATT minimal and use Classic Bluetooth (SPP) for vendor commands.

Web Bluetooth vs Web Serial (Chrome capabilities):
- Web Bluetooth (BLE GATT): can connect to BLE devices and read/write GATT characteristics/services you request in optionalServices. No access to Classic Bluetooth profiles (A2DP/AVRCP/HFP).
- Web Serial (including Bluetooth SPP on some platforms): can open RFCOMM-like serial ports exposed by the OS. Useful for devices implementing SPP, but many modern headsets either don’t expose SPP or use proprietary stacks.
- Practical tip for Maxwell: If it only exposes Device Information over BLE (0x180A) and no other writable GATT services, you likely can’t control it via Web Bluetooth. Control is probably via Classic (vendor app over SPP or another profile), which is not generally exposed to the web except limited SPP via Web Serial when available.

BLE GATT Tools (in the page):
- Provide a Service UUID and Characteristic UUID to Read or Write raw hex to a GATT characteristic. UUIDs can be 16-bit (e.g., 180a, 2a24) or full 128-bit. Names like device_information, model_number_string are recognized.
- This is useful when a device documents BLE control points or you’re experimenting with a known writable characteristic.

## **🔧 Future Enhancements**
- ☑ Additional network brands
- ☑ WebUSB (non-HID) support
- ☑ Device info syncing (e.g., model & firmware)
- ☑ Offline presets / import & export

---

## **🎉 Contributions & Support**
- **Author:** Pragmatic Audio
- **Contributions:** PRs and feature ideas welcome
- **Issues:** Report via GitHub

---

## **📝 Feedback Mechanism**
### **🔹 What it does**
- Provides a **feedback form** for users to report their experience with **experimental devices**.
- Allows users to indicate if the device is **working correctly**.
- Optionally includes **console logs** to help diagnose issues.
- Lets users add **comments** about their experience.
- Submits feedback to developers via a **Google Form**.

### **🔗 How it Works**
1. When connecting to a device marked as **experimental**, a warning dialog appears.
2. The dialog explains that the device hasn't been fully tested.
3. Users can proceed with the connection and test the device.
4. After testing, users can provide feedback about their experience.
5. This feedback helps improve compatibility and support for more devices.

---

## **🚀 Summary**
The **DeviceEQ Plugin** brings **flexible, real-time PEQ control** to a growing range of **USB, Serial, and networked audio gear**. Whether you're tuning a dongle, an IEM, a desktop DAC, or a smart streamer—**DeviceEQ bridges the gap between pro-grade tuning and consumer gear**.

The plugin now includes
**enhanced support for LSQ/HSQ filters and global gain control** across multiple device handlers, providing more advanced EQ capabilities for precise sound tuning. This allows for more sophisticated frequency shaping with shelf filters and overall volume adjustment.

The plugin also includes a **feedback mechanism** for experimental devices, allowing users to contribute to the project by reporting their experiences. This helps improve compatibility and support for a wider range of devices.

👉 **From FiiO to JDS Labs to WiiM – make your sound yours.** 🎚🔥
