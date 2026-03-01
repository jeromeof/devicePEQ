# RoseLink Bluetooth Protocol Documentation

## Protocol Overview

The RoseLink device uses a simple binary protocol.

### Transport Layer

**⚠️ IMPORTANT: Hybrid Bluetooth Implementation**

The ROSE CAMBRIAN device supports both BLE and Classic Bluetooth SPP, but uses them differently:

- **Classic Bluetooth SPP (Recommended)**: Full bidirectional communication
  - Android app uses SPP exclusively for TX and RX
  - Responses are reliably received
  - Port: `/dev/tty.ROSECAMBRIAN` (macOS) or similar

- **Bluetooth LE**: Limited support
  - Commands can be sent (TX works)
  - Responses may NOT be received over BLE notify characteristic
  - Useful for one-way commands only

**Recommendation**: Use Classic Bluetooth SPP for full protocol support.

### Bluetooth LE Service/Characteristics

**⚠️ CORRECT Service (Use This):**

**Service UUID:** `000000fe-0000-1000-8000-00805f9b34fb`
- **Write Characteristic:** `000000f1-0000-1000-8000-00805f9b34fb` (write-without-response, write, read)
- **Notify Characteristic:** `000000f2-0000-1000-8000-00805f9b34fb` (notify, read)

Send commands to `f1`, receive responses via `f2` notifications. Full bidirectional BLE communication confirmed working.

**Also present but DO NOT USE for control:**

**Service UUID:** `0000ff12-0000-1000-8000-00805f9b34fb`
- **Write:** `0000ff15-0000-1000-8000-00805f9b34fb` (write-without-response, read)
- **Notify:** `0000ff14-0000-1000-8000-00805f9b34fb` (notify)

Writing to `ff15` does not produce responses on `ff14`. The `000000fe` / `f1` / `f2` service is the correct control channel.

### macOS SPP Port

Use `/dev/cu.ROSECAMBRIAN` (NOT `/dev/tty.ROSECAMBRIAN`).

On macOS, `/dev/tty.*` is held by the OS (causes `[Errno 16] Resource busy`). The `/dev/cu.*` port is for outgoing connections and opens successfully. However BLE via `f1`/`f2` is the recommended approach as SPP may not always forward data reliably on macOS.

### Frame Format

**TX (App → Device):**
```
[0xFF] [0x00] [Length] [Data...] [0xAA]
```

**RX (Device → App):**
```
[0xDD] [0x00] [Length] [Data...] [0xAA]
```

- Start markers: `0xFF` (TX), `0xDD` (RX)
- Byte 1: Always `0x00`
- Byte 2: Payload length (number of data bytes)
- End marker: `0xAA` (both directions)

---

## Commands

### Query Multiple Parameters (0xFA)

**Command:**
```
FF 00 0F FA 01 07 08 09 0C 0D 0E 12 2A 2B 2C 2D 2E 33 AA
```

Queries multiple device parameters. The device responds with individual parameter values.

**Response Format:**
```
DD 00 02 [Parameter ID] [Value] AA          (single byte value)
DD 00 04 [Parameter ID] [Value1] [Value2] [Value3] AA  (multi-byte value)
```

---

## Known Parameters

| Parameter ID | Type | Description | Example Values |
|--------------|------|-------------|----------------|
| 0x01 | Multi (20 bytes) | Packed sub-params (see below) | 10 × (id,value) pairs |
| 0x07 | Single | Unknown setting | 0x00 |
| 0x08 | Single | Unknown setting | 0x00 |
| 0x09 | Single | Connection/playback state | 0x01 (connected?) |
| 0x0C | Multi (3 bytes) | **Battery Level** | 0x00 0x00 0x5B = 91% |
| 0x0D | Multi (3 bytes) | **Firmware Version** | 0x30 0x37 0x32 = "072" |
| 0x0E | Single | Unknown | 0x00 |
| 0x12 | Single | Unknown | 0x01 |
| **0x2A** | **Single** | **EQ Preset** | See EQ table below |
| 0x2B | Single | Unknown setting (not confirmed as EQ) | 0x00-0x04 |
| 0x2C | Single | Unknown setting (not confirmed as EQ) | 0x00-0x04 |
| 0x2D | Single | Unknown setting (not confirmed as EQ) | 0x00-0x04 |
| 0x2E | Single | Unknown setting (not confirmed as EQ) | 0x00-0x04 |
| 0x33 | Unknown | TBD | - |
| 0xFE | None | ACK/Ready signal | `DD 00 01 FE AA` |

### Parameter 0x01 — Packed Sub-Parameters

Param 0x01 response contains 10 packed (param_id, value) pairs (20 bytes total):

| Sub-Param | Observed Value | Notes |
|-----------|----------------|-------|
| 0x01 | 5 | Unknown |
| 0x02 | 0 | Unknown |
| 0x03 | 0 | Unknown |
| 0x04 | 3 | Unknown (ANC level?) |
| 0x05 | 0 | Unknown |
| 0x11 | 4 | Unknown |
| 0x12 | 0 | Unknown |
| 0x13 | 0 | Unknown |
| 0x14 | 2 | Unknown |
| 0x15 | 1 | Unknown |

---

## EQ Preset Control (Parameter 0x2A)

### Set EQ Preset

| Preset | Value | Command |
|--------|-------|---------|
| **HiFi** | 0x00 | `FF 00 02 2A 00 AA` |
| **Pop** | 0x01 | `FF 00 02 2A 01 AA` |
| **Rock** | 0x02 | `FF 00 02 2A 02 AA` |

**Device Response:**
```
DD 00 01 FE AA
```
(Acknowledgment)

### EQ Band Parameters

Parameters 0x2B-0x2E appear to reflect the frequency band adjustments applied by each preset:
- Values range from 0x00 to 0x04
- These are likely read-only and change automatically when preset is switched

---

## Capture Examples

### Initial Device Query
```
TX: FF 00 0F FA 01 07 08 09 0C 0D 0E 12 2A 2B 2C 2D 2E 33 AA

RX: DD 00 02 07 00 AA          (Param 0x07 = 0)
RX: DD 00 02 08 00 AA          (Param 0x08 = 0)
RX: DD 00 02 09 01 AA          (Param 0x09 = 1)
RX: DD 00 01 FE AA             (ACK)
RX: DD 00 04 0C 00 00 5E AA    (Battery = 94%)
RX: DD 00 04 0D 30 37 32 AA    (Firmware = "072")
RX: DD 00 02 0E 00 AA          (Param 0x0E = 0)
RX: DD 00 02 12 01 AA          (Param 0x12 = 1)
RX: DD 00 02 2A 00 AA          (EQ Preset = HiFi)
RX: DD 00 02 2B 04 AA          (EQ Band)
RX: DD 00 02 2C 02 AA          (EQ Band)
RX: DD 00 02 2D 02 AA          (EQ Band)
RX: DD 00 02 2E 02 AA          (EQ Band)
```

### Changing EQ from HiFi to Pop
```
TX: FF 00 02 2A 01 AA
RX: DD 00 01 FE AA
```

### Changing EQ from Pop to Rock
```
TX: FF 00 02 2A 02 AA
RX: DD 00 01 FE AA
```

---

## Notes

- All commands are acknowledged with `DD 00 01 FE AA`
- Battery level appears to be reported as a 16-bit value (0x0000 to 0x0064 for 0-100%?)
- Firmware version is reported as ASCII digits
- The device responds to queries with multiple individual parameter responses
- Query command 0xFA can request multiple parameters in a single command

---

## TODO / Unknown

- [ ] Map remaining parameter IDs (0x01, 0x33, etc.)
- [ ] Determine full range of battery values
- [ ] Identify what parameters 0x07, 0x08, 0x0E, 0x12 control
- [ ] Test if EQ band parameters (0x2B-0x2E) can be set individually for custom EQ
- [ ] Identify other device features (volume, power, pairing, etc.)

---

**Last Updated:** 2026-01-27
**Capture Method:** Frida + Android app instrumentation
