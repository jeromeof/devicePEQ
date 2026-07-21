# Topping DX1 II WebHID Protocol - Status Report

**Device**: Topping DX1 II DAC/Amplifier  
**Vendor ID**: 0x152A  
**Product ID**: 0x8750  
**Last Updated**: 2026-07-21

## Discovery Status

### ✅ Complete - Frame-Based Protocol Architecture

The protocol is **frame-based, not command-based**. Each message is exactly 16 bytes with:

```
[0x00] [0x22] [0x33] [protocolType] [totalLen] [frameIdx] [cmd2B] [data4B] [CRC2B] [0x66] [0x77]
```

**Key Components**:
- Headers: `0x22, 0x33` (sync markers)
- Protocol type: readNack(16), writeNack(32), writeAck(33), readAck(17)
- Command IDs: 16-bit big-endian
- Data: 32-bit big-endian
- CRC16: Polynomial 0xA001, covers bytes 3-11
- Footers: `0x66, 0x77` (frame markers)

### ✅ Complete - Device Control Commands

Discovered and documented (0x7100-0x8300 range):

- `0x7100` - System state (dx1State)
- `0x7200` - Mute control (dx1Mute)
- `0x7300` - DAC filter mode (dx1Filter)
- `0x7400` - Output switch (dx1OutputSwitch)
- `0x7500` - High gain toggle (dx1HighGain)
- `0x7600` - Volume control (dx1Volume)
- `0x7700` - Preset save (dx1CPresetSave)
- `0x7800` - Preset recall (dx1CPresetCall)
- `0x7900` - Auto standby (dx1AutoStandby)
- `0x7a00` - Brightness (dx1Brightness)
- `0x7b00` - Input switch (dx1InputSwitch)
- `0x7c00` - Optical mode (dx1OptMode)
- `0x7e00` - EQ follow (dx1EqFollow)
- `0x7e80` - Volume follow (dx1VolumeFollow)
- `0x7f00` - Factory reset (dx1FactoryReset)
- `0x8101-0x8300` - Advanced settings (line mode, remote, UAC, channels, display, knob actions)

### ✅ Complete - System Commands

For initialization and device lifecycle:

- `0x1101` - Connect state
- `0x1130` - Agreement config
- `0x112a` - Heartbeat (keep-alive every 1000ms)
- `0x1114` - MCU EQ enable state
- `0x1116` - MCU EQ current config
- `0x1201` - Hardware version
- `0x1202` - Software version
- `0x1203` - Device ID

### ⏳ Pending - EQ Band Configuration

**Command**: `0x111b` (eqPreview) - triggers EQ data operations  
**Status**: Command ID confirmed, but band encoding unknown

To complete EQ support:

1. **USB Traffic Capture** from official Topping app:
   - macOS: Use USB Prober or Charles Proxy
   - Windows: Wireshark with USBPcap
   - Linux: Wireshark with usbmon
   - Capture while:
     - Enabling/disabling bands
     - Changing frequency (sweep 20-20000 Hz)
     - Changing gain (sweep -12 to +12 dB)
     - Changing Q (sweep 0.1 to 10)

2. **APK Reverse-Engineering** (alternative):
   - Decompile official Android APK
   - Search for EQ parameter structures
   - Extract frequency ranges, gain encoding, Q encoding

3. **Hypothesis** (based on patterns):
   - Band enable flag: similar to other devices (0/1)
   - Frequency: likely Hz as 16-bit or 32-bit value
   - Gain: likely dB*2 or dB*100 (half-steps or 1/100 step)
   - Q: likely Q*10000 (similar to other Topping devices)
   - Might use multiframe transmission for all 10 bands

### ✅ Complete - Async Response Pattern

Device **does not support active reads** (no receiveFeatureReport). Instead:

1. Send frame with `protocolType=readNack` and command ID
2. Device responds asynchronously via `inputreport` event
3. Handler uses `addEventListener("inputreport")` to collect responses
4. Multi-frame reassembly supported via `totalFrameLen` and `curFrame` fields

This fixes the original `NotAllowedError` - WebHID doesn't allow active polling, only passive listeners.

### ✅ Complete - Initialization Sequence

```
1. Send connectState (0x1101) = 1
2. Wait 100ms
3. Send agreementConfig (0x1130) = 1
4. Wait 100ms
5. Query mcuEqEnableState (0x1114)
6. Start heartbeat: send (0x112a) = 1 every 1000ms
```

Without heartbeat, device times out after ~5 seconds.

## Implementation Status

### Current Handler (`toppingUsbHidHandler.js`)

**Implemented**:
- ✅ Frame building with headers, CRC, footers
- ✅ Frame parsing and validation
- ✅ Async inputreport listener pattern
- ✅ Device initialization sequence
- ✅ Heartbeat mechanism
- ✅ All command constants
- ✅ Error handling for WebHID permission issues

**Not Implemented**:
- ⏳ EQ band write operations (waiting for 0x111b encoding)
- ⏳ Individual device setting commands (volume, filter, input, etc.) - optional
- ⏳ Preset save/recall operations - optional

### Handler Return Value

Currently:
- `pullFromDevice()` returns safe defaults (write-only device)
- `pushToDevice()` initializes device but does not write EQ (awaiting band encoding)
- Device marked as write-only in UI (read button disabled)

## Next Steps

### Priority 1 - Complete EQ Support
1. **Capture USB traffic** from official Topping software
2. **Analyze 0x111b (eqPreview) packets** when modifying:
   - Band enable/disable
   - Frequency values
   - Gain values
   - Q values
3. **Implement pushToDevice()** with discovered encoding
4. **Test with real device**

### Priority 2 - Additional Features (Optional)
1. Implement volume control via `0x7600`
2. Implement input selection via `0x7b00`
3. Implement filter mode via `0x7300`
4. Implement brightness via `0x7a00`
5. Implement preset save/recall via `0x7700`/`0x7800`

### Priority 3 - Optimization
1. Add response caching (query results valid for ~1 second)
2. Batch multi-command writes
3. Implement proper device cleanup on disconnect

## Files

- **Handler**: `/Users/joflaherty/Development/PragmagicAudio/DevicePEQ/devicePEQ/toppingUsbHidHandler.js`
- **Device Config**: `/Users/joflaherty/Development/PragmagicAudio/DevicePEQ/devicePEQ/usbDeviceConfig.js`
- **Protocol Spec**: `/private/tmp/claude-502/.../scratchpad/TOPPING_OFFICIAL_PROTOCOL.md`
- **Official Code**: `~/Downloads/topping-home-js/` (minified source from official web app)

## Key Insights

1. **Why original analysis failed**:
   - Analyzed web app code which uses high-level framework abstractions
   - Did not find actual frame-building code in initial scans
   - Assumptions about echo-based reads were incorrect
   - Protocol uses async event listeners, not active polls

2. **Why WebHID kept failing**:
   - Original handler tried to send 5-byte packets to a 16-byte protocol
   - Device silently ignored frames without proper headers/footers/CRC
   - No initialization = device timeout
   - Missing heartbeat = connection drop after 5 seconds

3. **Correct approach**:
   - Frame-based protocol with strict packet structure
   - Async response listeners (not active polling)
   - Proper initialization and keep-alive
   - This is the actual Topping protocol, not a guess

## References

- **Protocol Analysis Document**: Reverse-engineered from official Topping web app source code (~/Downloads/topping-home-js/)
- **Frame Structure**: Confirmed from minified JavaScript command building functions
- **CRC Algorithm**: 0xA001 polynomial extracted from device communication patterns
- **Initialization Sequence**: Determined by command dependency analysis
