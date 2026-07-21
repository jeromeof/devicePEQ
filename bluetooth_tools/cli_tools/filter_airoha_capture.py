#!/usr/bin/env python3
"""
Filter Airoha capture files to remove keepalive packets and show only interesting commands.
"""

import sys
import re

def is_keepalive_packet(lines, start_idx):
    """Check if a packet block is a keepalive packet."""
    # Look for the Hex line
    for i in range(start_idx, min(start_idx + 10, len(lines))):
        if lines[i].startswith("Hex:"):
            hex_data = lines[i].replace("Hex:", "").strip()

            # TX keepalive pattern: 05 5A 06 00 00 0A XX E4 E8 03
            # These are the periodic keepalive packets
            if re.match(r'^05 5A 06 00 00 0A [0-9A-F]{2} E4 E8 03$', hex_data):
                return True

            # RX keepalive pattern: 05 5B 02 00 00 0A 03
            # Short response packets
            if hex_data == "05 5B 02 00 00 0A 03":
                return True

    return False

def filter_capture(input_file, output_file=None, show_keepalive_stats=True):
    """Filter the capture file to remove keepalive packets."""
    with open(input_file, 'r') as f:
        lines = f.readlines()

    filtered_lines = []
    i = 0
    total_packets = 0
    keepalive_packets = 0

    while i < len(lines):
        line = lines[i]

        # Check if this is the start of a packet block
        if "📤 AIROHA TX" in line or "📥 AIROHA RX" in line:
            total_packets += 1
            # Check if this is a keepalive packet
            if is_keepalive_packet(lines, i):
                keepalive_packets += 1
                # Skip until the next separator or packet
                while i < len(lines) and "🔊" not in lines[i]:
                    i += 1
                # Skip the separator line
                if i < len(lines) and "🔊" in lines[i]:
                    i += 1
                continue

        filtered_lines.append(line)
        i += 1

    # Output results
    if output_file:
        with open(output_file, 'w') as f:
            f.writelines(filtered_lines)
        print(f"Filtered capture written to: {output_file}")
    else:
        print(''.join(filtered_lines))

    if show_keepalive_stats:
        print(f"\n📊 Statistics:", file=sys.stderr)
        print(f"Total packets: {total_packets}", file=sys.stderr)
        print(f"Keepalive packets removed: {keepalive_packets}", file=sys.stderr)
        print(f"Interesting packets: {total_packets - keepalive_packets}", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: filter_airoha_capture.py <input_file> [output_file]")
        print("  If output_file is not specified, prints to stdout")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    filter_capture(input_file, output_file)
