#!/usr/bin/env python3
"""
Bluetooth Protocol Reverse Engineering Toolkit
CLI tool for Bluetooth protocol analysis and reverse engineering

Usage:
    bluetooth_toolkit.py scan                              # Scan for BLE devices
    bluetooth_toolkit.py analyze <device_name>             # Analyze device services
    bluetooth_toolkit.py test <device_name>                # Test BLE and Serial communication
    bluetooth_toolkit.py test-ble <device_name>            # Test BLE GATT only
    bluetooth_toolkit.py test-serial <device_name>         # Test Serial Port only
    bluetooth_toolkit.py test-edifier <device_name>        # Test Edifier device (SPP/BLE)
    bluetooth_toolkit.py test-sony <device_name>           # Test Sony device (WH-1000XM5)
    bluetooth_toolkit.py capture <package>                 # Capture protocol (universal)
    bluetooth_toolkit.py capture <package> --flutter       # Capture from Flutter app
    bluetooth_toolkit.py capture <package> --airoha        # Capture from Airoha device
    bluetooth_toolkit.py capture <package> --edifier       # Capture from Edifier device
    bluetooth_toolkit.py capture <package> --sony          # Capture from Sony device
    bluetooth_toolkit.py capture <package> --ugreen        # Capture from Ugreen Max5C/RCSP device
    bluetooth_toolkit.py capture <package> -f              # Filter keepalive packets
    bluetooth_toolkit.py capture <package> --script <js>   # Use custom Frida script
    bluetooth_toolkit.py list-apps                         # List Android apps
    bluetooth_toolkit.py doctor                            # Check environment dependencies
    bluetooth_toolkit.py help                              # Show detailed help

Examples:
    bluetooth_toolkit.py scan
    bluetooth_toolkit.py analyze Moondrop
    bluetooth_toolkit.py test Maxwell
    bluetooth_toolkit.py test "Moondrop Edge" --preset 0
    bluetooth_toolkit.py list-apps
    bluetooth_toolkit.py capture com.moondrop.app
    bluetooth_toolkit.py capture com.example.app --flutter
    bluetooth_toolkit.py capture com.audeze.app --airoha --filter-keepalive
"""

import sys
import argparse
import subprocess
import asyncio
import importlib.util
import shutil
from pathlib import Path

def run_command(cmd):
    """Execute a command and handle errors"""
    print(f"🚀 Running: {' '.join(cmd)}\n")
    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\n\n⚠️  Stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Command failed with exit code {e.returncode}")
        sys.exit(e.returncode)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)

def resolve_python(args):
    """Return Python executable for sub-tools"""
    return args.python or sys.executable

def cmd_scan(args):
    """Scan for BLE devices"""
    script = Path(__file__).parent / "scan_ble.py"
    run_command([resolve_python(args), str(script)])

def cmd_analyze(args):
    """Analyze a specific device"""
    script = Path(__file__).parent / "scan_ble.py"
    run_command([resolve_python(args), str(script), "--analyze", args.device_name])

def cmd_capture(args):
    """Capture Bluetooth protocol"""
    script = Path(__file__).parent / "capture_bluetooth.py"
    cmd = [resolve_python(args), str(script), args.package]

    if args.script:
        cmd.extend(["--script", args.script])
    else:
        if args.flutter:
            cmd.extend(["--script", "frida_flutter_eq.js"])
        elif args.airoha:
            cmd.append("--airoha")
        elif args.edifier:
            cmd.append("--edifier")
        elif args.sony:
            cmd.append("--sony")
        elif args.ugreen:
            cmd.append("--ugreen")
        elif args.fiio:
            cmd.append("--fiio")

    if args.output:
        cmd.extend(["--output", args.output])

    if args.filter_keepalive:
        cmd.append("--filter-keepalive")

    run_command(cmd)

def cmd_list_apps(args):
    """List running Android apps"""
    script = Path(__file__).parent / "capture_bluetooth.py"
    run_command([resolve_python(args), str(script), "--list"])

def cmd_test(args):
    """Test device with BLE and Serial communication"""
    try:
        from bluetooth_tester import BluetoothTester

        async def run_test():
            tester = BluetoothTester(verbose=True)
            preset = args.preset if hasattr(args, 'preset') else 1
            results = await tester.test_device(args.device_name, preset)
            tester.print_results_summary(results)

        asyncio.run(run_test())
    except ImportError:
        print("❌ bluetooth_tester module not found")
        print("   Make sure bluetooth_tester.py is in the same directory")
        sys.exit(1)

def cmd_test_ble(args):
    """Test device with BLE GATT only"""
    try:
        from bluetooth_tester import BluetoothTester, BluetoothDevice

        async def run_test():
            tester = BluetoothTester(verbose=True)
            preset = args.preset if hasattr(args, 'preset') else 1

            # Scan for BLE devices only
            devices = await tester.scan_ble_devices(name_filter=args.device_name)

            if not devices:
                print(f"\n❌ No BLE devices found matching '{args.device_name}'")
                return

            results = []
            for device in devices:
                result = await tester.test_ble_airoha(device, preset)
                results.append(result)

            tester.print_results_summary(results)

        asyncio.run(run_test())
    except ImportError:
        print("❌ bluetooth_tester module not found")
        sys.exit(1)

def cmd_test_serial(args):
    """Test device with Serial Port only"""
    try:
        from bluetooth_tester import BluetoothTester

        tester = BluetoothTester(verbose=True)
        preset = args.preset if hasattr(args, 'preset') else 1

        # Scan for serial devices only
        devices = tester.scan_serial_ports(name_filter=args.device_name)

        if not devices:
            print(f"\n❌ No serial ports found matching '{args.device_name}'")
            return

        results = []
        for device in devices:
            result = tester.test_serial_airoha(device, preset)
            results.append(result)

        tester.print_results_summary(results)

    except ImportError:
        print("❌ bluetooth_tester module not found")
        sys.exit(1)

def cmd_test_edifier(args):
    """Test Edifier device (W830NB and ConnectX series)"""
    print("🎧 Edifier Device Tester")
    print("="*80)
    print(f"Testing device: {args.device_name}")
    print("="*80 + "\n")

    try:
        import asyncio
        from edifier_protocol import EdifierProtocol, EdifierEQBand, format_eq_band

        protocol = EdifierProtocol()

        async def test_edifier_device():
            print("📋 Test Plan:")
            print("  1. Get battery level")
            print("  2. Get current volume")
            print("  3. Get EQ preset")
            print("  4. Get Custom EQ bands")
            print("\n" + "="*80)

            # Generate test commands
            print("\n📤 Generated Test Commands:")
            print("\n1️⃣  Get Battery:")
            cmd = protocol.get_battery()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect: BB EC D0 00 01 [battery%] [CRC]")

            print("\n2️⃣  Get Volume:")
            cmd = protocol.get_volume()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect: BB EC 66 00 01 [volume] [CRC]")

            print("\n3️⃣  Get EQ Preset:")
            cmd = protocol.get_eq_preset()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect: BB EC D5 00 01 [preset] [CRC]")

            print("\n4️⃣  Get Custom EQ:")
            cmd = protocol.get_custom_eq()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect: BB EC 43 00 24 [36 bytes] [CRC]")

            print("\n5️⃣  Set Band 0 (1344Hz, +3dB, Q=50, Peak):")
            band = EdifierEQBand(
                band_index=0,
                filter_type=0,
                frequency=1344,
                gain_db=3.0,
                q_value=50
            )
            cmd = protocol.set_custom_eq_band(band)
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   {format_eq_band(band)}")

            print("\n" + "="*80)
            print("\n💡 How to Test:")
            print("  1. Use the Web Serial tester (bluetooth_device_tester.html)")
            print("  2. Or use Frida capture: bluetooth_toolkit.py capture <app> --edifier")
            print("  3. Send these commands and compare responses")

            print("\n📚 Protocol Reference:")
            print("  - TX Header: 0xAA (to device)")
            print("  - RX Header: 0xBB (from device)")
            print("  - AppCode: 0xEC (ConnectX)")
            print("  - Bands: 6 (36 bytes total)")
            print("  - Offset encoding: +0xA0 (160) for EQ data")

        asyncio.run(test_edifier_device())

    except ImportError as e:
        print(f"❌ Error: {e}")
        print("   Make sure edifier_protocol.py is in the same directory")
        sys.exit(1)

def cmd_test_sony(args):
    """Test Sony device (WH-1000XM5 and related models)"""
    print("🎧 Sony Headphones Tester")
    print("="*80)
    print(f"Testing device: {args.device_name}")
    print("="*80 + "\n")

    try:
        import asyncio
        from sony_protocol import SonyProtocol, EQPresetId, format_eq_bands

        protocol = SonyProtocol()

        async def test_sony_device():
            print("📋 Test Plan:")
            print("  1. Get EQ capability")
            print("  2. Get current EQ status")
            print("  3. Get battery level")
            print("  4. Set EQ preset")
            print("  5. Set custom EQ")
            print("\n" + "="*80)

            # Generate test commands
            print("\n📤 Generated Test Commands:")

            print("\n1️⃣  Get EQ Capability:")
            cmd = protocol.get_eq_capability()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect RX: 51 01 [min_gain] [max_gain] [num_presets] ...")

            print("\n2️⃣  Get EQ Status:")
            cmd = protocol.get_eq_status()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect RX: 53 01 [preset_id] [num_bands] [band1] [band2] ...")

            print("\n3️⃣  Get Battery Level:")
            cmd = protocol.get_battery_level()
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   Expect RX: 11 [battery%]")

            print("\n4️⃣  Set Bass Preset:")
            cmd = protocol.set_eq_preset(EQPresetId.BASS)
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")

            print("\n5️⃣  Set Custom EQ (Bass Boost: +8, +5, 0, -2, 0):")
            cmd = protocol.set_custom_eq([8, 5, 0, -2, 0])
            print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
            print(f"   {format_eq_bands([8, 5, 0, -2, 0])}")

            print("\n" + "="*80)
            print("\n💡 How to Test:")
            print("  1. Use the Web Bluetooth tester (bluetooth_device_tester.html)")
            print("  2. Or use Frida capture: bluetooth_toolkit.py capture <app> --sony")
            print("  3. Send these commands and compare responses")

            print("\n📚 Protocol Reference:")
            print(f"  - Service UUID: {protocol.SERVICE_UUID if hasattr(protocol, 'SERVICE_UUID') else 'See sony_protocol.py'}")
            print(f"  - Write Char:   {protocol.WRITE_CHAR_UUID if hasattr(protocol, 'WRITE_CHAR_UUID') else 'See sony_protocol.py'}")
            print(f"  - Notify Char:  {protocol.NOTIFY_CHAR_UUID if hasattr(protocol, 'NOTIFY_CHAR_UUID') else 'See sony_protocol.py'}")
            print("  - EQ Type: Graphic (5-band, fixed frequencies)")
            print("  - Typical bands: 400Hz, 1kHz, 2.5kHz, 6.3kHz, 16kHz")
            print("  - Gain range: -10 to +10 dB")

            print("\n📝 Available Presets:")
            for preset in [EQPresetId.OFF, EQPresetId.ROCK, EQPresetId.POP,
                          EQPresetId.JAZZ, EQPresetId.BASS, EQPresetId.TREBLE,
                          EQPresetId.CUSTOM]:
                print(f"  - 0x{preset.value:02X}: {EQPresetId.get_name(preset.value)}")

        asyncio.run(test_sony_device())

    except ImportError as e:
        print(f"❌ Error: {e}")
        print("   Make sure sony_protocol.py is in the same directory")
        sys.exit(1)

def cmd_doctor(args):
    """Check environment and dependency readiness"""
    print("🩺 Bluetooth Toolkit Doctor")
    print("=" * 80)

    checks = {
        "bleak": importlib.util.find_spec("bleak") is not None,
        "pyserial": importlib.util.find_spec("serial") is not None,
        "frida": importlib.util.find_spec("frida") is not None,
        "frida-tools": importlib.util.find_spec("frida_tools") is not None,
        "adb": shutil.which("adb") is not None,
    }

    for name, ok in checks.items():
        status = "✅" if ok else "❌"
        print(f"{status} {name}")

    print("\nℹ️  Tips")
    print("- Install Python deps: pip install bleak pyserial frida frida-tools")
    print("- Ensure Android device is connected and `adb devices` lists it")
    print("- Start frida-server on device for capture mode")

def cmd_help(args):
    """Show detailed documentation"""
    print("="*80)
    print("📚 Bluetooth Protocol Reverse Engineering Toolkit")
    print("="*80)
    print("""
🔍 WORKFLOW:

1. Scan for Devices
   $ bluetooth_toolkit.py scan
   Find your Bluetooth device and note the device name/address

2. Test Device Communication (NEW!)
   $ bluetooth_toolkit.py test "Device Name"
   Test BLE GATT and Serial Port communication methods
   Identifies which Chrome Web API to use (Web Bluetooth or Web Serial)

   $ bluetooth_toolkit.py test-ble "Device Name"       # BLE GATT only
   $ bluetooth_toolkit.py test-serial "Device Name"    # Serial Port only
   $ bluetooth_toolkit.py test-edifier "EDIFIER W830NB"  # Edifier devices
   $ bluetooth_toolkit.py test-sony "WH-1000XM5"       # Sony devices
   $ bluetooth_toolkit.py test "Maxwell" --preset 0    # Test specific preset

3. Analyze Device (Optional)
   $ bluetooth_toolkit.py analyze "Device Name"
   See BLE services and characteristics, identify potential EQ-related UUIDs

4. Capture Protocol (Android)
   $ bluetooth_toolkit.py list-apps
   $ bluetooth_toolkit.py capture com.package.name

   Connect Android device with frida-server running
   Choose appropriate capture mode:
     --flutter           For Flutter apps with EQ hooks
     --airoha            For Airoha chipset devices (Audeze, Moondrop, FiiO)
     --edifier           For Edifier W830NB and ConnectX devices
     --sony              For Sony WH-1000XM5/XM6 and related models
     --ugreen            For Ugreen Max5C and RCSP protocol devices
     --filter-keepalive  Hide keepalive/heartbeat packets (cleaner output)
     --output            Save to specific file

5. Analyze Captured Data
   Look for packet structure (start bytes, length, command codes)
   Correlate high-level operations with byte changes
   Identify encoding patterns (frequencies, gains, Q factors)

📖 DETAILED DOCS:

See README_TOOLS.md for comprehensive documentation including:
- Complete usage examples
- Troubleshooting guide
- Analysis techniques
- Example protocols

🔗 SETUP:

Required:
- Python packages: bleak, frida, frida-tools
  $ pip install bleak pyserial frida frida-tools

Quick check:
  $ bluetooth_toolkit.py doctor

- Rooted Android device with frida-server
  Download: https://github.com/frida/frida/releases
  Install:
    $ adb push frida-server /data/local/tmp/
    $ adb shell "chmod 755 /data/local/tmp/frida-server"
    $ adb shell "/data/local/tmp/frida-server &"

Optional:
- adb port forwarding: adb forward tcp:27042 tcp:27042

💡 EXAMPLES:

# Scan for nearby BLE devices
$ bluetooth_toolkit.py scan

# Test device communication (BLE + Serial)
$ bluetooth_toolkit.py test "Maxwell"
$ bluetooth_toolkit.py test "Moondrop Edge"
$ bluetooth_toolkit.py test "Maxwell" --preset 0

# Test specific communication method
$ bluetooth_toolkit.py test-ble "Maxwell"        # BLE GATT only
$ bluetooth_toolkit.py test-serial "Maxwell"     # Serial Port only

# Analyze a specific device (BLE services)
$ bluetooth_toolkit.py analyze "Moondrop Edge"

# List running Android apps
$ bluetooth_toolkit.py list-apps

# Capture from standard app
$ bluetooth_toolkit.py capture com.moondrop.app

# Capture from Flutter app
$ bluetooth_toolkit.py capture com.example.flutter --flutter

# Capture from Airoha device with output file
$ bluetooth_toolkit.py capture com.app --airoha --output capture.log

# Capture with keepalive filtering (cleaner output)
$ bluetooth_toolkit.py capture com.audeze.app --airoha --filter-keepalive

📊 TESTING FEATURES:

The test commands identify which Chrome Web APIs work with your device:
  ✅ BLE GATT     → Web Bluetooth API (Chrome on all platforms)
  ✅ Serial Port  → Web Serial API (Chrome on desktop)

This helps determine the best approach for web-based control interfaces.
""")

def main():
    parser = argparse.ArgumentParser(
        description="Bluetooth Protocol Reverse Engineering Toolkit",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s scan
  %(prog)s test "Maxwell"
  %(prog)s test "Moondrop Edge" --preset 0
  %(prog)s test-ble "Maxwell"
  %(prog)s test-serial "Maxwell"
  %(prog)s analyze Moondrop
  %(prog)s list-apps
  %(prog)s capture com.moondrop.app
  %(prog)s capture com.example.app --flutter --output capture.log

Testing identifies Chrome Web API compatibility (Web Bluetooth / Web Serial).
Based on successful Moondrop Edge and Audeze Maxwell reverse engineering.
For detailed help: %(prog)s help
        """
    )

    parser.add_argument('--python', help='Python executable to use for sub-tools')

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Scan command
    parser_scan = subparsers.add_parser('scan', help='Scan for nearby BLE devices')
    parser_scan.set_defaults(func=cmd_scan)

    # Analyze command
    parser_analyze = subparsers.add_parser('analyze', help='Analyze a specific device')
    parser_analyze.add_argument('device_name', help='Device name to analyze')
    parser_analyze.set_defaults(func=cmd_analyze)

    # Test command (BLE + Serial)
    parser_test = subparsers.add_parser('test', help='Test BLE and Serial communication')
    parser_test.add_argument('device_name', help='Device name to test (e.g., "Maxwell", "Moondrop")')
    parser_test.add_argument('--preset', type=int, default=1, help='Preset to read (0-3, default: 1)')
    parser_test.set_defaults(func=cmd_test)

    # Test BLE command
    parser_test_ble = subparsers.add_parser('test-ble', help='Test BLE GATT communication only')
    parser_test_ble.add_argument('device_name', help='Device name to test')
    parser_test_ble.add_argument('--preset', type=int, default=1, help='Preset to read (0-3, default: 1)')
    parser_test_ble.set_defaults(func=cmd_test_ble)

    # Test Serial command
    parser_test_serial = subparsers.add_parser('test-serial', help='Test Serial Port communication only')
    parser_test_serial.add_argument('device_name', help='Device name to test')
    parser_test_serial.add_argument('--preset', type=int, default=1, help='Preset to read (0-3, default: 1)')
    parser_test_serial.set_defaults(func=cmd_test_serial)

    # Test Edifier command
    parser_test_edifier = subparsers.add_parser('test-edifier', help='Test Edifier device (W830NB, ConnectX)')
    parser_test_edifier.add_argument('device_name', help='Device name (e.g., "EDIFIER W830NB")')
    parser_test_edifier.set_defaults(func=cmd_test_edifier)

    # Test Sony command
    parser_test_sony = subparsers.add_parser('test-sony', help='Test Sony device (WH-1000XM5, WH-1000XM6)')
    parser_test_sony.add_argument('device_name', help='Device name (e.g., "WH-1000XM5")')
    parser_test_sony.set_defaults(func=cmd_test_sony)

    # Capture command
    parser_capture = subparsers.add_parser('capture', help='Capture Bluetooth protocol from Android app')
    parser_capture.add_argument('package', help='Android package name (e.g., com.moondrop.app)')
    parser_capture.add_argument('--flutter', action='store_true', help='Use Flutter-specific hooks')
    parser_capture.add_argument('--airoha', action='store_true', help='Use Airoha chipset hooks')
    parser_capture.add_argument('--edifier', action='store_true', help='Use Edifier W830NB/ConnectX hooks')
    parser_capture.add_argument('--sony', action='store_true', help='Use Sony WH-1000XM5/XM6 hooks')
    parser_capture.add_argument('--ugreen', action='store_true', help='Use Ugreen Max5C/RCSP protocol hooks')
    parser_capture.add_argument('--fiio', action='store_true', help='Use FiiO BT hooks (EH11, BTR series)')
    parser_capture.add_argument('--script', help='Use a specific Frida script (overrides mode flags)')
    parser_capture.add_argument('--output', '-o', help='Output file for captured data')
    parser_capture.add_argument('--filter-keepalive', '-f', action='store_true', help='Filter out keepalive packets')
    parser_capture.set_defaults(func=cmd_capture)

    # List apps command
    parser_list = subparsers.add_parser('list-apps', help='List running Android apps')
    parser_list.set_defaults(func=cmd_list_apps)

    # Doctor command
    parser_doctor = subparsers.add_parser('doctor', help='Check environment dependencies')
    parser_doctor.set_defaults(func=cmd_doctor)

    # Help command
    parser_help = subparsers.add_parser('help', help='Show detailed documentation')
    parser_help.set_defaults(func=cmd_help)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Goodbye!\n")
        sys.exit(0)
