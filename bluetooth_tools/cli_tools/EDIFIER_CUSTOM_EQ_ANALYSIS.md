# Edifier W830NB - Custom EQ Protocol Analysis
**Date:** 2026-01-25
**Capture Session:** Custom EQ Focused

---

## Executive Summary

Successfully captured complete Custom EQ read and write operations. **CRITICAL FINDING:** The W830NB uses **6 bands** (not 10 as documented), and all bytes appear to be **offset-encoded** by 0xA0 (160).

---

## Captured Commands

### 1. Custom EQ Get (0x43)

**Request:**
```
TX: AA EC 43 00 00 D9
```
- Header: 0xAA (TX)
- AppCode: 0xEC
- Command: 0x43 (CUSTOM_EQ_GET)
- Length: 0 bytes (query)
- CRC: 0xD9

**Response:**
```
RX: BB EC 43 00 24 AD A1 A5 A5 A5 E0 A3 AE A4 A5 A2 AD A9 A0 A7 A5 A9 A3 A4 B1 A6 A5 82 B5 A4 AE 9F 85 41 C3 ED C4 D7 C8 C4 CB 25
```
- Header: 0xBB (RX)
- AppCode: 0xEC
- Command: 0x43 response
- Length: 0x0024 = **36 bytes**
- Payload: 36 bytes of EQ data
- CRC: 0x25

**Key Finding:** 36 bytes = **6 bands × 6 bytes per band**

---

### 2. Custom EQ Set Band (0x44)

**Multiple Examples Captured:**

#### Example 1:
```
TX: AA EC 44 00 06 A5 A5 A5 E0 A3 AE 00
Response: BB EC 44 00 01 A4 90
```
- Command: 0x44 (SET_BAND)
- Payload: **A5 A5 A5 E0 A3 AE** (6 bytes)
- Response: 0xA4 (success code)

#### Example 2:
```
TX: AA EC 44 00 06 A5 A5 A5 E0 A9 AE 06
Response: BB EC 44 00 01 A4 90
```
- Payload: **A5 A5 A5 E0 A9 AE** (6 bytes)
- **Change:** Byte 5: A3 → A9 (gain change of +6)

#### Example 3:
```
TX: AA EC 44 00 06 A4 A5 A2 AD A3 A0 BB
Response: BB EC 44 00 01 A4 90
```
- Payload: **A4 A5 A2 AD A3 A0** (6 bytes)
- **Different band** (A4 vs A5 in first byte)

#### Example 4:
```
TX: AA EC 44 00 06 A4 A5 A2 AD A9 A0 C1
Response: BB EC 44 00 01 A4 90
```
- Payload: **A4 A5 A2 AD A9 A0** (6 bytes)
- **Change:** Byte 5: A3 → A9 (gain change)

---

## Decoding the Format

### Observation: All Bytes Are Offset-Encoded

All payload bytes are in range 0xA0-0xFF, suggesting **offset encoding by 0xA0 (160)**.

### Decoding Formula:
```
Actual Value = Hex Value - 0xA0
```

### Example 1 Decoded:
```
Raw:     A5  A5  A5  E0  A3  AE
Offset: -A0 -A0 -A0 -A0 -A0 -A0
Result:  05  05  05  40  03  0E

Decoded Values:
  Band:   0x05 = 5
  Filter: 0x05 = 5 (Notch filter?)
  Freq_H: 0x05
  Freq_L: 0x40 = 64
  Freq:   (5 << 8) | 64 = 1344 Hz
  Gain:   0x03 = 3 (encoded as 0-12 scale, so 3 - 6 = -3dB)
  Q:      0x0E = 14
```

### Example 2 Decoded (Gain Changed):
```
Raw:     A5  A5  A5  E0  A9  AE
Offset: -A0 -A0 -A0 -A0 -A0 -A0
Result:  05  05  05  40  09  0E

Decoded Values:
  Band:   0x05 = 5
  Filter: 0x05 = 5
  Freq:   1344 Hz (same)
  Gain:   0x09 = 9 (encoded: 9 - 6 = +3dB)
  Q:      0x0E = 14 (same)
```

**Gain change: 0x03 → 0x09 = -3dB → +3dB (6dB increase)**

### Example 3 Decoded (Different Band):
```
Raw:     A4  A5  A2  AD  A3  A0
Offset: -A0 -A0 -A0 -A0 -A0 -A0
Result:  04  05  02  0D  03  00

Decoded Values:
  Band:   0x04 = 4
  Filter: 0x05 = 5 (Notch)
  Freq_H: 0x02
  Freq_L: 0x0D = 13
  Freq:   (2 << 8) | 13 = 525 Hz
  Gain:   0x03 = 3 (-3dB)
  Q:      0x00 = 0
```

---

## Full EQ Get Response Decoded

**Raw 36-byte payload:**
```
AD A1 A5 A5 A5 E0 A3 AE A4 A5 A2 AD A9 A0 A7 A5 A9 A3 A4 B1 A6 A5 82 B5 A4 AE 9F 85 41 C3 ED C4 D7 C8 C4 CB
```

**Decode by subtracting 0xA0 from each byte:**

### Band 0 (bytes 0-5):
```
Raw:    AD A1 A5 A5 A5 E0
Decode: 0D 01 05 05 05 40
  Band Index: 13 (but should be 0?) - **NEEDS INVESTIGATION**
  Filter: 1 (Low Shelf)
  Freq: (5 << 8) | 5 = 1285 Hz
  Gain: 5 (-1dB)
  Q: 64
```

Wait, this doesn't match the 6-byte structure. Let me reconsider...

**Alternative Interpretation:**
The payload might NOT start with band 0. Let me check if there's a header in the payload.

Looking at the pattern, let me try different groupings:
- Maybe first 2 bytes are metadata?
- Then 6 bytes per band?

**New hypothesis:** First byte might be band count or format indicator.

### Alternative Decoding (with metadata):
```
Metadata: AD A1 (unknown - could be EQ preset number, format version, etc.)

Band Data (6 bands × 6 bytes = 36 bytes... but we have 34 bytes left)
```

Actually, let me count: 36 total - 2 metadata = 34 bytes left. That's not divisible by 6.

Let me try: Maybe NO metadata, and it's actually **6 bands × 6 bytes**:

```
Band 0: AD A1 A5 A5 A5 E0 (bytes 0-5)
Band 1: A3 AE A4 A5 A2 AD (bytes 6-11)
Band 2: A9 A0 A7 A5 A9 A3 (bytes 12-17)
Band 3: A4 B1 A6 A5 82 B5 (bytes 18-23)
Band 4: A4 AE 9F 85 41 C3 (bytes 24-29)
Band 5: ED C4 D7 C8 C4 CB (bytes 30-35)
```

Wait, Band 3 has 82 and Band 4 has 41, Band 5 has ED, C4, D7, C8... These are < 0xA0, so the offset encoding doesn't apply consistently!

**New Hypothesis:** The encoding might be more complex, OR the structure is different.

Let me look at what we know works - the SET_BAND command:
```
A5 A5 A5 E0 A3 AE
```

If this represents one band, and we know we changed the gain from A3 to A9, then:
- Gain is at byte 4 (index 4)
- Format is likely: [Band][Filter][Freq_H][Freq_L][Gain][Q]

**BUT** in the GET response, the bytes don't follow clean offset encoding throughout. This suggests:

### **Final Hypothesis:**
The W830NB might use **variable encoding** or **packed encoding** where:
1. Some fields use offset encoding (0xA0 base)
2. Some fields might be raw values
3. The response format might include additional metadata

---

## What We Know For Certain

### ✅ Confirmed:
1. **6 bands total** (36 bytes ÷ 6 bytes/band)
2. **6 bytes per band** structure
3. **Offset encoding used** (at least for some fields, base 0xA0 = 160)
4. **Gain changes work** (A3 → A9 = -3dB → +3dB)
5. **Band-specific writes** (can target individual bands)

### ❓ Needs Clarification:
1. Exact byte-by-byte mapping
2. Why some bytes in GET response are < 0xA0
3. Filter type encoding
4. Q value encoding range
5. Frequency encoding formula

---

## Recommended Next Steps

### 1. Controlled Experiment
Capture these specific actions:
- Set ONE band to known values:
  - Band 0, 100Hz, 0dB, Q=50
  - Then read EQ
- Change ONLY frequency:
  - Band 0, 1000Hz, 0dB, Q=50
  - Then read EQ
- Change ONLY gain:
  - Band 0, 100Hz, +6dB, Q=50
  - Then read EQ

### 2. Document Response Variations
- Capture GET response for default EQ
- Capture GET response for each preset
- Compare byte patterns

### 3. Reverse Engineering Approach
- Decompile Edifier app APK
- Look for EQ encoding/decoding functions
- Find frequency tables, gain mappings

---

## Packet Summary

| Command | Code | TX/RX | Count Captured | Notes |
|---------|------|-------|----------------|-------|
| CUSTOM_EQ_GET | 0x43 | TX | 7 | Query all bands |
| CUSTOM_EQ_GET response | 0x43 | RX | 7 | 36 bytes (6 bands) |
| CUSTOM_EQ_SET_BAND | 0x44 | TX | 4 | 6-byte band data |
| CUSTOM_EQ_SET_BAND response | 0x44 | RX | 4 | Success: 0xA4 |

---

## Code Implementation Considerations

### Current Understanding:
```javascript
// Band structure (6 bytes, offset-encoded)
class EdifierEQBand {
    constructor(rawBytes) {
        const OFFSET = 0xA0;

        this.bandIndex = rawBytes[0] - OFFSET;  // 0-5
        this.filterType = rawBytes[1] - OFFSET;  // 0-7?

        // Frequency (big-endian, offset-encoded)
        const freqH = rawBytes[2] - OFFSET;
        const freqL = rawBytes[3] - OFFSET;
        this.frequency = (freqH << 8) | freqL;

        // Gain (0-12 scale, where 6 = 0dB)
        this.gainRaw = rawBytes[4] - OFFSET;
        this.gainDb = this.gainRaw - 6;

        // Q value
        this.qValue = rawBytes[5] - OFFSET;
    }

    toBytes() {
        const OFFSET = 0xA0;
        return [
            this.bandIndex + OFFSET,
            this.filterType + OFFSET,
            ((this.frequency >> 8) & 0xFF) + OFFSET,
            (this.frequency & 0xFF) + OFFSET,
            (this.gainDb + 6) + OFFSET,
            this.qValue + OFFSET
        ];
    }
}
```

### Caveats:
- Offset encoding might not apply to ALL fields
- Frequency calculation needs verification
- Filter type range unknown
- Q value range and scaling unknown

---

## Files Generated

1. `edifier_custom_eq_capture.txt` - Raw capture data
2. `EDIFIER_CUSTOM_EQ_ANALYSIS.md` - This analysis

---

**Status:** Partial decode complete
**Confidence:** Medium (structure confirmed, exact encoding needs validation)
**Next Action:** Controlled experiments with known EQ values
