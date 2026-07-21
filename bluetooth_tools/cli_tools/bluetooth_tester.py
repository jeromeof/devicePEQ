#!/usr/bin/env python3
"""
Bluetooth Communication Tester Module

Provides reusable functions for testing Bluetooth communication methods:
- BLE GATT (Chrome Web Bluetooth API compatible)
- Serial Port / SPP (Chrome Web Serial API compatible)

Can be used standalone or imported by other tools.
"""

import asyncio
import struct
import sys
from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass

# Optional imports
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

try:
    from bleak import BleakScanner, BleakClient
    BLEAK_AVAILABLE = True
except ImportError:
    BLEAK_AVAILABLE = False


@dataclass
class BluetoothDevice:
    """Represents a discovered Bluetooth device"""
    name: str
    method: str  # 'ble' or 'serial'
    identifier: str  # BLE address or serial port path
    rssi: Optional[int] = None
    services: Optional[List[str]] = None


@dataclass
class TestResult:
    """Result of a communication test"""
    success: bool
    method: str
    device: BluetoothDevice
    response_data: Optional[bytes] = None
    error: Optional[str] = None
    peq_data: Optional[Dict] = None


class AirohaProtocol:
    """Airoha PEQ protocol commands and parsing"""

    # Command headers
    TX_HEADER = bytes([0x05, 0x5A])
    RX_HEADER = bytes([0x05, 0x5B])

    # Commands
    CMD_READ_PRESET = 0x06
    CMD_WRITE_PEQ = 0x4F
    CMD_PEQ_RESPONSE = 0xBD

    # Known Airoha BLE service UUIDs (discovered on Maxwell)
    AIROHA_BLE_SERVICE = "5052494d-2dab-0341-6972-6f6861424c45"  # "PRIM-Airoha BLE"
    AIROHA_BLE_TX_CHAR = "43484152-2dab-3241-6972-6f6861424c45"  # "CHAR-2AirohaBLE"
    AIROHA_BLE_RX_CHAR = "43484152-2dab-3141-6972-6f6861424c45"  # "CHAR-1AirohaBLE"

    @staticmethod
    def build_read_preset_command(preset_num: int) -> bytes:
        """Build command to read EQ preset (0-3)"""
        if preset_num < 0 or preset_num > 3:
            raise ValueError("Preset must be 0-3")

        payload = bytes([0x00, 0x00, 0x0A, preset_num, 0xEF, 0xE8, 0x03])
        header = AirohaProtocol.TX_HEADER + bytes([AirohaProtocol.CMD_READ_PRESET])
        packet = header + payload
        return packet

    @staticmethod
    def parse_peq_response(data: bytes) -> Optional[Dict]:
        """Parse PEQ response packet (193 bytes expected)"""
        if len(data) < 193:
            return None

        # Check header: 05 5B BD
        if data[0:3] != bytes([0x05, 0x5B, 0xBD]):
            return None

        result = {
            'num_bands': data[5],
            'eq_enabled': bool(data[8]),
            'filters': []
        }

        # Parse 10 PEQ filters (18 bytes each, starting at byte 13)
        filter_start = 13
        for i in range(min(10, result['num_bands'])):
            offset = filter_start + (i * 18)
            if offset + 18 > len(data):
                break

            filter_bytes = data[offset:offset+18]

            # Frequency (bytes 2-5, little-endian, units: 0.01 Hz)
            freq_raw = struct.unpack('<I', filter_bytes[2:6])[0]
            freq_hz = freq_raw / 100.0

            # Gain (bytes 6-9, little-endian signed, units: 0.01 dB)
            gain_raw = struct.unpack('<i', filter_bytes[6:10])[0]
            gain_db = gain_raw / 100.0

            # Q factor (bytes 14-17)
            q_raw = struct.unpack('<I', filter_bytes[14:18])[0]
            q_value = q_raw / 100.0

            result['filters'].append({
                'index': i,
                'freq_hz': freq_hz,
                'gain_db': gain_db,
                'q_value': q_value
            })

        return result

    @staticmethod
    def build_write_peq_command(preset_num: int, filters: List[Dict], all_sample_rates: bool = True) -> bytes:
        """
        Build command to write PEQ settings to device

        Args:
            preset_num: Preset index (0-3)
            filters: List of filter dicts with keys: freq_hz, gain_db, q_value, filter_type
                    filter_type: 0=bypass, 1=enable+type1, 2=enable+peaking, 3=enable+low_shelf, 4=enable+high_shelf
            all_sample_rates: If True, write to all 4 sample rates (~769 bytes, for Serial Port).
                            If False, write only to 48kHz (~200 bytes, for BLE to fit in MTU).

        Returns:
            Command bytes ready to send
        """
        if preset_num < 0 or preset_num > 3:
            raise ValueError("Preset must be 0-3")

        if len(filters) != 10:
            raise ValueError("Must provide exactly 10 filters")

        cmd = bytearray()

        # Header: 05 5A 4F
        cmd.extend([0x05, 0x5A, 0x4F])

        # Length placeholder (will fill later)
        length_pos = len(cmd)
        cmd.extend([0x00, 0x00])

        # Command header: 03 0E 00
        cmd.extend([0x03, 0x0E, 0x00])

        # Preset index (4 bytes, little-endian)
        cmd.extend(struct.pack('<I', preset_num))

        # Number of sections
        # Capture shows 6 sections, not 4 - likely 4 sample rates + 2 additional
        if all_sample_rates:
            sample_rates = [44100, 48000, 88200, 96000, 44100, 48000]  # 6 sections from capture
        else:
            sample_rates = [48000]  # Only 48kHz for BLE (fits in MTU)

        cmd.append(len(sample_rates))

        # For each sample rate
        for sample_rate in sample_rates:
            # Sample rate section header
            cmd.extend([0x00, 0x67, 0x00, 0x0A, 0x00])

            # Sample rate value (4 bytes, little-endian)
            cmd.extend(struct.pack('<I', sample_rate))

            # 10 bands
            for band in filters:
                filter_type = band.get('filter_type', 2)  # Default to peaking (2)

                # Filter header: 01 [type]
                cmd.extend([0x01, filter_type])

                # Frequency (4 bytes: Hz × 100, little-endian as 2-byte int + 2 zero bytes)
                freq_val = int(band['freq_hz'] * 100)
                cmd.extend(struct.pack('<H', freq_val & 0xFFFF))
                cmd.extend([0x00, 0x00])

                # Gain (4 bytes: dB × 100, signed little-endian)
                gain_val = int(band['gain_db'] * 100)
                cmd.extend(struct.pack('<i', gain_val))

                # Q factor (4 bytes: Q × 100, little-endian)
                q_val = int(band['q_value'] * 100)
                cmd.extend(struct.pack('<I', q_val))

                # Type/flags (4 bytes)
                cmd.extend([0xC8, 0x00, 0x00, 0x00])

        # Calculate and set length (total bytes minus header)
        payload_len = len(cmd) - 3  # Exclude 05 5A 4F header
        struct.pack_into('<H', cmd, length_pos, payload_len)

        return bytes(cmd)

    @staticmethod
    def build_write_peq_command_mirror(preset_num: int, filters: List[Dict]) -> bytes:
        """
        Build command to write PEQ settings using same format as read response
        This mirrors the 193-byte response format we get from reading a preset

        Args:
            preset_num: Preset index (0-3) - currently not used in packet, but for API consistency
            filters: List of filter dicts with keys: freq_hz, gain_db, q_value, bw_hz (optional)
                    filter_type: 0=bypass, 1=enable+type1, 2=enable+peaking, 3=enable+low_shelf, 4=enable+high_shelf

        Returns:
            Command bytes ready to send (~193 bytes)
        """
        if len(filters) != 10:
            raise ValueError("Must provide exactly 10 filters")

        cmd = bytearray()

        # Header: 05 5A BD (TX version of the BD response)
        cmd.extend([0x05, 0x5A, 0xBD])

        # Length field (2 bytes) - from capture: 00 01
        cmd.extend([0x00, 0x01])

        # Header bytes from capture: 0A 00 EF 01 00 00 00 00
        cmd.extend([0x0A, 0x00, 0xEF, 0x01, 0x00, 0x00, 0x00, 0x00])

        # Starting at byte 13: 10 filters × 18 bytes each
        for band in filters:
            filter_type = band.get('filter_type', 2)  # Default to peaking (2)

            # Byte 0: Enable flag
            cmd.append(0x01)

            # Byte 1: Filter type
            cmd.append(filter_type)

            # Bytes 2-5: Frequency (Hz × 100, little-endian unsigned 32-bit)
            freq_val = int(band['freq_hz'] * 100)
            cmd.extend(struct.pack('<I', freq_val))

            # Bytes 6-9: Gain (dB × 100, signed little-endian 32-bit)
            gain_val = int(band['gain_db'] * 100)
            cmd.extend(struct.pack('<i', gain_val))

            # Bytes 10-13: Bandwidth (Hz × 100, little-endian unsigned 32-bit)
            bw_val = int(band.get('bw_hz', 0) * 100)
            cmd.extend(struct.pack('<I', bw_val))

            # Bytes 14-17: Q factor (Q × 100, little-endian unsigned 32-bit)
            q_val = int(band['q_value'] * 100)
            cmd.extend(struct.pack('<I', q_val))

        # Length field is fixed at 00 01 from capture
        # No need to calculate

        return bytes(cmd)


class BluetoothTester:
    """Test Bluetooth communication methods"""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def _print(self, msg: str, force: bool = False):
        """Print message if verbose or forced"""
        if self.verbose or force:
            print(msg)

    async def scan_ble_devices(self, name_filter: Optional[str] = None, timeout: int = 10) -> List[BluetoothDevice]:
        """Scan for BLE devices"""
        if not BLEAK_AVAILABLE:
            self._print("⚠️  bleak not available - install with: pip install bleak")
            return []

        self._print(f"\n🔍 Scanning BLE devices ({timeout}s)...")
        devices = []

        try:
            discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)

            for address, (device, adv_data) in discovered.items():
                name = device.name or "Unknown"

                # Apply name filter
                if name_filter and name_filter.lower() not in name.lower():
                    continue

                rssi = adv_data.rssi if hasattr(adv_data, 'rssi') else None

                ble_device = BluetoothDevice(
                    name=name,
                    method='ble',
                    identifier=address,
                    rssi=rssi
                )
                devices.append(ble_device)

                if name != "Unknown":
                    self._print(f"  ✓ {name} [{address}] RSSI: {rssi} dBm")

            if not devices:
                self._print("  ℹ️  No BLE devices found")

        except Exception as e:
            self._print(f"  ❌ BLE scan error: {e}")

        return devices

    def scan_serial_ports(self, name_filter: Optional[str] = None) -> List[BluetoothDevice]:
        """Scan for Bluetooth serial ports"""
        if not SERIAL_AVAILABLE:
            self._print("⚠️  pyserial not available - install with: pip install pyserial")
            return []

        self._print("\n🔍 Scanning Bluetooth Serial Ports...")
        devices = []
        ports = serial.tools.list_ports.comports()

        for port in ports:
            # On macOS, look for cu.* ports (not tty.*)
            if 'cu.' not in port.device or port.device == '/dev/cu.Bluetooth-Incoming-Port':
                continue

            # Apply name filter
            if name_filter:
                if (name_filter.lower() not in port.device.lower() and
                    name_filter.lower() not in port.description.lower()):
                    continue

            device = BluetoothDevice(
                name=port.description,
                method='serial',
                identifier=port.device
            )
            devices.append(device)
            self._print(f"  ✓ {port.device} - {port.description}")

        if not devices:
            self._print("  ℹ️  No Bluetooth serial ports found")

        return devices

    async def test_ble_airoha(self, device: BluetoothDevice, preset: int = 1) -> TestResult:
        """Test BLE GATT communication using Airoha protocol"""
        self._print(f"\n{'='*70}", force=True)
        self._print(f"🧪 Testing BLE GATT - {device.name}", force=True)
        self._print(f"{'='*70}", force=True)

        if not BLEAK_AVAILABLE:
            return TestResult(
                success=False,
                method='ble',
                device=device,
                error="bleak not available"
            )

        try:
            async with BleakClient(device.identifier, timeout=15.0) as client:
                self._print("✅ Connected")

                # Look for Airoha BLE service
                airoha_service = None
                for service in client.services:
                    if AirohaProtocol.AIROHA_BLE_SERVICE.lower() in str(service.uuid).lower():
                        airoha_service = service
                        self._print(f"✅ Found Airoha BLE service")
                        break

                if not airoha_service:
                    return TestResult(
                        success=False,
                        method='ble',
                        device=device,
                        error="Airoha BLE service not found"
                    )

                # Set up notification handler
                response_data = bytearray()
                response_complete = asyncio.Event()

                def notification_handler(sender, data):
                    nonlocal response_data
                    response_data.extend(data)
                    if len(response_data) >= 193:
                        response_complete.set()

                # Enable notifications
                await client.start_notify(AirohaProtocol.AIROHA_BLE_RX_CHAR, notification_handler)
                self._print("✅ Notifications enabled")

                # Send command
                cmd = AirohaProtocol.build_read_preset_command(preset)
                self._print(f"📤 Sending command (preset {preset}): {cmd.hex(' ').upper()}")

                await client.write_gatt_char(AirohaProtocol.AIROHA_BLE_TX_CHAR, cmd, response=False)

                # Wait for response
                try:
                    await asyncio.wait_for(response_complete.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass

                await client.stop_notify(AirohaProtocol.AIROHA_BLE_RX_CHAR)

                if len(response_data) > 0:
                    self._print(f"📥 Received {len(response_data)} bytes")

                    # Parse response
                    peq_data = AirohaProtocol.parse_peq_response(bytes(response_data))

                    if peq_data:
                        self._print(f"✅ Valid Airoha PEQ response!", force=True)
                        self._print(f"   Bands: {peq_data['num_bands']}, EQ Enabled: {peq_data['eq_enabled']}")

                        return TestResult(
                            success=True,
                            method='ble',
                            device=device,
                            response_data=bytes(response_data),
                            peq_data=peq_data
                        )
                    else:
                        return TestResult(
                            success=False,
                            method='ble',
                            device=device,
                            response_data=bytes(response_data),
                            error="Invalid response format"
                        )
                else:
                    return TestResult(
                        success=False,
                        method='ble',
                        device=device,
                        error="No response received"
                    )

        except Exception as e:
            return TestResult(
                success=False,
                method='ble',
                device=device,
                error=str(e)
            )

    def test_serial_airoha(self, device: BluetoothDevice, preset: int = 1) -> TestResult:
        """Test Serial Port communication using Airoha protocol"""
        self._print(f"\n{'='*70}", force=True)
        self._print(f"🧪 Testing Serial Port - {device.name}", force=True)
        self._print(f"{'='*70}", force=True)

        if not SERIAL_AVAILABLE:
            return TestResult(
                success=False,
                method='serial',
                device=device,
                error="pyserial not available"
            )

        try:
            # Open serial connection
            self._print(f"🔗 Connecting to {device.identifier}...")
            ser = serial.Serial(device.identifier, baudrate=115200, timeout=2)
            import time
            time.sleep(0.5)
            self._print("✅ Connected")

            # Send command
            cmd = AirohaProtocol.build_read_preset_command(preset)
            self._print(f"📤 Sending command (preset {preset}): {cmd.hex(' ').upper()}")
            ser.write(cmd)

            # Wait for response
            time.sleep(0.5)
            response = ser.read(300)
            ser.close()

            if len(response) > 0:
                self._print(f"📥 Received {len(response)} bytes")

                # Parse response
                peq_data = AirohaProtocol.parse_peq_response(response)

                if peq_data:
                    self._print(f"✅ Valid Airoha PEQ response!", force=True)
                    self._print(f"   Bands: {peq_data['num_bands']}, EQ Enabled: {peq_data['eq_enabled']}")

                    return TestResult(
                        success=True,
                        method='serial',
                        device=device,
                        response_data=response,
                        peq_data=peq_data
                    )
                else:
                    return TestResult(
                        success=False,
                        method='serial',
                        device=device,
                        response_data=response,
                        error="Invalid response format"
                    )
            else:
                return TestResult(
                    success=False,
                    method='serial',
                    device=device,
                    error="No response received"
                )

        except Exception as e:
            return TestResult(
                success=False,
                method='serial',
                device=device,
                error=str(e)
            )

    async def test_device(self, device_name: str, preset: int = 1) -> List[TestResult]:
        """Test a device with all available methods"""
        results = []

        # Scan for devices
        ble_devices = await self.scan_ble_devices(name_filter=device_name)
        serial_devices = self.scan_serial_ports(name_filter=device_name)

        all_devices = ble_devices + serial_devices

        if not all_devices:
            self._print(f"\n❌ No devices found matching '{device_name}'", force=True)
            return results

        # Test each device
        for device in all_devices:
            if device.method == 'ble':
                result = await self.test_ble_airoha(device, preset)
                results.append(result)
            elif device.method == 'serial':
                result = self.test_serial_airoha(device, preset)
                results.append(result)

        return results

    def print_results_summary(self, results: List[TestResult]):
        """Print a summary of test results"""
        if not results:
            return

        print(f"\n{'='*70}")
        print("📊 Test Results Summary")
        print(f"{'='*70}\n")

        for result in results:
            status = "✅ Success" if result.success else "❌ Failed"
            print(f"{result.method.upper():<10} {status:<15} {result.device.name}")

            if result.success and result.peq_data:
                print(f"           Bands: {result.peq_data['num_bands']}, "
                      f"EQ: {'On' if result.peq_data['eq_enabled'] else 'Off'}")
            elif result.error:
                print(f"           Error: {result.error}")

        print(f"\n{'='*70}")
        print("Chrome Compatibility")
        print(f"{'='*70}\n")

        has_ble = any(r.success and r.method == 'ble' for r in results)
        has_serial = any(r.success and r.method == 'serial' for r in results)

        print(f"{'BLE GATT':<20} {'✅ Works' if has_ble else '❌ Not working':<20} Web Bluetooth API")
        print(f"{'Serial Port (SPP)':<20} {'✅ Works' if has_serial else '❌ Not working':<20} Web Serial API")
        print()


# Standalone CLI
async def main():
    """Main CLI entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Bluetooth Communication Tester",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test a specific device
  python3 bluetooth_tester.py test "Maxwell"
  python3 bluetooth_tester.py test "Moondrop"

  # Scan for devices
  python3 bluetooth_tester.py scan-ble
  python3 bluetooth_tester.py scan-serial

  # Test with specific preset
  python3 bluetooth_tester.py test "Maxwell" --preset 0
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Command to run')

    # Test command
    parser_test = subparsers.add_parser('test', help='Test a device')
    parser_test.add_argument('device', help='Device name to test')
    parser_test.add_argument('--preset', type=int, default=1, help='Preset to read (0-3)')

    # Scan commands
    subparsers.add_parser('scan-ble', help='Scan for BLE devices')
    subparsers.add_parser('scan-serial', help='Scan for serial ports')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    tester = BluetoothTester(verbose=True)

    if args.command == 'test':
        results = await tester.test_device(args.device, args.preset)
        tester.print_results_summary(results)

    elif args.command == 'scan-ble':
        await tester.scan_ble_devices()

    elif args.command == 'scan-serial':
        tester.scan_serial_ports()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Cancelled by user")
        sys.exit(0)
