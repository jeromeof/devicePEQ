#!/usr/bin/env python3
"""
Airoha EQ Capture Analyzer

Analyzes Airoha protocol captures to identify and decode EQ-related packets.
Filters out noise and focuses on parametric EQ data.
"""

import re
import sys
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class AirohaPacket:
    """Represents a parsed Airoha packet"""
    line_num: int
    direction: str  # TX or RX
    length: int
    hex_data: str
    header: int
    type_byte: int
    command: int
    payload: bytes

@dataclass
class EQBand:
    """Represents a single PEQ band"""
    band_num: int
    filter_type: int
    filter_order: int
    frequency: int  # in Hz
    gain: float  # in dB
    q_factor: float

    def __str__(self):
        return f"Band {self.band_num}: {self.frequency:6d} Hz, {self.gain:+6.2f} dB, Q={self.q_factor:.2f} (Type={self.filter_type}, Order={self.filter_order})"

def parse_hex_line(line: str) -> Optional[str]:
    """Extract hex data from a line"""
    match = re.search(r'Hex: ([0-9A-F ]+)', line)
    if match:
        return match.group(1).replace(' ', '')
    return None

def bytes_to_int32_le(data: bytes, offset: int) -> int:
    """Convert 4 bytes to signed 32-bit little-endian integer"""
    if offset + 4 > len(data):
        return 0
    value = int.from_bytes(data[offset:offset+4], byteorder='little', signed=True)
    return value

def bytes_to_uint32_le(data: bytes, offset: int) -> int:
    """Convert 4 bytes to unsigned 32-bit little-endian integer"""
    if offset + 4 > len(data):
        return 0
    value = int.from_bytes(data[offset:offset+4], byteorder='little', signed=False)
    return value

def parse_eq_data(payload: bytes) -> Optional[List[EQBand]]:
    """Parse EQ band data from a 193-byte packet payload"""
    # Expected format: 00 00 0A B9 00 [enable?] ...
    # Followed by repeating band structure

    if len(payload) < 10:
        return None

    # Check if this is an EQ data packet
    if payload[0:2] != b'\x00\x00' or payload[2] != 0x0A or payload[3] != 0xB9:
        return None

    # Byte 5 seems to be enable flag (00 or 01)
    eq_enabled = payload[5] == 0x01

    bands = []
    offset = 10  # Start after header
    band_num = 0

    while offset + 18 <= len(payload):  # Each band is 18 bytes
        # Parse band structure:
        # [0-1]: filter type and order (01 02 seems common - biquad)
        # [2-5]: frequency (32-bit LE, in Hz)
        # [6-9]: gain (32-bit LE, signed, in 1/100 dB)
        # [10-13]: Q factor or bandwidth (32-bit LE)
        # [14-17]: constant (0xC8 = 200, possibly sample rate related)

        filter_type = payload[offset]
        filter_order = payload[offset + 1]

        freq = bytes_to_uint32_le(payload, offset + 2)
        gain_raw = bytes_to_int32_le(payload, offset + 6)
        q_raw = bytes_to_uint32_le(payload, offset + 10)

        # Convert gain from fixed-point to dB (in 1/100 dB units)
        gain_db = gain_raw / 100.0

        # Q factor or bandwidth - appears to be in Hz or 1/100 units
        # Common values: 0x0640 (1600), 0x0C80 (3200)
        # These might be bandwidth in Hz rather than Q
        q_or_bw = q_raw / 100.0 if q_raw > 0 else 0.0

        if freq > 0 and freq < 30000:  # Only add bands with reasonable frequency
            band = EQBand(
                band_num=band_num,
                filter_type=filter_type,
                filter_order=filter_order,
                frequency=freq,
                gain=gain_db,
                q_factor=q_or_bw
            )
            bands.append(band)
            band_num += 1

        offset += 18

    return bands if bands else None

def analyze_capture(filename: str, show_noise: bool = False, diff_mode: bool = False):
    """Analyze the capture file and extract EQ-related packets"""

    with open(filename, 'r') as f:
        lines = f.readlines()

    packets = []
    current_packet = None
    current_direction = None
    current_line = 0

    # Parse all packets
    for i, line in enumerate(lines):
        # Detect packet direction
        if '📤 AIROHA TX' in line:
            current_direction = 'TX'
            current_line = i
        elif '📥 AIROHA RX' in line:
            current_direction = 'RX'
            current_line = i

        # Extract hex data
        hex_match = re.search(r'Hex: ([0-9A-F ]+)', line)
        if hex_match and current_direction:
            hex_str = hex_match.group(1).replace(' ', '')
            hex_bytes = bytes.fromhex(hex_str)

            if len(hex_bytes) >= 3:
                header = hex_bytes[0]
                type_byte = hex_bytes[1]
                command = hex_bytes[2]

                # Look for payload line
                payload_bytes = hex_bytes[3:] if len(hex_bytes) > 3 else b''

                packet = AirohaPacket(
                    line_num=current_line,
                    direction=current_direction,
                    length=len(hex_bytes),
                    hex_data=hex_str,
                    header=header,
                    type_byte=type_byte,
                    command=command,
                    payload=payload_bytes
                )
                packets.append(packet)

    print(f"📊 Analyzed {len(packets)} packets from {filename}\n")

    # Filter and display EQ-related packets
    eq_packets = []
    preset_queries = []
    preset_activations = []
    eq_write_packets = []

    for pkt in packets:
        # Look for EQ query packets (TX with 0x0A in payload)
        if pkt.direction == 'TX' and len(pkt.payload) >= 7:
            # Pattern: 00 00 0A [subcommand] EF E8 03 (read)
            if (pkt.payload[0:2] == b'\x00\x00' and
                pkt.payload[2] == 0x0A and
                pkt.payload[4:7] == b'\xEF\xE8\x03'):
                subcommand = pkt.payload[3]
                preset_queries.append((pkt, subcommand, 'read'))

            # Pattern: 00 00 0A [subcommand] E4 E8 03 (activate/set?)
            elif (pkt.payload[0:2] == b'\x00\x00' and
                  pkt.payload[2] == 0x0A and
                  pkt.payload[4:7] == b'\xE4\xE8\x03'):
                subcommand = pkt.payload[3]
                preset_activations.append((pkt, subcommand))

        # Look for large EQ data packets (RX with 193 bytes)
        if pkt.direction == 'RX' and pkt.length == 193:
            if pkt.payload[0:2] == b'\x00\x00' and pkt.payload[2] == 0x0A:
                eq_packets.append(pkt)

        # Look for potential EQ write packets (TX with 0x0A and large payload)
        if pkt.direction == 'TX' and pkt.length > 50:
            if len(pkt.payload) >= 3 and pkt.payload[0:2] == b'\x00\x00' and pkt.payload[2] == 0x0A:
                eq_write_packets.append(pkt)

    print(f"🎚️  Found {len(preset_queries)} EQ preset READ queries")
    print(f"🎚️  Found {len(eq_packets)} EQ data responses")
    print(f"⚡ Found {len(preset_activations)} preset ACTIVATION commands")
    print(f"✍️  Found {len(eq_write_packets)} potential EQ WRITE commands\n")

    # Display preset activations (most important!)
    if preset_activations:
        print("=" * 80)
        print("PRESET ACTIVATION COMMANDS (TX) - These switch the active EQ!")
        print("=" * 80)
        for pkt, subcommand in preset_activations:
            print(f"Line {pkt.line_num:4d}: Activate Preset {subcommand} - Command: {pkt.hex_data.upper()}")
        print()

    # Display EQ queries
    if preset_queries and not diff_mode:
        print("=" * 80)
        print("EQ PRESET READ QUERIES (TX)")
        print("=" * 80)
        for pkt, subcommand, _ in preset_queries:
            print(f"Line {pkt.line_num:4d}: Subcommand 0x{subcommand:02X} - ", end='')
            if subcommand <= 0x03:
                print(f"Get EQ Preset {subcommand}")
            elif subcommand == 0x10:
                print("Get Current EQ Info")
            elif subcommand == 0x11:
                print("Get EQ Status 1")
            elif subcommand == 0x12:
                print("Get EQ Status 2")
            elif subcommand == 0x13:
                print("Get EQ Status 3")
            else:
                print(f"Unknown EQ Command")
        print()

    # Display potential write commands
    if eq_write_packets:
        print("=" * 80)
        print("POTENTIAL EQ WRITE COMMANDS (TX)")
        print("=" * 80)
        for pkt in eq_write_packets:
            print(f"Line {pkt.line_num:4d}: Length={pkt.length}, Payload starts: {pkt.payload[0:20].hex(' ').upper()}")
        print()

    # Display and parse EQ data
    if eq_packets:
        print("=" * 80)
        print("EQ DATA RESPONSES (RX)")
        print("=" * 80)

        parsed_presets = []
        for i, pkt in enumerate(eq_packets):
            enabled = pkt.payload[5] == 0x01
            bands = parse_eq_data(pkt.payload)
            parsed_presets.append((i, enabled, bands, pkt))

            if not diff_mode:
                print(f"\nPreset {i} (Line {pkt.line_num}): {'ENABLED' if enabled else 'DISABLED'}")
                print(f"Raw header: {pkt.payload[0:10].hex(' ').upper()}")

                if bands:
                    print(f"Bands: {len(bands)}")
                    for band in bands:
                        print(f"  {band}")
                else:
                    print("  (No valid bands or flat response)")
                print("-" * 80)

        # In diff mode, show unique presets only
        if diff_mode:
            print("\nUNIQUE PRESETS (showing only distinct EQ curves):\n")
            seen_configs = {}

            for preset_idx, enabled, bands, pkt in parsed_presets:
                # Create signature from band settings
                if bands:
                    sig = tuple((b.frequency, b.gain, b.q_factor) for b in bands)
                    if sig not in seen_configs:
                        seen_configs[sig] = []
                    seen_configs[sig].append((preset_idx, enabled, pkt.line_num))

            for idx, (sig, occurrences) in enumerate(seen_configs.items()):
                preset_idx, enabled, line_num = occurrences[0]
                bands = parsed_presets[preset_idx][2]

                print(f"Unique Preset #{idx + 1} (appears {len(occurrences)} times):")
                print(f"  First seen: Preset {preset_idx}, Line {line_num}, {'ENABLED' if enabled else 'DISABLED'}")
                if bands:
                    for band in bands:
                        print(f"  {band}")
                print()

    # Show noise packets if requested
    if show_noise:
        print("\n" + "=" * 80)
        print("OTHER PACKETS (potential noise)")
        print("=" * 80)
        noise_count = 0
        for pkt in packets:
            is_eq = False
            if pkt in [p for p, _ in preset_queries]:
                is_eq = True
            if pkt in eq_packets:
                is_eq = True
            if pkt in eq_write_packets:
                is_eq = True

            if not is_eq:
                noise_count += 1
                if noise_count <= 30:  # Limit display
                    print(f"Line {pkt.line_num:4d} [{pkt.direction}]: Cmd=0x{pkt.command:02X}, Len={pkt.length}")

        if noise_count > 30:
            print(f"... and {noise_count - 30} more packets")

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_airoha_eq.py <capture_file> [--show-noise] [--diff]")
        print()
        print("Options:")
        print("  --show-noise  Show non-EQ packets")
        print("  --diff        Show only unique EQ presets (deduplicated)")
        sys.exit(1)

    filename = sys.argv[1]
    show_noise = '--show-noise' in sys.argv
    diff_mode = '--diff' in sys.argv

    try:
        analyze_capture(filename, show_noise, diff_mode)
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found")
        sys.exit(1)
    except Exception as e:
        print(f"Error analyzing capture: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
