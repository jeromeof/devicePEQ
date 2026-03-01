# Edifier W830NB Protocol - Capture Findings
**Date:** 2026-01-25
**Device:** Edifier W830NB
**Connection:** Classic Bluetooth SPP (Serial Port Profile)
**Android App:** EDIFIER ConneX (com.edifier.edifierconnex)

---

## Summary

Successfully captured Edifier W830NB Bluetooth protocol using Frida on rooted Android device. Found significant differences from the previously documented protocol.

---

## Key Findings

### 1. Connection Type
- **Protocol:** Classic Bluetooth SPP (Serial Port Profile)
- **NOT BLE GATT** as initially assumed
- Device address: `08:F0:B6:B6:6F:24`
- Device name: `EDIFIER W830NB`

### 2. Protocol Headers (DIFFERENT FROM DOCS!)

**Documented (INCORRECT for W830NB):**
- TX (to device): 0xBB
- RX (from device): 0xCC

**Actual (VERIFIED):**
- TX (to device): **0xAA** (170)
- RX (from device): **0xBB** (187)

### 3. Packet Structure (V2 Format)

```
[Header] [AppCode] [Command] [Len_High] [Len_Low] [Payload...] [CRC]
  1 byte   1 byte    1 byte     1 byte     1 byte    Variable    1 byte
```

**Confirmed Fields:**
- AppCode: **0xEC** (236) - Matches documentation ✓
- CRC: 8-bit sum of all bytes (excluding CRC itself) & 0xFF

---

## Captured Packets

### Packet 1: Set EQ Preset
```
Direction: TX (to device)
Hex:       AA EC C4 00 01 A5 00
Bytes:     [170, 236, 196, 0, 1, 165, 0]

Breakdown:
  AA       - Header (TX to device)
  EC       - AppCode (236)
  C4       - Command: EQ_SET (196)
  00 01    - Length: 1 byte payload
  A5       - Payload: EQ preset 165 (0xA5)
  00       - CRC
```

**Function:** Setting EQ to preset #165

### Packet 2: Query Current EQ Preset
```
Direction: TX (to device)
Hex:       AA EC D5 00 00 6B
Bytes:     [170, 236, 213, 0, 0, 107]

Breakdown:
  AA       - Header (TX)
  EC       - AppCode (236)
  D5       - Command: EQ_QUERY (213)
  00 00    - Length: 0 bytes (query command)
  6B       - CRC
```

**Function:** Asking device for current EQ preset

### Packet 3: EQ Query Response
```
Direction: RX (from device)
Hex:       BB EC D5 00 01 A5 22
Bytes:     [187, 236, 213, 0, 1, 165, 34]

Breakdown:
  BB       - Header (RX from device)
  EC       - AppCode (236)
  D5       - Command: EQ_QUERY response (213)
  00 01    - Length: 1 byte payload
  A5       - Payload: Current EQ preset = 165 (0xA5)
  22       - CRC
```

**Function:** Device confirms EQ preset is #165

---

## Verified Commands

| Command Name | Code (Hex) | Code (Dec) | Verified | Notes |
|--------------|------------|------------|----------|-------|
| EQ_SET       | 0xC4       | 196        | ✅ YES   | Set EQ preset |
| EQ_QUERY     | 0xD5       | 213        | ✅ YES   | Get current EQ preset |
| BATTERY      | 0xD0       | 208        | ⏳ Not yet | Need to capture |
| VOLUME_GET   | 0x66       | 102        | ⏳ Not yet | Need to capture |
| VOLUME_SET   | 0x67       | 103        | ⏳ Not yet | Need to capture |
| CUSTOM_EQ_GET | 0x43      | 67         | ⏳ Not yet | **CRITICAL** - Need to capture |
| CUSTOM_EQ_SET_BAND | 0x44 | 68         | ⏳ Not yet | **CRITICAL** - Need to capture |
| CUSTOM_EQ_SET_FULL | 0x46 | 70         | ⏳ Not yet | **CRITICAL** - Need to capture |
| ANC_SET      | 0xC1       | 193        | ⏳ Not yet | Need to capture |
| ANC_QUERY    | 0xCC       | 204        | ⏳ Not yet | Need to capture |

---

## Critical Corrections to Documentation

### EDIFIER_PROTOCOL_DOCUMENTATION.md needs updating:

1. **Headers:**
   ```diff
   - TX Header: 0xBB (187)
   + TX Header: 0xAA (170)

   - RX Header: 0xCC (204)
   + RX Header: 0xBB (187)
   ```

2. **Connection Method:**
   ```diff
   - Primary: BLE GATT
   + Primary: Classic Bluetooth SPP

   - Secondary: SPP
   + Secondary: BLE GATT (may also be supported)
   ```

3. **Header Values Table:**
   ```diff
   | Byte Index | Field | Example |
   - | 0 | Header | 0xBB (send) / 0xCC (receive) |
   + | 0 | Header | 0xAA (send) / 0xBB (receive) |
   ```

---

## Next Steps

### High Priority: Capture These Packets

1. **Custom EQ Get (0x43)** - Most important
   - Should return 60 bytes (10 bands × 6 bytes)
   - Action: Open Custom EQ page in app

2. **Custom EQ Set Band (0x44)** - Most important
   - 6-byte payload: [Band][Filter][Freq_H][Freq_L][Gain][Q]
   - Action: Modify individual EQ bands

3. **Volume Commands (0x66/0x67)**
   - Action: Change volume slider

4. **Battery Query (0xD0)**
   - Action: View battery status

### Medium Priority

5. **ANC Commands (0xC1/0xCC)**
   - Action: Toggle ANC modes

6. **Full EQ Profile (0x46)**
   - Action: Save custom EQ profile

---

## Tools Used

1. **Frida 16.7.19** - Dynamic instrumentation
2. **Android Device:** Redmi Note 5 (rooted)
3. **Frida Script:** `test_edifier_simple.js`
   - Hooked: `OutputStream.write()` for TX
   - Hooked: `InputStream.read()` for RX

---

## Recommendations

### For Protocol Implementation:

1. Use **0xAA** for TX header (not 0xBB)
2. Expect **0xBB** for RX header (not 0xCC)
3. Use **Classic Bluetooth SPP** as primary connection method
4. AppCode **0xEC** is confirmed
5. CRC calculation is correct: `sum(all_bytes_except_crc) & 0xFF`

### For Further Analysis:

1. Capture full Custom EQ read/write operations
2. Verify 6-byte band format: `[Band][Filter][Freq_H][Freq_L][Gain][Q]`
3. Confirm gain encoding: 0-12 scale (6 = 0dB)
4. Test frequency range limits
5. Verify Q value encoding

---

## Example Code Updates

### JavaScript - Updated buildCommand()
```javascript
buildCommand(commandIndex, payload = []) {
    const HEADER_SEND = 0xAA;  // ← Changed from 0xBB
    const APP_CODE = 0xEC;

    const payloadLength = payload.length;
    const lengthHigh = (payloadLength >> 8) & 0xFF;
    const lengthLow = payloadLength & 0xFF;

    const packet = [
        HEADER_SEND,    // 0xAA
        APP_CODE,       // 0xEC
        commandIndex,
        lengthHigh,
        lengthLow,
        ...payload
    ];

    const crc = this.calculateCRC(packet);
    packet.push(crc);

    return new Uint8Array(packet);
}
```

### JavaScript - Updated parseResponse()
```javascript
parseResponse(packet) {
    const HEADER_RECEIVE = 0xBB;  // ← Changed from 0xCC

    const header = packet[0];
    const valid = header === HEADER_RECEIVE;

    // ... rest of parsing
}
```

---

## Additional Notes

- The W830NB may support both SPP and BLE GATT, but the Android app preferentially uses SPP
- Alternative header 0xAA is now the primary TX header
- The protocol version is still V2 (6-byte header format)
- CRC validation should be enforced for reliability

---

## Files Generated

1. `test_edifier_simple.js` - Simple Frida hook for SPP capture
2. `edifier_test_output.txt` - Raw capture output
3. `EDIFIER_W830NB_FINDINGS.md` - This document

---

**Status:** Initial protocol verification complete ✅
**Next:** Capture Custom EQ packets for full PEQ analysis
