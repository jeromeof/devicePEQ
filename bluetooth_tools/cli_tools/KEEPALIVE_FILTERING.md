# Keepalive Packet Filtering

## Overview
Bluetooth apps often send periodic "keepalive" or "heartbeat" packets to maintain the connection. These packets don't contain useful protocol information and clutter the capture output.

The toolkit now supports filtering these packets in real-time during capture.

## Keepalive Patterns Detected

### Airoha TX Keepalive (App → Device)
```
05 5A 06 00 00 0A XX E4 E8 03
```
- Fixed pattern except byte 6 (XX) which increments
- 10 bytes total
- Sent periodically by app

### Airoha RX Keepalive (Device → App)
```
05 5B 02 00 00 0A 03
```
- Completely fixed pattern
- 7 bytes total
- Response to TX keepalive

## Usage

### With bluetooth_toolkit.py (Recommended)
```bash
# Capture with keepalive filtering
bluetooth_toolkit.py capture com.audeze.app --airoha --filter-keepalive

# Short form
bluetooth_toolkit.py capture com.audeze.app --airoha -f

# With output file
bluetooth_toolkit.py capture com.audeze.app --airoha -f -o capture.txt
```

### With capture_bluetooth.py (Direct)
```bash
# Filter keepalive packets during capture
python3 capture_bluetooth.py com.audeze.app --airoha --filter-keepalive

# Short form
python3 capture_bluetooth.py com.audeze.app --airoha -f
```

### Post-Processing (For Old Captures)
```bash
# Filter an existing capture file
python3 filter_airoha_capture.py input.txt output.txt

# View filtered output without saving
python3 filter_airoha_capture.py input.txt | less
```

## Benefits

### Without Filtering
- Capture contains ~147 packets
- Keepalive packets (~12) mixed with EQ commands
- Harder to spot important protocol changes
- More scrolling and visual noise

### With Filtering
- Only ~135 interesting packets shown
- Focus on EQ, ANC, and control commands
- Easier to correlate UI actions with packets
- Cleaner output for analysis

## Captured Statistics Example
```
Total packets: 147
Keepalive packets removed: 12
Interesting packets: 135
```

## When to Use Filtering

**Use --filter-keepalive when:**
- Capturing EQ/PEQ changes
- Analyzing preset switches
- Looking for specific commands
- You want cleaner, more readable output

**Don't use filtering when:**
- You need to verify connection timing
- Debugging connection issues
- Analyzing keepalive intervals
- You want to see EVERYTHING

## Implementation Details

The filter works by:
1. **JavaScript level**: Frida script detects keepalive patterns before logging
2. **Pattern matching**: Checks exact byte sequences for TX/RX keepalives
3. **Zero overhead**: Filtered packets are never logged, saving capture file size

## Testing

Run the test suite to verify filter patterns:
```bash
python3 test_keepalive_filter.py
```

Should output:
```
✅ All tests passed!
```

## See Also
- `AIROHA_EQ_PROTOCOL_FINDINGS.md` - Protocol analysis findings
- `filter_airoha_capture.py` - Post-processing filter for old captures
- `frida_airoha.js` - Frida script with filter implementation
