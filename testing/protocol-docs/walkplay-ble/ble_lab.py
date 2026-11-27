#!/usr/bin/env python3
"""WalkPlay BLE lab: connects to a WalkPlay dongle over Bluetooth LE, subscribes to EVERY notify/indicate characteristic,
logs every frame both ways, and runs experiments.

    python3 ble_lab.py <ble-name> <log.jsonl> <experiment> [args]

Experiments:
    gatt            dump services / characteristics / properties / readable values
    plainreads N    N plain EQ-group reads (cmd 0x09, 58 zero bytes): does a cursor advance?
    idxsweep V      EQ-group read with V at each payload byte 0..57 (V = a band index, e.g. 3)
    lensweep V      EQ-group read, index V at payload[1], length byte 0..0x40 and exact/padded frames, with/without 0x4B
    cmdscan         one read (0x80) of every command 0x00..0x3F except unsafe ones, payload 0/2/4 zero bytes
    chipid          chip id (cmd 0x0E) twice
    dirsweep N HEX  cmd 0x09 with band N's exact current payload under direction bytes 0x80, 0x01, 0x00, 0x02 … 0xFF, each
                    followed by two plain reads (is the payload/index forwarded for any direction?)
    raw HEX...      send the given frames (hex) as is, one by one
    script STEP...  steps in ONE connection: band (EQ-group read), gain (global-gain read), idx:N (band read, index N),
                    wait:MS, usb:FILE (push FILE over USB with usb_tool.mjs, between BLE reads), usbread (USB band dump),
                    bwrite:N:HEX (BLE band write, 58-byte payload hex), bapply (BLE 0x0A [0]), bsave (BLE 0x04 [0]),
                    usbcommit (USB 0x0A + 0x01 only), usbrestore:SNAPSHOT — USB is reached through usb_tool.mjs (env USB_PID)

Every write and every notification goes to the log as a JSON line:
    {"t", "link":"ble", "dir":"tx"|"rx", "char", "hex", "note"}
Unsafe commands are never sent by the sweeps: 0x01 save, 0x04 save offsets+EQ, 0x05 erase flash, 0x0A apply,
0x17 restore factory, 0x09 with dir 0x01 (band write).
"""
import asyncio, json, sys, time
from datetime import datetime, timezone
from bleak import BleakClient, BleakScanner

NAME, LOG, EXP, *ARGS = sys.argv[1:]
UNSAFE = {0x01, 0x04, 0x05, 0x0A, 0x17}
DATA_PREF = ['0000ab02-0000-1000-8000-00805f9b34fb', '0000ff20-0000-1000-8000-00805f9b34fb']
rx = []
logf = open(LOG, 'a')

def log(direction, char, data, note=None):
    rec = {'t': datetime.now(timezone.utc).isoformat(), 'link': 'ble', 'dir': direction, 'char': char[4:8] if char else None,
           'hex': bytes(data).hex(' ')}
    if note: rec['note'] = note
    logf.write(json.dumps(rec) + '\n'); logf.flush()

def frame(direction, cmd, payload, length=None, pad=64, prefix=True):
    payload = bytes(payload)
    head = bytes([direction, cmd, (len(payload) + 2 if length is None else length) & 0xFF])
    b = (bytes([0x4B]) if prefix else b'') + head + payload
    return b + bytes(max(0, pad - len(b))) if pad else b

def band(d):
    """Decodes an EQ-group reply (with 0x4B)."""
    if len(d) < 37 or d[2] != 0x09: return None
    p = d[4:]
    g = int.from_bytes(p[28:30], 'little', signed=True) / 256
    return f"idx {p[1]} {p[24] | p[25] << 8} Hz {g:+.2f} dB Q{(p[26] | p[27] << 8) / 256:.2f} type {p[30]} tag {p[32]}"

async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d, a: (a.local_name or d.name) == NAME, timeout=40)
    if not dev: print('not found'); return
    async with BleakClient(dev, timeout=20) as c:
        chars = [ch for s in c.services for ch in s.characteristics]
        import os
        pref = [os.environ['DATA_CHAR']] if os.environ.get('DATA_CHAR') else DATA_PREF  # e.g. DATA_CHAR=0000fff1-0000-1000-8000-00805f9b34fb
        data = next((ch for u in pref for ch in chars if ch.uuid == u), None)
        for ch in chars:
            if 'notify' in ch.properties or 'indicate' in ch.properties:
                u = ch.uuid
                await c.start_notify(ch, lambda h, d, u=u: (rx.append((u, bytes(d))), log('rx', u, d)))
        async def send(f, note=None, wait=0.35, char=None, response=True):
            rx.clear()
            ch = char or data
            log('tx', ch.uuid, f, note)
            try:
                await c.write_gatt_char(ch, f, response=response)
            except Exception as e:
                log('err', ch.uuid, b'', f'{note}: {e}')
                return 'GATT ERR ' + str(e).split(':')[-1].strip()
            await asyncio.sleep(wait)
            return ' | '.join(f"[{u[4:8]}] " + (band(d) or d[:12].hex(' ')) for u, d in rx) or '(no reply)'

        if EXP == 'gatt':
            for s in c.services:
                print('SVC', s.uuid)
                for ch in s.characteristics:
                    v = ''
                    if 'read' in ch.properties:
                        try: v = (await c.read_gatt_char(ch)).hex(' ')[:60]
                        except Exception as e: v = f'<{e}>'
                    print('   CHR', ch.uuid, ch.properties, v)
            print('data channel:', data.uuid if data else None)
        elif EXP == 'chipid':
            for k in range(2): print('chip id', await send(frame(0x80, 0x0E, [0, 0, 0, 0]), 'chip id'))
        elif EXP == 'plainreads':
            for k in range(int(ARGS[0])): print(f'read {k:2}', await send(frame(0x80, 0x09, bytes(58)), f'plain read {k}'))
        elif EXP == 'idxsweep':
            v = int(ARGS[0])
            for pos in range(58):
                p = bytearray(58); p[pos] = v
                print(f'idx {v} @payload[{pos:2}]', await send(frame(0x80, 0x09, p), f'idx@{pos}'))
        elif EXP == 'lensweep':
            v = int(ARGS[0])
            for prefix in (True, False):
                for padded in (True, False):
                    for L in (0, 1, 2, 3, 4, 5, 6, 8, 0x18, 0x1A, 0x3A, 0x3C, 0x3E, 0x40):
                        p = bytearray(58); p[1] = v
                        f = frame(0x80, 0x09, p if padded else p[:4], length=L, pad=64 if padded else 0, prefix=prefix)
                        print(f'prefix={prefix!s:5} padded={padded!s:5} len=0x{L:02x}', await send(f, f'len {L} prefix {prefix} padded {padded}'))
        elif EXP == 'cmdscan':
            for cmd in range(0x00, 0x40):
                if cmd in UNSAFE: continue
                for n in (0, 2, 4):
                    print(f'cmd 0x{cmd:02x} payload {n}', await send(frame(0x80, cmd, bytes(n)), f'scan 0x{cmd:02x}/{n}', wait=0.25))
        elif EXP == 'script':
            import os, subprocess
            node = os.environ['NODE']; pid = os.environ.get('USB_PID', 'b301')
            def usb(*a):
                r = subprocess.run([node, 'usb_tool.mjs', pid, LOG.replace('.jsonl', '-usb.jsonl'), *a], capture_output=True, text=True,
                                   env={**os.environ, 'BANDS': os.environ.get('BANDS', '8')})
                log('note', '', b'', f'usb {" ".join(a)}: {r.stdout.strip()[:300]}')
                return r.stdout.strip()
            t0 = time.time()
            for step in ARGS:
                ts = f'{time.time() - t0:6.2f}s'
                if step == 'band':
                    print(ts, 'BLE band read      ', await send(frame(0x80, 0x09, bytes(58)), 'band read'))
                elif step == 'gain':
                    print(ts, 'BLE gain read      ', await send(frame(0x80, 0x03, bytes(2)), 'gain read'))
                elif step.startswith('idx:'):
                    p = bytearray(58); p[1] = int(step[4:])
                    print(ts, f'BLE band read idx {step[4:]}', await send(frame(0x80, 0x09, p), step))
                elif step.startswith('wait:'):
                    await asyncio.sleep(int(step[5:]) / 1000); print(ts, step)
                elif step.startswith('usb:'):
                    print(ts, 'USB push', step[4:], '->', usb('write', step[4:]).splitlines()[-1])
                elif step.startswith('usbrestore:'):
                    print(ts, 'USB restore', step[11:], '->', usb('restore', step[11:]).splitlines()[-1])
                elif step == 'usbcommit':
                    print(ts, 'USB commit only   ', usb('commit').splitlines()[-1])
                elif step == 'bapply':
                    print(ts, 'BLE apply (0x0A)  ', await send(frame(0x01, 0x0A, [0]), 'apply'))
                elif step == 'bsave':
                    print(ts, 'BLE save (0x04)   ', await send(frame(0x01, 0x04, [0]), 'save', wait=0.8))
                elif step == 'usbread':
                    print(ts, 'USB read:', ' / '.join(l.split(': ', 1)[1] for l in usb('read').splitlines()[:2]))
                elif step.startswith('bwrite:'):
                    _, n, h = step.split(':'); p = bytearray(bytes.fromhex(h)); p[1] = int(n)
                    print(ts, f'BLE write band {n}  ', await send(frame(0x01, 0x09, p), step))
        elif EXP == 'dirsweep':
            # ARGS: N HEX — band N's exact current payload (from USB), so a frame taken as a write changes nothing.
            n, h = int(ARGS[0]), ARGS[1]
            p = bytearray(bytes.fromhex(h)); p[1] = n
            for d in (0x80, 0x01, 0x00, 0x02, 0x03, 0x40, 0x41, 0x81, 0x82, 0x88, 0x90, 0xC0, 0xC1, 0xFE, 0xFF):
                print(f'dir 0x{d:02x} full band {n}', await send(frame(d, 0x09, p), f'dir {d:02x} band {n} full payload'))
                for k in range(2):
                    print(f'     plain read {k}     ', await send(frame(0x80, 0x09, bytes(58)), f'plain read after dir {d:02x}'))
        elif EXP == 'raw':
            for h in ARGS:
                print(h[:24], '->', await send(bytes.fromhex(h), 'raw'))

asyncio.run(main())
