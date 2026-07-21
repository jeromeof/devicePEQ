# Earfun Tune Pro - Protocol Analysis & Findings

## 📊 Summary

The Earfun Tune Pro uses a **proprietary protocol over Classic Bluetooth SPP** (Serial Port Profile) with a true 10-band graphic EQ that allows custom gain adjustments.

---

## 🔍 Protocol Details

### Communication Method
- **Transport**: Classic Bluetooth SPP (Serial Port Profile)
- **App Package**: com.corelink.earfun
- **Firmware**: EarFun_20250902_v1.0.47H

### Packet Structure

**General Format:**
```
EF [TYPE] [CMD] [LEN] [DATA...] [CRC_H] [CRC_L] FE
```

**PEQ Band Command Format:**
```
EF 20 95 0A 0A [BAND] FC F4 [FREQ_H] [FREQ_L] [GAIN_H] [GAIN_L] 0B 33 [CRC] FE
```

---

## 🎵 PEQ Protocol Breakdown

### Command Structure (16 bytes total)

| Byte Position | Value | Description |
|---------------|-------|-------------|
| 0 | `EF` | Start marker |
| 1 | `20` | Command category (EQ/Audio) |
| 2 | `95` | Command ID (Set PEQ Band) |
| 3 | `0A` | Data length (10 bytes) |
| 4 | `0A` | Sub-length/parameter count |
| 5 | `01`-`0A` | Band number (1-10) |
| 6-7 | `FC F4` | Fixed values (filter type/mode?) |
| 8-9 | Variable | Frequency (big-endian 16-bit) |
| 10-11 | Variable | Gain (big-endian 16-bit signed) |
| 12-13 | `0B 33` | Q factor (fixed = 2867) |
| 14 | Variable | CRC checksum (1 byte, custom algorithm) |
| 15 | `FE` | End marker |

---

## 🎛️ Encoding Details

### Frequency Encoding
**Formula**: `freq_value = frequency_hz * 3`

The frequency is encoded as a 16-bit big-endian value representing the frequency multiplied by 3.

**Example**:
- 31.5 Hz: `00 5E` (94 decimal = 31.5 * 3 = 94.5)
- 1000 Hz: `0B B8` (3000 decimal = 1000 * 3)
- 16000 Hz: `BB 80` (48000 decimal = 16000 * 3)

**Standard 10-Band Frequencies**:
```
Band 1:  31.5 Hz  → 0x005E (94)
Band 2:  63 Hz    → 0x00BD (189)
Band 3:  125 Hz   → 0x0177 (375)
Band 4:  250 Hz   → 0x02EE (750)
Band 5:  500 Hz   → 0x05DC (1500)
Band 6:  1000 Hz  → 0x0BB8 (3000)
Band 7:  2000 Hz  → 0x1770 (6000)
Band 8:  4000 Hz  → 0x2EE0 (12000)
Band 9:  8000 Hz  → 0x5DC0 (24000)
Band 10: 16000 Hz → 0xBB80 (48000)
```

### Gain Encoding
**Formula**: `gain_value = gain_dB * 100 / 3` (approximately `gain_dB * 33.33`)

The gain is a 16-bit signed value in big-endian format.

**Example**:
- +9 dB: `01 2C` (300 decimal = 9 * 100/3)
- 0 dB: `00 00` (0 decimal)
- Negative values would use two's complement

**Range**: Likely -12 dB to +12 dB (to be confirmed)

### Q Factor
The bytes `0B 33` (2867 decimal) appear **fixed** in all captured commands. This represents the Q factor (bandwidth) of the EQ filters.

**Status**: Fixed value, likely not adjustable via the app.

### CRC/Checksum (Byte 14)
The CRC is a single byte (position 14) calculated from the first 14 bytes of the command.

**Analysis Results**:
- ❌ Does NOT match standard CRC-8 polynomials (tested all common variants)
- ❌ Does NOT match simple XOR, SUM, or ~SUM algorithms
- ❌ Brute force polynomial search (0x00-0xFF) found no matches

**Conclusion**: The checksum uses a custom algorithm, likely:
- Table-based CRC with custom lookup table
- Proprietary checksum algorithm
- Non-standard polynomial CRC

**Next Steps**:
- Analyze decompiled Android app to find checksum implementation
- For now, commands can be tested without valid CRC to see if device validates it

---

## 📋 Captured Commands

### Complete 10-Band EQ Update (User set 31.5Hz to +9dB, others to 0dB)

```
Band 1 (31.5Hz, +9dB):
EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE

Band 2 (63Hz, 0dB):
EF 20 95 0A 0A 02 FC F4 00 BD 00 00 0B 33 01 FE

Band 3 (125Hz, 0dB):
EF 20 95 0A 0A 03 FC F4 01 77 00 00 0B 33 BD FE

Band 4 (250Hz, 0dB):
EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33 8E FE

Band 5 (500Hz, 0dB):
EF 20 95 0A 0A 05 FC F4 05 DC 00 00 0B 33 9C FE

Band 6 (1000Hz, 0dB):
EF 20 95 0A 0A 06 FC F4 0B B8 00 00 0B 33 58 FE

Band 7 (2000Hz, 0dB):
EF 20 95 0A 0A 07 FC F4 17 70 00 00 0B 33 B0 FE

Band 8 (4000Hz, 0dB):
EF 20 95 0A 0A 08 FC F4 2E E0 00 00 0B 33 20 FE

Band 9 (8000Hz, 0dB):
EF 20 95 0A 0A 09 FC F4 5D C0 00 00 0B 33 40 FE

Band 10 (16000Hz, 0dB):
EF 20 95 0A 0A 0A FC F4 BB 80 00 00 0B 33 87 FE
```

**Key Observation**: Each band is sent as a separate command. To update all 10 bands, the app sends 10 consecutive commands.

---

## ✅ Capabilities

### What We Know:
- ✅ 10-band graphic EQ with adjustable gains
- ✅ Standard frequencies (31.5Hz to 16kHz)
- ✅ Individual band control via SPP
- ✅ Custom presets can be saved
- ✅ Protocol structure fully documented

### What's Unknown:
- ❓ Gain range (likely -12 to +12 dB)
- ❓ Q factor adjustability (appears fixed at 0x0B33)
- ❓ Other command IDs (volume, ANC, battery, etc.)
- ❓ CRC algorithm
- ❓ Whether frequencies can be customized (probably not - fixed 10-band)

### What's Possible:
- ✅ Create custom EQ presets programmatically
- ✅ Build web-based controller
- ✅ Automate EQ switching
- ✅ Create unlimited custom presets

---

## 🔧 Next Investigation Steps

### 1. Verify Gain Range
Capture commands with different gain values:
- Set a band to minimum gain
- Set a band to maximum gain
- Try negative values

### 2. Test Gain Encoding
Set a band to specific dB values to confirm encoding:
- +3 dB (should be ~100 = 0x0064)
- +6 dB (should be ~200 = 0x00C8)
- -6 dB (should be ~-200 = 0xFF38 in two's complement)

### 3. Reverse Engineer CRC
With multiple captured commands, analyze the checksum pattern:
- Compare CRC bytes across different commands
- Identify the CRC algorithm (CRC-16, custom, etc.)

### 4. Discover Other Commands
Capture additional operations:
- Volume up/down
- ANC mode switching
- Preset loading
- Battery query
- Device info query

### 5. Test Custom Frequencies (if supported)
Some devices allow custom frequency selection. Try:
- Setting non-standard frequencies
- Checking if the app supports it

---

## 🎯 Comparison with Ugreen Max5C

| Feature | Ugreen Max5C | Earfun Tune Pro |
|---------|--------------|-----------------|
| **EQ Type** | 8 fixed presets | 10-band custom EQ |
| **Customization** | ❌ None | ✅ Per-band gain |
| **Protocol** | `AA BB CC` format | `EF...FE` format |
| **Transport** | Classic SPP | Classic SPP |
| **Frequencies** | Fixed (unknown) | 31.5-16000 Hz |
| **Custom Presets** | ❌ No | ✅ Yes |
| **Parametric EQ** | ❌ No | ❓ Unknown (Q fixed?) |

---

## 📝 Implementation Notes

### JavaScript Implementation (for Web Controller)

```javascript
function buildPEQCommand(band, frequencyHz, gainDb) {
    // Encode frequency (freq * 3)
    const freqValue = Math.round(frequencyHz * 3);
    const freqH = (freqValue >> 8) & 0xFF;
    const freqL = freqValue & 0xFF;

    // Encode gain (dB * 100 / 3)
    let gainValue = Math.round(gainDb * 100 / 3);

    // Handle negative values (two's complement)
    if (gainValue < 0) {
        gainValue = 65536 + gainValue;
    }

    const gainH = (gainValue >> 8) & 0xFF;
    const gainL = gainValue & 0xFF;

    // Build command (14 bytes before CRC)
    const cmd = [
        0xEF, 0x20, 0x95, 0x0A, 0x0A, band,
        0xFC, 0xF4,
        freqH, freqL,
        gainH, gainL,
        0x0B, 0x33
    ];

    // Calculate CRC (algorithm TBD - use placeholder for now)
    const crc = calculateEarfunCRC(cmd);  // TODO: Implement
    cmd.push(crc);
    cmd.push(0xFE);

    return new Uint8Array(cmd);
}

// Standard 10-band frequencies
const STANDARD_FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Send complete EQ preset (all 10 bands)
async function sendEQPreset(gains) {
    for (let i = 0; i < 10; i++) {
        const cmd = buildPEQCommand(i + 1, STANDARD_FREQS[i], gains[i]);
        await sendCommand(cmd);
        await sleep(50); // Small delay between commands
    }
}
```

---

## 🚀 Current Status

### What Works:
- ✅ Protocol structure identified
- ✅ Frequency encoding decoded
- ✅ Gain encoding decoded (tentative)
- ✅ Command format documented

### What's Needed:
- 🔧 CRC algorithm reverse engineering
- 🔧 Gain range verification
- 🔧 Additional command discovery
- 🔧 Web controller implementation

---

**Last Updated**: 2026-01-25
**Status**: Protocol partially decoded, web controller pending
**Next Goal**: Verify gain encoding and reverse engineer CRC
