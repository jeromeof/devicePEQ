# Quick Test Reference

## Installation

```bash
pip install bleak         # For BLE testing
pip install pyserial      # For Serial Port testing (optional)
```

## Basic Commands

### Test Everything
```bash
# Test both BLE and Serial Port
python3 bluetooth_toolkit.py test "Device Name"
```

### Test Specific Method
```bash
# BLE GATT only (Web Bluetooth API)
python3 bluetooth_toolkit.py test-ble "Device Name"

# Serial Port only (Web Serial API)
python3 bluetooth_toolkit.py test-serial "Device Name"
```

### Scan for Devices
```bash
# Scan BLE devices
python3 bluetooth_toolkit.py scan

# Or use tester directly
python3 bluetooth_tester.py scan-ble
python3 bluetooth_tester.py scan-serial
```

## Examples

### Audeze Maxwell
```bash
python3 bluetooth_toolkit.py test "Maxwell"
python3 bluetooth_toolkit.py test-ble "Maxwell" --preset 0
python3 bluetooth_toolkit.py test-ble "Maxwell" --preset 1
```

### Moondrop Edge
```bash
python3 bluetooth_toolkit.py test "Moondrop"
python3 bluetooth_toolkit.py test-serial "EDGE"
```

### FiiO Devices
```bash
python3 bluetooth_toolkit.py test "FiiO"
python3 bluetooth_toolkit.py test "DX5II" --preset 2
```

## Output Interpretation

### ✅ BLE Works
```
BLE GATT    ✅ Works    Web Bluetooth API
```
**Use:** Chrome Web Bluetooth API (works on all platforms)

### ✅ Serial Works
```
Serial Port ✅ Works    Web Serial API
```
**Use:** Chrome Web Serial API (desktop only)

## Presets

```bash
--preset 0    # Preset 1
--preset 1    # Preset 2 (default, often "Flat")
--preset 2    # Custom preset 1
--preset 3    # Custom preset 2
```

## Quick Troubleshooting

**"No devices found"**
- Power on device
- Move closer
- Try other method (BLE vs Serial)

**"pyserial not available"**
```bash
pip install pyserial
```

**"bleak not available"**
```bash
pip install bleak
```

**"Airoha service not found"**
- Device may not use Airoha protocol
- Use `analyze` to see available services
- Device might not be supported

## Chrome Web APIs

### Web Bluetooth (if BLE works)
```javascript
const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'Maxwell' }],
  optionalServices: ['5052494d-2dab-0341-6972-6f6861424c45']
});
```

### Web Serial (if Serial works)
```javascript
const port = await navigator.serial.requestPort();
await port.open({ baudRate: 115200 });
```

## More Info

- `TESTING_GUIDE.md` - Complete testing guide
- `MAXWELL_BLUETOOTH_FINDINGS.md` - Technical details
- `TOOLKIT_UPDATES.md` - What's new
- `README_TOOLS.md` - Full toolkit documentation
