# Earfun Tune Pro - Quick Reference Card

## 📊 Command Format (16 bytes)

```
┌────────────────────────────────────────────────────────────────┐
│ EF 20 95 0A 0A [BAND] FC F4 [FREQ] [GAIN] 0B 33 [CRC] FE     │
└────────────────────────────────────────────────────────────────┘
   │  │  │  │  │    │    │  │   │      │    │  │   │    │
   │  │  │  │  │    │    │  │   │      │    │  │   │    └─ End marker
   │  │  │  │  │    │    │  │   │      │    │  │   └────── CRC (1 byte)
   │  │  │  │  │    │    │  │   │      │    └──┴────────── Q factor (fixed)
   │  │  │  │  │    │    │  │   │      └───────────────── Gain (2 bytes, signed)
   │  │  │  │  │    │    │  │   └──────────────────────── Frequency (2 bytes)
   │  │  │  │  │    │    └──┴──────────────────────────── Fixed values
   │  │  │  │  │    └────────────────────────────────────── Band number (1-10)
   │  │  │  └──┴─────────────────────────────────────────── Length fields
   │  │  └────────────────────────────────────────────────── Command ID (Set PEQ)
   │  └───────────────────────────────────────────────────── Category (EQ)
   └──────────────────────────────────────────────────────── Start marker
```

---

## 🔢 Encoding Formulas

### Frequency (Bytes 8-9)
```
freq_value = frequency_hz * 3
```

**Example**:
- 31.5 Hz → `0x005E` (94 decimal)
- 1000 Hz → `0x0BB8` (3000 decimal)
- 16000 Hz → `0xBB80` (48000 decimal)

**Format**: Big-endian 16-bit unsigned

### Gain (Bytes 10-11)
```
gain_value = gain_dB * 100 / 3
```

**Example**:
- +9 dB → `0x012C` (300 decimal)
- +6 dB → `0x00C8` (200 decimal)
- 0 dB → `0x0000` (0 decimal)
- -6 dB → `0xFF38` (-200 in two's complement)

**Format**: Big-endian 16-bit signed

### Q Factor (Bytes 12-13)
```
fixed_value = 0x0B33 (2867 decimal)
```

**Always**: `0B 33` (not adjustable)

---

## 📋 Standard 10-Band Frequencies

| Band | Frequency | Encoded Value | Hex Bytes |
|------|-----------|---------------|-----------|
| 1 | 31.5 Hz | 94 | `00 5E` |
| 2 | 63 Hz | 189 | `00 BD` |
| 3 | 125 Hz | 375 | `01 77` |
| 4 | 250 Hz | 750 | `02 EE` |
| 5 | 500 Hz | 1500 | `05 DC` |
| 6 | 1000 Hz | 3000 | `0B B8` |
| 7 | 2000 Hz | 6000 | `17 70` |
| 8 | 4000 Hz | 12000 | `2E E0` |
| 9 | 8000 Hz | 24000 | `5D C0` |
| 10 | 16000 Hz | 48000 | `BB 80` |

---

## 🎛️ Example Commands

### Band 1 (31.5Hz) @ +9dB
```
EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE
```

### Band 1 (31.5Hz) @ 0dB
```
EF 20 95 0A 0A 01 FC F4 00 5E 00 00 0B 33 ?? FE
```
*(CRC byte unknown - needs calculation)*

### Band 6 (1000Hz) @ +12dB
```
EF 20 95 0A 0A 06 FC F4 0B B8 01 90 0B 33 ?? FE
```
*(CRC byte unknown - needs calculation)*

---

## 💻 Code Snippets

### Python - Encode Frequency
```python
def encode_frequency(freq_hz):
    """Encode frequency to 2-byte big-endian"""
    value = int(round(freq_hz * 3))
    return [(value >> 8) & 0xFF, value & 0xFF]

# Example
freq_bytes = encode_frequency(1000)  # Returns [0x0B, 0xB8]
```

### Python - Encode Gain
```python
def encode_gain(gain_db):
    """Encode gain to 2-byte signed big-endian"""
    value = int(round(gain_db * 100 / 3))
    if value < 0:
        value = 65536 + value  # Two's complement
    return [(value >> 8) & 0xFF, value & 0xFF]

# Examples
gain_bytes = encode_gain(9)   # Returns [0x01, 0x2C]
gain_bytes = encode_gain(-6)  # Returns [0xFF, 0x38]
```

### Python - Build Complete Command
```python
def build_command(band, freq_hz, gain_db):
    """Build PEQ command (CRC placeholder)"""
    freq_h, freq_l = encode_frequency(freq_hz)
    gain_h, gain_l = encode_gain(gain_db)

    cmd = [
        0xEF, 0x20, 0x95, 0x0A, 0x0A, band,
        0xFC, 0xF4,
        freq_h, freq_l,
        gain_h, gain_l,
        0x0B, 0x33,
        0x00,  # CRC placeholder
        0xFE
    ]

    return bytes(cmd)
```

---

## 🔍 Quick Decoder

### Decode Frequency
```
freq_value = (byte_8 << 8) | byte_9
frequency_hz = freq_value / 3
```

### Decode Gain
```
gain_value = (byte_10 << 8) | byte_11
if gain_value > 32767:
    gain_value = gain_value - 65536  # Convert to signed
gain_dB = gain_value * 3 / 100
```

---

## ⚠️ Known Issues

### CRC Algorithm Unknown
- Byte 14 (position 14) contains a checksum
- **Not** a standard CRC-8 polynomial
- Needs reverse engineering from Android app
- **Workaround**: Try sending with 0x00 CRC to test if validation is strict

### Q Factor Fixed
- Cannot adjust bandwidth of EQ filters
- Hardcoded to 0x0B33 (2867)
- Likely hardware/firmware limitation

### Frequencies Fixed
- Cannot change center frequencies
- Must use standard 10-band frequencies
- Typical limitation of graphic EQ (vs parametric EQ)

---

## 📱 Capture More Commands

```bash
# Start capture
python3.11 bluetooth_toolkit.py capture com.corelink.earfun --output capture.txt

# Then in the app, try:
# - Adjust different bands to different gain values
# - Switch between presets
# - Create new custom preset
# - Rename preset
# - Volume controls
# - ANC mode switching
```

---

## 🎯 Quick Test Checklist

To verify encoding and find CRC:

- [ ] Capture band at +12dB (should be `01 90`)
- [ ] Capture band at -12dB (should be `FB 70` or similar)
- [ ] Capture band at +3dB (should be `00 64`)
- [ ] Capture multiple bands to analyze CRC patterns
- [ ] Test if device accepts commands with invalid CRC

---

**Protocol Status**: ✅ Frequency/Gain decoded | ❌ CRC unknown
**Last Updated**: 2026-01-25
