# Qudelix 5K PEQ Protocol Reference

Reverse-engineered from `q5K-chrome-plugin.js` (webpack bundle, ~497 modules).

---

## 1. USB HID Connection

**WebHID filters:**

| Chip  | Vendor ID (decimal) | Vendor ID (hex) |
|-------|---------------------|-----------------|
| QCC   | 2578                | 0x0A12          |
| NXP   | 8137                | 0x1FC9          |

```js
navigator.hid.requestDevice({ filters: [{ vendorId: 2578 }, { vendorId: 8137 }] })
```

**HID Report IDs** (QCC/legacy device):

| ID | Direction    | Name               |
|----|-------------|---------------------|
| 8  | Host→Device  | `qx_hostToDevice`  |
| 7  | Host→Device  | `qx_out` (fallback)|
| 9  | Device→Host  | `qx_deviceToHost`  |
| 1  | Response     | `response`         |

The plugin picks `qx_hostToDevice` (8) first; if size is 0 it falls back to `qx_out` (7).

**NXP device report IDs:**

| ID | Direction     | Name          |
|----|--------------|----------------|
| 2  | Host→Device   | `command_out` |
| 1  | Device→Host   | `command_in`  |

---

## 2. Packet Framing

### QCC / Legacy device TX (Host → Device)

```
Byte 0:   payload_length + 1       (uint8)
Byte 1:   0x80                     (fixed flag)
Byte 2+:  payload[0..N]
Padding:  zeros to fill report size
```

The `payload` is the command packet (see §3).

### QCC / Legacy device RX (Device → Host)

```
Byte 0:   payload_length            (uint8)
Byte 1:   cmd_high                  (uint8, MSB of command ID)
Byte 2:   cmd_low                   (uint8, LSB of command ID)
Byte 3+:  data[0..payload_length-1]
```

Received on report IDs `response` (1) or `qx_deviceToHost` (9).
Dispatched to `processing(cmdId, data)`.

### NXP device TX

```
Byte 0:   0x00
Byte 1-2: payload_length (big-endian uint16)
Byte 3+:  payload[0..N]
```

---

## 3. Command Packet Format

All commands share this layout (the `payload` built by `Db.send`):

```
Byte 0:  cmd >> 8   (MSB of 16-bit command ID)
Byte 1:  cmd & 0xFF (LSB of 16-bit command ID)
Byte 2+: data[]     (command-specific payload)
```

---

## 4. Command IDs (key EQ subset)

### Requests (Host → Device)

| Constant           | Value (dec) | Value (hex) | Notes                          |
|--------------------|-------------|-------------|--------------------------------|
| `ReqInitData`      | 256         | 0x0100      | Connect/init handshake         |
| `ReqDevStatus`     | 272         | 0x0110      |                                |
| `ReqDevConfig`     | 288         | 0x0120      |                                |
| `ReqEqPreset`      | 291         | 0x0123      | arg = bitmask of groups        |
| `ReqEqPresetName`  | 1803        | 0x070B      | arg = preset index             |
| `ReqEqData`        | 1872        | 0x0750      |                                |

### Responses (Device → Host)

| Constant           | Value (dec) | Value (hex) |
|--------------------|-------------|-------------|
| `RspInitData`      | 257         | 0x0101      |
| `RspDevConfig`     | 289         | 0x0121      |
| `RspEqPreset`      | 296         | 0x0128      |
| `RspEqPreset_L`    | 292         | 0x0124      |
| `RspEqPreset_H`    | 293         | 0x0125      |
| `RspEqPresetName`  | 1804        | 0x070C      |
| `RspEqData`        | 1873        | 0x0751      |
| `Notification`     | 65280       | 0xFF00      |
| `Disconnect`       | 263         | 0x0107      |

### EQ Set Commands (Host → Device)

| Constant           | Value (dec) | Value (hex) | Notes                         |
|--------------------|-------------|-------------|-------------------------------|
| `SetEqEnable`      | 1792        | 0x0700      |                               |
| `SetEqType`        | 1793        | 0x0701      | 0=GEQ, 1=PEQ                  |
| `SetEqHeadroom`    | 1794        | 0x0702      |                               |
| `SetEqPreGain`     | 1795        | 0x0703      |                               |
| `SetEqGain`        | 1796        | 0x0704      | per-band gain                 |
| `SetEqQ`           | 1797        | 0x0705      | per-band Q                    |
| `SetEqFilter`      | 1798        | 0x0706      | per-band filter type          |
| `SetEqFreq`        | 1799        | 0x0707      | per-band frequency            |
| `SaveEqPreset`     | 1800        | 0x0708      | arg = preset index            |
| `LoadEqPreset`     | 1801        | 0x0709      | arg = preset index            |
| `SetEqPresetName`  | 1802        | 0x070A      |                               |
| `SetEqXfeed`       | 1805        | 0x070D      | crossfeed                     |
| `SetEqMode`        | 1806        | 0x070E      |                               |
| `SetEqBandParam`   | 1807        | 0x070F      | set all params for one band   |
| `SetEqMute`        | 1808        | 0x0710      |                               |
| `SetEqInvert`      | 1809        | 0x0711      |                               |

---

## 5. EQ Groups

| ID | Name  | Notes                        |
|----|-------|------------------------------|
| 0  | `usr` | User (headphone) EQ          |
| 1  | `spk` | Speaker EQ                   |
| 2  | `b20` | 20-band EQ (5K Plus / V2)    |

Bands per group: `USR_EQ_BAND = 10`, `SPK_EQ_BAND = 10`, `B20_EQ_BAND = 20`.

---

## 6. Sending EQ Parameters

### Legacy protocol (`sendEqParam`) — 5-byte payload

Used for the original Qudelix 5K firmware.

```
sendEqParam(cmdId, channel, bandIndex, scaledValue)

Payload (5 bytes):
  [0]  eq.group          (0=usr, 1=spk)
  [1]  channel_mask      (1 << channel)
  [2]  band_index        (0-9)
  [3]  scaledValue >> 8  (high byte)
  [4]  scaledValue & 0xFF (low byte)
```

Example — set band 2, left channel (ch=0), gain = +3.0 dB:
```
scaledValue = round(3.0 * gainScale) = round(3.0 * 10) = 30
payload = [0x00, 0x01, 0x02, 0x00, 0x1E]
cmdId   = SetEqGain = 0x0704
full packet = [0x07, 0x04, 0x00, 0x01, 0x02, 0x00, 0x1E]
```

### V2 protocol (`v2_sendEqParam16`) — 3-byte payload

Used for 5K Plus / newer firmware (20-band `b20` group).

```
v2_sendEqParam16(cmdId, channel, bandIndex, scaledValue)

bandOffset = (channel == 1) ? bandIndex + 10 : bandIndex

Payload (3 bytes):
  [0]  bandOffset
  [1]  scaledValue >> 8
  [2]  scaledValue & 0xFF
```

### V2 filter type (`v2_sendEqParam8`) — 2-byte payload

```
Payload (2 bytes):
  [0]  bandOffset
  [1]  devFilterType (uint8)
```

### SetEqBandParam — set all params for one band in one packet

```
Legacy (10 bytes):
  [0]  eq.group
  [1]  channel_mask
  [2]  band_index
  [3]  filter_type (app enum, or converted)
  [4]  freq >> 8
  [5]  freq & 0xFF
  [6]  gain >> 8
  [7]  gain & 0xFF
  [8]  q >> 8
  [9]  q & 0xFF

V2 (8 bytes) — no group/channel prefix:
  [0]  band_index (with V2 offset)
  [1]  devFilterType
  [2]  freq >> 8
  [3]  freq & 0xFF
  [4]  gain >> 8
  [5]  gain & 0xFF
  [6]  q >> 8
  [7]  q & 0xFF
```

---

## 7. Value Scaling

| Parameter | Scale factor | Notes                                |
|-----------|--------------|--------------------------------------|
| Gain      | × 10         | ±12 dB range, 0.1 dB steps → int16  |
| Q         | × 1024       | e.g. Q=1.0 → 1024, Q=√2 ≈ 1448     |
| Freq      | × 1          | Hz as integer (no scaling)           |

Examples:
- Gain = +3.5 dB → `round(3.5 × 10)` = 35 (int16, big-endian)
- Q = 0.707 → `round(0.707 × 1024)` = 724 (int16, big-endian)
- Freq = 1000 Hz → `1000` = 0x03E8 (int16, big-endian)

---

## 8. Filter Types

### App-side enum (`_y`)

| Value | Name     |
|-------|----------|
| 0     | Bypass   |
| 1     | LPF      |
| 2     | HPF      |
| 3     | LS       |
| 4     | HS       |
| 5     | Peak     |

### Device-side enum (`Sb`) — used in V2 protocol

| Value | Name       | Maps from app enum |
|-------|------------|-------------------|
| 0     | `_Bypass`  | Bypass            |
| 7     | `_2ndLPF`  | LPF               |
| 8     | `_2ndHPF`  | HPF               |
| 13    | `_PEQ`     | Peak              |
| 10    | `_2ndLS`   | LS                |
| 11    | `_2ndHS`   | HS                |

Other device filter types (not directly exposed in app UI):
`_1stLS`(3), `_1stHS`(5), `_1stTilt`(6), `_2ndAPF`(9), `_2ndTilt`(12)

---

## 9. Initialization Sequence

```
ReqInitData           → RspInitData  (gets device ID, version)
ReqDevConfig (0x01)   → RspDevConfig
ReqDevConfig (0x12)   → RspDevConfig (sys2 | eq)
ReqDevStatus (conn)   → RspDevStatus
ReqEqPreset (0x03)    → RspEqPreset  (requests both usr+spk groups)
```

For V2 (b20): `ReqEqPreset(1 << 2)` instead of `ReqEqPreset(3)`.

---

## 10. Notification Sub-params (`Et` enum)

Received inside a `Notification` (0xFF00) response:

| Value | Name             |
|-------|------------------|
| 112   | `eqConfig`       |
| 113   | `eqGroupConfig`  |
| 128   | `eqPreset`       |
| 129   | `eqPresetIdx`    |
| 130   | `eqEnable`       |
| 131   | `eqHeadroom`     |
| 132   | `eqPreGain`      |
| 133   | `eqFilter`       |
| 134   | `eqFreq`         |
| 135   | `eqGain`         |
| 136   | `eqQ`            |
| 137   | `eqBandParam`    |
| 138   | `eqReceiverInfo` |
| 139   | `eqMute`         |
| 140   | `eqXfeed`        |
| 141   | `eqType`         |
| 142   | `eqInvert`       |

---

## 11. Minimal PEQ Write Example (Legacy 5K)

```js
// Connect via WebHID
const [device] = await navigator.hid.requestDevice({
  filters: [{ vendorId: 0x0A12 }, { vendorId: 0x1FC9 }]
});
await device.open();

function buildPacket(cmdId, data) {
  const payload = new Uint8Array(2 + data.length);
  payload[0] = cmdId >> 8;
  payload[1] = cmdId & 0xFF;
  payload.set(data, 2);
  return payload;
}

async function sendCmd(cmdId, data = new Uint8Array(0)) {
  const payload = buildPacket(cmdId, data);
  const report = new Uint8Array(64); // report size varies, check descriptor
  report[0] = payload.length + 1;
  report[1] = 0x80;
  report.set(payload, 2);
  await device.sendReport(8, report); // reportId=8 (qx_hostToDevice)
}

// Set band 0, ch=0 (left), freq=1000Hz
await sendCmd(0x0707, new Uint8Array([0x00, 0x01, 0x00, 0x03, 0xE8]));
//                                   group ch_mask band  freq_hi freq_lo

// Set band 0, ch=0, gain=+3.0dB  (30 = 3.0 * 10)
await sendCmd(0x0704, new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x1E]));

// Set band 0, ch=0, Q=1.0  (1024 = 1.0 * 1024)
await sendCmd(0x0705, new Uint8Array([0x00, 0x01, 0x00, 0x04, 0x00]));

// Set band 0, ch=0, filter=Peak (5 in app enum)
await sendCmd(0x0706, new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x05]));

// Or set all params at once with SetEqBandParam (0x070F)
// [group, ch_mask, band, filterType, freq_hi, freq_lo, gain_hi, gain_lo, q_hi, q_lo]
await sendCmd(0x070F, new Uint8Array([0x00, 0x01, 0x00, 0x05, 0x03, 0xE8, 0x00, 0x1E, 0x04, 0x00]));
```
