# Sony WH-1000XM5/XM6 Quick Start Guide

## 🚀 Quick Commands

### Test Command Generation
```bash
python3 bluetooth_toolkit.py test-sony "WH-1000XM5"
```

### Capture Sony App Traffic (Android + ADB)
```bash
# 1. Start frida-server on Android device
adb shell "/data/local/tmp/frida-server &"

# 2. List running apps
python3 bluetooth_toolkit.py list-apps

# 3. Capture Sony SoundConnect
python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony

# 4. Capture with output file
python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony -o sony_capture.txt
```

### Python Usage
```python
from sony_protocol import SonyProtocol, EQPresetId

protocol = SonyProtocol()

# Get EQ status
cmd = protocol.get_eq_status()
# Send: bytes([0x52, 0x01])

# Set Bass preset
cmd = protocol.set_eq_preset(EQPresetId.BASS)
# Send: bytes([0x58, 0x01, 0x16, 0x00])

# Set custom EQ (Bass boost)
cmd = protocol.set_custom_eq([8, 5, 0, -2, 0])
# Send: bytes([0x58, 0x01, 0xA0, 0x05, 0x08, 0x05, 0x00, 0xFE, 0x00])

# Get battery
cmd = protocol.get_battery_level()
# Send: bytes([0x10])
```

## 📋 Protocol Cheat Sheet

### BLE UUIDs
```
Service:  45C93E07-D90D-4B93-A9DB-91E5DD734E35
Write:    45C93C15-D90D-4B93-A9DB-91E5DD734E35
Notify:   45C93C16-D90D-4B93-A9DB-91E5DD734E35
```

### EQ Commands
```
Get Capability: 50 01 00
Get Status:     52 01
Set Bass:       58 01 16 00
Set Custom:     58 01 A0 05 [5 band values]
Get Battery:    10
```

### EQ Presets
```
0x00 = Off          0x10 = Bright
0x01 = Rock         0x11 = Excited
0x02 = Pop          0x12 = Mellow
0x03 = Jazz         0x13 = Relaxed
0x04 = Dance        0x14 = Vocal
0x05 = EDM          0x15 = Treble
0x06 = R&B/Hip-Hop  0x16 = Bass
0x07 = Acoustic     0x17 = Speech
0xA0 = Custom       0xA1-A5 = User 1-5
```

### EQ Bands (Fixed Frequencies)
```
Band 1: ~400 Hz   (Bass)
Band 2: ~1 kHz    (Low-Mid)
Band 3: ~2.5 kHz  (Mid)
Band 4: ~6.3 kHz  (High-Mid)
Band 5: ~16 kHz   (Treble)

Range: -10 to +10 dB per band
```

## 🎯 Common Tasks

### Capture EQ Preset Change
1. Start capture: `python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony`
2. In Sony app, change EQ preset (e.g., Rock → Bass)
3. Look for `EQEBB_SET_PARAM` (0x58) command in output

### Capture Custom EQ Adjustment
1. Start capture
2. In Sony app, adjust custom EQ bands
3. Look for `EQEBB_SET_PARAM` with preset 0xA0 (Custom)

### Get Current EQ Settings
1. Start capture
2. Open Sony app (it queries status on connect)
3. Look for `EQEBB_RET_STATUS` (0x53) response with band values

### Check Battery Level
1. Start capture
2. Open Sony app
3. Look for `COMMON_RET_BATTERY_LEVEL` (0x11) response

## 📱 Supported Devices

- ✅ Sony WH-1000XM5 (over-ear)
- ✅ Sony WH-1000XM6 (over-ear)
- ✅ Sony WF-1000XM5 (earbuds)
- ✅ Sony LinkBuds series

BLE advertising names:
- `LE_WH-1000XM5`
- `WH-1000XM5`
- `WH-1000XM6`
- Similar for other models

## 🔧 Troubleshooting

### "No frida-server"
```bash
# Check if running
adb shell ps | grep frida

# Start it
adb shell "/data/local/tmp/frida-server &"
```

### "Cannot find app"
```bash
# List all apps
python3 bluetooth_toolkit.py list-apps | grep -i sony

# Common Sony packages:
# com.sony.songpal.tandemfamily
# com.sony.songpal.mdr
```

### "No output during capture"
- Make sure Sony app is running
- Try spawning: `--spawn` flag
- Interact with app (change EQ, check battery)
- Some commands only work when headphones are connected

### Scan for Device
```bash
# Find Sony headphones
python3 bluetooth_toolkit.py scan

# Look for names starting with:
# - LE_WH-1000XM5
# - WH-1000XM5
# - WH-1000XM6
```

## 📖 More Information

- Full docs: `SONY_SUPPORT.md`
- Protocol: `sony_protocol.py`
- Frida script: `frida_sony.js`
- Sony docs: `~/Downloads/Sony SoundsConnect/`

## ⚠️ Important Notes

1. **NOT Airoha Protocol** - Sony uses their own "Tandem" protocol
2. **Graphic EQ Only** - No parametric EQ (no frequency/Q adjustment)
3. **Fixed Bands** - 5 bands at fixed frequencies
4. **Range** - -10 to +10 dB per band
5. **Pairing** - Device must be paired via system Bluetooth first

## 🎨 Example: Custom Bass Boost

```python
from sony_protocol import SonyProtocol

protocol = SonyProtocol()

# Bass boost: Heavy bass, moderate low-mid, neutral rest
bands = [8, 5, 0, -2, 0]  # 400Hz, 1kHz, 2.5kHz, 6.3kHz, 16kHz

cmd = protocol.set_custom_eq(bands)
print(f"Send to headphones: {cmd.hex()}")
# Output: 5801a0050805 00fe00

# In detail:
# 58     = EQEBB_SET_PARAM
# 01     = PRESET_EQ inquiry type
# A0     = Custom preset
# 05     = 5 bands
# 08     = Band 1: +8 dB (400 Hz)
# 05     = Band 2: +5 dB (1 kHz)
# 00     = Band 3:  0 dB (2.5 kHz)
# FE     = Band 4: -2 dB (6.3 kHz, 0xFE = -2 signed)
# 00     = Band 5:  0 dB (16 kHz)
```

---

**Ready to test!** 🎧

For Web Bluetooth implementation and more advanced features, see `SONY_SUPPORT.md`.
