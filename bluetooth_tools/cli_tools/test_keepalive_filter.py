#!/usr/bin/env python3
"""Test keepalive filter patterns"""

# Test patterns from actual captures
keepalive_tx_samples = [
    bytes.fromhex("05 5A 06 00 00 0A 01 E4 E8 03"),
    bytes.fromhex("05 5A 06 00 00 0A 02 E4 E8 03"),
    bytes.fromhex("05 5A 06 00 00 0A 03 E4 E8 03"),
    bytes.fromhex("05 5A 06 00 00 0A FF E4 E8 03"),
]

keepalive_rx_sample = bytes.fromhex("05 5B 02 00 00 0A 03")

non_keepalive_samples = [
    bytes.fromhex("05 5A 4F 03 03 0E 00 04"),  # Command 0x4F
    bytes.fromhex("05 5A 50 03 01 0A 2C E4"),  # Command 0x50
    bytes.fromhex("05 5B 12 00 00 0A 0E 00"),  # Command 0x12
]

def is_keepalive(data):
    """Check if packet is a keepalive (matches JavaScript logic)"""
    if len(data) < 3:
        return False

    # TX keepalive: 05 5A 06 00 00 0A XX E4 E8 03
    if (len(data) == 10 and
        data[0] == 0x05 and data[1] == 0x5A and data[2] == 0x06 and
        data[3] == 0x00 and data[4] == 0x00 and data[5] == 0x0A and
        data[7] == 0xE4 and data[8] == 0xE8 and data[9] == 0x03):
        return True

    # RX keepalive: 05 5B 02 00 00 0A 03
    if (len(data) == 7 and
        data[0] == 0x05 and data[1] == 0x5B and data[2] == 0x02 and
        data[3] == 0x00 and data[4] == 0x00 and data[5] == 0x0A and
        data[6] == 0x03):
        return True

    return False

print("Testing keepalive detection...\n")

print("TX Keepalive samples (should all be TRUE):")
for i, sample in enumerate(keepalive_tx_samples):
    result = is_keepalive(sample)
    status = "✓" if result else "✗"
    hex_str = ' '.join(f'{b:02X}' for b in sample)
    print(f"  {status} Sample {i+1}: {hex_str} -> {result}")

print("\nRX Keepalive sample (should be TRUE):")
result = is_keepalive(keepalive_rx_sample)
status = "✓" if result else "✗"
hex_str = ' '.join(f'{b:02X}' for b in keepalive_rx_sample)
print(f"  {status} {hex_str} -> {result}")

print("\nNon-keepalive samples (should all be FALSE):")
for i, sample in enumerate(non_keepalive_samples):
    result = is_keepalive(sample)
    status = "✓" if not result else "✗"
    hex_str = ' '.join(f'{b:02X}' for b in sample)
    print(f"  {status} Sample {i+1}: {hex_str} -> {result}")

print("\n✅ All tests passed!" if all([
    all(is_keepalive(s) for s in keepalive_tx_samples),
    is_keepalive(keepalive_rx_sample),
    all(not is_keepalive(s) for s in non_keepalive_samples)
]) else "\n❌ Some tests failed!")
