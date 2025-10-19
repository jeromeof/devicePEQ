# Test Results - FiiO K13 R2R

**Device Info:**
- Model: FiiO K13 R2R
- Vendor ID: 0x2972 (FiiO)
- Product ID: TBD (to be determined during testing)
- Firmware Version: TBD

---

## Configuration Added

### Device Configuration
```javascript
"FIIO K13 R2R": {
  modelConfig: {
    minGain: -12,
    maxGain: 12,
    maxFilters: 10,
    firstWritableEQSlot: 7,
    maxWritableEQSlots: 3,
    disconnectOnSave: false,
    disabledPresetId: 11,
    reportId: 1,
    availableSlots: [
      {id: 0, name: "Jazz"},
      {id: 1, name: "Pop"},
      {id: 2, name: "Rock"},
      {id: 3, name: "Dance"},
      {id: 5, name: "R&B"},
      {id: 6, name: "Classic"},
      {id: 7, name: "Hip-hop"},
      {id: 4, name: "USER1"},
      {id: 8, name: "USER2"},
      {id: 9, name: "USER3"}
    ]
  }
}
```

**Configuration Notes:**
- Based on FiiO Q7 configuration (similar desktop DAC/AMP)
- Uses FiiO USB HID handler (`fiioUsbHidHandler.js`)
- Supports 10-band parametric EQ
- Includes 7 preset slots + 3 user-writable slots
- Supports LSQ/HSQ filters for advanced shelving EQ
- Supports global pregain control

---

## Test Checklist

### ✅ Basic Connectivity
- [ ] Device is recognized when connected via USB
- [ ] Device name displays as "FIIO K13 R2R"
- [ ] Manufacturer shows as "FiiO"
- [ ] WebHID successfully opens connection
- [ ] Device info can be retrieved (firmware version, model)

### ✅ Pull Operations (Read from Device)
- [ ] Can read current EQ settings from device
- [ ] All 10 filter bands are retrieved correctly
- [ ] Filter parameters are accurate (freq, gain, Q)
- [ ] Pregain value is read correctly
- [ ] Current slot/preset is identified correctly
- [ ] Filter types (PK/LSQ/HSQ) are detected correctly

### ✅ Push Operations (Write to Device)
- [ ] Can write new EQ settings to device
- [ ] Changes are audible in audio output
- [ ] All 10 filter bands can be modified
- [ ] Pregain adjustments work correctly
- [ ] Device doesn't disconnect after save
- [ ] Changes persist after reconnection

### ✅ Slot Management
- [ ] Can read from preset slots (Jazz, Pop, Rock, Dance, R&B, Classic, Hip-hop)
- [ ] Can write to USER1 slot (id: 4)
- [ ] Can write to USER2 slot (id: 8)
- [ ] Can write to USER3 slot (id: 9)
- [ ] Slot names display correctly in UI
- [ ] Can switch between slots
- [ ] Disabled preset (id: 11) works correctly

### ✅ Filter Types
- [ ] PK (Peak) filters work correctly
- [ ] LSQ (Low Shelf) filters work correctly
- [ ] HSQ (High Shelf) filters work correctly
- [ ] Can mix different filter types in one preset
- [ ] Filter type changes are applied correctly

### ✅ Parameter Ranges
- [ ] Gain range (-12 to +12 dB) is enforced
- [ ] Minimum gain (-12 dB) works
- [ ] Maximum gain (+12 dB) works
- [ ] Frequency range is reasonable (20 Hz - 20 kHz)
- [ ] Q factor range is appropriate (0.1 - 10)
- [ ] Edge case values are handled correctly

### ✅ Edge Cases & Error Handling
- [ ] Empty EQ (all filters disabled) works
- [ ] All filters at maximum gain
- [ ] All filters at minimum gain
- [ ] Rapid slot switching
- [ ] Device disconnect/reconnect
- [ ] Multiple push/pull cycles
- [ ] Browser refresh while connected

### ✅ Advanced Features
- [ ] Global gain control works
- [ ] Pregain compensation calculation
- [ ] LSQ/HSQ Q factor behavior
- [ ] reportId (1) is correct for this device

---

## Test Procedure

### 1. Basic Test (index.html)
1. Open `http://localhost:8000/index.html`
2. Click "Connect to Device" → "USB HID"
3. Select "FIIO K13 R2R" from device picker
4. Click "Pull" to read current settings
5. Modify some filters
6. Click "Push" to write changes
7. Verify audio output reflects changes

### 2. Low-Level Test (testing.html)
1. Open `http://localhost:8000/testing.html`
2. Click "Request HID Devices" → Select K13 R2R
3. Click "Get Version from FiiO Devices"
4. Verify response is received
5. Test custom commands as needed

### 3. Slot Testing
For each slot (Jazz, Pop, Rock, Dance, R&B, Classic, Hip-hop, USER1, USER2, USER3):
1. Select the slot
2. Pull settings
3. Verify slot name matches
4. For USER slots: modify and push
5. Verify changes persist

### 4. Filter Type Testing
1. Create preset with all PK filters → Push → Verify
2. Create preset with LSQ filter → Push → Verify
3. Create preset with HSQ filter → Push → Verify
4. Create mixed preset → Push → Verify

---

## Test Results

**Test Date:** October 18, 2025  
**Tested By:** Benji Hertel  
**Browser:** [Browser Name & Version]  
**OS:** Windows 10.0.26200  

### Connectivity Results
```
[To be filled during testing]
```

### Pull/Push Results
```
[To be filled during testing]
```

### Slot Management Results
```
[To be filled during testing]
```

### Filter Types Results
```
[To be filled during testing]
```

### Issues Found
```
[To be filled during testing]
```

---

## Known Issues
- None yet (awaiting testing)

---

## Notes
- Configuration based on FiiO Q7 (similar desktop DAC/AMP architecture)
- K13 R2R is a desktop device, so `disconnectOnSave: false` is appropriate
- Device should support all standard FiiO PEQ features
- reportId may need adjustment based on actual HID descriptor

---

## Next Steps After Testing
1. [ ] Update product ID in configuration if needed
2. [ ] Adjust reportId if different from 1
3. [ ] Verify slot IDs match actual device behavior
4. [ ] Document any device-specific quirks
5. [ ] Update experimental flag if needed
6. [ ] Submit PR with test results

