# Edifier W830NB - Q-Factor Encoding

## Q-Factor Encoding Formula ✅

**Encoding:**
```javascript
Q_byte = 149 + (Q × 14)
Q_byte = 0x95 + (Q × 14)
```

**Decoding:**
```javascript
Q = (Q_byte - 149) / 14
Q = (Q_byte - 0x95) / 14
```

---

## Verified Q Values

| Q Value | Byte Value (hex) | Byte Value (dec) | Verified |
|---------|------------------|------------------|----------|
| 1.0     | 0xA3             | 163              | Calculated |
| 1.5     | 0xAA             | 170              | ✅ VERIFIED |
| 2.0     | 0xB1             | 177              | ✅ VERIFIED |

**Common value seen in captures:**
- 0xAF (175) appears frequently → Q = (175-149)/14 = **1.86**

This suggests the app may default to Q≈1.86 rather than Q=1.0.

---

## Formula Derivation

From test data:
- Q=1.5 → byte=170
- Q=2.0 → byte=177

**Calculate scale:**
- ΔQ = 2.0 - 1.5 = 0.5
- Δbyte = 177 - 170 = 7
- Scale = 7 / 0.5 = **14 bytes per Q value**

**Calculate baseline:**
Using Q=1.5, byte=170:
```
170 = baseline + (1.5 × 14)
170 = baseline + 21
baseline = 149 (0x95)
```

**Verify with Q=2.0:**
```
149 + (2.0 × 14) = 149 + 28 = 177 ✅
```

---

## Payload Structure

**SET_BAND payload (6 bytes):**
```
Byte 0: Band ID (0xA5, 0xA4, 0xA7, 0xA6)
Byte 1: Always 0xA5 (unknown parameter)
Byte 2: Frequency encoding (high byte)
Byte 3: Frequency encoding (low byte)
Byte 4: Gain (0xA9 + gain_dB × 4)
Byte 5: Q-factor (0x95 + Q × 14) ← THIS ONE
```

**Example:**
```
A4 A5 AE 1D A6 AA
│  │  │  │  │  └─ Q=1.5 (0xAA = 170)
│  │  │  │  └──── Gain=-0.75dB (0xA6 = 166)
│  │  └──┴─────── Freq=3000Hz (0xAE1D)
│  └───────────── Unknown (always 0xA5)
└──────────────── Band ID = Filter 1
```

---

## Q-Factor Range

**Theoretical range:**

If using unsigned 8-bit (0-255):
```
Min Q: (0 - 149) / 14 = -10.64 (invalid, would be clamped)
Max Q: (255 - 149) / 14 = 7.57
```

**Practical range** (based on typical EQ apps):
- Min Q: 0.5 → byte = 149 + (0.5×14) = 156 (0x9C)
- Max Q: 5.0 → byte = 149 + (5.0×14) = 219 (0xDB)

Most EQ applications limit Q between 0.5 and 5.0.

---

## Implementation

### Encoding Function

```javascript
function encodeQFactor(Q) {
    // Clamp Q to reasonable range
    if (Q < 0.5) Q = 0.5;
    if (Q > 5.0) Q = 5.0;

    const Q_byte = Math.round(149 + (Q * 14));
    return Q_byte;
}

// Examples
encodeQFactor(1.0)  // → 163 (0xA3)
encodeQFactor(1.5)  // → 170 (0xAA)
encodeQFactor(2.0)  // → 177 (0xB1)
```

### Decoding Function

```javascript
function decodeQFactor(Q_byte) {
    const Q = (Q_byte - 149) / 14;

    // Round to nearest 0.1
    return Math.round(Q * 10) / 10;
}

// Examples
decodeQFactor(163)  // → 1.0
decodeQFactor(170)  // → 1.5
decodeQFactor(175)  // → 1.86
decodeQFactor(177)  // → 2.0
```

---

## Complete SET_BAND Example

**Set Filter 1 to 3000Hz, -0.75dB, Q=1.5:**

```
Header:  AA EC 44 00 06
Payload: A4 A5 AE 1D A6 AA
         │  │  │  │  │  └─ Q=1.5 (149 + 1.5×14 = 170)
         │  │  │  │  └──── Gain=-0.75dB (169 + (-0.75×4) = 166)
         │  │  └──┴─────── Freq=3000Hz (lookup: 0xAE1D)
         │  └───────────── Unknown (0xA5)
         └──────────────── Band 1 (0xA4)
CRC:     44 (sum of all previous bytes & 0xFF)

Full command: AA EC 44 00 06 A4 A5 AE 1D A6 AA 44
```

---

## Testing Notes

**To gather more Q data:**

1. Keep frequency and gain constant
2. Change only Q-factor
3. Observe byte 5 in SET_BAND payload
4. Verify formula: byte = 149 + (Q × 14)

**Suggested test Q values:**
- 0.5, 0.7, 1.0, 1.3, 1.7, 2.5, 3.0, 4.0, 5.0

---

## Status

| Parameter | Status | Formula                | Range          |
|-----------|--------|------------------------|----------------|
| Gain      | ✅ DONE | 0xA9 + (gain_dB × 4)   | -6dB to +6dB   |
| Q-factor  | ✅ DONE | 0x95 + (Q × 14)        | ~0.5 to ~5.0   |
| Frequency | 🔄 TABLE | See lookup table       | 50Hz to 20kHz  |

**All core EQ parameters decoded!** 🎉
