# Sony Headphones Support - WH-1000XM5/XM6

## Overview

Added comprehensive support for Sony WH-1000XM5, WH-1000XM6, WF-1000XM5, and LinkBuds series headphones. Based on reverse engineering of the Sony SoundConnect mobile app.

## Important Note: NOT Airoha Protocol

**Sony headphones use their OWN proprietary "Tandem" protocol, not the Airoha protocol!**

- **Sony Protocol:**
  - Service UUID: `45C93E07-D90D-4B93-A9DB-91E5DD734E35`
  - 5-band Graphic EQ (fixed frequencies)
  - Command codes: 0x50, 0x52, 0x58, etc.

- **Airoha Protocol** (Audeze Maxwell, Moondrop):
  - Service UUID: `5052494d-2dab-0341-6972-6f6861424c45`
  - Parametric EQ with adjustable frequency, gain, Q
  - Different command structure entirely

## Files Added

1. **`sony_protocol.py`** - Protocol implementation
   - Command generation
   - Response parsing
   - EQ preset management
   - Battery status

2. **`frida_sony.js`** - Frida capture script
   - Hooks Sony SoundConnect app
   - Captures BLE GATT traffic
   - Decodes EQ commands and presets

3. **Updated `bluetooth_toolkit.py`**
   - New `test-sony` command
   - Added `--sony` flag to capture command

4. **Updated `capture_bluetooth.py`**
   - Support for `--sony` capture mode

## Quick Start

### 1. Test Sony Command Generation

```bash
# Generate test commands for WH-1000XM5
python3 bluetooth_toolkit.py test-sony "WH-1000XM5"
```

This will show:
- Get EQ capability command
- Get EQ status command
- Set preset commands
- Set custom EQ commands
- Battery level command

### 2. Capture Sony App Protocol

**Requirements:**
- Rooted Android device with ADB connected
- frida-server running on device
- Sony SoundConnect app installed

**Steps:**

```bash
# List running apps
python3 bluetooth_toolkit.py list-apps

# Capture from Sony SoundConnect app
python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony

# Or with output file
python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony -o sony_capture.txt
```

**What you'll see:**
- BLE service discovery
- EQ capability queries
- EQ status reads
- EQ preset changes
- Custom EQ band adjustments
- Battery level queries

### 3. Use Python Protocol Directly

```python
from sony_protocol import SonyProtocol, EQPresetId

protocol = SonyProtocol()

# Get EQ capability
cmd = protocol.get_eq_capability()
print(f"Send: {cmd.hex()}")

# Set Bass preset
cmd = protocol.set_eq_preset(EQPresetId.BASS)
print(f"Send: {cmd.hex()}")

# Set custom EQ (Bass boost: +8, +5, 0, -2, 0)
cmd = protocol.set_custom_eq([8, 5, 0, -2, 0])
print(f"Send: {cmd.hex()}")

# Get battery level
cmd = protocol.get_battery_level()
print(f"Send: {cmd.hex()}")
```

### 4. Parse Responses

```python
from sony_protocol import SonyProtocol

protocol = SonyProtocol()

# Parse EQ status response
response = bytes.fromhex("53 01 16 05 08 05 00 FE 00")
status = SonyProtocol.parse_eq_status(response)
if status:
    print(f"Preset: {status.preset_id}")
    print(f"Bands: {status.band_values}")

# Parse EQ capability
response = bytes.fromhex("51 01 F6 0A 10 ...")  # Example
capability = SonyProtocol.parse_eq_capability(response)
if capability:
    print(f"Gain range: {capability.min_gain} to {capability.max_gain} dB")
    print(f"Presets: {capability.presets}")

# Parse battery level
response = bytes.fromhex("11 50")  # 80%
battery = SonyProtocol.parse_battery_level(response)
print(f"Battery: {battery}%")
```

## Protocol Details

### EQ Commands

| Command | Code | Description |
|---------|------|-------------|
| EQEBB_GET_CAPABILITY | 0x50 | Get EQ capability info |
| EQEBB_RET_CAPABILITY | 0x51 | Return EQ capability |
| EQEBB_GET_STATUS | 0x52 | Get current EQ status |
| EQEBB_RET_STATUS | 0x53 | Return EQ status |
| EQEBB_SET_PARAM | 0x58 | Set EQ parameters |

### EQ Presets

| Preset | Code | Preset | Code |
|--------|------|--------|------|
| Off | 0x00 | Bright | 0x10 |
| Rock | 0x01 | Excited | 0x11 |
| Pop | 0x02 | Mellow | 0x12 |
| Jazz | 0x03 | Relaxed | 0x13 |
| Dance | 0x04 | Vocal | 0x14 |
| EDM | 0x05 | Treble | 0x15 |
| R&B/Hip-Hop | 0x06 | Bass | 0x16 |
| Acoustic | 0x07 | Speech | 0x17 |
| Custom | 0xA0 | User Setting 1-5 | 0xA1-0xA5 |

### EQ Characteristics

**Type:** Graphic EQ (NOT Parametric)

**Bands:** 5 fixed frequency bands
- Band 1: ~400 Hz (Bass)
- Band 2: ~1 kHz (Low-Mid)
- Band 3: ~2.5 kHz (Mid)
- Band 4: ~6.3 kHz (High-Mid)
- Band 5: ~16 kHz (Treble)

**Gain Range:** -10 dB to +10 dB per band

**No Support For:**
- Variable frequency adjustment
- Q factor control
- Filter type selection (peak/shelf/notch)
- Per-band enable/disable

### Command Examples

**Get EQ Capability:**
```
TX: 50 01 00
RX: 51 01 F6 0A 10 [preset list...]
    ^^    ^^  ^^ ^^
    |     |   |  |
    |     |   |  +-- Max gain (+10)
    |     |   +----- Min gain (-10)
    |     +--------- Inquiry type (PRESET_EQ)
    +--------------- Command (RET_CAPABILITY)
```

**Get Current EQ:**
```
TX: 52 01
RX: 53 01 16 05 08 05 00 FE 00
    ^^    ^^ ^^ ^^ ^^ ^^ ^^ ^^
    |     |  |  |  |  |  |  |
    |     |  |  |  |  |  |  +-- Band 5: 0 dB
    |     |  |  |  |  |  +----- Band 4: -2 dB (0xFE = -2 signed)
    |     |  |  |  |  +-------- Band 3: 0 dB
    |     |  |  |  +----------- Band 2: +5 dB
    |     |  |  +-------------- Band 1: +8 dB
    |     |  +----------------- Num bands (5)
    |     +-------------------- Preset (0x16 = Bass)
    +-------------------------- Command (RET_STATUS)
```

**Set Bass Preset:**
```
TX: 58 01 16 00
    ^^ ^^ ^^ ^^
    |  |  |  +-- 0 bands (use preset values)
    |  |  +----- Preset ID (0x16 = Bass)
    |  +-------- Inquiry type (PRESET_EQ)
    +----------- Command (SET_PARAM)
```

**Set Custom EQ:**
```
TX: 58 01 A0 05 08 05 00 FE 00
    ^^ ^^ ^^ ^^ ^^ ^^ ^^ ^^ ^^
    |  |  |  |  |  |  |  |  |
    |  |  |  |  |  |  |  |  +-- Band 5: 0 dB
    |  |  |  |  |  |  |  +----- Band 4: -2 dB
    |  |  |  |  |  |  +-------- Band 3: 0 dB
    |  |  |  |  |  +----------- Band 2: +5 dB
    |  |  |  |  +-------------- Band 1: +8 dB
    |  |  |  +----------------- Num bands (5)
    |  |  +-------------------- Preset (0xA0 = Custom)
    |  +----------------------- Inquiry type (PRESET_EQ)
    +-------------------------- Command (SET_PARAM)
```

## Web Bluetooth Implementation

To add Sony support to the web tester (`bluetooth_device_tester.html`), use these UUIDs:

```javascript
const SONY = {
    SERVICE_UUID: '45c93e07-d90d-4b93-a9db-91e5dd734e35',
    WRITE_CHAR_UUID: '45c93c15-d90d-4b93-a9db-91e5dd734e35',
    NOTIFY_CHAR_UUID: '45c93c16-d90d-4b93-a9db-91e5dd734e35',
};

// Connect
const device = await navigator.bluetooth.requestDevice({
    filters: [
        { namePrefix: 'LE_WH-1000XM5' },
        { namePrefix: 'WH-1000XM5' },
        { namePrefix: 'WH-1000XM6' }
    ],
    optionalServices: [SONY.SERVICE_UUID]
});

const server = await device.gatt.connect();
const service = await server.getPrimaryService(SONY.SERVICE_UUID);
const writeChar = await service.getCharacteristic(SONY.WRITE_CHAR_UUID);
const notifyChar = await service.getCharacteristic(SONY.NOTIFY_CHAR_UUID);

// Set up notifications
await notifyChar.startNotifications();
notifyChar.addEventListener('characteristicvaluechanged', (event) => {
    const value = new Uint8Array(event.target.value.buffer);
    console.log('RX:', Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' '));
});

// Send command
await writeChar.writeValue(new Uint8Array([0x52, 0x01])); // Get EQ status
```

## Testing Workflow

### Step 1: Connect Device
Pair your Sony WH-1000XM5/XM6 with your test device (Android/Mac/PC)

### Step 2: Test Commands
```bash
# Generate test commands
python3 bluetooth_toolkit.py test-sony "WH-1000XM5"

# Copy the hex commands shown
```

### Step 3: Capture Real App
```bash
# Start capture on Android
adb shell "/data/local/tmp/frida-server &"
python3 bluetooth_toolkit.py capture com.sony.songpal.tandemfamily --sony

# In another terminal, interact with Sony app:
# - Change EQ presets
# - Adjust custom EQ bands
# - Check battery level
```

### Step 4: Compare
Compare captured traffic with generated test commands to verify protocol implementation

## Troubleshooting

### Capture shows no data
- Ensure frida-server is running: `adb shell ps | grep frida`
- Check app is running: `python3 bluetooth_toolkit.py list-apps`
- Try spawning app: `--spawn` flag

### Wrong UUIDs
Sony devices may advertise with different names:
- `LE_WH-1000XM5` (BLE advertising name)
- `WH-1000XM5` (device name)
- `WH-1000XM6`, `WF-1000XM5`, etc.

Use `python3 bluetooth_toolkit.py scan` to find exact name

### Commands don't work
- Verify headphones are paired and connected
- Check if device is in pairing mode (may block other connections)
- Some commands only work when music is playing
- Firmware version may affect protocol slightly

## Reference Documentation

See the Sony SoundConnect decompiled source documentation:
- `/Users/jeromeof/Downloads/Sony SoundsConnect/PROTOCOL_DOCUMENTATION.md`
- `/Users/jeromeof/Downloads/Sony SoundsConnect/IMPLEMENTATION_GUIDE.md`
- `/Users/jeromeof/Downloads/Sony SoundsConnect/PEQ_ANALYSIS.md`

## Next Steps

1. **Test with real hardware** - Verify commands work with physical WH-1000XM5
2. **Add to Web Tester** - Integrate Sony support into `bluetooth_device_tester.html`
3. **More commands** - Implement noise canceling, ambient sound mode, etc.
4. **BLE pairing flow** - Document initial connection handshake if needed
5. **Compare models** - Test with WH-1000XM6, WF-1000XM5 to verify compatibility

## Summary

✅ **What's Working:**
- Protocol implementation (`sony_protocol.py`)
- Command generation for all EQ operations
- Response parsing
- Frida capture script (`frida_sony.js`)
- CLI integration (`test-sony`, `capture --sony`)

🚧 **What's Next:**
- Web Bluetooth tester integration
- Real hardware testing
- Additional features (NC, ambient sound, etc.)

🎧 **Supported Models:**
- Sony WH-1000XM5 (over-ear)
- Sony WH-1000XM6 (over-ear)
- Sony WF-1000XM5 (earbuds)
- Sony LinkBuds series

---

**Created:** 2026-02-08
**Protocol:** Sony "Tandem" BLE GATT
**Based on:** Sony SoundConnect APK analysis
