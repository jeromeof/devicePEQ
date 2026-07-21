# Edifier W830NB EQ Protocol - DECODED

## Protocol Summary

**Communication:** SPP (Serial Port Profile) over Bluetooth Classic
**Commands:** 0x43 (GET), 0x44 (SET_BAND)
**AppCode:** 0xEC (236)
**Headers:** 0xAA (TO device), 0xBB (FROM device)

---

## SET_BAND Command (0x44)

**Format:** `AA EC 44 00 06 [6-byte payload] [CRC]`

### Payload Structure (6 bytes):
```
Byte 0: Band Index (0xA5=Filter 0, 0xA4=Filter 1, 0xA7=Filter 2, 0xA6=Filter 3)
Byte 1: Unknown parameter (always 0xA5?)
Byte 2: Frequency encoding (byte 1)
Byte 3: Frequency encoding (byte 2)
Byte 4: Gain value
Byte 5: Terminator (always 0xAF)
```

### Gain Encoding (VERIFIED ✅)

**Formula:**
```
gain_byte = 0xA9 + (gain_dB × 4)
gain_dB = (gain_byte - 169) / 4.0
```

**Examples:**
- **0xA9 (169):** 0.0dB
- **0xAD (173):** +1.0dB ✅ VERIFIED
- **0xA5 (165):** -1.0dB ✅ VERIFIED
- **0xB5 (181):** +3.0dB
- **0x9D (157):** -3.0dB
- **0xC1 (193):** +6.0dB
- **0x91 (145):** -6.0dB

**Range:** -6.0dB to +6.0dB in 0.5dB increments (4 units per dB)

---

## GET_EQ Command (0x43)

**Request:** `AA EC 43 00 00 [CRC]` (empty payload - query command)

**Response:** `BB EC 43 00 24 [36-byte payload] [CRC]`

### Response Payload Structure (36 bytes):

```
Bytes 0-1:   Header (0xAD 0xA1) - unknown purpose
Bytes 2-7:   Filter 0 data (6 bytes)
Bytes 8-13:  Filter 1 data (6 bytes)
Bytes 14-19: Filter 2 data (6 bytes)
Bytes 20-25: Filter 3 data (6 bytes)
Bytes 26-35: Filters 4-5 data (10 bytes, different structure)
```

### Filter Data Structure (6 bytes per filter):
```
Byte 0: Band ID (0xA5, 0xA4, 0xA7, 0xA6)
Byte 1: Unknown (0xA5)
Byte 2: Frequency encoding (byte 1)
Byte 3: Frequency encoding (byte 2)
Byte 4: Gain (use formula above)
Byte 5: Terminator (0xAF)
```

---

## Example Captures

### Filter 0: 100Hz, -1.0dB

**SET_BAND:**
```
AA EC 44 00 06 A5 A5 A5 C1 A5 AF E4
                   │  │  │  │  │  │
                   │  │  │  │  │  └─ 0xAF: Terminator
                   │  │  │  │  └──── 0xA5: -1.0dB
                   │  │  │  └─────── 0xC1: Freq byte 2
                   │  │  └────────── 0xA5: Freq byte 1
                   │  └───────────── 0xA5: Unknown param
                   └──────────────── 0xA5: Band ID (Filter 0)
```

**GET response (36 bytes):**
```
AD A1 | A5 A5 A5 C1 A5 AF | ...
│  │    └─ Filter 0 data ─┘
└──┴─ Header
```

---

## Known Frequency Mappings ✅

**10 frequencies decoded through systematic testing:**

| Frequency | Byte 2 | Byte 3 | 16-bit | Notes                    |
|-----------|--------|--------|--------|--------------------------|
| 50 Hz     | 0xA5   | 0x97   | 42391  | ✅ Verified              |
| 100 Hz    | 0xA5   | 0xC1   | 42433  | ✅ Verified              |
| 150 Hz    | 0xA5   | 0x33   | 42291  | ✅ Verified              |
| 200 Hz    | 0xA5   | 0x6D   | 42349  | ✅ Verified              |
| 500 Hz    | 0xA4   | 0x51   | 42065  | ✅ Verified              |
| 1000 Hz   | 0xA6   | 0x4D   | 42573  | ✅ Verified              |
| 2000 Hz   | 0xA2   | 0x75   | 41589  | ✅ Verified              |
| 3000 Hz   | 0xAE   | 0x1D   | 44573  | ✅ Verified              |
| 3078 Hz   | 0xA9   | 0xA3   | 43427  | ✅ Verified              |
| 10000 Hz  | 0x82   | 0xB5   | 33461  | ✅ Verified              |

**See EDIFIER_FREQUENCY_TABLE.md** for complete analysis and implementation details.

**Encoding:** Complex non-linear (likely DSP biquad coefficients or proprietary format)

---

## CRC Calculation

```javascript
function calculateCRC(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length - 1; i++) {
        sum += (bytes[i] & 0xFF);
    }
    return sum & 0xFF;
}
```

---

## Band Index Mapping

| Filter # | Band ID | Hex  |
|----------|---------|------|
| 0        | 165     | 0xA5 |
| 1        | 164     | 0xA4 |
| 2        | 167     | 0xA7 |
| 3        | 166     | 0xA6 |

**Pattern:** Not sequential - possibly device-specific IDs

---

## Implementation Status

| Feature           | Status | Notes                              |
|-------------------|--------|------------------------------------|
| Gain encoding     | ✅ DONE | Fully decoded (±6dB, 0.5dB steps)  |
| Gain decoding     | ✅ DONE | Formula verified                   |
| Frequency lookup  | ✅ DONE | 10 frequencies mapped              |
| Frequency formula | 🔄 WIP  | Pattern unclear, use lookup table  |
| Q-factor decode   | ❌ TODO | Not yet investigated               |
| Filter type       | ❌ TODO | Not yet investigated               |
| CRC calculation   | ✅ DONE | Simple sum & 0xFF                  |
| Band structure    | ✅ DONE | 4 main bands (6 bytes each)        |

---

## Next Steps

1. **Frequency encoding:** Test more frequency values to find the pattern
   - Try: 50Hz, 200Hz, 500Hz, 2000Hz, 5000Hz, 20000Hz
2. **Q-factor:** Identify which byte encodes Q value
3. **Filter type:** Determine if filter type (peak/shelf) is encoded
4. **Validation:** Test extreme values and edge cases
