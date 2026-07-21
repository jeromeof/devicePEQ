#!/usr/bin/env python3
"""
Verify the Earfun checksum algorithm found in EarfunSoundProtocolParser.java
Formula: checksum = (payloadLength + sum(payloadBytes)) & 0xFF
"""

def calculate_earfun_checksum(payload_bytes):
    """
    Calculate Earfun checksum

    Args:
        payload_bytes: List/bytes of payload data (includes the length byte at start)

    Returns:
        Checksum byte (0-255)
    """
    # First byte of payload is the length
    payload_length = payload_bytes[0]

    # Sum all payload bytes
    payload_sum = sum(payload_bytes)

    # Checksum = (length + sum) & 0xFF
    checksum = (payload_length + payload_sum) & 0xFF

    return checksum

# Test with captured commands
test_commands = [
    {
        'name': 'Band 1: 31.5Hz @ +9dB',
        'hex': 'EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE',
        'expected_crc': 0xCE
    },
    {
        'name': 'Band 2: 63Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 02 FC F4 00 BD 00 00 0B 33 01 FE',
        'expected_crc': 0x01
    },
    {
        'name': 'Band 3: 125Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 03 FC F4 01 77 00 00 0B 33 BD FE',
        'expected_crc': 0xBD
    },
    {
        'name': 'Band 4: 250Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33 8E FE',
        'expected_crc': 0x8E
    },
    {
        'name': 'Band 5: 500Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 05 FC F4 05 DC 00 00 0B 33 9C FE',
        'expected_crc': 0x9C
    },
    {
        'name': 'Band 6: 1000Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 06 FC F4 0B B8 00 00 0B 33 58 FE',
        'expected_crc': 0x58
    },
    {
        'name': 'Band 7: 2000Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 07 FC F4 17 70 00 00 0B 33 B0 FE',
        'expected_crc': 0xB0
    },
    {
        'name': 'Band 8: 4000Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 08 FC F4 2E E0 00 00 0B 33 20 FE',
        'expected_crc': 0x20
    },
    {
        'name': 'Band 9: 8000Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 09 FC F4 5D C0 00 00 0B 33 40 FE',
        'expected_crc': 0x40
    },
    {
        'name': 'Band 10: 16000Hz @ 0dB',
        'hex': 'EF 20 95 0A 0A 0A FC F4 BB 80 00 00 0B 33 87 FE',
        'expected_crc': 0x87
    },
]

print("\n" + "="*80)
print("🔍 EARFUN CHECKSUM VERIFICATION")
print("="*80)
print("\nFormula: checksum = (payloadLength + sum(payloadBytes)) & 0xFF")
print("Source: EarfunSoundProtocolParser.java:495-499")
print()

all_pass = True

for test in test_commands:
    # Parse hex string
    data = bytes.fromhex(test['hex'].replace(" ", ""))

    # Extract payload (bytes 4 to 14, inclusive)
    # Format: EF 20 95 [PAYLOAD_LEN] [PAYLOAD...] [CRC] FE
    payload = data[4:14]  # 10 bytes: 0A 01 FC F4 00 5E 01 2C 0B 33

    # Calculate checksum
    calculated = calculate_earfun_checksum(payload)
    expected = test['expected_crc']

    match = "✅ PASS" if calculated == expected else "❌ FAIL"
    all_pass = all_pass and (calculated == expected)

    print(f"{match} {test['name']}")
    print(f"     Payload: {' '.join(f'{b:02X}' for b in payload)}")
    print(f"     Payload Length: {payload[0]}")
    print(f"     Payload Sum: {sum(payload)} (0x{sum(payload):X})")
    print(f"     Calculated: 0x{calculated:02X}")
    print(f"     Expected:   0x{expected:02X}")
    print()

print("="*80)
if all_pass:
    print("🎉 SUCCESS! All checksums match!")
    print("✅ Checksum algorithm confirmed!")
else:
    print("❌ Some checksums don't match - algorithm needs adjustment")
print("="*80)
