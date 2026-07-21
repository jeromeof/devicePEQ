#!/usr/bin/env python3
"""
Earfun Tune Pro Protocol Decoder
Analyzes and decodes captured SPP commands
"""

import sys

# Protocol constants
START_BYTE = 0xEF
END_BYTE = 0xFE
CMD_CATEGORY_EQ = 0x20
CMD_SET_PEQ_BAND = 0x95

STANDARD_FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

def decode_frequency(freq_h, freq_l):
    """Decode frequency from 2-byte big-endian value"""
    freq_value = (freq_h << 8) | freq_l
    frequency_hz = freq_value / 3.0
    return freq_value, frequency_hz

def decode_gain(gain_h, gain_l):
    """Decode gain from 2-byte signed big-endian value"""
    gain_value = (gain_h << 8) | gain_l

    # Convert to signed if necessary
    if gain_value > 32767:
        gain_value = gain_value - 65536

    # Convert to dB (gain_value = dB * 100/3)
    gain_db = gain_value * 3.0 / 100.0
    return gain_value, gain_db

def encode_frequency(frequency_hz):
    """Encode frequency to 2-byte big-endian value"""
    freq_value = int(round(frequency_hz * 3))
    freq_h = (freq_value >> 8) & 0xFF
    freq_l = freq_value & 0xFF
    return freq_h, freq_l

def encode_gain(gain_db):
    """Encode gain (dB) to 2-byte signed big-endian value"""
    gain_value = int(round(gain_db * 100.0 / 3.0))

    # Handle negative values (two's complement)
    if gain_value < 0:
        gain_value = 65536 + gain_value

    gain_h = (gain_value >> 8) & 0xFF
    gain_l = gain_value & 0xFF
    return gain_h, gain_l

def parse_peq_command(data):
    """Parse a PEQ band command (16 bytes)"""
    if len(data) != 16:
        return None

    if data[0] != START_BYTE or data[-1] != END_BYTE:
        return None

    result = {
        'start': data[0],
        'category': data[1],
        'command': data[2],
        'length': data[3],
        'sub_length': data[4],
        'band': data[5],
        'fixed1': data[6],
        'fixed2': data[7],
        'freq_h': data[8],
        'freq_l': data[9],
        'gain_h': data[10],
        'gain_l': data[11],
        'q_h': data[12],
        'q_l': data[13],
        'crc': data[14],
        'end': data[15]
    }

    # Decode frequency and gain
    freq_value, freq_hz = decode_frequency(data[8], data[9])
    gain_value, gain_db = decode_gain(data[10], data[11])
    q_value = (data[12] << 8) | data[13]

    result['freq_value'] = freq_value
    result['frequency_hz'] = freq_hz
    result['gain_value'] = gain_value
    result['gain_db'] = gain_db
    result['q_value'] = q_value

    return result

def build_peq_command(band, frequency_hz, gain_db, crc=0x00):
    """Build a PEQ band command (16 bytes)"""
    # Encode frequency and gain
    freq_h, freq_l = encode_frequency(frequency_hz)
    gain_h, gain_l = encode_gain(gain_db)

    # Build command
    cmd = [
        START_BYTE,
        CMD_CATEGORY_EQ,
        CMD_SET_PEQ_BAND,
        0x0A,  # Length
        0x0A,  # Sub-length
        band,
        0xFC, 0xF4,  # Fixed values
        freq_h, freq_l,
        gain_h, gain_l,
        0x0B, 0x33,  # Q value (fixed)
        crc,  # CRC (placeholder)
        END_BYTE
    ]

    return bytes(cmd)

def analyze_captured_commands(commands_hex):
    """Analyze a list of hex command strings"""
    print("\n" + "="*80)
    print("🎵 EARFUN TUNE PRO - PEQ COMMAND ANALYSIS")
    print("="*80)

    for i, hex_str in enumerate(commands_hex, 1):
        # Parse hex string
        hex_str = hex_str.replace(" ", "").strip()
        data = bytes.fromhex(hex_str)

        result = parse_peq_command(data)
        if not result:
            print(f"\n❌ Command {i}: Invalid format (expected 16 bytes, got {len(data)})")
            continue

        print(f"\n📊 Band {result['band']}:")
        print(f"   Raw: {' '.join(f'{b:02X}' for b in data)}")
        print(f"   Frequency: {result['frequency_hz']:.1f} Hz (raw: {result['freq_value']}, hex: {result['freq_h']:02X} {result['freq_l']:02X})")
        print(f"   Gain: {result['gain_db']:+.2f} dB (raw: {result['gain_value']}, hex: {result['gain_h']:02X} {result['gain_l']:02X})")
        print(f"   Q Value: {result['q_value']} (hex: 0x{result['q_h']:02X}{result['q_l']:02X})")
        print(f"   CRC: 0x{result['crc']:02X}")

        # Check if frequency matches standard
        expected_freq = STANDARD_FREQS[result['band'] - 1] if result['band'] <= 10 else None
        if expected_freq and abs(result['frequency_hz'] - expected_freq) < 0.5:
            print(f"   ✅ Matches standard band {result['band']} frequency")
        elif expected_freq:
            print(f"   ⚠️  Expected {expected_freq} Hz for band {result['band']}")

    print("\n" + "="*80)

def analyze_crc_pattern(commands_hex):
    """Analyze CRC pattern across captured commands"""
    print("\n" + "="*80)
    print("🔍 CRC PATTERN ANALYSIS")
    print("="*80)

    crc_data = []

    for hex_str in commands_hex:
        hex_str = hex_str.replace(" ", "").strip()
        data = bytes.fromhex(hex_str)

        if len(data) == 16:
            command_bytes = data[0:14]  # Everything before CRC
            crc_byte = data[14]
            crc_data.append((command_bytes, crc_byte))

    if not crc_data:
        print("❌ No valid commands to analyze")
        return

    print(f"\n📊 Analyzing {len(crc_data)} commands:")
    print()

    for i, (cmd, crc) in enumerate(crc_data, 1):
        # Try simple algorithms
        xor_all = 0
        sum_all = 0

        for b in cmd:
            xor_all ^= b
            sum_all += b

        sum_mod256 = sum_all & 0xFF
        sum_complement = (~sum_all) & 0xFF

        print(f"Command {i}:")
        print(f"  CRC: 0x{crc:02X}")
        print(f"  XOR all bytes: 0x{xor_all:02X} {'✓' if xor_all == crc else ''}")
        print(f"  SUM mod 256: 0x{sum_mod256:02X} {'✓' if sum_mod256 == crc else ''}")
        print(f"  ~SUM mod 256: 0x{sum_complement:02X} {'✓' if sum_complement == crc else ''}")
        print()

    print("="*80)

def generate_test_commands():
    """Generate test commands for verification"""
    print("\n" + "="*80)
    print("🧪 TEST COMMANDS GENERATOR")
    print("="*80)

    test_cases = [
        ("Band 1: 31.5Hz @ +9dB", 1, 31.5, 9.0),
        ("Band 1: 31.5Hz @ +6dB", 1, 31.5, 6.0),
        ("Band 1: 31.5Hz @ +3dB", 1, 31.5, 3.0),
        ("Band 1: 31.5Hz @ 0dB", 1, 31.5, 0.0),
        ("Band 1: 31.5Hz @ -3dB", 1, 31.5, -3.0),
        ("Band 1: 31.5Hz @ -6dB", 1, 31.5, -6.0),
        ("Band 6: 1000Hz @ +12dB", 6, 1000, 12.0),
        ("Band 10: 16000Hz @ +12dB", 10, 16000, 12.0),
    ]

    print("\n📋 To verify encoding, capture these test cases in the app:")
    print()

    for description, band, freq, gain in test_cases:
        cmd = build_peq_command(band, freq, gain)
        print(f"{description}:")
        print(f"   Expected: {' '.join(f'{b:02X}' for b in cmd)} (CRC placeholder)")

        # Show expected values
        freq_h, freq_l = encode_frequency(freq)
        gain_h, gain_l = encode_gain(gain)
        freq_value = (freq_h << 8) | freq_l
        gain_value = (gain_h << 8) | gain_l
        if gain_value > 32767:
            gain_value = gain_value - 65536

        print(f"   Frequency: {freq_h:02X} {freq_l:02X} = {freq_value} = {freq}Hz * 3")
        print(f"   Gain: {gain_h:02X} {gain_l:02X} = {gain_value} = {gain}dB * 100/3")
        print()

    print("="*80)

def main():
    # The 10 captured commands from user's test (31.5Hz @ +9dB, rest @ 0dB)
    captured_commands = [
        "EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33 CE FE",  # Band 1: +9dB
        "EF 20 95 0A 0A 02 FC F4 00 BD 00 00 0B 33 01 FE",  # Band 2: 0dB
        "EF 20 95 0A 0A 03 FC F4 01 77 00 00 0B 33 BD FE",  # Band 3: 0dB
        "EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33 8E FE",  # Band 4: 0dB
        "EF 20 95 0A 0A 05 FC F4 05 DC 00 00 0B 33 9C FE",  # Band 5: 0dB
        "EF 20 95 0A 0A 06 FC F4 0B B8 00 00 0B 33 58 FE",  # Band 6: 0dB
        "EF 20 95 0A 0A 07 FC F4 17 70 00 00 0B 33 B0 FE",  # Band 7: 0dB
        "EF 20 95 0A 0A 08 FC F4 2E E0 00 00 0B 33 20 FE",  # Band 8: 0dB
        "EF 20 95 0A 0A 09 FC F4 5D C0 00 00 0B 33 40 FE",  # Band 9: 0dB
        "EF 20 95 0A 0A 0A FC F4 BB 80 00 00 0B 33 87 FE",  # Band 10: 0dB
    ]

    # Analyze captured commands
    analyze_captured_commands(captured_commands)

    # Analyze CRC pattern
    analyze_crc_pattern(captured_commands)

    # Generate test commands
    generate_test_commands()

    print("\n💡 Next Steps:")
    print("   1. Capture commands with different gain values to verify encoding")
    print("   2. Use CRC analysis above to identify the checksum algorithm")
    print("   3. Test if Q value (0x0B33 = 2867) can be changed")
    print("   4. Look for other command types (volume, ANC, preset save, etc.)")
    print()

if __name__ == "__main__":
    main()
