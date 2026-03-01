#!/usr/bin/env python3
"""
Audeze Maxwell - Airoha BLE Protocol Test

Tests the Airoha BLE service that was discovered:
Service: 5052494d-2dab-0341-6972-6f6861424c45 (PRIM-Airoha BLE)
  TX Char: 43484152-2dab-3241-6972-6f6861424c45 (CHAR-2AirohaBLE)
  RX Char: 43484152-2dab-3141-6972-6f6861424c45 (CHAR-1AirohaBLE)
"""

import asyncio
import struct
from bleak import BleakClient, BleakScanner

# Airoha BLE service and characteristics
AIROHA_SERVICE_UUID = "5052494d-2dab-0341-6972-6f6861424c45"
AIROHA_TX_CHAR_UUID = "43484152-2dab-3241-6972-6f6861424c45"  # Write
AIROHA_RX_CHAR_UUID = "43484152-2dab-3141-6972-6f6861424c45"  # Notify

# Airoha commands
def build_read_preset_command(preset_num: int) -> bytes:
    """Build command to read EQ preset (0-3)"""
    if preset_num < 0 or preset_num > 3:
        raise ValueError("Preset must be 0-3")

    payload = bytes([0x00, 0x00, 0x0A, preset_num, 0xEF, 0xE8, 0x03])
    header = bytes([0x05, 0x5A, 0x06])
    packet = header + payload
    return packet

def parse_peq_response(data: bytes) -> dict:
    """Parse PEQ response packet"""
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


async def test_maxwell_airoha_ble(preset=1):
    """Test Maxwell using the Airoha BLE service"""

    print("🔍 Scanning for Maxwell...")
    devices = await BleakScanner.discover(timeout=10, return_adv=True)

    maxwell_addr = None
    for address, (device, adv_data) in devices.items():
        if device.name and 'maxwell' in device.name.lower():
            maxwell_addr = address
            rssi = adv_data.rssi if hasattr(adv_data, 'rssi') else None
            print(f"✅ Found: {device.name} [{address}]")
            print(f"   RSSI: {rssi} dBm")
            break

    if not maxwell_addr:
        print("❌ Maxwell not found")
        print("   Make sure Maxwell is powered on and in range")
        return False

    print(f"\n{'='*70}")
    print(f"🎧 Testing Airoha BLE Protocol")
    print(f"{'='*70}\n")

    try:
        async with BleakClient(maxwell_addr, timeout=15.0) as client:
            print("✅ Connected to Maxwell\n")

            # Verify services exist
            has_service = False
            for service in client.services:
                if AIROHA_SERVICE_UUID.lower() in str(service.uuid).lower():
                    has_service = True
                    print(f"✅ Found Airoha BLE service: {service.uuid}")
                    break

            if not has_service:
                print(f"❌ Airoha BLE service not found!")
                return False

            # Collect response data
            response_data = bytearray()
            response_complete = asyncio.Event()

            def notification_handler(sender, data):
                nonlocal response_data
                response_data.extend(data)
                hex_str = " ".join(f"{b:02X}" for b in data)
                print(f"  📥 Received {len(data)} bytes: {hex_str}")

                # Check if we have a complete response
                if len(response_data) >= 193:
                    response_complete.set()

            # Enable notifications on RX characteristic
            print(f"\n📡 Enabling notifications on RX characteristic...")
            print(f"   {AIROHA_RX_CHAR_UUID}")
            await client.start_notify(AIROHA_RX_CHAR_UUID, notification_handler)
            print("✅ Notifications enabled\n")

            # Build command
            cmd = build_read_preset_command(preset)

            print(f"📤 Sending PEQ read command (Preset {preset})")
            print(f"   TX Characteristic: {AIROHA_TX_CHAR_UUID}")
            print(f"   Command: {cmd.hex(' ').upper()}")
            print(f"   Length: {len(cmd)} bytes\n")

            # Try write without response first (faster)
            try:
                await client.write_gatt_char(AIROHA_TX_CHAR_UUID, cmd, response=False)
                print("✅ Command sent (write-without-response)\n")
            except Exception as e:
                print(f"⚠️  Write-without-response failed: {e}")
                print("   Trying write-with-response...")
                await client.write_gatt_char(AIROHA_TX_CHAR_UUID, cmd, response=True)
                print("✅ Command sent (write-with-response)\n")

            # Wait for response
            print("⏳ Waiting for response...")
            try:
                await asyncio.wait_for(response_complete.wait(), timeout=5.0)
                print(f"✅ Response received!\n")
            except asyncio.TimeoutError:
                print(f"⚠️  Timeout waiting for complete response")
                print(f"   Received {len(response_data)} bytes so far\n")

            # Stop notifications
            await client.stop_notify(AIROHA_RX_CHAR_UUID)

            # Parse response
            if len(response_data) > 0:
                print(f"{'='*70}")
                print(f"📊 Response Analysis")
                print(f"{'='*70}\n")
                print(f"Total bytes received: {len(response_data)}")

                # Show raw data (first 50 bytes)
                hex_str = " ".join(f"{b:02X}" for b in response_data[:50])
                print(f"Raw data: {hex_str}...")

                # Try to parse as Airoha PEQ response
                result = parse_peq_response(bytes(response_data))

                if result:
                    print(f"\n🎉 SUCCESS! Valid Airoha PEQ response!\n")
                    print(f"{'='*70}")
                    print(f"📊 EQ Configuration (Preset {preset})")
                    print(f"{'='*70}\n")
                    print(f"Bands: {result['num_bands']}")
                    print(f"EQ Enabled: {'Yes' if result['eq_enabled'] else 'No'}\n")

                    if result['filters']:
                        print(f"{'Band':<6} {'Freq(Hz)':<12} {'Gain(dB)':<12} {'Q':<10}")
                        print(f"{'-'*50}")

                        for f in result['filters']:
                            print(f"{f['index']:<6} {f['freq_hz']:<12.1f} "
                                  f"{f['gain_db']:<+12.2f} {f['q_value']:<10.2f}")

                    print(f"\n{'='*70}")
                    print("✅ BLE GATT Communication Works!")
                    print("✅ Chrome Web Bluetooth API Compatible!")
                    print(f"{'='*70}\n")

                    return True
                else:
                    print(f"\n⚠️  Response doesn't match Airoha PEQ format")
                    print(f"   Expected header: 05 5B BD")
                    print(f"   Got: {response_data[:3].hex(' ').upper()}")

            else:
                print("❌ No response received")
                print("   The device may not support this command over BLE")

            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("🎧 Audeze Maxwell - Airoha BLE Protocol Test\n")
    print("This tests the discovered Airoha BLE service:")
    print(f"  Service: {AIROHA_SERVICE_UUID}")
    print(f"  TX Char: {AIROHA_TX_CHAR_UUID}")
    print(f"  RX Char: {AIROHA_RX_CHAR_UUID}\n")

    try:
        success = asyncio.run(test_maxwell_airoha_ble(preset=1))

        if success:
            print("\n💡 Next steps:")
            print("  • This BLE approach works and is Chrome-compatible!")
            print("  • Use Web Bluetooth API in Chrome to connect")
            print("  • Service UUID: 5052494d-2dab-0341-6972-6f6861424c45")
            print("  • TX Char: 43484152-2dab-3241-6972-6f6861424c45")
            print("  • RX Char: 43484152-2dab-3141-6972-6f6861424c45")
        else:
            print("\n⚠️  BLE communication didn't work as expected")
            print("   Maxwell may require Classic Bluetooth (SPP) instead")

    except KeyboardInterrupt:
        print("\n⚠️  Cancelled by user")
