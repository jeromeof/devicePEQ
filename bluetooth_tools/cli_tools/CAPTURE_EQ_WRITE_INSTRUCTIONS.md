# Capturing Edifier W830NB EQ Write Commands

## Objective
Capture the exact protocol the Edifier ConnectX app uses to write custom EQ filters to verify our implementation.

## Setup

### 1. Prepare Frida on Android
```bash
# Make sure frida-server is running on your rooted Android phone
adb shell "su -c /data/local/tmp/frida-server &"
```

### 2. Find the Edifier App Package
```bash
# List running apps to find the exact package name
adb shell pm list packages | grep -i edifier
# Common names: com.edifier.connect, com.edifier.connectx
```

### 3. Start Frida Capture
```bash
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools

# Start Frida with the Edifier script
frida -U -f com.edifier.connect -l frida_edifier.js --no-pause

# OR if app is already running:
frida -U com.edifier.connect -l frida_edifier.js
```

## Capture Sequence

### Test 1: Write Single Band (Command 0x44)
1. **In Frida**: Start capture
2. **In Edifier App**:
   - Go to EQ settings
   - Select "Custom EQ" mode
   - Modify **ONE band only**:
     - Band 0
     - Set frequency to 100 Hz
     - Set gain to +3 dB
     - Note the Q value
   - Save/Apply the change
3. **In Frida**: Look for packets with command `0x44` (68)

### Test 2: Write Different Band Values
Repeat Test 1 with:
- Band 0: 1000 Hz, +6 dB
- Band 1: 250 Hz, -3 dB
- Band 5: 8000 Hz, 0 dB

### Test 3: Write Full Profile (Command 0x46)
1. **In Edifier App**:
   - Create a completely new custom EQ profile
   - Set all 6 bands to specific values
   - Name the profile "TEST123"
   - Save the profile
2. **In Frida**: Look for packets with command `0x46` (70)

## What to Look For

### Expected Packet Structure for Single Band (0x44)
```
Header: AA (TX to device) or BB
AppCode: EC
Command: 44 (68 decimal)
Length: 00 06 (6 bytes payload)
Payload: [6 bytes of band data]
CRC: [calculated]
```

### Questions to Answer
1. **Is offset encoding (0xA0) used?**
   - YES: Values like A5, A6, E0 appear
   - NO: Raw values like 05, 06, 40 appear

2. **What is the exact byte order for frequency?**
   - Big-endian: [High byte] [Low byte]
   - Little-endian: [Low byte] [High byte]

3. **How is gain encoded?**
   - Scale: 0-12 where 6 = 0dB?
   - Range: Can you set -6dB to +6dB?

4. **What header is used for TX?**
   - 0xAA or 0xBB?

## Example Expected Output

```
📤 SPP TX: 12 bytes
Hex: AA EC 44 00 06 [B0] [B1] [B2] [B3] [B4] [B5] [CRC]
     │  │  │  │  │   │   │   │   │   │   └─ Byte 5: Q value
     │  │  │  │  │   │   │   │   │   └───── Byte 4: Gain
     │  │  │  │  │   │   │   └───┴─────── Bytes 2-3: Frequency
     │  │  │  │  │   │   └─────────────── Byte 1: Filter type
     │  │  │  │  │   └─────────────────── Byte 0: Band index
     │  │  │  └──┴───────────────────── Length: 6 bytes
     │  │  └────────────────────────── Command: 0x44
     │  └───────────────────────────── AppCode: 0xEC
     └──────────────────────────────── Header: 0xAA
```

## Save the Output

```bash
# Redirect Frida output to file
frida -U com.edifier.connect -l frida_edifier.js > edifier_eq_write_capture.txt 2>&1
```

## Analysis After Capture

Run this to extract only the EQ write commands:
```bash
grep -A 5 "Command: 0x44\|Command: 0x46" edifier_eq_write_capture.txt > eq_write_commands.txt
```
