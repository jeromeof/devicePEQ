# WalkPlay USB HID Handler

`devicePEQ/walkplayHidHandler.js` — exported as `walkplayUsbHID`

Protocol reverse-engineered from hardware captures and the WalkPlay website source
(`walkplayPreprocessor/walkplay.js`). All communication uses **reportId `0x4B` (75)**.

---

## Transport constants

| Constant       | Value  | Meaning                        |
|----------------|--------|--------------------------------|
| `REPORT_ID`    | `0x4B` | Primary HID report ID (75)     |
| `ALT_REPORT_ID`| `0x3C` | Alternate report ID (reserved) |
| `READ`         | `0x80` | Direction byte — read request  |
| `WRITE`        | `0x01` | Direction byte — write request |
| `END`          | `0x00` | Packet terminator              |

---

## Command bytes

| Name          | Hex    | Dec | Direction     | Description                                      |
|---------------|--------|-----|---------------|--------------------------------------------------|
| `FLASH_EQ`    | `0x01` | 1   | Write         | Persist current registers to flash               |
| `MIC_GAIN`    | `0x02` | 2   | Read / Write  | ADC microphone input gain, 16-bit signed ±15 dB  |
| `GLOBAL_GAIN` | `0x03` | 3   | Read / Write  | DAC output gain / global EQ offset, 1 byte       |
| `PEQ_VALUES`  | `0x09` | 9   | Read / Write  | Per-band EQ filter coefficients                  |
| `TEMP_WRITE`  | `0x0A` | 10  | Write         | Copy registers to temporary flash area           |
| `VERSION`     | `0x0C` | 12  | Read          | Firmware version string                          |
| `GET_SLOT`    | `0x0F` | 15  | Read          | Current EQ slot index (embedded in PEQ response) |
| `DAC_FILTER`  | `0x11` | 17  | Write         | DSP filter algorithm selection                   |
| `DAC_BALANCE` | `0x16` | 22  | Write         | Left / right channel trim                        |
| `DENOISE`     | `0x1B` | 27  | Write         | ENC / noise-cancellation on/off                  |
| `DAC_WORK_MODE` | `0x1D` | 29 | Read / Write  | DAC operational mode (0 = normal, 1 = alternate) |

Undocumented write-only helpers used internally during `pushToDevice`:

| Value  | Purpose                               |
|--------|---------------------------------------|
| `0x05` | Memory refresh (sent before commit)   |
| `0x17` | ENC refresh (sent before commit)      |

---

## SchemeNo — EQ band counts

The number of EQ bands varies by hardware scheme. Set `maxFilters` in the device config accordingly.

| SchemeNo | Bands | Notes                                     |
|----------|-------|-------------------------------------------|
| 10       | 8     | PK only (no LS/HS)                        |
| 11       | 8     | LS + LP/HP; **HS disabled**               |
| 13       | 8     | **HS disabled**                           |
| 15       | 8     | Full filter set; `autoGlobalGain: true`   |
| 16       | 10    | Full filter set                           |
| 17       | 5     | **HS disabled**                           |
| 18       | 10    | Full filter set                           |
| 19       | 6     |                                           |
| 20       | 10    | **HS disabled**                           |
| 21       | 8     | **HS disabled**                           |
| 23       | 15    | Full filter set                           |
| default  | 8     | All other scheme numbers                  |

Filter type byte mapping: `LS=1  PK=2  HS=3  LP=4  HP=5`

---

## Exported API

### `getCurrentSlot(deviceDetails) → Promise<number>`

Reads the firmware version and current EQ slot index from the device.
Must be called before `pullFromDevice` / `pushToDevice`.

**HID packets sent:**

```
→ [0x80, 0x0C, 0x00]           READ VERSION
← [0x80, 0x0C, 0x00, v0,v1,v2,…]  version ASCII at bytes [3..5]

→ [0x80, 0x09, 0x00]           READ PEQ_VALUES (slot query)
← [0x80, 0x09, …, slot]        current slot index at byte [35]
```

**Side effects:** writes `deviceDetails.version` (parsed float, e.g. `0.1`).

---

### `pullFromDevice(deviceDetails, slot) → Promise<{ filters, globalGain, currentSlot }>`

Reads all EQ filter bands from the device and the global gain.

**HID packets sent (per band `i = 0 … maxFilters-1`):**

```
→ [0x80, 0x09, 0x00, 0x00, i, 0x00]   READ PEQ_VALUES for band i
← [0x80, 0x09, …]  filter packet (see filter packet layout below)
```

After all bands arrive:

```
→ [0x80, 0x03, 0x00]           READ GLOBAL_GAIN
← [0x80, 0x03, 0x02, 0x00, gain, …]  gain as signed int8 at byte [4]
```

**Returns:**
```js
{
  filters:     Array<{ filterIndex, freq, gain, q, type, disabled }>,
  globalGain:  number,   // dB, signed int8
  currentSlot: number,
  complete:    boolean,  // false if timed out with partial data
}
```

**Filter packet layout** (response bytes, report ID stripped by Web HID):

| Offset | Field       | Encoding                        |
|--------|-------------|---------------------------------|
| [1]    | CMD         | `0x09`                          |
| [4]    | filterIndex | 0-based band number             |
| [7..26]| IIR coeffs  | 5 × int32 LE (biquad)           |
| [27..28]| freq       | uint16 LE, Hz                   |
| [29..30]| Q          | uint16 LE, 8.8 fixed-point      |
| [31..32]| gain       | int16 LE, 8.8 fixed-point, dB   |
| [33]   | type        | `1=LS 2=PK 3=HS 4=LP 5=HP`     |
| [35]   | slot        | current slot (bulk read only)   |

---

### `pushToDevice(deviceDetails, phoneObj, slot, globalGain, filtersToWrite) → Promise<void>`

Writes all EQ bands to the device and commits to flash.

**HID packets sent (per band `i`):**

```
→ [0x01, 0x09, 0x18, 0x00, i, 0x00, 0x00,
   <20 bytes IIR biquad coefficients>,
   freqLo, freqHi,
   qLo, qHi,
   gainLo, gainHi,
   typeByte,
   0x00,
   slot,
   0x00]
```

Then (if `modelConfig.deviceHandlesPregain === false`):

```
→ [0x01, 0x03, 0x02, 0x00, gain]    WRITE GLOBAL_GAIN
```

Commit sequence (always):

```
→ [0x01, 0x05, 0x00]                memory refresh
→ [0x01, 0x17, 0x00]                ENC refresh
→ [0x01, 0x0A, 0x04, 0x00, 0x00, 0xFF, 0xFF]  TEMP_WRITE
→ [0x01, 0x01, 0x00]                FLASH_EQ
```

**IIR biquad computation** (sample rate 96 kHz, `Q²` normalised):

```
A  = sqrt(10^(gain/20))
w0 = 2π·freq / 96000
α  = sin(w0) / (2·Q)
coefficients = quantizer([1, -2cos(w0)/(α/A+1), (1-α/A)/(α/A+1)],
                         [(α·A+1)/(α/A+1), -2cos(w0)/(α/A+1), (1-α·A)/(α/A+1)])
quantizer: values × 1073741824 (2³⁰), packed as int32 LE
```

---

### `enablePEQ(deviceDetails, enable, slotId) → Promise<void>`

Enables or disables the PEQ on the device.

```
→ [0x01, 0x01, enable?1:0, slotId, 0x00]   FLASH_EQ
```

When `enable` is `false`, `slotId` is forced to `0x00`.

---

### `setMicGain(deviceDetails, value) → Promise<void>`

Sets the ADC (microphone input) gain. Range: **-15 dB to +15 dB**.

Encoding: 16-bit signed integer scaled by `32767 / 15` per dB,
transmitted little-endian in bytes [3] and [4].
Special cases from vendor source: `+15 → 32767`, `-15 → 32769`.

```
→ [0x01, 0x02, 0x02, LSB, MSB]    WRITE MIC_GAIN  (5 bytes, no END)
```

Examples:

| dB    | Encoded | LSB  | MSB  |
|-------|---------|------|------|
| +15   | 32767   | 0xFF | 0x7F |
| +5    | 10922   | 0xAA | 0x2A |
| 0     | 0       | 0x00 | 0x00 |
| -10   | 43691   | 0xEB | 0xAA |
| -15   | 32769   | 0x01 | 0x80 |

---

### `readMicGain(deviceDetails) → Promise<number>`

Reads the current ADC microphone input gain. Returns dB (float, rounded to 2 dp).

```
→ [0x80, 0x02, 0x00]              READ MIC_GAIN  (3 bytes)
← [0x80, 0x02, LSB, MSB, …]      gain at bytes [2..3], 16-bit LE unsigned
```

Decode: `raw = data[2] | (data[3] << 8)`, then
`signed = raw > 32767 ? raw - 65536 : raw`, then
`dB = signed × 15 / 32767`.

---

### `setDacFilter(deviceDetails, filterType) → Promise<void>`

Selects the DAC's digital filter algorithm. Applies to schemes that expose this setting
(CB-class devices; not all SchemeNo variants support it).

```
→ [0x01, 0x11, 0x01, filterByte]  WRITE DAC_FILTER  (4 bytes)
```

| `filterType` | `filterByte` | Character          |
|--------------|--------------|--------------------|
| `'FAST-LL'`  | 1            | Minimum phase, linear |
| `'FAST-PC'`  | 2            | Minimum phase, corrected |
| `'SLOW-LL'`  | 3            | Linear phase, slow |
| `'SLOW-PC'`  | 4            | Linear phase, corrected |
| `'NON-OS'`   | 5            | Non-oversampling   |

---

### `setDacBalance(deviceDetails, leftDelta, rightDelta) → Promise<void>`

Adjusts left/right channel trim. Values are device units (0–127).
Pass `leftDelta > 0` to attenuate the right channel relative to left, and vice versa.
Pass both as `0` to reset to centre.

Sends two packets per call (set active channel, then zero the other):

```
# Left boost
→ [0x01, 0x16, 0x04, 0x01, 0x00, leftDelta, 0x00]
→ [0x01, 0x16, 0x04, 0x00, 0x00, 0x00,      0x00]

# Right boost
→ [0x01, 0x16, 0x04, 0x01, 0x00, 0x00,       0x00]
→ [0x01, 0x16, 0x04, 0x00, 0x00, rightDelta, 0x00]

# Centre
→ [0x01, 0x16, 0x04, 0x00, 0x01, 0x00, 0x00]
→ [0x01, 0x16, 0x04, 0x00, 0x00, 0x00, 0x00]
```

---

### `setDenoiseEnabled(deviceDetails, enabled) → Promise<void>`

Enables or disables the ENC (Environmental Noise Cancellation) circuit.
Only applicable to devices with a microphone (e.g. EPZ TP13, Tanchjim BUNNY DSP).

```
→ [0x01, 0x1B, 0x01, 0x01]   WRITE DENOISE — enable
→ [0x01, 0x1B, 0x01, 0x00]   WRITE DENOISE — disable
```

---

### `readDenoiseEnabled(deviceDetails) → Promise<boolean>`

Reads the current ENC state. Returns `true` if enabled, `false` if disabled.

```
→ [0x80, 0x1B, 0x00]              READ DENOISE
← [0x80, 0x1B, …, state, …]      state byte at [3]: 0x01 = on, 0x00 = off
```

---

### `readDacFilter(deviceDetails) → Promise<string|null>`

Reads the current DAC filter algorithm. Returns one of `'FAST-LL'`, `'FAST-PC'`,
`'SLOW-LL'`, `'SLOW-PC'`, `'NON-OS'`, or `null` if unrecognised.

```
→ [0x80, 0x11]                    READ DAC_FILTER
← [0x80, 0x11, filterByte, …]    filter byte at [2]
```

---

### `setDacWorkMode(deviceDetails, mode) → Promise<void>`

Sets the DAC operational mode. `mode`: `0` = normal, `1` = alternate.

```
→ [0x01, 0x1D, 0x01, mode]        WRITE DAC_WORK_MODE
```

---

### `readDacWorkMode(deviceDetails) → Promise<number>`

Reads the current DAC work mode. Returns `0` or `1`.

```
→ [0x80, 0x1D]                    READ DAC_WORK_MODE
← [0x80, 0x1D, mode, …]          mode byte at [2]
```

---

### `setOutputGain(deviceDetails, gainDb) → Promise<void>`

Public alias for the internal `writeGlobalGain`. Sets the DAC output / EQ offset gain in dB.
Equivalent to the `GLOBAL_GAIN` write used inside `pushToDevice`.

```
→ [0x01, 0x03, 0x02, 0x00, gain]  WRITE GLOBAL_GAIN
```

---

## Internal-only functions

These are not exported and are called only from within the handler.

| Function           | Purpose                                                       |
|--------------------|---------------------------------------------------------------|
| `sendReport`       | Wraps `device.sendReport(REPORT_ID, Uint8Array)` with logging |
| `waitForResponse`  | Returns a Promise that resolves on the next matching inputreport |
| `readGlobalGain`   | Sends `[0x80, 0x03, 0x00]`, reads signed int8 at byte [4]    |
| `writeGlobalGain`  | Sends `[0x01, 0x03, 0x02, 0x00, gain]`, fire-and-forget      |
| `parseFilterPacket`| Decodes a raw filter response packet into `{ freq, gain, q, type }` |
| `computeIIRFilter` | Converts freq/gain/Q → 5 × int32 biquad coefficients (96 kHz SR) |
| `quantizer`        | Scales float coefficients to int32 (× 2³⁰), returns 5-element array |
| `convertToByteArray` | Little-endian int → byte array of given length              |
| `convertFromFilterType` | Maps `'PK'/'LSQ'/'HSQ'/'LP'/'HP'` → byte `2/1/3/4/5`  |
| `convertToFilterType`   | Maps byte `1/2/3/4/5` → `'LSQ'/'PK'/'HSQ'/'LP'/'HP'`  |
| `waitForFilters`   | Polls until all `maxFilters` bands received (or 10 s timeout) |
| `delay`            | `setTimeout` promise helper                                   |

---

## Known commands found in vendor source but not yet implemented

These were found in `walkplayPreprocessor/walkplay.js` and may be useful for future features.

| Cmd    | Name                | Packet                                    | Notes                              |
|--------|---------------------|-------------------------------------------|------------------------------------|
| `0x19` | FILTER_OUTPUT_GAIN  | `[1, 25, 1, mode-1]`                      | Output gain mode 1–3               |
| `0x1D` | DAC_WORK_MODE       | `[1, 29, 1, 0\|1]`                        | DAC operational mode               |
| `0x25` | SOUND_SOURCE_ANGLE  | `[1, 37, 3, e, LSB, MSB]`                 | 3D / reverb parameter              |
| `0x60` | ENABLE_DISABLE      | `[1, 96, 1, 0\|1]`                        | Generic feature toggle             |
| `0xD3` | MODE_VALUE          | `[1, 211, 1, 0..2]`                       | Mode selection                     |
| `0x0D` | EXTENDED_EQ         | `[1, 13, 8, …8 bytes]`                    | Extended EQ write path             |
| `0x0E` | READ_VERSION_ALT    | `[128, 14, 0]`                            | Alternative firmware version query |

Read queries not yet used:

| Cmd    | Query packet          | Returns                    |
|--------|-----------------------|----------------------------|
| `0x11` | `[128, 17]`           | Current filter index       |
| `0x19` | `[128, 25]`           | Filter output mode         |
| `0x16` | `[128, 22, 2, ch, 0]` | DAC balance for channel    |
| `0x25` | `[128, 37, 1, idx]`   | 3D/reverb parameter        |

Implemented read queries (see exported API above):

| Cmd    | Handler              | Notes                       |
|--------|----------------------|-----------------------------|
| `0x1B` | `readDenoiseEnabled` | ENC switch state            |
| `0x1D` | `readDacWorkMode`    | DAC work mode               |
| `0x11` | `readDacFilter`      | Current DAC filter setting  |

---

## Capture & test files

| File | Purpose |
|------|---------|
| `tests/captures/walkplay_schemeNo10_jm98max.json` | SchemeNo10 pull+push capture |
| `tests/captures/walkplay_schemeno11_epz_tp13.json` | SchemeNo11 pull+push capture |
| `tests/captures/walkplay_schemeno11_micgain.json` | Mic gain read/write capture |
| `tests/captures/walkplay_schemeno15_*.json` | SchemeNo15 captures |
| `tests/captures/walkplay_schemeno16_*.json` | SchemeNo16 captures |
| `tests/captures/walkplay_schemeno18_*.json` | SchemeNo18 capture |
| `tests/captures/external/walkplay_szwalkplay.json` | Raw capture from peq.szwalkplay.com |
| `tests/handlers/walkplayHidHandler.test.js` | Core handler tests (SchemeNo10) |
| `tests/handlers/walkplay_micgain.test.js` | `setMicGain` / `readMicGain` tests |
| `tests/handlers/walkplay_schemeno11_*.test.js` | Per-device SchemeNo11 tests |
| `tests/handlers/walkplay_schemeno15_*.test.js` | Per-device SchemeNo15 tests |
| `tests/handlers/walkplay_schemeno16_*.test.js` | Per-device SchemeNo16 tests |
