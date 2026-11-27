# WalkPlay over Bluetooth LE: can the PEQ be read back?

Device: **CB1300 with BLE** ("USB AI ENC with BLE", USB `0x3302:0xB301`, BLE name `Audio_BLE`, 8 bands, SchemeNo13),
2026-11-12. The dongle was connected by USB **and** BLE at once: USB (HID, the real `walkplayHidHandler.js`) writes and
reads the true device state, BLE is what is being tested. Every frame both ways is in `captures/`.

## Tools

| File | What |
|---|---|
| `ble_lab.py` | BLE: connects, subscribes to **every** notify/indicate characteristic (FF20 and FF14 here), logs every write and notification; experiments `gatt`, `chipid`, `plainreads`, `idxsweep`, `lensweep`, `cmdscan`, `raw`, `script` (USB and BLE steps interleaved in one BLE connection). |
| `usb_tool.mjs` | USB: `snapshot` / `restore` (raw, exact), `write` (filters through the real handler), `read`; logs every HID frame. |

Log lines (JSON, one per frame): `{"t", "link": "ble"|"usb", "dir": "tx"|"rx"|"err"|"note", "char", "reportId", "hex", "note"}`.

## Captures

| # | File | What it shows |
|---|---|---|
| 01 | `01-usb-snapshot-original.jsonl`, `original-cb1300-snapshot.json` | The dongle as found (31 Hz +1.9, 62 Hz −2.7 = the iOS app's "Test" EQ), tag 101. Restored at the end (14). |
| 02 | `02-ble-gatt-chipid.jsonl` | GATT: service FF12 = FF15 (FOTA), FF14 (notify only), FF20 (write/read/notify). Chip id: 1st reply zeros, 2nd `3302:B301`. |
| 03 | `03-usb-write-eqA.jsonl`, `eq-A-usb.json` | EQ A written over USB (8 distinct bands, LS + HS, gain −2 dB) and read back over USB: exact. |
| 04 | `04-ble-plainreads.jsonl` | 10 plain BLE EQ-group reads: 1st zeros, then always band 1 of EQ A (90 Hz LS +3.5). |
| 05 | `05-ble-idxsweep.jsonl` | Band index 3 at **each** of the 58 payload bytes: always band 1. |
| 06 | `06-ble-lensweep.jsonl` | Length byte 0..0x40, padded / unpadded, with / without the 0x4B prefix: always band 1 (or no reply without 0x4B). Some replies arrive with **one byte dropped** and a stray `2d` near the end — the link corrupts the odd notification. |
| 07 | `07-ble-cmdscan.jsonl` | Read of every command 0x00..0x3F (save / apply / erase / restore-factory excluded). Answering: 0x02 mic, 0x03 gain, 0x09 EQ group, 0x0E chip id (reply 0x27), 0x11 DAC filter, 0x16 balance (one reply per channel), 0x18 gain level, 0x20 work mode, 0x21 UAC, 0x31 ENC, **0x32 (unknown, reads 0x80)**. No other command returns band data. |
| 08 | `08-ble-onebehind-index.jsonl` | Index requests followed by plain reads: the index is not honoured on the next read either. |
| 09–10 | `09-usb-write-eqB.jsonl`, `10-ble-read-after-usb-eqB.jsonl`, `eq-B-usb.json` | EQ B over USB (band 1 75 Hz −4, gain −5): BLE **gain** read gives the old value once, then the new one; BLE **band** read stays on EQ A. |
| 11 | `11-interleaved-usb-ble.jsonl` (+ `-usb`) | One BLE connection, USB pushes in between: gain follows every USB change one request late; band read never changes. |
| 12–13 | `12-usb-snapshot-eqB.jsonl`, `eqB-raw.json`, `13-ble-write-sets-shadow.jsonl` | A BLE write of band 3 (bytes taken from USB, so no audible change) makes reads return band 3; after a USB push, reads return band 1 again. |
| 14 | `14-usb-restore-original.jsonl`, `after-restore.json` | Restored: identical to 01 (8/8 bands, gain). |
| 15 | `15-usb-snapshot-before-commit-tests.jsonl`, `before-commit-tests.json` | Start of the commit tests (same as 01). |
| 16 | `16-usb-to-ble-with-commits.jsonl` (+ `-usb`) | USB push of EQ A, then a separate USB commit (0x0A + 0x01), BLE apply (0x0A), BLE save (0x04): band 1 over BLE follows the push **one read late, with no extra commit**; none of the commits changes anything; BLE apply/save do not touch the DSP EQ (USB reads). |
| 17 | `17-band1-follow-transitions.jsonl` (+ `-usb`) | original → B → A → original → B: band 1 follows every change **except to EQ B**. The odd "45824 Hz" replies are EQ A's band 1 with one byte dropped (three different positions). |
| 18 | `18-0x4B-byte-test.jsonl` (+ `-usb`), `eq-B76-usb.json` | EQ B with band 1 at **76 Hz** is picked up; at **75 Hz (= 0x4B)** it is not. |
| 19 | `19-ble-write-to-usb-with-commits.jsonl` (+ `-usb`) | BLE write of band 3: USB reads it **at once**, with no apply/save; BLE apply/save/USB commit change nothing further. The first BLE read after the write echoes the written band, the next is band 1 again. |
| 20 | `20-usb-snapshot-final.jsonl`, `after-commit-tests.json` | Restored: 8/8 bands and gain identical to 15. |
| 21 | `21-ble-dirsweep-band3.jsonl` | cmd 0x09 carrying band 3's **full** current payload under direction bytes 0x80, 0x01, 0x00, 0x02 … 0xFF: only 0x01 (a real write) has any effect; a read with the full payload still gives band 1. |
| 22 | `22-ble-write-echo-marker.jsonl` | Band 3 written with identical bytes plus markers `a0…b1` after the tag: the next read returns **our frame verbatim** (markers too); later reads return band 1 from the DSP **with the markers still in the tail**. |
| 23 | `23-usb-raw-reads.jsonl` | Over USB the DSP's reply **starts with the request bytes as sent** (`80 09 3c 00 03 00` comes back unchanged) — it fills the band in place after them. |
| 25 | `25-ble-write-all-commit-usb-read.jsonl` (+ `-usb`), `after-ble-write-all.json` | All 8 bands written over BLE, then apply + save over BLE: USB reads **8/8 byte-identical**. BLE reads idx 0..7 all return band 8 (our last write frame, still in the chip's buffer; band 1 = 75 Hz = 0x4B so the DSP's band-1 reply never replaced it). Restored afterwards (26, `after-restore-2.json`). |
| 24 | `24-usb-snapshot-after-deepdive.jsonl`, `after-deepdive.json` | 8/8 bands and gain identical to 15; the markers were not stored by the DSP. |

## What the captures say (corrected after 15–20)

1. **Reads are live but one request behind** — settings and band alike. The Bluetooth chip answers each read with the reply
   it holds, then forwards the request to the DSP and keeps the new reply for next time (the very first is zeros, and the
   held reply even survives a BLE reconnect). Read twice and use the second reply.
2. **No commit is needed either way.** A USB push (bands + 0x0A + 0x01) is seen by the next-but-one BLE read; a BLE band write
   is in the DSP at once (USB reads it before any apply/save). Extra commits (USB 0x0A/0x01, BLE 0x0A/0x04) change nothing
   that is read. (Save is still needed for the EQ to survive a power cycle.)
3. **A reply that contains the byte 0x4B is thrown away** by the Bluetooth chip (0x4B starts every frame, so it resyncs on
   it), and the old reply is kept. EQ B's band 1 was 75 Hz = 0x4B: that alone made captures 10–11 look like "band reads
   never follow USB". Any band whose bytes (frequency, Q, gain, coefficients) contain 0x4B cannot be read over BLE.
4. **The band index never reaches the DSP** — see *Packet structure* below: for a read the Bluetooth chip forwards only the
   command byte. After a BLE band write the next read returns *our own write frame* from the chip's reply buffer (22), not
   a readback; in 13 it seemed to stick only because band 1 of EQ B held 0x4B.
5. **The WalkPlay app does not read bands either** (decompiled `DeviceFragment.readDeviceEQData`): it reads only byte 36 of
   the EQ-group reply — the EQ **tag** (101 here) — and shows the EQ it has stored under that tag.
6. **The link drops a byte now and then** (06, 17 — several times a minute): replies must be checked before use (a
   dropped byte shifts frequency/Q/gain into nonsense such as 45824 Hz).

So over BLE: settings and band 1 (and the tag) can be read (twice, checked, 0x4B-blind); bands 2..N cannot.

## Packet structure, byte by byte

### USB (HID report 0x4B, 63 data bytes) — the DSP directly

Read request (WalkPlay web app; the Android SDK sends the same with the index left 0):

| byte | 0 | 1 | 2 | 3 | 4 | 5.. |
|---|---|---|---|---|---|---|
| | `80` read | `09` cmd | len (ignored: 00 and 3c both work) | 00 | **band index** | 00 |

Reply — the request bytes 0..6 **as sent** (23), then the band, filled in place:

| bytes | 0–1 | 2–3 | 4 | 5–6 | 7–26 | 27–28 | 29–30 | 31–32 | 33 | 34 | 35 | 36.. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | `80 09` | echoed | **index** | 00 00 | 5 biquad coeffs ×2^30, LE i32 (b0 b1 b2 a1 a2) | freq Hz LE | Q×256 LE | gain×256 LE s16 | type (1 LS, 2 PK, 3 HS, 4 LP, 5 HP) | offset | tag (EQ slot, 101) | 00 |

Write: `01 09 18 00 idx 00 00` + the same 29 bytes as the reply (7–35).

### BLE (GATT FF20 / AB02, 64-byte frames) — through the Bluetooth chip

`4B | dir (80 read / 01 write) | cmd | len = payload+2 | payload (58 for an EQ group) | zero pad`. The 58-byte EQ-group
payload is the USB layout shifted by 3 (SDK `r8/d.java`): `[0] 00, [1] index, [2–3] 00, [4–23] coeffs, [24–25] freq,
[26–27] Q, [28–29] gain, [30] type, [31] offset, [32] tag`. So BLE payload byte 1 = frame byte 5 = USB report byte 5 (with
the report id) — the same place.

### What the Bluetooth chip does with a frame

```
 phone ──GATT write──▶ BT chip ──link──▶ DSP
                         │   write (dir 01): whole frame forwarded  → band written (USB reads it at once, 19)
                         │                   whole frame also copied into the chip's 64-byte reply buffer (22)
                         │   read  (dir 80): chip notifies its reply buffer AS IT IS  (→ "one request behind")
                         │                   then sends the DSP its OWN request: cmd only, len 3c, payload all 00
                         ◀── DSP reply (≈40 bytes, request header echoed) overwrites the start of the buffer;
                             a reply containing 0x4B is discarded (frame sync), buffer kept
```

Proof that a read's payload is dropped by the chip, not ignored by the DSP: the DSP echoes the request it received at
the start of its reply (23). Over BLE that echo is **always** `80 09 3c 00 00 00 00`:
* index 3 placed in each of payload bytes 0–3 (05): echo still `00 00 00 00` — 58 of 58 replies;
* length byte 0x00 … 0x40 (06): echo always `3c`;
* full band-3 payload, any direction byte (21): band 1.

Independently, the vendor code agrees: the BLE SDK's `readEqGroup()` takes no index (sends 58 zero bytes), and the app's
`WPCBDataSender.readEQData(filterIndex, …)` drops `filterIndex` on BLE. The app only uses the tag byte.

**Conclusion: with this Bluetooth firmware, bands 2..N cannot be read over BLE by any frame we can send.** Only band 1 (and
settings, which have no payload to lose) come back. It would take a change in the Bluetooth chip's firmware (it has a FOTA
characteristic, FF15) — something to ask WalkPlay for: forward the read payload, as the write path already does.

## Second model: CS43198-SGM8262-TFT-BLE (USB `3302:4333`, BLE "HiFi Audio TFT-BLE", 10 bands, DSP firmware "1.5")

| # | File | What it shows |
|---|---|---|
| 30 | `30-tft-usb-snapshot-original.jsonl`, `tft-original-snapshot.json` | Flat, 10 bands 31 Hz … 16 kHz (each band distinct by frequency); no 0x4B in any band. |
| 31 | `31-tft-ble-gatt.jsonl` | FF12: FF13 (write), FF14 (notify), FF20 (read/notify/write), FF15 (FOTA). Extra service FF10 with FFF1 (write/notify). |
| 32 | `32-tft-ble-ff20-index.jsonl` | **Same behaviour as the CB1300**: first reply zeros, then one behind; index 3/5/9/1 all return band 1 (31 Hz); DSP's echoed request always index 0. |
| 33 | `33-tft-ble-fff1-index.jsonl`, `33b-…chipid` | FFF1 does not answer WalkPlay frames at all (EQ, gain, chip id). |
| 34 | `34-tft-usb-fwversion.jsonl`, `tft-after.json` | USB cmd 0x0C → `"1.5"`. Dongle unchanged (10/10). |

The same Bluetooth read path (command byte only) is in this model's firmware too.

## Live recheck of the attached TFT dongle, 2026-11-12 11:59–12:00 UTC

USB enumeration identified `CS43198-SGM8262-TFT-BLE`, `3302:4333`; USB command `0x0C` returned DSP firmware `1.5`.
BLE connected under `HiFi Audio TFT-BLE`. These probes sent read requests only: no EQ/settings writes, commits,
factory resets, or firmware operations. GATT writes below carry protocol direction `0x80` (read).

| Capture | Observation |
|---|---|
| `36-tft-live-usb.jsonl`, `tft-live-before.json` | All 10 bands read correctly over USB: 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz, gain 0, Q 0.75, PK, tag 101. |
| `37-tft-live-ff20-index.jsonl` | Requested zero-based indexes 0, 3, 9, 1, each twice with about 390 ms between requests. All 8 replies had index 0, 31 Hz. Outgoing frame byte 5 contains the requested index; incoming frame byte 5 is always 0. Repeating a request does not fix index selection. |
| `38-tft-live-ff13-index.jsonl` | Tested the alternate FF13 write / FF14 notify channel while subscribing to every notification characteristic. Indexes 0, 3, 9, short and 64-byte frames, lengths 0 and 0x3C, and short frames without report-ID prefix: no notifications on any channel, no GATT write errors. |
| `39-tft-live-usb-index.jsonl` | USB requests `80 09 3c 00 03 00` and `80 09 3c 00 09 00` echoed indexes 3 and 9 and returned 250 Hz and 16000 Hz respectively. Firmware reply was `1.5`. |
| `40-tft-live-fff1-index.jsonl` | Alternate FFF1 channel: indexes 0, 3, 9, full 64-byte frames with lengths 0 and 0x3C: no notifications on any channel, no GATT write errors. |
| `41-tft-live-usb-after.jsonl`, `tft-live-after.json` | Final raw USB snapshot matches the initial snapshot for all 10 bands and every captured setting. |

This reproduces the fault independently of either app's transport or parser. The index is already zero in the raw
BLE notification; changing the parser's index offset or assigning the requested index to the response would mislabel
the same 31 Hz band as other bands. USB confirms that indexed reads work in the DSP. Together with the earlier
request-header echo experiments, the evidence points to the BLE bridge replacing the indexed read with a zero-payload
request. No working alternate read channel was found in these probes; this does not establish what an undocumented
protocol or a future bridge firmware could support.

Current application behavior is appropriate for full PEQ reads: DevicePEQ sets `supportsRead: false` for WalkPlay BLE
and returns an unsupported result from its BLE pull handler; PragmaticAudioPEQ uses `WalkplayBleHandler` to return
the app's last-sent copy with `fromAppCopy: true`, or asks for USB when no copy exists. Both USB parsers use byte 4
after stripping report ID, matching the live USB replies. The comments that previously described every BLE read as
returning the last written band were incomplete and have been corrected: that can be a buffered write echo, whereas
subsequent successful DSP replies contain band 0.

For genuine full readback on this firmware, use USB. A vendor bridge fix should forward the requested read payload
(especially EQ-group payload byte 1), return the corresponding fresh DSP response, and preserve arbitrary payload
bytes including `0x4B`. Single-read slot/settings APIs still need caution because a valid-looking reply can be stale.

## Third model: CS43198 HiFi Audio-BLE (USB `3302:4334`, BLE "HiFi Audio-BLE", DSP firmware "1.5")

Tested live on 2026-11-12. USB enumeration identified `CS43198 HiFi Audio-BLE`; BLE CHIP_ID independently returned
`3302:4334`. The model is in SchemeNo16. USB indexes 0..9 were readable: index 0 held a 222 Hz low shelf,
gain +3.73 dB, Q 0.71; index 1 held a distinct 703 Hz high shelf, gain -2.52 dB, Q 0.71. Indexes 2..9 held
0 Hz, gain 0, Q 0.75, PK entries. These are raw wire values, before any app-side scheme compensation. Tag was 101.
Neither of the two populated bands' captured USB replies contained `0x4B`, so the previously observed embedded-byte
problem does not explain the failure to read index 1 here.

All probes were read-only at the device protocol level, including GATT writes carrying direction `0x80`.
No EQ/settings writes, apply/save commands, or firmware operations were sent.

| Capture | Observation |
|---|---|
| `42-audio-ble-usb-before.jsonl`, `audio-ble-before.json` | Initial raw snapshot of USB indexes 0..9 and mic/global gain/DAC filter/gain mode/work mode. |
| `43-audio-ble-gatt.txt` | Only service FF12: FF15 (read/write-without-response, reads `FOTA`), FF14 (notify), FF20 (read/write/notify). No FF13, FFF1, or AB02 alternate data channel was exposed. Every notify characteristic was subscribed. |
| `44-audio-ble-ff20-index.jsonl` | Requested zero-based indexes 1, 1, 0, 0, 3, 3, 9, 9, 1, 1, about 390 ms apart. First reply had an empty EQ payload (index/frequency/Q/type/tag all zero). The following 9 replies all returned index 0, 222 Hz, +3.73 dB, Q 0.71, low shelf, tag 101. The first nonempty reply was already band 0 despite both initial requests selecting index 1. |
| `45-audio-ble-usb-index-fw.jsonl` | USB indexed requests echoed indexes 1, 3, 9 correctly. Index 1 returned the distinct 703 Hz high shelf; indexes 3 and 9 returned their 0 Hz PK entries. Command 0x0C returned DSP firmware `1.5`. |
| `46-audio-ble-chipid.jsonl` | First CHIP_ID notification had zero VID/PID; second returned `3302:4334`, consistent with the buffered read behavior. |
| `47-audio-ble-index-position-sweep.jsonl`, corresponding `.txt` | Put value 1 at each of the 58 EQ payload positions, one position per request. All 58 notifications returned index 0 and the same 222 Hz low shelf. |
| `48-audio-ble-length-sweep.jsonl`, corresponding `.txt` | 56 read frame variants: length byte 0, 1, 2, 3, 4, 5, 6, 8, 0x18, 0x1A, 0x3A, 0x3C, 0x3E, 0x40; padded/unpadded; with/without report-ID prefix. All 28 prefixed frames received replies, all index 0 / 222 Hz. All 28 unprefixed frames received no reply. No GATT errors. |
| `49-audio-ble-usb-after.jsonl`, `audio-ble-after.json` | Final raw snapshot is identical to the initial snapshot for every band and captured setting. |

**Conclusion:** this third model reproduces the same indexed-read failure. The requested index is present in the
outgoing BLE frame but zero in the incoming notification, independently of either application's parser. USB can read
the distinct index-1 band, while BLE always returns index 0 after the empty first reply. Repeated requests, alternate
index positions, and length/padding variants did not reveal a working indexed-read format. No alternate data channel
was available on this model. The results support the same BLE-bridge read-payload replacement explanation as the
other two models; full device PEQ readback should remain USB-only on this firmware.

The empty first reply followed by band 0 also shows that an initially empty reply buffer did not make our requested
index reach the DSP in this run. This was not a controlled power-cycle experiment, so it does not settle every possible
power-up timing case. Write behavior, persistence, and the embedded-`0x4B` failure were not retested on this third model.

### Comparison of all three tested models

| USB VID:PID | Model / BLE name | Indexed USB reads | Indexed BLE reads |
|---|---|---|---|
| `3302:B301` | CB1300 with BLE / `Audio_BLE` | Correct distinct bands | Index ignored; band 0 after buffered reply, subject to embedded-0x4B issue |
| `3302:4333` | CS43198-SGM8262-TFT-BLE / `HiFi Audio TFT-BLE` | Correct distinct bands | Index ignored; band 0; tested alternate channels silent |
| `3302:4334` | CS43198 HiFi Audio-BLE / `HiFi Audio-BLE` | Correct index and distinct populated bands | Empty first reply, then band 0; position/length sweeps do not recover indexed reads |

## Screen-controlled EQ comparison on the TFT model: Custom → Pure → Rock

The user reattached `CS43198-SGM8262-TFT-BLE` (`3302:4333`, BLE `HiFi Audio TFT-BLE`) and reported that a Custom EQ
was selected/set using the device screen. Before asking for a further screen change, the following read-only baseline
was captured. Screen values have not yet been independently recorded; the USB result below must not be assumed to
describe the screen's displayed Custom profile.

| Capture | Baseline observation |
|---|---|
| `50-tft-screen-before-usb.jsonl`, `tft-screen-before.json` | USB indexes 0..9 returned 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz; every band gain 0 dB, Q 0.75, PK, tag 101. Global gain 0 dB. The exposed USB PEQ group is flat despite the user's reported screen Custom selection/settings. |
| `51-tft-screen-before-ble.jsonl` | Each index 0..9 requested twice. First reply empty; all 19 subsequent band replies were index 0, 31 Hz, 0 dB, Q 0.75, PK, tag 101. Two global gain reads returned 0 dB. |

The user then reported switching the device screen to **Pure**. Read-only captures were repeated:

| Capture | After switching to Pure |
|---|---|
| `52-tft-screen-pure-usb.jsonl`, `tft-screen-pure.json` | Complete raw snapshot is identical to `tft-screen-before.json`: all 10 band packets (including coefficients, metadata and tag) and all 5 captured settings. Band gains and global gain remain 0 dB; tag remains 101. |
| `53-tft-screen-pure-ble.jsonl` | Each index 0..9 requested twice. All 20 band replies returned index 0, 31 Hz, 0 dB, Q 0.75, PK, tag 101, matching the valid baseline band metadata and coefficients. Both global gain response frames also match the baseline (0 dB). |

**Observed result: the Custom → Pure screen selection change cannot be distinguished from these USB or BLE read
responses.** This is a separate finding from BLE dropping the band index: even the full indexed USB PEQ group did not
change in this screen-selection experiment. It would be incorrect to use these captures as evidence that USB reads
the active screen EQ correctly while BLE alone fails to reflect it.

Possible explanations include separate screen-preset/DSP state, a preset selector not exposed by the commands tested,
or Custom and Pure having the same exposed PEQ values. The screen's actual Custom gains and any audible change were
not independently verified, so these captures do not establish which explanation applies. A controlled edit of specific
Custom band gains on screen, with their displayed values recorded, is needed to distinguish these cases. The probes
sent no device-setting writes and did not select a profile themselves.

The user next reported selecting **Rock** on the screen. The same read-only probes were repeated:

| Capture | After switching to Rock |
|---|---|
| `54-tft-screen-rock-usb.jsonl`, `tft-screen-rock.json` | Complete raw USB snapshot is identical to both Custom and Pure snapshots, including all 10 bands' coefficients/metadata/tag and all 5 captured settings. All band gains and global gain remain 0 dB; tag remains 101. |
| `55-tft-screen-rock-ble.jsonl` | All 22 response frames are byte-for-byte identical to Pure: 20 EQ replies (each index 0..9 requested twice) all return index 0, 31 Hz, gain 0 dB, Q 0.75, PK, tag 101; two global gain replies return 0 dB. |

**Rock is also indistinguishable from Custom and Pure through these reads.** The captures do not reconstruct or
identify the selected screen profile on either link. This strengthens the observation that screen preset selection
is not reflected in the exposed PEQ-group/tag/global-gain responses, but does not establish whether the presets use
separate processing/state or require another read command. Screen gains and an audible processing change remain
unverified. The independent BLE band-index defect remains reproducible.

Coefficient-level follow-up: the raw captures include the actual five signed little-endian Q30 coefficients per
band at USB HID data bytes 7..26, not just frequency/Q/gain/type metadata. All 10 coefficient sets in each of the
Custom, Pure and Rock USB snapshots were decoded. In every set, `b0 = 1`, `b1 = -storedFeedback1` and
`b2 = -storedFeedback2`. Under the handler's negated-feedback encoding, numerator and denominator are identical:
each section has unity transfer (`H(z) = 1`). The first band's coefficients returned over BLE also match USB.
Thus these packets do not hide a changed Rock curve in their coefficients while leaving metadata flat. A normal
EQ-group response contains one second-order section's five coefficients; it does not contain the ten sections of
a general ten-band EQ cascade. This establishes the response contents, not that the device's audible processing
is flat: screen presets could still use a separate processing path that these reads do not expose.

## Screen gain-mode comparison on the TFT model: Low → High confirmed on both links

The user reported setting **Low gain** via the device UI. Dedicated read-only gain-mode captures were taken before
asking the user to switch to High. This is the DAC gain mode, distinct from the PEQ/global gain offset (command 0x03).

| Capture | Low baseline observation |
|---|---|
| `56-tft-screen-low-gain-usb.jsonl` | Three USB reads `80 19 00` all returned `80 19 00 00 …`: gain-mode value at HID data byte 3 is 0, decoded as Low. |
| `57-tft-screen-low-gain-ble.jsonl` | Four BLE reads `4b 80 18 03 00` all returned `4b 80 18 03 00 00 00`: gain-level payload value is 0, decoded as Low. Repeats allow the bridge's initially buffered response to refresh. |

Both links therefore report Low, matching the user-reported UI setting. The known write mapping is USB gain-mode
0/1 (Low/High) versus BLE DAC gain-level 0/2 (Low/High); BLE command 0x19 is a different register and was not used.
The user then reported switching to **High gain** via the UI. The identical read requests were repeated:

| Capture | High observation |
|---|---|
| `58-tft-screen-high-gain-usb.jsonl` | All three USB replies changed to `80 19 00 01 …`: gain-mode value 1, High. |
| `59-tft-screen-high-gain-ble.jsonl` | All four BLE replies changed to `4b 80 18 03 02 00 00`: gain-level value 2, High. The first reply was already High; no stale Low reply was observed in this transition. |

**Confirmed:** both USB and BLE gain reads reflected the user-reported Low → High UI change. USB changed 0 → 1;
BLE changed 0 → 2, agreeing with the known transport-specific encoding. This provides a positive control: a device
UI setting can propagate to both read interfaces, even though Custom/Pure/Rock selection did not alter the PEQ-group
responses tested above. It also qualifies earlier broad statements about settings reads being stale: this gain-mode
read did follow the UI change in this experiment, although it does not establish freshness for every setting or
transition. No gain-setting writes were sent by any of these probes.

## Pop selected in the WalkPlay app: USB exposes the profile; BLE exposes band 0 and tag

The user next reported selecting **Pop in the WalkPlay app**, rather than on the dongle screen. USB reads now show
a clear PEQ change. The initial BLE scan could not find the dongle while the WalkPlay app was still using it; after
the user released that connection, the same BLE probe connected successfully. This is consistent with the app
occupying the BLE connection, although the scan alone does not establish the peripheral's connection limit.

| Capture | Observation |
|---|---|
| `60-tft-app-pop-usb.jsonl`, `tft-app-pop.json` | All 10 band coefficient sets changed from the flat Custom/Pure/Rock screen captures. All bands PK, tag 2 (previously 101); gains and Q as below. Global gain remains 0 dB. |
| `61-tft-app-pop-ble.jsonl` | Each index 0..9 requested twice. First reply still contains old flat band 0 (31 Hz, 0 dB, Q 0.75, tag 101). The following 19 replies all contain Pop band 0 (31 Hz, +4 dB, Q 0.6484375, tag 2), matching its USB coefficients and metadata exactly. Requested indexes 1..9 are still replaced by index 0. Both global gain reads return 0 dB. |
| `62-tft-app-pop-usb-recheck.jsonl`, `tft-app-pop-recheck.json` | USB snapshot after the user released the WalkPlay app's BLE connection is byte-for-byte identical to the first Pop snapshot. |

Pop's raw wire band values, reconstructed via USB:

| Zero-based index | Frequency (Hz) | Gain (dB) | Q |
|---|---|---|---|
| 0 | 31 | +4 | 0.6484375 |
| 1 | 62 | +3 | 0.75 |
| 2 | 125 | -3 | 0.75 |
| 3 | 250 | -2 | 0.75 |
| 4 | 500 | +4 | 0.75 |
| 5 | 1000 | +4 | 0.75 |
| 6 | 2000 | -4 | 0.75 |
| 7 | 4000 | -3 | 0.6015625 |
| 8 | 8000 | +5 | 0.75 |
| 9 | 16000 | +4 | 0.75 |

**Confirmed distinction:** selecting Pop through the app changed the exposed PEQ coefficients, metadata and tag.
USB reconstructs all ten returned bands; BLE detects the change after one stale response and exposes the new tag
and first band, but cannot reconstruct the other nine bands through these indexed requests. A tag of 2 identifies
this user-reported Pop selection in this experiment; it is not proof of a universal preset mapping or of all band
values. The earlier screen selections still showed no change through the same reads. This supports investigating
whether screen presets use separate state or processing from app-written PEQ, but does not itself prove the firmware
architecture. Our probes sent read commands only; the profile change was made by the user in WalkPlay.

## Bass selected on the screen after app-selected Pop: exposed data remains Pop

After the app-selected Pop capture, the user reported selecting **Bass on the device screen**. The same read-only
probes were repeated, giving a direct screen-change comparison against a known nonflat app-written profile.

| Capture | Observation |
|---|---|
| `63-tft-screen-bass-usb.jsonl`, `tft-screen-bass.json` | Complete raw USB snapshot is byte-for-byte identical to `tft-app-pop-recheck.json`, including all 10 bands' coefficients/metadata/tag and all 5 captured settings. Returned gains remain +4, +3, -3, -2, +4, +4, -4, -3, +5, +4 dB at 31 Hz through 16 kHz. Tag remains 2; global gain remains 0 dB. |
| `64-tft-screen-bass-ble.jsonl` | All 20 EQ replies (indexes 0..9 requested twice) return Pop band 0: index 0, 31 Hz, +4 dB, Q 0.6484375, PK, tag 2. Its coefficients and metadata match the USB band exactly. Both global gain reads return 0 dB. |

**Result:** the screen's Bass selection is not reflected in these read interfaces: both still expose the previously
app-written Pop data. Unlike the earlier flat-profile comparisons, this uses a distinctly nonflat baseline, so the
absence of a readback change is not limited to the original flat Custom/Pure/Rock captures. The observations are
consistent with separate screen-preset state/processing or reads exposing stored app PEQ rather than the effective
screen-selected EQ. They do not establish the actual audible Bass response, the internal DSP architecture, or which
additional command might expose the screen preset. BLE still fails indexed band selection independently.

## Not yet tested

* **Right after power-up**, when the copy is empty: does the first band read forward the request — *with its index* — to the
  DSP (the first reply was zeros in 04, as for chip id, which suggests a fetch)? If so, a band could be read once per
  power-up. Needs an unplug/replug between steps.
* Command **0x32** (answers 0x80): unknown; not in the WalkPlay app.
