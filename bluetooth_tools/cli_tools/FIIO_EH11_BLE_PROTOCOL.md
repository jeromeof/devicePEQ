# FiiO EH11 ANC - BLE Protocol Documentation

## BLE Connection Info
- Device MAC: `40:ED:98:1E:E8:A5`
- App: `com.fiio.control` (Flutter)
- Write Characteristic UUID: `00001101-04a5-1000-1000-40ed981a04a5`
- Notify Characteristic UUID: `00001102-04a5-1000-1000-40ed981a04a5`

## Packet Structure

```
F1 10  00 LL  CC CC  [payload]  FF
^^^^^  ^^^^^  ^^^^^  ^^^^^^^^^  ^^
magic  length  cmd   data       end marker

- F1 10 = header magic bytes
- LL = total packet length (all bytes including header and FF)
- CC CC = 2-byte command
- payload = command-specific data
- FF = end marker (length byte is authoritative, FF can appear in data)
```

**Direction flag** in payload:
- `01` = query/write (host → device)
- `01` in response = ACK or data follows

---

## Handshake Sequence (on BLE connect)

| Step | TX | RX | Description |
|------|----|----|-------------|
| 1 | `F1 10 00 08 00 02 01 FF` | `F1 10 00 0A 00 02 01 01 00 FF` | Protocol version |
| 2 | `F1 10 00 08 08 02 01 FF` | `F1 10 00 09 08 02 01 01 FF` | Firmware version |
| 3 | `F1 10 00 08 08 01 01 FF` | `F1 10 00 14 08 01 01 FF 09 46 49 49 4F 20 45 48 31 31 FF FF` | Device name ("FIIO EH11") |
| 4 | `F1 10 00 08 00 03 01 FF` | `F1 10 00 09 00 03 01 44 FF` | Battery (0x44=68%) |
| 5 | `F1 10 00 08 03 01 01 FF` | `F1 10 00 09 03 01 01 01 FF` | EQ status (01=enabled) |
| 6 | `F1 10 00 08 03 04 01 FF` | `F1 10 00 09 03 04 01 A0 FF` | Unknown (0xA0=160) |
| 7 | `F1 10 00 0A 03 0C 01 A0 A2 FF` | (preset names - see below) | User preset names |
| 8 | `F1 10 00 08 03 0E 01 FF` | `F1 10 00 0A 03 0E 01 FF 88 FF` | Unknown |
| 9 | `F1 10 00 0A 03 0D 01 00 09 FF` | (full EQ data - see below) | Read all EQ bands |

---

## Commands Reference

### `00 02` - Protocol Version
- TX: `F1 10 00 08 00 02 01 FF`
- RX: `F1 10 00 0A 00 02 01 01 00 FF` → version `01 00`

### `08 02` - Firmware Version
- TX: `F1 10 00 08 08 02 01 FF`
- RX: `F1 10 00 09 08 02 01 01 FF` → version `01`

### `08 01` - Device Name
- TX: `F1 10 00 08 08 01 01 FF`
- RX: `F1 10 00 14 08 01 01 FF 09 46 49 49 4F 20 45 48 31 31 FF FF`
  - Byte[8]: name length (0x09 = 9 chars)
  - Bytes[9..]: ASCII name "FIIO EH11" (46 49 49 4F 20 45 48 31 31)

### `00 03` - Battery Level
- TX: `F1 10 00 08 00 03 01 FF`
- RX: `F1 10 00 09 00 03 01 XX FF` where XX = battery % (0x44 = 68%)

### `03 01` - EQ Enable Status
- TX: `F1 10 00 08 03 01 01 FF`
- RX: `F1 10 00 09 03 01 01 XX FF` where XX = 01 (enabled) or 00 (disabled)

### `03 0C` - User Preset Names
- TX: `F1 10 00 0A 03 0C 01 A0 A2 FF`
- RX: 3 preset names, each 8 bytes (null-padded ASCII)
  ```
  F1 10 00 22 03 0C 01 A0 A2
    55 53 45 52 31 00 00 00   ← "USER1"
    55 53 45 52 32 00 00 00   ← "USER2"
    55 53 45 52 33 00 00 00   ← "USER3"
  FF
  ```

### `03 0D` - Read Full EQ State ⭐
- TX: `F1 10 00 0A 03 0D 01 00 09 FF`
- RX: **80-byte response** containing all 10 EQ bands
  ```
  F1 10 00 50  03 0D  01 00 09  [70 bytes = 10 bands × 7 bytes]  FF
  ```
  **Per-band format (7 bytes):**
  ```
  [gain_hi gain_lo]  [freq_hi freq_lo]  [Q_hi Q_lo]  [type]
  ```
  - `gain` = signed int16 big-endian, ÷10 = dB (e.g. 0x0040=+6.4dB, 0xFFB7=-7.3dB)
  - `freq` = uint16 big-endian = Hz (e.g. 0x0019=25Hz, 0x00C8=200Hz)
  - `Q` = uint16 big-endian, ÷10 = Q factor (e.g. 0x0032=5.0, 0x0050=8.0)
  - `type` = filter type (0x00 = peaking/bell, others TBD)

  **Example response (decoded):**
  | Band | Gain | Freq | Q |
  |------|------|------|---|
  | 1 | +6.4 dB | 25 Hz | 5.0 |
  | 2 | -7.3 dB | 200 Hz | 8.0 |
  | 3 | +1.5 dB | 600 Hz | 8.0 |
  | 4 | -5.5 dB | 1800 Hz | 20.0 |
  | 5 | -8.0 dB | 3500 Hz | 20.0 |
  | 6 | +10.7 dB | 5000 Hz | 10.0 |
  | 7 | +1.0 dB | 5000 Hz | 40.0 |
  | 8 | -4.6 dB | 8000 Hz | 40.0 |
  | 9 | +1.5 dB | 8000 Hz | 7.2 |
  | 10 | 0.0 dB | 16000 Hz | 7.2 |

### `13 0D` - Write EQ Gain (group) ⭐
Sends gains for 3 bands at a time. App sends all active groups when any band changes.

**TX format (17 bytes):**
```
F1 10 00 11  13 0D  01  [GRP] [GRP]  [g1_hi g1_lo]  [g2_hi g2_lo]  [g3_hi g3_lo]  00  FF
```
- `GRP` = group index (0x00 = group 0, 0x01 = group 1), appears twice
- Each gain: signed int16 big-endian, ÷10 = dB

**ACK (RX):**
```
F1 10 00 08 13 0D 01 FF
```

**Example - writing group 1 with 200Hz band changed to +8.5dB:**
```
F1 10 00 11 13 0D 01 01 01 00 55 00 C8 00 50 00 FF
                              ^^^^^
                              0x0055 = 85 = +8.5dB
```

**Known groups:**
- Group 0 (GRP=00): 3 bands
- Group 1 (GRP=01): 3 bands (first band = 200Hz)
- Groups 2-3: likely exist for remaining bands (TBD)

**Band-to-group mapping:** TBD - needs more captures. Known:
- 25Hz band → group 0, position 0
- 200Hz band → group 1, position 0

---

## Gain Encoding

```python
def gain_to_bytes(db_value):
    """Encode dB gain as signed int16 big-endian (×10)"""
    raw = round(db_value * 10)
    if raw < 0:
        raw += 0x10000  # two's complement
    return bytes([(raw >> 8) & 0xFF, raw & 0xFF])

def bytes_to_gain(hi, lo):
    """Decode signed int16 big-endian to dB"""
    raw = (hi << 8) | lo
    if raw > 0x7FFF:
        raw -= 0x10000
    return raw / 10.0
```

Examples:
- +6.4 dB → `00 40` (64)
- +8.5 dB → `00 55` (85)
- -7.3 dB → `FF B7` (-73)
- 0.0 dB  → `00 00` (0)

---

## Capture Method

```bash
# 1. Get FiiO app PID
adb -s 901f9069 shell pidof com.fiio.control

# 2. Forward frida port
adb -s 901f9069 forward tcp:27042 tcp:27042

# 3. Run capture (replace PID)
frida -U -p <PID> -l frida_fiio_bt.js 2>&1 | tee fiio_capture.txt
```

---

## Notes
- App: Flutter-based (Flutter MethodChannel hooks fail — expected)
- SPP is NOT used; all communication is BLE GATT only
- EH11 BLE connection stability issues: status=8 (GATT_CONN_TIMEOUT) intermittent disconnects
- `03 0C` auth bytes `A0 A2` appear fixed — likely a session token or fixed constant
- 10 bands total in `03 0D` read; first 6 appear user-adjustable (via `13 0D`)
