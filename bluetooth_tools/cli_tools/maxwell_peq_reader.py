#!/usr/bin/env python3.11
"""
Audeze Maxwell PEQ Reader
Reads parametric EQ settings from Audeze Maxwell headphones via Bluetooth
"""

import sys
import time
import struct
import serial
import serial.tools.list_ports
from typing import Optional, List, Tuple

def find_maxwell_port() -> Optional[str]:
    """Find the Maxwell's Bluetooth serial port"""
    ports = serial.tools.list_ports.comports()

    print("🔍 Available serial ports:")
    for port in ports:
        print(f"  {port.device}: {port.description}")
        # On macOS, Bluetooth devices might show up as cu.* ports
        if 'maxwell' in port.description.lower() or 'audeze' in port.description.lower():
            return port.device

    # Look for generic Bluetooth ports
    for port in ports:
        if 'bluetooth' in port.device.lower():
            print(f"\n💡 Found Bluetooth port: {port.device}")
            return port.device

    return None

def build_read_preset_command(preset_num: int) -> bytes:
    """Build command to read EQ preset (from airoha_eq_tool.py)"""
    if preset_num < 0 or preset_num > 3:
        raise ValueError("Preset must be 0-3")

    payload = bytes([0x00, 0x00, 0x0A, preset_num, 0xEF, 0xE8, 0x03])
    header = bytes([0x05, 0x5A, 0x06])
    packet = header + payload

    return packet

def parse_peq_response(data: bytes) -> List[dict]:
    """Parse PEQ response packet"""
    if len(data) < 193:
        print(f"⚠️  Response too short: {len(data)} bytes (expected 193)")
        return []

    # Check header
    if data[0] != 0x05 or data[1] != 0x5B or data[2] != 0xBD:
        print(f"⚠️  Unexpected header: {data[0]:02X} {data[1]:02X} {data[2]:02X}")
        return []

    # Parse payload
    num_bands = data[5]
    eq_enabled = data[8]

    print(f"\n📊 EQ Status:")
    print(f"  Bands: {num_bands}")
    print(f"  Enabled: {'Yes' if eq_enabled else 'No'}")

    # Parse 10 PEQ filters (each is 18 bytes, starting at byte 13)
    filters = []
    filter_start = 13

    for i in range(num_bands):
        offset = filter_start + (i * 18)
        if offset + 18 > len(data):
            break

        filter_bytes = data[offset:offset+18]

        # Parse filter structure
        filter_type = filter_bytes[0]
        filter_status = filter_bytes[1]

        # Frequency (bytes 2-5, little-endian, units: 0.01 Hz)
        freq_raw = struct.unpack('<I', filter_bytes[2:6])[0]
        freq_hz = freq_raw / 100.0

        # Gain (bytes 6-9, little-endian signed, units: 0.01 dB)
        gain_raw = struct.unpack('<i', filter_bytes[6:10])[0]
        gain_db = gain_raw / 100.0

        # Bandwidth (bytes 10-13)
        bw_raw = struct.unpack('<I', filter_bytes[10:14])[0]
        bw_hz = bw_raw / 100.0

        # Q factor (bytes 14-17)
        q_raw = struct.unpack('<I', filter_bytes[14:18])[0]
        q_value = q_raw / 100.0

        filters.append({
            'index': i,
            'freq_hz': freq_hz,
            'gain_db': gain_db,
            'q_value': q_value,
            'bw_hz': bw_hz
        })

    return filters

def read_peq_from_maxwell(port: str, preset: int = 1) -> None:
    """Read PEQ settings from Maxwell"""
    print(f"\n🎧 Audeze Maxwell PEQ Reader")
    print(f"{'='*60}\n")
    print(f"Port: {port}")
    print(f"Preset: {preset}")

    try:
        # Open serial connection
        print(f"\n🔗 Connecting to {port}...")
        ser = serial.Serial(port, baudrate=115200, timeout=2)
        time.sleep(0.5)

        # Build and send read command
        cmd = build_read_preset_command(preset)
        print(f"📤 Sending read command: {cmd.hex(' ').upper()}")
        ser.write(cmd)

        # Wait for response
        time.sleep(0.5)

        # Read response
        response = ser.read(300)  # Read up to 300 bytes
        print(f"📥 Received {len(response)} bytes")

        if len(response) > 0:
            print(f"Raw data: {response.hex(' ').upper()}\n")

            # Parse response
            filters = parse_peq_response(response)

            if filters:
                print(f"\n{'='*60}")
                print(f"🎵 PEQ Filters (Preset {preset})")
                print(f"{'='*60}\n")
                print(f"{'Band':<6} {'Freq(Hz)':<12} {'Gain(dB)':<12} {'Q':<10}")
                print(f"{'-'*45}")

                for f in filters:
                    print(f"{f['index']:<6} {f['freq_hz']:<12.1f} {f['gain_db']:<+12.2f} {f['q_value']:<10.2f}")
            else:
                print("\n⚠️  No valid filter data received")
        else:
            print("⚠️  No response received from device")

        ser.close()

    except serial.SerialException as e:
        print(f"❌ Serial error: {e}")
        print("\n💡 Troubleshooting:")
        print("  1. Make sure Maxwell is connected and paired")
        print("  2. Check if Maxwell creates a serial port when connected")
        print("  3. You may need to pair via System Settings first")
    except Exception as e:
        print(f"❌ Error: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3.11 maxwell_peq_reader.py <port>         # Read preset 1 (Audeze/flat)")
        print("  python3.11 maxwell_peq_reader.py <port> <preset>  # Read specific preset")
        print("  python3.11 maxwell_peq_reader.py scan          # Scan for available ports")
        print()
        print("Presets:")
        print("  0 = Immersive")
        print("  1 = Audeze/Flat (default)")
        print("  2 = Custom preset 1")
        print("  3 = Custom preset 2")
        print()
        print("Example:")
        print("  python3.11 maxwell_peq_reader.py /dev/cu.Maxwell 1")
        sys.exit(1)

    if sys.argv[1] == 'scan':
        print("🔍 Scanning for serial ports...\n")
        ports = serial.tools.list_ports.comports()
        if not ports:
            print("❌ No serial ports found")
        else:
            for port in ports:
                print(f"  {port.device}")
                print(f"    Description: {port.description}")
                print(f"    Hardware ID: {port.hwid}")
                print()
    else:
        port = sys.argv[1]
        preset = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        read_peq_from_maxwell(port, preset)

if __name__ == '__main__':
    main()
