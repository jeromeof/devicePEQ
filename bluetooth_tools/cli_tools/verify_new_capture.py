#!/usr/bin/env python3
"""
Verify checksums with the new capture data
"""

def calculate_checksum(payload_bytes):
    """Calculate: (length + sum(payload)) & 0xFF"""
    length = payload_bytes[0]
    total = sum(payload_bytes)
    return (length + total) & 0xFF

# New captures
new_captures = [
    ("Band 1 @ +1dB", "EF 20 95 0A 0A 01 FE 20 00 5E 00 1E 0B 33 ED FE", 0xED),
    ("Band 1 @ 0dB",  "EF 20 95 0A 0A 01 FE 20 00 5E 00 00 0B 33 CF FE", 0xCF),
    ("Band 2 @ 0dB",  "EF 20 95 0A 0A 02 FE 20 00 BD 00 00 0B 33 2F FE", 0x2F),
    ("Band 4 @ 0dB",  "EF 20 95 0A 0A 04 FE 20 02 EE 00 00 0B 33 64 FE", 0x64),
    ("Band 5 @ 0dB",  "EF 20 95 0A 0A 05 FE 20 05 DC 00 00 0B 33 56 FE", 0x56),
    ("Band 10 @ 0dB", "EF 20 95 0A 0A 0A FE 20 BB 80 00 00 0B 33 B5 FE", 0xB5),
]

# Original captures
original_captures = [
    ("Band 1 @ +9dB (orig)", "EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE", 0xCE),
    ("Band 4 @ 0dB (orig)",  "EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33 8E FE", 0x8E),
]

print("\n" + "="*80)
print("🔍 CHECKSUM VERIFICATION - NEW vs ORIGINAL CAPTURES")
print("="*80)

print("\n📊 NEW CAPTURES (with FE 20):")
all_pass = True
for name, hex_str, expected in new_captures:
    data = bytes.fromhex(hex_str.replace(" ", ""))
    payload = data[4:14]  # 10 bytes payload

    calculated = calculate_checksum(payload)
    match = "✅" if calculated == expected else "❌"
    all_pass = all_pass and (calculated == expected)

    print(f"{match} {name:25s} Calc: 0x{calculated:02X}  Expected: 0x{expected:02X}")
    if calculated != expected:
        print(f"   Payload: {' '.join(f'{b:02X}' for b in payload)}")
        print(f"   Sum: {sum(payload)}, Length: {payload[0]}")

print(f"\n{'✅ ALL NEW CHECKSUMS VALID!' if all_pass else '❌ Some checksums failed'}")

print("\n📊 ORIGINAL CAPTURES (with FC F4):")
all_pass_orig = True
for name, hex_str, expected in original_captures:
    data = bytes.fromhex(hex_str.replace(" ", ""))
    payload = data[4:14]  # 10 bytes payload

    calculated = calculate_checksum(payload)
    match = "✅" if calculated == expected else "❌"
    all_pass_orig = all_pass_orig and (calculated == expected)

    print(f"{match} {name:25s} Calc: 0x{calculated:02X}  Expected: 0x{expected:02X}")
    if calculated != expected:
        print(f"   Payload: {' '.join(f'{b:02X}' for b in payload)}")

print(f"\n{'✅ ALL ORIGINAL CHECKSUMS VALID!' if all_pass_orig else '❌ Some checksums failed'}")

print("\n" + "="*80)
print("🔍 KEY FINDING:")
print("="*80)
print("\n  Bytes 6-7 changed between captures:")
print(f"    Original:  FC F4")
print(f"    New:       FE 20")
print("\n  Possible meanings:")
print("    - Different EQ mode/preset?")
print("    - Feature flag (custom vs preset)?")
print("    - Protocol version?")
print("    - Filter type indicator?")
print("\n  ✅ Checksum formula is CORRECT for both!")
print("     Formula: (payloadLength + sum(payload)) & 0xFF")
print("="*80)
