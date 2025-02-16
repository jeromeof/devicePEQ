# **DeviceEQ Plugin - Pragmatic Audio**

## **📌 Overview**
DeviceEQ is a **JavaScript-based plugin** designed to interface with **audio devices** that support **Parametric EQ (PEQ) adjustments**. It allows users to **connect to, configure, and manage PEQ settings** on their **USB or network-based audio devices**.

### **Key Features**
- 🎛 **Supports USB and Network PEQ Devices**
- 📡 **Connect via WebHID (USB) or HTTP API (Network)**
- 🎚 **Real-Time PEQ Adjustments & Preamp Gain Calculations**
- 🔗 **Dynamic PEQ Slot Selection & Configuration**

---

## **📂 Project Structure**
DeviceEQ
* plugin.js                  # Core plugin that integrates PEQ functionality
* usbHidConnector.js         # USB connection manager for HID-based devices
* networkDeviceConnector.js  # Network-based device connection manager
* fiioUsbHidHandler.js       # PEQ handler for FiiO USB-based devices
* wiimNetworkHandler.js      # PEQ handler for WiiM network-based devices
* index.html                 # Simple UI for testing and demo purposes
---

## **🛠 Plugin: `plugin.js`**
### **🔹 What it does**
- Loads UI elements dynamically inside a **designated container (`.extra-eq`)**.
- Allows the user to **connect to a device (USB or Network)**.
- Retrieves available **PEQ slots** from the device.
- Provides **"Push" & "Pull" buttons** to transfer PEQ settings.
- Handles **disconnections and device switching**.
- Uses **cookies to persist the network device's IP and type**.

### **📌 How it Works**
1. The user clicks **Connect**.
2. A **popup asks if they want USB or Network**.
3. If **USB** → Uses `usbHidConnector.js` to show device selection.
4. If **Network** → Prompts for IP & connects using `networkDeviceConnector.js`.
5. **PEQ slots are loaded dynamically**, and users can **edit filters**.
6. Users can **push or pull** PEQ settings from the device.
7. If a network device is used, the **IP and device type are saved in cookies**.

---

## **🔌 USB Connection: `usbHidConnector.js`**
### **🔹 What it does**
- Uses **WebHID API** to detect and connect to **USB HID audio devices**.
- Implements **device-specific handlers** (like `fiioUsbHidHandler.js`).
- Supports querying **available PEQ slots & current PEQ settings**.
- Handles **sending PEQ configurations to the device**.

### **🔗 How it Works**
1. When **USB is selected**, `usbHidConnector.js` opens the WebHID device picker.
2. It finds a **supported device** and loads the correct **handler**.
3. Uses `fiioUsbHidHandler.js` to manage **PEQ settings for FiiO devices**.
4. Allows **retrieving (Pull) and applying (Push) PEQ settings** via USB.
5. If the device is **disconnected**, the UI resets.

---

## **🌍 Network Connection: `networkDeviceConnector.js`**
### **🔹 What it does**
- Manages **network-based PEQ device connections**.
- Uses **HTTP API calls** to communicate with supported **networked audio devices**.
- Currently supports **WiiM devices (via `wiimNetworkHandler.js`)**.
- Allows **retrieving, modifying, and applying PEQ settings** over the network.
- **Persists the device's IP and type using cookies**.

### **🔗 How it Works**
1. When **Network is selected**, it prompts for an **IP address**.
2. It attempts to connect and identifies **supported devices**.
3. Uses `wiimNetworkHandler.js` for **WiiM devices**.
4. Retrieves **available PEQ slots** and current PEQ configuration.
5. Allows users to **apply or update PEQ settings** via HTTP API.

---

## **🎛 USB PEQ Handler: `fiioUsbHidHandler.js`**
### **🔹 What it does**
- Handles **FiiO USB-based devices** that support **PEQ adjustments**.
- Uses **HID commands** to **read/write PEQ filters and gain settings**.
- Supports **multiple EQ slots** with individual configurations.
- Implements **protocol-specific** PEQ commands.

### **📌 Supported Devices**
- **FiiO KA17, KA15, Q7, BTR13, Retro Nano, etc.**

### **🔗 How it Works**
1. **Reads current PEQ slot and filters**.
2. **Allows modifying** PEQ parameters (gain, frequency, Q value).
3. **Writes new settings** back to the device.
4. Uses **custom HID messages** to interact with each device model.

---

## **📡 Network PEQ Handler: `wiimNetworkHandler.js`**
### **🔹 What it does**
- Handles **WiiM network-based devices** supporting **HTTP API PEQ control**.
- Uses **REST API calls** to manage **PEQ settings over WiFi**.
- Supports **real-time filter adjustments and preset management**.

### **📌 Supported Devices**
- **WiiM Mini, WiiM Pro, WiiM Ultra (and other WiiM-supported devices)**.

### **🔗 How it Works**
1. **Fetches current PEQ settings** using `EQGetLV2BandEx`.
2. **Applies new PEQ settings** using `EQSetLV2Band`.
3. Supports **adjustments of up to 10-band PEQ filters**.
4. Uses **HTTP requests to communicate with the device**.

---

## **📌 Usage Instructions**
### **1️⃣ Setup**
- Ensure your **USB or Network device is connected**.
- Open the **web interface that includes `plugin.js`**.

### **2️⃣ Connecting a Device**
- Click **"Connect to Device"**.
- Choose between **USB or Network**.
  - If **USB**, a device picker appears.
  - If **Network**, enter the **IP Address**.

### **3️⃣ Modifying PEQ Settings**
- Use the **drop-down menu** to select a PEQ slot.
- Adjust **filters (frequency, gain, Q-factor, etc.)**.

### **4️⃣ Pushing or Pulling Settings**
- Click **"Pull From Device"** to load PEQ settings.
- Click **"Push To Device"** to apply changes.

### **5️⃣ Saving Device Info**
- The plugin **remembers your last-used network device** (IP & Type).
- Next time you visit, it **auto-fills the IP and device type**.

---

## **🔧 Future Enhancements**
✔ **Support for more network devices** (e.g., `Other Devices Coming Soon`).
✔ **More USB device handlers** for other brands.
✔ **Advanced PEQ visualization UI**.

---

## **🎉 Contributions & Support**
- **Developed by:** Pragmatic Audio
- **Contributions:** Open-source improvements welcome!
- **Bugs/Feature Requests:** Report issues via GitHub.

---

## **🚀 Summary**
The **DeviceEQ Plugin** enables **real-time PEQ management** for both **USB and networked audio devices**. It provides a **simple UI**, **auto-device detection**, **real-time updates**, and **persistent storage** for networked devices.

👉 **Whether you use a USB DAC like FiiO or a network streamer like WiiM, DeviceEQ makes PEQ management easy!** 🎛🔥
