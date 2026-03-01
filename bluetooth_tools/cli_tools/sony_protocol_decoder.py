#!/usr/bin/env python3
"""
Sony WH-1000XM5 Protocol Decoder
Decodes Sony headphone protocol commands from Frida captures
"""

import re
import sys

class SonyProtocolDecoder:
    """Decode Sony headphone protocol packets"""

    COMMAND_NAMES = {
        0x50: "EQEBB_GET_CAPABILITY",
        0x51: "EQEBB_RET_CAPABILITY",
        0x52: "EQEBB_GET_STATUS",
        0x53: "EQEBB_RET_STATUS",
        0x58: "EQEBB_SET_PARAM",
        0x59: "EQEBB_NTFY_PARAM",
        0x5A: "EQEBB_GET_PARAM",
        0x5B: "EQEBB_RET_EXTENDED_INFO",
        0x10: "COMMON_GET_BATTERY_LEVEL",
        0x94: "UNKNOWN_STATUS_CMD",
    }

    def decode_packet(self, hex_string):
        """Decode a single Sony protocol packet"""
        # Remove spaces and convert to bytes
        hex_clean = hex_string.replace(' ', '').strip()
        if len(hex_clean) < 16:  # Minimum packet size
            return None

        try:
            data = bytes.fromhex(hex_clean)
        except ValueError:
            return None

        # Check for Sony protocol header
        if len(data) < 8:
            return None

        if data[0] != 0x3E:
            return None

        packet_type = data[1]

        if packet_type == 0x0C:  # Command packet
            return self._decode_command_packet(data)
        elif packet_type == 0x01:  # ACK packet
            return self._decode_ack_packet(data)
        else:
            return {"type": "unknown", "raw": hex_string}

    def _decode_command_packet(self, data):
        """Decode command packet (3E 0C ...)"""
        if len(data) < 9:
            return None

        seq_flags = data[2:6]
        payload_len = data[6]
        command = data[7]
        payload = data[8:-2]  # Exclude checksum and footer
        checksum = data[-2]
        footer = data[-1]

        result = {
            "type": "command",
            "command_code": f"0x{command:02X}",
            "command_name": self.COMMAND_NAMES.get(command, "UNKNOWN"),
            "seq_flags": seq_flags.hex().upper(),
            "payload_length": payload_len,
            "checksum": f"0x{checksum:02X}",
        }

        # Decode specific command payloads
        if command == 0x58:  # SET_PARAM
            result["details"] = self._decode_set_param(payload)
        elif command == 0x59:  # NTFY_PARAM
            result["details"] = self._decode_ntfy_param(payload)
        elif command == 0x5A:  # GET_PARAM
            result["details"] = {"type": "query"}
        elif command == 0x5B:  # RET_EXTENDED_INFO
            result["details"] = self._decode_extended_info(payload)

        return result

    def _decode_ack_packet(self, data):
        """Decode ACK packet (3E 01 ...)"""
        if len(data) < 9:
            return None

        return {
            "type": "ack",
            "flags": data[2:7].hex().upper(),
            "code": f"0x{data[7]:02X}",
        }

    def _decode_set_param(self, payload):
        """Decode SET_PARAM command payload"""
        if len(payload) < 2:
            return {"raw": payload.hex().upper()}

        flag = payload[0]
        preset_id = payload[1]

        result = {
            "flag": f"0x{flag:02X}",
            "preset_id": f"0x{preset_id:02X}",
        }

        if preset_id == 0x00:
            result["preset_name"] = "EQ OFF"
        elif preset_id == 0x10:
            result["preset_name"] = "Custom Profile 16"
        else:
            result["preset_name"] = f"Profile {preset_id}"

        return result

    def _decode_ntfy_param(self, payload):
        """Decode NTFY_PARAM response with EQ band values"""
        if len(payload) < 4:
            return {"raw": payload.hex().upper()}

        flag = payload[0]
        preset_id = payload[1]
        num_bands = payload[2]
        band_values = payload[3:]

        result = {
            "flag": f"0x{flag:02X}",
            "preset_id": f"0x{preset_id:02X}",
            "num_bands": num_bands,
            "band_values_hex": ' '.join(f"{b:02X}" for b in band_values),
            "band_values_dec": [b for b in band_values],
        }

        # Decode band values (assuming 10 = 0dB baseline)
        if len(band_values) >= num_bands:
            gains = []
            for i in range(num_bands):
                raw_value = band_values[i]
                gain_db = raw_value - 10  # 10 is 0dB baseline
                gains.append(f"{gain_db:+d} dB")
            result["band_gains"] = gains

        if preset_id == 0x00:
            result["preset_name"] = "EQ OFF"
        elif preset_id == 0x10:
            result["preset_name"] = "Custom Profile 16"
        else:
            result["preset_name"] = f"Profile {preset_id}"

        return result

    def _decode_extended_info(self, payload):
        """Decode RET_EXTENDED_INFO response"""
        if len(payload) < 2:
            return {"raw": payload.hex().upper()}

        flag = payload[0]
        num_bands = payload[1]
        freq_data = payload[2:]

        result = {
            "flag": f"0x{flag:02X}",
            "num_bands": num_bands,
            "frequency_data_raw": freq_data.hex().upper(),
        }

        # Try to decode frequencies
        # Format appears to be: [freq_bytes] per band
        # Need more analysis to decode properly

        return result


def process_capture_file(filename):
    """Process a Frida capture file and decode Sony protocol packets"""
    decoder = SonyProtocolDecoder()

    with open(filename, 'r') as f:
        content = f.read()

    # Find all hex packets (lines with "Hex: ")
    hex_pattern = r'Hex:\s+([0-9A-F\s]+)'
    matches = re.findall(hex_pattern, content, re.IGNORECASE)

    print("=" * 80)
    print("SONY PROTOCOL DECODER")
    print("=" * 80)
    print()

    packet_count = 0
    for hex_data in matches:
        result = decoder.decode_packet(hex_data)

        if result and result.get("type") in ["command", "ack"]:
            packet_count += 1
            print(f"Packet #{packet_count}")
            print(f"  Type: {result['type'].upper()}")

            if result['type'] == 'command':
                print(f"  Command: {result['command_name']} ({result['command_code']})")
                print(f"  Seq Flags: {result['seq_flags']}")
                print(f"  Payload Length: {result['payload_length']}")

                if 'details' in result:
                    print(f"  Details:")
                    for key, value in result['details'].items():
                        if isinstance(value, list):
                            print(f"    {key}:")
                            for i, v in enumerate(value, 1):
                                print(f"      Band {i}: {v}")
                        else:
                            print(f"    {key}: {value}")

            elif result['type'] == 'ack':
                print(f"  ACK Code: {result['code']}")

            print()


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: sony_protocol_decoder.py <capture_file>")
        print()
        print("Decodes Sony headphone protocol from Frida capture files")
        sys.exit(1)

    filename = sys.argv[1]
    process_capture_file(filename)


if __name__ == '__main__':
    main()
