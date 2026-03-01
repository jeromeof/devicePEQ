#!/usr/bin/env python3
"""
Cambrian ANC Headphones - Command Line Interface
Connects via Bluetooth LE to control EQ presets

⚠️  PROTOCOL NOT YET CAPTURED ⚠️
This is a TEMPLATE file. You need to capture the actual Bluetooth protocol first.
See PROTOCOL_CAPTURE_GUIDE.md for detailed instructions.
"""

import asyncio
import struct
import sys
from typing import List, Optional
from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice

# ============================================================================
# ✅ CONFIRMED SERVICE UUID / ⚠️ CHARACTERISTIC UUIDs ARE EDUCATED GUESSES
# ============================================================================
# From Flutter analysis of RoseLink APK:
# - Service UUID 00007034 is CONFIRMED (found in libapp.so)
# - Write/Notify UUIDs are educated guesses (common patterns)
#
# If connection works but characteristics fail, try:
# - 00007035, 00007036, 00007037, etc.
# - Or follow PROTOCOL_CAPTURE_GUIDE.md for definitive capture
#
SERVICE_UUID = "00007034-0000-1000-8000-00805f9b34fb"  # ✅ CONFIRMED from APK
WRITE_CHAR_UUID = "00007035-0000-1000-8000-00805f9b34fb"  # ⚠️ EDUCATED GUESS (try 7035/7036/7037)
NOTIFY_CHAR_UUID = "00007036-0000-1000-8000-00805f9b34fb"  # ⚠️ EDUCATED GUESS (try 7036/7037/7038)

# ============================================================================
# Device Identification
# ============================================================================
# From Flutter analysis: Device may be called "Cambrian" or "Ceramics-X-7034"
DEVICE_NAME_PREFIXES = ["cambrian", "Cambrian", "CAMBRIAN", "ceramics", "Ceramics", "CERAMICS"]

# Global notification handling
received_data = None
notification_event = asyncio.Event()


# ============================================================================
# 🔴 PLACEHOLDER PROTOCOL - REPLACE WITH CAPTURED COMMANDS
# ============================================================================

def calculate_crc(data: bytes) -> bytes:
    """
    Calculate checksum/CRC for Cambrian protocol

    ⚠️  PLACEHOLDER IMPLEMENTATION

    TODO: Reverse engineer the actual checksum algorithm from captures.
    Common options:
    - Simple XOR of all bytes
    - Sum modulo 256
    - CRC-16 (various polynomials)
    - Custom algorithm (like Ecoute uses)

    For now, using Ecoute's algorithm as placeholder.
    """
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
    """
    Create command to query device state

    ⚠️  PLACEHOLDER IMPLEMENTATION

    TODO: Capture the actual query command from HCI snoop.
    Not all devices support querying current state.
    """
    # Placeholder command structure (similar to Ecoute)
    header = bytes([0xFE, 0x08, 0x00, 0x00, 0x00])
    crc = calculate_crc(header)
    return header + crc


def create_preset_command(preset_id: int) -> bytes:
    """
    Create command to set EQ preset

    Args:
        preset_id: 0=POP, 1=HiFi, 2=Rock

    Returns:
        Complete command bytes with CRC

    ⚠️  PLACEHOLDER IMPLEMENTATION

    TODO: Replace with actual captured commands for each preset.

    From Wireshark, you should have captured three commands like:

    POP (preset_id=0):  AA 55 01 00 XX XX ... CRC
    HiFi (preset_id=1): AA 55 01 01 YY YY ... CRC
    Rock (preset_id=2): AA 55 01 02 ZZ ZZ ... CRC

    Replace the placeholder below with your actual captures.
    """

    # PLACEHOLDER: Generic command structure
    # Format: [Header] [Command] [Preset ID] [Padding] [CRC]
    header = bytes([0xFE, 0x08, 0x00])  # Placeholder header
    command = bytes([0x01])  # Placeholder: "Set EQ Preset" command
    preset_byte = bytes([preset_id])  # Preset ID (0, 1, or 2)
    padding = bytes([0x00] * 3)  # Placeholder padding

    packet = header + command + preset_byte + padding
    crc = calculate_crc(packet)

    return packet + crc


def create_custom_eq_command(bands: List[dict]) -> Optional[bytes]:
    """
    Create command for custom parametric EQ

    Args:
        bands: List of dicts with 'frequency', 'gain', 'q' keys

    Returns:
        Complete command bytes, or None if PEQ not supported

    ⚠️  PLACEHOLDER IMPLEMENTATION

    TODO: Determine if Cambrian ANC supports custom PEQ.

    If the RoseLink app has sliders for individual bands or custom EQ:
    1. Adjust those sliders in the app
    2. Capture the BLE write commands
    3. Analyze the structure
    4. Implement it here

    If only 3 fixed presets exist, return None.

    Typical PEQ command structure:
    [Header] [Cmd] [NumBands] [Band1: Freq Gain Q] [Band2: ...] [CRC]
    """

    # For now, assume PEQ is not supported
    # Remove this check if you discover PEQ commands
    print("⚠️  Custom PEQ not yet implemented - needs protocol capture")
    return None

    # Example structure (commented out):
    # header = bytes([0xFE, 0x08, 0x00, 0x02])  # Custom EQ command
    # num_bands = len(bands)
    # payload = bytes([num_bands])
    #
    # for band in bands:
    #     freq_bytes = struct.pack('>H', int(band['frequency']))  # Big-endian 16-bit
    #     gain_byte = struct.pack('b', int(band['gain'] * 10))  # Signed byte
    #     q_byte = struct.pack('B', int(band['q'] * 10))  # Unsigned byte
    #     payload += freq_bytes + gain_byte + q_byte
    #
    # packet = header + payload
    # crc = calculate_crc(packet)
    # return packet + crc


def parse_response(data: bytes) -> Optional[dict]:
    """
    Parse response from device

    ⚠️  PLACEHOLDER IMPLEMENTATION

    TODO: If device sends responses (via notify characteristic),
    implement parsing here based on captured data.
    """
    if len(data) < 3:
        return None

    # Placeholder: Just return raw bytes
    return {
        "raw": data.hex(),
        "length": len(data)
    }


# ============================================================================
# Bluetooth Communication
# ============================================================================

def notification_handler(sender, data: bytearray):
    """Handle notifications from device"""
    global received_data
    received_data = bytes(data)
    notification_event.set()

    print(f"\n📩 Received notification ({len(data)} bytes):")
    hex_str = ' '.join(f'{b:02X}' for b in data)
    print(f"   Hex: {hex_str}")
    print(f"   Dec: {list(data)}")

    parsed = parse_response(data)
    if parsed:
        print(f"   Parsed: {parsed}")


async def scan_for_devices(timeout: float = 5.0) -> List[BLEDevice]:
    """Scan for Cambrian ANC devices"""
    print(f"🔍 Scanning for Cambrian devices ({timeout}s)...")

    devices = await BleakScanner.discover(timeout=timeout)

    # Filter for Cambrian devices
    cambrian_devices = []
    for device in devices:
        if device.name:
            # Check if name contains any of the Cambrian prefixes
            for prefix in DEVICE_NAME_PREFIXES:
                if prefix in device.name:
                    cambrian_devices.append(device)
                    break
        # Also check for service UUID if available
        elif SERVICE_UUID.lower() in [uuid.lower() for uuid in (device.metadata.get("uuids", []) if hasattr(device, "metadata") else [])]:
            cambrian_devices.append(device)

    return cambrian_devices


async def connect_and_query(device_address: str):
    """Connect to device and query current settings"""
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
            print("\n⚠️  This likely means the placeholder UUID is wrong.")
            print("   Please capture the actual UUID using PROTOCOL_CAPTURE_GUIDE.md")
            print("\nAvailable services:")
            for svc in services:
                print(f"  - {svc.uuid}: {svc.description}")
            return

        print(f"✅ Found service: {SERVICE_UUID}")

        # Get characteristics
        write_char = service.get_characteristic(WRITE_CHAR_UUID)
        notify_char = service.get_characteristic(NOTIFY_CHAR_UUID)

        if not write_char:
            print(f"❌ Write characteristic {WRITE_CHAR_UUID} not found")
            return

        if not notify_char:
            print(f"⚠️  Notify characteristic {NOTIFY_CHAR_UUID} not found")
            print("   Device might not support notifications")
        else:
            print(f"✅ Found notify characteristic: {NOTIFY_CHAR_UUID}")
            await client.start_notify(NOTIFY_CHAR_UUID, notification_handler)
            print("✅ Notifications enabled")

        # Send query command
        print("\n📤 Sending query command...")
        query_cmd = create_query_command()
        hex_str = ' '.join(f'{b:02X}' for b in query_cmd)
        print(f"   Command: {hex_str}")
        print("   ⚠️  This is a placeholder command - may not work!")

        received_data = None
        notification_event.clear()

        try:
            await client.write_gatt_char(WRITE_CHAR_UUID, query_cmd)
            print("✅ Command sent")
        except Exception as e:
            print(f"❌ Write failed: {e}")
            return

        # Wait for response
        print("\n⏳ Waiting for response...")
        try:
            await asyncio.wait_for(notification_event.wait(), timeout=5.0)
            print("✅ Got response!")
        except asyncio.TimeoutError:
            print("⚠️  No response received")
            print("   This is normal if:")
            print("   - Device doesn't support querying")
            print("   - Query command placeholder is incorrect")

        if notify_char:
            await client.stop_notify(NOTIFY_CHAR_UUID)

        print("\n🔌 Disconnected")


async def connect_and_set_preset(device_address: str, preset_id: int, preset_name: str):
    """Connect to device and set EQ preset"""
    global received_data, notification_event

    print(f"\n🔗 Connecting to {device_address}...")

    async with BleakClient(device_address, timeout=10.0) as client:
        if not client.is_connected:
            print("❌ Failed to connect")
            return

        print("✅ Connected!")

        # Get service and characteristic
        service = client.services.get_service(SERVICE_UUID)
        if not service:
            print(f"❌ Service {SERVICE_UUID} not found")
            print("⚠️  Update SERVICE_UUID with captured value!")
            return

        write_char = service.get_characteristic(WRITE_CHAR_UUID)
        if not write_char:
            print(f"❌ Write characteristic not found")
            return

        # Enable notifications if available
        notify_char = service.get_characteristic(NOTIFY_CHAR_UUID)
        if notify_char:
            await client.start_notify(NOTIFY_CHAR_UUID, notification_handler)
            print("✅ Notifications enabled")

        # Create and send preset command
        print(f"\n📤 Setting EQ preset: {preset_name}")
        preset_cmd = create_preset_command(preset_id)
        hex_str = ' '.join(f'{b:02X}' for b in preset_cmd)
        print(f"   Command: {hex_str}")
        print("   ⚠️  This is a placeholder - replace with captured command!")

        received_data = None
        notification_event.clear()

        try:
            await client.write_gatt_char(WRITE_CHAR_UUID, preset_cmd)
            print("✅ Command sent to device")
        except Exception as e:
            print(f"❌ Write failed: {e}")
            return

        # Wait for acknowledgment
        if notify_char:
            try:
                await asyncio.wait_for(notification_event.wait(), timeout=2.0)
                print("✅ Device acknowledged")
            except asyncio.TimeoutError:
                print("⚠️  No acknowledgment (this may be normal)")

            await client.stop_notify(NOTIFY_CHAR_UUID)

        print(f"\n✅ {preset_name} preset applied!")
        print("🔌 Disconnected")


# ============================================================================
# Preset Definitions
# ============================================================================
# These are the 3 fixed presets available on Cambrian ANC
# If you discover the actual EQ curves, document them here

PRESETS = {
    "pop": {
        "id": 0,
        "name": "POP",
        "description": "Pop music preset"
    },
    "hifi": {
        "id": 1,
        "name": "HiFi",
        "description": "High fidelity preset"
    },
    "rock": {
        "id": 2,
        "name": "Rock",
        "description": "Rock music preset"
    }
}


def print_usage():
    """Print usage information"""
    print("""
╔════════════════════════════════════════════════════════════════╗
║       Cambrian ANC Headphones - Command Line Interface         ║
╚════════════════════════════════════════════════════════════════╝

⚠️  IMPORTANT: This tool requires protocol capture first!
    See PROTOCOL_CAPTURE_GUIDE.md for detailed instructions.

USAGE:
    python cambrian_cli.py <command> [options]

COMMANDS:
    scan                    Scan for Cambrian ANC devices

    query <address>         Query current settings (if supported)

    preset <address> <name> Set EQ preset (pop/hifi/rock)

EXAMPLES:
    # Scan for devices
    python cambrian_cli.py scan

    # Query current settings
    python cambrian_cli.py query AA:BB:CC:DD:EE:FF

    # Set POP preset
    python cambrian_cli.py preset AA:BB:CC:DD:EE:FF pop

    # Set HiFi preset
    python cambrian_cli.py preset AA:BB:CC:DD:EE:FF hifi

AVAILABLE PRESETS:
""")
    for key, preset in PRESETS.items():
        print(f"    {key:10s} - {preset['description']}")

    print("""
NOTES:
    - Requires 'bleak' library: pip install bleak
    - Device must be in pairing mode
    - ⚠️  Placeholder protocol - capture real protocol first!

NEXT STEPS:
    1. Follow PROTOCOL_CAPTURE_GUIDE.md to capture Bluetooth data
    2. Update UUIDs at top of this file
    3. Update command structures in create_preset_command()
    4. Test and verify!
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
            print("\n❌ No Cambrian devices found")
            print("   Make sure device is powered on and in pairing mode")
            print("   Device name should contain: " + ", ".join(DEVICE_NAME_PREFIXES))
        else:
            print(f"\n✅ Found {len(devices)} device(s):\n")
            for i, device in enumerate(devices, 1):
                print(f"{i}. {device.name or 'Unknown'}")
                print(f"   Address: {device.address}")
                print(f"   RSSI: {device.rssi} dBm")
                print()

    elif command == "query":
        if len(sys.argv) < 3:
            print("❌ Error: Device address required")
            print("Usage: python cambrian_cli.py query <address>")
            sys.exit(1)

        device_address = sys.argv[2]
        await connect_and_query(device_address)

    elif command == "preset":
        if len(sys.argv) < 4:
            print("❌ Error: Device address and preset name required")
            print("Usage: python cambrian_cli.py preset <address> <preset_name>")
            print(f"Available presets: {', '.join(PRESETS.keys())}")
            sys.exit(1)

        device_address = sys.argv[2]
        preset_name = sys.argv[3].lower()

        if preset_name not in PRESETS:
            print(f"❌ Error: Unknown preset '{preset_name}'")
            print(f"Available presets: {', '.join(PRESETS.keys())}")
            sys.exit(1)

        preset = PRESETS[preset_name]
        await connect_and_set_preset(device_address, preset['id'], preset['name'])

    else:
        print(f"❌ Error: Unknown command '{command}'")
        print_usage()
        sys.exit(1)


if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════════╗
║              ⚠️  PROTOCOL NOT YET CAPTURED ⚠️                  ║
║                                                                ║
║  This tool uses PLACEHOLDER values. To make it work:          ║
║  1. Follow PROTOCOL_CAPTURE_GUIDE.md                          ║
║  2. Capture Bluetooth HCI snoop log                           ║
║  3. Update UUIDs and commands in this file                    ║
╚════════════════════════════════════════════════════════════════╝
    """)

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
