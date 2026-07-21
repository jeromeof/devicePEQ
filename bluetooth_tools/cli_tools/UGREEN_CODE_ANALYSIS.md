# Ugreen Max5C - Source Code Analysis

## 📊 Architecture Overview

### Communication Flow
```
WebView (HTML/JS)
    ↓ (JSON with preset/mode/etc)
BluetoothController.java
    ↓ (processes commands)
T5/b.java (SPP Socket)
    ↓ (OutputStream.write)
Headphones (AA BB CC protocol)
```

---

## 🔍 Key Files Found

### 1. **BluetoothController.java**
Location: `com/ugreen/webview/refactor/BluetoothController.java`

**Purpose**: Main Bluetooth control logic

**Key Methods**:
- `sendBTData(int[] data)` - Sends data to device via SPP/BLE
- `writeBuffer(String dataBuffer)` - Decodes Base64 and writes
- `startClassicSocket()` - Establishes SPP connection
- `sendBleData(String mac, int[] data)` - BLE write wrapper

**Critical Finding**: Commands come from WebView as JSON, then converted to byte arrays

---

### 2. **T5/b.java** (SPP Socket Handler)
Location: `T5/b.java`

**Purpose**: Low-level Bluetooth SPP socket management

**Key Method**:
```java
public final boolean e(byte[] bArr) {
    // Line 111: THE ACTUAL WRITE!
    ((OutputStream) ((f) cVar.f14470d).getValue()).write(bArr);
    int length = bArr.length;
    String Z8 = C0054a.Z(bArr, true);
    Log.i("BluetoothSocketUtil", "size:" + length + " write: " + Z8);
    return b();
}
```

This is where `AA BB CC...` bytes are actually written!

---

### 3. **PayloadBean.java**
Location: `com/ugreen/webview/PayloadBean.java`

**Purpose**: Data model for web ↔ app communication

**Key Fields**:
```java
private final Integer preset;       // EQ preset number (0-7)
private final Integer EQ_mode;      // EQ mode
private final Integer game_mode;    // Game mode setting
private final Object noise_mode;    // ANC/transparency mode
private final Integer mode;         // General mode
private final String dataBuffer;    // Base64 encoded commands
private final Boolean windNoise;    // Wind noise reduction
private final Boolean space_acoustics;  // 3D audio
```

**Critical Insight**: The web UI sends high-level commands (preset=1), and the app converts these to byte arrays.

---

## 💡 What We Still Need

### Missing Link: Command Construction

We know:
- ✅ Where commands are **written** (T5/b.java line 111)
- ✅ What **data format** is used (PayloadBean fields)
- ❌ **HOW** preset numbers are converted to byte arrays

### The Command Builder

Somewhere in the code, there must be logic like:
```java
// PSEUDOCODE - what we're looking for
byte[] buildPresetCommand(int preset) {
    byte[] cmd = new byte[8];
    cmd[0] = (byte) 0xAA;  // -86 signed
    cmd[1] = (byte) 0xBB;  // -69 signed
    cmd[2] = (byte) 0xCC;  // -52 signed
    cmd[3] = 0x05;         // length
    cmd[4] = 0x01;         // command ID
    cmd[5] = (byte) preset; // preset number
    // cmd[6-7] = checksum
    return cmd;
}
```

---

## 🔎 Next Investigation Steps

### Approach 1: Capture MORE Commands
Instead of digging through obfuscated code, **capture more operations**:

```bash
python3.11 bluetooth_toolkit.py capture com.ugreen.iot --output full_capture.txt
```

Then in the app, try:
1. **Volume Up/Down** (if app has controls)
2. **ANC Mode switching** (Normal/ANC/Transparency)
3. **Game Mode** toggle (if exists)
4. **Wind Noise** toggle (if exists)
5. **3D Audio** toggle (if exists)
6. **Power off** command (if exists)

This will reveal:
- Command ID for volume (`0x02`?)
- Command ID for ANC (`0x03`?)
- Command ID for game mode (`0x04`?)
- etc.

### Approach 2: Reverse Engineer CRC
With multiple captured commands, we can:
1. Compare checksums across different commands
2. Identify the CRC algorithm
3. Implement it properly in the web controller

### Approach 3: Search for Command Constants
```bash
# Search for command ID constants
grep -r "0x01\|CMD_.*EQ\|PRESET" ~/Downloads/ugreen-connect-Android-source/sources/com/ugreen --include="*.java"

# Search for checksum/CRC functions
grep -r "checksum\|crc\|calculate.*sum" ~/Downloads/ugreen-connect-Android-source/sources/com/ugreen --include="*.java" -i
```

---

## 📋 Discovered Command Structure

Based on Frida captures:

```
┌─────────┬─────────┬─────────┬────────┬────────┬──────────┬──────────────┬──────────────┐
│ Byte 0  │ Byte 1  │ Byte 2  │ Byte 3 │ Byte 4 │ Byte 5   │ Byte 6-7     │ Purpose      │
├─────────┼─────────┼─────────┼────────┼────────┼──────────┼──────────────┼──────────────┤
│ 0xAA    │ 0xBB    │ 0xCC    │ Length │ Cmd ID │ Data...  │ CRC (2 bytes)│ TX to device │
│ 0xDD    │ 0xEE    │ 0xFF    │ Length │ Cmd ID │ Status   │ Data + CRC   │ RX from dev  │
└─────────┴─────────┴─────────┴────────┴────────┴──────────┴──────────────┴──────────────┘
```

### Known Commands

| Cmd ID | Function | Data Format | Example |
|--------|----------|-------------|---------|
| `0x01` | Set Preset | `[PRESET_NUM]` | `AA BB CC 05 01 02 ...` (Preset 2 - Rock) |
| `0x??` | Volume? | TBD | Not captured yet |
| `0x??` | ANC Mode? | TBD | Not captured yet |
| `0x??` | Game Mode? | TBD | Not captured yet |

---

## 🎯 Practical Recommendations

### For Finding More Commands:

**1. Use the App Intensively**
While Frida capture is running, click EVERY button/setting:
- All 8 presets (done ✓)
- Volume controls
- ANC/Transparency
- Any "modes" or special features
- Settings menu options

**2. Compare Command Patterns**
Once you have 20-30 commands captured:
- Group by command ID (byte 4)
- Analyze data patterns (byte 5+)
- Reverse engineer CRC (bytes 6-7)

**3. Build Command Library**
Create a reference of all commands:
```javascript
const COMMANDS = {
    PRESET: {
        id: 0x01,
        build: (preset) => [0xAA, 0xBB, 0xCC, 0x05, 0x01, preset, ...crc]
    },
    VOLUME: {
        id: 0x??,  // To be discovered
        build: (level) => [0xAA, 0xBB, 0xCC, 0x05, 0x??, level, ...crc]
    },
    // ... more commands
};
```

---

## 🚀 Current Status

### What Works
- ✅ Preset switching via SPP
- ✅ Web Serial controller (8 presets)
- ✅ Protocol structure understood
- ✅ Communication path traced

### What's Unknown
- ❓ CRC/Checksum algorithm
- ❓ Other command IDs (volume, ANC, etc.)
- ❓ Complete command reference
- ❓ Device capabilities (what features exist)

### What's Impossible
- ❌ Custom EQ (hardware limitation)
- ❌ More than 8 presets
- ❌ Parametric EQ

---

## 📝 Conclusion

The app architecture is clear, but the obfuscated code makes it hard to find the exact command builder. The **fastest path** to discovering all commands is:

1. ✅ Capture MORE commands (volume, ANC, modes, etc.)
2. ✅ Analyze patterns in captured data
3. ✅ Reverse engineer CRC algorithm
4. ✅ Build complete command library

Once we have 10-20 different commands captured, the patterns will become obvious and we can implement a full-featured controller!

---

**Last Updated**: 2026-01-25
**Status**: Communication path traced, need more command captures
**Next Goal**: Capture volume/ANC/mode commands
