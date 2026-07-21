## 🛠️ Universal Bluetooth Protocol Reverse Engineering Toolkit

Comprehensive tools for reverse engineering Bluetooth audio device protocols, with focus on EQ/PEQ capabilities.

## ⚠️ Known Issues

### Airoha Connect Status Loop Bug

**Symptom**: Some third-party Airoha-based headphone apps crash/hang on startup with infinite Connect Status (0x03) command loops.

**Root Cause**:
- App sends malformed packets with incorrect checksums (e.g., `05 5A 03 00 D6 0C 00` with checksum 0x00 instead of 0x44)
- No timeout or retry limit on Connect Status polling
- App never receives expected response or ignores it
- Results in infinite loop that prevents app from reaching main UI

**Captured Pattern**:
```
📤 AIROHA TX (to device)
Hex: 05 5A 03 00 D6 0C 00
Command: 0x3 (Connect Status)
Checksum: calc: 0x44, actual: 0x0 ❌
[Repeats infinitely...]
```

**Workaround**:
- Avoid using Connect Status (0x03) command in your own implementations
- Query EQ Settings (0x20) or PEQ Read (0x90) directly instead
- Our `airohaUsbSerialHandler.js` implements this workaround
- For third-party apps, consider response injection via Frida hooks

## 📦 Toolkit Overview

### 1. BLE Scanner (`scan_ble.py`)
Discover and analyze Bluetooth Low Energy devices

### 2. Protocol Capture (`capture_bluetooth.py`)
Capture Bluetooth packets using Frida on Android devices

### 3. Frida Scripts
- `frida_bluetooth_universal.js` - Universal capture for most devices
- `frida_flutter_eq.js` - Flutter app specific capture
- `frida_airoha.js` - Airoha chipset specific

## 🚀 Quick Start

### Setup

```bash
# Install Python dependencies
pip install bleak frida frida-tools

# On rooted Android device, install frida-server
# Download from: https://github.com/frida/frida/releases
# adb push frida-server-*-android-arm64 /data/local/tmp/frida-server
# adb shell "chmod 755 /data/local/tmp/frida-server"
# adb shell "/data/local/tmp/frida-server &"
```

### Workflow

```bash
# 1. Scan for BLE devices
python3 scan_ble.py --name "YourDevice"

# 2. Analyze device capabilities
python3 scan_ble.py --analyze "YourDevice"

# 3. Capture protocol from Android app
python3 capture_bluetooth.py com.yourapp.package

# 4. Perform EQ operations in app and watch the output!
```

## 📱 Tool #1: BLE Scanner

### Features
- Scan for nearby BLE devices
- Filter by name, address, RSSI
- Deep analysis of services and characteristics
- Identify audio/EQ-related services
- Export device information

### Usage

```bash
# Basic scan
python3 scan_ble.py

# Filter by name
python3 scan_ble.py --name "Moondrop"

# Analyze specific device (shows services, characteristics, values)
python3 scan_ble.py --analyze "MOONDROPEDGE"

# Set RSSI threshold (only show strong signals)
python3 scan_ble.py --rssi -60

# Export results
python3 scan_ble.py --export devices.txt

# Longer scan time
python3 scan_ble.py --timeout 30
```

### Example Output

```
Found 3 device(s)
================================================================================

1. MOONDROPEDGE
   Address: 1A:25:8D:44:ED:92
   RSSI: -45 dBm

Analyzing: MOONDROPEDGE
================================================================================

✅ Connected!

Services (5 found)
================================================================================

📡 Service: 0000ff12-0000-1000-8000-00805f9b34fb
   Name: Vendor Specific (0xFF prefix - likely audio)
   Characteristics (3):
      • 0000ff13-0000-1000-8000-00805f9b34fb
        Properties: write, write-without-response
        Handle: 0x0012
      • 0000ff14-0000-1000-8000-00805f9b34fb
        Properties: notify, read
        Handle: 0x0015

🎧 Potential Audio/EQ Services
================================================================================

✓ 0000ff12-0000-1000-8000-00805f9b34fb
  3 characteristics
  TX (write) characteristics: 1
     0000ff13... - write, write-without-response
  RX (notify) characteristics: 1
     0000ff14... - notify, read
```

## 📡 Tool #2: Protocol Capture

### Features
- Auto-detect app type (Java/Flutter)
- Capture Classic Bluetooth (SPP) and BLE GATT
- Correlate high-level EQ calls with packets
- Support for Airoha chipset
- Real-time packet logging
- Export capture to file

### Usage

```bash
# List running apps
python3 capture_bluetooth.py --list

# Capture from package name
python3 capture_bluetooth.py com.moondroplab.moondrop.moondrop_app

# Capture with specific script
python3 capture_bluetooth.py com.example.app --script frida_airoha.js

# Airoha mode
python3 capture_bluetooth.py com.example.app --airoha

# Save output
python3 capture_bluetooth.py com.example.app --output capture.log

# Spawn app instead of attaching
python3 capture_bluetooth.py com.example.app --spawn

# Use with local macOS (instead of Android)
python3 capture_bluetooth.py --local SomeApp
```

### Example Output

```
🔍 Detecting app type...
   App type: FLUTTER

📜 Loading default script for flutter app...

================================================================================
Starting Bluetooth Protocol Capture
================================================================================

✅ Attached to: com.moondroplab.moondrop.moondrop_app

================================================================================
📡 Capture running... Press Ctrl+C to stop
================================================================================

▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶
🎨 Flutter MethodChannel Call
▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶
Method: setEQ
   Flutter Data (HashMap):
   • frequency: [22.0, 80.0, 1200.0, 5585.0, 8000.0]
   • gain: [-3.8, 0.7, -1.5, -5.8, 0.0]
   • q: [0.5, 1.3, 1.8, 1.2, 0.7]
▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
📤 SPP TX (Bluetooth Packet)
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
Length: 47
Hex: FF 04 00 27 00 1D 0A 06 00 04 ...

   ┌─ Protocol Decoded ─┐
   │ Type:    Moondrop-like
   │ Length:  39
   │ Command: 0x06
   │ Action:  Set EQ
   │ Bands:   4
   └─────────────────────┘

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

## 🎯 Frida Scripts

### Universal Script (`frida_bluetooth_universal.js`)

Best for:
- First-time protocol discovery
- Unknown device protocols
- General Bluetooth monitoring

Captures:
- Classic Bluetooth (SPP) read/write
- BLE GATT characteristics
- Automatic packet parsing
- Moondrop protocol detection

### Flutter Script (`frida_flutter_eq.js`)

Best for:
- Apps built with Flutter
- Correlating UI actions with packets
- High-level EQ parameter capture

Additional features:
- Flutter MethodChannel hooks
- Dart FFI monitoring
- EQ parameter extraction from Flutter calls

### Airoha Script (`frida_airoha.js`)

Best for:
- Devices with Airoha chipsets
- TWS earbuds
- Known Airoha protocols

Features:
- Airoha packet detection (0x05 0x5A patterns)
- EQ/PEQ command parsing
- ANC mode detection
- Battery status
- Checksum verification

## 🔬 Analysis Workflow

### Step 1: Identify Device

```bash
# Scan for device
python3 scan_ble.py --name "YourDevice"

# Analyze services
python3 scan_ble.py --analyze "YourDevice"

# Note the UUIDs - especially ones starting with 0xFF (vendor-specific)
```

### Step 2: Set Up Capture

```bash
# Make sure frida-server is running on Android
adb shell "ps | grep frida-server"

# Forward frida port (if needed)
adb forward tcp:27042 tcp:27042

# List apps to find package name
python3 capture_bluetooth.py --list
```

### Step 3: Capture Protocol

```bash
# Start capture
python3 capture_bluetooth.py com.your.app --output capture.log

# In the app:
# 1. Change EQ settings
# 2. Try different presets
# 3. Enable/disable features
# 4. Watch the console for packets!
```

### Step 4: Analyze Patterns

Look for:
1. **Packet structure** - Start bytes, length fields, checksums
2. **Command codes** - What byte changes when you do different actions?
3. **Data encoding** - How are frequencies, gains, Q values encoded?
4. **Correlations** - Match high-level operations (Flutter calls) with low-level packets

Example analysis:
```
Flutter: setEQ([1000, 2000, 4000], [+3.0, -2.0, +1.0], ...)
Packet:  FF 04 00 27 00 1D 0A 06 00 04 [DATA...]

Hypothesis: Command 0x06 = Set EQ
           Byte 8-9 = band count (0x00 0x04 = 4)
           Following bytes = band data

Test: Change first frequency to 500 Hz
      Does byte pattern change from 0x03E8 (1000) to 0x01F4 (500)?
```

### Step 5: Verify and Document

```bash
# Test your hypothesis by sending crafted packets
# Document the protocol format
# Share with community!
```

## 🎨 Tips for Flutter Apps

Flutter apps use MethodChannels to communicate with native code:

```javascript
// In frida_flutter_eq.js, you'll see:
Method: setEQ
Arguments: {
  "frequencies": [22, 80, 1200, 5585, 8000],
  "gains": [-3.8, 0.7, -1.5, -5.8, 0.0],
  "q_factors": [0.5, 1.3, 1.8, 1.2, 0.7]
}

// Followed immediately by Bluetooth packet:
FF 04 00 27 00 1D 0A 06 ...
```

This correlation helps you map high-level values to byte positions!

## 🔊 Tips for Airoha Devices

Airoha protocols often use:
- Start bytes: `05 5A` (command) or `05 5B` (response)
- Command range: `0x20-0x22` for EQ, `0x90-0x95` for PEQ
- Checksum: Last byte is often XOR or sum of all previous bytes
- PEQ format: `[freq_h, freq_l, gain_h, gain_l, q_h, q_l, type]`

Common gain encoding: `gain_db * 10` as signed int16
Common Q encoding: `q_value * 100` as unsigned int16

## 🐛 Troubleshooting

### "Failed to connect to USB device"
```bash
# Check device is connected
adb devices

# Check frida-server is running
adb shell "ps | grep frida"

# Restart frida-server
adb shell "killall frida-server"
adb shell "/data/local/tmp/frida-server &"

# Forward port
adb forward tcp:27042 tcp:27042
```

### "App type detection failed"
```bash
# Manually specify script
python3 capture_bluetooth.py com.app --script frida_bluetooth_universal.js
```

### "No packets captured"
- Make sure app is actively using Bluetooth
- Try different operations in the app
- Check if device uses BLE instead of SPP (or vice versa)
- Some apps encrypt or obfuscate packets

### "Permission denied" on macOS
```bash
# Grant Terminal full disk access in System Preferences
# Or run with sudo (not recommended)
```

## 📚 Example Success Stories

### Moondrop Edge ANC
- **Protocol**: Classic Bluetooth SPP
- **Format**: `FF 04 [LEN] 00 1D [DIR] [CMD] [DATA]`
- **Discovery**: Shifted gain encoding (gain for band N in band N+1)
- **Formula**: `gain_db = raw / 60.0`
- **Result**: 100% decoded, full control implemented

### [Your Device Here]
Use these tools to decode your device and document it!

## 🤝 Contributing

Found a new protocol pattern? Please share:
1. Device name and model
2. Packet captures
3. Decoded format
4. Working encode/decode functions

## 📜 License

Open source for the community. Use, modify, share freely!

## ⚠️ Disclaimer

These tools are for interoperability and educational purposes only. Use responsibly and only on devices you own.

---

**Happy Protocol Hunting!** 🔍🎧✨
