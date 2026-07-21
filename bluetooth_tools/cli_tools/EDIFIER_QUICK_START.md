# Edifier W830NB - Quick Start Guide

## Prerequisites Check
```bash
✅ W830NB headphones powered on
✅ Android device rooted with ADB
✅ Edifier ConnectX app installed on Android
✅ Frida server running on Android
```

## 5-Step Quick Start

### 1. Start Frida Server (Terminal 1)
```bash
adb shell "su -c /data/local/tmp/frida-server &"
```

### 2. Find Edifier App Package
```bash
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools
python3.11 bluetooth_toolkit.py list-apps | grep -i edifier
```

**Expected:** `com.edifier.connectx` or similar

### 3. Launch Edifier App on Android
- Open Edifier ConnectX app
- Connect to W830NB headphones
- Keep app open in foreground

### 4. Start Capture
```bash
# Basic capture (console output)
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier

# Save to file (recommended)
python3.11 bluetooth_toolkit.py capture com.edifier.connectx --edifier -o w830nb_$(date +%Y%m%d_%H%M%S).txt
```

### 5. Perform Actions in App
While capture is running, test these features in order:

**Priority 1: Basic Commands**
- Check battery level
- Adjust volume slider
- Check firmware version

**Priority 2: EQ Operations (MOST IMPORTANT)**
- Switch between EQ presets (Rock, Jazz, Pop, etc.)
- Open Custom EQ page
- Modify a single EQ band (e.g., 100Hz)
- Save custom EQ profile
- Reset EQ to default

**Priority 3: Other Features**
- Toggle ANC modes
- Change other settings

### 6. Stop Capture
Press `Ctrl+C` to stop capturing

---

## Expected Output Example

```
================================================================================
📤 BLE GATT TX
================================================================================
Hex: BB EC 43 00 00 32
   ┌─ Edifier Protocol (V2) ─┐
   │ Direction:  TX
   │ Header:     0xBB (TO device)
   │ Command:    0x43 (67) - CUSTOM_EQ_GET
   │ CRC Valid:  ✅ YES
   └────────────────────────────────────────┘

📥 BLE GATT RX (notification)
Hex: CC EC 43 00 3C [60 bytes of EQ data...] [CRC]
   │ Custom EQ:  10 bands detected
   │   Band 0:    32 Hz | -2 dB | Q= 50 | Peak/Bell
   │   Band 1:   64 Hz | +1 dB | Q= 50 | Peak/Bell
   ...
```

---

## Key Commands to Look For

| Action | Command Code | Hex | What to Observe |
|--------|--------------|-----|-----------------|
| Get Battery | BATTERY | 0xD0 | Response with battery % |
| Get Volume | VOLUME_GET | 0x66 | Response with volume 0-100 |
| Set Volume | VOLUME_SET | 0x67 | Payload: volume value |
| Get Custom EQ | CUSTOM_EQ_GET | 0x43 | Response: 60 bytes (10 bands) |
| Set EQ Band | CUSTOM_EQ_SET_BAND | 0x44 | Payload: 6 bytes (band data) |
| Set Full EQ | CUSTOM_EQ_SET_FULL | 0x46 | Payload: 60+ bytes |

---

## Verification Checklist

After capture session, verify you captured:
- [ ] Battery query (0xD0) - simple test
- [ ] Volume get/set (0x66/0x67) - simple test
- [ ] Custom EQ query (0x43) - **critical**
- [ ] Single band change (0x44) - **critical**
- [ ] All CRCs valid (✅ YES)
- [ ] Protocol V2 confirmed (headers 0xBB/0xCC)

---

## Troubleshooting

**No output?**
→ Perform actions in the app (change volume, switch EQ preset)

**"Failed to attach"?**
→ Make sure Edifier app is running first

**Wrong data?**
→ Verify you're using the correct package name

**Connection lost?**
→ Restart frida-server: `adb shell "pkill frida-server && su -c /data/local/tmp/frida-server &"`

---

## What's Next?

1. **Analyze the capture** - Compare with `EDIFIER_PROTOCOL_DOCUMENTATION.md`
2. **Verify EQ format** - Confirm 6-byte band structure
3. **Document discrepancies** - Update docs if protocol differs
4. **Build web interface** - Once protocol is verified

---

## Files Created

- `frida_edifier.js` - Frida script for W830NB protocol capture
- `EDIFIER_CAPTURE_GUIDE.md` - Detailed step-by-step guide
- `EDIFIER_QUICK_START.md` - This quick reference (you are here)

---

**Need help?** Check `EDIFIER_CAPTURE_GUIDE.md` for detailed troubleshooting.
