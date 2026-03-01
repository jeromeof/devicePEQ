#!/usr/bin/env python3
"""
RoseLink Bluetooth SPP Protocol CLI Tool
For Cambrian ANC headphones using Classic Bluetooth SPP

Protocol: TX[0xFF 0x00 Length Data... 0xAA] RX[0xDD 0x00 Length Data... 0xAA]
See roselink-eq-PROTOCOL.md for details
"""

import serial
import sys
import time
import threading
from glob import glob


# ========================================================================
# Protocol Constants
# ========================================================================

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
# RoseLink SPP Controller
# ========================================================================

class RoseLinkSPPController:
    def __init__(self, port):
        self.port = port
        self.serial = None
        self.running = False
        self.read_thread = None

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
        elif param_id == 0x01 and len(value) >= 20:
            # Multi-parameter response
            print(f"   Multi-param response: {format_hex(value)}")
        else:
            print(f"   Param 0x{param_id:02X}: {format_hex(value)}")

    def read_worker(self):
        """Background thread to read responses"""
        buffer = b''
        print("📡 Read thread active, waiting for data...")

        while self.running:
            try:
                if self.serial.in_waiting > 0:
                    data = self.serial.read(self.serial.in_waiting)
                    print(f"\n📥 Received {len(data)} bytes: {format_hex(data)}")
                    buffer += data

                    # Process complete frames in buffer
                    while len(buffer) >= 5:
                        # Look for frame start
                        if buffer[0] != RX_START:
                            # Skip invalid byte
                            buffer = buffer[1:]
                            continue

                        # Check if we have enough data for length field
                        if len(buffer) < 3:
                            break

                        length = buffer[2]
                        frame_len = 3 + length + 1  # header + data + end marker

                        # Wait for complete frame
                        if len(buffer) < frame_len:
                            break

                        # Extract frame
                        frame = buffer[:frame_len]
                        buffer = buffer[frame_len:]

                        # Display and parse
                        print(f"\n← RX: [{format_hex(frame)}]")
                        payload = parse_rx_frame(frame)
                        if payload:
                            self.parse_response(payload)
                        else:
                            print("   [Invalid frame]")

                time.sleep(0.01)
            except Exception as e:
                if self.running:
                    print(f"\n✗ Read error: {e}")
                break

    def connect(self):
        """Connect to SPP port"""
        print(f"Opening {self.port}...")
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=115200,  # Standard baud rate, may be ignored for BT SPP
                timeout=0.1,  # Non-blocking with short timeout
                rtscts=False,
                dsrdtr=False
            )
            print("✓ Connected to SPP port")
            print(f"  Port settings: {self.serial.baudrate} baud")
            print(f"  Timeout: {self.serial.timeout}s")

            # Give the connection a moment to stabilize
            time.sleep(0.5)

            # Start read thread
            self.running = True
            self.read_thread = threading.Thread(target=self.read_worker, daemon=True)
            self.read_thread.start()
            print("✓ Read thread started")

            # Test if we can write
            print("\n🧪 Testing serial port...")
            print(f"  Writable: {self.serial.writable()}")
            print(f"  Readable: {self.serial.readable()}")
            print()
            return True

        except Exception as e:
            print(f"✗ Connection failed: {e}")
            return False

    def disconnect(self):
        """Disconnect from port"""
        self.running = False
        if self.read_thread:
            self.read_thread.join(timeout=1)

        if self.serial and self.serial.is_open:
            self.serial.close()
            print("✓ Disconnected")

    def send_command(self, data):
        """Send command"""
        print(f"\n→ TX: [{format_hex(data)}] (len={len(data)})")
        print(f"   Raw bytes: {list(data)}")

        try:
            bytes_written = self.serial.write(data)
            self.serial.flush()
            print(f"   ✓ Sent {bytes_written} bytes")
            print(f"   Waiting for response...")
        except Exception as e:
            print(f"   ✗ Write error: {e}")

    def query_all(self):
        """Query all device parameters"""
        print("\n=== Query All Parameters ===")
        cmd = build_query_all()
        self.send_command(cmd)
        time.sleep(0.5)  # Wait for responses

    def set_eq_preset(self, preset_value):
        """Set EQ preset"""
        preset_name = PRESET_NAMES.get(preset_value, f"Unknown ({preset_value})")
        print(f"\n=== Set EQ Preset: {preset_name} ===")
        cmd = build_set_eq_preset(preset_value)
        self.send_command(cmd)
        time.sleep(0.2)

    def get_battery(self):
        """Query battery level"""
        print("\n=== Query Battery ===")
        data = [CMD_QUERY_MULTIPLE, PARAM_BATTERY]
        cmd = build_tx_frame(data)
        self.send_command(cmd)
        time.sleep(0.3)

    def get_firmware(self):
        """Query firmware version"""
        print("\n=== Query Firmware ===")
        data = [CMD_QUERY_MULTIPLE, PARAM_FIRMWARE]
        cmd = build_tx_frame(data)
        self.send_command(cmd)
        time.sleep(0.3)


# ========================================================================
# Find SPP Ports
# ========================================================================

def find_roselink_ports():
    """Find RoseLink SPP ports"""
    # Use /dev/cu.* not /dev/tty.* on macOS:
    # tty.* waits for DCD and is held busy by the OS; cu.* is for outgoing connections
    ports = glob('/dev/cu.*')
    roselink_ports = []

    for port in ports:
        port_name = port.lower()
        if 'rose' in port_name or 'cambrian' in port_name:
            roselink_ports.append(port)

    return roselink_ports


# ========================================================================
# Interactive Menu
# ========================================================================

def interactive_mode(controller):
    """Interactive command menu"""
    while True:
        print("\n" + "=" * 60)
        print("RoseLink SPP Controller - Interactive Mode")
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
                controller.query_all()
            elif choice == '2':
                controller.set_eq_preset(EQ_HIFI)
            elif choice == '3':
                controller.set_eq_preset(EQ_POP)
            elif choice == '4':
                controller.set_eq_preset(EQ_ROCK)
            elif choice == '5':
                controller.get_battery()
            elif choice == '6':
                controller.get_firmware()
            elif choice == '7':
                hex_input = input("Enter hex bytes (space separated): ").strip()
                try:
                    data = bytes.fromhex(hex_input.replace(' ', ''))
                    controller.send_command(data)
                    time.sleep(0.5)
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

def main():
    print("=" * 60)
    print("RoseLink Bluetooth SPP Protocol CLI Tool")
    print("For Cambrian ANC Headphones")
    print("=" * 60)
    print()

    if len(sys.argv) > 1:
        port = sys.argv[1]
    else:
        # Find RoseLink ports
        ports = find_roselink_ports()

        if not ports:
            print("No RoseLink SPP ports found.")
            print("\nAvailable ports:")
            all_ports = glob('/dev/tty.*')
            for p in all_ports[:10]:
                print(f"  {p}")
            print("\nUsage: python roselink-spp-cli.py <PORT>")
            print("Example: python roselink-spp-cli.py /dev/tty.ROSECAMBRIAN")
            return

        if len(ports) == 1:
            port = ports[0]
            print(f"Auto-selecting: {port}")
        else:
            print("Multiple RoseLink ports found:")
            for p in ports:
                print(f"  {p}")
            print("\nUsage: python roselink-spp-cli.py <PORT>")
            return

    controller = RoseLinkSPPController(port)

    try:
        if not controller.connect():
            return

        # Initial query
        controller.query_all()
        time.sleep(1)

        # Enter interactive mode
        interactive_mode(controller)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        controller.disconnect()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nExiting...")
