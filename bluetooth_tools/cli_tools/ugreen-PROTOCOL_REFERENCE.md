# UGreen Max5C Bluetooth Protocol Reference

## Quick Start

### Using the Web Interface
1. Open `max5c_eq_control.html` in **Chrome/Edge browser** (Web Bluetooth required)
2. Click "Connect to Max5C" and select your paired headphones
3. Click "Read EQ" to load current settings
4. Adjust sliders or apply presets
5. Click "Write EQ" to save changes to headphones

### Browser Requirements
- **Chrome/Edge**: Version 56+ (Web Bluetooth enabled by default)
- **Opera**: Version 43+
- **Firefox**: Not supported (no Web Bluetooth)
- **Safari**: Not supported

---

## Dynamic EQ Detailed Explanation

### What is Dynamic EQ?

**Static EQ** (Traditional):
- Always 10 bands
- Fixed frequencies: 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz
- Mode byte: 0-127

**Dynamic EQ** (Advanced):
- Variable band count (not limited to 10)
- Custom frequencies
- Mode byte: 128-255 (bit 7 set)

### Detection Method

```javascript
const mode = attrData[0];
const isDynamic = (mode & 0x80) === 0x80;  // Check if bit 7 is set
const actualMode = mode & 0x7F;            // Clear bit 7 to get real mode
```

### Data Format Comparison

**Static EQ Response:**
```
Byte 0: Mode (0-127)
Byte 1-10: 10 EQ values (signed bytes: -12 to +12)

Example: [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
         Mode=2, All bands at 0dB
```

**Dynamic EQ Response:**
```
Byte 0: Mode | 0x80 (128-255)
Byte 1: Length (N)
Bytes 2-(N+1): N EQ values

Example: [0x82, 0x05, 0x03, 0x02, 0x00, 0xFE, 0xFC]
         Mode=2, 5 bands: [+3, +2, 0, -2, -4] dB
```

---

## RCSP Protocol Deep Dive

### Packet Structure

```
┌─────────────┬──────────┬─────────────┬──────────┐
│ START (3B)  │ HEADER   │ PARAM DATA  │ END (1B) │
│ FE DC BA    │ (4-5B)   │ (variable)  │ EF       │
└─────────────┴──────────┴─────────────┴──────────┘
```

### Header Format

**For Commands (Type=1):**
```
Byte 0: Flags
  Bit 7: Type (1 = Command)
  Bit 6: HasResponse (1 = Yes)
  Bits 0-5: Unused
Byte 1: OpCode (Command ID)
Bytes 2-3: ParamLen (16-bit big-endian)
```

**For Responses (Type=0):**
```
Byte 0: Flags
  Bit 7: Type (0 = Response)
  Bit 6: HasResponse
  Bits 0-5: Unused
Byte 1: OpCode (Original command ID)
Bytes 2-3: ParamLen (16-bit big-endian)
Byte 4: Status (0 = Success)
```

### Parameter Data

**Read EQ Command:**
```
Byte 0: Sequence Number (1-255, auto-increment)
Byte 1: Function (0xFF = Public)
Bytes 2-5: Mask (0x00000010 for EQ)
```

**Write EQ Command:**
```
Byte 0: Sequence Number
Byte 1: Function (0xFF = Public)
Byte 2: Attribute Length
Byte 3: Attribute Type (0x04 = EQ)
Bytes 4+: EQ Data (mode + values)
```

---

## Complete Packet Examples

### Reading EQ

**Request:**
```
FE DC BA          // Start prefix
C0                // Flags: Command + HasResponse
07                // OpCode: CMD_GET_SYS_INFO
00 05             // ParamLen: 5 bytes
01                // Sequence #1
FF                // Function: Public
00 00 00 10       // Mask: 0x10 (EQ bit)
EF                // End flag

Hex: FE DC BA C0 07 00 05 01 FF 00 00 00 10 EF
```

**Response (Static EQ):**
```
FE DC BA          // Start prefix
40                // Flags: Response + HasResponse
07                // OpCode: CMD_GET_SYS_INFO
00 0D             // ParamLen: 13 bytes
00                // Status: Success
01                // Sequence #1
0C                // Attr length: 12 bytes
04                // Attr type: EQ
02                // Mode: 2
00 00 00 00       // Bands 1-4: 0dB
00 00 00 00       // Bands 5-8: 0dB
00 00             // Bands 9-10: 0dB
EF                // End flag

Hex: FE DC BA 40 07 00 0D 00 01 0C 04 02 00 00 00 00 00 00 00 00 00 00 EF
```

**Response (Dynamic EQ):**
```
FE DC BA          // Start prefix
40                // Flags: Response + HasResponse
07                // OpCode: CMD_GET_SYS_INFO
00 09             // ParamLen: 9 bytes
00                // Status: Success
01                // Sequence #1
08                // Attr length: 8 bytes
04                // Attr type: EQ
82                // Mode: 2 | 0x80 (Dynamic)
05                // Length: 5 bands
03 02 00 FE FC    // Values: [+3, +2, 0, -2, -4]
EF                // End flag

Hex: FE DC BA 40 07 00 09 00 01 08 04 82 05 03 02 00 FE FC EF
```

### Writing EQ

**Request (Static):**
```
FE DC BA          // Start prefix
C0                // Flags: Command + HasResponse
08                // OpCode: CMD_SET_SYS_INFO
00 0E             // ParamLen: 14 bytes
02                // Sequence #2
FF                // Function: Public
0C                // Attr length: 12 bytes
04                // Attr type: EQ
02                // Mode: 2
03 02 01 00       // Bands 1-4: [+3, +2, +1, 0]
FF FE FD FC       // Bands 5-8: [-1, -2, -3, -4]
FB FA             // Bands 9-10: [-5, -6]
EF                // End flag

Hex: FE DC BA C0 08 00 0E 02 FF 0C 04 02 03 02 01 00 FF FE FD FC FB FA EF
```

**Request (Dynamic):**
```
FE DC BA          // Start prefix
C0                // Flags: Command + HasResponse
08                // OpCode: CMD_SET_SYS_INFO
00 0A             // ParamLen: 10 bytes
03                // Sequence #3
FF                // Function: Public
08                // Attr length: 8 bytes
04                // Attr type: EQ
82                // Mode: 2 | 0x80 (Dynamic)
05                // Length: 5 bands
06 04 00 FC FA    // Values: [+6, +4, 0, -4, -6]
EF                // End flag

Hex: FE DC BA C0 08 00 0A 03 FF 08 04 82 05 06 04 00 FC FA EF
```

**Response:**
```
FE DC BA          // Start prefix
40                // Flags: Response
08                // OpCode: CMD_SET_SYS_INFO
00 01             // ParamLen: 1 byte
00                // Status: Success
03                // Sequence #3
EF                // End flag

Hex: FE DC BA 40 08 00 01 00 03 EF
```

---

## JavaScript Implementation Notes

### Sequence Number Management

```javascript
class Max5CController {
    constructor() {
        this.sequenceNumber = 1;
    }

    getNextSeq() {
        const seq = this.sequenceNumber++;
        if (this.sequenceNumber > 255) {
            this.sequenceNumber = 1;
        }
        return seq;
    }
}
```

### Signed Byte Conversion

```javascript
// EQ values are signed bytes (-12 to +12)

// To send (JavaScript number -> signed byte):
const signedToByte = (value) => value & 0xFF;

// To receive (signed byte -> JavaScript number):
const byteToSigned = (byte) => byte > 127 ? byte - 256 : byte;

// Example:
signedToByte(-4)   // Returns: 252 (0xFC)
byteToSigned(252)  // Returns: -4
```

### Response Parsing

```javascript
function parseEQResponse(data) {
    // Find attribute type 0x04 (EQ)
    let idx = 0;
    while (idx < data.length - 2) {
        const attrLen = data[idx];
        const attrType = data[idx + 1];

        if (attrType === 0x04) {
            const attrData = data.slice(idx + 2, idx + attrLen + 1);
            const mode = attrData[0];
            const isDynamic = (mode & 0x80) === 0x80;

            if (isDynamic) {
                const length = attrData[1];
                const values = attrData.slice(2, 2 + length);
                return { mode: mode & 0x7F, dynamic: true, values };
            } else {
                const values = attrData.slice(1, 11);
                return { mode, dynamic: false, values };
            }
        }

        idx += attrLen + 1;
    }
    return null;
}
```

---

## Common Issues & Solutions

### Issue 1: No Device Found
**Problem:** Browser doesn't find Max5C during scan
**Solution:**
- Ensure headphones are in pairing mode
- Headphones must NOT be connected to phone/other device
- Try resetting headphones (power off/on)

### Issue 2: Connection Drops
**Problem:** Connection randomly disconnects
**Solution:**
- Check battery level (low battery causes instability)
- Stay within 10m range
- Close other apps using Bluetooth

### Issue 3: EQ Not Updating
**Problem:** Write EQ succeeds but no audible change
**Solution:**
- Verify with Read EQ that values were written
- Some presets override custom EQ - check mode value
- Try writing with mode=0 (custom mode)

### Issue 4: Invalid Response
**Problem:** Packet parsing fails
**Solution:**
- Check for complete packet (START prefix + END flag)
- Verify checksum if implemented
- Wait longer for response (increase timeout)

### Issue 5: Web Bluetooth Not Available
**Problem:** `navigator.bluetooth` is undefined
**Solution:**
- Use Chrome/Edge/Opera (not Firefox/Safari)
- Enable in chrome://flags if disabled
- Requires HTTPS (or localhost for testing)

---

## Advanced Features

### Custom EQ Presets

```javascript
// Add your own presets to the EQ_PRESETS object
const EQ_PRESETS = {
    // ... existing presets ...

    // Heavy bass (club sound)
    club: [12, 10, 8, 6, 4, 0, -2, -2, -2, -2],

    // Classical (emphasize mids and highs)
    classical: [-2, -2, 0, 2, 4, 5, 4, 3, 2, 1],

    // Gaming (footsteps + dialogue)
    gaming: [2, 3, 1, 0, 2, 4, 5, 3, 2, 1],

    // Podcast (vocal clarity)
    podcast: [-3, -2, 0, 3, 6, 6, 4, 0, -2, -3]
};
```

### Monitoring All Attributes

```javascript
// Read multiple attributes at once
const MASK_ALL = 0x0000FFFF;  // All attributes

// Specific attribute masks:
const MASK_BATTERY = 0x00000001;  // Bit 0
const MASK_VOLUME = 0x00000002;   // Bit 1
const MASK_EQ = 0x00000010;       // Bit 4

// Combine masks:
const MASK_EQ_AND_VOL = 0x00000012;  // Bits 1 and 4
```

### Real-time EQ Updates

```javascript
// Debounce slider changes for smooth updates
let updateTimer = null;

slider.addEventListener('input', (e) => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
        controller.writeEQ();
    }, 300);  // Wait 300ms after last change
});
```

---

## File Reference

### Key Source Files

| File | Purpose | Key Lines |
|------|---------|-----------|
| `max5c_eq_control.html` | Complete web interface | All |
| `BluetoothConstant.java` | UUIDs and constants | 50-56 |
| `CommandBuilder.java` | Command construction | 303-313, 790-804 |
| `RcspDataHandler.java` | Response parsing | 367-401 |
| `BasePacketParse.java` | Packet framing | 22-164 |
| `RcspConstant.java` | Protocol constants | 17, 22, 75-77 |
| `EqInfo.java` | EQ data structure | 1-74 |

---

## Testing Checklist

- [ ] Device appears in Bluetooth selection dialog
- [ ] Connection succeeds and shows "Connected" status
- [ ] Read EQ returns valid data
- [ ] EQ bands display with correct frequencies
- [ ] Sliders move and show updated values
- [ ] Presets apply correctly
- [ ] Write EQ succeeds without errors
- [ ] Audio changes reflect written EQ settings
- [ ] Dynamic EQ detection works (if supported)
- [ ] Disconnect and reconnect work properly
- [ ] Log shows proper packet hex dumps

---

## Protocol Version Info

- **RCSP Protocol**: JieLi proprietary (used across JL SDK devices)
- **BLE Version**: 4.2+
- **MTU**: 20 bytes (min) to 509 bytes (max)
- **Sequence Numbers**: 1-255 (wraps around)
- **Max Packet Size**: ~530 bytes (including framing)

---

## Additional Resources

- **Chrome Web Bluetooth API**: https://developer.chrome.com/articles/bluetooth/
- **Web Bluetooth Samples**: https://googlechrome.github.io/samples/web-bluetooth/
- **Bluetooth GATT Specs**: https://www.bluetooth.com/specifications/gatt/

---

## License & Disclaimer

This documentation is for educational and interoperability purposes. The RCSP protocol is proprietary to JieLi Technology. Use responsibly and only with devices you own.

**Created:** 2025-11-10
**Protocol Version:** Reverse-engineered from UGreen Connect Android app
**Device:** UGreen Max5C Bluetooth Headphones
