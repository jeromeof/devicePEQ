# EQ Change Capture Analysis

## Summary

Analyzed `eq_change.txt` capture file (2586 lines, 156 packets total)

**IMPORTANT**: Keepalive filtering is ENABLED in this capture, which may have hidden the actual "set filter" commands that changed the PEQ values. The analysis below focuses on the query/response traffic that remained visible.

## Key Findings

### 1. "Keepalive-like Packets" Root Cause

The excessive packet traffic is caused by **TWO** types of repeated polling:

#### A. Command 0x6 Polling Bursts
- **Frequency**: 24 TX + 21 RX = 45 total packets
- **Pattern**: Sent in long bursts of 8+ consecutive packets
- **Payload examples**:
  - `05 5A 06 00 00 0A 01 E4 E8 03` - Query filter 1
  - `05 5A 06 00 00 0A 02 E4 E8 03` - Query filter 2
  - `05 5A 06 00 00 0A 00 EF E8 03` - Query filter 0
  - Pattern: `00 0A [filter_id] [value] E8 03`
- **Structure**:
  - Bytes 5-6: `00 0A` (constant header)
  - Byte 7: Filter ID (`00`, `01`, `02`, `10`, `11`, `12`, `13` - suggests L/R channels)
  - Byte 8: Value (`E4` or `EF`)
  - Bytes 9-10: `E8 03` (constant)

#### B. Status Polling Loop
- **Pattern** (repeats 4-5 times):
  ```
  0x3 (Connect Status) ->
  0x2 (Battery Status) ->
  0x4 -> 0x4 -> 0x4 -> 0x4
  ```
- This 6-command sequence repeats throughout the capture

#### C. Command 0xBD PEQ Status Broadcasts
- **CRITICAL FINDING**: Each TX command 0x6 query triggers a 193-byte RX command 0xBD response!
- **Count**: 16 RX packets from device (triggered by command 0x6 queries)
- **Size**: 193 bytes each = 3,088 bytes of redundant PEQ data
- **Root cause**: The app sends command 0x6 in bursts (8-20 packets), each triggering a full PEQ dump
- **Impact**: 193 bytes × 16 responses = massive bandwidth waste

### 2. PEQ Packet Structure (Command 0xBD)

**Protocol**: `05 5A/5B BD 00 [length] 0A [header] [filter data...]`

**Payload Structure**:
- Byte 0: Length low byte
- Byte 1: `0A` (constant)
- Byte 2: `00` or `B9` (varies)
- Byte 3: `EF` or `00` (varies)
- Byte 4: Preset number? (`00`, `01`)
- Bytes 5-8: Reserved (00 00 00 00)
- Bytes 9+: Filter data (18 bytes per filter)

**Filter Structure** (18 bytes each):
```
Byte 0:    Enabled (0x01)
Byte 1:    Type (0x02 = PEQ)
Bytes 2-5:  Frequency (32-bit LE, centihertz)
Bytes 6-9:  Gain (32-bit LE signed, centibels = 0.01 dB)
Bytes 10-13: Q factor (32-bit LE, centi-Q = 0.01 Q)
Bytes 14-17: Parameter (0xC8 = 200, purpose unknown)
```

### 3. Decoded PEQ States Found

#### State 1 (Line 420) - Preset 1 Active
```
Filter 0 (32Hz):    +6.00 dB, Q=16.00
Filters 1-9:        0.00 dB (flat)
Header byte 4: 0x01 (preset 1?)
```

#### State 2 (Lines 484, 772, etc.) - All Flat
```
All filters:        0.00 dB (flat)
Header byte 4: 0x00 (preset 0?)
```

#### State 3 (Lines 548, 836, 2362, 2490) - Sloped EQ Curve
```
Filter 0 (32Hz):    -3.00 dB
Filter 1 (64Hz):    -2.00 dB
Filter 2 (125Hz):   -1.00 dB
Filter 3 (250Hz):    0.00 dB
Filter 4 (500Hz):   +2.00 dB
Filter 5 (1kHz):    +4.00 dB
Filter 6 (2kHz):    +6.00 dB
Filter 7 (4kHz):    +8.00 dB
Filter 8 (8kHz):     0.00 dB
Filter 9 (16kHz):    0.00 dB
Header byte 4: 0x00
```

**Note**: The user reported changing "filter 1 to +3dB" but the capture shows a sloped EQ curve instead. This suggests:
- The UI might be showing a different preset than expected
- OR the slider changes triggered a preset switch
- OR the app is interpreting the PEQ data differently

### 4. Other EQ-Related Commands

- **Command 0x4F** (1 TX): Large multi-preset EQ dump (contains 3 presets worth of data)
- **Command 0x50** (1 TX): Audio Settings - similar to 0x4F
- **Command 0x4A** (1 TX): Memory/register map? Contains `E4` address patterns
- **Command 0x16** (1 TX, 16 RX): Query/response for some EQ parameter

### 5. Why So Many Packets?

**The polling loop is too aggressive:**

1. **Command 0x6 queries** - Being sent in bursts of 8-20 packets at a time
   - These query individual filter states
   - Sent repeatedly even when no changes occur

2. **Command 0xBD broadcasts** - Device sends full PEQ state 16 times
   - 193 bytes × 16 = 3,088 bytes of redundant PEQ data
   - Sent even when PEQ hasn't changed

3. **Status polling** - The 0x3 -> 0x2 -> 0x4 sequence repeats 4-5 times
   - This is the basic keepalive pattern

### 6. Root Cause: Command 0x6 Triggers Command 0xBD

**The smoking gun**:
- TX command 0x6 → Device responds with RX command 0xBD (full 193-byte PEQ config)
- App sends command 0x6 in bursts of 8-20 packets
- **Each command 0x6 query = 193-byte response = bandwidth explosion!**

**Evidence from capture**:
```
Line 420: Last TX 0x6 query → Immediate RX 0xBD response
Line 484: Last TX 0x6 query → Immediate RX 0xBD response
Line 548: Last TX 0x6 query → Immediate RX 0xBD response
...pattern repeats 16 times!
```

### 7. Recommended Fixes

#### Immediate Fix: Stop Command 0x6 Polling
1. **Remove the command 0x6 burst queries**
   - Currently sending 24 queries in quick succession
   - Each triggers a 193-byte response
   - Total waste: 24 × 193 = 4,632 bytes

2. **Use command 0xBD for initial state only**
   - Send once when opening EQ tab
   - Listen for unsolicited 0xBD broadcasts from device (if any)

3. **Alternative: Use command 0x16**
   - Appears to be a more targeted query (26 bytes vs 193 bytes)
   - Investigate if this can replace 0x6 queries

#### Long-term Fix: Event-Driven Architecture
1. **Query once on tab open**
   - Send single command to get current PEQ state
   - Don't poll continuously

2. **Listen for device-initiated updates**
   - Device may send 0xBD when PEQ changes
   - No need to poll if device pushes updates

3. **Reduce status polling interval**
   - The 0x3 -> 0x2 -> 0x4 sequence repeats 4-5 times
   - Should only run once per connection or on-demand

### 8. Missing Data Due to Filtering

**The actual EQ change commands are NOT visible in this capture!**

The capture shows:
- Initial state: Preset 1 with +6dB on filter 0 (line 420)
- Changed state: Sloped EQ curve with multiple filters modified (line 548)
- Final state: Back to flat 0dB (line 612+)

**However**: No TX "set filter" commands are visible between these state changes. This indicates:
1. The keepalive filter might be too aggressive and hiding EQ write commands
2. OR the device changes presets internally without explicit set commands
3. OR the commands use a pattern that the filter recognizes as keepalive

**To find the actual EQ change commands**: Disable keepalive filtering and recapture the session.

### 9. Command 0x6 Byte Analysis

Pattern observed:
- `05 5A 06 00 00 0A [filter_id] [E4/EF] E8 03`

**E4 vs EF pattern**:
- `E4` (0xE4 = 228): Sent for filter IDs `01`, `02` only
- `EF` (0xEF = 239): Sent for filter IDs `00-03`, `10-13` (all filters, L+R channels?)

**Hypothesis**:
- `E4` might mean "query modified filters"
- `EF` might mean "query all filters" or represent a different preset
- Or these are preset identifiers (preset 228 vs preset 239)

The `10-13` filter IDs suggest stereo operation (10=right channel filter 0, 11=right channel filter 1, etc.)
