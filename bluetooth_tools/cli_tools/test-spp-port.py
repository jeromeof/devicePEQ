#!/usr/bin/env python3
"""
Simple SPP port diagnostic tool
"""

import serial
import time
import sys

port = "/dev/tty.ROSECAMBRIAN"

if len(sys.argv) > 1:
    port = sys.argv[1]

print(f"Testing {port}")
print("=" * 60)

try:
    ser = serial.Serial(port, baudrate=115200, timeout=2)
    print(f"✓ Opened port")
    print(f"  Baudrate: {ser.baudrate}")
    print(f"  Timeout: {ser.timeout}")
    print(f"  Writable: {ser.writable()}")
    print(f"  Readable: {ser.readable()}")
    print()

    # Try to read any initial data
    print("Checking for initial data...")
    time.sleep(0.5)
    if ser.in_waiting > 0:
        data = ser.read(ser.in_waiting)
        print(f"✓ Got {len(data)} bytes: {data.hex().upper()}")
    else:
        print("  No initial data")

    print()
    print("Sending simple test command: FF 00 02 2A 00 AA (Set HiFi)")
    test_cmd = bytes([0xFF, 0x00, 0x02, 0x2A, 0x00, 0xAA])
    print(f"TX: {test_cmd.hex().upper()}")

    written = ser.write(test_cmd)
    ser.flush()
    print(f"  Wrote {written} bytes")

    print()
    print("Waiting for response (5 seconds)...")
    for i in range(50):
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            print(f"\n✓ RX: {data.hex().upper()} ({len(data)} bytes)")
            print(f"   Raw: {list(data)}")
            break
        time.sleep(0.1)
        if i % 10 == 0:
            print(f"  {5 - i//10}s...", end="", flush=True)
    else:
        print("\n  No response received")

    print()
    print("Sending query command: FF 00 02 FA 2A AA (Query EQ preset)")
    query_cmd = bytes([0xFF, 0x00, 0x02, 0xFA, 0x2A, 0xAA])
    print(f"TX: {query_cmd.hex().upper()}")

    written = ser.write(query_cmd)
    ser.flush()
    print(f"  Wrote {written} bytes")

    print()
    print("Waiting for response (5 seconds)...")
    for i in range(50):
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            print(f"\n✓ RX: {data.hex().upper()} ({len(data)} bytes)")
            print(f"   Raw: {list(data)}")
            break
        time.sleep(0.1)
        if i % 10 == 0:
            print(f"  {5 - i//10}s...", end="", flush=True)
    else:
        print("\n  No response received")

    ser.close()
    print("\n✓ Test complete")

except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()
