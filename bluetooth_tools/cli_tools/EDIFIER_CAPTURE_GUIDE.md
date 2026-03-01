# Edifier W830NB Protocol Capture Guide

Complete step-by-step guide for capturing and analyzing the Edifier W830NB Bluetooth protocol using Frida.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Finding the Edifier App](#finding-the-edifier-app)
4. [Capturing Protocol Data](#capturing-protocol-data)
5. [Analysis Workflow](#analysis-workflow)
6. [Troubleshooting](#troubleshooting)
7. [Expected Output](#expected-output)

---

## Prerequisites

### Hardware
- ✅ Edifier W830NB headphones (charged and powered on)
- ✅ Rooted Android smartphone with ADB access
- ✅ USB cable to connect Android device to MacBook Pro
- ✅ MacBook Pro (your current system)

### Software
- ✅ Python 3.11 with bleak and frida installed
- ✅ Frida server running on Android device
- ✅ ADB (Android Debug Bridge) installed on MacBook
- ✅ Edifier ConnectX app installed on Android device

---

## Setup

### 1. Verify ADB Connection

```bash
# Check if device is connected
adb devices

# Expected output:
# List of devices attached
# ABC123XYZ    device
```

If no devices appear, enable USB debugging on Android and reconnect.

### 2. Start Frida Server on Android

```bash
# Push frida-server to device (if not already done)
adb push frida-server-16.x.x-android-arm64 /data/local/tmp/frida-server
adb shell "chmod 755 /data/local/tmp/frida-server"

# Start frida-server as root
adb shell "su -c /data/local/tmp/frida-server &"

# Optional: Forward port for Frida (if using port forwarding)
adb forward tcp:27042 tcp:27042
```

Verify Frida is running:
```bash
frida-ps -U
```

You should see a list of running processes on your Android device.

### 3. Verify Python Environment

```bash
# Check Python 3.11 is available
python3.11 --version

# Verify required packages
python3.11 -c "import frida; import bleak; print('✅ All packages installed')"
```

---

## Finding the Edifier App

### Step 1: Install Edifier ConnectX App

If not already installed on your Android device:
- Open Google Play Store on Android
- Search for "Edifier ConnectX" or "EDIFIER"
- Install the official Edifier app
- Launch the app and connect to your W830NB headphones

### Step 2: List Running Apps

```bash
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools

# List all running Android apps
python3.11 bluetooth_toolkit.py list-apps
```

**Look for packages containing:**
- `com.edifier.*`
- `edifier` in the name
- `connectx` in the name

Common possibilities:
- `com.edifier.connectx`
- `com.edifier.app`
- `com.edifier.w830nb`

**Note the exact package name** - you'll need this for the next step.

### Step 3 (Alternative): Search by Process Name

```bash
# Use frida-ps to search for Edifier-related processes
frida-ps -Uai | grep -i edifier
frida-ps -Uai | grep -i connectx
```

---

## Capturing Protocol Data

### Basic Capture (Recommended)

Once you've identified the app package name:

```bash
# Replace com.edifier.connectx with the actual package name
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier
```

This will:
1. Attach to the running Edifier app
2. Hook into Bluetooth SPP and BLE GATT calls
3. Parse and display Edifier protocol packets in real-time

### Save to File

To save the capture for later analysis:

```bash
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier --output edifier_capture.txt
```

### Full Workflow Example

```bash
# 1. Navigate to tools directory
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools

# 2. Find the app
python3.11 bluetooth_toolkit.py list-apps | grep -i edifier

# 3. Start capture (replace package name as needed)
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier --output w830nb_capture_$(date +%Y%m%d_%H%M%S).txt
```

---

## Analysis Workflow

### What to Capture

While the capture is running, perform these actions in the Edifier app:

#### 1. Basic Commands (Start Here)
```
Action                  Expected Command
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Check battery           CMD: BATTERY (0xD0)
Get firmware version    CMD: VERSION (0xC6)
Get volume              CMD: VOLUME_GET (0x66)
Set volume to 50%       CMD: VOLUME_SET (0x67)
```

#### 2. ANC/Mode Commands
```
Toggle ANC modes        CMD: ANC_SET (0xC1)
Query ANC status        CMD: ANC_QUERY (0xCC)
```

#### 3. EQ Commands (Priority for Analysis)
```
Switch EQ preset        CMD: EQ_SET (0xC4)
Get current preset      CMD: EQ_QUERY (0xD5)
Open custom EQ          CMD: CUSTOM_EQ_GET (0x43)
```

#### 4. Custom EQ Operations (MOST IMPORTANT)
```
Change single band      CMD: CUSTOM_EQ_SET_BAND (0x44)
  - Adjust 100Hz band
  - Adjust 1kHz band
  - Adjust 10kHz band

Save full EQ profile    CMD: CUSTOM_EQ_SET_FULL (0x46)
Reset EQ to default     CMD: CUSTOM_EQ_RESET (0x45)
```

### Expected Capture Output

The Frida script will display:

```
================================================================================
📤 BLE GATT TX
================================================================================
Characteristic: 0000fff1-0000-1000-8000-00805f9b34fb
Length: 11
Hex: BB EC 66 00 00 BB
Dec: [187, 236, 102, 0, 0, 187]
   ┌─ Edifier Protocol (V2) ─┐
   │ Direction:  TX
   │ Header:     0xBB (TO device)
   │ AppCode:    0xEC (236)
   │ Command:    0x66 (102) - VOLUME_GET
   │ Length:     0 bytes payload
   │ CRC:        0xBB
   │ CRC Valid:  ✅ YES
   │ Payload:    (empty - query command)
   └────────────────────────────────────────┘
================================================================================

================================================================================
📥 BLE GATT RX (notification)
================================================================================
Characteristic: 0000fff2-0000-1000-8000-00805f9b34fb
Length: 7
Hex: CC EC 66 00 01 32 C7
Dec: [204, 236, 102, 0, 1, 50, 199]
   ┌─ Edifier Protocol (V2) ─┐
   │ Direction:  RX
   │ Header:     0xCC (FROM device)
   │ AppCode:    0xEC (236)
   │ Command:    0x66 (102) - VOLUME_GET
   │ Length:     1 bytes payload
   │ CRC:        0xC7
   │ CRC Valid:  ✅ YES
   │ Volume:     50 (0-100)
   └────────────────────────────────────────┘
================================================================================
```

### Key Things to Verify

1. **Protocol Version**: Confirm it's V2 (header 0xBB/0xCC)
2. **AppCode**: Should be 0xEC (236)
3. **CRC Validation**: All packets should show "✅ YES"
4. **Command Mapping**: Verify commands match documentation
5. **EQ Band Format**: Check the 6-byte format per band

---

## Troubleshooting

### Issue: "No devices found"
```bash
# Solution 1: Check ADB
adb devices

# Solution 2: Restart frida-server
adb shell "pkill frida-server"
adb shell "su -c /data/local/tmp/frida-server &"

# Solution 3: Verify USB debugging is enabled
```

### Issue: "Failed to attach to com.edifier.app"
```bash
# The app might not be running. Launch it first:
# 1. Open Edifier ConnectX on Android
# 2. Connect to W830NB headphones
# 3. Then run the capture command

# Or use --spawn to launch the app:
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier --spawn
```

### Issue: "No Bluetooth traffic captured"
```
Possible causes:
1. App is using cached data (not sending commands)
   → Perform actions like changing volume, EQ settings

2. Wrong package name
   → Use: python3.11 bluetooth_toolkit.py list-apps

3. Headphones not connected
   → Connect W830NB to Android first via Bluetooth

4. App using different communication method
   → Check if app has permissions for Bluetooth
```

### Issue: "CRC Valid: ❌ NO"
```
This could indicate:
1. Packet corruption (rare)
2. Different protocol version than documented
3. Encrypted payload (unlikely for Edifier)

→ Document the failed packet for analysis
→ Check if pattern is consistent
```

### Issue: "Unknown protocol pattern"
```
The script detected non-Edifier protocol data.
This could mean:
1. App uses a different protocol than expected
2. Multiple Bluetooth connections are active
3. Keepalive/heartbeat packets

→ Save the capture and analyze manually
→ Look for repeating patterns
```

---

## Scan for Edifier W830NB via BLE

You can also directly scan for the headphones using the scan functionality:

```bash
# Scan for BLE devices
python3.11 bluetooth_toolkit.py scan

# Look for:
# - Device name: "EDIFIER W830NB" or similar
# - Manufacturer ID: 2016 (0x07E0) - Edifier's manufacturer ID
```

---

## Advanced Usage

### Capture Multiple Sessions

Create separate captures for different operations:

```bash
# Session 1: Basic commands
python3.11 bluetooth_toolkit.py capture com.edifier.app --edifier -o capture_basic.txt
# (Test: battery, volume, version)

# Session 2: ANC modes
python3.11 bluetooth_toolkit.py capture com.edifier.app --edifier -o capture_anc.txt
# (Test: switch between ANC modes)

# Session 3: EQ changes
python3.11 bluetooth_toolkit.py capture com.edifier.app --edifier -o capture_eq.txt
# (Test: change presets, modify custom EQ)
```

### Compare with Documentation

After capture, compare the observed packets with `EDIFIER_PROTOCOL_DOCUMENTATION.md`:

```bash
# View captured data
cat edifier_capture.txt

# Search for specific commands
grep "CUSTOM_EQ_GET" edifier_capture.txt
grep "CUSTOM_EQ_SET_BAND" edifier_capture.txt
grep "0x43" edifier_capture.txt  # Hex command code
```

### Export for Further Analysis

```bash
# Convert capture to CSV for analysis
# (You can create a parser script if needed)

# Example: Extract only TX packets
grep "📤 BLE GATT TX" -A 10 edifier_capture.txt > tx_only.txt

# Example: Extract only EQ-related commands
grep -E "(CUSTOM_EQ|EQ_SET|EQ_GET)" -B 2 -A 10 edifier_capture.txt > eq_commands.txt
```

---

## Verification Checklist

After capturing, verify you have:

- [ ] Battery query/response packets
- [ ] Volume get/set packets
- [ ] ANC mode change packets (if supported)
- [ ] EQ preset change packets
- [ ] Custom EQ query (should show 10 bands × 6 bytes = 60 bytes)
- [ ] Single band modification (CMD 0x44)
- [ ] Full EQ profile write (CMD 0x46) if possible
- [ ] All packets have valid CRC
- [ ] Protocol version confirmed (V2 with 0xBB/0xCC headers)
- [ ] AppCode confirmed (0xEC)

---

## Next Steps

1. **Verify Protocol Documentation**
   - Compare captured packets with `EDIFIER_PROTOCOL_DOCUMENTATION.md`
   - Note any discrepancies
   - Update documentation if needed

2. **Analyze EQ Format**
   - Confirm 6-byte band format: `[Band] [Filter] [Freq_H] [Freq_L] [Gain] [Q]`
   - Verify gain encoding: 0-12 scale (where 6 = 0dB)
   - Check Q value range

3. **Test Edge Cases**
   - Maximum gain (+6dB, value 12)
   - Minimum gain (-6dB, value 0)
   - Various frequencies (32Hz - 16kHz)
   - Different filter types if supported

4. **Build Web Interface**
   - Once protocol is verified, use the captured data to build Web Bluetooth interface
   - Reference: `EDIFIER_PROTOCOL_DOCUMENTATION.md` has JavaScript examples

---

## Quick Reference Commands

```bash
# List apps
python3.11 bluetooth_toolkit.py list-apps

# Scan BLE devices
python3.11 bluetooth_toolkit.py scan

# Capture with Edifier script
python3.11 bluetooth_toolkit.py capture <PACKAGE_NAME> --edifier

# Capture with output file
python3.11 bluetooth_toolkit.py capture <PACKAGE_NAME> --edifier -o capture.txt

# Direct script usage (alternative)
python3.11 capture_bluetooth.py <PACKAGE_NAME> --edifier
```

---

## Notes

- The W830NB uses **BLE Protocol V2** (6-byte header format)
- Default MTU is 20 bytes, so large packets (like full EQ profile) may be fragmented
- CRC is simple 8-bit sum: `sum(all_bytes) & 0xFF`
- AppCode is always 0xEC for ConnectX protocol
- Header 0xBB = TX (to device), 0xCC = RX (from device)

---

**Good luck with your capture! Let me know if you need any clarification or encounter issues.**
