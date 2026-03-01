# Airoha PEQ Packet Format (Command 0x5BBD)

## Packet Structure

### Header (5 bytes)
```
Byte 0:    0x05          - Protocol header
Byte 1:    0x5B          - Packet type
Byte 2:    0xBD          - Command (PEQ data)
Bytes 3-4: 0x0000        - Length field (little-endian, often 0)
```

### Payload Header (8 bytes)
```
Byte 5:    0x0A          - Number of PEQ bands (10 decimal)
Byte 6:    0xB9          - Unknown (constant)
Byte 7:    0x00          - Unknown
Byte 8:    0x00/0x01     - EQ Status (0x00=disabled, 0x01=enabled)
Bytes 9-12: 0x00000000   - Unknown/padding
```

### Filter Data (18 bytes per filter × 10 filters = 180 bytes)

Each filter has the following 18-byte structure:

```
Bytes 0-1:   Type/Status
             - Byte 0: 0x01 (filter type)
             - Byte 1: 0x02 (filter status)

Bytes 2-5:   Frequency (uint32, little-endian)
             - Units: 0.01 Hz
             - Example: 0x00000C80 = 3200 = 32.0 Hz

Bytes 6-9:   Gain (int32, little-endian)
             - Units: 0.01 dB
             - Example: 0x000000C8 = 200 = +2.0 dB
             - Example: 0xFFFFFED4 = -300 = -3.0 dB

Bytes 10-13: Bandwidth (uint32, little-endian)
             - Units: 0.01 Hz
             - Appears to be frequency/2 (half the center frequency)
             - Example: 0x00000640 = 1600 = 16.0 Hz (for 32 Hz filter)

Bytes 14-17: Q Factor (uint32, little-endian)
             - Units: 0.01
             - Example: 0x000000C8 = 200 = Q of 2.0
             - Consistently set to 2.0 in captured packets
```

## Standard 10-Band EQ Frequencies

The device uses a standard 10-band graphic EQ with the following frequencies:

| Filter | Frequency | Raw Value (0.01 Hz) |
|--------|-----------|---------------------|
| 0      | 32 Hz     | 3200                |
| 1      | 64 Hz     | 6400                |
| 2      | 125 Hz    | 12500               |
| 3      | 250 Hz    | 25000               |
| 4      | 500 Hz    | 50000               |
| 5      | 1000 Hz   | 100000              |
| 6      | 2000 Hz   | 200000              |
| 7      | 4000 Hz   | 400000              |
| 8      | 8000 Hz   | 800000              |
| 9      | 16000 Hz  | 1600000             |

## Example Packets

### Packet 1: Filter 0 (32Hz) set to +2dB, EQ enabled
```
05 5B BD 00 00 0A B9 00 01 00 00 00 00
01 02 80 0C 00 00 C8 00 00 00 40 06 00 00 C8 00 00 00
01 02 00 19 00 00 00 00 00 00 80 0C 00 00 C8 00 00 00
...
```

Key differences:
- Byte 8: `0x01` (EQ enabled)
- Filter 0 Gain: `C8 00 00 00` = +2.0 dB

### Packet 2: All filters at 0dB, EQ disabled
```
05 5B BD 00 00 0A B9 00 00 00 00 00 00
01 02 80 0C 00 00 00 00 00 00 40 06 00 00 C8 00 00 00
01 02 00 19 00 00 00 00 00 00 80 0C 00 00 C8 00 00 00
...
```

Key differences:
- Byte 8: `0x00` (EQ disabled)
- Filter 0 Gain: `00 00 00 00` = 0.0 dB

## Raw Value Encoding

### To encode frequency (Hz → raw):
```
raw_value = frequency_hz * 100
```

### To encode gain (dB → raw):
```
raw_value = gain_db * 100
```

### To decode frequency (raw → Hz):
```
frequency_hz = raw_value / 100.0
```

### To decode gain (raw → dB):
```
gain_db = raw_value / 100.0
```

Note: Gain is a signed 32-bit integer, so negative values use two's complement representation.

## Observations

1. The EQ enable/disable state is controlled by byte 8 in the payload header
2. All 10 filter parameters are always sent, even if only one filter is changed
3. Q factor appears to be fixed at 2.0 for all filters
4. Bandwidth appears to be set to frequency/2 for all filters
5. The packet length is fixed at 193 bytes total
6. Each filter is 18 bytes, and there are always 10 filters (180 bytes of filter data)
