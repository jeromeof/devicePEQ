# Ugreen Max5C - Protocol Analysis & Findings

## 📊 Summary

The Ugreen Max5C uses a **simple proprietary protocol over Classic Bluetooth SPP** (Serial Port Profile), NOT the JieLi RCSP protocol documented in the decompiled app files.

---

## 🔍 Protocol Details

### Communication Method
- **Transport**: Classic Bluetooth SPP (Serial Port Profile)
- **NOT BLE**: The BLE services we found are unused/minimal
- **Baud Rate**: Standard (115200 recommended)

### Packet Structure

**TX (App → Device):**
```
AA BB CC [LEN] [CMD] [DATA...] [CRC_H] [CRC_L]
```

**RX (Device → App):**
```
DD EE FF [LEN] [CMD] [STATUS] [DATA...] [CRC_H] [CRC_L]
```

---

## 🎵 Discovered Commands

### 1. Preset Switching (Command 0x01)

| Preset | TX Command | RX Response |
|--------|------------|-------------|
| **0 - Default** | `AA BB CC 05 01 00 60 51` | `DD EE FF 05 01 01 00 84 3C` |
| **1 - Jazz** | `AA BB CC 05 01 01 A1 91` | `DD EE FF 05 01 01 01 A5 2C` |
| **2 - Rock** | `AA BB CC 05 01 02 E1 90` | `DD EE FF 05 01 01 02 C6 1C` |
| **3 - Pop** | `AA BB CC 05 01 03 20 50` | `DD EE FF 05 01 01 03 E7 0C` |
| **4 - Classical** | `AA BB CC 05 01 04 61 92` | `DD EE FF 05 01 01 04 00 7C` |
| **5 - Vocals** | `AA BB CC 05 01 05 A0 52` | `DD EE FF 05 01 01 05 21 6C` |
| **6 - Bass Boost** | `AA BB CC 05 01 06 E0 53` | `DD EE FF 05 01 01 06 42 5C` |
| **7 - Treble Boost** | `AA BB CC 05 01 07 21 93` | `DD EE FF 05 01 01 07 63 4C` |

**Pattern:**
- Length: Always `05` (5 bytes following)
- Command: `01` (preset selection)
- Data: Preset number (0-7)
- CRC: 2-byte checksum (algorithm TBD)

**Response:**
- Status byte: `01` (success)
- Echo: Returns the preset number that was set

---

## ❌ What's NOT Supported

Based on testing and analysis:

1. **No Custom EQ** - Only 8 fixed presets stored in firmware
2. **No Parametric EQ** - Can't program frequencies, Q values, or gains
3. **No Dynamic EQ** - Can't modify the number of bands
4. **No EQ Data Query** - Device doesn't return EQ band values

The **ugreen-*.md files** in this directory describe the JieLi RCSP protocol, which is used by OTHER Ugreen devices, but NOT the Max5C.

---

## 🔧 Tools Created

### 1. ugreen_max5c_controller.html
**Web Serial API controller** (Desktop Chrome only)

Features:
- ✅ Connect via Bluetooth Serial Port
- ✅ 8 preset buttons (Default through Treble Boost)
- ✅ Visual feedback for active preset
- ✅ Communication log showing hex dumps
- ✅ Clean, modern UI

**Usage:**
1. Pair Max5C with computer via Bluetooth
2. Open `ugreen_max5c_controller.html` in Chrome/Edge
3. Click "Connect to Headphones"
4. Select the Bluetooth serial port
5. Click preset buttons to switch EQ modes

### 2. ugreen_direct_test.py
**Direct BLE testing script** (abandoned - BLE not used for commands)

This was our initial attempt to communicate via BLE GATT, but we discovered the device uses Classic Bluetooth SPP instead.

---

## 📝 Investigation Status

### ✅ Confirmed
- [x] Protocol structure (AA BB CC / DD EE FF)
- [x] 8 preset commands (0-7)
- [x] Classic Bluetooth SPP transport
- [x] Simple command format

### ❓ Unknown (Need More Investigation)
- [ ] CRC/Checksum algorithm
- [ ] Other commands (volume, ANC, battery, LED, etc.)
- [ ] Command ID space (what else besides 0x01?)
- [ ] Firmware version query
- [ ] Hidden advanced features

### 🔍 Next Steps for Discovery

1. **Search decompiled Android app** for:
   - Command builders
   - Byte array patterns with AA BB CC
   - SPP/Serial communication code
   - Command ID constants

2. **Test other operations** while capturing:
   - Volume up/down
   - ANC mode switching
   - Power on/off
   - Pairing mode
   - LED control (if any)
   - Battery query

3. **Reverse engineer CRC**:
   - Compare multiple commands
   - Identify the checksum algorithm
   - Implement in JavaScript for web controller

---

## 🎯 Realistic Capabilities

### What We CAN Do:
- ✅ Switch between 8 presets programmatically
- ✅ Create web-based controller (faster than app)
- ✅ Automate preset switching
- ✅ Integrate with other software

### What We CANNOT Do:
- ❌ Create custom EQ curves
- ❌ Modify frequencies or gains
- ❌ Add more than 8 presets
- ❌ Enable parametric EQ

**The hardware likely only supports these 8 presets** - they're probably hardcoded DSP profiles in the firmware, not reprogrammable EQ bands.

---

## 📚 Files in This Directory

| File | Purpose |
|------|---------|
| `ugreen_max5c_controller.html` | Web Serial controller (READY TO USE) |
| `ugreen_direct_test.py` | BLE test script (deprecated) |
| `ugreen-PROTOCOL_REFERENCE.md` | RCSP protocol docs (wrong protocol) |
| `ugreen-AUDIO_EQ_BASS_TREBLE_DOCUMENTATION.md` | RCSP protocol docs (wrong protocol) |
| `UGREEN_CAPTURE_GUIDE.md` | Frida capture guide |
| `UGREEN_MAX5C_FINDINGS.md` | This file - protocol analysis |
| `frida_ugreen_rcsp.js` | RCSP Frida script (not needed) |

---

## 🤔 Why the Confusion?

The decompiled app includes **JieLi RCSP SDK** code, which supports full EQ customization. However:
- The Max5C **doesn't actually use** this SDK
- It uses a much **simpler proprietary protocol**
- The RCSP code is probably for **other Ugreen products**

This explains why:
- The app only shows 8 presets
- We couldn't query EQ data via RCSP commands
- BLE GATT services are minimal
- Classic Bluetooth SPP is used instead

---

## 🔬 Technical Notes

### Checksum Algorithm (Unverified)
Current guess based on patterns:
```javascript
function calculateChecksum(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        crc = ((crc << 8) ^ data[i]) & 0xFFFF;
    }
    return [(crc >> 8) & 0xFF, crc & 0xFF];
}
```

This is a **placeholder** - needs verification by comparing multiple command CRCs.

### Device Identification
- **Model**: Ugreen HiTune Max5C
- **BLE Name**: "UGREEN HiTune Max5c"
- **BLE Services**: Minimal (unused for commands)
- **SPP Profile**: Used for all control commands

---

## 📧 Contact & Updates

This analysis is ongoing. If you discover:
- Additional commands
- The correct CRC algorithm
- Hidden features
- Firmware update protocols

Please document them here!

**Last Updated**: 2026-01-25
**Status**: Basic protocol decoded, web controller functional
**Next Goal**: Find additional commands (volume, ANC, battery)
