#!/usr/bin/env python3
"""Parse Airoha PEQ packets from eq_packets.txt"""

import struct

def parse_peq_packet(hex_str):
    """Parse a PEQ packet (0x5BBD command)"""
    # Remove spaces and convert to bytes
    hex_bytes = bytes.fromhex(hex_str.replace(' ', ''))

    # Header
    header = hex_bytes[0]
    pkt_type = hex_bytes[1]
    command = hex_bytes[2]
    length = struct.unpack('<H', hex_bytes[3:5])[0]

    print(f"Header: 0x{header:02X}, Type: 0x{pkt_type:02X}, Command: 0x{command:02X}, Length: {length}")

    # Payload starts at byte 5 (skip header, type, cmd, 2-byte length field)
    payload_start = 5

    # Looking at the raw data, the structure after header/type/cmd seems to be:
    # Byte 3-4: 00 00 (length field, often 0)
    # Byte 5: 0A (number of bands = 10)
    # Byte 6: B9 (unknown)
    # Byte 7: 00 (unknown)
    # Byte 8: 01 or 00 (EQ enable/disable or channel?)
    # Byte 9-12: 00 00 00 00 (unknown)
    # Byte 13: start of first filter

    num_bands = hex_bytes[5]
    eq_status = hex_bytes[8]

    print(f"Number of bands: {num_bands}")
    print(f"EQ status byte: 0x{eq_status:02X}")
    print(f"Bytes 5-13: {' '.join(f'{b:02X}' for b in hex_bytes[5:13])}")

    # Parse 10 PEQ filters - each is 18 bytes
    # Filter data starts at byte 13 (0-indexed)
    filter_data_start = 13
    filters = []

    for i in range(10):
        offset = filter_data_start + (i * 18)
        if offset + 18 > len(hex_bytes):
            break

        filter_bytes = hex_bytes[offset:offset+18]

        # Parse filter structure
        # Byte 0-1: Type/Status (01 02 seems common)
        filter_type = filter_bytes[0]
        filter_status = filter_bytes[1]

        # Bytes 2-5: Frequency (little-endian, uint32, units of 0.01Hz)
        freq_raw = struct.unpack('<I', filter_bytes[2:6])[0]
        freq_hz = freq_raw / 100.0

        # Bytes 6-9: Gain (little-endian, int32, units of 0.01dB)
        gain_raw = struct.unpack('<i', filter_bytes[6:10])[0]
        gain_db = gain_raw / 100.0

        # Bytes 10-13: Bandwidth or another parameter (little-endian, uint32)
        bw_raw = struct.unpack('<I', filter_bytes[10:14])[0]
        bw_value = bw_raw / 100.0  # Possibly bandwidth in Hz

        # Bytes 14-17: Q factor (little-endian, uint32, units of 0.01)
        q_raw = struct.unpack('<I', filter_bytes[14:18])[0]
        q_value = q_raw / 100.0

        filters.append({
            'index': i,
            'type': filter_type,
            'status': filter_status,
            'freq_raw': freq_raw,
            'freq_hz': freq_hz,
            'gain_raw': gain_raw,
            'gain_db': gain_db,
            'q_raw': q_raw,
            'q_value': q_value,
            'bw_raw': bw_raw,
            'bw_value': bw_value
        })

    return filters

def main():
    # Test packets from the capture
    test_packets = [
        # Packet with 2dB at 32Hz (filter 0)
        "05 5B BD 00 00 0A B9 00 01 00 00 00 00 01 02 80 0C 00 00 C8 00 00 00 40 06 00 00 C8 00 00 00 01 02 00 19 00 00 00 00 00 00 80 0C 00 00 C8 00 00 00 01 02 D4 30 00 00 00 00 00 00 6A 18 00 00 C8 00 00 00 01 02 A8 61 00 00 00 00 00 00 D4 30 00 00 C8 00 00 00 01 02 50 C3 00 00 00 00 00 00 A8 61 00 00 C8 00 00 00 01 02 A0 86 01 00 00 00 00 00 50 C3 00 00 C8 00 00 00 01 02 40 0D 03 00 00 00 00 00 A0 86 01 00 C8 00 00 00 01 02 80 1A 06 00 00 00 00 00 40 0D 03 00 C8 00 00 00 01 02 00 35 0C 00 00 00 00 00 80 1A 06 00 C8 00 00 00 01 02 00 6A 18 00 00 00 00 00 00 35 0C 00 C8 00 00 00",

        # Packet with 0dB at 32Hz
        "05 5B BD 00 00 0A B9 00 00 00 00 00 00 01 02 80 0C 00 00 00 00 00 00 40 06 00 00 C8 00 00 00 01 02 00 19 00 00 00 00 00 00 80 0C 00 00 C8 00 00 00 01 02 D4 30 00 00 00 00 00 00 6A 18 00 00 C8 00 00 00 01 02 A8 61 00 00 00 00 00 00 D4 30 00 00 C8 00 00 00 01 02 50 C3 00 00 00 00 00 00 A8 61 00 00 C8 00 00 00 01 02 A0 86 01 00 00 00 00 00 50 C3 00 00 C8 00 00 00 01 02 40 0D 03 00 00 00 00 00 A0 86 01 00 C8 00 00 00 01 02 80 1A 06 00 00 00 00 00 40 0D 03 00 C8 00 00 00 01 02 00 35 0C 00 00 00 00 00 80 1A 06 00 C8 00 00 00 01 02 00 6A 18 00 00 00 00 00 00 35 0C 00 C8 00 00 00",

        # Packet with negative dB values
        "05 5B BD 00 00 0A B9 00 00 00 00 00 00 01 02 80 0C 00 00 D4 FE FF FF 40 06 00 00 C8 00 00 00 01 02 00 19 00 00 38 FF FF FF 80 0C 00 00 C8 00 00 00 01 02 D4 30 00 00 9C FF FF FF 6A 18 00 00 C8 00 00 00 01 02 A8 61 00 00 00 00 00 00 D4 30 00 00 C8 00 00 00 01 02 50 C3 00 00 C8 00 00 00 A8 61 00 00 C8 00 00 00 01 02 A0 86 01 00 90 01 00 00 50 C3 00 00 C8 00 00 00 01 02 40 0D 03 00 58 02 00 00 A0 86 01 00 C8 00 00 00 01 02 80 1A 06 00 20 03 00 00 40 0D 03 00 C8 00 00 00 01 02 00 35 0C 00 00 00 00 00 80 1A 06 00 C8 00 00 00 01 02 00 6A 18 00 00 00 00 00 00 35 0C 00 C8 00 00 00"
    ]

    for idx, packet in enumerate(test_packets):
        print(f"\n{'='*80}")
        print(f"Packet {idx + 1}:")
        print(f"{'='*80}")

        filters = parse_peq_packet(packet)

        print(f"\n{'Filter':<8} {'Freq(Hz)':<12} {'Gain(dB)':<12} {'Q':<10} {'BW/Other':<10}")
        print(f"{'-'*60}")

        for f in filters:
            print(f"{f['index']:<8} {f['freq_hz']:<12.1f} {f['gain_db']:<+12.2f} {f['q_value']:<10.2f} {f['bw_value']:<10.2f}")

if __name__ == '__main__':
    main()
