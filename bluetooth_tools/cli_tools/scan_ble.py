#!/usr/bin/env python3
"""
BLE Device Scanner - Universal Bluetooth Low Energy discovery tool

Features:
- Scan for BLE devices
- Filter by name, address, RSSI
- Discover services and characteristics
- Identify audio/EQ-related services
- Export device info for further analysis

Usage:
    python3 scan_ble.py                          # Scan all devices
    python3 scan_ble.py --name "Moondrop"        # Filter by name
    python3 scan_ble.py --address AA:BB:CC...    # Specific device
    python3 scan_ble.py --services               # Show all services
    python3 scan_ble.py --analyze "Device Name"  # Deep dive on device
"""

import asyncio
import argparse
import sys
from datetime import datetime

try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    print("Error: bleak not installed")
    print("Install with: pip install bleak")
    sys.exit(1)

# Known audio/EQ-related service UUIDs
KNOWN_SERVICES = {
    # Standard Bluetooth Services
    "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service",
    "0000180a-0000-1000-8000-00805f9b34fb": "Device Information",
    "00001800-0000-1000-8000-00805f9b34fb": "Generic Access",
    "00001801-0000-1000-8000-00805f9b34fb": "Generic Attribute",

    # Common Audio Services
    "0000110b-0000-1000-8000-00805f9b34fb": "Audio Sink",
    "0000110a-0000-1000-8000-00805f9b34fb": "Audio Source",

    # Common Custom Services (pattern matching)
    "ff": "Vendor Specific (likely audio control)",
    "fe": "Vendor Specific",

    # Airoha common patterns
    "00001601-0000-1000-8000-00805f9b34fb": "Airoha Custom Service",
    "00001602-0000-1000-8000-00805f9b34fb": "Airoha Custom Service",
}

class BLEScanner:
    def __init__(self):
        self.devices = []  # List of (device, rssi) tuples

    async def scan(self, timeout=10, name_filter=None, rssi_threshold=-80):
        """Scan for BLE devices"""
        print(f"🔍 Scanning for BLE devices ({timeout}s)...")
        if name_filter:
            print(f"   Filtering by name: {name_filter}")

        devices = await BleakScanner.discover(timeout=timeout, return_adv=True)

        for address, (device, adv_data) in devices.items():
            # Get RSSI from advertisement data
            rssi = adv_data.rssi if hasattr(adv_data, 'rssi') else 0

            if rssi_threshold and rssi < rssi_threshold:
                continue

            if name_filter and name_filter.lower() not in (device.name or "").lower():
                continue

            # Store device with RSSI info as tuple
            self.devices.append((device, rssi))

        return self.devices

    def display_devices(self, verbose=False):
        """Display discovered devices"""
        if not self.devices:
            print("❌ No devices found")
            return

        print(f"\n{'='*80}")
        print(f"Found {len(self.devices)} device(s)")
        print(f"{'='*80}\n")

        for i, (device, rssi) in enumerate(self.devices, 1):
            name = device.name or "Unknown"
            print(f"{i}. {name}")
            print(f"   Address: {device.address}")
            print(f"   RSSI: {rssi} dBm")

            if verbose and hasattr(device, 'metadata') and device.metadata:
                print(f"   Metadata: {device.metadata}")

            print()

    async def analyze_device(self, address_or_name):
        """Deep analysis of a specific device"""
        device = None
        device_rssi = 0
        device_name = "Unknown"

        # Check if input looks like a UUID/address (contains hyphens or colons)
        looks_like_address = "-" in address_or_name or ":" in address_or_name

        # Find device by address or name in cache
        for dev, rssi in self.devices:
            if address_or_name.lower() in (dev.address or "").lower():
                device = dev
                device_rssi = rssi
                device_name = dev.name or "Unknown"
                break
            if address_or_name.lower() in (dev.name or "").lower():
                device = dev
                device_rssi = rssi
                device_name = dev.name or "Unknown"
                break

        # If looks like address and not found in cache, use it directly
        if not device and looks_like_address:
            print(f"Using address directly: {address_or_name}")
            device_address = address_or_name
        elif device:
            device_address = device.address
        else:
            print(f"❌ Device '{address_or_name}' not found")
            return

        print(f"\n{'='*80}")
        print(f"Analyzing: {device_name}")
        print(f"{'='*80}\n")
        print(f"Address: {device_address}")
        if device_rssi:
            print(f"RSSI: {device_rssi} dBm")
        print(f"\n🔗 Connecting to device...\n")

        try:
            async with BleakClient(device_address) as client:
                print(f"✅ Connected!\n")

                # Get services
                services = client.services
                service_list = list(services)
                print(f"{'='*80}")
                print(f"Services ({len(service_list)} found)")
                print(f"{'='*80}\n")

                for service in service_list:
                    service_uuid = str(service.uuid).lower()
                    service_name = KNOWN_SERVICES.get(service_uuid, "Unknown Service")

                    # Check for vendor-specific patterns
                    if service_name == "Unknown Service":
                        if service_uuid.startswith("0000ff"):
                            service_name = "Vendor Specific (0xFF prefix - likely audio)"
                        elif service_uuid.startswith("0000fe"):
                            service_name = "Vendor Specific (0xFE prefix)"

                    print(f"📡 Service: {service_uuid}")
                    print(f"   Name: {service_name}")
                    print(f"   Handle: 0x{service.handle:04x}")

                    # Get characteristics
                    print(f"   Characteristics ({len(service.characteristics)}):")
                    for char in service.characteristics:
                        char_uuid = str(char.uuid).lower()
                        properties = ", ".join(char.properties)

                        print(f"      • {char_uuid}")
                        print(f"        Properties: {properties}")
                        print(f"        Handle: 0x{char.handle:04x}")

                        # Try to read if readable
                        if "read" in char.properties:
                            try:
                                value = await client.read_gatt_char(char.uuid)
                                hex_val = " ".join(f"{b:02X}" for b in value)
                                ascii_val = "".join(chr(b) if 32 <= b < 127 else "." for b in value)
                                print(f"        Value (hex): {hex_val}")
                                print(f"        Value (ascii): {ascii_val}")
                            except Exception as e:
                                print(f"        Read failed: {e}")

                        # Show descriptors
                        if char.descriptors:
                            print(f"        Descriptors ({len(char.descriptors)}):")
                            for desc in char.descriptors:
                                print(f"           - {desc.uuid} (handle: 0x{desc.handle:04x})")

                    print()

                # Identify potential EQ/audio services
                print(f"{'='*80}")
                print(f"🎧 Potential Audio/EQ Services")
                print(f"{'='*80}\n")

                audio_services = []
                for service in service_list:
                    service_uuid = str(service.uuid).lower()

                    # Check for known patterns
                    if (service_uuid.startswith("0000ff") or
                        service_uuid.startswith("0000fe") or
                        "1601" in service_uuid or
                        "1602" in service_uuid or
                        "110a" in service_uuid or
                        "110b" in service_uuid):
                        audio_services.append(service)

                if audio_services:
                    for service in audio_services:
                        print(f"✓ {service.uuid}")
                        print(f"  {len(service.characteristics)} characteristics")

                        # Look for TX/RX pattern (common in audio devices)
                        tx_chars = []
                        rx_chars = []
                        for char in service.characteristics:
                            if "write" in char.properties:
                                tx_chars.append(char)
                            if "notify" in char.properties or "indicate" in char.properties:
                                rx_chars.append(char)

                        if tx_chars:
                            print(f"  TX (write) characteristics: {len(tx_chars)}")
                            for char in tx_chars:
                                print(f"     {char.uuid} - {', '.join(char.properties)}")

                        if rx_chars:
                            print(f"  RX (notify) characteristics: {len(rx_chars)}")
                            for char in rx_chars:
                                print(f"     {char.uuid} - {', '.join(char.properties)}")

                        print()
                else:
                    print("No obvious audio/EQ services found")
                    print("Device may use Classic Bluetooth (SPP) instead of BLE")

        except Exception as e:
            print(f"❌ Connection failed: {e}")
            print(f"\nNote: Device may require pairing first, or may not support BLE GATT")

async def main():
    parser = argparse.ArgumentParser(
        description="BLE Device Scanner - Discover and analyze Bluetooth Low Energy devices",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan all devices
  python3 scan_ble.py

  # Filter by name
  python3 scan_ble.py --name "Moondrop"

  # Deep analysis of specific device
  python3 scan_ble.py --analyze "MOONDROPEDGE"

  # Export device list
  python3 scan_ble.py --export devices.txt

  # Verbose output
  python3 scan_ble.py --verbose
        """
    )

    parser.add_argument("--name", "-n", help="Filter devices by name (case-insensitive)")
    parser.add_argument("--address", "-a", help="Filter by device address")
    parser.add_argument("--rssi", "-r", type=int, default=-80, help="Minimum RSSI threshold (default: -80)")
    parser.add_argument("--timeout", "-t", type=int, default=10, help="Scan timeout in seconds (default: 10)")
    parser.add_argument("--analyze", help="Deep analysis of specific device (by name or address)")
    parser.add_argument("--export", "-e", help="Export device list to file")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")

    args = parser.parse_args()

    scanner = BLEScanner()

    if args.analyze:
        # Quick scan to find device (don't display all devices)
        await scanner.scan(timeout=args.timeout, name_filter=None, rssi_threshold=args.rssi)
        await scanner.analyze_device(args.analyze)
    else:
        # Regular scan
        devices = await scanner.scan(
            timeout=args.timeout,
            name_filter=args.name,
            rssi_threshold=args.rssi
        )

        scanner.display_devices(verbose=args.verbose)

        if args.export:
            with open(args.export, 'w') as f:
                f.write(f"BLE Device Scan - {datetime.now()}\n")
                f.write("="*80 + "\n\n")
                for device, rssi in devices:
                    f.write(f"Name: {device.name or 'Unknown'}\n")
                    f.write(f"Address: {device.address}\n")
                    f.write(f"RSSI: {rssi} dBm\n")
                    f.write("\n")
            print(f"✅ Exported to {args.export}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Scan cancelled by user")
        sys.exit(0)
