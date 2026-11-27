# Moondrop Edge / Edge 2 / Pudding PEQ protocol notes

These notes are derived from the decompiled APK at `/Users/joflaherty/Downloads/MOONDROP_2`, especially `EqHandler`, `MusicProcessingRepositoryImpl`, `BandInfo`, `V3MusicProcessingPlugin`, `AirohaHandler`, and `NativePeq`. They describe what the app sends; they are not a hardware capture.

## What the APK actually exposes

`EqHandler` has separate method-channel operations for `getPEQ`, `setPEQ`, `setBluetrumPEQ`, and `airohaSetPeq`. The repository first fetches EQ state, presets, selected set, and band count, then requests the user-band configuration. The default request is five bands, and requests are split into ranges when necessary.

The Qualcomm GAIA V3 music-processing feature is feature `5`, vendor `29` (`0x001d`). A GAIA packet is simply `vendor:u16 BE`, `command:u16 BE`, then payload. The command word is `(feature << 9) | (type << 7) | command`; app commands are type `COMMAND` (`0`). Thus a PEQ read is `00 1D 0A 05 start end`, and a normal PEQ write is `00 1D 0A 06 start end records...`. Responses use type `RESPONSE` (`2`), so their command word has `0x0100` added; notifications use type `1`.

## Band record and read/write payloads

Each band is seven bytes, big-endian:

`frequency:u16`, `Q:u16 = Q * 4096`, `filter:u8`, `gain:s16 = dB * 60`.

The APK uses Java integer casts, which truncate toward zero. `Filter.PARAMETRIC_EQUALIZER` is ordinal `13`; the other filter ordinals are in `Filter.java`.

Normal read (`command 5`) payload: `[startBand, endBand]`. The response repeats those two bytes and then contains one seven-byte record per band. `MusicProcessingRepositoryImpl.setUserSetBandGain` converts the Flutter `bandCount` to an inclusive end index (`bandCount - 1`). The decompiled `V3MusicProcessingPlugin.setUserSetGains` writes the normal command-6 fields with suspicious overlapping offsets for the type byte (`setSINT16` at `6 + i`); this is either a JADX reconstruction defect or an actual firmware-specific quirk. The reference codec uses the unambiguous seven-byte `BandInfo` layout and the Bluetrum/Airoha writers, which are internally consistent. Validate normal `setPEQ` against a capture before sending writes.

Bluetrum read responses are detected by the APK when the packet is long enough for `4 + 7*N` bytes. Their payload is `[start, end, totalGain:s16, records...]`; `totalGain` uses the same `/60` scale. `setBluetrumPEQ` writes this format with command `6`, and the plugin chunks writes at seven bands per packet.

The Airoha route is different at the coefficient level. `AirohaHandler` calls the native `libNativePeq` generator for 44.1/48/88.2/96 kHz, packages coefficient blocks, and sends them through GAIA command `6` in 64-byte chunks (one chunk index byte plus up to 63 data bytes). It can also store the seven-byte-band representation through GAIA command `7`. This is why a generic “send the 7-byte PEQ” implementation may work for a Qualcomm/Bluetrum device but cannot be assumed to work for an Airoha TWS firmware.

The source does not contain a reliable model-name table tying `Edge 2` or `Pudding TWS` to one of these chip paths. The safest identification is therefore capability/response based: try the GAIA service and inspect the music-processing responses; use the Airoha path only when the device is identified as Airoha by the app’s connection strategy. A packet capture from each physical model is still required before enabling writes in production.

## Comparison with existing devicePEQ Moondrop support

`devicePEQ/moondropEdgeUsbSerialHandler.js` implements the older `Moondrop Edge` SPP protocol. It uses the standard RFCOMM UUID `00001101-0000-1000-8000-00805f9b34fb`, then wraps commands as `FF 04 lenH lenL 00 1D 0A cmd payload`. Its five-band payload has the gain shifted into the next slot’s leading two bytes and a final gain in padding. That layout is not the GAIA `BandInfo` layout above.

So the current handler is useful for the original Edge registration, but it does not cover the new GAIA Edge 2/Bluetrum path or the Airoha coefficient path. The reference codec beside this document deliberately includes both envelopes so a future handler can keep model-specific dispatch explicit.

The APK also uses GAIA GATT UUIDs `00001101-d102-11e1-9b23-00025b00a5a5` (command), `00001102-d102-11e1-9b23-00025b00a5a5` (response), and `00001103-d102-11e1-9b23-00025b00a5a5` (data), while its Airoha connector prefers classic SPP UUID `00001101-0000-1000-8000-00805F9B34FB`.

## Reference codec

`codec.mjs` builds/parses the source-derived GAIA packets and both normal and Bluetrum/Airoha storage payloads. `codec.test.mjs` checks scaling, packet words, response decoding, and the difference from the existing Edge envelope. It is intentionally offline and makes no claim that a particular model accepts a given path without a hardware trace.
