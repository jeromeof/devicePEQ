# Sony WH-1000XM5 EQ Preset Reference

## Complete Preset Mapping (Captured from Real Device)

All presets captured via Frida from Sony Sound Connect app.

### Band Structure

| Band # | Frequency | Description |
|--------|-----------|-------------|
| 0 | ~40 Hz | Clear Bass (sub-bass) |
| 1 | 400 Hz | Bass |
| 2 | 1 kHz | Low-mid |
| 3 | 2.5 kHz | Mid |
| 4 | 6.3 kHz | High-mid |
| 5 | 16 kHz | Treble |

**Encoding:** 0x0A (10) = 0 dB baseline, each increment = +1 dB

---

## Preset Table

| ID | Name | Clear Bass | 400Hz | 1kHz | 2.5kHz | 6.3kHz | 16kHz | Description |
|----|------|------------|-------|------|--------|--------|-------|-------------|
| **0x00** | **Off** | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | Flat response |
| **0x10** | **Treble Boost** | -1 dB | 0 dB | +5 dB | +7 dB | +7 dB | +9 dB | Bright, analytical |
| **0x11** | **Bass Boost** | +8 dB | -1 dB | +1 dB | 0 dB | +3 dB | +5 dB | Heavy bass, warm |
| **0x12** | **Relaxed** | -3 dB | -1 dB | -2 dB | -3 dB | -4 dB | -6 dB | Reduced energy |
| **0x13** | **Mellow** | -9 dB | -3 dB | -1 dB | -3 dB | -5 dB | -8 dB | Very soft |
| **0x14** | **Vocal** | 0 dB | +6 dB | +4 dB | +2 dB | +3 dB | -1 dB | Mid-forward |
| **0x15** | **Bright** | 0 dB | 0 dB | 0 dB | +2 dB | +6 dB | +10 dB | Treble emphasis |
| **0x16** | **Clear Bass** | +7 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | Bass only |
| **0x17** | **Speech** | -10 dB | +4 dB | +3 dB | +1 dB | +2 dB | -10 dB | Mid-focused |
| **0xA0** | **Manual** | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | User control |
| **0xA1** | **Excited** | 0 dB | -5 dB | 0 dB | +7 dB | +2 dB | +3 dB | V-shaped |
| **0xA2** | **Custom 1** | 0 dB | -3 dB | +3 dB | +1 dB | 0 dB | 0 dB | Mid boost |

---

## Detailed Preset Analysis

### 0x00 - Off
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:     10 (0 dB)  |████████
1 kHz:      10 (0 dB)  |████████
2.5 kHz:    10 (0 dB)  |████████
6.3 kHz:    10 (0 dB)  |████████
16 kHz:     10 (0 dB)  |████████
```
**Use case:** Reference listening, flat response

### 0x10 - Treble Boost
```
Clear Bass:  9 (-1 dB) |███████▓
400 Hz:     10 (0 dB)  |████████
1 kHz:      15 (+5 dB) |█████████████
2.5 kHz:    17 (+7 dB) |███████████████
6.3 kHz:    17 (+7 dB) |███████████████
16 kHz:     19 (+9 dB) |█████████████████
```
**Use case:** Detail retrieval, analytical listening, bright sound

### 0x11 - Bass Boost
```
Clear Bass: 18 (+8 dB) |████████████████
400 Hz:      9 (-1 dB) |███████▓
1 kHz:      11 (+1 dB) |█████████
2.5 kHz:    10 (0 dB)  |████████
6.3 kHz:    13 (+3 dB) |███████████
16 kHz:     15 (+5 dB) |█████████████
```
**Use case:** EDM, hip-hop, bass-heavy music

### 0x12 - Relaxed
```
Clear Bass:  7 (-3 dB) |█████▓
400 Hz:      9 (-1 dB) |███████▓
1 kHz:       8 (-2 dB) |██████▓
2.5 kHz:     7 (-3 dB) |█████▓
6.3 kHz:     6 (-4 dB) |████▓
16 kHz:      4 (-6 dB) |██▓
```
**Use case:** Late night listening, reduced fatigue

### 0x13 - Mellow
```
Clear Bass:  1 (-9 dB) |▓
400 Hz:      7 (-3 dB) |█████▓
1 kHz:       9 (-1 dB) |███████▓
2.5 kHz:     7 (-3 dB) |█████▓
6.3 kHz:     5 (-5 dB) |███▓
16 kHz:      2 (-8 dB) |▓
```
**Use case:** Extremely soft, background listening

### 0x14 - Vocal
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:     16 (+6 dB) |██████████████
1 kHz:      14 (+4 dB) |████████████
2.5 kHz:    12 (+2 dB) |██████████
6.3 kHz:    13 (+3 dB) |███████████
16 kHz:      9 (-1 dB) |███████▓
```
**Use case:** Podcasts, audiobooks, vocal clarity

### 0x15 - Bright
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:     10 (0 dB)  |████████
1 kHz:      10 (0 dB)  |████████
2.5 kHz:    12 (+2 dB) |██████████
6.3 kHz:    16 (+6 dB) |██████████████
16 kHz:     20 (+10 dB)|████████████████████
```
**Use case:** Maximum clarity, detail, sparkle

### 0x16 - Clear Bass
```
Clear Bass: 17 (+7 dB) |███████████████
400 Hz:     10 (0 dB)  |████████
1 kHz:      10 (0 dB)  |████████
2.5 kHz:    10 (0 dB)  |████████
6.3 kHz:    10 (0 dB)  |████████
16 kHz:     10 (0 dB)  |████████
```
**Use case:** Sub-bass enhancement only

### 0x17 - Speech
```
Clear Bass:  0 (-10 dB)|
400 Hz:     14 (+4 dB) |████████████
1 kHz:      13 (+3 dB) |███████████
2.5 kHz:    11 (+1 dB) |█████████
6.3 kHz:    12 (+2 dB) |██████████
16 kHz:      0 (-10 dB)|
```
**Use case:** Podcasts, news, speech intelligibility

### 0xA0 - Manual
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:     10 (0 dB)  |████████
1 kHz:      10 (0 dB)  |████████
2.5 kHz:    10 (0 dB)  |████████
6.3 kHz:    10 (0 dB)  |████████
16 kHz:     10 (0 dB)  |████████
```
**Use case:** Starting point for manual adjustment

### 0xA1 - Excited
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:      5 (-5 dB) |███▓
1 kHz:      10 (0 dB)  |████████
2.5 kHz:    17 (+7 dB) |███████████████
6.3 kHz:    12 (+2 dB) |██████████
16 kHz:     13 (+3 dB) |███████████
```
**Use case:** V-shaped signature, exciting sound

### 0xA2 - Custom 1
```
Clear Bass: 10 (0 dB)  |████████
400 Hz:      7 (-3 dB) |█████▓
1 kHz:      13 (+3 dB) |███████████
2.5 kHz:    11 (+1 dB) |█████████
6.3 kHz:    10 (0 dB)  |████████
16 kHz:     10 (0 dB)  |████████
```
**Use case:** Mid-forward, reduced bass

---

## Raw Hex Values

For protocol implementation:

```
0x00: 0A 0A 0A 0A 0A 0A
0x10: 09 0A 0F 11 11 13
0x11: 12 09 0B 0A 0D 0F
0x12: 07 09 08 07 06 04
0x13: 01 07 09 07 05 02
0x14: 0A 10 0E 0C 0D 09
0x15: 0A 0A 0A 0C 10 14
0x16: 11 0A 0A 0A 0A 0A
0x17: 00 0E 0D 0B 0C 00
0xA0: 0A 0A 0A 0A 0A 0A
0xA1: 0A 05 0A 11 0C 0D
0xA2: 0A 07 0D 0B 0A 0A
```

---

## Protocol Command Example

To set "Treble Boost" preset:

```
TX: 3E 0C 01 00 00 00 04 58 00 10 00 [checksum] 3C
    │  │  │           │  │  │  │  │   │
    │  │  │           │  │  │  │  │   └─ Footer
    │  │  │           │  │  │  │  └───── Checksum
    │  │  │           │  │  │  └──────── Preset ID (0x10)
    │  │  │           │  │  └─────────── Flag
    │  │  │           │  └────────────── Command (0x58 = SET_PARAM)
    │  │  │           └───────────────── Payload length
    │  │  └───────────────────────────── Sequence/flags
    │  └──────────────────────────────── Packet type (0x0C = command)
    └─────────────────────────────────── Header

Expected RX: 3E 0C 01 00 00 00 0A 59 00 10 06 09 0A 0F 11 11 13 [checksum] 3C
             │                    │        └──────────────────┘
             │                    │        Band values (6 bytes)
             │                    └─────── Command (0x59 = NTFY_PARAM)
             └──────────────────────────── Acknowledgment with EQ values
```

---

## Notes

1. **Custom 2** preset was not captured - may require manual EQ adjustment to trigger
2. Some preset IDs (0x01-0x0F) appear unused in the capture
3. Preset 0xA0 (Manual) starts flat and allows user adjustment
4. Speech preset (0x17) aggressively cuts bass and treble for vocal clarity
5. Mellow preset (0x13) has the most dramatic reduction across all frequencies

---

**Captured:** 2026-02-08
**Device:** Sony WH-1000XM5
**Method:** Frida dynamic instrumentation on Android
**App:** Sony Sound Connect (com.sony.songpal.mdr)
