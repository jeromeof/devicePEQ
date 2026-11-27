# EarFun Wave Pro X (HP1000): Professional EQ protocol

Analyzed 2026-09-05 from the supplied `EarFun+Audio_20/sources` decompilation.
Status: source-derived, offline packet tests passed; no headphone connection or hardware validation performed. This folder supplies a reference codec, not a registered devicePEQ handler.

## Main findings

Wave Pro X is `HP1000`. Its model registration selects `HP1000ProtocolParser`, which extends `QualcommProtocolParser`, and an anonymous `TW700Equailzer` subclass of `Qualcomm10Equailzer`. That subclass overrides graphic `sendEq`, but inherits Professional `sendProEq`. The config explicitly includes Professional EQ. [Model registration](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/base/DeviceType.java:12751), [protocol/equalizer selection](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/base/DeviceType.java:13154), [Professional EQ option](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/base/DeviceType.java:12970).

The app sends ten independently addressed parametric filters over Bluetooth Classic RFCOMM/SPP, service UUID `00001101-0000-1000-8000-00805f9b34fb`. This is the Qualcomm path, not the `EF … FE` framing in devicePEQ's Tune Pro handler. [SPP UUID](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:264), [socket creation](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/bt/connect/SppConnect.java:133), [socket writes](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/bt/connect/SppConnect.java:223).

## Exact write format

One 18-byte packet per band:

```text
FF 04 00 0A 00 1D 0E 01 BB MM MM FF FF GG GG QQ QQ TT
```

Offsets below are zero-based. All two-byte values are big-endian.

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | FF | Frame start |
| 1 | 04 | Protocol version used by the app |
| 2 | 00 | Short-length framing flags |
| 3 | 0A | Length of band data, excluding four vendor/command bytes |
| 4–5 | 00 1D | Vendor prefix |
| 6–7 | 0E 01 | EQ command |
| 8 | A1…AA | Band 1…10 (`0xA1 + zeroBasedIndex`) |
| 9–10 | MM MM | Signed int16: truncate(master gain dB × 60) |
| 11–12 | FF FF | Unsigned uint16: truncate(frequency Hz × 3) |
| 13–14 | GG GG | Signed int16: truncate(band gain dB × 60) |
| 15–16 | QQ QQ | Unsigned uint16: truncate(Q × 4096) |
| 17 | TT | Filter type code |

There is **no checksum or footer** in this outgoing framing. The final `0D` in a peaking packet is a filter code, not a terminator. The two `FF` placeholders in the table above denote frequency bytes, not literal values.

Evidence: [band encoder](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/equailzer/headset/Qualcomm10Equailzer.java:62), [band addressing](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/equailzer/headset/Qualcomm10Equailzer.java:15), [big-endian helper](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/equailzer/base/BaseEquailzerProtocol.java:172), [EQ command wrapper](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:681), [frame wrapper](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:500).

The app uses Kotlin/Java float32 arithmetic followed by integer truncation toward zero. For byte compatibility, use `Math.trunc(Math.fround(Math.fround(value) * scale))` in JavaScript. Do not use `Math.round`. In particular, 31.5 Hz encodes as 94 (`005E`), and Q 0.7 as 2867 (`0B33`). Decoding those values gives approximately 31.333 Hz and 0.699951; this is wire quantization.

### Filter types and editor limits

| App enum | Type byte | Implication for devicePEQ |
|---|---|---|
| PEQ | 0D | Peaking; map from `PK` |
| LoShelf1stOrder | 04 | First-order low shelf |
| HiShelf1stOrder | 05 | First-order high shelf |
| LoPass1stOrder | 01 | First-order low pass |
| HiPass1stOrder | 02 | First-order high pass |
| AllPass1stOrder | 03 | First-order all pass |

[Type definitions](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/equailzer/base/BaseEquailzerProtocol.java:40). Do not silently map a second-order/RBJ shelf to these first-order shelf codes. The encoder sends frequency, gain and Q for every type; this does not establish that firmware uses all fields for every type.

The editor accepts master gain −12…+6 dB, band gain −12…+12 dB, frequency 1…20000 Hz, and Q 0.25…10. Master/band gain text has one decimal place. These are app limits, not independently measured DSP limits. [Input bounds](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/fragment/DeviceEquailzerProFragment.java:619).

Default new Professional EQ: master −6 dB; ten 0 dB peaking bands; Q 0.7; frequencies 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz. [Default construction](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/fragment/DeviceEquailzerProFragment.java:603).

Master gain is repeated identically in every band record; the editor updates all records when it changes. Do not divide master gain by ten or add it to each band's gain. [Master update](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/fragment/DeviceEquailzerProFragment.java:1240).

### Examples

Default first band, master −6 dB, 31.5 Hz, gain 0, Q 0.7, peaking:

```text
FF 04 00 0A 00 1D 0E 01 A1 FE 98 00 5E 00 00 0B 33 0D
```

Band 6, master −6 dB, 1000 Hz, gain −3 dB, Q 1, peaking:

```text
FF 04 00 0A 00 1D 0E 01 A6 FE 98 0B B8 FF 4C 10 00 0D
```

These are calculated from source, not captured from hardware.

## Write sequence and connection setup

`BaseDeviceViewModel.sendProEq` forwards the model list to `BaseDevice.sendProEq`. That method calls `buildCmdEqCommond(0)`, then encodes and queues all ten bands. For this inheritance chain the former is the base implementation: it updates the app's `oluvState` and returns null. Consequently **there is no preliminary EQ-select packet** from that call, and no separate save/commit packet in `sendProEq`. [View model](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/viewmodel/BaseDeviceViewModel.java:1636), [send loop](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/base/BaseDevice.java:731), [null command implementation](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/base/BaseProtocolParser.java:400).

The queue sends in order with a configured gap; the base config used here returns 30 ms. There is no EQ-ACK wait in this loop. Successful stream writes should not be described as verified device acceptance. [Queue worker](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/manager/DeviceManager$startSendCommond$1$1.java:51), [gap](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/config/base/BaseConfig.java:144).

The Qualcomm parser also supplies the following connection initialization sequence. Preserve this as evidence for transport integration; its necessity for a minimal EQ-only session still needs hardware verification:

```text
FF 04 00 00 00 0A 03 00
FF 04 00 00 00 1D 00 01
FF 04 00 05 00 1D 00 0D 07 00 00 00 04
FF 04 00 01 00 1D 00 07 0D
FF 04 00 01 00 1D 00 07 05
FF 04 00 01 00 1D 00 07 08
FF 04 00 01 00 1D 00 07 01
FF 04 00 01 00 1D 00 07 06
FF 04 00 01 00 1D 00 07 07
FF 04 00 01 00 1D 00 07 07
```

The repeated final command is present in the decompilation. [Initialization](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:489). Other startup device-info queries occur elsewhere; this list is not asserted to be the entire connection transcript.

## Reading: app storage versus headphone state

No Professional EQ read request or filter-response decoder was found in the HP1000/Qualcomm app path inspected. The UI selects a stored Professional preset, falls back to `getLastProEq()`, then constructs defaults if neither exists. `putLastProEq()` serializes the full EQ model into `currentEqSharedPreferences`, keyed by Bluetooth MAC; `getLastProEq()` reads that JSON. Named presets can also be obtained through the app's account EQ-list API. [Editor initialization](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/fragment/DeviceEquailzerProFragment.java:568), [storage writer](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/viewmodel/BaseDeviceViewModel.java:1827), [storage reader](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/viewmodel/BaseDeviceViewModel.java:1877), [account list](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/page/device/viewmodel/BaseDeviceViewModel.java:1911).

This supports **app-compatible writing and locally remembered EQ**, not a demonstrated hardware readback protocol. It does not prove firmware has no undocumented read facility. Do not invent a GET command by changing `0E01` to a guessed neighboring opcode, or treat SDK code for other Qualcomm devices as HP1000 evidence.

The generic receive parser accepts short frames with versions 4 or 3 and buffers to length+8, but its presence does not establish PEQ responses. An outgoing packet decoder, including the one here, only recovers values from an observed write. [Receive framing](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:1548), [response dispatch](/Users/joflaherty/Downloads/EarFun+Audio_20/sources/com/corelink/earfun/device/protocol/headset/QualcommProtocolParser.java:1170).

## devicePEQ integration implications

The existing [Tune Pro handler](../../../devicePEQ/earfunUsbSerialHandler.js) and [registration](../../../devicePEQ/usbSerialDeviceConfig.js:215) cannot be reused unchanged: they emit EF/FE framing, different band addresses and gain scaling, a fixed Q, and no filter-type field. Their protocol-wide claim that EarFun cannot read EQ is broader than this analysis can establish. This investigation does not independently validate or change Tune Pro behavior.

For Wave Pro X integration:

1. Add a separate HP1000 handler/registration using the existing SPP connector and this UUID. Mark it experimental until a capture and hardware test verify it.
2. Expose ten configurable PK bands, Q 0.25…10, gain ±12 dB, frequency 1…20000 Hz and master −12…+6 dB. Add first-order types only when devicePEQ can represent their response correctly.
3. Validate the entire filter list before writing. Send ten packets in order, with the same master gain in each and approximately 30 ms between packets. Exactly ten records prevent stale trailing bands.
4. Treat `pullFromDevice` as unavailable for actual filter state. If restoring a cache or defaults, identify that source explicitly. Cache by device identity and label it last-written/unverified; EarFun app changes can make it stale.
5. Do not expose app preset names as demonstrated hardware slots. No slot identifier appears in this write format. Do not invent an enable/bypass command; sending flat PK filters is a possible application policy, not a proven native bypass.
6. Validate initialization, acceptance/ACK behavior, persistence after power cycling, and interaction with ANC/audio modes on a physical HP1000. These remain unknown from this write path.

The app's stored UI values will not necessarily reflect a write performed by devicePEQ, because the app reads its own stored model. An unchanged EarFun screen therefore does not by itself demonstrate write failure.

## Reference codec and checks

[codec.mjs](codec.mjs) exports `encodeBand`, `encodeEq`, `defaultFilters`, and `decodeWritePacket`. The decoder is explicitly for outgoing captured write packets, not read responses. It has no Bluetooth side effects and is not loaded by production code.

```js
import { encodeEq, defaultFilters } from './codec.mjs';
const filters = defaultFilters();
filters[5] = { freq: 1000, gain: -3, q: 1, type: 'PEQ' };
const packets = encodeEq(filters, -6);
// packets contains ten Uint8Arrays, ready for a separately validated SPP transport.
```

Run `node --test testing/protocol-docs/earfun-wave-pro-x/codec.test.mjs` from the repository root. Four tests verify hand-derived packet vectors, signed gain, unsigned upper frequency/Q, ten band addresses, type codes, and invalid-input rejection. Hardware behavior remains untested.
