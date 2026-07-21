#!/usr/bin/env python3
"""
Bluetooth Communication Diagnostic Tool

Checks available Bluetooth communication methods and devices without requiring
all dependencies to be installed.
"""

import sys
import asyncio
from typing import List, Dict

print("🔍 Bluetooth Communication Diagnostic")
print("="*70)
print()

# Check pyserial
print("📦 Checking dependencies...")
SERIAL_AVAILABLE = False
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
    print("  ✅ pyserial: Available")
except ImportError:
    print("  ❌ pyserial: Not installed")
    print("     Install: pip install pyserial")

# Check bleak
BLEAK_AVAILABLE = False
try:
    from bleak import BleakScanner, BleakClient
    BLEAK_AVAILABLE = True
    print("  ✅ bleak: Available")
except ImportError:
    print("  ❌ bleak: Not installed")
    print("     Install: pip install bleak")

print()

if SERIAL_AVAILABLE:
    print("🔌 Bluetooth Serial Ports (SPP/RFCOMM)")
    print("-"*70)

    ports = serial.tools.list_ports.comports()
    bt_ports = []

    for port in ports:
        # On macOS, look for cu.* ports (not tty.*)
        if 'cu.' in port.device and port.device != '/dev/cu.Bluetooth-Incoming-Port':
            bt_ports.append(port)

    if bt_ports:
        print(f"Found {len(bt_ports)} Bluetooth serial port(s):\n")

        for port in bt_ports:
            print(f"  📱 {port.device}")
            print(f"     Description: {port.description}")
            print(f"     Hardware ID: {port.hwid}")

            # Highlight potential Audeze/Maxwell devices
            if 'maxwell' in port.device.lower() or 'audeze' in port.description.lower():
                print(f"     ⭐ AUDEZE MAXWELL DETECTED!")

            # Highlight Airoha-based devices (Moondrop, etc.)
            if any(name in port.device.lower() for name in ['moondrop', 'fiio', 'kiwiears']):
                print(f"     💡 Likely Airoha-based device")

            print()
    else:
        print("  ℹ️  No Bluetooth serial ports found")
        print("     (Devices must be paired and connected)")

    print()

async def scan_ble():
    """Scan for BLE devices"""
    if not BLEAK_AVAILABLE:
        return

    print("📡 Bluetooth Low Energy (BLE) Devices")
    print("-"*70)

    try:
        print("Scanning for 10 seconds...\n")
        devices = await BleakScanner.discover(timeout=10, return_adv=True)

        if devices:
            print(f"Found {len(devices)} BLE device(s):\n")

            for address, (device, adv_data) in devices.items():
                name = device.name or "Unknown"
                rssi = adv_data.rssi if hasattr(adv_data, 'rssi') else None

                print(f"  📱 {name}")
                print(f"     Address: {address}")
                if rssi:
                    print(f"     RSSI: {rssi} dBm")

                # Highlight potential Audeze devices
                if 'maxwell' in name.lower() or 'audeze' in name.lower():
                    print(f"     ⭐ AUDEZE MAXWELL DETECTED!")

                print()
        else:
            print("  ℹ️  No BLE devices found")
            print("     (Most audio devices use Classic Bluetooth, not BLE)")

    except Exception as e:
        print(f"  ❌ BLE scan failed: {e}")
        print()
        if "Bluetooth is unsupported" in str(e):
            print("  💡 This may be due to:")
            print("     - Running in a VM or container")
            print("     - Bluetooth adapter not available")
            print("     - macOS permissions not granted")

    print()

if BLEAK_AVAILABLE:
    asyncio.run(scan_ble())

# Summary
print("="*70)
print("📊 Chrome Web API Compatibility")
print("="*70)
print()
print(f"{'Method':<30} {'Available':<15} {'Chrome API':<20}")
print("-"*70)
print(f"{'Serial Port (SPP/RFCOMM)':<30} "
      f"{'✅ Yes' if SERIAL_AVAILABLE else '❌ No':<15} "
      f"{'Web Serial API':<20}")
print(f"{'BLE GATT':<30} "
      f"{'✅ Yes' if BLEAK_AVAILABLE else '❌ No':<15} "
      f"{'Web Bluetooth API':<20}")
print()

if not SERIAL_AVAILABLE:
    print("⚠️  Install pyserial to test Serial Port communication:")
    print("   pip install pyserial")
    print()

if not BLEAK_AVAILABLE:
    print("⚠️  Install bleak to test BLE GATT communication:")
    print("   pip install bleak")
    print()

if SERIAL_AVAILABLE:
    print("💡 Next steps:")
    print("   1. Make sure your Audeze Maxwell is paired and connected")
    print("   2. Run: python3 audeze_maxwell_tester.py")
    print("   3. The script will test both Serial and BLE methods")
    print()
