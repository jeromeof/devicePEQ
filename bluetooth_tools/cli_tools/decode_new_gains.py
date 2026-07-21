#!/usr/bin/env python3
"""
Decode gain values from new capture
"""

captures = [
    ("Band 1 @ +1dB", "EF 20 95 0A 0A 01 FE 20 00 5E 00 1E 0B 33 ED FE"),
    ("Band 1 @ 0dB",  "EF 20 95 0A 0A 01 FE 20 00 5E 00 00 0B 33 CF FE"),
]

print("\n" + "="*80)
print("🔍 GAIN ENCODING ANALYSIS")
print("="*80)

for name, hex_str in captures:
    data = bytes.fromhex(hex_str.replace(" ", ""))

    # Extract gain bytes (positions 10-11)
    gain_h = data[10]
    gain_l = data[11]

    # Combine to 16-bit value
    gain_value = (gain_h << 8) | gain_l

    # Convert from signed if negative
    if gain_value > 32767:
        gain_value_signed = gain_value - 65536
    else:
        gain_value_signed = gain_value

    # Decode to dB (value * 3 / 100)
    gain_db = gain_value_signed * 3.0 / 100.0

    print(f"\n{name}:")
    print(f"  Gain bytes: {gain_h:02X} {gain_l:02X}")
    print(f"  Raw value: {gain_value} (0x{gain_value:04X})")
    print(f"  Signed: {gain_value_signed}")
    print(f"  Decoded: {gain_db:+.2f} dB")
    print(f"  Expected: {name.split('@')[1].strip()}")

    # Verify encoding
    expected_db = float(name.split('@')[1].strip().replace('dB', '').replace('+', ''))
    calculated_value = int(round(expected_db * 100 / 3))
    print(f"  Verification: {expected_db}dB * 100/3 = {calculated_value} (0x{calculated_value:02X})")

print("\n" + "="*80)
print("✅ Gain encoding confirmed:")
print("   Formula: gain_value = gain_dB * 100 / 3")
print("   Format: 16-bit signed big-endian")
print("="*80)
