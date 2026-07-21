# SoundPeats H3 BLE Protocol

**Chip SDK**: Jieli (捷力) — same SDK family as many Chinese TWS earbuds  
**Status**: Connection confirmed from APK reverse engineering; EQ payload format needs live capture to verify.

## BLE UUIDs

| Role    | UUID |
|---------|------|
| Service | `0000ae00-0000-1000-8000-00805F9B34FB` |
| Write (TX) | `0000ae01-0000-1000-8000-00805F9B34FB` |
| Notify (RX) | `0000ae02-0000-1000-8000-00805F9B34FB` |
| CCCD | `00002902-0000-1000-8000-00805f9b34fb` |

## Packet Format

```
FF 04 00 [len] [sub0] [sub1] [cmdHi] [cmdLo] [payload...]
                ╰─────────╯         ╰──────────────╯
                Standard: 00 0A     EQ: 00 28
```

Response packets follow the same structure (same cmd code, payload = data).

## Key Command Codes

| Name | Decimal | Hex | Notes |
|------|---------|-----|-------|
| GET_LEFT_BATTERY | 774 | 0x0306 | payload[0] = % |
| GET_RIGHT_BATTERY | 775 | 0x0307 | payload[0] = % |
| GET_FIRMWARE | 777 | 0x0309 | ASCII string |
| GET_IN_EAR | 780 | 0x030C | |
| GET_GAME_MODE | 782 | 0x030E | |
| GET_ANC_MODE | 784 | 0x0310 | 0=Normal 1=ANC 2=Transparency 3=Wind |
| GET_CASE_BATTERY | 803 | 0x0323 | payload[0] = % |
| GET_DYNAMIC_EQ | 817 | 0x0331 | |
| SET_DYNAMIC_EQ | 818 | 0x0332 | |
| GET_DYNAMIC_BASS | 828 | 0x033C | |
| **MODIFY_EQ_V1** | **3585** | **0x0E01** | EQ write/query (gain only?) |
| **MODIFY_EQ_V2** | **3586** | **0x0E02** | EQ write/query (full bands) |

## EQ Payload Format (to be confirmed by live capture)

### V1 (0x0E01)
Simple gain-only format — 1 signed byte per band (raw dB).

### V2 (0x0E02) — best guess
5 bytes per band:
```
[bandId(1B)] [gain_int16_BE] [q_int16_BE]
```
- `gain_int16 = round(dB × 10)` 
- `q_int16 = round(Q × 100)`, default Q = 1.41

**Important**: Send empty payload (len=0) to *query* the current EQ; send populated payload to *set*.

## Tools

- **Browser**: `webtools/soundpeats-h3-controller.html` — full UI with EQ sliders
- **CLI**: `cli_tools/soundpeats_h3_cli.py` — scan, probe, read/write EQ

## Usage

```bash
# Scan
python3 soundpeats_h3_cli.py --scan

# Probe device info
python3 soundpeats_h3_cli.py --address XX:XX:XX:XX:XX:XX --probe

# Read current EQ
python3 soundpeats_h3_cli.py --address XX:XX:XX:XX:XX:XX --read-eq

# Write flat EQ
python3 soundpeats_h3_cli.py --address XX:XX:XX:XX:XX:XX --flat

# Write custom EQ (11 bands)
python3 soundpeats_h3_cli.py --address XX:XX:XX:XX:XX:XX --write-eq 3 2 1 0 0 0 0 -1 -2 -1 0
```

## Next Steps

1. Run `soundpeats_h3_cli.py --probe` to confirm Jieli protocol responds
2. Run `--read-eq` to capture the EQ payload and verify decode strategy
3. If no response on ae00/ae01/ae02, check Actions GATT UUIDs (00001100-D102-11E1-9B23-00025B00A5A5)
4. Once payload format confirmed, implement DevicePEQ handler
