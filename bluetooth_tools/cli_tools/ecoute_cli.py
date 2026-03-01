#!/usr/bin/env python3
"""
Ecoute TH1 Headphones - Command Line Interface
Connects via Bluetooth LE to read and write 8-band EQ profiles
"""

import asyncio
import struct
import sys
from typing import List, Optional
from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice

# UUIDs
SERVICE_UUID = "0000ff77-0000-1000-8000-00805f9b34fb"
WRITE_CHAR_UUID = "0000ff88-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR_UUID = "0000ff99-0000-1000-8000-00805f9b34fb"

# EQ Frequencies (Hz) - 8 bands as per Ecoute app
EQ_FREQUENCIES = [30, 100, 200, 500, 900, 5000, 10000, 15000]

# Global to store received notifications
received_data = None
notification_event = asyncio.Event()


def calculate_crc(data: bytes) -> bytes:
    """Calculate custom 16-bit CRC for Ecoute protocol"""
    crc = 0xFFFF

    for byte in data:
        crc = ((crc << 8) | (crc >> 8)) & 0xFFFF
        crc ^= (byte & 0xFF)
        crc ^= ((crc & 0xFF) >> 4) & 0xFFFF
        crc ^= (crc << 12) & 0xFFFF
        crc ^= ((crc & 0xFF) << 5) & 0xFFFF

    high_byte = (crc >> 8) & 0xFF
    low_byte = crc & 0xFF

    return bytes([high_byte, low_byte])


def create_query_command() -> bytes:
    """Create command to query device state"""
    header = bytes([0xFE, 0x08, 0x00, 0x00, 0x00])
    crc = calculate_crc(header)
    return header + crc


def create_eq_command(gain_values: List[float]) -> bytes:
    """
    Create command to write 8-band EQ profile

    Args:
        gain_values: List of 8 float values in dB (-12.0 to +12.0)

    Returns:
        Complete command bytes with CRC
    """
    if len(gain_values) != 8:
        raise ValueError("Must provide exactly 8 gain values")

    # Header: 0xFE, 0x08, 0x00, 0x00, 0x11 (17 decimal = 0x11), 0x65 (EQ command)
    header = bytes([0xFE, 0x08, 0x00, 0x00, 0x11, 0x65])

    # Encode gain values (8 bands × 2 bytes = 16 bytes total)
    encoded_data = bytearray(16)  # 8 bands × 2 bytes

    for i in range(8):
        gain_db = gain_values[i]
        # Convert to signed 16-bit integer (big-endian)
        value = int(round(gain_db * 100))

        # Clamp to safe range
        value = max(-1200, min(1200, value))

        # Pack as signed 16-bit big-endian
        encoded_data[i * 2] = (value >> 8) & 0xFF
        encoded_data[i * 2 + 1] = value & 0xFF

    # Combine header + data
    packet = header + bytes(encoded_data)

    # Calculate and append CRC
    crc = calculate_crc(packet)
    return packet + crc


def parse_eq_response(data: bytes) -> Optional[List[float]]:
    """
    Parse EQ data from device response

    Args:
        data: Raw bytes from notification

    Returns:
        List of gain values in dB, or None if not EQ data
    """
    # Check if this looks like EQ data response
    if len(data) < 10:  # Need at least header + some bands
        return None

    # Look for potential EQ data patterns
    # The response format may vary, but typically starts with 0xFE
    if data[0] != 0xFE:
        return None

    # Check for EQ command identifier (0x65)
    if len(data) > 5 and data[5] != 0x65:
        return None

    # Try to extract band data
    gains = []

    # Skip header bytes (FE 08 00 00 11 65)
    offset = 6

    # Calculate how many bands we have
    # Each band is 2 bytes, last 2 bytes are CRC
    available_bytes = len(data) - offset - 2  # Subtract CRC
    num_bands = available_bytes // 2

    for i in range(min(num_bands, 8)):  # Device sends 8 bands
        if offset + 1 >= len(data) - 2:  # Leave room for CRC
            break

        # Read 16-bit signed big-endian value
        high_byte = data[offset]
        low_byte = data[offset + 1]

        # Combine bytes
        value = (high_byte << 8) | low_byte

        # Convert from unsigned to signed if needed
        if value > 32767:
            value -= 65536

        # Convert to dB
        gain_db = value / 100.0
        gains.append(gain_db)

        offset += 2

    return gains


def notification_handler(sender, data: bytearray):
    """Handle notifications from device"""
    global received_data
    received_data = bytes(data)
    notification_event.set()

    print(f"\n📩 Received notification ({len(data)} bytes):")
    hex_str = ' '.join(f'{b:02X}' for b in data)
    print(f"   Hex: {hex_str}")
    print(f"   Dec: {list(data)}")


def format_eq_display(gains: List[float]) -> str:
    """Format EQ gains for display"""
    output = []
    output.append("\n" + "="*60)
    output.append("🎚️  8-BAND PARAMETRIC EQUALIZER")
    output.append("="*60)

    for i, (freq, gain) in enumerate(zip(EQ_FREQUENCIES, gains)):
        # Format frequency
        if freq >= 1000:
            freq_str = f"{freq//1000}kHz"
        else:
            freq_str = f"{freq}Hz"

        # Create visual bar
        bar_length = int(abs(gain) * 2)  # 2 chars per dB
        if gain > 0:
            bar = "+" + "█" * bar_length
            color = "\033[92m"  # Green
        elif gain < 0:
            bar = "-" + "█" * bar_length
            color = "\033[91m"  # Red
        else:
            bar = " "
            color = "\033[90m"  # Gray

        reset = "\033[0m"

        output.append(
            f"Band {i+1:2d} | {freq_str:>6s} | "
            f"{color}{gain:+6.1f} dB{reset} {bar}"
        )

    output.append("="*60 + "\n")
    return "\n".join(output)


async def scan_for_devices(timeout: float = 5.0) -> List[BLEDevice]:
    """Scan for Ecoute TH1 devices"""
    print(f"🔍 Scanning for devices ({timeout}s)...")

    devices = await BleakScanner.discover(timeout=timeout)

    # Filter for devices with the Ecoute service
    ecoute_devices = []
    for device in devices:
        if device.name and ("ecoute" in device.name.lower() or "th1" in device.name.lower()):
            ecoute_devices.append(device)
        elif SERVICE_UUID.lower() in [uuid.lower() for uuid in (device.metadata.get("uuids", []) if hasattr(device, "metadata") else [])]:
            ecoute_devices.append(device)

    return ecoute_devices


async def connect_and_query(device_address: str):
    """Connect to device and query EQ settings"""
    global received_data, notification_event

    print(f"\n🔗 Connecting to {device_address}...")

    async with BleakClient(device_address, timeout=10.0) as client:
        if not client.is_connected:
            print("❌ Failed to connect")
            return

        print("✅ Connected!")

        # Check if service exists
        services = client.services
        service = services.get_service(SERVICE_UUID)

        if not service:
            print(f"❌ Service {SERVICE_UUID} not found")
            print("\nAvailable services:")
            for svc in services:
                print(f"  - {svc.uuid}: {svc.description}")
            return

        print(f"✅ Found service: {SERVICE_UUID}")

        # Get characteristics
        write_char = service.get_characteristic(WRITE_CHAR_UUID)
        notify_char = service.get_characteristic(NOTIFY_CHAR_UUID)

        if not write_char or not notify_char:
            print("❌ Required characteristics not found")
            return

        print(f"✅ Found write characteristic: {WRITE_CHAR_UUID}")
        print(f"✅ Found notify characteristic: {NOTIFY_CHAR_UUID}")

        # Enable notifications
        await client.start_notify(NOTIFY_CHAR_UUID, notification_handler)
        print("✅ Notifications enabled")

        # Send query command
        print("\n📤 Sending query command...")
        query_cmd = create_query_command()
        hex_str = ' '.join(f'{b:02X}' for b in query_cmd)
        print(f"   Command: {hex_str}")

        received_data = None
        notification_event.clear()

        await client.write_gatt_char(WRITE_CHAR_UUID, query_cmd)
        print("✅ Command sent")

        # Wait for response (with timeout)
        print("\n⏳ Waiting for response...")
        try:
            await asyncio.wait_for(notification_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            print("⚠️  No response received within timeout")
            print("   The device may not send EQ data in response to query.")
            print("   Try using the 'set' command to write a known EQ profile.")

        # Try to parse response
        if received_data:
            gains = parse_eq_response(received_data)
            if gains:
                print(format_eq_display(gains))
            else:
                print("\n⚠️  Could not parse EQ data from response")
                print("   Response format may differ from expected.")

        # Disable notifications (ignore errors on macOS)
        try:
            await client.stop_notify(NOTIFY_CHAR_UUID)
        except Exception as e:
            # macOS sometimes throws an error when stopping notifications during disconnect
            # This is harmless and can be ignored
            pass
        print("\n🔌 Disconnected")


async def connect_and_set_eq(device_address: str, gains: List[float]):
    """Connect to device and set EQ profile"""
    global received_data, notification_event

    print(f"\n🔗 Connecting to {device_address}...")

    async with BleakClient(device_address, timeout=10.0) as client:
        if not client.is_connected:
            print("❌ Failed to connect")
            return

        print("✅ Connected!")

        # Enable notifications
        await client.start_notify(NOTIFY_CHAR_UUID, notification_handler)
        print("✅ Notifications enabled")

        # Create and send EQ command
        print(f"\n📤 Writing EQ profile...")
        print(format_eq_display(gains))

        eq_cmd = create_eq_command(gains)

        received_data = None
        notification_event.clear()

        await client.write_gatt_char(WRITE_CHAR_UUID, eq_cmd)
        print("✅ EQ profile written to device")

        # Wait briefly for acknowledgment
        try:
            await asyncio.wait_for(notification_event.wait(), timeout=2.0)
            print("✅ Device acknowledged")
        except asyncio.TimeoutError:
            print("⚠️  No acknowledgment (this may be normal)")

        try:
            await client.stop_notify(NOTIFY_CHAR_UUID)
        except Exception:
            # Ignore notification stop errors on disconnect
            pass
        print("\n🔌 Disconnected")


# Preset EQ profiles (8 bands: 30Hz, 100Hz, 200Hz, 500Hz, 900Hz, 5kHz, 10kHz, 15kHz)
PRESETS = {
    "flat": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "bass": [6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0],
    "treble": [0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 4.0, 6.0],
    "vshape": [6.0, 4.0, 2.0, -2.0, -2.0, 0.0, 2.0, 4.0],
    "vocal": [0.0, -2.0, -3.0, 4.0, 4.0, 3.0, 0.0, 0.0],
    "acoustic": [3.8, 3.6, 2.8, -0.48, 2.88, -2.15, -6.0, 0.0],
    "rock": [4.5, 3.0, 0.0, 0.0, 1.0, 3.0, 4.0, 4.0],
}


def print_usage():
    """Print usage information"""
    print("""
╔════════════════════════════════════════════════════════════════╗
║         Ecoute TH1 Headphones - Command Line Interface         ║
╚════════════════════════════════════════════════════════════════╝

USAGE:
    python ecoute_cli.py <command> [options]

COMMANDS:
    scan                     Scan for Ecoute TH1 devices

    get <address>           Query and display current EQ settings

    set <address> <preset>  Write preset EQ profile to device

    custom <address> <g1> <g2> ... <g8>
                            Write custom EQ (8 gain values in dB)

EXAMPLES:
    # Scan for devices
    python ecoute_cli.py scan

    # Query current EQ
    python ecoute_cli.py get AA:BB:CC:DD:EE:FF

    # Set bass boost preset
    python ecoute_cli.py set AA:BB:CC:DD:EE:FF bass

    # Set custom EQ (8 bands)
    python ecoute_cli.py custom AA:BB:CC:DD:EE:FF 3 2 1 0 0 0 -1 -2

AVAILABLE PRESETS:
""")
    for name, gains in PRESETS.items():
        gains_str = ", ".join(f"{g:+.1f}" for g in gains[:5]) + ", ..."
        print(f"    {name:12s} - [{gains_str}]")

    print("""
NOTES:
    - Gain values should be between -12.0 and +12.0 dB
    - Use device MAC address or name for <address>
    - Requires 'bleak' library: pip install bleak
""")


async def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "scan":
        devices = await scan_for_devices(timeout=5.0)

        if not devices:
            print("\n❌ No Ecoute devices found")
            print("   Make sure device is powered on and in pairing mode")
        else:
            print(f"\n✅ Found {len(devices)} device(s):\n")
            for i, device in enumerate(devices, 1):
                print(f"{i}. {device.name or 'Unknown'}")
                print(f"   Address: {device.address}")
                print(f"   RSSI: {device.rssi} dBm")
                print()

    elif command == "get":
        if len(sys.argv) < 3:
            print("❌ Error: Device address required")
            print("Usage: python ecoute_cli.py get <address>")
            sys.exit(1)

        device_address = sys.argv[2]
        await connect_and_query(device_address)

    elif command == "set":
        if len(sys.argv) < 4:
            print("❌ Error: Device address and preset name required")
            print("Usage: python ecoute_cli.py set <address> <preset>")
            print(f"Available presets: {', '.join(PRESETS.keys())}")
            sys.exit(1)

        device_address = sys.argv[2]
        preset_name = sys.argv[3].lower()

        if preset_name not in PRESETS:
            print(f"❌ Error: Unknown preset '{preset_name}'")
            print(f"Available presets: {', '.join(PRESETS.keys())}")
            sys.exit(1)

        gains = PRESETS[preset_name]
        await connect_and_set_eq(device_address, gains)

    elif command == "custom":
        if len(sys.argv) < 11:
            print("❌ Error: Device address and 8 gain values required")
            print("Usage: python ecoute_cli.py custom <address> <g1> <g2> ... <g8>")
            sys.exit(1)

        device_address = sys.argv[2]

        try:
            gains = [float(g) for g in sys.argv[3:11]]
        except ValueError:
            print("❌ Error: All gain values must be numbers")
            sys.exit(1)

        # Validate range
        for g in gains:
            if g < -12.0 or g > 12.0:
                print(f"⚠️  Warning: Gain {g} dB is outside safe range (-12 to +12 dB)")

        await connect_and_set_eq(device_address, gains)

    else:
        print(f"❌ Error: Unknown command '{command}'")
        print_usage()
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
