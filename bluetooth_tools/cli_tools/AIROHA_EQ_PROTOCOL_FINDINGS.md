# Airoha PEQ Protocol - Key Findings

## Summary
Analysis of Audeze MM-500 app communication with Airoha-based device to understand custom EQ control.

## Key Commands Discovered

### 0x4F - Set All PEQ Presets (TX: App → Device)
- **Direction**: TX (App to Device)
- **Size**: 851 bytes
- **Purpose**: Sends all PEQ preset data to the device
- **Structure**:
  ```
  05 5A 4F | 03 03 0E 00 | [PEQ Data 844 bytes] | Checksum
  ├─ Header
  ├─ Command Header (4 bytes)
  └─ PEQ Preset Data
  ```

### 0x50 - Set PEQ Preset/Audio Settings (TX: App → Device)
- **Direction**: TX (App to Device)
- **Size**: 852 bytes (1 byte longer than 0x4F)
- **Purpose**: Set PEQ preset or audio settings
- **Name**: "Audio Settings" (per protocol decoder)
- **Structure**:
  ```
  05 5A 50 | 03 01 0A 2C E4 | [PEQ Data 843 bytes] | Checksum
  ├─ Header
  ├─ Command Header (5 bytes)
  └─ PEQ Preset Data
  ```

**Important Discovery**: The PEQ data payload in both 0x4F and 0x50 appears to be IDENTICAL (accounting for 1-byte header offset). This suggests:
- 0x4F might be "Set All Presets" (4 custom + N factory presets)
- 0x50 might be "Set Single Preset"
- The header differences indicate which preset/mode is being written

### PEQ Data Structure (Preliminary)
From the common payload starting at different offsets:
```
04 00 00 00       - Possibly: Preset selector (04 = Custom 1?)
06 00             - Possibly: Number of bands (6)
67 00 0A 00       - Unknown (possibly sample rate related?)
90 6B 00 22       - Unknown header
[Repeated filter coefficient blocks...]
```

### 0xBD - PEQ Parameter Response (RX: Device → App)
- **Direction**: RX (Device to App)
- **Size**: 193 bytes
- **Purpose**: Returns PEQ parameters in frequency-domain format
- **Structure**: Contains repeating blocks with frequency, gain, Q, and filter type data
  ```
  Example block:
  01 02 80 0C 00 00 58 02 00 00 40 06 00 00 C8 00 00 00
  │  │  └─ Frequency?  └─ Gain?      └─ Q?         └─ Filter type/flags?
  ```

### 0x12 - Get PEQ Settings
- **Direction**: RX (Device to App)
- **Size**: Variable
- **Purpose**: Returns current PEQ preset settings
- **Example**: `05 5B 12 00 00 0A 0E 00 03 00 00 00 02 E4 01 00 02 E4 08 00 02 E4`

### Keepalive Commands
- **TX**: `05 5A 06 00 00 0A XX E4 E8 03` (where XX increments)
  - Periodic keepalive sent from app to device
- **RX**: `05 5B 02 00 00 0A 03`
  - Short response to keepalive

### Other Commands Observed
- **0x03** - Connect Status
- **0x04** - Unknown (various sizes)
- **0x05** - Unknown
- **0x06** - Keepalive/Ping
- **0x16** - Unknown (periodic)
- **0x4A** - Unknown (returns device info?)

## EQ Change Analysis (6dB → 0dB)

### Capture Context
User captured Frida trace while:
1. Navigating from presets page to Custom Preset 1
2. Changing first filter from 6dB to 0dB

### Key Finding
Both the 0x4F and 0x50 packets in the capture contain **identical PEQ data**. This means:
- Either both packets represent the state AFTER the change (both showing 0dB)
- Or the capture started after the UI already displayed 0dB
- **To capture the actual change**, need to:
  1. Start Frida capture BEFORE opening the custom EQ page
  2. Make the change while capture is running
  3. Compare the 0x50 packets sent before vs after the change

## Coefficient Format
The filter coefficients appear to be in biquad format with int16 or int24 values. Pattern observed:
```
CD 99 00 E2 97 62 00 9B 20 84 00 53 E2 79 00 A0 FF 7F 00 FF
└─ b0?      └─ b1?      └─ b2?      └─ a1?      └─ a2?
```
Each coefficient seems to be 3-4 bytes, possibly in Q format (fixed-point).

## Next Steps
1. **Capture a complete EQ change**: Start capture before making changes
2. **Compare 0x50 packets**: Look for coefficient differences between before/after
3. **Decode coefficient format**: Determine if Q15, Q23, or other fixed-point format
4. **Test writing EQ**: Construct a 0x50 packet with known filter parameters and send to device
5. **Map all presets**: Capture switching between all preset modes to understand preset selectors

## Tools Created
1. **filter_airoha_capture.py** - Filters out keepalive packets from Frida captures
   - Removes periodic 0x06 keepalive commands
   - Shows only interesting EQ and control commands
   - Usage: `python3 filter_airoha_capture.py input.txt [output.txt]`

## References
- Previous findings: GAIA protocol (0x6E00, 0x6D00) not used for PEQ on Airoha devices
- Airoha uses custom protocol over SPP-like characteristic
- MM-500 uses 16-bit biquad coefficients in Q format
