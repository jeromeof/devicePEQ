#!/usr/bin/env python3
"""
Airoha EQ Tool

Generates Airoha protocol commands for reading/writing parametric EQ settings.
Based on reverse engineering of Audeze app communication.
"""

import sys
from dataclasses import dataclass
from typing import List

@dataclass
class PEQBand:
    """Parametric EQ band configuration"""
    frequency: int  # Hz
    gain: float  # dB
    bandwidth: int  # Hz (or Q factor)
    filter_type: int = 0x01
    filter_order: int = 0x02

    def to_bytes(self) -> bytes:
        """Convert band to 18-byte Airoha format"""
        # Structure:
        # [0-1]: filter type, order
        # [2-5]: frequency (32-bit LE, Hz)
        # [6-9]: gain (32-bit LE, signed, 1/100 dB)
        # [10-13]: bandwidth or Q (32-bit LE)
        # [14-17]: constant 0xC8 (200)

        data = bytearray(18)
        data[0] = self.filter_type
        data[1] = self.filter_order

        # Frequency
        freq_bytes = self.frequency.to_bytes(4, byteorder='little', signed=False)
        data[2:6] = freq_bytes

        # Gain (convert dB to 1/100 units)
        gain_raw = int(self.gain * 100)
        gain_bytes = gain_raw.to_bytes(4, byteorder='little', signed=True)
        data[6:10] = gain_bytes

        # Bandwidth or Q
        bw_bytes = self.bandwidth.to_bytes(4, byteorder='little', signed=False)
        data[10:14] = bw_bytes

        # Constant
        data[14:18] = b'\xC8\x00\x00\x00'

        return bytes(data)

    def __str__(self):
        return f"{self.frequency:6d} Hz, {self.gain:+6.2f} dB, BW={self.bandwidth:5d} Hz"

def calculate_checksum(data: bytes) -> int:
    """Calculate Airoha checksum (sum of all bytes & 0xFF)"""
    return sum(data) & 0xFF

def build_read_preset_command(preset_num: int) -> bytes:
    """
    Build command to read EQ preset

    Args:
        preset_num: Preset number (0-3)

    Returns:
        Complete Airoha packet
    """
    # Format: 05 5A 06 00 00 0A [preset] EF E8 03
    # Where preset is 0x00-0x03
    if preset_num < 0 or preset_num > 3:
        raise ValueError("Preset must be 0-3")

    payload = bytes([0x00, 0x00, 0x0A, preset_num, 0xEF, 0xE8, 0x03])
    header = bytes([0x05, 0x5A, 0x06])  # Header, Type, Command

    packet = header + payload
    # Note: The checksum in the captures appears broken, might not be needed

    return packet

def build_activate_preset_command(preset_num: int) -> bytes:
    """
    Build command to activate/switch to an EQ preset

    Args:
        preset_num: Preset number (0-3, typically 1=Audeze/flat, 0=Immersive)

    Returns:
        Complete Airoha packet
    """
    # Format: 05 5A 06 00 00 0A [preset] E4 E8 03
    # This was confirmed from captures when switching presets
    if preset_num < 0 or preset_num > 3:
        raise ValueError("Preset must be 0-3")

    payload = bytes([0x00, 0x00, 0x0A, preset_num, 0xE4, 0xE8, 0x03])
    header = bytes([0x05, 0x5A, 0x06])  # Header, Type, Command

    packet = header + payload

    return packet

def build_write_preset_command(preset_num: int, bands: List[PEQBand], enabled: bool = True) -> bytes:
    """
    Build command to write EQ preset (EXPERIMENTAL - not yet verified!)

    This is reverse-engineered and may not work without additional protocol analysis.
    The write command format is not yet confirmed from captures.

    Args:
        preset_num: Preset number (0-3)
        bands: List of PEQ bands to configure
        enabled: Whether to enable the preset

    Returns:
        Complete Airoha packet (theoretical format)
    """
    # Theoretical format based on read response structure:
    # Header: 05 5A [length] 00 00 0A [subcommand] [enable] [padding] ...
    # Followed by band data

    # Build payload
    payload = bytearray()
    payload.extend(b'\x00\x00\x0A')

    # Subcommand for write might be 0x20-0x23 or similar (unknown!)
    # Using 0x20 + preset_num as a guess
    write_subcommand = 0x20 + preset_num
    payload.append(write_subcommand)

    # Enable flag
    payload.append(0x01 if enabled else 0x00)

    # Padding to match read response format
    payload.extend(b'\x00\x00\x00\x00')

    # Add each band
    for band in bands:
        payload.extend(band.to_bytes())

    # Pad to match 193 byte total packet size if needed
    total_size = len(payload) + 3  # +3 for header
    if total_size < 193:
        payload.extend(b'\x00' * (193 - total_size))

    # Build packet
    length = len(payload)
    header = bytes([0x05, 0x5A, length])
    packet = header + bytes(payload)

    return packet

def create_audeze_preset() -> List[PEQBand]:
    """Create the Audeze (flat) preset"""
    return [
        PEQBand(3200, 0.0, 1600),
        PEQBand(6400, 0.0, 3200),
        PEQBand(12500, 0.0, 6250),
        PEQBand(25000, 0.0, 12500),
    ]

def create_immersive_preset() -> List[PEQBand]:
    """Create the Immersive preset based on capture"""
    return [
        PEQBand(3200, +6.0, 1600),
        PEQBand(6400, -3.0, 3200),
        PEQBand(12500, +3.0, 6250),
        PEQBand(25000, -2.0, 12500),
    ]

def create_custom_preset() -> List[PEQBand]:
    """Create a custom preset (example)"""
    return [
        PEQBand(100, +2.0, 100),
        PEQBand(1000, -1.5, 500),
        PEQBand(5000, +3.0, 2500),
        PEQBand(10000, -2.0, 5000),
    ]

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python airoha_eq_tool.py read <preset_num>")
        print("  python airoha_eq_tool.py activate <preset_num>")
        print("  python airoha_eq_tool.py write <preset_num> <preset_type>")
        print("  python airoha_eq_tool.py custom <preset_num> <freq1,gain1,bw1> [<freq2,gain2,bw2> ...]")
        print()
        print("Examples:")
        print("  python airoha_eq_tool.py read 0           # Read preset 0 (Immersive)")
        print("  python airoha_eq_tool.py activate 1       # Switch to preset 1 (Audeze/flat)")
        print("  python airoha_eq_tool.py write 0 immersive")
        print("  python airoha_eq_tool.py write 1 audeze")
        print("  python airoha_eq_tool.py custom 2 3200,2.5,1600 6400,-1.0,3200")
        print()
        print("Known presets:")
        print("  0 = Immersive (+6/-3/+3/-2 dB)")
        print("  1 = Audeze/Flat (all 0 dB)")
        print("  2 = Unknown (-3/-2/-1/0 dB)")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'read':
        if len(sys.argv) < 3:
            print("Error: Missing preset number")
            sys.exit(1)

        preset_num = int(sys.argv[2])
        cmd = build_read_preset_command(preset_num)

        print(f"Read EQ Preset {preset_num} command:")
        print(f"Hex: {cmd.hex(' ').upper()}")
        print(f"Length: {len(cmd)} bytes")
        print()
        print("Send this via Bluetooth SPP to query the preset.")

    elif command == 'activate':
        if len(sys.argv) < 3:
            print("Error: Missing preset number")
            sys.exit(1)

        preset_num = int(sys.argv[2])
        cmd = build_activate_preset_command(preset_num)

        preset_names = {
            0: "Immersive (+6/-3/+3/-2 dB)",
            1: "Audeze/Flat (all 0 dB)",
            2: "Unknown (-3/-2/-1/0 dB)",
            3: "Unknown"
        }

        print(f"Activate EQ Preset {preset_num} command:")
        print(f"Preset: {preset_names.get(preset_num, 'Unknown')}")
        print()
        print(f"Hex: {cmd.hex(' ').upper()}")
        print(f"Length: {len(cmd)} bytes")
        print()
        print("This command switches to the specified preset.")
        print("It was confirmed from Audeze app captures.")

    elif command == 'write':
        if len(sys.argv) < 4:
            print("Error: Missing preset number or type")
            sys.exit(1)

        preset_num = int(sys.argv[2])
        preset_type = sys.argv[3].lower()

        if preset_type == 'audeze':
            bands = create_audeze_preset()
        elif preset_type == 'immersive':
            bands = create_immersive_preset()
        else:
            print(f"Error: Unknown preset type '{preset_type}'")
            print("Available: audeze, immersive")
            sys.exit(1)

        cmd = build_write_preset_command(preset_num, bands, enabled=True)

        print(f"Write EQ Preset {preset_num} ({preset_type}) command:")
        print(f"WARNING: This is EXPERIMENTAL and may not work!")
        print(f"The write command format has not been verified from captures.")
        print()
        print(f"Hex: {cmd.hex(' ').upper()}")
        print(f"Length: {len(cmd)} bytes")
        print()
        print("Bands:")
        for i, band in enumerate(bands):
            print(f"  Band {i}: {band}")

    elif command == 'custom':
        if len(sys.argv) < 4:
            print("Error: Missing preset number or band data")
            sys.exit(1)

        preset_num = int(sys.argv[2])
        bands = []

        for band_spec in sys.argv[3:]:
            parts = band_spec.split(',')
            if len(parts) != 3:
                print(f"Error: Invalid band format '{band_spec}'. Use: freq,gain,bw")
                sys.exit(1)

            freq = int(parts[0])
            gain = float(parts[1])
            bw = int(parts[2])
            bands.append(PEQBand(freq, gain, bw))

        cmd = build_write_preset_command(preset_num, bands, enabled=True)

        print(f"Write Custom EQ Preset {preset_num} command:")
        print(f"WARNING: This is EXPERIMENTAL and may not work!")
        print()
        print(f"Hex: {cmd.hex(' ').upper()}")
        print(f"Length: {len(cmd)} bytes")
        print()
        print("Bands:")
        for i, band in enumerate(bands):
            print(f"  Band {i}: {band}")

    else:
        print(f"Error: Unknown command '{command}'")
        print("Use: read, write, or custom")
        sys.exit(1)

if __name__ == '__main__':
    main()
