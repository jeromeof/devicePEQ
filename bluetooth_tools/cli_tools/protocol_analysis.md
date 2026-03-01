# Maxwell EQ Protocol Analysis - RFCOMM Data

## Key Findings

### Packet Format
All packets have prefix: `055X` where X indicates direction:
- `055a` = Command (Phone → Maxwell)
- `055b` = Response (Maxwell → Phone)
- `055d` = Notification (Maxwell → Phone)

### Known Commands Identified

#### 1. EQ Preset Commands (Line 13, 16)
```
Command:  055a 04 00 01092b00
          ^^^^ ^^ ^^ ^^^^^^^^
          Hdr  Ln ?? Command+Params

Pattern: 0400 0109 XXXX
- 0400 = Length (4 bytes)
- 0109 = Command ID (GET EQ)
- 2b00 = Parameter (preset ID?)
```

**Response (Line 15):**
```
055b 06 00 01092b00 0001
         ^^^^^^^^^ ^^^^
         Cmd Echo  Data (preset=1?)
```

#### 2. Control Commands (Lines 28-32)
```
Command:  055a 04 00 832c 0700
Pattern: 0400 832c 07|0b 00

- 832c 0700 = Get Sidetone (from source line 136)
- 832c 0b00 = Get Game/Chat Mix (from source line 66)
```

**Responses:**
```
055b 06 00 832c0007 0000  (Sidetone = 0)
055b 06 00 832c000b 000a  (Game/Chat = 10)
```

#### 3. Device Info (Line 4)
```
055b 12 00 000a0e00 4142313536385f48656164736574
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                    ASCII: "AB1568_Headset"
```

### Protocol Structure

```
[Prefix][Length][Flags][Command ID][Parameters][Checksum?]
  055X    2B      2B      2-4B         N bytes     Optional
```

### Command Summary

| Packet# | Direction | Command | Decoded |
|---------|-----------|---------|---------|
| 4728 | TX | 055a0600000a0210e803 | Init command? |
| 4755 | RX | 055b1200000a0e00... | Device name: AB1568_Headset |
| 4758 | TX | 055a0600000a0110e803 | Init command? |
| 4842 | TX | 055a040001092b00 | GET EQ (param 0x2b) |
| 4858 | RX | 055b060001092b000001 | EQ Response (value=1) |
| 4859 | TX | 055a040001092d00 | GET EQ (param 0x2d) |
| 4873 | RX | 055b060001092d00001f | EQ Response (value=31) |
| 5037 | TX | 055a02001009 | GET ? (cmd 1009) |
| 5049 | RX | 055b0c001009000500ff... | Response with data |
| 5124 | TX | 055a040001092c00 | GET EQ (param 0x2c) |
| 5136 | RX | 055b060001092c000001 | EQ Response (value=1) |
| 5224 | TX | 055a040001092200 | GET EQ (param 0x22) |
| 5241 | RX | 055b0600010922000000 | EQ Response (value=0) |
| 5330 | TX | 055a0400832c0700 | GET Sidetone |
| 5355 | RX | 055b0600832c00070000 | Sidetone = 0 |
| 5426 | TX | 055a0400832c0b00 | GET Game/Chat |
| 5445 | RX | 055b0600832c000b000a | Game/Chat = 10 |

### EQ Command Pattern Analysis

The app sent multiple `0109` commands with different last bytes:
- `01092b` → Response: 01 (preset ID?)
- `01092d` → Response: 1f (31 decimal)
- `01092c` → Response: 01
- `010922` → Response: 00

**Theory:** These might be reading individual EQ band values or preset parameters.

### Missing: Full EQ Data

**NOT YET SEEN in this capture:**
- Full EQ payload with all 10 bands
- SetEQSetting command with AirohaEQPayload
- Individual band updates
- Q factor values
- Filter type parameters

### Next Steps

1. **Need more complete capture** with:
   - EQ slider adjustments
   - Preset changes
   - Custom EQ save

2. **Look for larger packets** (70+ bytes) that would contain:
   - 10 bands × (frequency + gain + Q + type) = ~80 bytes
   - Plus header/sample rates = ~100+ bytes total

3. **Decode the 0109 sub-commands:**
   - What do 2b, 2d, 2c, 22 represent?
   - Are these reading EQ bands 0-9?
   - Or preset metadata?

## Command Reference (From Source)

| Command Hex | Purpose | Source Line |
|-------------|---------|-------------|
| 0400 0109 | Get EQ Preset | AirohaHeadsetEqualizerImpl.java:68 |
| 0400 832C 0700 | Get Sidetone | AirohaHeadsetControlsManagerImpl.java:136 |
| 0400 832C 0B00 | Get Game/Chat | AirohaHeadsetControlsManagerImpl.java:66 |

## Recommendations

1. **Perform full EQ operations** and recapture:
   - Move multiple sliders significantly
   - Save custom preset
   - This should trigger SetEQSetting with full payload

2. **Check packets > 100 bytes** in capture:
   ```bash
   cat rfcomm_channel21_data.txt | awk 'length($5) > 100'
   ```

3. **Decode payload structure** using known AirohaEQPayload format
