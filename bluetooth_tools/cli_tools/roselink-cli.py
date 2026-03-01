#!/usr/bin/env python3
"""
RoseLink Bluetooth Protocol CLI Tool
For Cambrian ANC headphones using RoseLink protocol

Protocol: TX[0xFF 0x00 Length Data... 0xAA] RX[0xDD 0x00 Length Data... 0xAA]
See roselink-eq-PROTOCOL.md for details
"""

import asyncio
import sys
from bleak import BleakClient, BleakScanner


# ========================================================================
# Protocol Constants
# ========================================================================

# Bluetooth UUIDs (discovered from device scan)
SERVICE_UUID = "000000fe-0000-1000-8000-00805f9b34fb"   # ✅ CONFIRMED via BLE enumeration
WRITE_CHAR_UUID = "000000f1-0000-1000-8000-00805f9b34fb"  # ✅ write-without-response + write + read
NOTIFY_CHAR_UUID = "000000f2-0000-1000-8000-00805f9b34fb" # ✅ notify + read
# NOTE: The 0000ff12 service (ff14/ff15) exists on device but responses come back on f2, not ff14

# Frame markers
TX_START = 0xFF
RX_START = 0xDD
FRAME_END = 0xAA
FRAME_RESERVED = 0x00

# Commands
CMD_QUERY_MULTIPLE = 0xFA

# Parameters
PARAM_BATTERY = 0x0C
PARAM_FIRMWARE = 0x0D
PARAM_EQ_PRESET = 0x2A
PARAM_EQ_BAND_1 = 0x2B
PARAM_EQ_BAND_2 = 0x2C
PARAM_EQ_BAND_3 = 0x2D
PARAM_EQ_BAND_4 = 0x2E
PARAM_ACK = 0xFE

# EQ Presets
EQ_HIFI = 0x00
EQ_POP = 0x01
EQ_ROCK = 0x02

PRESET_NAMES = {
    EQ_HIFI: "HiFi",
    EQ_POP: "Pop",
    EQ_ROCK: "Rock"
}


# ========================================================================
# Protocol Functions
# ========================================================================

def build_tx_frame(data):
    """
    Build TX frame: [0xFF] [0x00] [Length] [Data...] [0xAA]
    """
    length = len(data)
    frame = bytes([TX_START, FRAME_RESERVED, length]) + bytes(data) + bytes([FRAME_END])
    return frame


def parse_rx_frame(data):
    """
    Parse RX frame: [0xDD] [0x00] [Length] [Data...] [0xAA]
    Returns payload data or None if invalid
    """
    if len(data) < 5:
        return None

    if data[0] != RX_START or data[1] != FRAME_RESERVED or data[-1] != FRAME_END:
        return None

    length = data[2]
    payload = data[3:3+length]

    if len(payload) != length:
        return None

    return payload


def build_query_all():
    """
    Build query all parameters command
    FF 00 0F FA 01 07 08 09 0C 0D 0E 12 2A 2B 2C 2D 2E 33 AA
    """
    data = [CMD_QUERY_MULTIPLE, 0x01, 0x07, 0x08, 0x09, 0x0C, 0x0D, 0x0E,
            0x12, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x33]
    return build_tx_frame(data)


def build_set_eq_preset(preset_value):
    """
    Build set EQ preset command
    FF 00 02 2A [preset] AA
    """
    data = [PARAM_EQ_PRESET, preset_value]
    return build_tx_frame(data)


def format_hex(data):
    """Format bytes as hex string"""
    return ' '.join(f'{b:02X}' for b in data)


# ========================================================================
# RoseLink Controller
# ========================================================================

class RoseLinkController:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.notifications = []
        self.notification_event = asyncio.Event()

    def notification_handler(self, sender, data):
        """Handle incoming notifications"""
        print(f"\n← RX: [{format_hex(data)}] (len={len(data)})")
        print(f"   Raw bytes: {list(data)}")

        payload = parse_rx_frame(data)
        if payload:
            self.notifications.append(payload)
            self.parse_response(payload)
            self.notification_event.set()
        else:
            print("   [Invalid frame - does not match RX format]")
            print(f"   Expected: [0xDD 0x00 Length Data... 0xAA]")
            if len(data) > 0:
                print(f"   Got: [0x{data[0]:02X} ...]")

    def parse_response(self, payload):
        """Parse and display response payload"""
        if len(payload) == 1 and payload[0] == PARAM_ACK:
            print("   ✓ ACK")
            return

        if len(payload) < 2:
            print(f"   Unknown: {format_hex(payload)}")
            return

        param_id = payload[0]
        value = payload[1:]

        if param_id == PARAM_BATTERY and len(value) == 3:
            # Battery: 0x00 [high] [low]
            battery = (value[1] << 8) | value[2]
            print(f"   Battery: {battery}%")
        elif param_id == PARAM_FIRMWARE and len(value) == 3:
            # Firmware: ASCII string
            fw = ''.join(chr(b) for b in value)
            print(f"   Firmware: {fw}")
        elif param_id == PARAM_EQ_PRESET:
            preset_name = PRESET_NAMES.get(value[0], f"Unknown ({value[0]})")
            print(f"   EQ Preset: {preset_name}")
        elif param_id in [PARAM_EQ_BAND_1, PARAM_EQ_BAND_2, PARAM_EQ_BAND_3, PARAM_EQ_BAND_4]:
            band_num = param_id - PARAM_EQ_BAND_1 + 1
            print(f"   EQ Band {band_num}: {value[0]}")
        else:
            print(f"   Param 0x{param_id:02X}: {format_hex(value)}")

    async def connect(self):
        """Connect to device"""
        print(f"\nConnecting to {self.address}...")
        self.client = BleakClient(self.address)

        try:
            await self.client.connect()
            print("✓ Connected to GATT server")
        except Exception as e:
            print(f"✗ Connection failed: {e}")
            raise

        # Try to discover services
        try:
            print(f"\n🔍 Looking for service {SERVICE_UUID}...")
            services = self.client.services

            # Check if our service exists
            service_found = False
            for service in services:
                if service.uuid.lower() == SERVICE_UUID.lower():
                    service_found = True
                    print(f"✓ Found RoseLink service")
                    break

            if not service_found:
                print(f"✗ Service {SERVICE_UUID} not found!")
                print("\nAvailable services:")
                for service in services:
                    print(f"  - {service.uuid}")
                    # Show characteristics for each service
                    for char in service.characteristics:
                        props = ','.join(char.properties)
                        print(f"    └─ Char: {char.uuid} ({props})")
                raise Exception(f"RoseLink service not found")

        except Exception as e:
            print(f"✗ Service discovery failed: {e}")
            raise

        # Start notifications
        try:
            print(f"\n🔍 Looking for notify characteristic {NOTIFY_CHAR_UUID}...")

            # Check if characteristic exists and supports notify
            char = None
            for service in services:
                if service.uuid.lower() == SERVICE_UUID.lower():
                    for c in service.characteristics:
                        if c.uuid.lower() == NOTIFY_CHAR_UUID.lower():
                            char = c
                            print(f"✓ Found notify characteristic")
                            print(f"  Properties: {', '.join(c.properties)}")
                            break
                    break

            if not char:
                raise Exception("Notify characteristic not found in service")

            if 'notify' not in char.properties:
                raise Exception(f"Characteristic doesn't support notify: {char.properties}")

            # Enable notifications
            await self.client.start_notify(NOTIFY_CHAR_UUID, self.notification_handler)
            print("✓ Notifications enabled")

            # Check CCCD descriptor
            for desc in char.descriptors:
                if desc.uuid.lower() == "00002902-0000-1000-8000-00805f9b34fb":
                    try:
                        cccd_value = await self.client.read_gatt_descriptor(desc.handle)
                        print(f"  CCCD value: {list(cccd_value)}")
                    except:
                        pass

        except Exception as e:
            print(f"⚠️  Notification setup failed: {e}")
            print("   Continuing without notifications...")

        print("\n✓ Ready!")

    async def disconnect(self):
        """Disconnect from device"""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
            print("✓ Disconnected")

    async def send_command(self, data, wait_response=True, wait_time=2.0):
        """Send command and optionally wait for response"""
        print(f"\n→ TX: [{format_hex(data)}] (len={len(data)})")
        print(f"   Raw bytes: {list(data)}")

        if wait_response:
            self.notifications.clear()
            self.notification_event.clear()

        try:
            await self.client.write_gatt_char(WRITE_CHAR_UUID, data, response=False)
            print("   ✓ Command sent (write-without-response)")
        except Exception as e:
            print(f"   ✗ Write error: {e}")
            return

        if wait_response:
            print(f"   ⏳ Waiting for response ({wait_time}s)...")
            try:
                await asyncio.wait_for(self.notification_event.wait(), timeout=wait_time)
            except asyncio.TimeoutError:
                print("   ⏱️ No response received")
                print("   💡 Tip: Device may only respond over SPP, not BLE")

    async def query_all(self):
        """Query all device parameters"""
        print("\n=== Query All Parameters ===")
        cmd = build_query_all()
        await self.send_command(cmd, wait_response=True, wait_time=3.0)

        # Wait for multiple responses
        await asyncio.sleep(1.5)

    async def set_eq_preset(self, preset_value):
        """Set EQ preset"""
        preset_name = PRESET_NAMES.get(preset_value, f"Unknown ({preset_value})")
        print(f"\n=== Set EQ Preset: {preset_name} ===")
        cmd = build_set_eq_preset(preset_value)
        await self.send_command(cmd, wait_response=True)

    async def get_battery(self):
        """Query battery level"""
        print("\n=== Query Battery ===")
        data = [CMD_QUERY_MULTIPLE, PARAM_BATTERY]
        cmd = build_tx_frame(data)
        await self.send_command(cmd, wait_response=True)
        await asyncio.sleep(0.5)

    async def get_firmware(self):
        """Query firmware version"""
        print("\n=== Query Firmware ===")
        data = [CMD_QUERY_MULTIPLE, PARAM_FIRMWARE]
        cmd = build_tx_frame(data)
        await self.send_command(cmd, wait_response=True)
        await asyncio.sleep(0.5)


# ========================================================================
# Scanner
# ========================================================================

async def scan_devices():
    """Scan for RoseLink devices"""
    print("Scanning for Bluetooth devices (10 seconds)...")
    print("=" * 60)

    devices = await BleakScanner.discover(timeout=10.0)

    roselink_devices = []
    for device in devices:
        # Look for ROSE CAMBRIAN, Cambrian, or RoseLink devices
        if device.name:
            name_lower = device.name.lower()
            if ('rose' in name_lower or 'cambrian' in name_lower or
                'roselink' in name_lower):
                roselink_devices.append(device)
                print(f"✓ {device.name}")
                print(f"  Address: {device.address}")
                # RSSI may not be available in all Bleak versions
                if hasattr(device, 'rssi') and device.rssi is not None:
                    print(f"  RSSI: {device.rssi} dBm")
                print()

    if not roselink_devices:
        print("\nNo RoseLink/Cambrian devices found.")
        print("\nAll devices found:")
        for device in devices:
            if device.name:
                print(f"  {device.name} ({device.address})")

    return roselink_devices


# ========================================================================
# Interactive Menu
# ========================================================================

async def interactive_mode(controller):
    """Interactive command menu"""
    while True:
        print("\n" + "=" * 60)
        print("RoseLink Controller - Interactive Mode")
        print("=" * 60)
        print("1. Query All Parameters")
        print("2. Set EQ Preset: HiFi")
        print("3. Set EQ Preset: Pop")
        print("4. Set EQ Preset: Rock")
        print("5. Query Battery")
        print("6. Query Firmware")
        print("7. Send Custom Command")
        print("0. Disconnect and Exit")
        print()

        try:
            choice = input("Enter choice: ").strip()

            if choice == '0':
                break
            elif choice == '1':
                await controller.query_all()
            elif choice == '2':
                await controller.set_eq_preset(EQ_HIFI)
            elif choice == '3':
                await controller.set_eq_preset(EQ_POP)
            elif choice == '4':
                await controller.set_eq_preset(EQ_ROCK)
            elif choice == '5':
                await controller.get_battery()
            elif choice == '6':
                await controller.get_firmware()
            elif choice == '7':
                hex_input = input("Enter hex bytes (space separated): ").strip()
                try:
                    data = bytes.fromhex(hex_input.replace(' ', ''))
                    await controller.send_command(data, wait_response=True)
                except ValueError as e:
                    print(f"Invalid hex: {e}")
            else:
                print("Invalid choice")

        except KeyboardInterrupt:
            print("\n\nInterrupted")
            break
        except Exception as e:
            print(f"Error: {e}")


# ========================================================================
# Main
# ========================================================================

async def main():
    print("=" * 60)
    print("RoseLink Bluetooth Protocol CLI Tool")
    print("For Cambrian ANC Headphones")
    print("=" * 60)
    print()

    # Handle scan-only mode
    if len(sys.argv) > 1 and sys.argv[1].lower() == 'scan':
        await scan_devices()
        print("\nTo connect to a device:")
        print("python roselink-cli.py <ADDRESS>")
        return

    # Check if address was provided
    if len(sys.argv) > 1:
        address = sys.argv[1]
    else:
        # Scan for devices
        devices = await scan_devices()

        if not devices:
            print("\nNo RoseLink devices found.")
            print("\nUsage:")
            print("  python roselink-cli.py                  # Auto-scan and connect")
            print("  python roselink-cli.py scan             # Scan only")
            print("  python roselink-cli.py <ADDRESS>        # Connect to specific device")
            return

        if len(devices) == 1:
            address = devices[0].address
            print(f"\nAuto-selecting: {devices[0].name} ({address})")
        else:
            print("\nMultiple devices found. Please specify address:")
            for dev in devices:
                print(f"  python roselink-cli.py {dev.address}")
            return

    controller = RoseLinkController(address)

    try:
        await controller.connect()

        # Initial query
        await controller.query_all()

        # Enter interactive mode
        await interactive_mode(controller)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await controller.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nExiting...")
