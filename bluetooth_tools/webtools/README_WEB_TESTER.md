# Bluetooth Device Tester - Web Interface

A comprehensive Chrome web page for testing Bluetooth audio devices using Web Bluetooth API and Web Serial API.

## Features

✅ **Web Bluetooth API Testing (BLE GATT)**
- Connect to BLE devices
- No pairing required
- Works on all platforms (desktop + mobile)
- Real-time notifications

✅ **Web Serial API Testing (Serial Port)**
- Connect to Bluetooth serial ports
- Desktop Chrome only
- Requires device pairing

✅ **Airoha Protocol Support**
- Read PEQ presets (0-3)
- Parse 10-band EQ data
- Display frequency, gain, Q factor
- Visual results display

✅ **Multi-Device Support**
- Audeze Maxwell, MM-500
- Moondrop Edge, Pill
- FiiO devices
- KiwiEars devices
- Any Airoha-based device

## Quick Start

### 1. Open in Chrome

```bash
# Navigate to the file
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/webtools

# Open in Chrome
open -a "Google Chrome" bluetooth_device_tester.html
```

Or simply drag `bluetooth_device_tester.html` into Chrome.

### 2. Test BLE GATT (Web Bluetooth)

1. Click the **"📡 BLE GATT"** tab
2. Power on your device (e.g., Audeze Maxwell)
3. Click **"Connect Device"**
4. Select your device from the dialog
5. Click different preset buttons to read EQ settings
6. View results in the table below

### 3. Test Serial Port (Web Serial)

1. Pair your device via System Settings → Bluetooth
2. Click the **"🔌 Serial Port"** tab
3. Click **"Connect Port"**
4. Select the serial port for your device
5. Click preset buttons to read EQ settings
6. View results in the table below

## Requirements

### For Web Bluetooth (BLE GATT)
- ✅ Chrome 79+ (desktop and mobile)
- ✅ Device must advertise via BLE
- ✅ Device must be powered on
- ✅ No pairing required

### For Web Serial (Serial Port)
- ✅ Chrome 89+ (desktop only)
- ✅ Windows, macOS, or Linux
- ✅ Device must be paired via system settings
- ✅ Device must create a serial port

## Supported Devices

### Confirmed Working
- **Audeze Maxwell** - BLE GATT ✅
- **Audeze MM-500** - Expected to work

### Expected to Work (Airoha-based)
- Moondrop Edge
- Moondrop Pill
- FiiO devices (DX5II, etc.)
- KiwiEars devices
- Many other Airoha chipset devices

## Usage Examples

### Example 1: Test Maxwell via BLE

1. Power on Maxwell
2. Open `bluetooth_device_tester.html` in Chrome
3. Click "BLE GATT" tab
4. Click "Connect Device"
5. Select "Audeze Maxwell BLE"
6. Click "Preset 1" button
7. See 10-band EQ displayed!

**Expected Result:**
```
✅ Connected to Audeze Maxwell BLE
✅ Found Airoha BLE service!
✅ Successfully parsed PEQ data!
   Bands: 10, EQ: Off

[Table showing 10 bands from 32Hz to 16kHz]
```

### Example 2: Test via Serial Port

1. Pair device via macOS System Settings
2. Open `bluetooth_device_tester.html` in Chrome
3. Click "Serial Port" tab
4. Click "Connect Port"
5. Select "/dev/cu.DeviceName"
6. Click "Preset 1" button
7. See EQ data!

## What You'll See

### Successful BLE Connection
```
[12:34:56] 🔍 Requesting Bluetooth device...
[12:34:58] ✅ Device selected: Audeze Maxwell BLE
[12:34:59] ✅ Connected to GATT server
[12:34:59] ✅ Found Airoha BLE service!
[12:35:00] ✅ Got TX and RX characteristics
[12:35:00] ✅ Notifications enabled
[12:35:00] ✅ Ready to read presets!
```

### Reading a Preset
```
[12:35:05] 📤 Reading preset 1...
[12:35:05]    Command: 05 5A 06 00 00 0A 01 EF E8 03
[12:35:05] ✅ Command sent, waiting for response...
[12:35:06] 📥 Received 193 bytes (total: 193)
[12:35:06] ✅ Successfully parsed PEQ data!
[12:35:06]    Bands: 10, EQ: Off
```

### Results Display
- EQ Status card showing Enabled/Disabled
- Bands count (usually 10)
- Table with all filter bands:
  - Band number
  - Frequency (Hz)
  - Gain (dB)
  - Q Factor

## Troubleshooting

### "Web Bluetooth API Not Supported"
**Solution:** Use Chrome 79+ or Edge 79+. Safari doesn't support Web Bluetooth yet.

### "Web Serial API Not Supported"
**Solution:**
- Desktop Chrome only (not available on mobile)
- Use Chrome 89+
- Try Web Bluetooth instead

### Device not appearing in BLE scan
**Causes:**
- Device not powered on
- Device out of range
- Device doesn't support BLE (try Serial instead)
- Device already connected elsewhere

**Solutions:**
1. Power cycle the device
2. Move closer
3. Disconnect from other devices/apps
4. Try the Serial Port tab instead

### "Airoha BLE service not found"
**Causes:**
- Device doesn't use Airoha protocol
- Wrong device selected
- Device not fully initialized

**Solutions:**
1. Wait a few seconds and try reconnecting
2. Power cycle the device
3. Check if device is Airoha-based
4. Try Serial Port instead

### Serial port connection fails
**Causes:**
- Device not paired
- Device not connected
- Wrong port selected

**Solutions:**
1. Pair via System Settings → Bluetooth
2. Click "Connect" on the device in Bluetooth settings
3. Look for ports named like your device
4. Try BLE GATT instead

### No response after sending command
**Causes:**
- Device disconnected
- Wrong protocol
- Device busy

**Solutions:**
1. Check console log for errors
2. Disconnect and reconnect
3. Try different preset
4. Power cycle device

## Technical Details

### Airoha BLE Service
```
Service UUID:  5052494d-2dab-0341-6972-6f6861424c45
TX Char UUID:  43484152-2dab-3241-6972-6f6861424c45 (write)
RX Char UUID:  43484152-2dab-3141-6972-6f6861424c45 (notify)
```

### Read Preset Command
```
Header:  05 5A 06
Payload: 00 00 0A [preset] EF E8 03

preset: 0-3
  0 = Preset 1
  1 = Preset 2 (often "Flat")
  2 = Custom preset 1
  3 = Custom preset 2
```

### Response Format
```
193-byte packet:
  Bytes 0-2:   Header (05 5B BD)
  Byte  5:     Number of bands (0A = 10)
  Byte  8:     EQ enable (00=off, 01=on)
  Bytes 13+:   10 × 18-byte filter blocks

Filter block (18 bytes):
  Bytes 2-5:   Frequency (Hz × 100, uint32 LE)
  Bytes 6-9:   Gain (dB × 100, int32 LE)
  Bytes 14-17: Q factor (× 100, uint32 LE)
```

### Standard 10-Band Frequencies
```
Band 0:  32 Hz
Band 1:  64 Hz
Band 2:  125 Hz
Band 3:  250 Hz
Band 4:  500 Hz
Band 5:  1000 Hz (1 kHz)
Band 6:  2000 Hz (2 kHz)
Band 7:  4000 Hz (4 kHz)
Band 8:  8000 Hz (8 kHz)
Band 9:  16000 Hz (16 kHz)
```

## Browser Compatibility

| Browser | Web Bluetooth | Web Serial | Notes |
|---------|--------------|------------|-------|
| Chrome 89+ | ✅ Yes | ✅ Yes | Recommended |
| Edge 89+ | ✅ Yes | ✅ Yes | Works great |
| Opera 76+ | ✅ Yes | ✅ Yes | Works |
| Safari | ❌ No | ❌ No | Not supported |
| Firefox | ❌ No | ❌ No | Not supported |
| Chrome Android | ✅ Yes | ❌ No | Web Serial desktop only |
| Chrome iOS | ❌ No | ❌ No | iOS limitations |

## Platform Compatibility

| Platform | Web Bluetooth | Web Serial |
|----------|--------------|------------|
| Windows 10+ | ✅ Yes | ✅ Yes |
| macOS 10.15+ | ✅ Yes | ✅ Yes |
| Linux | ✅ Yes | ✅ Yes |
| Chrome OS | ✅ Yes | ✅ Yes |
| Android 6+ | ✅ Yes | ❌ No |
| iOS | ❌ No | ❌ No |

## Privacy & Security

### Web Bluetooth
- ✅ User must explicitly approve each connection
- ✅ Website cannot scan without user interaction
- ✅ Connection limited to approved device only
- ✅ No persistent access without user approval

### Web Serial
- ✅ User must explicitly select port
- ✅ No automatic access to ports
- ✅ Connection limited to selected port only
- ✅ Requires user permission each time

## Extending the Tool

The code is well-structured for adding features:

### Add New Commands
```javascript
function buildMyCommand(param) {
    return new Uint8Array([0x05, 0x5A, ...]);
}
```

### Add New Protocol Support
```javascript
function parseMyProtocol(data) {
    // Parse custom protocol
    return { ... };
}
```

### Add UI for New Features
```html
<button onclick="myNewFeature()">New Feature</button>
```

## Comparison with CLI Tool

| Feature | Web Tool | CLI Tool |
|---------|----------|----------|
| BLE GATT | ✅ Yes | ✅ Yes |
| Serial Port | ✅ Yes | ✅ Yes |
| User Approval | Required | Not required |
| Platform | Chrome only | Any with Python |
| Installation | None | pip install |
| Pairing | Via browser | Via system |
| Portability | High | Medium |
| Debugging | Console log | Terminal output |

## Files

- `bluetooth_device_tester.html` - Main web interface (single file)
- `README_WEB_TESTER.md` - This file

## Related Tools

**Command-Line Tools:**
- `bluetooth_toolkit.py test` - CLI version
- `bluetooth_tester.py` - Testing module
- `maxwell_airoha_ble_test.py` - Maxwell-specific test

**Documentation:**
- `../cli_tools/TESTING_GUIDE.md` - Complete testing guide
- `../cli_tools/MAXWELL_BLUETOOTH_FINDINGS.md` - Technical details
- `../cli_tools/QUICK_TEST_REFERENCE.md` - Quick reference

## Credits

Based on reverse engineering of:
- Audeze Maxwell (BLE GATT protocol)
- Moondrop Edge (ANC control)
- Various Airoha-based audio devices

Uses standard Chrome Web APIs:
- Web Bluetooth API (W3C standard)
- Web Serial API (WICG specification)

## License

Free to use for testing your own Bluetooth devices.

---

**Happy Testing!** 🎧

For questions or issues, check the console log first - it shows detailed information about what's happening.
