# **DeviceEQ Plugin - Pragmatic Audio**

## 📌 Overview
DeviceEQ is a **JavaScript-based plugin** for interacting with **audio devices** that support **Parametric EQ (PEQ)**. It supports **USB HID**, **USB Serial**, and **network-connected** devices, offering full control over EQ filters, slot management, and device communication.

---

## ✨ Key Features
- 🔌 **Cross-Protocol Support:** USB HID, Serial, and HTTP (Network)
- 📡 **Advanced PEQ Push/Pull with Device Sync**
- 🎚 **Real-Time Filter Editing + Preamp Gain Calculation**
- 📦 **Dynamic Slot Discovery & Management**
- 🧠 **Per-Device Handler Logic with Config Models**
- 📘 **Integrated Modal UI for Info and Help**

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
- Provides **"Push" & "Pull" buttons** to transfer PEQ settings.
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

### **🔗 How it Works**
1. Prompts for serial port selection.
2. Uses line-based text protocol to pull/push PEQ filters.
3. Supports global gain and 10-band PEQ adjustments.
4. Filters are parsed and applied using the same internal model.

---

## **🌍 Network Connection: `networkDeviceConnector.js`**
### **🔹 What it does**
- Manages **network-based PEQ connections** (currently WiiM).
- Uses **HTTP GET requests** with URL-encoded JSON.
- Implements WiiM-specific logic via `wiimNetworkHandler.js`.

### **📌 Supported Devices**
- **WiiM Mini, Pro, Pro Plus, Ultra, Amp**

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

### **📌 Tested Devices**
- **FiiO KA17, KA15, JA11, Q7, Retro Nano, BTR13**

---

## **🧰 PEQ Handler: `jdslabsSerialHandler.js`**
### **🔹 What it does**
- Sends/receives PEQ data via text-based protocol.
- Mirrors the functionality of **JDS Labs Core PEQ app**.
- Supports **global gain** and **10 PEQ filters**.

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

---

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

## **🚀 Summary**
The **DeviceEQ Plugin** brings **flexible, real-time PEQ control** to a growing range of **USB, Serial, and networked audio gear**. Whether you're tuning a dongle, an IEM, a desktop DAC, or a smart streamer—**DeviceEQ bridges the gap between pro-grade tuning and consumer gear**.

👉 **From FiiO to JDS Labs to WiiM – make your sound yours.** 🎚🔥
