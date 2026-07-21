#!/usr/bin/env python3
"""
Try different interpretations of the Earfun checksum
"""

test_commands = [
    ('Band 1', 'EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE', 0xCE),
    ('Band 4', 'EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33 8E FE', 0x8E),
    ('Band 10', 'EF 20 95 0A 0A 0A FC F4 BB 80 00 00 0B 33 87 FE', 0x87),
]

print("\n" + "="*80)
print("🔬 EXPLORING CHECKSUM CALCULATIONS")
print("="*80)

for name, hex_str, expected in test_commands:
    data = bytes.fromhex(hex_str.replace(" ", ""))
    print(f"\n{name}: Expected checksum = 0x{expected:02X}")
    print(f"Full packet: {' '.join(f'{b:02X}' for b in data)}")
    print()

    # Try various interpretations
    tests = []

    # Method 1: Sum all bytes before checksum
    sum_all = sum(data[0:14]) & 0xFF
    tests.append(("Sum all bytes before CRC", sum_all))

    # Method 2: Sum bytes after header (exclude EF)
    sum_no_header = sum(data[1:14]) & 0xFF
    tests.append(("Sum (no header EF)", sum_no_header))

    # Method 3: Sum command + length + payload
    sum_cmd_payload = sum(data[1:4]) + sum(data[4:14]) & 0xFF
    tests.append(("Sum (cmd + len + payload)", sum_cmd_payload))

    # Method 4: Length + sum(payload with first 0x0A)
    length = data[3]
    payload_with = data[4:14]
    method4 = (length + sum(payload_with)) & 0xFF
    tests.append(("Len + sum(payload[4:14])", method4))

    # Method 5: Length + sum(payload without first 0x0A)
    payload_without = data[5:14]
    method5 = (length + sum(payload_without)) & 0xFF
    tests.append(("Len + sum(payload[5:14])", method5))

    # Method 6: XOR instead of sum
    xor_payload = data[3]
    for b in data[4:14]:
        xor_payload ^= b
    tests.append(("XOR (len ^ payload)", xor_payload))

    # Method 7: Sum with different byte ranges
    method7 = (sum(data[3:14])) & 0xFF
    tests.append(("Sum(data[3:14])", method7))

    # Method 8: Command bytes involved?
    method8 = (data[1] + data[2] + sum(data[4:14])) & 0xFF
    tests.append(("CMD1+CMD2+sum(payload)", method8))

    for desc, result in tests:
        match = "✅" if result == expected else "  "
        print(f"{match} {desc:30s} = 0x{result:02X}")

print("\n" + "="*80)
