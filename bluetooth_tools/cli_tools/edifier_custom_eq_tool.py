#!/usr/bin/env python3
"""
Edifier Custom EQ Tool - Direct Device Control

Bypasses the Edifier ConnectX app's UI restrictions to set custom EQ bands
with any frequency, gain, and Q values supported by the hardware.

Features:
- Set any frequency from 20Hz to 20kHz (not limited by app UI)
- Full gain range: -6dB to +6dB
- Q value control: 0-100
- Support for all filter types (Peak, Shelf, Pass, Notch, etc.)

Protocol: Edifier V2 (W830NB and compatible devices)
"""

import asyncio
import struct
import sys
from bleak import BleakClient, BleakScanner

# ============================================================================
# PROTOCOL CONSTANTS
# ============================================================================

# Headers
HEADER_SEND = 0xBB
HEADER_RECEIVE = 0xCC
HEADER_ALT = 0xAA
APP_CODE = 0xEC

# Commands
CMD_CUSTOM_EQ_GET = 0x43        # Get current EQ settings
CMD_CUSTOM_EQ_SET_BAND = 0x44   # Set single EQ band
CMD_CUSTOM_EQ_RESET = 0x45      # Reset to default
CMD_CUSTOM_EQ_SET_FULL = 0x46   # Set complete profile

# Filter types
FILTER_TYPES = {
    'peak': 0,      # Peak/Bell (most common)
    'bell': 0,      # Alias for peak
    'lowshelf': 1,  # Low shelf
    'highshelf': 2, # High shelf
    'lowpass': 3,   # Low pass
    'highpass': 4,  # High pass
    'notch': 5,     # Notch/Band-stop
    'allpass': 6,   # All pass
    'bandpass': 7   # Band pass
}

# Service UUID (from documentation)
EDIFIER_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
EDIFIER_WRITE_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
EDIFIER_NOTIFY_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"

# ============================================================================
# PROTOCOL FUNCTIONS
# ============================================================================

def calculate_crc(data):
    """Calculate CRC for Edifier V2 protocol (sum of all bytes & 0xFF)"""
    return sum(data) & 0xFF

def build_command(command, payload=None):
    """Build a complete Edifier V2 command packet"""
    if payload is None:
        payload = []

    # Header + AppCode + Command + Length(2 bytes) + Payload
    length = len(payload)
    packet = [
        HEADER_SEND,
        APP_CODE,
        command,
        (length >> 8) & 0xFF,  # Length high byte
        length & 0xFF          # Length low byte
    ] + payload

    # Add CRC
    crc = calculate_crc(packet)
    packet.append(crc)

    return bytes(packet)

def build_set_band_command(band_index, filter_type, frequency, gain_db, q_value):
    """
    Build command to set a single EQ band

    Args:
        band_index: Band number (0-9, typically 0-3 for 4-band EQ)
        filter_type: Filter type string or index (0-7)
        frequency: Frequency in Hz (20-20000)
        gain_db: Gain in dB (-6.0 to +6.0)
        q_value: Q factor (0-100, typically 10-100)

    Returns:
        Complete command packet as bytes
    """
    # Validate and convert parameters
    if isinstance(filter_type, str):
        filter_type = FILTER_TYPES.get(filter_type.lower(), 0)

    # Clamp values to valid ranges
    band_index = max(0, min(9, band_index))
    filter_type = max(0, min(7, filter_type))
    frequency = max(20, min(20000, int(frequency)))
    gain_db = max(-6.0, min(6.0, float(gain_db)))
    q_value = max(0, min(100, int(q_value)))

    # Convert gain dB to device scale (0-12, where 6 = 0dB)
    gain_device = int(gain_db + 6)

    # Frequency as 16-bit big-endian
    freq_high = (frequency >> 8) & 0xFF
    freq_low = frequency & 0xFF

    # Build payload: [Band, Filter, FreqH, FreqL, Gain, Q]
    payload = [
        band_index,
        filter_type,
        freq_high,
        freq_low,
        gain_device,
        q_value
    ]

    return build_command(CMD_CUSTOM_EQ_SET_BAND, payload)

def parse_eq_response(data):
    """Parse EQ response packet and extract band data"""
    if len(data) < 6:
        return None

    # Verify header and command
    header = data[0]
    app_code = data[1]
    command = data[2]

    if command != CMD_CUSTOM_EQ_GET:
        return None

    # Extract payload length
    payload_length = (data[3] << 8) | data[4]

    # Extract payload (skip header, appcode, cmd, length(2) - read until CRC)
    payload = data[5:5+payload_length]

    # Parse bands (6 bytes each)
    bands = []
    for i in range(0, len(payload), 6):
        if i + 6 <= len(payload):
            band_data = payload[i:i+6]
            band = {
                'index': band_data[0],
                'filter': band_data[1],
                'frequency': (band_data[2] << 8) | band_data[3],
                'gain_db': band_data[4] - 6,
                'q': band_data[5]
            }
            bands.append(band)

    return bands

# ============================================================================
# BLUETOOTH CONNECTION
# ============================================================================

class EdifierController:
    """Controller for Edifier W830NB devices"""

    def __init__(self, device_name=None):
        self.device_name = device_name or "Edifier W830NB"
        self.client = None
        self.device = None

    async def scan_devices(self, timeout=5):
        """Scan for Edifier devices"""
        print(f"🔍 Scanning for Edifier devices (timeout: {timeout}s)...")
        devices = await BleakScanner.discover(timeout=timeout)

        edifier_devices = []
        for device in devices:
            if device.name and "edifier" in device.name.lower():
                edifier_devices.append(device)
                print(f"   Found: {device.name} ({device.address})")

        return edifier_devices

    async def connect(self):
        """Connect to Edifier device"""
        if not self.device:
            devices = await self.scan_devices()
            if not devices:
                raise Exception("No Edifier devices found. Make sure device is powered on and in pairing mode.")
            self.device = devices[0]
            print(f"✅ Selected device: {self.device.name}")

        print(f"📡 Connecting to {self.device.address}...")
        self.client = BleakClient(self.device.address)
        await self.client.connect()
        print("✅ Connected!")

        return True

    async def disconnect(self):
        """Disconnect from device"""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
            print("👋 Disconnected")

    async def write_command(self, command):
        """Send command to device"""
        if not self.client or not self.client.is_connected:
            raise Exception("Not connected to device")

        # Debug output
        hex_str = ' '.join(f'{b:02X}' for b in command)
        print(f"📤 TX: {hex_str}")

        await self.client.write_gatt_char(EDIFIER_WRITE_UUID, command)

        # Wait for response
        await asyncio.sleep(0.2)

    async def read_eq(self):
        """Read current EQ settings"""
        command = build_command(CMD_CUSTOM_EQ_GET)
        await self.write_command(command)

        # Read response
        response = await self.client.read_gatt_char(EDIFIER_NOTIFY_UUID)
        hex_str = ' '.join(f'{b:02X}' for b in response)
        print(f"📥 RX: {hex_str}")

        bands = parse_eq_response(response)
        return bands

    async def set_band(self, band_index, filter_type='peak', frequency=1000, gain_db=0, q_value=50):
        """
        Set a single EQ band

        Args:
            band_index: Band number (0-9)
            filter_type: 'peak', 'lowshelf', 'highshelf', etc.
            frequency: Frequency in Hz (20-20000)
            gain_db: Gain in dB (-6 to +6)
            q_value: Q factor (0-100)
        """
        print(f"\n🎚️  Setting Band {band_index}:")
        print(f"   Filter: {filter_type}")
        print(f"   Frequency: {frequency} Hz")
        print(f"   Gain: {gain_db:+.1f} dB")
        print(f"   Q: {q_value}")

        command = build_set_band_command(band_index, filter_type, frequency, gain_db, q_value)
        await self.write_command(command)
        print("✅ Band updated!")

    async def reset_eq(self):
        """Reset EQ to default settings"""
        print("🔄 Resetting EQ to default...")
        command = build_command(CMD_CUSTOM_EQ_RESET)
        await self.write_command(command)
        print("✅ EQ reset!")

# ============================================================================
# COMMAND LINE INTERFACE
# ============================================================================

async def main():
    """Main CLI function"""
    print("=" * 70)
    print("🎧 Edifier Custom EQ Tool - Direct Device Control")
    print("=" * 70)
    print()

    controller = EdifierController()

    try:
        # Connect to device
        await controller.connect()

        # Show menu
        while True:
            print("\n" + "=" * 70)
            print("MENU:")
            print("  1. Read current EQ settings")
            print("  2. Set custom EQ band")
            print("  3. Set common EQ presets (examples)")
            print("  4. Reset EQ to default")
            print("  0. Exit")
            print("=" * 70)

            choice = input("\nEnter choice: ").strip()

            if choice == '0':
                break

            elif choice == '1':
                print("\n📖 Reading current EQ settings...")
                bands = await controller.read_eq()
                if bands:
                    print("\nCurrent EQ Configuration:")
                    print("-" * 70)
                    for band in bands:
                        filter_name = [k for k, v in FILTER_TYPES.items() if v == band['filter']]
                        filter_name = filter_name[0] if filter_name else f"Type{band['filter']}"
                        print(f"  Band {band['index']}: {band['frequency']:5d} Hz | "
                              f"{band['gain_db']:+3d} dB | Q={band['q']:3d} | {filter_name}")
                    print("-" * 70)

            elif choice == '2':
                print("\n🎚️  Set Custom EQ Band")
                print("-" * 70)

                try:
                    band = int(input("Band index (0-9, typically 0-3 for W830NB): "))
                    freq = int(input("Frequency in Hz (20-20000): "))
                    gain = float(input("Gain in dB (-6.0 to +6.0): "))
                    q = int(input("Q value (10-100, default 50): ") or "50")

                    print("\nFilter types:")
                    for name in ['peak', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'notch']:
                        print(f"  - {name}")
                    filter_type = input("Filter type (default: peak): ").strip() or "peak"

                    await controller.set_band(band, filter_type, freq, gain, q)

                except ValueError as e:
                    print(f"❌ Invalid input: {e}")

            elif choice == '3':
                print("\n📋 Example Presets (bypassing app restrictions)")
                print("-" * 70)
                print("These examples show how to set frequencies that the app UI blocks:")
                print()
                print("1. Bass boost (50Hz on any band)")
                print("2. Presence boost (3kHz on any band)")
                print("3. Treble lift (10kHz on any band)")
                print("4. Custom 4-band V-shape")

                preset = input("\nSelect preset (1-4): ").strip()

                if preset == '1':
                    await controller.set_band(0, 'lowshelf', 50, 4.0, 50)
                    print("✅ Set band 0 to 50Hz low-shelf +4dB (app normally blocks this!)")

                elif preset == '2':
                    await controller.set_band(1, 'peak', 3000, 3.0, 50)
                    print("✅ Set band 1 to 3kHz peak +3dB")

                elif preset == '3':
                    await controller.set_band(2, 'highshelf', 10000, 3.0, 50)
                    print("✅ Set band 2 to 10kHz high-shelf +3dB")

                elif preset == '4':
                    print("\n🎵 Setting 4-band V-shape EQ...")
                    await controller.set_band(0, 'lowshelf', 80, 4.0, 50)
                    await controller.set_band(1, 'peak', 400, -2.0, 50)
                    await controller.set_band(2, 'peak', 3000, -3.0, 50)
                    await controller.set_band(3, 'highshelf', 8000, 4.0, 50)
                    print("✅ V-shape EQ applied (boost bass & treble, cut mids)")

            elif choice == '4':
                confirm = input("⚠️  Reset EQ to default? (y/n): ").strip().lower()
                if confirm == 'y':
                    await controller.reset_eq()

    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

    finally:
        await controller.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
