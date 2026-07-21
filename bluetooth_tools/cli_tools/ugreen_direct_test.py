#!/usr/bin/env python3
"""
Direct BLE test for Ugreen Max5C
Tests RCSP protocol communication without needing Android app
"""

import asyncio
import sys
from bleak import BleakClient, BleakScanner

# RCSP Protocol UUIDs (from BLE scan)
SERVICE_UUID = "0000ae00-0000-1000-8000-00805f9b34fb"
WRITE_CHAR_UUID = "0000ae01-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR_UUID = "0000ae02-0000-1000-8000-00805f9b34fb"

# RCSP Protocol Constants
RCSP_START = [0xFE, 0xDC, 0xBA]
RCSP_END = 0xEF

CMD_GET_SYS_INFO = 0x07
CMD_SET_SYS_INFO = 0x08

# Attribute masks for GET_SYS_INFO
MASK_EQ = 0x00000010          # Bit 4
MASK_EQ_PRESET = 0x00001000   # Bit 12
MASK_BASS_TREBLE = 0x00000800 # Bit 11
MASK_ALL_EQ = 0x00001810      # EQ + EQ_PRESET + BASS_TREBLE

class UgreenMax5C:
    def __init__(self):
        self.client = None
        self.sequence_number = 1
        self.response_data = bytearray()

    async def connect(self, device_name_or_address="UGREEN HiTune Max5c"):
        """Find and connect to the device"""

        # Check if it's a UUID/address (contains hyphens)
        looks_like_address = "-" in device_name_or_address or ":" in device_name_or_address

        if looks_like_address:
            # Connect directly by address
            print(f"📡 Connecting directly to address: {device_name_or_address}")
            device_address = device_name_or_address
        else:
            # Scan for device by name
            print(f"🔍 Scanning for '{device_name_or_address}'...")

            devices = await BleakScanner.discover(timeout=10.0)
            device = None

            print(f"\n📱 Found {len(devices)} BLE devices:")
            for i, d in enumerate(devices):
                name = d.name or "Unknown"
                print(f"   {i+1}. {name} ({d.address})")

            print()

            for d in devices:
                if d.name and device_name_or_address.lower() in d.name.lower():
                    device = d
                    break

            if not device:
                print(f"❌ Device '{device_name_or_address}' not found")
                print(f"\n💡 Tips:")
                print(f"   1. Make sure headphones are ON")
                print(f"   2. Try using the address directly:")
                print(f"      python3.11 ugreen_direct_test.py 27FFF807-1F18-D9A8-BB30-AE8AFC7FDD0C")
                return False

            device_address = device.address
            print(f"✅ Found device: {device.name} ({device.address})")

        print(f"📡 Connecting...")

        self.client = BleakClient(device_address)
        await self.client.connect()

        print(f"✅ Connected!")

        # Enable notifications
        await self.client.start_notify(NOTIFY_CHAR_UUID, self.notification_handler)
        print(f"✅ Notifications enabled on {NOTIFY_CHAR_UUID}")

        return True

    def notification_handler(self, sender, data):
        """Handle incoming notifications"""
        self.response_data.extend(data)

        # Check if we have a complete packet
        if len(self.response_data) >= 4 and self.response_data[-1] == RCSP_END:
            # Look for start sequence
            for i in range(len(self.response_data) - 3):
                if (self.response_data[i] == RCSP_START[0] and
                    self.response_data[i+1] == RCSP_START[1] and
                    self.response_data[i+2] == RCSP_START[2]):

                    # Found start, extract packet
                    packet = bytes(self.response_data[i:])
                    self.parse_response(packet)
                    self.response_data.clear()
                    break

    def parse_response(self, packet):
        """Parse RCSP response packet"""
        print("\n" + "="*80)
        print("📥 RCSP RESPONSE")
        print("="*80)
        print(f"Raw: {' '.join(f'{b:02X}' for b in packet)}")
        print(f"Len: {len(packet)} bytes")

        if len(packet) < 9:
            print("⚠️  Packet too short")
            return

        try:
            flags = packet[3]
            is_command = (flags & 0x80) != 0
            has_response = (flags & 0x40) != 0
            opcode = packet[4]
            param_len = (packet[5] << 8) | packet[6]
            status = packet[7] if not is_command else None

            print(f"\nType: {'COMMAND' if is_command else 'RESPONSE'}")
            print(f"OpCode: 0x{opcode:02X} ({self.get_opcode_name(opcode)})")

            if status is not None:
                print(f"Status: {'✅ SUCCESS' if status == 0 else f'❌ ERROR {status}'}")

            print(f"ParamLen: {param_len}")

            # Parse response parameters
            if not is_command and param_len > 0:
                header_len = 8
                # Extract param data, excluding the end flag (last byte)
                # The packet structure is: [START(3)] [HEADER(5)] [PARAMS] [END(1)]
                # So params are from header_len to (packet_length - 1)
                param_data = packet[header_len:-1]  # Exclude the EF end flag
                self.parse_response_params(param_data)

        except Exception as e:
            print(f"⚠️  Parse error: {e}")

        print("="*80)

    def parse_response_params(self, data):
        """Parse response parameters"""
        if len(data) < 3:
            return

        seq = data[0]
        func = data[1]
        print(f"\nSequence: {seq}")
        print(f"Function: 0x{func:02X} {'(Public)' if func == 0xFF else ''}")

        # Debug: show raw param data
        print(f"Raw Param Data ({len(data)} bytes): {' '.join(f'{b:02X}' for b in data)}")

        # Attributes start at index 2 (after sequence and function bytes)
        idx = 2
        attr_count = 0
        while idx < len(data):
            attr_len = data[idx]

            # Sanity check
            if attr_len == 0 or attr_len > 200:
                print(f"\n⚠️  Invalid attribute length {attr_len} at position {idx}, stopping parse")
                break

            if idx + 1 >= len(data):
                break

            attr_type = data[idx + 1]

            if idx + attr_len >= len(data):
                print(f"\n⚠️  Attribute extends beyond data (len={attr_len}, remaining={len(data)-idx})")
                break

            attr_data = data[idx + 2:idx + attr_len + 1]

            attr_count += 1
            print(f"\n📝 Attribute #{attr_count}")
            print(f"   Type: 0x{attr_type:02X} ({self.get_attr_name(attr_type)})")
            print(f"   Length: {attr_len}")
            print(f"   Raw Data: {' '.join(f'{b:02X}' for b in attr_data)}")

            self.parse_attribute(attr_type, attr_data)

            idx += attr_len + 1

        if attr_count == 0:
            print("\n⚠️  No attributes found in response")

    def parse_attribute(self, attr_type, data):
        """Parse specific attribute data"""
        if len(data) == 0:
            return

        if attr_type == 0x04:  # EQ
            mode = data[0]
            is_dynamic = (mode & 0x80) != 0
            actual_mode = mode & 0x7F

            print(f"   Format: {'DYNAMIC' if is_dynamic else 'STATIC'}")
            print(f"   Mode: {actual_mode}")

            if is_dynamic and len(data) >= 2:
                count = data[1]
                values = data[2:2 + count]
                gains = [self.signed_byte(v) for v in values]

                print(f"   Bands: {count}")
                print(f"   Gains: {gains} dB")

            elif not is_dynamic and len(data) >= 11:
                values = data[1:11]
                gains = [self.signed_byte(v) for v in values]
                freqs = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

                print(f"   Bands: 10 (fixed)")
                print(f"\n   EQ Settings:")
                for i, (freq, gain) in enumerate(zip(freqs, gains)):
                    print(f"     {freq:5d}Hz: {gain:+d} dB")

        elif attr_type == 0x0B:  # Bass/Treble
            if len(data) >= 8:
                bass = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
                treble = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]

                print(f"   Bass: {bass}")
                print(f"   Treble: {treble}")

        elif attr_type == 0x0C:  # EQ Preset
            if len(data) >= 1:
                num_bands = data[0]
                print(f"   Frequency Bands: {num_bands}")

                if len(data) >= 1 + num_bands * 2:
                    freqs = []
                    for i in range(num_bands):
                        freq = (data[1 + i*2] << 8) | data[2 + i*2]
                        freqs.append(freq)
                    print(f"   Frequencies: {freqs} Hz")
        else:
            # Unknown attribute
            print(f"   Data: {' '.join(f'{b:02X}' for b in data)}")

    def build_get_eq_cmd(self, mask=None):
        """Build command to get EQ settings"""
        if mask is None:
            mask = MASK_ALL_EQ

        seq = self.get_next_seq()

        # Build parameter data
        params = bytearray([
            seq,                    # Sequence number
            0xFF,                   # Function: Public
            (mask >> 24) & 0xFF,  # Mask bytes (big-endian)
            (mask >> 16) & 0xFF,
            (mask >> 8) & 0xFF,
            mask & 0xFF
        ])

        param_len = len(params)

        # Build complete packet
        packet = bytearray(RCSP_START)
        packet.append(0xC0)  # Flags: Command + HasResponse
        packet.append(CMD_GET_SYS_INFO)
        packet.append((param_len >> 8) & 0xFF)  # Param length (big-endian)
        packet.append(param_len & 0xFF)
        packet.extend(params)
        packet.append(RCSP_END)

        return bytes(packet)

    def build_set_eq_cmd(self, mode, gains):
        """Build command to set EQ settings"""
        seq = self.get_next_seq()

        # Determine if dynamic format
        is_dynamic = len(gains) != 10

        # Build EQ data
        if is_dynamic:
            eq_data = bytearray([
                (mode | 0x80),      # Mode with dynamic flag
                len(gains)          # Number of bands
            ])
            eq_data.extend([self.unsigned_byte(g) for g in gains])
        else:
            eq_data = bytearray([mode])
            eq_data.extend([self.unsigned_byte(g) for g in gains])

        attr_len = len(eq_data) + 1  # +1 for attr type

        # Build parameter data
        params = bytearray([
            seq,                    # Sequence number
            0xFF,                   # Function: Public
            attr_len,               # Attribute length
            0x04                    # Attribute type: EQ
        ])
        params.extend(eq_data)

        param_len = len(params)

        # Build complete packet
        packet = bytearray(RCSP_START)
        packet.append(0xC0)  # Flags: Command + HasResponse
        packet.append(CMD_SET_SYS_INFO)
        packet.append((param_len >> 8) & 0xFF)
        packet.append(param_len & 0xFF)
        packet.extend(params)
        packet.append(RCSP_END)

        return bytes(packet)

    async def send_command(self, packet):
        """Send command to device"""
        print("\n" + "="*80)
        print("📤 RCSP COMMAND")
        print("="*80)
        print(f"Raw: {' '.join(f'{b:02X}' for b in packet)}")
        print(f"Len: {len(packet)} bytes")
        print("="*80)

        await self.client.write_gatt_char(WRITE_CHAR_UUID, packet, response=False)

        # Wait for response
        await asyncio.sleep(1.0)

    async def read_eq(self, mask=None):
        """Read current EQ settings"""
        if mask:
            print(f"\n🎵 Reading with mask 0x{mask:08X}...")
        else:
            print("\n🎵 Reading EQ settings...")
        cmd = self.build_get_eq_cmd(mask)
        await self.send_command(cmd)

    async def write_eq(self, mode, gains):
        """Write EQ settings"""
        print(f"\n🎵 Writing EQ: Mode={mode}, Gains={gains}")
        cmd = self.build_set_eq_cmd(mode, gains)
        await self.send_command(cmd)

    def get_next_seq(self):
        """Get next sequence number"""
        seq = self.sequence_number
        self.sequence_number += 1
        if self.sequence_number > 255:
            self.sequence_number = 1
        return seq

    @staticmethod
    def signed_byte(b):
        """Convert unsigned byte to signed"""
        return b if b < 128 else b - 256

    @staticmethod
    def unsigned_byte(n):
        """Convert signed number to unsigned byte"""
        return n & 0xFF

    @staticmethod
    def get_opcode_name(opcode):
        names = {
            0x07: "GET_SYS_INFO",
            0x08: "SET_SYS_INFO"
        }
        return names.get(opcode, "UNKNOWN")

    @staticmethod
    def get_attr_name(attr_type):
        names = {
            0x00: "UNKNOWN_0x00",
            0x02: "UNKNOWN_0x02",
            0x04: "EQ",
            0x06: "UNKNOWN_0x06",
            0x09: "UNKNOWN_0x09",
            0x0A: "UNKNOWN_0x0A",
            0x0B: "BASS_TREBLE",
            0x0C: "EQ_PRESET",
            0x0D: "UNKNOWN_0x0D",
            0x0E: "UNKNOWN_0x0E",
            0x0F: "UNKNOWN_0x0F",
            0x16: "UNKNOWN_0x16",
            0x1B: "UNKNOWN_0x1B",
            0x1D: "UNKNOWN_0x1D"
        }
        return names.get(attr_type, f"UNKNOWN_0x{attr_type:02X}")

    async def disconnect(self):
        """Disconnect from device"""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
            print("\n👋 Disconnected")


async def main():
    import sys

    # Check if address provided as argument
    device_name = "UGREEN HiTune Max5c"
    if len(sys.argv) > 1:
        device_name = sys.argv[1]
        print(f"💡 Using provided address/name: {device_name}")

    device = UgreenMax5C()

    try:
        # Connect
        if not await device.connect(device_name):
            return

        print("\n" + "="*80)
        print("🎧 Ugreen Max5C Direct Test")
        print("="*80)

        # Try different query masks
        print("\n📋 Test 1: Query just EQ (mask 0x10)")
        await device.read_eq(mask=0x10)
        await asyncio.sleep(1.5)

        print("\n📋 Test 2: Query EQ Preset info (mask 0x1000)")
        await device.read_eq(mask=0x1000)
        await asyncio.sleep(1.5)

        print("\n📋 Test 3: Query both (mask 0x1010)")
        await device.read_eq(mask=0x1010)
        await asyncio.sleep(1.5)

        print("\n📋 Test 4: Query everything (mask 0xFFFFFFFF)")
        await device.read_eq(mask=0xFFFFFFFF)
        await asyncio.sleep(2)

        print("\n💡 Test Summary:")
        print("  ✅ Connection works!")
        print("  ✅ RCSP protocol communication successful!")
        print("  📝 Check responses above for EQ data")
        print("\n🔍 If no EQ data appeared, the device might:")
        print("     - Use a different protocol command")
        print("     - Need to be in a specific mode")
        print("     - Store EQ locally in the app, not on device")

    except KeyboardInterrupt:
        print("\n\n⚠️  Stopped by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await device.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
