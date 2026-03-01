#!/usr/bin/env python3
"""
Scan for ALL BLE devices to debug connection issues
"""

import asyncio
from bleak import BleakScanner

async def main():
    print("🔍 Scanning for ALL BLE devices (10 seconds)...\n")

    devices = await BleakScanner.discover(timeout=10.0)

    if not devices:
        print("❌ No BLE devices found at all")
        print("   Make sure Bluetooth is enabled on your Mac")
        return

    print(f"✅ Found {len(devices)} BLE device(s):\n")
    print("="*80)

    for i, device in enumerate(devices, 1):
        print(f"\n{i}. Name: {device.name or '(No name)'}")
        print(f"   Address: {device.address}")

        # RSSI may not be available on macOS
        if hasattr(device, 'rssi') and device.rssi is not None:
            print(f"   RSSI: {device.rssi} dBm")

        # Show UUIDs if available
        if hasattr(device, 'metadata') and device.metadata:
            uuids = device.metadata.get('uuids', [])
            if uuids:
                print(f"   UUIDs:")
                for uuid in uuids[:5]:  # Show first 5
                    print(f"     - {uuid}")
                if len(uuids) > 5:
                    print(f"     ... and {len(uuids)-5} more")

    print("\n" + "="*80)
    print("\nLook for 'écoute', 'ecoute', 'TH1', or similar names above")
    print("If you see your device, try using that exact address with ecoute_cli.py")

if __name__ == "__main__":
    asyncio.run(main())
