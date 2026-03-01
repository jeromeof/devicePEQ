# Airoha EQ Protocol Analysis - Audeze Capture

Analysis of Bluetooth communication between Audeze app and Airoha-based headphones.

## Summary of Findings

### Commands Discovered

1. **Read EQ Preset** (VERIFIED)
   - Format: `05 5A 06 00 00 0A [preset] EF E8 03`
   - `[preset]`: 0x00-0x03 (preset number)
   - Response: 193-byte packet with full EQ parameters
   - Example: `05 5A 06 00 00 0A 00 EF E8 03` reads preset 0

2. **Activate/Switch Preset** (VERIFIED)
   - Format: `05 5A 06 00 00 0A [preset] E4 E8 03`
   - `[preset]`: 0x00-0x03 (preset number)
   - Response: 22 or 78-byte acknowledgement packet
   - Example: `05 5A 06 00 00 0A 01 E4 E8 03` activates preset 1
   - This command was observed 8 times when switching between presets

3. **Write EQ Preset** (NOT FOUND)
   - No write commands with custom EQ data were captured
   - Only read and activate commands were observed
   - Presets appear to be stored in device firmware

## EQ Data Format (193-byte Response)

### Packet Structure
```
Byte 0-2:   05 5B BD           (Header, Type, Command)
Byte 3-4:   00 00              (Length prefix)
Byte 5-6:   0A B9              (EQ data marker)
Byte 7:     00/01              (Enable flag: 00=disabled, 01=enabled)
Byte 8-13:  00 00 00 00        (Padding/reserved)
Byte 14+:   Band data (18 bytes per band)
```

### PEQ Band Structure (18 bytes each)
```
Offset 0-1:   Filter type (0x01) and order (0x02) - appears to be biquad
Offset 2-5:   Frequency (32-bit LE, unsigned, Hz)
Offset 6-9:   Gain (32-bit LE, signed, in 1/100 dB units)
Offset 10-13: Bandwidth or Q (32-bit LE, unsigned, possibly Hz)
Offset 14-17: Constant 0xC8 (200 decimal, possibly sample rate marker)
```

### Example Band Decoding

From Immersive preset, Band 0:
```
01 02 80 0C 00 00 58 02 00 00 40 06 00 00 C8 00 00 00

01 02           - Filter type=1, order=2 (biquad)
80 0C 00 00     - 0x00000C80 = 3200 Hz
58 02 00 00     - 0x00000258 = 600 = +6.00 dB
40 06 00 00     - 0x00000640 = 1600 (bandwidth? Q=16?)
C8 00 00 00     - 0x000000C8 = 200 (constant)
```

## Discovered Presets

Based on the capture analysis, the device has at least 4 presets:

### Preset 0: Immersive (ACTIVE when capture started)
- Band 0:  3200 Hz,  +6.00 dB
- Band 1:  6400 Hz,  -3.00 dB
- Band 2: 12500 Hz,  +3.00 dB
- Band 3: 25000 Hz,  -2.00 dB

### Preset 1: Audeze (Flat)
- Band 0:  3200 Hz,  +0.00 dB
- Band 1:  6400 Hz,  +0.00 dB
- Band 2: 12500 Hz,  +0.00 dB
- Band 3: 25000 Hz,  +0.00 dB

### Preset 2: Unknown
- Band 0:  3200 Hz,  -3.00 dB
- Band 1:  6400 Hz,  -2.00 dB
- Band 2: 12500 Hz,  -1.00 dB
- Band 3: 25000 Hz,  +0.00 dB

### Preset 3: Audeze (Flat) - appears identical to Preset 1

All presets use the same 4 center frequencies with different gain values.

## Capture Statistics

- Total packets captured: 198
- EQ-related packets: 56 (28%)
  - Read queries: 32
  - Activation commands: 8
  - EQ data responses: 16
- Noise packets: 142 (72%)
  - Battery status, connection status, and other status queries

## Observations

1. **No custom EQ writes observed**: The app only switches between pre-defined presets stored on the device. No packets were found that write custom PEQ parameters.

2. **Preset activation pattern**: When switching presets in the UI:
   - TX: Activate preset N (`E4` command)
   - RX: Acknowledgement
   - TX: Read all presets (`EF` commands for 0-3)
   - RX: EQ data for each preset
   - The app re-reads all presets after each switch

3. **Enable/Disable flag**: The byte at offset 7 in the response indicates if the preset is enabled (0x01) or disabled (0x00). When switching presets, the newly activated preset shows enabled=0x01.

4. **Fixed band structure**: All presets use exactly 4 bands at fixed frequencies (3.2k, 6.4k, 12.5k, 25k Hz). Only gain values change between presets.

## Next Steps for Custom PEQ

To enable custom PEQ editing (not just preset switching), we need to discover:

1. **Write command format**: The command to upload custom EQ data to a preset slot
   - Likely format: `05 5A [length] 00 00 0A [write_cmd] [enable] [band_data...]`
   - Write command byte might be in range 0x20-0x2F or similar
   - May need to capture traffic while editing EQ in a different app

2. **Set active preset**: We already have this (`E4` command)

3. **Save/Apply command**: May need an additional command to persist changes

## Testing Strategy

1. Use `activate` command to switch between existing presets (safe, verified)
2. Experiment with write command formats (risky, could crash device)
3. Consider capturing from other Airoha-based apps that allow custom EQ

## Tools Created

1. **analyze_airoha_eq.py**: Parses captures and extracts EQ data
   - `--diff` mode shows unique presets only
   - `--show-noise` shows non-EQ packets

2. **airoha_eq_tool.py**: Generates commands for EQ operations
   - `read`: Query preset data (verified)
   - `activate`: Switch active preset (verified)
   - `write`: Generate write commands (EXPERIMENTAL, not verified)
   - `custom`: Generate custom PEQ write commands (EXPERIMENTAL)

## Usage Examples

```bash
# Analyze a capture
python3 analyze_airoha_eq.py audeze_airoha_capture.txt --diff

# Generate command to read preset 0
python3 airoha_eq_tool.py read 0

# Generate command to activate Audeze flat preset
python3 airoha_eq_tool.py activate 1

# Generate experimental write command
python3 airoha_eq_tool.py write 0 immersive
```
