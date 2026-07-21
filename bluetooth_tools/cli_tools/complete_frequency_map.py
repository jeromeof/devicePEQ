#!/usr/bin/env python3
"""
Complete frequency encoding map with all captured data points
"""

# All captured frequency mappings (sorted by frequency)
COMPLETE_FREQ_DATA = [
    (50,   0xA5, 0x97, 42391),
    (75,   0xA5, 0xEE, 42478),  # Peak
    (76,   0xA5, 0xE9, 42473),
    (77,   0xA5, 0xE8, 42472),
    (100,  0xA5, 0xC1, 42433),
    (150,  0xA5, 0x33, 42291),
    (175,  0xA5, 0x0A, 42250),  # Trough
    (200,  0xA5, 0x6D, 42349),
    (400,  0xA4, 0x35, 42037),  # Byte 2 changes to 0xA4
    (500,  0xA4, 0x51, 42065),
    (1000, 0xA6, 0x4D, 42573),  # Byte 2 changes to 0xA6
    (2000, 0xA2, 0x75, 41589),  # Byte 2 changes to 0xA2
    (3000, 0xAE, 0x1D, 44573),  # Byte 2 changes to 0xAE
    (3078, 0xA9, 0xA3, 43427),  # Byte 2 changes to 0xA9
    (10000, 0x82, 0xB5, 33461), # Byte 2 changes to 0x82
]

print("=" * 80)
print("COMPLETE FREQUENCY ENCODING MAP")
print("=" * 80)
print("\nAll captured data points:")
print(f"{'Freq (Hz)':<10} {'Byte2':<8} {'Byte3':<8} {'16-bit':<8} {'Notes':<30}")
print("-" * 80)

prev_byte2 = None
for freq, byte2, byte3, combined in COMPLETE_FREQ_DATA:
    byte2_hex = f"0x{byte2:02X}"
    byte3_hex = f"0x{byte3:02X}"

    notes = ""
    if freq == 75:
        notes = "Peak (wave pattern)"
    elif freq == 175:
        notes = "Trough (wave pattern)"

    if prev_byte2 is not None and byte2 != prev_byte2:
        notes = f"Byte2 changes: 0x{prev_byte2:02X}→0x{byte2:02X}"

    print(f"{freq:<10} {byte2_hex:<8} {byte3_hex:<8} {combined:<8} {notes:<30}")
    prev_byte2 = byte2

print("\n" + "=" * 80)
print("BYTE 2 PATTERN ANALYSIS")
print("=" * 80)

# Group by byte 2 value
from collections import defaultdict
byte2_groups = defaultdict(list)
for freq, byte2, byte3, combined in COMPLETE_FREQ_DATA:
    byte2_groups[byte2].append((freq, combined))

print("\nFrequency ranges by Byte 2 value:")
for byte2_val in sorted(byte2_groups.keys(), reverse=True):
    freqs = byte2_groups[byte2_val]
    freq_list = [f[0] for f in freqs]
    min_freq = min(freq_list)
    max_freq = max(freq_list)
    print(f"  0x{byte2_val:02X} ({byte2_val:3d}): {min_freq:5d}-{max_freq:5d} Hz ({len(freqs)} points)")

print("\n" + "=" * 80)
print("VALUE CHANGES ANALYSIS")
print("=" * 80)
print("\nChange between consecutive frequencies:")
print(f"{'From':<6} {'To':<6} {'ΔFreq':<8} {'From Val':<10} {'To Val':<10} {'ΔValue':<10} {'Rate':<10}")
print("-" * 80)

for i in range(len(COMPLETE_FREQ_DATA) - 1):
    f1, b2_1, b3_1, v1 = COMPLETE_FREQ_DATA[i]
    f2, b2_2, b3_2, v2 = COMPLETE_FREQ_DATA[i + 1]

    delta_f = f2 - f1
    delta_v = v2 - v1
    rate = delta_v / delta_f

    print(f"{f1:<6} {f2:<6} {delta_f:<8} {v1:<10} {v2:<10} {delta_v:+10} {rate:+10.2f}")

print("\n" + "=" * 80)
print("OBSERVATIONS")
print("=" * 80)
print("""
1. Low range (50-200 Hz): Byte 2 stays at 0xA5
   - Shows wave pattern: peak at 75Hz, trough at 175Hz
   - Values range: 42250-42478 (228 unit span)

2. Transition (200-400 Hz): Byte 2 changes from 0xA5 to 0xA4
   - Large drop: 42349 → 42037 (-312)

3. Mid-low range (400-500 Hz): Byte 2 stays at 0xA4
   - Slight increase: 42037 → 42065 (+28)

4. Byte 2 continues changing at higher frequencies:
   - 500Hz: 0xA4 → 1000Hz: 0xA6 (jumps +508 in value)
   - 1000Hz: 0xA6 → 2000Hz: 0xA2 (drops -984 in value)
   - 2000Hz: 0xA2 → 3000Hz: 0xAE (jumps +2984!)
   - Very high frequencies use much lower byte 2 values

5. The encoding is clearly NOT a simple continuous function
   - Appears to be segmented/piecewise
   - Each byte 2 value may represent a different "zone"
   - Byte 3 provides fine adjustment within each zone
""")

print("\n" + "=" * 80)
print("RECOMMENDATION")
print("=" * 80)
print("""
Given the complex, segmented nature of this encoding:

1. Continue using lookup table for known frequencies
2. Implement nearest-neighbor interpolation for unknown frequencies
3. For real-time encoding, pre-compute a dense lookup table (e.g., every 10Hz)
4. The encoding is likely optimized for DSP hardware efficiency, not mathematical elegance

Current coverage: 15 data points spanning 50Hz to 10kHz
""")
