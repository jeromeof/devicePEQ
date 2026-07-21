# Ugreen Max5C Protocol Capture Guide

## Quick Start

The Ugreen Max5C uses the **JieLi RCSP (Remote Control Serial Protocol)** which supports:
- ✅ **Variable-band Graphic EQ** (not limited to 10 bands!)
- ✅ **Dynamic EQ format** with custom frequencies
- ✅ **Separate Bass/Treble controls**
- ✅ Full read/write capabilities

The Android app artificially limits you to 8 presets, but the underlying protocol supports much more!

---

## Step 1: List Android Apps

First, find the Ugreen app package name:

```bash
python3.11 bluetooth_toolkit.py list-apps
```

Look for the Ugreen Connect app (probably something like `com.ugreen.*` or similar).

---

## Step 2: Start Capture

Once you have the package name, start capturing with the specialized RCSP protocol parser:

```bash
# Replace com.ugreen.connect with your actual package name
python3.11 bluetooth_toolkit.py capture com.ugreen.connect --ugreen
```

Or save to a file:

```bash
python3.11 bluetooth_toolkit.py capture com.ugreen.connect --ugreen --output ugreen_capture.txt
```

---

## Step 3: Generate Traffic

While the capture is running, perform these actions in the Ugreen app:

### Test Sequence:

1. **Switch between presets** - Try all 8 presets to see EQ differences:
   - Default
   - Jazz (currently selected)
   - Rock
   - Pop
   - Classical
   - Vocals
   - Bass Boost
   - Treble Boost

2. **Check for hidden EQ** - Look for any hidden/advanced settings menu

3. **Toggle ANC modes** - These might affect EQ

---

## What to Look For

The RCSP capture will show you:

### EQ Data Format:

**Static EQ (10 fixed bands):**
```
Mode: 2 (Jazz preset)
Bands: 10
Frequencies: 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz
Gains: [+3, +2, 0, -1, -2, 0, +1, +2, +1, 0] dB
```

**Dynamic EQ (variable bands):**
```
Mode: 2 | 0x80 (Dynamic flag)
Bands: 8
Gains: [+3, +2, 0, -2, -4, 0, +1, +2] dB
```

### Bass/Treble:
```
Attribute Type: BASS_TREBLE
Bass: 5
Treble: 3
```

### Complete RCSP Packet:
```
📤 RCSP TX
Raw: FE DC BA C0 08 00 0E 02 FF 0C 04 02 03 02 01 00 FF FE FD FC FB FA EF
Type: COMMAND
OpCode: 0x08 (SET_SYS_INFO)
Sequence: 2
Attribute Type: EQ
Mode: 2 (Jazz)
Bands: [+3, +2, +1, 0, -1, -2, -3, -4, -5, -6] dB
```

---

## Understanding the Results

### If you see Static EQ:
- The device uses 10 fixed frequency bands
- You can create custom presets with full control
- Web interface can be built using Web Bluetooth

### If you see Dynamic EQ:
- The device supports variable bands and custom frequencies
- More flexible than static EQ
- Can potentially program any number of bands

### Bass/Treble Separate:
- Independent from EQ
- 32-bit integer values
- Range needs to be determined from capture

---

## Expected Outcome

Based on the decompiled app analysis, you should see:

1. **EQ Preset Changes**: When switching presets, look for `CMD_SET_SYS_INFO` with `ATTR_EQ`
2. **Dynamic Format Detection**: Mode byte with bit 7 set (0x80) indicates dynamic format
3. **Frequency Information**: `ATTR_EQ_PRESET` contains the frequency bands

---

## Next Steps

After capturing the traffic:

1. **Analyze the captures** to understand the exact EQ values for each preset
2. **Determine frequency bands** - Are they fixed or dynamic?
3. **Identify value ranges** - What's the min/max gain for each band?
4. **Create custom presets** - Define your own EQ curves
5. **Build web controller** - Use the provided protocol to create a browser-based EQ editor

---

## Troubleshooting

### No packets appearing?
- Make sure Frida-server is running on Android
- Check ADB connection: `adb devices`
- Verify the app is running in foreground
- Try disconnecting/reconnecting headphones

### Getting errors?
- Ensure you're using Python 3.11: `python3.11 --version`
- Check frida is installed: `pip3.11 list | grep frida`
- Try restarting frida-server on Android

### Can't find the app?
- Use `adb shell pm list packages | grep ugreen` to find package name
- The app might be named differently (check all running apps)

---

## Protocol Reference

Based on the decompiled app, the Ugreen Max5C uses:

- **Protocol**: JieLi RCSP (Remote Control Serial Protocol)
- **Transport**: BLE GATT
- **Packet Format**: `FE DC BA [header] [params] EF`
- **EQ Attribute**: Type 0x04
- **Bass/Treble**: Type 0x0B
- **EQ Preset**: Type 0x0C

See `ugreen-PROTOCOL_REFERENCE.md` for complete protocol details.
