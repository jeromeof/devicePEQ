# Earfun Tune Pro - PEQ Editor Update

## ✅ Full PEQ Editor Implemented!

The Earfun Tune Pro interface has been completely redesigned with a full Parametric EQ editor similar to the Airoha (Audeze/Moondrop) interface.

---

## 🎯 What Changed

### Before: Simple Sliders
- 10 individual vertical sliders
- Only gain adjustment
- Sent commands immediately on slider change
- No overview of all settings

### After: Full PEQ Table Editor
- **Editable frequency** for each band (20Hz - 20kHz)
- **Editable gain** for each band (-12dB to +12dB)
- **Editable Q value** for each band (500 - 5000)
- **Enable/disable** individual bands
- **Table view** showing all 10 bands at once
- **Explicit Write button** - changes only sent when you click "Write All Bands"

---

## 🎨 New Interface

### Control Buttons
```
📥 Read Current EQ     - Initializes with flat EQ (device is write-only)
📤 Write All Bands     - Sends all 10 bands to device
🔄 Reset to Flat (0dB) - Resets editor to 0dB all bands
```

### PEQ Table
| Band | Enabled | Frequency (Hz) | Gain (dB) | Q Value |
|------|---------|----------------|-----------|---------|
| 1    | ☑       | 31.5           | 0         | 2867    |
| 2    | ☑       | 63             | 0         | 2867    |
| ...  | ...     | ...            | ...       | ...     |
| 10   | ☑       | 16000          | 0         | 2867    |

All fields are **directly editable** by clicking in the table cells!

---

## 🔧 How It Works

### 1. Connect to Device
- Pair Earfun Tune Pro via system Bluetooth
- Open web tool, click "Connect Device"
- Select Bluetooth Serial Port

### 2. Initialize EQ Data
- Click **"Read Current EQ"**
  - Note: Device doesn't support reading, so it shows default flat EQ
  - You can edit this to match your current settings

### 3. Edit EQ Parameters
- **Frequency**: Click the Hz field, type new value (e.g., `100` for 100Hz)
- **Gain**: Click the dB field, type new value (e.g., `6` for +6dB or `-3` for -3dB)
- **Q Value**: Editable, but likely fixed at 2867 in hardware
- **Enable/Disable**: Uncheck to skip that band when writing

### 4. Save to Device
- Click **"Write All Bands"**
- Sends all enabled bands to device (50ms delay between each)
- Console log shows each command with hex dump

### 5. Reset if Needed
- Click **"Reset to Flat (0dB)"** to start over
- Then click **"Write All Bands"** to save the flat EQ

---

## ⚠️ Known Issues & Limitations

### 1. Values Don't "Stick" to Device
**Observation**: After sending commands, moving the slider again shows different gain values in subsequent TX commands.

**Example from your log**:
```
[23:33:57] 📤 TX: ... 00 C8 ... (Band 1: 31.5Hz @ +6dB)
[23:34:00] 📤 TX: ... FF 59 ... (Band 1: 31.5Hz @ -5dB)
```

**Possible Causes**:
1. **No confirmation response** - Device doesn't ACK the write, so we can't verify it was saved
2. **Save command needed** - Might need a separate "save to memory" command after all bands
3. **Preset selection** - Might need to select a "custom" preset first
4. **Power cycle required** - Changes might only take effect after power off/on

**Solution**: Since device doesn't respond with confirmation, the web interface now:
- Maintains local state in `earfunPEQData`
- Only sends when you click "Write All Bands"
- Doesn't auto-update from device (can't read back)

### 2. Q Factor May Be Fixed
The Q value field is editable, but the protocol appears to always send `0x0B33` (2867).

**Recommendation**: Try changing Q value and see if it affects sound. If not, it's a hardware limitation.

### 3. Frequency Encoding Rounding
When you set a frequency like 31.5Hz, it's encoded as:
```
freq_value = 31.5 * 3 = 94.5 → 94 (rounded)
Sent as: 0x00 0x5E (94)
```

Your capture showed `0x00 0x5F` (95), suggesting the app might round differently. The web interface uses standard rounding.

### 4. Bytes 6-7 Mystery
The protocol has two variants in bytes 6-7:
- **Original capture**: `FC F4`
- **New capture**: `FE 20`

Current implementation uses `FE 20` (from your latest captures). If commands don't work, we might need to:
- Try `FC F4` instead
- Add a toggle to switch between variants
- Investigate what triggers the different values

---

## 📊 Testing the Q Factor

To test if Q value actually works:

### Test Case 1: Narrow Band (High Q)
```
Band 1: 100Hz, +6dB, Q=5000
```
Should produce a very narrow peak around 100Hz.

### Test Case 2: Wide Band (Low Q)
```
Band 1: 100Hz, +6dB, Q=500
```
Should produce a broad boost around 100Hz.

### How to Test:
1. Set band 1 to 100Hz, +6dB, Q=5000
2. Click "Write All Bands"
3. Listen - is the boost narrow or wide?
4. Change Q to 500
5. Click "Write All Bands" again
6. Does the sound change?

If there's NO difference, Q is fixed at 2867 (hardware limitation).

---

## 🎯 Next Steps to Fix "Not Saving"

### Option 1: Find Save Command
Search the Android app decompiled source for:
```bash
grep -r "save\|commit\|apply" ~/Downloads/Earfun-Android-source --include="*.java" | grep -i eq
```

Look for a command that's sent **after** all the band commands.

### Option 2: Capture Preset Switch
Use Frida to capture when you:
1. Edit custom EQ
2. **Switch to a different preset**
3. **Switch back to custom**

This might reveal if there's a "select preset" command needed.

### Option 3: Capture App Startup
Capture when the app launches and connects - it might query the current EQ state, revealing a read command we haven't discovered.

### Option 4: Power Cycle Test
After writing EQ:
1. Power off headphones
2. Power on headphones
3. Do the settings persist?

If yes, changes ARE saved but just need a reboot.

---

## 🔍 Recommended Captures

### Capture 1: Switch Presets
```bash
python3.11 bluetooth_toolkit.py capture com.corelink.earfun --output preset_switch.txt
```
In app:
1. Go to Custom EQ (your edited one)
2. Switch to Preset 1 (Bass Boost or similar)
3. Switch back to Custom
4. Make a small change to custom
5. Save

Look for commands that might be "load preset X" or "save to preset Y".

### Capture 2: Full Session
```bash
python3.11 bluetooth_toolkit.py capture com.corelink.earfun --output full_session.txt
```
In app:
1. Connect to headphones
2. Edit custom EQ (change 3-4 bands)
3. Save
4. Disconnect
5. Reconnect
6. Check if custom EQ is still there

This will show the full command sequence including any init/save commands.

---

## 💡 Workaround for Now

Until we find the save command, users can:

1. **Use the web interface to design EQ**
   - Edit all parameters in the table
   - See complete overview of all 10 bands

2. **Click "Write All Bands"**
   - Sends all commands at once
   - 50ms delay between bands

3. **Test immediately**
   - Play audio right after writing
   - Listen if EQ takes effect

4. **Re-send if needed**
   - If EQ seems to reset, just click "Write All Bands" again
   - Quick and easy to re-apply

---

## 📋 Summary

### What Works ✅
- Full PEQ table editor with frequency, gain, Q
- Write all 10 bands to device
- Console logging shows all TX/RX
- Enable/disable individual bands
- Reset to flat EQ

### What's Unknown ❓
- Does device confirm/ACK writes?
- Is there a save/commit command?
- Does Q value actually work?
- Why `FC F4` vs `FE 20` in bytes 6-7?
- Are changes persistent across power cycles?

### Next Investigation 🔍
- Capture preset switching
- Search for save/commit command in app source
- Test Q value changes
- Test power cycle persistence

---

**Last Updated**: 2026-01-25
**Status**: Full PEQ editor implemented, investigating save mechanism
**File**: `../webtools/bluetooth_device_tester.html`
