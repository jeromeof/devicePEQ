# 🎯 Bluetooth Protocol Reverse Engineering - Quick Reference

## 🚀 Quick Start (3 Commands)

```bash
# 1. Find your device
python3 scan_ble.py --name "YourDevice"

# 2. Analyze it
python3 scan_ble.py --analyze "YourDevice"

# 3. Capture protocol
python3 capture_bluetooth.py com.yourapp.package
```

## 📱 Common Commands

### BLE Scanning

```bash
# Scan all devices
./scan_ble.py

# Filter by name
./scan_ble.py --name "Moondrop"

# Analyze specific device
./scan_ble.py --analyze "MOONDROPEDGE"

# Strong signals only
./scan_ble.py --rssi -50

# Export results
./scan_ble.py --export devices.txt
```

### Protocol Capture

```bash
# List running apps
./capture_bluetooth.py --list

# Capture (auto-detect app type)
./capture_bluetooth.py com.moondroplab.moondrop.moondrop_app

# Flutter app
./capture_bluetooth.py com.app.name --script frida_flutter_eq.js

# Airoha chipset
./capture_bluetooth.py com.app.name --airoha

# Save to file
./capture_bluetooth.py com.app.name --output capture.log

# Spawn app
./capture_bluetooth.py com.app.name --spawn
```

### Interactive Menu

```bash
# Use the master script for guided workflow
./bluetooth_toolkit.py
```

## 🔧 Setup Checklist

### macOS/Linux Setup

```bash
# Install Python dependencies
pip install bleak frida frida-tools

# Make scripts executable
chmod +x *.py
```

### Android Device Setup

```bash
# 1. Download frida-server for your Android architecture
# From: https://github.com/frida/frida/releases
# Example: frida-server-16.0.0-android-arm64.xz

# 2. Push to device
adb push frida-server /data/local/tmp/frida-server

# 3. Make executable
adb shell "chmod 755 /data/local/tmp/frida-server"

# 4. Start server
adb shell "/data/local/tmp/frida-server &"

# 5. Forward port (optional)
adb forward tcp:27042 tcp:27042

# 6. Verify it's running
adb shell "ps | grep frida"
```

## 🎯 Frida Scripts

| Script | Use Case |
|--------|----------|
| `frida_bluetooth_universal.js` | Most devices, first attempt |
| `frida_flutter_eq.js` | Flutter apps with EQ |
| `frida_airoha.js` | Airoha chipset devices |

## 🔍 Analysis Patterns

### Common Protocol Structures

```
Moondrop-like:
FF 04 [LEN_H LEN_L] [DEV_ID] [DIR] [CMD] [PAYLOAD]

Airoha:
05 5A [CMD] [PAYLOAD] [CHECKSUM]

Generic:
[START] [LENGTH] [COMMAND] [DATA] [CHECKSUM]
```

### Common Encodings

```python
# Frequency (usually straightforward)
freq_hz = (byte_h << 8) | byte_l

# Gain (varies by device)
gain_db = raw_value / scale  # scale: 10, 60, 100, etc.
gain_db = (raw_value - offset) / scale  # offset binary

# Q Factor (often scaled)
q = raw_value / 4096.0  # Common: divide by 4096, 100, 1000
q = raw_value / 100.0

# Filter Type (usually enumeration)
0x00 = Peaking
0x01 = Low Shelf
0x02 = High Shelf
...
```

## 📊 Workflow Diagram

```
1. DISCOVER
   ↓
   scan_ble.py --name "Device"

2. ANALYZE
   ↓
   scan_ble.py --analyze "Device"
   Note: UUIDs, especially 0xFF* (vendor-specific)

3. CAPTURE
   ↓
   capture_bluetooth.py com.app.package
   Perform: Enable EQ, Change bands, Try presets

4. CORRELATE
   ↓
   Match: UI Actions → High-level calls → Bluetooth packets
   Example: Set 1000Hz → Flutter call [1000] → Packet [03 E8]

5. DECODE
   ↓
   Test hypothesis: freq = (byte_h << 8) | byte_l
   Verify: Set 2000Hz → Should see [07 D0]

6. IMPLEMENT
   ↓
   Write encode/decode functions
   Create web interface or CLI tool

7. SHARE! 🎉
```

## 🐛 Troubleshooting Quick Fixes

```bash
# Frida not connecting
adb forward tcp:27042 tcp:27042
adb shell "killall frida-server; /data/local/tmp/frida-server &"

# App crashes when hooking
./capture_bluetooth.py com.app --spawn  # Try spawn mode

# No packets captured
# → Try different script (universal/flutter/airoha)
# → Check if device uses BLE or SPP
# → Verify app is actually using Bluetooth

# Permission denied (macOS)
# → Grant Terminal Full Disk Access in System Preferences

# BLE scan fails
pip install --upgrade bleak  # Update bleak
```

## 💡 Pro Tips

1. **Save Everything**: Always use `--output capture.log`
2. **Compare**: Capture same operation multiple times, compare bytes
3. **Test Systematically**: Change ONE parameter at a time
4. **Round Numbers**: Test with 100, 1000, 10000 to spot scaling
5. **Look for Patterns**: Negative values often use two's complement
6. **Check Existing Protocols**: Your device might use standard protocol
7. **Flutter = Gold**: Flutter apps show high-level values before packets!

## 📚 Files Reference

| File | Purpose |
|------|---------|
| `scan_ble.py` | BLE device discovery |
| `capture_bluetooth.py` | Protocol capture |
| `bluetooth_toolkit.py` | Interactive menu |
| `frida_*.js` | Frida hook scripts |
| `README_TOOLS.md` | Full documentation |
| `QUICK_REFERENCE.md` | This file! |

## 🎓 Learning Resources

### Understand the Tools
```bash
# Each tool has built-in help
./scan_ble.py --help
./capture_bluetooth.py --help

# Read the full docs
cat README_TOOLS.md
```

### Example Success: Moondrop Edge ANC

- **Time**: ~3 hours total
- **Method**: Frida SPP hooks
- **Key Discovery**: Shifted gain encoding
- **Result**: 100% protocol decoded
- **Files**: See `PROTOCOL_COMPLETE.md`

### Your Turn!

Follow the same process:
1. Scan your device
2. Capture packets
3. Find patterns
4. Verify hypotheses
5. Document protocol
6. Share with community!

---

**Remember**: Protocol reverse engineering is detective work.
Be systematic, test hypotheses, and document everything! 🔍
