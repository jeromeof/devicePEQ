#!/usr/bin/env python3
"""
SoundPeats H3 BLE CLI — Jieli SDK protocol
Service:  0000ae00-0000-1000-8000-00805F9B34FB
Write:    0000ae01-0000-1000-8000-00805F9B34FB
Notify:   0000ae02-0000-1000-8000-00805F9B34FB

Packet format:  FF 04 00 [len] [sub0] [sub1] [cmdHi] [cmdLo] [payload...]
  Standard sub: 00 0A
  EQ sub:       00 28  (for cmd 0x0E01 and 0x0E02)
"""

import asyncio
import struct
import sys
from bleak import BleakScanner, BleakClient

JIELI_SERVICE = "0000ae00-0000-1000-8000-00805f9b34fb"
JIELI_WRITE   = "0000ae01-0000-1000-8000-00805f9b34fb"
JIELI_NOTIFY  = "0000ae02-0000-1000-8000-00805f9b34fb"

# Feature command codes (from FeatureConstant.java)
CMD_GET_LEFT_BATTERY  = 0x0306   # 774
CMD_GET_RIGHT_BATTERY = 0x0307   # 775
CMD_GET_FIRMWARE      = 0x0309   # 777
CMD_GET_ANC_MODE      = 0x0310   # 784
CMD_GET_CASE_BATTERY  = 0x0323   # 803
CMD_GET_DYNAMIC_EQ    = 0x0331   # 817
CMD_SET_DYNAMIC_EQ    = 0x0332   # 818
CMD_GET_DYNAMIC_BASS  = 0x033C   # 828
CMD_MODIFY_EQ_V1      = 0x0E01   # 3585
CMD_MODIFY_EQ_V2      = 0x0E02   # 3586

EQ_CMDS = {CMD_MODIFY_EQ_V1, CMD_MODIFY_EQ_V2}

received_packets = asyncio.Queue()


def build_packet(cmd_code: int, payload: bytes = b"") -> bytes:
    is_eq = cmd_code in EQ_CMDS
    sub1 = 0x28 if is_eq else 0x0A
    header = bytes([0xFF, 0x04, 0x00, len(payload), 0x00, sub1,
                    (cmd_code >> 8) & 0xFF, cmd_code & 0xFF])
    return header + payload


def parse_packet(data: bytes) -> dict | None:
    if len(data) < 8:
        return None
    sub = (data[4] << 8) | data[5]
    cmd = (data[6] << 8) | data[7]
    plen = data[3]
    payload = data[8:8 + plen]
    return {"sub": sub, "cmd": cmd, "payload": payload, "raw": data}


def notification_handler(_, data: bytes):
    hex_str = data.hex(" ").upper()
    pkt = parse_packet(data)
    print(f"  ← RX ({len(data)}B): {hex_str}")
    if pkt:
        decode_packet(pkt)
    received_packets.put_nowait(pkt)


def decode_packet(pkt: dict):
    cmd, payload = pkt["cmd"], pkt["payload"]
    if cmd == CMD_GET_LEFT_BATTERY and payload:
        print(f"      Left battery: {payload[0]}%")
    elif cmd == CMD_GET_RIGHT_BATTERY and payload:
        print(f"      Right battery: {payload[0]}%")
    elif cmd == CMD_GET_CASE_BATTERY and payload:
        print(f"      Case battery: {payload[0]}%")
    elif cmd == CMD_GET_FIRMWARE and payload:
        ver = payload.decode("ascii", errors="replace").rstrip("\x00")
        print(f"      Firmware: {ver or payload.hex()}")
    elif cmd == CMD_GET_ANC_MODE and payload:
        modes = {0: "Normal", 1: "ANC", 2: "Transparency", 3: "Wind Reduction"}
        print(f"      ANC mode: {modes.get(payload[0], f'0x{payload[0]:02X}')}")
    elif cmd == CMD_GET_DYNAMIC_EQ and payload:
        print(f"      Dynamic EQ: {'ON' if payload[0] else 'OFF'}")
    elif cmd in (CMD_MODIFY_EQ_V1, CMD_MODIFY_EQ_V2):
        ver = "V1" if cmd == CMD_MODIFY_EQ_V1 else "V2"
        print(f"      EQ {ver} response ({len(payload)}B): {payload.hex(' ').upper()}")
        decode_eq_payload(payload)
    elif payload:
        print(f"      cmd=0x{cmd:04X} payload: {payload.hex(' ').upper()}")


def decode_eq_payload(payload: bytes):
    """Try multiple decoding strategies for EQ payload."""
    n = len(payload)
    if n == 0:
        print("        (empty payload — may be ACK)")
        return

    # Strategy 1: 3 bytes per band (bandId, gainSigned, q_byte)
    if n % 3 == 0:
        bands = n // 3
        print(f"        [3B/band] {bands} bands:")
        for i in range(bands):
            idx = payload[i*3]
            gain = payload[i*3+1] if payload[i*3+1] < 128 else payload[i*3+1] - 256
            q = payload[i*3+2]
            print(f"          Band[{idx}]: gain={gain:+.0f}dB, q_byte=0x{q:02X}")
        return

    # Strategy 2: 2 bytes per band, int16 BE gain ×10
    if n % 2 == 0:
        bands = n // 2
        print(f"        [2B/band, gain×10] {bands} bands:")
        for i in range(bands):
            v = struct.unpack(">h", payload[i*2:i*2+2])[0]
            print(f"          Band[{i}]: gain={v/10:+.1f}dB")
        return

    # Strategy 3: 1 byte per band, signed
    print(f"        [1B/band] {n} bands:")
    for i, b in enumerate(payload):
        gain = b if b < 128 else b - 256
        print(f"          Band[{i}]: gain={gain:+.0f}dB")


async def send_cmd(client: BleakClient, cmd: int, payload: bytes = b""):
    pkt = build_packet(cmd, payload)
    hex_str = pkt.hex(" ").upper()
    print(f"  → TX [cmd=0x{cmd:04X}]: {hex_str}")
    try:
        await client.write_gatt_char(JIELI_WRITE, pkt, response=False)
    except Exception:
        await client.write_gatt_char(JIELI_WRITE, pkt, response=True)


async def wait_response(timeout: float = 1.0) -> dict | None:
    try:
        return await asyncio.wait_for(received_packets.get(), timeout)
    except asyncio.TimeoutError:
        return None


async def probe_device(client: BleakClient):
    print("\n=== Device Probe ===")
    probes = [
        ("Firmware",      CMD_GET_FIRMWARE),
        ("Left battery",  CMD_GET_LEFT_BATTERY),
        ("Right battery", CMD_GET_RIGHT_BATTERY),
        ("Case battery",  CMD_GET_CASE_BATTERY),
        ("ANC mode",      CMD_GET_ANC_MODE),
        ("Dynamic EQ",    CMD_GET_DYNAMIC_EQ),
        ("Dynamic bass",  CMD_GET_DYNAMIC_BASS),
    ]
    for label, cmd in probes:
        print(f"\n[{label}]")
        await send_cmd(client, cmd)
        await asyncio.sleep(0.3)


async def read_eq(client: BleakClient, version: str = "v2"):
    cmd = CMD_MODIFY_EQ_V2 if version == "v2" else CMD_MODIFY_EQ_V1
    print(f"\n=== Read EQ ({version.upper()}) ===")
    await send_cmd(client, cmd)
    await asyncio.sleep(0.5)


def build_eq_v2_payload(gains: list[float], q: float = 1.41) -> bytes:
    """V2 payload: per band → [bandId, gainHi, gainLo, qHi, qLo] (5B per band).
    gain is int16 BE ×10, Q is int16 BE ×100."""
    payload = bytearray()
    q_int = round(q * 100)
    for i, g in enumerate(gains):
        gain_int = round(g * 10)
        payload.append(i)
        payload.extend(struct.pack(">h", gain_int))
        payload.extend(struct.pack(">h", q_int))
    return bytes(payload)


def build_eq_v1_payload(gains: list[float]) -> bytes:
    """V1 payload: one signed byte per band (raw dB)."""
    return bytes([round(g) % 256 for g in gains])


async def write_eq(client: BleakClient, gains: list[float], version: str = "v2"):
    cmd = CMD_MODIFY_EQ_V2 if version == "v2" else CMD_MODIFY_EQ_V1
    payload = build_eq_v2_payload(gains) if version == "v2" else build_eq_v1_payload(gains)
    gains_str = " ".join(f"{g:+.1f}" for g in gains)
    print(f"\n=== Write EQ ({version.upper()}): [{gains_str}] ===")
    await send_cmd(client, cmd, payload)
    await asyncio.sleep(0.3)


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="SoundPeats H3 BLE CLI")
    parser.add_argument("--scan",    action="store_true", help="Scan for SoundPeats devices")
    parser.add_argument("--address", type=str,            help="BLE address (skip scan)")
    parser.add_argument("--probe",   action="store_true", help="Query all device info")
    parser.add_argument("--read-eq", action="store_true", help="Read current EQ from device")
    parser.add_argument("--write-eq",nargs="+", type=float, metavar="DB",
                        help="Write EQ gains in dB (space-separated, e.g. --write-eq 3 1 0 0 0 0 0 -1 -2 -1 0)")
    parser.add_argument("--flat",    action="store_true", help="Write flat (0dB) EQ")
    parser.add_argument("--version", default="v2", choices=["v1","v2"], help="EQ command version")
    args = parser.parse_args()

    # Scan
    if args.scan or not args.address:
        print("Scanning for SoundPeats devices (5s)…")
        devices = await BleakScanner.discover(timeout=5.0)
        sp_devices = [d for d in devices if d.name and
                      any(p in d.name.upper() for p in ["SOUNDPEATS","SOUND PEATS","H3"])]
        if not sp_devices:
            print("No SoundPeats devices found. All devices:")
            for d in devices:
                print(f"  {d.address}  {d.name or '(unnamed)'}")
        else:
            print(f"Found {len(sp_devices)} SoundPeats device(s):")
            for d in sp_devices:
                print(f"  {d.address}  {d.name}")
        if args.scan or not args.address:
            if sp_devices and not args.address:
                args.address = sp_devices[0].address
                print(f"Auto-selecting: {args.address}")
            else:
                return

    address = args.address
    print(f"\nConnecting to {address}…")

    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")
        await client.start_notify(JIELI_NOTIFY, notification_handler)
        print("Notifications enabled on ae02")
        await asyncio.sleep(0.2)

        if args.probe or not any([args.read_eq, args.write_eq, args.flat]):
            await probe_device(client)

        if args.read_eq:
            await read_eq(client, args.version)

        if args.write_eq:
            await write_eq(client, args.write_eq, args.version)

        if args.flat:
            await write_eq(client, [0.0] * 11, args.version)

        # Wait for any remaining responses
        print("\nWaiting for responses…")
        await asyncio.sleep(1.0)
        print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
