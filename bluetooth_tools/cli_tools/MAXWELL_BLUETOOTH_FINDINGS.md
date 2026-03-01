# Audeze Maxwell Bluetooth Communication Findings

## Summary

✅ **BLE GATT Communication: WORKING**
✅ **Chrome Web Bluetooth API: COMPATIBLE**
❓ **Classic Bluetooth SPP: Not tested (Maxwell not paired via SPP)**

## Successful BLE GATT Configuration

### Airoha BLE Service
The Maxwell uses a custom Airoha BLE service for PEQ control:

**Service UUID:**
`5052494d-2dab-0341-6972-6f6861424c45`
*(Translates to ASCII: "PRIM-Airoha BLE")*

**TX Characteristic (Write):**
`43484152-2dab-3241-6972-6f6861424c45`
*(Translates to: "CHAR-2AirohaBLE")*
Properties: `write-without-response`, `write`

**RX Characteristic (Notify):**
`43484152-2dab-3141-6972-6f6861424c45`
*(Translates to: "CHAR-1AirohaBLE")*
Properties: `notify`

## Communication Protocol

### 1. Connection Sequence
```python
1. Scan for device name containing "Maxwell"
2. Connect to device via BLE
3. Discover services
4. Find Airoha service: 5052494d-2dab-0341-6972-6f6861424c45
5. Enable notifications on RX char: 43484152-2dab-3141-6972-6f6861424c45
6. Write commands to TX char: 43484152-2dab-3241-6972-6f6861424c45
```

### 2. Command Format (Same as Serial)
Commands use the standard Airoha protocol format:

**Read Preset Command:**
```
Header:  05 5A 06
Payload: 00 00 0A [preset] EF E8 03
```

**Example - Read Preset 1:**
```
05 5A 06 00 00 0A 01 EF E8 03
```

Presets:
- `00` = Immersive
- `01` = Audeze/Flat
- `02` = Custom 1
- `03` = Custom 2

### 3. Response Format
The Maxwell responds with a standard 193-byte Airoha PEQ packet:

```
Header:  05 5B BD 00 00
Payload: [188 bytes of PEQ data]
```

**Response Structure:**
- Byte 5: Number of bands (0x0A = 10)
- Byte 8: EQ enable flag (0x00=disabled, 0x01=enabled)
- Bytes 13+: 10 filter blocks × 18 bytes each

**Filter Block (18 bytes):**
- Bytes 0-1: Type/Status
- Bytes 2-5: Frequency (uint32 LE, units: 0.01 Hz)
- Bytes 6-9: Gain (int32 LE signed, units: 0.01 dB)
- Bytes 10-13: Bandwidth (uint32 LE, units: 0.01 Hz)
- Bytes 14-17: Q Factor (uint32 LE, units: 0.01)

## Test Results

### Preset 1 (Audeze/Flat) - Tested Successfully

```
Bands: 10
EQ Enabled: No

Band   Freq(Hz)     Gain(dB)     Q
--------------------------------------------------
0      32.0         +0.00        2.00
1      64.0         +0.00        2.00
2      125.0        +0.00        2.00
3      250.0        +0.00        2.00
4      500.0        +0.00        2.00
5      1000.0       +0.00        2.00
6      2000.0       +0.00        2.00
7      4000.0       +0.00        2.00
8      8000.0       +0.00        2.00
9      16000.0      +0.00        2.00
```

All bands at 0dB (flat response), Q=2.0 for all filters.

## Chrome Web Bluetooth API Implementation

### JavaScript Example

```javascript
// Request device
const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'Maxwell' }],
  optionalServices: ['5052494d-2dab-0341-6972-6f6861424c45']
});

// Connect to GATT server
const server = await device.gatt.connect();

// Get Airoha service
const service = await server.getPrimaryService(
  '5052494d-2dab-0341-6972-6f6861424c45'
);

// Get TX (write) and RX (notify) characteristics
const txChar = await service.getCharacteristic(
  '43484152-2dab-3241-6972-6f6861424c45'
);
const rxChar = await service.getCharacteristic(
  '43484152-2dab-3141-6972-6f6861424c45'
);

// Enable notifications
await rxChar.startNotifications();
rxChar.addEventListener('characteristicvaluechanged', (event) => {
  const value = event.target.value; // DataView
  console.log('Received:', new Uint8Array(value.buffer));
});

// Send command to read preset 1
const command = new Uint8Array([0x05, 0x5A, 0x06, 0x00, 0x00, 0x0A, 0x01, 0xEF, 0xE8, 0x03]);
await txChar.writeValueWithoutResponse(command);
```

## Communication Methods Comparison

| Method | Status | Chrome API | Notes |
|--------|--------|------------|-------|
| BLE GATT | ✅ Working | Web Bluetooth API | Tested successfully |
| Serial Port (SPP) | ❓ Not tested | Web Serial API | Maxwell not paired via SPP |

## Python Implementation

Working test scripts:
- `maxwell_airoha_ble_test.py` - Full BLE GATT test
- `bluetooth_diagnostic.py` - Device discovery
- `audeze_maxwell_tester.py` - Multi-protocol tester

### Dependencies
```bash
pip install bleak pyserial
```

### Run BLE Test
```bash
python3 maxwell_airoha_ble_test.py
```

**Note:** Must run without sandbox on macOS for Bluetooth access:
```bash
# Use dangerouslyDisableSandbox in tool calls
```

## Other Services Discovered

The Maxwell exposes several BLE services:

### Device Information (0000180a)
- System ID: `55 44 33 22 11 88 77 66`
- Model: `AIROHA-DIS-EXAMPLE`
- Serial: `20180422`
- Firmware: `Version1.0`
- Hardware: `Version1.0`
- Manufacturer: `Airoha`

### Vendor Services
- `0000fe2c-...` - Alternate vendor service (disconnects on write, not used)
- `0000184e-...` - Unknown service
- `00001850-...` - Unknown service
- `00001844-...` - Unknown service
- `0000184d-...` - Unknown service
- `0000184f-...` - Unknown service
- `00001855-...` - Unknown service
- `00001854-...` - Unknown service

## Key Findings

1. **Airoha BLE Service is the Key**
   - The service UUID literally spells out "PRIM-Airoha BLE" in ASCII
   - This is the dedicated service for Airoha protocol commands
   - Other vendor services (0xFE2C) don't work for PEQ commands

2. **Protocol is Identical to Serial**
   - Same command format as documented for SPP
   - Same 193-byte response format
   - No special BLE-specific framing needed

3. **Write-Without-Response Works**
   - Commands can be sent using write-without-response
   - No need for write-with-response (faster)
   - Responses come via notifications

4. **Chrome Compatible**
   - Web Bluetooth API supports all required features
   - Can request device by name prefix
   - Can write without response
   - Can receive notifications
   - No special permissions needed (user grants via browser prompt)

## Next Steps

1. ✅ Create Chrome/web implementation
2. Test preset switching (commands 0x00, 0x02, 0x03)
3. Test EQ modification commands (if available)
4. Test Classic Bluetooth SPP (if Maxwell can be paired that way)
5. Compare BLE vs SPP performance/latency

## Files

- `maxwell_airoha_ble_test.py` - Working BLE test
- `audeze_maxwell_tester.py` - Multi-protocol tester
- `bluetooth_diagnostic.py` - Diagnostic tool
- `maxwell_peq_reader.py` - Serial port version (for comparison)
- `MAXWELL_BLUETOOTH_FINDINGS.md` - This document

## References

- `airoha_peq_format.md` - Airoha PEQ packet format specification
- `AIROHA_EQ_PROTOCOL_FINDINGS.md` - Airoha protocol analysis
- Web Bluetooth API: https://developer.chrome.com/docs/capabilities/bluetooth
