# Edifier Unrestricted EQ Tool

## Problem: App UI Restrictions

The Edifier ConnectX app artificially limits the frequency ranges for each PEQ filter:
- **Filter 1**: Limited to ~200Hz and below
- **Filter 2**: Limited to a narrow mid-range
- **Filter 3**: Limited to a different mid-range
- **Filter 4**: Limited to high frequencies

**These are UI restrictions, NOT hardware limitations!** The device protocol supports any frequency from 20Hz to 20kHz on any band.

## Solution: Direct Protocol Control

The `edifier_custom_eq_tool.py` script bypasses the app and communicates directly with the device using the Edifier V2 protocol, giving you full control over all EQ parameters.

## Features

✅ **Any frequency on any band** (20Hz - 20kHz)
✅ **Full gain range** (-6dB to +6dB)
✅ **Q factor control** (0-100)
✅ **All filter types** (Peak, Low/High Shelf, Pass filters, Notch, etc.)
✅ **Read current EQ settings**
✅ **Interactive CLI**

## Quick Start

### 1. Install Dependencies

```bash
pip3 install bleak
```

### 2. Run the Tool

```bash
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools
python3 edifier_custom_eq_tool.py
```

### 3. Connect to Device

- Make sure your Edifier W830NB is powered on
- The tool will scan and connect automatically
- You'll see a menu with options

## Usage Examples

### Example 1: Set Filter 1 to 3kHz (App Blocks This!)

The app only lets you adjust Filter 1 up to ~200Hz, but the hardware has no such limitation:

```python
# In the tool menu:
# Choose: 2. Set custom EQ band

Band index: 0
Frequency in Hz: 3000       # App UI won't let you do this!
Gain in dB: +3.0
Q value: 50
Filter type: peak
```

Result: ✅ Filter 1 is now at 3kHz with +3dB boost!

### Example 2: Deep Sub-Bass Boost

Set Filter 1 to 30Hz (below what the app allows):

```
Band index: 0
Frequency: 30
Gain: +5.0
Q: 50
Filter type: lowshelf
```

### Example 3: Precise Notch Filter

Remove a harsh frequency with a narrow notch:

```
Band index: 2
Frequency: 2200
Gain: -6.0
Q: 80
Filter type: notch
```

### Example 4: Full Custom 4-Band EQ

Create a V-shape EQ with complete control:

```python
Band 0: 80Hz, Low Shelf, +4dB, Q=50
Band 1: 400Hz, Peak, -2dB, Q=50
Band 2: 3000Hz, Peak, -3dB, Q=50
Band 3: 8000Hz, High Shelf, +4dB, Q=50
```

The tool has a preset for this (Menu option 3, preset 4).

## Protocol Details

### Edifier V2 Packet Structure

```
[Header] [AppCode] [Command] [LenH] [LenL] [Payload...] [CRC]
  0xBB     0xEC      0x44      0x00   0x06   [6 bytes]    [CRC]
```

### Set Band Command (0x44)

Payload (6 bytes):
```
[Band Index] [Filter Type] [Freq High] [Freq Low] [Gain] [Q Value]
```

**Parameters:**
- **Band Index**: 0-9 (W830NB uses 0-3 for 4-band EQ)
- **Filter Type**: 0=Peak, 1=Low Shelf, 2=High Shelf, 3-7=Other types
- **Frequency**: 16-bit big-endian, direct Hz value (e.g., 1000 = 0x03E8)
- **Gain**: 0-12 scale (6 = 0dB, so 0=-6dB, 12=+6dB)
- **Q Value**: 0-100 (higher = narrower bandwidth)

### Example Packet

Set Band 0 to 5000Hz, +3dB, Q=50:

```
BB EC 44 00 06 00 00 13 88 09 32 E6
│  │  │  │  │  │  │  │  │  │  │  └─ CRC
│  │  │  │  │  │  │  │  │  │  └──── Q: 50 (0x32)
│  │  │  │  │  │  │  │  │  └──────── Gain: 9 (+3dB)
│  │  │  │  │  │  │  └──┴─────────── Freq: 5000 (0x1388)
│  │  │  │  │  │  └──────────────── Filter: 0 (Peak)
│  │  │  │  │  └──────────────────── Band: 0
│  │  │  └──┴─────────────────────── Length: 6 bytes
│  │  └─────────────────────────────── Command: 0x44 (Set Band)
│  └────────────────────────────────── AppCode: 0xEC
└───────────────────────────────────── Header: 0xBB (Send)
```

## Filter Types Reference

| Type | Name | Description | Use Case |
|------|------|-------------|----------|
| 0 | Peak/Bell | Boost/cut around center freq | Most common, precise adjustments |
| 1 | Low Shelf | Boost/cut all freqs below | Bass control |
| 2 | High Shelf | Boost/cut all freqs above | Treble control |
| 3 | Low Pass | Pass freqs below, cut above | Remove high frequency noise |
| 4 | High Pass | Pass freqs above, cut below | Remove rumble/low noise |
| 5 | Notch | Sharp cut at center freq | Remove specific problem frequencies |
| 6 | All Pass | Phase adjustment | Advanced phase correction |
| 7 | Band Pass | Pass only a frequency range | Isolate specific range |

## Common EQ Curves

### V-Shape (Enhanced Bass & Treble)
```
Band 0: 80Hz,   Low Shelf,  +4dB, Q=50
Band 1: 400Hz,  Peak,       -2dB, Q=50
Band 2: 3000Hz, Peak,       -3dB, Q=50
Band 3: 8000Hz, High Shelf, +4dB, Q=50
```

### Flat/Reference
```
All bands: 1000Hz, Peak, 0dB, Q=50
```

### Vocal Presence Boost
```
Band 0: 100Hz,  Peak,       0dB, Q=50
Band 1: 300Hz,  Peak,       +2dB, Q=70
Band 2: 2500Hz, Peak,       +3dB, Q=50
Band 3: 8000Hz, High Shelf, +1dB, Q=50
```

### Harman Target Approximation
```
Band 0: 50Hz,   Low Shelf,  +5dB, Q=50
Band 1: 200Hz,  Peak,       +2dB, Q=50
Band 2: 1000Hz, Peak,       -2dB, Q=70
Band 3: 10000Hz, High Shelf, +2dB, Q=50
```

## Troubleshooting

### "No Edifier devices found"
- Ensure device is powered on
- Make sure Bluetooth is enabled on your computer
- Try putting device in pairing mode (hold power button)
- Close the Edifier ConnectX app if it's running

### "Not connected to device"
- The connection may have timed out
- Restart the tool
- Move closer to the device

### Changes Not Audible
- Some changes are subtle - use larger gain values for testing
- Try reading back the EQ (menu option 1) to verify changes
- The device may need to be in "Custom EQ" mode (set in the app first)

### Script Crashes
- Make sure you have `bleak` installed: `pip3 install bleak`
- Try Python 3.8 or newer
- Check that you have Bluetooth permissions on macOS (System Preferences)

## Comparison: App vs. Tool

| Feature | Edifier App | Custom Tool |
|---------|-------------|-------------|
| Filter 1 Freq Range | ≤200Hz only | 20Hz - 20kHz ✅ |
| Filter 2 Freq Range | Limited mid-range | 20Hz - 20kHz ✅ |
| Filter 3 Freq Range | Limited mid-range | 20Hz - 20kHz ✅ |
| Filter 4 Freq Range | High freq only | 20Hz - 20kHz ✅ |
| Filter Types | Peak only | All 8 types ✅ |
| Read Current EQ | No | Yes ✅ |
| Presets | Fixed presets | Custom presets ✅ |

## Technical Notes

### Why Does the App Limit Frequencies?

The app's UI restrictions are likely designed to:
1. **Prevent user mistakes** - Overlapping filters can cause issues
2. **Simplified UI** - Easier for non-technical users
3. **Pre-defined EQ curve structure** - Bass/Low-Mid/High-Mid/Treble separation

However, the **hardware has no such limitations** and will accept any valid frequency on any band.

### Is This Safe?

✅ **Yes!** This tool uses the exact same protocol as the official app. The only difference is that it doesn't enforce the artificial UI restrictions. You're sending the same commands the app would send, just with different parameter values.

### CRC Verification

The tool automatically calculates and verifies CRC checksums. The Edifier V2 protocol uses a simple 8-bit CRC (sum of all bytes & 0xFF).

## Python API Usage

You can also use the tool as a library:

```python
from edifier_custom_eq_tool import EdifierController

async def custom_eq():
    controller = EdifierController()
    await controller.connect()

    # Set band 0 to 5kHz peak +3dB
    await controller.set_band(0, 'peak', 5000, 3.0, 50)

    # Read current settings
    bands = await controller.read_eq()
    for band in bands:
        print(f"Band {band['index']}: {band['frequency']}Hz, {band['gain_db']}dB")

    await controller.disconnect()

asyncio.run(custom_eq())
```

## Credits

- Protocol reverse-engineered from Edifier ConnectX app
- See `EDIFIER_PROTOCOL_DOCUMENTATION.md` for full protocol details
- Frida script: `frida_edifier.js` (now with fixed payload parsing!)

## Related Files

- `edifier_custom_eq_tool.py` - This tool
- `frida_edifier.js` - Frida script for protocol capture
- `EDIFIER_PROTOCOL_DOCUMENTATION.md` - Complete protocol reference
- `EDIFIER_W830NB_COMPLETE_SUMMARY.md` - Earlier findings
