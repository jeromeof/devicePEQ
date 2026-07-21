# Bluetooth Communication Testing Guide

## Overview

The bluetooth_toolkit now includes powerful testing capabilities to identify which Bluetooth communication methods work with your audio devices. This helps determine the best Chrome Web API to use for web-based control interfaces.

## Quick Start

### Install Dependencies

```bash
# For BLE GATT testing
pip install bleak

# For Serial Port testing (optional)
pip install pyserial
```

### Test a Device

```bash
# Test both BLE and Serial methods
python3 bluetooth_toolkit.py test "Device Name"

# Examples
python3 bluetooth_toolkit.py test "Maxwell"
python3 bluetooth_toolkit.py test "Moondrop Edge"
python3 bluetooth_toolkit.py test "FiiO" --preset 0
```

## Commands

### `test` - Test All Methods
Tests both BLE GATT and Serial Port communication.

```bash
python3 bluetooth_toolkit.py test "Device Name" [--preset N]
```

**Options:**
- `--preset N` - Specify preset to read (0-3, default: 1)

**What it does:**
1. Scans for BLE devices matching the name
2. Scans for Serial Ports matching the name
3. Tests Airoha protocol communication on each
4. Reports which methods work
5. Shows Chrome Web API compatibility

### `test-ble` - Test BLE GATT Only
Tests only Bluetooth Low Energy GATT communication.

```bash
python3 bluetooth_toolkit.py test-ble "Device Name" [--preset N]
```

**Best for:**
- Devices that advertise via BLE
- Testing Web Bluetooth API compatibility
- Devices without Classic Bluetooth pairing

### `test-serial` - Test Serial Port Only
Tests only Bluetooth Serial Port (SPP/RFCOMM) communication.

```bash
python3 bluetooth_toolkit.py test-serial "Device Name" [--preset N]
```

**Best for:**
- Devices paired as serial ports
- Testing Web Serial API compatibility
- Devices that don't support BLE GATT

## Understanding Results

### Success Output

```
======================================================================
🧪 Testing BLE GATT - Audeze Maxwell BLE
======================================================================
✅ Connected
✅ Found Airoha BLE service
✅ Notifications enabled
📤 Sending command (preset 1): 05 5A 06 00 00 0A 01 EF E8 03
📥 Received 193 bytes
✅ Valid Airoha PEQ response!
   Bands: 10, EQ Enabled: False

======================================================================
📊 Test Results Summary
======================================================================

BLE        ✅ Success       Audeze Maxwell BLE
           Bands: 10, EQ: Off

======================================================================
Chrome Compatibility
======================================================================

BLE GATT             ✅ Works              Web Bluetooth API
Serial Port (SPP)    ❌ Not working        Web Serial API
```

### What This Means

**BLE GATT Works** → Use Chrome's **Web Bluetooth API**
- Works on desktop and mobile Chrome
- No pairing required (user approves in browser)
- Good for universal web apps

**Serial Port Works** → Use Chrome's **Web Serial API**
- Desktop Chrome only
- Requires device to be paired first
- Good for power users

## Supported Protocols

Currently supports the **Airoha PEQ protocol** used by:
- Audeze Maxwell
- Audeze MM-500
- Moondrop Edge
- Moondrop Pill
- FiiO devices
- KiwiEars devices
- And many other Airoha-based headphones

### Protocol Details

**Command:** Read PEQ Preset
```
05 5A 06 00 00 0A [preset] EF E8 03
```

**Response:** 193-byte PEQ packet
```
05 5B BD [188 bytes of PEQ data]
```

**Presets:**
- `0` - Preset 1 (varies by device)
- `1` - Preset 2 (often "Flat" or default)
- `2` - Custom preset 1
- `3` - Custom preset 2

## Device Requirements

### For BLE GATT Testing
- Device must advertise via Bluetooth Low Energy
- Device must expose Airoha BLE service:
  - Service: `5052494d-2dab-0341-6972-6f6861424c45`
  - TX Char: `43484152-2dab-3241-6972-6f6861424c45`
  - RX Char: `43484152-2dab-3141-6972-6f6861424c45`
- Device must be powered on and in range
- No pairing required

### For Serial Port Testing
- Device must be paired via system Bluetooth settings
- Device must create a serial port (shows as `/dev/cu.DeviceName` on macOS)
- `pyserial` library must be installed
- Device must be connected (not just paired)

## Troubleshooting

### "No BLE devices found"

**Causes:**
- Device not powered on
- Device out of range
- Device doesn't support BLE (uses Classic Bluetooth only)
- Bluetooth permission not granted
- Running in sandboxed environment

**Solutions:**
1. Power on device and move closer
2. Grant Bluetooth permission to Terminal
3. Run with: `dangerouslyDisableSandbox: true` (for macOS sandbox)
4. Try `test-serial` instead if device uses Classic Bluetooth

### "No serial ports found"

**Causes:**
- Device not paired via system settings
- `pyserial` not installed
- Device paired but not connected
- Device doesn't support SPP profile

**Solutions:**
1. Pair device in macOS System Settings > Bluetooth
2. Install pyserial: `pip install pyserial`
3. Click "Connect" on device in Bluetooth settings
4. Try `test-ble` if device uses BLE instead

### "Airoha BLE service not found"

**Causes:**
- Device doesn't use Airoha protocol
- Device uses different service UUIDs
- Device requires authentication first

**Solutions:**
1. Use `analyze` command to see available services:
   ```bash
   python3 bluetooth_toolkit.py analyze "Device Name"
   ```
2. Device may not be supported yet
3. Check if device has custom protocol

### "Invalid response format"

**Causes:**
- Device received command but response format differs
- Device uses different protocol version
- Communication issue (partial data)

**Solutions:**
1. Try different presets: `--preset 0`, `--preset 2`, `--preset 3`
2. Check raw response data in output
3. Device may use custom protocol variant

## Example Workflows

### Test Unknown Device

```bash
# 1. Scan for the device
python3 bluetooth_toolkit.py scan

# 2. Analyze its services
python3 bluetooth_toolkit.py analyze "Device Name"

# 3. Test communication
python3 bluetooth_toolkit.py test "Device Name"

# 4. If BLE works, check all presets
python3 bluetooth_toolkit.py test-ble "Device Name" --preset 0
python3 bluetooth_toolkit.py test-ble "Device Name" --preset 1
python3 bluetooth_toolkit.py test-ble "Device Name" --preset 2
python3 bluetooth_toolkit.py test-ble "Device Name" --preset 3
```

### Test Paired Device via Serial

```bash
# 1. Pair device in System Settings
# 2. Check if it created a serial port
python3 bluetooth_tester.py scan-serial

# 3. Test it
python3 bluetooth_toolkit.py test-serial "Device Name"
```

### Prepare for Web Development

```bash
# Test device to find working method
python3 bluetooth_toolkit.py test "Maxwell"

# If BLE works → use Web Bluetooth API
# If Serial works → use Web Serial API

# Get service UUIDs for Web Bluetooth
python3 bluetooth_toolkit.py analyze "Maxwell"
```

## Chrome Web API Implementation

### If BLE GATT Works

Use **Web Bluetooth API**:

```javascript
// Request device
const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'Maxwell' }],
  optionalServices: ['5052494d-2dab-0341-6972-6f6861424c45']
});

// Connect
const server = await device.gatt.connect();
const service = await server.getPrimaryService(
  '5052494d-2dab-0341-6972-6f6861424c45'
);

// Get characteristics
const txChar = await service.getCharacteristic(
  '43484152-2dab-3241-6972-6f6861424c45'
);
const rxChar = await service.getCharacteristic(
  '43484152-2dab-3141-6972-6f6861424c45'
);

// Send command
const command = new Uint8Array([0x05, 0x5A, 0x06, 0x00, 0x00, 0x0A, 0x01, 0xEF, 0xE8, 0x03]);
await txChar.writeValueWithoutResponse(command);
```

### If Serial Port Works

Use **Web Serial API**:

```javascript
// Request port
const port = await navigator.serial.requestPort({
  filters: [{ usbVendorId: 0x1234 }] // Optional
});

// Open port
await port.open({ baudRate: 115200 });

// Send command
const writer = port.writable.getWriter();
const command = new Uint8Array([0x05, 0x5A, 0x06, 0x00, 0x00, 0x0A, 0x01, 0xEF, 0xE8, 0x03]);
await writer.write(command);
writer.releaseLock();

// Read response
const reader = port.readable.getReader();
const { value, done } = await reader.read();
```

## Files

### Main Tools
- `bluetooth_toolkit.py` - Main CLI with test commands
- `bluetooth_tester.py` - Testing module (can be used standalone)
- `maxwell_airoha_ble_test.py` - Maxwell-specific BLE test
- `bluetooth_diagnostic.py` - Quick diagnostic

### Documentation
- `TESTING_GUIDE.md` - This file
- `MAXWELL_BLUETOOTH_FINDINGS.md` - Maxwell technical details
- `TESTING_SUMMARY.md` - Session summary
- `README_TOOLS.md` - Complete toolkit documentation

## Technical Details

### Airoha BLE Service

The Airoha protocol uses custom BLE service UUIDs that encode ASCII strings:

**Service UUID:** `5052494d-2dab-0341-6972-6f6861424c45`
- Decodes to: "PRIM-Airoha BLE"

**TX Characteristic:** `43484152-2dab-3241-6972-6f6861424c45`
- Decodes to: "CHAR-2AirohaBLE"
- Used for: Writing commands

**RX Characteristic:** `43484152-2dab-3141-6972-6f6861424c45`
- Decodes to: "CHAR-1AirohaBLE"
- Used for: Receiving notifications

### PEQ Response Format

193-byte packet structure:
```
Bytes 0-2:   Header (05 5B BD)
Bytes 3-4:   Length (00 00)
Byte  5:     Number of bands (0A = 10)
Byte  8:     EQ enable (00=off, 01=on)
Bytes 13+:   10 × 18-byte filter blocks

Filter block:
  Bytes 0-1:   Type/Status
  Bytes 2-5:   Frequency (Hz × 100, uint32 LE)
  Bytes 6-9:   Gain (dB × 100, int32 LE)
  Bytes 10-13: Bandwidth (Hz × 100, uint32 LE)
  Bytes 14-17: Q factor (× 100, uint32 LE)
```

## Next Steps

After successful testing:

1. **For Web Development**
   - Use Web Bluetooth API (BLE) or Web Serial API (Serial)
   - Reference UUIDs and protocol from test output
   - See `MAXWELL_BLUETOOTH_FINDINGS.md` for JavaScript examples

2. **For Protocol Extension**
   - Modify `bluetooth_tester.py` to add new commands
   - Extend `AirohaProtocol` class with new operations
   - Test with `--preset` flag for different configurations

3. **For Other Devices**
   - Use `analyze` to discover services
   - Compare with Airoha protocol
   - Adapt testing code for custom protocols

## Support

- Check existing documentation in `cli_tools/` directory
- Review captured protocol data in `.txt` files
- Analyze working examples: Maxwell, Moondrop Edge
